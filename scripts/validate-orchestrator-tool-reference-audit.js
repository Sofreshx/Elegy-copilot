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
		filePath: path.join(repoRoot, 'docs', 'system', 'orchestrator', 'user-guide.md'),
		displayPath: 'docs/system/orchestrator/user-guide.md',
		forbiddenSubstrings: ['Seamless Agent', 'planReview', 'askUser', 'walkthroughReview', 'approvePlan'],
		requiredSubstrings: [],
	},
	{
		filePath: path.join(repoRoot, 'docs', 'system', 'orchestrator', 'design.md'),
		displayPath: 'docs/system/orchestrator/design.md',
		forbiddenSubstrings: [
			'Use `planReview` (Seamless Agent) or `askQuestions` to present ambiguities and get structured user input',
			'For standard: use `planReview` (Seamless Agent) for inline feedback after the cross-model review pair converges',
			'For complex: use `planReview` after the cross-model review pair converges; add specialist overlays as needed',
			'Present summary to user via askUser:',
			'Present via askQuestions with "Stop — all done" option',
			'# User interaction (prefer Seamless Agent when available)',
			'### Seamless Agent Integration',
			'The orchestrator should prefer Seamless Agent tools over vscode/askQuestions when the extension is available:',
			'**Fallback**: If Seamless Agent tools are unavailable, use vscode/askQuestions for all scenarios.',
			'Recommended instruction for plan review:',
		],
		requiredSubstrings: [historicalMarker, baselineMarker],
	},
	{
		filePath: path.join(repoRoot, 'docs', 'system', 'orchestrator', 'plan.md'),
		displayPath: 'docs/system/orchestrator/plan.md',
		forbiddenSubstrings: [
			'  - Seamless Agent integration (with fallback)',
			'- Document the orchestrator\'s Seamless Agent integration',
			'- Seamless Agent setup (optional)',
			'- Seamless Agent extension (optional — graceful fallback to vscode/askQuestions)',
			'2. Seamless Agent extension may have stability issues → Mitigation: Always include fallback to vscode/askQuestions',
			'- [ ] Seamless Agent tools used when available, graceful fallback otherwise',
		],
		requiredSubstrings: [historicalMarker, baselineMarker],
	},
	{
		filePath: path.join(repoRoot, 'docs', 'system', 'orchestrator', 'research-analysis.md'),
		displayPath: 'docs/system/orchestrator/research-analysis.md',
		forbiddenSubstrings: [
			'### Seamless Agent (VS Code Extension) — 890 installs',
			'5. **Plan approval with structured feedback** — Seamless Agent\'s planReview is the gold standard',
			'- Uses Seamless Agent tools for rich user interaction',
		],
		requiredSubstrings: [
			'Historical research note: this document records pre-shipping analysis.',
			'Legacy Seamless Agent and legacy tool-name references below describe the research inputs at the',
		],
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
