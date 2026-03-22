#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;

const repoRoot = path.resolve(__dirname, '..');
const contractsDir = path.join(repoRoot, 'contracts', 'session-state');
const contractManifestPath = path.join(contractsDir, 'contract-manifest.json');
const compatibilityManifestPath = path.join(contractsDir, 'compatibility-manifest.json');

const requiredSchemas = [
	'agent-definition.schema.json',
	'skill-definition.schema.json',
	'dynamic-skill-activation.schema.json',
	'monitoring-event.schema.json',
	'skill-forge-request.schema.json',
	'agent-create-request.schema.json',
	'skill-discovery-index.schema.json',
	'mcp-tool-definition.schema.json',
];

let hasFailures = false;

function fail(message) {
	console.error(`agentic-schemas invalid: ${message}`);
	hasFailures = true;
}

function readJson(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (error) {
		fail(`failed to parse JSON ${path.relative(repoRoot, filePath)}: ${error.message}`);
		return null;
	}
}

function formatAjvErrors(errors) {
	if (!Array.isArray(errors) || errors.length === 0) {
		return 'unknown validation error';
	}

	return errors
		.slice(0, 5)
		.map((error) => {
			const at = error.instancePath || '/';
			return `${at} ${error.message}`;
		})
		.join('; ');
}

if (!fs.existsSync(contractsDir) || !fs.statSync(contractsDir).isDirectory()) {
	fail(`missing contracts directory: ${path.relative(repoRoot, contractsDir)}`);
}

const manifest = readJson(contractManifestPath);
const compatibilityManifest = readJson(compatibilityManifestPath);
const manifestSchemaFiles = new Set(
	Array.isArray(manifest?.schemas)
		? manifest.schemas.map((entry) => String(entry?.file || '')).filter(Boolean)
		: []
);

const manifestFixtures = new Set();
if (Array.isArray(manifest?.schemas)) {
	for (const entry of manifest.schemas) {
		if (!Array.isArray(entry?.fixtures)) {
			continue;
		}
		for (const fixture of entry.fixtures) {
			const fixturePath = String(fixture || '');
			if (fixturePath) {
				manifestFixtures.add(fixturePath);
			}
		}
	}
}

for (const schemaFile of requiredSchemas) {
	const schemaPath = path.join(contractsDir, schemaFile);
	if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile()) {
		fail(`missing schema file: ${path.relative(repoRoot, schemaPath)}`);
		continue;
	}

	readJson(schemaPath);

	if (!manifestSchemaFiles.has(schemaFile)) {
		fail(`contract-manifest missing schema entry for: ${schemaFile}`);
	}
}

if (compatibilityManifest) {
	const canonicalSchema = Array.isArray(manifest?.schemas)
		? manifest.schemas.find((entry) => entry?.name === 'canonical-workflow')
		: null;

	if (compatibilityManifest.metadataKind !== 'legacy-compatibility') {
		fail('compatibility-manifest metadataKind must be legacy-compatibility');
	}
	if (compatibilityManifest.contractManifestFile !== path.basename(contractManifestPath)) {
		fail('compatibility-manifest must point to contract-manifest.json');
	}
	if (Array.isArray(compatibilityManifest.schemas)) {
		fail('compatibility-manifest must not embed schema listings');
	}
	if (compatibilityManifest.package?.version !== manifest?.package?.version) {
		fail('compatibility-manifest package version must match contract-manifest');
	}
	if (compatibilityManifest.package?.name !== manifest?.package?.name) {
		fail('compatibility-manifest package name must match contract-manifest');
	}
	if (canonicalSchema) {
		const compatibilityCanonical = compatibilityManifest.canonicalSchema || {};
		if (compatibilityCanonical.name !== canonicalSchema.name) {
			fail('compatibility-manifest canonical schema name must match contract-manifest');
		}
		if (compatibilityCanonical.schemaVersion !== canonicalSchema.schemaVersion) {
			fail('compatibility-manifest canonical schema version must match contract-manifest');
		}
		if (compatibilityCanonical.file !== canonicalSchema.file) {
			fail('compatibility-manifest canonical schema file must match contract-manifest');
		}
	}
}

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validatorsBySchemaFile = new Map();

if (Array.isArray(manifest?.schemas)) {
	for (const entry of manifest.schemas) {
		const schemaFile = String(entry?.file || '');
		if (!schemaFile) {
			continue;
		}

		const schemaPath = path.join(contractsDir, schemaFile);
		if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile()) {
			continue;
		}

		const schemaJson = readJson(schemaPath);
		if (!schemaJson) {
			continue;
		}

		try {
			validatorsBySchemaFile.set(schemaFile, ajv.compile(schemaJson));
		} catch (error) {
			fail(`failed to compile schema ${schemaFile}: ${error.message}`);
		}
	}
}

for (const fixtureRelPath of manifestFixtures) {
	const fixturePath = path.join(contractsDir, fixtureRelPath);
	if (!fs.existsSync(fixturePath) || !fs.statSync(fixturePath).isFile()) {
		fail(`missing fixture file: ${path.relative(repoRoot, fixturePath)}`);
		continue;
	}

	const fixtureJson = readJson(fixturePath);
	if (!fixtureJson) {
		continue;
	}

	const schemaFile = String(
		manifest.schemas.find((entry) => Array.isArray(entry?.fixtures) && entry.fixtures.includes(fixtureRelPath))?.file || ''
	);
	if (!schemaFile) {
		fail(`unable to resolve owning schema for fixture: ${fixtureRelPath}`);
		continue;
	}

	const validate = validatorsBySchemaFile.get(schemaFile);
	if (!validate) {
		fail(`missing compiled validator for schema '${schemaFile}' (fixture: ${fixtureRelPath})`);
		continue;
	}

	const isValid = validate(fixtureJson);
	if (!isValid) {
		fail(`fixture '${fixtureRelPath}' does not match schema '${schemaFile}': ${formatAjvErrors(validate.errors)}`);
	}
}

if (hasFailures) {
	process.exit(1);
}

console.log(`agentic schemas ok (${requiredSchemas.length} schemas)`);
