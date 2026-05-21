#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');
const generatorPath = path.resolve(__dirname, 'generate-skill-metadata-index.mjs');
const outputPath = path.resolve(repoRoot, 'engine-assets/skills/skill-metadata-index.json');

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

function runGenerator() {
	const result = childProcess.spawnSync(process.execPath, [generatorPath], {
		cwd: repoRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	assert.strictEqual(result.status, 0, `generator failed: ${result.stderr || result.stdout}`);
}

function readIndexRaw() {
	return fs.readFileSync(outputPath, 'utf8');
}

function readIndex() {
	return JSON.parse(readIndexRaw());
}

function runModuleSnippet(source) {
	return childProcess.spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
		cwd: repoRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

function writeFile(root, relativePath, content) {
	const filePath = path.join(root, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, 'utf8');
}

function withTempRepoFixture(files, fn) {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-skill-metadata-index-'));
	try {
		for (const [relativePath, content] of Object.entries(files)) {
			writeFile(tempRoot, relativePath, content);
		}
		fn(tempRoot);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
}

function assertSortedUniqueList(entry, fieldName) {
	if (!Object.prototype.hasOwnProperty.call(entry, fieldName)) {
		return;
	}

	assert.ok(Array.isArray(entry[fieldName]), `${fieldName} should be array for ${entry.skill}`);
	const sorted = [...entry[fieldName]].sort((a, b) => a.localeCompare(b));
	assert.deepStrictEqual(entry[fieldName], sorted, `${fieldName} not sorted for ${entry.skill}`);
	assert.strictEqual(
		new Set(entry[fieldName]).size,
		entry[fieldName].length,
		`${fieldName} not deduplicated for ${entry.skill}`,
	);
}

runGenerator();
const firstRaw = readIndexRaw();
const first = readIndex();
runGenerator();
const secondRaw = readIndexRaw();
const second = readIndex();

test('generator writes schemaVersion=1 and non-empty entries list', () => {
	assert.strictEqual(first.schemaVersion, 1);
	assert.ok(Array.isArray(first.entries));
	assert.ok(first.entries.length > 0, 'expected at least one skill');
});

test('entries are deterministically sorted by skill key', () => {
	const keys = first.entries.map((entry) => entry.skill);
	const sorted = [...keys].sort((a, b) => a.localeCompare(b));
	assert.deepStrictEqual(keys, sorted);
});

test('triggersOn values are sorted and deduplicated per skill', () => {
	for (const entry of first.entries) {
		assertSortedUniqueList(entry, 'triggersOn');
	}
});

test('supported metadata list fields are sorted and deduplicated when present', () => {
	for (const entry of first.entries) {
		assertSortedUniqueList(entry, 'aliasKeys');
		assertSortedUniqueList(entry, 'frameworks');
		assertSortedUniqueList(entry, 'stacks');
		assertSortedUniqueList(entry, 'languages');
		assertSortedUniqueList(entry, 'tags');
	}
});

test('manifest metadata is present when attached and has deterministic fields', () => {
	for (const entry of first.entries) {
		if (!entry.manifest) continue;
		assert.ok(typeof entry.manifest.id === 'string' && entry.manifest.id.length > 0, `manifest.id missing for ${entry.skill}`);
		assert.ok(typeof entry.manifest.loadMode === 'string' && entry.manifest.loadMode.length > 0, `manifest.loadMode missing for ${entry.skill}`);
	}
});

test('manifest skill metadata rejects empty ids and load modes', () => {
	const generatorUrl = pathToFileURL(generatorPath).href;
	const cases = [
		{
			field: 'id',
			manifest: {
				assets: [
					{ type: 'skill', source: 'engine-assets/skills/example-skill', id: '', loadMode: 'always' },
				],
			},
		},
		{
			field: 'loadMode',
			manifest: {
				assets: [
					{ type: 'skill', source: 'engine-assets/skills/example-skill', id: 'skill-example-skill', loadMode: '   ' },
				],
			},
		},
	];

	for (const testCase of cases) {
		const result = runModuleSnippet(
			[
				`import { collectManifestSkillMetadata } from ${JSON.stringify(generatorUrl)};`,
				`collectManifestSkillMetadata(${JSON.stringify(testCase.manifest)});`,
			].join('\n'),
		);

		assert.notStrictEqual(result.status, 0, `expected failure for empty manifest ${testCase.field}`);
		assert.match(
			`${result.stderr || ''}${result.stdout || ''}`,
			new RegExp(`empty ${testCase.field}`),
			`expected empty ${testCase.field} error output`,
		);
	}
});

test('generator rejects malformed metadata frontmatter with skill file context', () => {
	const generatorUrl = pathToFileURL(generatorPath).href;
	const cases = [
		{
			name: 'invalid JSON metadata',
			skillKey: 'broken-json-skill',
			metadataLines: ['metadata: {"aliasKeys": ["broken",]}'],
			errorPattern: /invalid metadata JSON/i,
		},
		{
			name: 'non-object metadata',
			skillKey: 'non-object-skill',
			metadataLines: ['metadata: ["broken"]'],
			errorPattern: /same-line JSON object/i,
		},
		{
			name: 'block metadata',
			skillKey: 'block-metadata-skill',
			metadataLines: ['metadata:', '  aliasKeys: ["x"]'],
			errorPattern: /same-line JSON object/i,
		},
	];

	for (const testCase of cases) {
		withTempRepoFixture(
			{
				'engine-assets/manifest.json': JSON.stringify({
					assets: [
						{
							type: 'skill',
							source: `engine-assets/skills/${testCase.skillKey}`,
							id: `skill-${testCase.skillKey}`,
							loadMode: 'on-demand',
						},
					],
				}, null, 2),
				[`engine-assets/skills/${testCase.skillKey}/SKILL.md`]: [
					'---',
					`name: ${testCase.skillKey}`,
					...testCase.metadataLines,
					'---',
					'',
					`# ${testCase.skillKey}`,
				].join('\n'),
			},
			(tempRoot) => {
				const result = runModuleSnippet(
					[
						`import { generateIndex } from ${JSON.stringify(generatorUrl)};`,
						`generateIndex({ write: false, repoRoot: ${JSON.stringify(tempRoot)} });`,
					].join('\n'),
				);

				assert.notStrictEqual(result.status, 0, `expected failure for ${testCase.name}`);
				assert.match(
					`${result.stderr || ''}${result.stdout || ''}`,
					new RegExp(`engine-assets/skills/${testCase.skillKey}/SKILL\\.md`),
					`expected skill path in output for ${testCase.name}`,
				);
				assert.match(
					`${result.stderr || ''}${result.stdout || ''}`,
					testCase.errorPattern,
					`expected descriptive metadata error for ${testCase.name}`,
				);
			}
		);
	}
});

test('generator parses block-scalar descriptions without breaking inline metadata parsing', () => {
	const generatorUrl = pathToFileURL(generatorPath).href;
	withTempRepoFixture(
		{
			'engine-assets/manifest.json': JSON.stringify({
				assets: [
					{
						type: 'skill',
						source: 'engine-assets/skills/folded-skill',
						id: 'skill-folded-skill',
						loadMode: 'on-demand',
					},
					{
						type: 'skill',
						source: 'engine-assets/skills/literal-skill',
						id: 'skill-literal-skill',
						loadMode: 'on-demand',
					},
				],
			}, null, 2),
			'engine-assets/skills/folded-skill/SKILL.md': [
				'---',
				'name: folded-skill',
				'description: >',
				'  Folded line one',
				'  line two.',
				'  Triggers on: folded-skill, folded parser.',
				'metadata: {"aliasKeys":["folded-alias"]}',
				'---',
				'',
				'# Folded Skill',
			].join('\n'),
			'engine-assets/skills/literal-skill/SKILL.md': [
				'---',
				'name: literal-skill',
				'description: |',
				'  Literal first line',
				'  Literal second line',
				'---',
				'',
				'# Literal Skill',
			].join('\n'),
		},
		(tempRoot) => {
			const result = runModuleSnippet(
				[
					`import { generateIndex } from ${JSON.stringify(generatorUrl)};`,
					`const index = generateIndex({ write: false, repoRoot: ${JSON.stringify(tempRoot)} });`,
					'console.log(JSON.stringify(index));',
				].join('\n'),
			);

			assert.strictEqual(result.status, 0, `expected generator success: ${result.stderr || result.stdout}`);
			const index = JSON.parse(result.stdout.trim());
			const foldedSkill = index.entries.find((entry) => entry.skill === 'folded-skill');
			const literalSkill = index.entries.find((entry) => entry.skill === 'literal-skill');

			assert.ok(foldedSkill, 'expected folded-skill entry');
			assert.strictEqual(
				foldedSkill.description,
				'Folded line one line two. Triggers on: folded-skill, folded parser.',
			);
			assert.deepStrictEqual(foldedSkill.aliasKeys, ['folded-alias']);
			assert.deepStrictEqual(foldedSkill.triggersOn, ['folded parser', 'folded-skill']);

			assert.ok(literalSkill, 'expected literal-skill entry');
			assert.strictEqual(literalSkill.description, 'Literal first line\nLiteral second line');
		}
	);
});

test('output is deterministic across repeated generation', () => {
	assert.strictEqual(firstRaw, secondRaw, 'raw JSON output changed between runs');
	assert.deepStrictEqual(first, second, 'parsed JSON changed between runs');
});

test('first-wave metadata carriers are emitted for normalized source skills', () => {
	const skillDiscovery = first.entries.find((entry) => entry.skill === 'skill-discovery');
	assert.ok(skillDiscovery, 'expected skill-discovery entry');
	assert.deepStrictEqual(skillDiscovery.aliasKeys, ['search-execute']);
	assert.deepStrictEqual(skillDiscovery.stacks, ['orchestration']);
	assert.deepStrictEqual(skillDiscovery.tags, ['catalog', 'discovery', 'routing', 'workflow']);

	const stackDetector = first.entries.find((entry) => entry.skill === 'stack-detector');
	assert.ok(stackDetector, 'expected stack-detector entry');
	assert.deepStrictEqual(stackDetector.aliasKeys, ['target-context-detector']);
	assert.deepStrictEqual(stackDetector.frameworks, ['angular', 'aspire', 'orleans', 'react', 'signalr', 'vue']);
	assert.deepStrictEqual(stackDetector.languages, ['csharp', 'go', 'javascript', 'python', 'typescript']);
	assert.deepStrictEqual(stackDetector.stacks, ['api', 'desktop', 'frontend', 'infra']);
	assert.deepStrictEqual(stackDetector.tags, ['classification', 'detection', 'routing', 'targeting']);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
