#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'engine-assets', 'manifest.json');
const sourceFiles = [
	path.join(repoRoot, 'engine-assets', 'skills', 'skill-discovery', 'SKILL.md'),
	path.join(repoRoot, 'engine-assets', 'skills', 'stack-detector', 'SKILL.md'),
];

const ignoredTokens = new Set(['skill-a', 'skill-b', 'skill-c', 'skill-name']);

let hasFailures = false;

function fail(message) {
	console.error(`skill-discovery-map invalid: ${message}`);
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

function readText(filePath) {
	try {
		return fs.readFileSync(filePath, 'utf8');
	} catch (error) {
		fail(`failed to read ${path.relative(repoRoot, filePath)}: ${error.message}`);
		return '';
	}
}

function collectOnDemandSkills(manifest) {
	const result = new Set();
	if (!manifest || !Array.isArray(manifest.assets)) {
		fail('engine-assets/manifest.json must contain an assets array');
		return result;
	}

	for (const asset of manifest.assets) {
		if (!asset || asset.type !== 'skill' || asset.loadMode !== 'on-demand') {
			continue;
		}

		const id = String(asset.id || '');
		const match = id.match(/^skill-([a-z0-9]+(?:-[a-z0-9]+)*)$/);
		if (!match) {
			fail(`on-demand skill asset id must match skill-<name>: ${id || '<empty>'}`);
			continue;
		}

		result.add(match[1]);
	}

	if (result.size === 0) {
		fail('no on-demand skills found in manifest');
	}

	return result;
}

function extractCodeTokens(value) {
	const result = new Set();
	const tokenPattern = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g;
	let match;
	while ((match = tokenPattern.exec(value)) !== null) {
		if (!ignoredTokens.has(match[1])) {
			result.add(match[1]);
		}
	}
	return result;
}

function extractSkillDiscoveryReferences(content) {
	const referenced = new Set();
	const lines = content.split(/\r?\n/);
	for (const line of lines) {
		if (!/(?:->|→)\s*`/.test(line)) {
			continue;
		}
		for (const token of extractCodeTokens(line)) {
			referenced.add(token);
		}
	}
	return referenced;
}

function parseTableCells(line) {
	return line
		.replace(/^\|/, '')
		.replace(/\|$/, '')
		.split('|')
		.map(cell => cell.trim());
}

function normalizeHeader(value) {
	return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractStackDetectorReferences(content) {
	const referenced = new Set();
	const lines = content.split(/\r?\n/);

	let detectedSkillsColumn = -1;
	let expectSeparator = false;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line.startsWith('|')) {
			detectedSkillsColumn = -1;
			expectSeparator = false;
			continue;
		}

		const cells = parseTableCells(line);
		if (detectedSkillsColumn === -1) {
			const normalizedHeaders = cells.map(normalizeHeader);
			detectedSkillsColumn = normalizedHeaders.indexOf('detectedskills');
			expectSeparator = detectedSkillsColumn !== -1;
			continue;
		}

		if (expectSeparator) {
			expectSeparator = false;
			continue;
		}

		const skillsCell = cells[detectedSkillsColumn] || '';
		for (const token of extractCodeTokens(skillsCell)) {
			referenced.add(token);
		}
	}

	return referenced;
}

function extractReferencedSkills(filePath, content) {
	const normalizedPath = filePath.split(path.sep).join('/');
	if (normalizedPath.endsWith('engine-assets/skills/skill-discovery/SKILL.md')) {
		return extractSkillDiscoveryReferences(content);
	}
	if (normalizedPath.endsWith('engine-assets/skills/stack-detector/SKILL.md')) {
		return extractStackDetectorReferences(content);
	}
	return extractCodeTokens(content);
}

function formatList(values) {
	return values.map(value => `- ${value}`).join('\n');
}

const manifest = readJson(manifestPath);
const onDemandSkills = collectOnDemandSkills(manifest);

const referencedBySource = new Map();
const allReferencedSkills = new Set();

for (const filePath of sourceFiles) {
	const content = readText(filePath);
	const referenced = extractReferencedSkills(filePath, content);
	referencedBySource.set(filePath, referenced);
	for (const skill of referenced) {
		allReferencedSkills.add(skill);
	}
}

const missing = Array.from(onDemandSkills).filter(skill => !allReferencedSkills.has(skill)).sort();
if (missing.length > 0) {
	fail('on-demand skills missing from skill-discovery/stack-detector references:\n' + formatList(missing));
}

for (const [filePath, referenced] of referencedBySource.entries()) {
	const stale = Array.from(referenced).filter(skill => !onDemandSkills.has(skill)).sort();
	if (stale.length > 0) {
		fail(`${path.relative(repoRoot, filePath)} references unknown on-demand skills:\n${formatList(stale)}`);
	}
}

if (hasFailures) {
	process.exit(1);
}

console.log(`skill-discovery map ok (on-demand=${onDemandSkills.size}, referenced=${allReferencedSkills.size}, sources=${sourceFiles.length})`);
