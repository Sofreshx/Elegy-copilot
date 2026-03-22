#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	gateName,
	extractPlainTextExactNameReferences,
	runAudit,
} = require('./validate-first-party-exact-name-reference-audit.js');

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

test('first-party exact-name audit passes on current repository state', () => {
	const result = runAudit();
	assert.deepStrictEqual(result.errors, [], `${gateName} should pass: ${result.errors.join('; ')}`);
});

test('first-party exact-name audit rejects exhaustive exact-name patterns', () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-session-first-party-audit-'));
	try {
		const discoveryPath = path.join(tempRoot, 'skill-discovery.md');
		const stackDetectorPath = path.join(tempRoot, 'stack-detector.md');

		fs.writeFileSync(
			discoveryPath,
			[
				'# Skill Discovery',
				'',
				'## Compact skill reference index',
				'',
				'- Routing example -> `react-query`',
			].join('\n'),
			'utf8'
		);

		fs.writeFileSync(
			stackDetectorPath,
			[
				'# Stack Detector',
				'',
				'Prefer skill-discovery when tie-breaking remains ambiguous.',
				'',
				'| Package Pattern | Detected Skills |',
				'|-----------------|-----------------|',
				'| `react` | `frontend` |',
			].join('\n'),
			'utf8'
		);

		const result = runAudit({
			targetFiles: [
				{
					filePath: discoveryPath,
					displayPath: 'temp/skill-discovery.md',
					forbiddenSectionTitles: ['Compact skill reference index'],
					forbidDetectedSkillsTables: false,
					exactNameAllowlist: [],
				},
				{
					filePath: stackDetectorPath,
					displayPath: 'temp/stack-detector.md',
					forbiddenSectionTitles: [],
					forbidDetectedSkillsTables: true,
					exactNameAllowlist: [],
				},
			],
		});

		assert.ok(result.errors.length >= 3, 'expected multiple audit failures for exhaustive exact-name patterns');
		assert.match(result.errors.join('\n'), /Compact skill reference index/);
		assert.match(result.errors.join('\n'), /Detected Skills/);
		assert.match(result.errors.join('\n'), /react-query|frontend|skill-discovery/);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

test('plain prose exact-name detection catches first-party skill names outside inline code', () => {
	const matches = extractPlainTextExactNameReferences(
		[
			'Prefer skill-discovery for deterministic routing.',
			'Keep examples schematic instead of naming react-query directly.',
			'Allowlisted frontend references can stay when the file configuration permits them.',
			'Ignore `code-review` because inline code is handled elsewhere.',
		].join('\n'),
		new Set(['skill-discovery', 'react-query', 'frontend', 'code-review']),
		new Set(['frontend'])
	);

	assert.deepStrictEqual(matches, ['react-query', 'skill-discovery']);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
	console.error('Some tests FAILED');
} else {
	console.log('All tests passed');
}