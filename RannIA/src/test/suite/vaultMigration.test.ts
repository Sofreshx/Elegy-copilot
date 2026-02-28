import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { migrateToVault, restoreFromVault } from '../../vaultMigration';
import { readJournal, writeJournal } from '../../migrationJournal';
import { isPointerSkill } from '../../skillPointer';

/**
 * These tests exercise migrate/restore roundtrip using temp directories.
 *
 * NOTE: migrateToVault and restoreFromVault call getUserSkillsDir() and
 * getSkillVaultDir() which depend on vscode.workspace.getConfiguration().
 * In the VS Code test runner, these resolve to the default ~/.copilot paths.
 * These tests create real skill directories under the resolved state root,
 * then clean up after themselves.
 *
 * For safer isolation, we import the path helpers to determine where
 * the vault and skills dirs are, and set up/tear down within them.
 */
import { getUserSkillsDir, getSkillVaultDir } from '../../enginePaths';

suite('vaultMigration', () => {
	const testSkillName = `__test-vault-migration-${Date.now()}`;
	let skillsDir: string;
	let vaultDir: string;
	let skillDir: string;
	let vaultSkillDir: string;

	setup(() => {
		skillsDir = getUserSkillsDir();
		vaultDir = getSkillVaultDir();
		skillDir = path.join(skillsDir, testSkillName);
		vaultSkillDir = path.join(vaultDir, testSkillName);

		// Create a test skill directory with SKILL.md and an extra file
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, 'SKILL.md'),
			[
				'# Test Skill',
				'',
				'description: A test skill for vault migration',
				'triggers: test, vault',
				'',
				'Full skill content here.',
			].join('\n'),
			'utf8'
		);
		fs.writeFileSync(path.join(skillDir, 'extra.md'), 'Extra content', 'utf8');
	});

	teardown(() => {
		// Clean up test artifacts
		try { fs.rmSync(skillDir, { recursive: true, force: true }); } catch { /* ignore */ }
		try { fs.rmSync(vaultSkillDir, { recursive: true, force: true }); } catch { /* ignore */ }
	});

	test('migrateToVault copies skill to vault and creates pointer', () => {
		migrateToVault(testSkillName);

		// Vault should have the full skill
		assert.ok(fs.existsSync(path.join(vaultSkillDir, 'SKILL.md')), 'Vault should contain SKILL.md');
		assert.ok(fs.existsSync(path.join(vaultSkillDir, 'extra.md')), 'Vault should contain extra.md');

		// Original location should be a pointer
		assert.ok(isPointerSkill(skillDir), 'Original skill should be a pointer');

		// Extra file should NOT be in the pointer directory
		assert.ok(!fs.existsSync(path.join(skillDir, 'extra.md')), 'Pointer dir should not have extra.md');
	});

	test('migrateToVault records journal entries', () => {
		migrateToVault(testSkillName);

		const journal = readJournal();
		const copyEntries = journal.entries.filter(
			(e) => e.skillName === testSkillName && e.phase === 'copy-to-vault'
		);
		const replaceEntries = journal.entries.filter(
			(e) => e.skillName === testSkillName && e.phase === 'replace-with-pointer'
		);

		assert.ok(copyEntries.length > 0, 'Should have copy-to-vault entry');
		assert.ok(replaceEntries.length > 0, 'Should have replace-with-pointer entry');
		assert.strictEqual(copyEntries[copyEntries.length - 1].status, 'done');
		assert.strictEqual(replaceEntries[replaceEntries.length - 1].status, 'done');
	});

	test('restoreFromVault restores full skill and removes vault entry', () => {
		// First migrate
		migrateToVault(testSkillName);
		assert.ok(isPointerSkill(skillDir), 'Should be pointer after migration');

		// Then restore
		restoreFromVault(testSkillName);

		// Original should have full content again
		assert.ok(!isPointerSkill(skillDir), 'Should be full skill after restore');
		assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'Should have SKILL.md');
		assert.ok(fs.existsSync(path.join(skillDir, 'extra.md')), 'Should have extra.md back');

		// Vault entry should be removed
		assert.ok(!fs.existsSync(vaultSkillDir), 'Vault entry should be removed');
	});

	test('migrateToVault skips already-pointer skills', () => {
		// First migrate
		migrateToVault(testSkillName);
		const journalBefore = readJournal();
		const countBefore = journalBefore.entries.length;

		// Migrate again — should be a no-op
		migrateToVault(testSkillName);
		const journalAfter = readJournal();

		assert.strictEqual(journalAfter.entries.length, countBefore, 'No new journal entries for already-migrated skill');
	});
});
