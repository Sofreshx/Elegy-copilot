import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { migrateToVault, restoreFromVault } from '../../vaultMigration';
import { readJournal } from '../../migrationJournal';
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

	test('migrateToVault copies on-demand skill to vault and removes from scan path', () => {
		migrateToVault(testSkillName);

		// Vault should have the full skill
		assert.ok(fs.existsSync(path.join(vaultSkillDir, 'SKILL.md')), 'Vault should contain SKILL.md');
		assert.ok(fs.existsSync(path.join(vaultSkillDir, 'extra.md')), 'Vault should contain extra.md');

		// On-demand skill should be removed from scan path entirely
		assert.ok(!fs.existsSync(skillDir), 'On-demand skill should be removed from scan path');
	});

	test('migrateToVault records journal entries with remove-from-scan-path', () => {
		migrateToVault(testSkillName);

		const journal = readJournal();
		const copyEntries = journal.entries.filter(
			(e) => e.skillName === testSkillName && e.phase === 'copy-to-vault'
		);
		const removeEntries = journal.entries.filter(
			(e) => e.skillName === testSkillName && e.phase === 'remove-from-scan-path'
		);

		assert.ok(copyEntries.length > 0, 'Should have copy-to-vault entry');
		assert.ok(removeEntries.length > 0, 'Should have remove-from-scan-path entry');
		assert.strictEqual(copyEntries[copyEntries.length - 1].status, 'done');
		assert.strictEqual(removeEntries[removeEntries.length - 1].status, 'done');
	});

	test('restoreFromVault restores on-demand skill and removes vault entry', () => {
		// First migrate — skill gets removed from scan path
		migrateToVault(testSkillName);
		assert.ok(!fs.existsSync(skillDir), 'Skill should be removed after migration');

		// Then restore
		restoreFromVault(testSkillName);

		// Original should have full content again
		assert.ok(!isPointerSkill(skillDir), 'Should be full skill after restore');
		assert.ok(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'Should have SKILL.md');
		assert.ok(fs.existsSync(path.join(skillDir, 'extra.md')), 'Should have extra.md back');

		// Vault entry should be removed
		assert.ok(!fs.existsSync(vaultSkillDir), 'Vault entry should be removed');
	});

	test('migrateToVault throws for already-removed on-demand skill', () => {
		// First migrate — removes on-demand skill from scan path
		migrateToVault(testSkillName);
		assert.ok(!fs.existsSync(skillDir), 'Skill should be removed after migration');

		// Second migrate — skill dir no longer exists, should throw
		assert.throws(
			() => migrateToVault(testSkillName),
			/Skill directory not found/,
			'Should throw when skill directory does not exist'
		);
	});
});
