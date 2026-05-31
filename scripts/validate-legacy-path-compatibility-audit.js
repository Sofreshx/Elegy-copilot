#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const gateName = 'Legacy-Path Compatibility Audit';

const targetFiles = [
	'engine-assets/skills/security/SKILL.md',
].map((relativePath) => ({
	relativePath,
	filePath: path.join(repoRoot, relativePath),
}));

const legacyTokenSpecs = [
	{ label: '.instructions-output', pattern: /\.instructions-output(?:\/|\b)/i },
	{ label: '.instructions/e2e.config.md', pattern: /\.instructions\/e2e\.config\.md\b/i },
	{ label: 'raw.tasks.md', pattern: /(?:\.instructions\/)?raw\.tasks\.md\b/i },
	{ label: 'warnings.md', pattern: /warnings\.md\b/i },
	{ label: 'contexts/project.patterns.md', pattern: /contexts\/project\.patterns\.md\b/i },
	{ label: '.instructions', pattern: /\.instructions(?:\/|\b)/i },
];

const compatibilityContextPattern = /\b(legacy|compatib(?:ility)?|opt(?:ed)?\s+in|opts?\s+into?|explicitly\s+requested|explicitly\s+opts?\s+in|do\s+not\s+assume)\b/i;

function readText(filePath) {
	return fs.readFileSync(filePath, 'utf8');
}

function normalizeTarget(target) {
	if (typeof target === 'string') {
		return {
			relativePath: target.split(path.sep).join('/'),
			filePath: path.join(repoRoot, target),
		};
	}

	return {
		relativePath: String(target.relativePath || '').split(path.sep).join('/'),
		filePath: String(target.filePath || ''),
	};
}

function collectLegacyFindings(target, tokenSpecs) {
	const content = readText(target.filePath);
	const lines = content.split(/\r?\n/);
	const findings = [];

	for (let index = 0; index < lines.length; index += 1) {
		const currentLine = lines[index];
		for (const tokenSpec of tokenSpecs) {
			if (!tokenSpec.pattern.test(currentLine)) {
				continue;
			}

			const context = [lines[index - 1] || '', currentLine, lines[index + 1] || ''].join(' ');
			if (compatibilityContextPattern.test(context)) {
				continue;
			}

			findings.push({
				relativePath: target.relativePath,
				lineNumber: index + 1,
				label: tokenSpec.label,
				line: currentLine.trim(),
			});
		}
	}

	return findings;
}

function runAudit(options = {}) {
	const files = (options.targetFiles || targetFiles).map(normalizeTarget);
	const tokenSpecs = options.legacyTokenSpecs || legacyTokenSpecs;
	const findings = [];

	for (const target of files) {
		try {
			findings.push(...collectLegacyFindings(target, tokenSpecs));
		} catch (error) {
			findings.push({
				relativePath: target.relativePath,
				lineNumber: 0,
				label: 'read-error',
				line: error.message,
			});
		}
	}

	return {
		gateName,
		scannedFiles: files.length,
		findings,
	};
}

function main() {
	const result = runAudit();
	if (result.findings.length > 0) {
		for (const finding of result.findings) {
			const location = finding.lineNumber > 0 ? `${finding.relativePath}:${finding.lineNumber}` : finding.relativePath;
			console.error(
				`${gateName} failed: ${location} uses legacy token '${finding.label}' without explicit compatibility wording (${finding.line})`
			);
		}
		process.exit(1);
	}

	console.log(`${gateName} ok (${result.scannedFiles} files)`);
}

if (require.main === module) {
	main();
}

module.exports = {
	gateName,
	legacyTokenSpecs,
	runAudit,
};
