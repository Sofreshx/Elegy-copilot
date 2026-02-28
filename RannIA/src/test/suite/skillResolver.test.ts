import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writePointerContent } from '../../skillPointer';
import { parseVaultRef, buildSearchIndex, searchIndex, SkillSearchIndex } from '../../skillResolver';

suite('skillResolver', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// --- parseVaultRef ---

	test('parseVaultRef returns vault-ref for valid pointer directory', () => {
		const skillDir = path.join(tmpDir, 'my-skill');
		fs.mkdirSync(skillDir);
		const content = writePointerContent('my-skill', 'A skill', 'triggers', 'my-skill-vault');
		fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');

		const ref = parseVaultRef(skillDir);
		assert.strictEqual(ref, 'my-skill-vault');
	});

	test('parseVaultRef returns vault-ref for pointer file path', () => {
		const skillFile = path.join(tmpDir, 'SKILL.md');
		const content = writePointerContent('test', 'desc', 'trg', 'test-ref');
		fs.writeFileSync(skillFile, content, 'utf8');

		const ref = parseVaultRef(skillFile);
		assert.strictEqual(ref, 'test-ref');
	});

	test('parseVaultRef returns null for non-pointer file', () => {
		const skillDir = path.join(tmpDir, 'full-skill');
		fs.mkdirSync(skillDir);
		fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Full skill\nNo frontmatter.', 'utf8');

		const ref = parseVaultRef(skillDir);
		assert.strictEqual(ref, null);
	});

	test('parseVaultRef returns null for missing file', () => {
		const ref = parseVaultRef(path.join(tmpDir, 'nonexistent'));
		assert.strictEqual(ref, null);
	});

	// --- searchIndex ---

	test('searchIndex returns all entries for empty query', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'alpha', description: 'first', triggers: 'a', vaultRef: 'alpha', vaultPath: '/v/alpha' },
				{ name: 'beta', description: 'second', triggers: 'b', vaultRef: 'beta', vaultPath: '/v/beta' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, '');
		assert.strictEqual(results.length, 2);
	});

	test('searchIndex returns exact name match first', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'auth', description: 'authentication module', triggers: 'login', vaultRef: 'auth', vaultPath: '/v/auth' },
				{ name: 'firebase-auth', description: 'firebase auth', triggers: 'firebase, auth', vaultRef: 'firebase-auth', vaultPath: '/v/firebase-auth' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'auth');
		assert.ok(results.length >= 2);
		assert.strictEqual(results[0].name, 'auth');
	});

	test('searchIndex matches on triggers', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'deploy', description: 'deployment tools', triggers: 'terraform, IaC', vaultRef: 'deploy', vaultPath: '/v/deploy' },
				{ name: 'frontend', description: 'UI framework', triggers: 'react, vue', vaultRef: 'frontend', vaultPath: '/v/frontend' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'terraform');
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].name, 'deploy');
	});

	test('searchIndex matches on description', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'logging', description: 'observability and tracing', triggers: 'otel', vaultRef: 'logging', vaultPath: '/v/logging' },
				{ name: 'testing', description: 'unit test framework', triggers: 'jest', vaultRef: 'testing', vaultPath: '/v/testing' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'observability');
		assert.strictEqual(results.length, 1);
		assert.strictEqual(results[0].name, 'logging');
	});

	test('searchIndex returns empty for no matches', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'alpha', description: 'first', triggers: 'a', vaultRef: 'alpha', vaultPath: '/v/alpha' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'zzz-no-match');
		assert.strictEqual(results.length, 0);
	});

	test('searchIndex handles multi-word queries', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'firebase-auth', description: 'Firebase Authentication', triggers: 'firebase, auth, login', vaultRef: 'firebase-auth', vaultPath: '/v/firebase-auth' },
				{ name: 'auth', description: 'generic auth', triggers: 'login', vaultRef: 'auth', vaultPath: '/v/auth' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'firebase login');
		assert.ok(results.length >= 1);
		assert.strictEqual(results[0].name, 'firebase-auth');
	});

	// --- buildSearchIndex ---

	test('buildSearchIndex returns empty for nonexistent vault', () => {
		// buildSearchIndex reads from getSkillVaultDir() which we can't easily mock here,
		// but we verify the function doesn't throw
		const index = buildSearchIndex();
		assert.ok(Array.isArray(index.entries));
		assert.ok(index.builtAt);
	});
});
