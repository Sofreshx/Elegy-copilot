#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..');
const gateName = 'Skill Metadata Parity Gate';
const committedIndexPath = path.join(repoRoot, 'engine-assets', 'skills', 'skill-metadata-index.json');
const generatorModulePath = path.join(__dirname, 'generate-skill-metadata-index.mjs');

let hasFailures = false;

function fail(message) {
	console.error(`${gateName} failed: ${message}`);
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

function stringifyJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function summarizeEntryDrift(committed, expected) {
	const committedEntries = new Map(
		Array.isArray(committed?.entries)
			? committed.entries
				.filter((entry) => entry && typeof entry === 'object')
				.map((entry) => [String(entry.skill || entry.name || '').trim(), entry])
			: []
	);
	const expectedEntries = new Map(
		Array.isArray(expected?.entries)
			? expected.entries
				.filter((entry) => entry && typeof entry === 'object')
				.map((entry) => [String(entry.skill || entry.name || '').trim(), entry])
			: []
	);

	const missing = [];
	const stale = [];
	const added = [];

	for (const [skill, expectedEntry] of expectedEntries.entries()) {
		if (!committedEntries.has(skill)) {
			missing.push(skill);
			continue;
		}
		const committedEntry = committedEntries.get(skill);
		if (stringifyJson(committedEntry) === stringifyJson(expectedEntry)) {
			continue;
		}
		stale.push(skill);
	}

	for (const skill of committedEntries.keys()) {
		if (!expectedEntries.has(skill)) {
			added.push(skill);
		}
	}

	const details = [];
	if (missing.length) {
		details.push(`missing entries: ${missing.sort().slice(0, 10).join(', ')}`);
	}
	if (stale.length) {
		details.push(`changed entries: ${stale.sort().slice(0, 10).join(', ')}`);
	}
	if (added.length) {
		details.push(`unexpected committed entries: ${added.sort().slice(0, 10).join(', ')}`);
	}

	return details.join('; ');
}

async function loadGeneratedIndex() {
	try {
		const module = await import(pathToFileURL(generatorModulePath).href);
		if (typeof module.generateIndex !== 'function') {
			throw new Error('generateIndex export is missing');
		}
		return module.generateIndex({ write: false });
	} catch (error) {
		fail(`failed to load metadata generator: ${error.message}`);
		return null;
	}
}

async function main() {
	const committedIndex = readJson(committedIndexPath);
	const expectedIndex = await loadGeneratedIndex();

	if (committedIndex && expectedIndex) {
		if (stringifyJson(committedIndex) !== stringifyJson(expectedIndex)) {
			const driftSummary = summarizeEntryDrift(committedIndex, expectedIndex);
			fail(
				[
					`${path.relative(repoRoot, committedIndexPath)} is stale relative to skill frontmatter and manifest metadata.`,
					driftSummary,
					`Regenerate with: node scripts/generate-skill-metadata-index.mjs`,
				]
					.filter(Boolean)
					.join(' ')
			);
		}
	}

	if (hasFailures) {
		process.exit(1);
	}

	console.log(`${gateName} ok (${path.relative(repoRoot, committedIndexPath)})`);
}

main().catch((error) => {
	fail(error.message || String(error));
	process.exit(1);
});
