import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writePointerContent } from '../../skillPointer';
import {
	parseVaultRef,
	buildSearchIndex,
	buildSearchIndexFromRoots,
	resolveSkillFromRoots,
	searchIndex,
	SkillSearchIndex
} from '../../skillResolver';

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
				{ name: 'alpha', description: 'first', triggers: 'a', assetKey: 'alpha', viewPath: 'skills-vault/alpha/SKILL.md', vaultRef: 'alpha', vaultPath: '/v/alpha' },
				{ name: 'beta', description: 'second', triggers: 'b', assetKey: 'beta', viewPath: 'skills-vault/beta/SKILL.md', vaultRef: 'beta', vaultPath: '/v/beta' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, '');
		assert.strictEqual(results.length, 2);
	});

	test('searchIndex returns exact name match first', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'auth', description: 'authentication module', triggers: 'login', assetKey: 'auth', viewPath: 'skills-vault/auth/SKILL.md', vaultRef: 'auth', vaultPath: '/v/auth' },
				{ name: 'firebase-auth', description: 'firebase auth', triggers: 'firebase, auth', assetKey: 'firebase-auth', viewPath: 'skills-vault/firebase-auth/SKILL.md', vaultRef: 'firebase-auth', vaultPath: '/v/firebase-auth' },
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
				{ name: 'deploy', description: 'deployment tools', triggers: 'terraform, IaC', assetKey: 'deploy', viewPath: 'skills-vault/deploy/SKILL.md', vaultRef: 'deploy', vaultPath: '/v/deploy' },
				{ name: 'frontend', description: 'UI framework', triggers: 'react, vue', assetKey: 'frontend', viewPath: 'skills-vault/frontend/SKILL.md', vaultRef: 'frontend', vaultPath: '/v/frontend' },
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
				{ name: 'logging', description: 'observability and tracing', triggers: 'otel', assetKey: 'logging', viewPath: 'skills-vault/logging/SKILL.md', vaultRef: 'logging', vaultPath: '/v/logging' },
				{ name: 'testing', description: 'unit test framework', triggers: 'jest', assetKey: 'testing', viewPath: 'skills-vault/testing/SKILL.md', vaultRef: 'testing', vaultPath: '/v/testing' },
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
				{ name: 'alpha', description: 'first', triggers: 'a', assetKey: 'alpha', viewPath: 'skills-vault/alpha/SKILL.md', vaultRef: 'alpha', vaultPath: '/v/alpha' },
			],
			builtAt: new Date().toISOString(),
		};

		const results = searchIndex(index, 'zzz-no-match');
		assert.strictEqual(results.length, 0);
	});

	test('searchIndex handles multi-word queries', () => {
		const index: SkillSearchIndex = {
			entries: [
				{ name: 'firebase-auth', description: 'Firebase Authentication', triggers: 'firebase, auth, login', assetKey: 'firebase-auth', viewPath: 'skills-vault/firebase-auth/SKILL.md', vaultRef: 'firebase-auth', vaultPath: '/v/firebase-auth' },
				{ name: 'auth', description: 'generic auth', triggers: 'login', assetKey: 'auth', viewPath: 'skills-vault/auth/SKILL.md', vaultRef: 'auth', vaultPath: '/v/auth' },
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

	test('buildSearchIndexFromRoots indexes recursive vault-only and provider-backed skills distinctly', () => {
		const skillsDir = path.join(tmpDir, 'skills');
		const vaultDir = path.join(tmpDir, 'skills-vault');
		fs.mkdirSync(path.join(skillsDir, 'incident-pointer'), { recursive: true });
		fs.mkdirSync(path.join(vaultDir, 'providers', 'superpowers', 'incident-kit'), { recursive: true });
		fs.mkdirSync(path.join(vaultDir, 'operations', 'release-drill'), { recursive: true });

		fs.writeFileSync(
			path.join(skillsDir, 'incident-pointer', 'SKILL.md'),
			writePointerContent(
				'incident-pointer',
				'Pointer',
				'incident',
				'skills-vault/providers/superpowers/incident-kit'
			),
			'utf8'
		);
		fs.writeFileSync(
			path.join(vaultDir, 'providers', 'superpowers', 'incident-kit', 'index.md'),
			'# Incident Kit\n\n> Provider-backed vault skill.\n\nTriggers on: incident, outage',
			'utf8'
		);
		fs.writeFileSync(
			path.join(vaultDir, 'operations', 'release-drill', 'index.md'),
			'# Release Drill\n\n> Namespaced vault-only skill.\n\nTriggers on: release, rollback',
			'utf8'
		);

		const index = buildSearchIndexFromRoots(skillsDir, vaultDir);
		assert.strictEqual(index.entries.length, 2);

		const providerSkill = index.entries.find(
			(entry) => entry.assetKey === 'superpowers-copilot-superpowers-incident-kit'
		);
		assert.ok(providerSkill, 'expected provider-backed vault skill in search index');
		assert.strictEqual(providerSkill?.provider, 'superpowers-copilot');
		assert.strictEqual(providerSkill?.namespace, 'superpowers');
		assert.strictEqual(
			providerSkill?.viewPath,
			'skills-vault/providers/superpowers/incident-kit/index.md'
		);

		const namespacedSkill = index.entries.find(
			(entry) => entry.assetKey === 'copilot-home-plugin-operations-release-drill'
		);
		assert.ok(namespacedSkill, 'expected namespaced vault-only skill in search index');
		assert.strictEqual(namespacedSkill?.namespace, 'operations');
		assert.strictEqual(namespacedSkill?.provider, 'copilot-home-plugin');
	});

	test('resolveSkillFromRoots resolves provider-backed recursive vault refs and provider-qualified identities', () => {
		const skillsDir = path.join(tmpDir, 'skills');
		const vaultDir = path.join(tmpDir, 'skills-vault');
		fs.mkdirSync(path.join(skillsDir, 'incident-pointer'), { recursive: true });
		fs.mkdirSync(path.join(vaultDir, 'providers', 'superpowers', 'incident-kit'), { recursive: true });
		fs.mkdirSync(path.join(vaultDir, 'providers', 'superpowers', 'vault-only-kit'), { recursive: true });

		fs.writeFileSync(
			path.join(skillsDir, 'incident-pointer', 'SKILL.md'),
			writePointerContent(
				'incident-pointer',
				'Pointer',
				'incident',
				'skills-vault/providers/superpowers/incident-kit'
			),
			'utf8'
		);
		fs.writeFileSync(
			path.join(vaultDir, 'providers', 'superpowers', 'incident-kit', 'index.md'),
			'# Incident Kit\n\nTriggers on: incident',
			'utf8'
		);
		fs.writeFileSync(
			path.join(vaultDir, 'providers', 'superpowers', 'vault-only-kit', 'index.md'),
			'# Vault Only Kit\n\nTriggers on: vault',
			'utf8'
		);

		assert.strictEqual(
			resolveSkillFromRoots('superpowers-copilot-superpowers-incident-kit', skillsDir, vaultDir),
			path.join(vaultDir, 'providers', 'superpowers', 'incident-kit', 'index.md')
		);
		assert.strictEqual(
			resolveSkillFromRoots('superpowers/incident-kit', skillsDir, vaultDir),
			path.join(vaultDir, 'providers', 'superpowers', 'incident-kit', 'index.md')
		);
		assert.strictEqual(
			resolveSkillFromRoots('superpowers-copilot-superpowers-vault-only-kit', skillsDir, vaultDir),
			path.join(vaultDir, 'providers', 'superpowers', 'vault-only-kit', 'index.md')
		);
	});
});
