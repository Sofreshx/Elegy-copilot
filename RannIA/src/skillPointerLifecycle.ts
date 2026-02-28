import * as vscode from 'vscode';
import { readJournal, writeJournal, MigrationPhase } from './migrationJournal';
import { migrateAllToVault, restoreAllFromVault } from './vaultMigration';
import { isPointerEnabled } from './skillPointer';

/**
 * Get the current lifecycle phase from the journal.
 */
export function getCurrentPhase(): MigrationPhase {
	return readJournal().phase;
}

/**
 * Check if SkillPointer is actively running (enabled or in transition).
 */
export function isSkillPointerActive(): boolean {
	const phase = getCurrentPhase();
	return phase === 'enabled' || phase === 'migrating-in' || phase === 'migrating-out';
}

/**
 * Migrate all skills to vault (DISABLED → MIGRATING_IN → ENABLED).
 */
export function migrateIn(output: vscode.OutputChannel): { success: boolean; error?: string } {
	const journal = readJournal();

	if (journal.phase !== 'disabled') {
		return { success: false, error: `Cannot migrate in from phase: ${journal.phase}` };
	}

	writeJournal({ ...journal, phase: 'migrating-in' });
	output.appendLine('[SkillPointer] Starting migration: DISABLED → MIGRATING_IN');

	try {
		const result = migrateAllToVault();
		output.appendLine(`[SkillPointer] Migration complete: ${result.migrated.length} migrated, ${result.skipped.length} skipped, ${result.failed.length} failed`);

		if (result.failed.length > 0) {
			for (const f of result.failed) {
				output.appendLine(`[SkillPointer]   FAILED: ${f.name}: ${f.error}`);
			}
			// Roll back phase to disabled on partial failure
			const rollbackJournal = readJournal();
			writeJournal({ ...rollbackJournal, phase: 'disabled' });
			output.appendLine('[SkillPointer] Rolled back to DISABLED due to partial failure');
			return { success: false, error: `${result.failed.length} skills failed to migrate` };
		}

		const updatedJournal = readJournal();
		writeJournal({ ...updatedJournal, phase: 'enabled' });
		output.appendLine('[SkillPointer] State: ENABLED');
		return { success: true };
	} catch (err) {
		output.appendLine(`[SkillPointer] Migration failed: ${err}`);
		// Roll back phase to disabled on exception
		try {
			const rollbackJournal = readJournal();
			writeJournal({ ...rollbackJournal, phase: 'disabled' });
			output.appendLine('[SkillPointer] Rolled back to DISABLED');
		} catch { /* best-effort rollback */ }
		return { success: false, error: String(err) };
	}
}

/**
 * Restore all skills from vault (ENABLED → MIGRATING_OUT → DISABLED).
 */
export function migrateOut(output: vscode.OutputChannel): { success: boolean; error?: string } {
	const journal = readJournal();

	if (journal.phase !== 'enabled') {
		return { success: false, error: `Cannot migrate out from phase: ${journal.phase}` };
	}

	writeJournal({ ...journal, phase: 'migrating-out' });
	output.appendLine('[SkillPointer] Starting restoration: ENABLED → MIGRATING_OUT');

	try {
		const result = restoreAllFromVault();
		output.appendLine(`[SkillPointer] Restoration complete: ${result.restored.length} restored, ${result.failed.length} failed`);

		if (result.failed.length > 0) {
			for (const f of result.failed) {
				output.appendLine(`[SkillPointer]   FAILED: ${f.name}: ${f.error}`);
			}
			// Roll back phase to enabled on partial failure
			const rollbackJournal = readJournal();
			writeJournal({ ...rollbackJournal, phase: 'enabled' });
			output.appendLine('[SkillPointer] Rolled back to ENABLED due to partial failure');
			return { success: false, error: `${result.failed.length} skills failed to restore` };
		}

		const updatedJournal = readJournal();
		writeJournal({ ...updatedJournal, phase: 'disabled' });
		output.appendLine('[SkillPointer] State: DISABLED');
		return { success: true };
	} catch (err) {
		output.appendLine(`[SkillPointer] Restoration failed: ${err}`);
		// Roll back phase to enabled on exception
		try {
			const rollbackJournal = readJournal();
			writeJournal({ ...rollbackJournal, phase: 'enabled' });
			output.appendLine('[SkillPointer] Rolled back to ENABLED');
		} catch { /* best-effort rollback */ }
		return { success: false, error: String(err) };
	}
}

/**
 * Resume interrupted migration at activation (journal-based crash recovery).
 * Must be called before any skill discovery.
 */
export function resumeMigration(output: vscode.OutputChannel): void {
	const journal = readJournal();
	const flagEnabled = isPointerEnabled();

	switch (journal.phase) {
		case 'disabled':
			if (flagEnabled) {
				output.appendLine('[SkillPointer] Flag enabled but phase is DISABLED — running migration');
				migrateIn(output);
			}
			break;

		case 'migrating-in':
			output.appendLine('[SkillPointer] Resuming interrupted migrate-in');
			try {
				const result = migrateAllToVault();
				output.appendLine(`[SkillPointer] Resume: ${result.migrated.length} migrated, ${result.skipped.length} skipped, ${result.failed.length} failed`);
				if (result.failed.length === 0) {
					const updated = readJournal();
					writeJournal({ ...updated, phase: 'enabled' });
					output.appendLine('[SkillPointer] State: ENABLED (after resume)');
				}
			} catch (err) {
				output.appendLine(`[SkillPointer] Resume migrate-in failed: ${err}`);
			}
			break;

		case 'enabled':
			if (!flagEnabled) {
				output.appendLine('[SkillPointer] Flag disabled but phase is ENABLED — running restoration');
				migrateOut(output);
			}
			break;

		case 'migrating-out':
			output.appendLine('[SkillPointer] Resuming interrupted migrate-out');
			try {
				const result = restoreAllFromVault();
				output.appendLine(`[SkillPointer] Resume: ${result.restored.length} restored, ${result.failed.length} failed`);
				if (result.failed.length === 0) {
					const updated = readJournal();
					writeJournal({ ...updated, phase: 'disabled' });
					output.appendLine('[SkillPointer] State: DISABLED (after resume)');
				}
			} catch (err) {
				output.appendLine(`[SkillPointer] Resume migrate-out failed: ${err}`);
			}
			break;
	}
}
