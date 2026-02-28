import * as fs from 'fs';
import * as path from 'path';
import { getUserSkillsDir, getSkillVaultDir } from './enginePaths';
import { readJournal, writeJournal, appendEntry, updateEntryStatus, MigrationJournalEntry } from './migrationJournal';
import { isPointerSkill } from './skillPointer';
import { existsDir } from './utils/fs';

/**
 * Skills that are always loaded (kept in skills/ even in pointer mode).
 * Must match engine-assets/manifest.json loadMode: "always" entries.
 */
const ALWAYS_LOADED_SKILLS = new Set([
	'core-guardrails',
	'skill-discovery',
	'implementation-friction',
	'stack-detector',
]);

function copyDirSync(source: string, dest: string): void {
	fs.mkdirSync(dest, { recursive: true });
	const entries = fs.readdirSync(source, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(source, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

/**
 * Migrate a single skill to the vault: copy full content to vault, replace with pointer.
 */
export function migrateToVault(skillName: string): void {
	const skillsDir = getUserSkillsDir();
	const vaultDir = getSkillVaultDir();
	const skillSource = path.join(skillsDir, skillName);
	const vaultDest = path.join(vaultDir, skillName);

	if (!existsDir(skillSource)) {
		throw new Error(`Skill directory not found: ${skillSource}`);
	}

	if (isPointerSkill(skillSource)) {
		return; // Already a pointer, skip
	}

	let journal = readJournal();

	// Phase 1: Copy to vault
	const copyEntry: MigrationJournalEntry = {
		skillName,
		phase: 'copy-to-vault',
		status: 'pending',
		timestamp: new Date().toISOString(),
	};
	journal = appendEntry(journal, copyEntry);
	writeJournal(journal);

	try {
		copyDirSync(skillSource, vaultDest);
		journal = updateEntryStatus(readJournal(), skillName, 'copy-to-vault', 'done');
		writeJournal(journal);
	} catch (err) {
		journal = updateEntryStatus(readJournal(), skillName, 'copy-to-vault', 'failed', String(err));
		writeJournal(journal);
		throw err;
	}

	// Phase 2: Handle skill in scan path based on loadMode
	if (ALWAYS_LOADED_SKILLS.has(skillName)) {
		// Always-loaded: keep full content in skills/ (already there), vault copy is enough
		const keepEntry: MigrationJournalEntry = {
			skillName,
			phase: 'keep-in-scan-path',
			status: 'done',
			timestamp: new Date().toISOString(),
		};
		journal = appendEntry(readJournal(), keepEntry);
		writeJournal(journal);
	} else {
		// On-demand: remove from skills/ entirely (vault-only)
		const removeEntry: MigrationJournalEntry = {
			skillName,
			phase: 'remove-from-scan-path',
			status: 'pending',
			timestamp: new Date().toISOString(),
		};
		journal = appendEntry(readJournal(), removeEntry);
		writeJournal(journal);

		try {
			fs.rmSync(skillSource, { recursive: true, force: true });

			journal = updateEntryStatus(readJournal(), skillName, 'remove-from-scan-path', 'done');
			writeJournal(journal);
		} catch (err) {
			journal = updateEntryStatus(readJournal(), skillName, 'remove-from-scan-path', 'failed', String(err));
			writeJournal(journal);
			throw err;
		}
	}
}

/**
 * Restore a single skill from vault: copy full content back to scan path, remove vault copy.
 * Always-loaded skills are already in skills/ — only the vault copy is removed.
 * On-demand skills were removed from skills/ during migration — restored from vault first.
 */
export function restoreFromVault(skillName: string): void {
	const skillsDir = getUserSkillsDir();
	const vaultDir = getSkillVaultDir();
	const skillDest = path.join(skillsDir, skillName);
	const vaultSource = path.join(vaultDir, skillName);

	if (!existsDir(vaultSource)) {
		throw new Error(`Vault entry not found: ${vaultSource}`);
	}

	let journal = readJournal();

	// Phase 1: Restore to scan path (only for on-demand skills that were removed)
	if (!existsDir(skillDest)) {
		const restoreEntry: MigrationJournalEntry = {
			skillName,
			phase: 'restore-from-vault',
			status: 'pending',
			timestamp: new Date().toISOString(),
		};
		journal = appendEntry(journal, restoreEntry);
		writeJournal(journal);

		try {
			copyDirSync(vaultSource, skillDest);
			journal = updateEntryStatus(readJournal(), skillName, 'restore-from-vault', 'done');
			writeJournal(journal);
		} catch (err) {
			journal = updateEntryStatus(readJournal(), skillName, 'restore-from-vault', 'failed', String(err));
			writeJournal(journal);
			throw err;
		}
	}

	// Phase 2: Remove vault copy
	const removeEntry: MigrationJournalEntry = {
		skillName,
		phase: 'remove-vault-copy',
		status: 'pending',
		timestamp: new Date().toISOString(),
	};
	journal = appendEntry(readJournal(), removeEntry);
	writeJournal(journal);

	try {
		fs.rmSync(vaultSource, { recursive: true, force: true });
		journal = updateEntryStatus(readJournal(), skillName, 'remove-vault-copy', 'done');
		writeJournal(journal);
	} catch (err) {
		journal = updateEntryStatus(readJournal(), skillName, 'remove-vault-copy', 'failed', String(err));
		writeJournal(journal);
		throw err;
	}
}

/**
 * Migrate all skills in the scan path to vault.
 */
export function migrateAllToVault(): { migrated: string[]; skipped: string[]; failed: Array<{ name: string; error: string }> } {
	const skillsDir = getUserSkillsDir();
	if (!existsDir(skillsDir)) {
		return { migrated: [], skipped: [], failed: [] };
	}

	const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
	const migrated: string[] = [];
	const skipped: string[] = [];
	const failed: Array<{ name: string; error: string }> = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) { continue; }
		const skillPath = path.join(skillsDir, entry.name);

		// Backwards compat: skip legacy pointer stubs from older installs
		if (isPointerSkill(skillPath)) {
			skipped.push(entry.name);
			continue;
		}

		try {
			migrateToVault(entry.name);
			migrated.push(entry.name);
		} catch (err) {
			failed.push({ name: entry.name, error: String(err) });
		}
	}

	return { migrated, skipped, failed };
}

/**
 * Restore all skills from vault back to scan path.
 */
export function restoreAllFromVault(): { restored: string[]; failed: Array<{ name: string; error: string }> } {
	const vaultDir = getSkillVaultDir();
	if (!existsDir(vaultDir)) {
		return { restored: [], failed: [] };
	}

	const entries = fs.readdirSync(vaultDir, { withFileTypes: true });
	const restored: string[] = [];
	const failed: Array<{ name: string; error: string }> = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) { continue; }
		if (entry.name.startsWith('.')) { continue; } // Skip journal and hidden files

		try {
			restoreFromVault(entry.name);
			restored.push(entry.name);
		} catch (err) {
			failed.push({ name: entry.name, error: String(err) });
		}
	}

	return { restored, failed };
}
