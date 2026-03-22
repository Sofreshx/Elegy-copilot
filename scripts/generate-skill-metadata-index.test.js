#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

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
