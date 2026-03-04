#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const defaultSource = path.resolve(repoRoot, '..', 'Elegy', 'artifacts', 'contracts');
const sourceDir = path.resolve(process.argv[2] || process.env.ELEGY_CONTRACTS_SOURCE || defaultSource);
const destinationDir = path.resolve(process.env.ELEGY_CONTRACTS_DEST || path.join(repoRoot, 'contracts', 'elegy'));

const requiredFiles = [
	'compatibility-manifest.json',
	'compatibility-matrix.json',
	'canonical-workflow.schema.json',
];

function fail(message) {
	console.error(`elegy-contract-sync failed: ${message}`);
	process.exit(1);
}

if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
	fail(`source directory not found: ${sourceDir}`);
}

for (const file of requiredFiles) {
	const filePath = path.join(sourceDir, file);
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		fail(`required file missing in source: ${file}`);
	}
}

fs.rmSync(destinationDir, { recursive: true, force: true });
fs.mkdirSync(destinationDir, { recursive: true });

for (const file of requiredFiles) {
	fs.copyFileSync(path.join(sourceDir, file), path.join(destinationDir, file));
}

const fixtureSource = path.join(sourceDir, 'fixtures');
if (fs.existsSync(fixtureSource) && fs.statSync(fixtureSource).isDirectory()) {
	fs.cpSync(fixtureSource, path.join(destinationDir, 'fixtures'), { recursive: true });
}

const copiedFiles = [];
for (const file of requiredFiles) {
	copiedFiles.push(path.relative(repoRoot, path.join(destinationDir, file)).replace(/\\/g, '/'));
}
if (fs.existsSync(path.join(destinationDir, 'fixtures'))) {
	copiedFiles.push(path.relative(repoRoot, path.join(destinationDir, 'fixtures')).replace(/\\/g, '/') + '/');
}

console.log(`Elegy contracts synced`);
console.log(`  source: ${sourceDir}`);
console.log(`  destination: ${destinationDir}`);
for (const file of copiedFiles) {
	console.log(`  - ${file}`);
}
