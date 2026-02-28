import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parsePointerFrontmatter, isPointerSkill, writePointerContent, POINTER_SCHEMA_VERSION } from '../../skillPointer';

suite('skillPointer', () => {
	test('parsePointerFrontmatter returns parsed fields for valid pointer', () => {
		const content = [
			'---',
			'schema-version: 1',
			'vault-ref: my-skill',
			'name: my-skill',
			'description: A test skill',
			'triggers: test, skill',
			'---',
			'',
			'# my-skill',
		].join('\n');

		const result = parsePointerFrontmatter(content);
		assert.ok(result);
		assert.strictEqual(result['schema-version'], 1);
		assert.strictEqual(result['vault-ref'], 'my-skill');
		assert.strictEqual(result.name, 'my-skill');
		assert.strictEqual(result.description, 'A test skill');
		assert.strictEqual(result.triggers, 'test, skill');
	});

	test('parsePointerFrontmatter returns null for non-pointer content', () => {
		const content = [
			'# Regular Skill',
			'',
			'This is a regular skill without frontmatter.',
		].join('\n');

		const result = parsePointerFrontmatter(content);
		assert.strictEqual(result, null);
	});

	test('parsePointerFrontmatter returns null for frontmatter without vault-ref', () => {
		const content = [
			'---',
			'schema-version: 1',
			'name: my-skill',
			'---',
			'',
			'# my-skill',
		].join('\n');

		const result = parsePointerFrontmatter(content);
		assert.strictEqual(result, null);
	});

	test('parsePointerFrontmatter returns null for invalid schema-version', () => {
		const content = [
			'---',
			'schema-version: abc',
			'vault-ref: my-skill',
			'---',
			'',
			'# my-skill',
		].join('\n');

		const result = parsePointerFrontmatter(content);
		assert.strictEqual(result, null);
	});

	test('isPointerSkill returns true for a pointer SKILL.md', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
		try {
			const skillDir = path.join(tmpDir, 'pointer-skill');
			fs.mkdirSync(skillDir);
			const pointerContent = writePointerContent('pointer-skill', 'desc', 'triggers', 'pointer-skill');
			fs.writeFileSync(path.join(skillDir, 'SKILL.md'), pointerContent, 'utf8');

			assert.strictEqual(isPointerSkill(skillDir), true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('isPointerSkill returns false for a regular SKILL.md', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
		try {
			const skillDir = path.join(tmpDir, 'full-skill');
			fs.mkdirSync(skillDir);
			fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Full Skill\n\nRegular content.', 'utf8');

			assert.strictEqual(isPointerSkill(skillDir), false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('isPointerSkill returns false for missing SKILL.md', () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-test-'));
		try {
			const skillDir = path.join(tmpDir, 'empty-skill');
			fs.mkdirSync(skillDir);

			assert.strictEqual(isPointerSkill(skillDir), false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('writePointerContent produces valid pointer content', () => {
		const content = writePointerContent('test-skill', 'A description', 'test, skill', 'test-skill');

		assert.ok(content.startsWith('---\n'));
		assert.ok(content.includes(`schema-version: ${POINTER_SCHEMA_VERSION}`));
		assert.ok(content.includes('vault-ref: test-skill'));
		assert.ok(content.includes('name: test-skill'));
		assert.ok(content.includes('description: A description'));
		assert.ok(content.includes('triggers: test, skill'));

		// Verify it round-trips through parsePointerFrontmatter
		const parsed = parsePointerFrontmatter(content);
		assert.ok(parsed);
		assert.strictEqual(parsed['vault-ref'], 'test-skill');
		assert.strictEqual(parsed.name, 'test-skill');
	});
});
