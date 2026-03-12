#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { validateCanonicalDocumentPayload, loadCompatibilityManifest } = require('./elegy-contract-consumer');

const repoRoot = path.resolve(__dirname, '..');
const payloadPath = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(repoRoot, 'contracts', 'elegy', 'fixtures', 'canonical-workflow.minimal.json');

function readPayload(filePath) {
	let raw;
	try {
		raw = fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		throw new Error(`payload read failed at ${filePath}: ${error.message}`);
	}

	try {
		return JSON.parse(raw);
	} catch (error) {
		throw new Error(`payload JSON parse failed at ${filePath}: ${error.message}`);
	}
}

try {
	const payload = readPayload(payloadPath);
	const { manifest } = loadCompatibilityManifest();
	const result = validateCanonicalDocumentPayload(payload);

	if (!result.valid) {
		console.error('Canonical payload validation failed');
		console.error(`  payload: ${payloadPath}`);
		for (const error of result.errors) {
			console.error(`  - ${error.instancePath}: ${error.message}`);
		}
		process.exit(1);
	}

	console.log('Canonical payload validation passed');
	console.log(`  payload: ${payloadPath}`);
	console.log(`  manifest: ${manifest.package.name}@${manifest.package.version}`);
} catch (error) {
	console.error(error.message || String(error));
	process.exit(1);
}
