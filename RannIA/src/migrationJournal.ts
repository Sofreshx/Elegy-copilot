import * as fs from 'fs';
import { getMigrationJournalPath, getSkillVaultDir } from './enginePaths';

export type MigrationPhase = 'disabled' | 'migrating-in' | 'enabled' | 'migrating-out';

export interface MigrationJournalEntry {
	skillName: string;
	phase: 'copy-to-vault' | 'replace-with-pointer' | 'restore-from-vault' | 'remove-pointer' | 'keep-in-scan-path' | 'remove-from-scan-path' | 'remove-vault-copy';
	status: 'pending' | 'done' | 'failed';
	timestamp: string;
	error?: string;
}

export interface MigrationJournal {
	schemaVersion: number;
	phase: MigrationPhase;
	entries: MigrationJournalEntry[];
	lastUpdated: string;
}

function emptyJournal(phase: MigrationPhase = 'disabled'): MigrationJournal {
	return {
		schemaVersion: 1,
		phase,
		entries: [],
		lastUpdated: new Date().toISOString(),
	};
}

export function readJournal(): MigrationJournal {
	const journalPath = getMigrationJournalPath();
	try {
		const content = fs.readFileSync(journalPath, 'utf8');
		const parsed = JSON.parse(content) as MigrationJournal;
		if (typeof parsed.schemaVersion !== 'number' || !parsed.phase || !Array.isArray(parsed.entries)) {
			return emptyJournal();
		}
		return parsed;
	} catch {
		return emptyJournal();
	}
}

export function writeJournal(journal: MigrationJournal): void {
	const journalPath = getMigrationJournalPath();
	const vaultDir = getSkillVaultDir();
	fs.mkdirSync(vaultDir, { recursive: true });
	journal.lastUpdated = new Date().toISOString();
	// Atomic write: write to tmp, then rename
	const tmp = journalPath + '.tmp.' + process.pid;
	fs.writeFileSync(tmp, JSON.stringify(journal, null, 2), 'utf8');
	fs.renameSync(tmp, journalPath);
}

export function appendEntry(journal: MigrationJournal, entry: MigrationJournalEntry): MigrationJournal {
	return {
		...journal,
		entries: [...journal.entries, entry],
	};
}

export function updateEntryStatus(
	journal: MigrationJournal,
	skillName: string,
	entryPhase: MigrationJournalEntry['phase'],
	status: MigrationJournalEntry['status'],
	error?: string
): MigrationJournal {
	const entries = journal.entries.map((e) => {
		if (e.skillName === skillName && e.phase === entryPhase && e.status === 'pending') {
			return { ...e, status, error, timestamp: new Date().toISOString() };
		}
		return e;
	});
	return { ...journal, entries };
}
