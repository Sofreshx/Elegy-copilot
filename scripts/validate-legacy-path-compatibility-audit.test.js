#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	gateName,
	runAudit,
} = require('./validate-legacy-path-compatibility-audit.js');

let passed = 0;
function test(name, fn) {
	try {
		fn();
		passed += 1;
		console.log(`  PASS: ${name}`);
	} catch (error) {
		console.error(`  FAIL: ${name}`);
		console.error(`    ${error.message}`);
		process.exitCode = 1;
	}
}

test('legacy-path compatibility audit passes on current repository state', () => {
	const result = runAudit();
	assert.deepStrictEqual(result.findings, [], `${gateName} should pass: ${JSON.stringify(result.findings)}`);
});

test('legacy-path compatibility audit rejects unguarded legacy defaults', () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-session-legacy-path-audit-'));
	try {
		const samplePath = path.join(tempRoot, 'legacy-defaults.md');
		fs.writeFileSync(
			samplePath,
			[
				'# Legacy defaults',
				'Use `.instructions/tasks/` for active work items.',
				'Write reports to `.instructions-output/e2e/`.',
				'Read project config from `.instructions/e2e.config.md`.',
				'Add follow-up work to `raw.tasks.md`.',
				'Check `../../warnings.md` for known issues.',
				'Use `../../contexts/project.patterns.md` for target conventions.',
			].join('\n'),
			'utf8'
		);

		const result = runAudit({
			targetFiles: [
				{
					relativePath: 'temp/legacy-defaults.md',
					filePath: samplePath,
				},
			],
		});

		assert.ok(result.findings.length >= 6, 'expected multiple unguarded legacy-path findings');
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /\.instructions-output/);
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /\.instructions\/e2e\.config\.md/);
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /raw\.tasks\.md/);
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /warnings\.md/);
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /contexts\/project\.patterns\.md/);
		assert.match(result.findings.map((finding) => finding.label).join('\n'), /\.instructions/);
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