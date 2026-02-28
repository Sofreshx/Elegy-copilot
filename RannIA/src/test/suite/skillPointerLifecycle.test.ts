import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { readJournal, writeJournal, MigrationPhase } from '../../migrationJournal';
import { getUserSkillsDir, getSkillVaultDir } from '../../enginePaths';
import { migrateIn, migrateOut, resumeMigration, getCurrentPhase, isSkillPointerActive } from '../../skillPointerLifecycle';
import * as vscode from 'vscode';

function createMockOutput(): vscode.OutputChannel & { lines: string[] } {
	const lines: string[] = [];
	return {
		lines,
		name: 'test',
		append: () => {},
		appendLine: (msg: string) => { lines.push(msg); },
		clear: () => {},
		show: () => {},
		hide: () => {},
		dispose: () => {},
		replace: () => {},
	} as unknown as vscode.OutputChannel & { lines: string[] };
}

suite('skillPointerLifecycle', () => {
	const testSkillName = `__test-lifecycle-${Date.now()}`;
	let skillsDir: string;
	let vaultDir: string;
	let skillDir: string;

	function setJournalPhase(phase: MigrationPhase): void {
		const journal = readJournal();
		writeJournal({ ...journal, phase });
	}

	function createTestSkill(): void {
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, 'SKILL.md'),
			[
				'# Test Lifecycle Skill',
				'',
				'description: A test skill for lifecycle tests',
				'triggers: test, lifecycle',
				'',
				'Full skill content here.',
			].join('\n'),
			'utf8'
		);
	}

	setup(() => {
		skillsDir = getUserSkillsDir();
		vaultDir = getSkillVaultDir();
		skillDir = path.join(skillsDir, testSkillName);

		// Ensure clean state
		setJournalPhase('disabled');
		createTestSkill();
	});

	teardown(() => {
		// Clean up
		try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch { /* ignore */ }
		try { fs.rmSync(path.join(vaultDir, testSkillName), { recursive: true, force: true }); } catch { /* ignore */ }
		setJournalPhase('disabled');
	});

	test('getCurrentPhase returns journal phase', () => {
		setJournalPhase('disabled');
		assert.strictEqual(getCurrentPhase(), 'disabled');

		setJournalPhase('enabled');
		assert.strictEqual(getCurrentPhase(), 'enabled');
	});

	test('isSkillPointerActive is true for enabled and transitional phases', () => {
		setJournalPhase('disabled');
		assert.strictEqual(isSkillPointerActive(), false);

		setJournalPhase('enabled');
		assert.strictEqual(isSkillPointerActive(), true);

		setJournalPhase('migrating-in');
		assert.strictEqual(isSkillPointerActive(), true);

		setJournalPhase('migrating-out');
		assert.strictEqual(isSkillPointerActive(), true);
	});

	test('migrateIn transitions disabled → enabled', () => {
		setJournalPhase('disabled');
		const output = createMockOutput();
		const result = migrateIn(output);

		assert.strictEqual(result.success, true);
		assert.strictEqual(getCurrentPhase(), 'enabled');
		assert.ok(output.lines.some(l => l.includes('ENABLED')));
	});

	test('migrateIn rejects non-disabled phase', () => {
		setJournalPhase('enabled');
		const output = createMockOutput();
		const result = migrateIn(output);

		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes('Cannot migrate in'));
	});

	test('migrateOut transitions enabled → disabled', () => {
		// First migrate in so we have vault content
		setJournalPhase('disabled');
		const setupOutput = createMockOutput();
		migrateIn(setupOutput);
		assert.strictEqual(getCurrentPhase(), 'enabled');

		// Now migrate out
		const output = createMockOutput();
		const result = migrateOut(output);

		assert.strictEqual(result.success, true);
		assert.strictEqual(getCurrentPhase(), 'disabled');
		assert.ok(output.lines.some(l => l.includes('DISABLED')));
	});

	test('migrateOut rejects non-enabled phase', () => {
		setJournalPhase('disabled');
		const output = createMockOutput();
		const result = migrateOut(output);

		assert.strictEqual(result.success, false);
		assert.ok(result.error?.includes('Cannot migrate out'));
	});

	test('resumeMigration completes interrupted migrate-in', () => {
		// Simulate crash during migrate-in: set phase to migrating-in manually
		setJournalPhase('migrating-in');
		const output = createMockOutput();

		resumeMigration(output);

		assert.strictEqual(getCurrentPhase(), 'enabled');
		assert.ok(output.lines.some(l => l.includes('Resuming interrupted migrate-in')));
	});

	test('resumeMigration completes interrupted migrate-out', () => {
		// First do a full migrate-in so vault has content
		setJournalPhase('disabled');
		const setupOutput = createMockOutput();
		migrateIn(setupOutput);

		// Simulate crash during migrate-out
		setJournalPhase('migrating-out');
		const output = createMockOutput();

		resumeMigration(output);

		assert.strictEqual(getCurrentPhase(), 'disabled');
		assert.ok(output.lines.some(l => l.includes('Resuming interrupted migrate-out')));
	});
});
