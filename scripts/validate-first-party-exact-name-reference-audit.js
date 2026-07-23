#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gateName = 'First-Party Exact-Name Reference Audit';
const skillMetadataIndexPath = path.join(repoRoot, 'engine-assets', 'skills', 'skill-metadata-index.json');

const targetFiles = [
	{
		filePath: path.join(repoRoot, 'engine-assets', 'skills', 'skill-discovery', 'SKILL.md'),
		displayPath: 'engine-assets/skills/skill-discovery/SKILL.md',
		forbiddenSectionTitles: ['Compact skill reference index'],
		forbidDetectedSkillsTables: false,
		exactNameAllowlist: [],
	},
];

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stripFrontmatter(content) {
	if (!content.startsWith('---')) {
		return content;
	}

	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return match ? content.slice(match[0].length) : content;
}

function collectFirstPartySkillNames(index) {
	return new Set(
		Array.isArray(index?.entries)
			? index.entries
				.filter((entry) => entry && typeof entry === 'object' && entry.skill)
				.map((entry) => String(entry.skill).trim())
				.filter(Boolean)
			: []
	);
}

function extractInlineCodeTokens(content) {
	const tokens = [];
	const pattern = /`([^`\r\n]+)`/g;
	let match;

	while ((match = pattern.exec(content)) !== null) {
		tokens.push(match[1].trim());
	}

	return tokens;
}

function stripMarkdownCode(content) {
	return content
		.replace(/```[\s\S]*?```/g, '\n')
		.replace(/~~~[\s\S]*?~~~/g, '\n')
		.replace(/`[^`\r\n]+`/g, ' ');
}

function extractPlainTextExactNameReferences(content, firstPartySkillNames, allowlist = new Set()) {
	const prose = stripMarkdownCode(content);
	const matches = [];

	for (const skillName of Array.from(firstPartySkillNames).sort()) {
		if (allowlist.has(skillName)) {
			continue;
		}

		const pattern = new RegExp(
			`(^|[^A-Za-z0-9_./-])${escapeRegExp(skillName)}(?=$|[^A-Za-z0-9_./-])`,
			'm'
		);
		if (pattern.test(prose)) {
			matches.push(skillName);
		}
	}

	return matches;
}

function hasDetectedSkillsTable(content) {
	return content
		.split(/\r?\n/)
		.some((line) => line.trim().startsWith('|') && /\|\s*Detected Skills\s*\|/i.test(line));
}

function auditFile(target, firstPartySkillNames) {
	const content = stripFrontmatter(fs.readFileSync(target.filePath, 'utf8'));
	const errors = [];

	for (const title of target.forbiddenSectionTitles || []) {
		const titlePattern = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'mi');
		if (titlePattern.test(content)) {
			errors.push(`${target.displayPath} still contains forbidden section '${title}'.`);
		}
	}

	if (target.forbidDetectedSkillsTables && hasDetectedSkillsTable(content)) {
		errors.push(`${target.displayPath} still contains a 'Detected Skills' table header.`);
	}

	const allowlist = new Set(target.exactNameAllowlist || []);
	const exactReferences = Array.from(
		new Set(
			[
				...extractInlineCodeTokens(content).filter((token) => firstPartySkillNames.has(token) && !allowlist.has(token)),
				...extractPlainTextExactNameReferences(content, firstPartySkillNames, allowlist),
			]
		)
	).sort();

	if (exactReferences.length > 0) {
		errors.push(
			`${target.displayPath} still contains first-party exact-name references: ${exactReferences.join(', ')}`
		);
	}

	return errors;
}

function runAudit(options = {}) {
	const index = readJson(options.skillMetadataIndexPath || skillMetadataIndexPath);
	const firstPartySkillNames = collectFirstPartySkillNames(index);
	const files = options.targetFiles || targetFiles;
	const errors = [];

	for (const target of files) {
		try {
			errors.push(...auditFile(target, firstPartySkillNames));
		} catch (error) {
			errors.push(`${target.displayPath} could not be audited: ${error.message}`);
		}
	}

	return {
		gateName,
		errors,
	};
}

function main() {
	const result = runAudit();
	if (result.errors.length > 0) {
		for (const error of result.errors) {
			console.error(`${gateName} failed: ${error}`);
		}
		process.exit(1);
	}

	console.log(`${gateName} ok (${targetFiles.length} files)`);
}

if (require.main === module) {
	main();
}

module.exports = {
	gateName,
	stripFrontmatter,
	extractInlineCodeTokens,
	stripMarkdownCode,
	extractPlainTextExactNameReferences,
	hasDetectedSkillsTable,
	runAudit,
};
