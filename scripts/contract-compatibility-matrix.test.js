#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const repoRoot = path.resolve(__dirname, '..');
const matrixPath = path.join(repoRoot, 'contracts', 'session-state', 'compatibility-matrix.json');
const contractManifestPath = path.join(repoRoot, 'contracts', 'session-state', 'contract-manifest.json');
const compatibilityManifestPath = path.join(repoRoot, 'contracts', 'session-state', 'compatibility-manifest.json');
const rootPackagePath = path.join(repoRoot, 'package.json');

function isWithinRange(versionText, rangeText) {
	if (typeof rangeText !== 'string' || !rangeText.trim()) {
		return false;
	}
	return semver.satisfies(versionText, rangeText, { includePrerelease: true });
}

function loadJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

test('current elegy-copilot/contracts tuple is supported by the matrix', () => {
	const matrix = loadJson(matrixPath);
	const manifest = loadJson(contractManifestPath);
	const rootPackage = loadJson(rootPackagePath);
	const canonicalSchema = Array.isArray(manifest.schemas)
		? manifest.schemas.find((entry) => entry && entry.name === 'canonical-workflow')
		: null;

	const instructionEngineVersion = rootPackage.version;
	const contractBundleVersion = manifest.package.version;
	const contractSchemaVersion = canonicalSchema && canonicalSchema.schemaVersion;

	assert.ok(Array.isArray(matrix.entries), 'matrix.entries must be an array');
	assert.ok(matrix.entries.length > 0, 'matrix.entries must not be empty');
	assert.strictEqual(typeof contractSchemaVersion, 'string', 'canonical schema version must be declared');

	const supported = matrix.entries.some((entry) => {
		if (!entry.instructionEngineVersionRange || !entry.contractPackageVersionRange || !entry.contractSchemaVersionRange) {
			return false;
		}

		return (
			isWithinRange(instructionEngineVersion, entry.instructionEngineVersionRange) &&
			isWithinRange(contractBundleVersion, entry.contractPackageVersionRange) &&
			isWithinRange(contractSchemaVersion, entry.contractSchemaVersionRange)
		);
	});

	assert.strictEqual(
		supported,
		true,
		`Unsupported tuple: elegy-copilot=${instructionEngineVersion}, contracts=${contractBundleVersion}`
	);
});

test('out-of-range tuple is rejected by matrix matcher', () => {
	const matrix = loadJson(matrixPath);
	const unsupported = matrix.entries.some((entry) => {
		return (
			isWithinRange('9.9.9', entry.instructionEngineVersionRange) &&
			isWithinRange('9.9.9', entry.contractPackageVersionRange)
		);
	});
	assert.strictEqual(unsupported, false);
});

test('legacy compatibility metadata redirects to the canonical contract manifest', () => {
	const contractManifest = loadJson(contractManifestPath);
	const compatibilityManifest = loadJson(compatibilityManifestPath);
	const canonicalSchema = contractManifest.schemas.find((entry) => entry.name === 'canonical-workflow');

	assert.strictEqual(compatibilityManifest.metadataKind, 'legacy-compatibility');
	assert.strictEqual(compatibilityManifest.contractManifestFile, path.basename(contractManifestPath));
	assert.strictEqual(Array.isArray(compatibilityManifest.schemas), false);
	assert.strictEqual(compatibilityManifest.package.version, contractManifest.package.version);
	assert.deepStrictEqual(compatibilityManifest.canonicalSchema, {
		name: canonicalSchema.name,
		schemaVersion: canonicalSchema.schemaVersion,
		file: canonicalSchema.file,
	});
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
