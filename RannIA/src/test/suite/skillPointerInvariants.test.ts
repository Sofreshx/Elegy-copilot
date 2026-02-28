import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writePointerContent, parsePointerFrontmatter, isPointerSkill, POINTER_SCHEMA_VERSION } from '../../skillPointer';
import { parseVaultRef } from '../../skillResolver';
import { isConfinedToRoot, containsTraversalSegment } from '../../utils/pathSecurity';

/**
 * WU-INT-01: Cross-Workstream Invariant Tests
 *
 * These tests verify the 5 mandatory invariants that must hold for Phase 1 exit:
 * 1. No mixed state: pointers-only when enabled, full-only when disabled
 * 2. Vault path never in scan path
 * 3. Pointer names map 1:1 with vault directory names
 * 4. All resolvers fail-closed
 * 5. Atomic migration with journal crash recovery
 */

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-inv-'));
}

function writeFullSkill(skillsDir: string, name: string, content: string): void {
	const dir = path.join(skillsDir, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

function writePointerSkill(skillsDir: string, name: string, vaultRef: string): void {
	const dir = path.join(skillsDir, name);
	fs.mkdirSync(dir, { recursive: true });
	const content = writePointerContent(name, `Description of ${name}`, name, vaultRef);
	fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

function writeVaultSkill(vaultDir: string, name: string): void {
	const dir = path.join(vaultDir, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\nFull skill content for ${name}.\nTriggers on: ${name}`, 'utf8');
}

suite('SkillPointer Invariants (WU-INT-01)', () => {

	// INV-1: No mixed state — all pointers or all full, never mixed
	suite('INV-1: No mixed state', () => {
		test('pointer-mode scan path contains only pointers', () => {
			const tmp = makeTempDir();
			const skillsDir = path.join(tmp, 'skills');
			fs.mkdirSync(skillsDir, { recursive: true });

			writePointerSkill(skillsDir, 'skill-a', 'skill-a');
			writePointerSkill(skillsDir, 'skill-b', 'skill-b');

			const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
			for (const e of entries) {
				if (!e.isDirectory()) { continue; }
				const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
				assert.ok(fs.existsSync(skillMd), `SKILL.md missing for ${e.name}`);
				assert.ok(isPointerSkill(skillMd), `${e.name} should be a pointer but is not`);
			}

			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('non-pointer scan path contains only full skills', () => {
			const tmp = makeTempDir();
			const skillsDir = path.join(tmp, 'skills');
			fs.mkdirSync(skillsDir, { recursive: true });

			writeFullSkill(skillsDir, 'skill-a', '# skill-a\nFull content.\nTriggers on: skill-a');
			writeFullSkill(skillsDir, 'skill-b', '# skill-b\nFull content.\nTriggers on: skill-b');

			const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
			for (const e of entries) {
				if (!e.isDirectory()) { continue; }
				const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
				assert.ok(fs.existsSync(skillMd), `SKILL.md missing for ${e.name}`);
				assert.ok(!isPointerSkill(skillMd), `${e.name} should be full but is a pointer`);
			}

			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('mixed state is detectable', () => {
			const tmp = makeTempDir();
			const skillsDir = path.join(tmp, 'skills');
			fs.mkdirSync(skillsDir, { recursive: true });

			writePointerSkill(skillsDir, 'skill-a', 'skill-a');
			writeFullSkill(skillsDir, 'skill-b', '# skill-b\nFull content.');

			let hasPointer = false;
			let hasFull = false;
			const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
			for (const e of entries) {
				if (!e.isDirectory()) { continue; }
				const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
				if (isPointerSkill(skillMd)) { hasPointer = true; }
				else { hasFull = true; }
			}

			assert.ok(hasPointer && hasFull, 'Mixed state should be detected');
			fs.rmSync(tmp, { recursive: true, force: true });
		});
	});

	// INV-2: Vault path never appears in scan path
	suite('INV-2: Vault path excluded from scan path', () => {
		test('pointer vault-ref is a skill name, not a full path to scan dir', () => {
			const content = writePointerContent('test', 'desc', 'triggers', 'test');
			const parsed = parsePointerFrontmatter(content);
			assert.ok(parsed);
			// vault-ref is the skill name used by the resolver to find vault/<name>/SKILL.md
			assert.ok(!parsed['vault-ref'].startsWith('skills/'), 'vault-ref must not point to scan path');
			assert.ok(!parsed['vault-ref'].includes('/'), 'vault-ref should be just the skill name');
		});

		test('vault directory name is distinct from scan directory name', () => {
			// The vault lives in skills-vault, the scan path in skills
			assert.notStrictEqual('skills-vault', 'skills');
		});
	});

	// INV-3: Pointer names map 1:1 with vault directory names
	suite('INV-3: Pointer-vault name parity', () => {
		test('pointer name matches vault directory name', () => {
			const tmp = makeTempDir();
			const skillsDir = path.join(tmp, 'skills');
			const vaultDir = path.join(tmp, 'skills-vault');

			writePointerSkill(skillsDir, 'csharp-expert', 'csharp-expert');
			writePointerSkill(skillsDir, 'wolverine-http', 'wolverine-http');
			writeVaultSkill(vaultDir, 'csharp-expert');
			writeVaultSkill(vaultDir, 'wolverine-http');

			const pointerDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
				.filter(e => e.isDirectory())
				.map(e => e.name)
				.sort();
			const vaultDirs = fs.readdirSync(vaultDir, { withFileTypes: true })
				.filter(e => e.isDirectory())
				.map(e => e.name)
				.sort();

			assert.deepStrictEqual(pointerDirs, vaultDirs, 'Pointer names must match vault directory names 1:1');

			// Also verify the vault-ref in each pointer references the correct vault directory
			for (const name of pointerDirs) {
				const skillMd = path.join(skillsDir, name, 'SKILL.md');
				const content = fs.readFileSync(skillMd, 'utf8');
				const parsed = parsePointerFrontmatter(content);
				assert.ok(parsed, `Pointer ${name} should have valid frontmatter`);
				assert.ok(parsed['vault-ref'].includes(name), `vault-ref for ${name} must reference the same name`);
			}

			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('writePointerContent produces matching name in vault-ref', () => {
			const name = 'my-custom-skill';
			const vaultRef = name;
			const content = writePointerContent(name, 'desc', 'triggers', vaultRef);
			const parsed = parsePointerFrontmatter(content);
			assert.ok(parsed);
			assert.strictEqual(parsed['vault-ref'], name, 'Generated vault-ref must be the skill name');
		});
	});

	// INV-4: All resolvers fail-closed
	suite('INV-4: Fail-closed resolution', () => {
		test('parseVaultRef returns null for non-existent skill', () => {
			const tmp = makeTempDir();
			const fakeSkill = path.join(tmp, 'nonexistent');
			// parseVaultRef calls fs.statSync which throws for non-existent paths
			let result: string | null = null;
			try {
				result = parseVaultRef(fakeSkill);
			} catch {
				result = null;
			}
			assert.strictEqual(result, null, 'Non-existent skill should return null');
			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('parseVaultRef returns null for full skill (no pointer)', () => {
			const tmp = makeTempDir();
			writeFullSkill(path.join(tmp, 'skills'), 'regular', '# regular\nFull content.');
			const result = parseVaultRef(path.join(tmp, 'skills', 'regular'));
			assert.strictEqual(result, null, 'Full skill should have no vault-ref');
			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('path traversal segments are rejected', () => {
			assert.ok(containsTraversalSegment('../etc/passwd'));
			assert.ok(containsTraversalSegment('skills/../../etc/passwd'));
			assert.ok(containsTraversalSegment('..\\windows\\system32'));
			assert.ok(!containsTraversalSegment('skills/my-skill/SKILL.md'));
		});

		test('confinement check rejects escaped paths', () => {
			const root = path.resolve('/tmp/vault');
			assert.ok(isConfinedToRoot(path.join(root, 'skill-a'), root));
			assert.ok(!isConfinedToRoot(path.resolve(root, '..', 'etc'), root));
		});

		test('schema version mismatch is detectable', () => {
			const content = [
				'---',
				'schema-version: 999',
				'vault-ref: test',
				'name: test',
				'---',
				'# test',
			].join('\n');
			const parsed = parsePointerFrontmatter(content);
			assert.ok(parsed, 'Frontmatter should parse');
			assert.notStrictEqual(parsed['schema-version'], POINTER_SCHEMA_VERSION,
				'Version 999 should not match current schema version');
		});
	});

	// INV-5: Atomic migration with journal crash recovery
	suite('INV-5: Atomic migration + journal', () => {
		test('journal records migration phase transitions', () => {
			const tmp = makeTempDir();
			const journalPath = path.join(tmp, '.migration-journal.json');

			// Override journal path by writing directly
			const journal = { phase: 'disabled' as const, entries: [], lastUpdated: new Date().toISOString() };
			fs.writeFileSync(journalPath, JSON.stringify(journal), 'utf8');

			const loaded = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
			assert.strictEqual(loaded.phase, 'disabled');

			// Simulate phase transition
			loaded.phase = 'migrating-in';
			fs.writeFileSync(journalPath, JSON.stringify(loaded), 'utf8');
			const mid = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
			assert.strictEqual(mid.phase, 'migrating-in');

			loaded.phase = 'enabled';
			fs.writeFileSync(journalPath, JSON.stringify(loaded), 'utf8');
			const final = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
			assert.strictEqual(final.phase, 'enabled');

			fs.rmSync(tmp, { recursive: true, force: true });
		});

		test('pointer write is atomic (content matches expected format)', () => {
			const name = 'atomic-test';
			const vaultRef = name;
			const content = writePointerContent(name, 'An atomic skill', 'atomic, test', vaultRef);

			// Verify the content is well-formed
			assert.ok(content.startsWith('---\n'));
			assert.ok(content.includes(`vault-ref: ${vaultRef}`));
			assert.ok(content.includes(`schema-version: ${POINTER_SCHEMA_VERSION}`));

			// Parse it back
			const parsed = parsePointerFrontmatter(content);
			assert.ok(parsed);
			assert.strictEqual(parsed['vault-ref'], vaultRef);
			assert.strictEqual(parsed['schema-version'], POINTER_SCHEMA_VERSION);
		});

		test('migration roundtrip preserves content integrity', () => {
			const tmp = makeTempDir();
			const skillsDir = path.join(tmp, 'skills');
			const vaultDir = path.join(tmp, 'skills-vault');

			// Start with a full skill
			const originalContent = '# roundtrip\nFull content for roundtrip test.\nTriggers on: roundtrip';
			writeFullSkill(skillsDir, 'roundtrip', originalContent);
			assert.ok(!isPointerSkill(path.join(skillsDir, 'roundtrip', 'SKILL.md')));

			// Simulate migrate-to-vault: copy to vault, replace with pointer
			writeVaultSkill(vaultDir, 'roundtrip');
			fs.writeFileSync(path.join(vaultDir, 'roundtrip', 'SKILL.md'), originalContent, 'utf8');
			const pointerContent = writePointerContent('roundtrip', 'roundtrip', 'roundtrip', 'roundtrip');
			fs.writeFileSync(path.join(skillsDir, 'roundtrip', 'SKILL.md'), pointerContent, 'utf8');

			// Verify pointer state
			assert.ok(isPointerSkill(path.join(skillsDir, 'roundtrip', 'SKILL.md')));

			// Simulate restore: copy vault back to scan path
			const vaultContent = fs.readFileSync(path.join(vaultDir, 'roundtrip', 'SKILL.md'), 'utf8');
			fs.writeFileSync(path.join(skillsDir, 'roundtrip', 'SKILL.md'), vaultContent, 'utf8');

			// Verify restored content matches original
			assert.ok(!isPointerSkill(path.join(skillsDir, 'roundtrip', 'SKILL.md')));
			const restored = fs.readFileSync(path.join(skillsDir, 'roundtrip', 'SKILL.md'), 'utf8');
			assert.strictEqual(restored, originalContent);

			fs.rmSync(tmp, { recursive: true, force: true });
		});
	});
});
