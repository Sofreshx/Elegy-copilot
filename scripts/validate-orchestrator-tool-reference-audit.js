#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gateName = 'Orchestrator Tool Reference Audit';
const historicalMarker = 'Historical prototype note:';
const baselineMarker = 'The shipped baseline uses interactive';
const targetFiles = [
	{
		filePath: path.join(repoRoot, 'catalog-assets', 'instructions', 'agent-session-defaults.md'),
		displayPath: 'catalog-assets/instructions/agent-session-defaults.md',
		forbiddenSubstrings: ['Seamless Agent', 'planReview', 'askUser', 'walkthroughReview', 'approvePlan'],
		requiredSubstrings: [],
	},
];

function stripFrontmatter(content) {
	if (!content.startsWith('---')) {
		return content;
	}

	const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return match ? content.slice(match[0].length) : content;
}

function auditFile(target) {
	const content = stripFrontmatter(fs.readFileSync(target.filePath, 'utf8'));
	const errors = [];

	for (const required of target.requiredSubstrings || []) {
		if (!content.includes(required)) {
			errors.push(`${target.displayPath} is missing required historical framing: ${required}`);
		}
	}

	for (const forbidden of target.forbiddenSubstrings || []) {
		if (content.includes(forbidden)) {
			errors.push(`${target.displayPath} still contains stale tool guidance: ${forbidden}`);
		}
	}

	return errors;
}

function runAudit(options = {}) {
	const files = options.targetFiles || targetFiles;
	const errors = [];

	for (const target of files) {
		try {
			errors.push(...auditFile(target));
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
	historicalMarker,
	baselineMarker,
	stripFrontmatter,
	runAudit,
};
