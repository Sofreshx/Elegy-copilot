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

runGenerator();
const firstRaw = readIndexRaw();
const first = readIndex();
runGenerator();
const secondRaw = readIndexRaw();
const second = readIndex();

test('generator writes schemaVersion=1 and non-empty skills list', () => {
	assert.strictEqual(first.schemaVersion, 1);
	assert.ok(Array.isArray(first.skills));
	assert.ok(first.skills.length > 0, 'expected at least one skill');
});

test('skills are deterministically sorted by skill key', () => {
	const keys = first.skills.map((entry) => entry.skill);
	const sorted = [...keys].sort((a, b) => a.localeCompare(b));
	assert.deepStrictEqual(keys, sorted);
});

test('triggersOn values are sorted and deduplicated per skill', () => {
	for (const entry of first.skills) {
		assert.ok(Array.isArray(entry.triggersOn), `triggersOn should be array for ${entry.skill}`);
		const sorted = [...entry.triggersOn].sort((a, b) => a.localeCompare(b));
		assert.deepStrictEqual(entry.triggersOn, sorted, `triggersOn not sorted for ${entry.skill}`);
		const uniqueCount = new Set(entry.triggersOn).size;
		assert.strictEqual(uniqueCount, entry.triggersOn.length, `triggersOn not deduplicated for ${entry.skill}`);
	}
});

test('manifest metadata is present when attached and has deterministic fields', () => {
	for (const entry of first.skills) {
		if (!entry.manifest) continue;
		assert.ok(typeof entry.manifest.id === 'string' && entry.manifest.id.length > 0, `manifest.id missing for ${entry.skill}`);
		assert.ok(typeof entry.manifest.loadMode === 'string' && entry.manifest.loadMode.length > 0, `manifest.loadMode missing for ${entry.skill}`);
	}
});

test('output is deterministic across repeated generation', () => {
	assert.strictEqual(firstRaw, secondRaw, 'raw JSON output changed between runs');
	assert.deepStrictEqual(first, second, 'parsed JSON changed between runs');
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
