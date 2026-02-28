import * as fs from 'fs';
import * as path from 'path';
import { getUserSkillsDir, getSkillVaultDir } from './enginePaths';
import { readJournal, writeJournal, appendEntry, updateEntryStatus, MigrationJournalEntry } from './migrationJournal';
import { isPointerSkill, writePointerContent } from './skillPointer';
import { existsDir, existsFile } from './utils/fs';

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

function extractSkillMeta(skillDir: string): { description: string; triggers: string } {
	const skillMd = path.join(skillDir, 'SKILL.md');
	if (!existsFile(skillMd)) {
		return { description: '', triggers: '' };
	}
	const content = fs.readFileSync(skillMd, 'utf8');

	// Extract description from skill metadata
	const descMatch = content.match(/^description:\s*(.+)$/m)
		?? content.match(/^>\s*(.+)$/m);
	const description = descMatch ? descMatch[1].trim() : '';

	// Extract triggers
	const triggerMatch = content.match(/triggers[^:]*:\s*(.+)$/im);
	const triggers = triggerMatch ? triggerMatch[1].trim() : '';

	return { description, triggers };
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

	// Phase 2: Replace with pointer
	const replaceEntry: MigrationJournalEntry = {
		skillName,
		phase: 'replace-with-pointer',
		status: 'pending',
		timestamp: new Date().toISOString(),
	};
	journal = appendEntry(readJournal(), replaceEntry);
	writeJournal(journal);

	try {
		const meta = extractSkillMeta(vaultDest);
		const pointerContent = writePointerContent(
			skillName,
			meta.description,
			meta.triggers,
			skillName
		);

		// Remove the full skill directory and create pointer directory
		fs.rmSync(skillSource, { recursive: true, force: true });
		fs.mkdirSync(skillSource, { recursive: true });
		fs.writeFileSync(path.join(skillSource, 'SKILL.md'), pointerContent, 'utf8');

		journal = updateEntryStatus(readJournal(), skillName, 'replace-with-pointer', 'done');
		writeJournal(journal);
	} catch (err) {
		journal = updateEntryStatus(readJournal(), skillName, 'replace-with-pointer', 'failed', String(err));
		writeJournal(journal);
		throw err;
	}
}

/**
 * Restore a single skill from vault: copy full content back, remove pointer.
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

	// Phase 1: Restore from vault
	const restoreEntry: MigrationJournalEntry = {
		skillName,
		phase: 'restore-from-vault',
		status: 'pending',
		timestamp: new Date().toISOString(),
	};
	journal = appendEntry(journal, restoreEntry);
	writeJournal(journal);

	try {
		fs.rmSync(skillDest, { recursive: true, force: true });
		copyDirSync(vaultSource, skillDest);
		journal = updateEntryStatus(readJournal(), skillName, 'restore-from-vault', 'done');
		writeJournal(journal);
	} catch (err) {
		journal = updateEntryStatus(readJournal(), skillName, 'restore-from-vault', 'failed', String(err));
		writeJournal(journal);
		throw err;
	}

	// Phase 2: Remove vault entry
	const removeEntry: MigrationJournalEntry = {
		skillName,
		phase: 'remove-pointer',
		status: 'pending',
		timestamp: new Date().toISOString(),
	};
	journal = appendEntry(readJournal(), removeEntry);
	writeJournal(journal);

	try {
		fs.rmSync(vaultSource, { recursive: true, force: true });
		journal = updateEntryStatus(readJournal(), skillName, 'remove-pointer', 'done');
		writeJournal(journal);
	} catch (err) {
		journal = updateEntryStatus(readJournal(), skillName, 'remove-pointer', 'failed', String(err));
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
