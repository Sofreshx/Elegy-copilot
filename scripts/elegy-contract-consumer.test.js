#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
	loadCompatibilityManifest,
	validateCanonicalDocumentPayload,
} = require('./elegy-contract-consumer');

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

const repoRoot = path.resolve(__dirname, '..');
const sampleFixturePath = path.join(repoRoot, 'contracts', 'elegy', 'fixtures', 'canonical-workflow.minimal.json');

function readFixture() {
	return JSON.parse(fs.readFileSync(sampleFixturePath, 'utf8'));
}

test('loads Elegy compatibility manifest', () => {
	const loaded = loadCompatibilityManifest();
	assert.strictEqual(typeof loaded.manifest.manifestVersion, 'string');
	assert.ok(Array.isArray(loaded.manifest.schemas));
	assert.ok(loaded.manifest.schemas.some((entry) => entry.name === 'canonical-workflow'));
});

test('accepts canonical minimal fixture payload', () => {
	const payload = readFixture();
	const result = validateCanonicalDocumentPayload(payload);
	assert.strictEqual(result.valid, true);
	assert.deepStrictEqual(result.errors, []);
});

test('rejects invalid canonical payload', () => {
	const payload = readFixture();
	payload.steps = [];
	const result = validateCanonicalDocumentPayload(payload);
	assert.strictEqual(result.valid, false);
	assert.ok(result.errors.length > 0);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
