#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	gateName,
	historicalMarker,
	runAudit,
} = require('./validate-orchestrator-tool-reference-audit.js');

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

test('orchestrator tool reference audit passes on current repository state', () => {
	const result = runAudit();
	assert.deepStrictEqual(result.errors, [], `${gateName} should pass: ${result.errors.join('; ')}`);
});

test('historical orchestrator docs must keep explicit historical framing and remove stale current-tense guidance', () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-session-orchestrator-tool-audit-'));
	try {
		const designPath = path.join(tempRoot, 'design.md');

		fs.writeFileSync(
			designPath,
			[
				'---',
				'created: 2026-02-23',
				'updated: 2026-04-07',
				'category: system',
				'status: draft',
				'doc_kind: node',
				'id: temp-design',
				'summary: temp',
				'---',
				'',
				'# Temp Design',
				'',
				'Use `planReview` (Seamless Agent) or `askQuestions` to present ambiguities and get structured user input',
			].join('\n'),
			'utf8'
		);

		const result = runAudit({
			targetFiles: [
				{
					filePath: designPath,
					displayPath: 'temp/design.md',
					requiredSubstrings: [historicalMarker],
					forbiddenSubstrings: [
						'Use `planReview` (Seamless Agent) or `askQuestions` to present ambiguities and get structured user input',
					],
				},
			],
		});

		assert.strictEqual(result.errors.length, 2);
		assert.match(result.errors.join('\n'), /missing required historical framing/);
		assert.match(result.errors.join('\n'), /still contains stale tool guidance/);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

test('current orchestrator guidance rejects legacy Seamless tool names outright', () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-session-orchestrator-current-tool-audit-'));
	try {
		const userGuidePath = path.join(tempRoot, 'user-guide.md');

		fs.writeFileSync(
			userGuidePath,
			[
				'---',
				'created: 2026-02-23',
				'updated: 2026-04-07',
				'category: system',
				'status: current',
				'doc_kind: node',
				'id: temp-user-guide',
				'summary: temp',
				'---',
				'',
				'# Temp User Guide',
				'',
				'Use `planReview` before execution.',
			].join('\n'),
			'utf8'
		);

		const result = runAudit({
			targetFiles: [
				{
					filePath: userGuidePath,
					displayPath: 'temp/user-guide.md',
					requiredSubstrings: [],
					forbiddenSubstrings: ['planReview'],
				},
			],
		});

		assert.strictEqual(result.errors.length, 1);
		assert.match(result.errors[0], /still contains stale tool guidance/);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}
