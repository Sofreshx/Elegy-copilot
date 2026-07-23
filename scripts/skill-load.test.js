#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'skill-load.mjs');

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

function run(...args) {
	return childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: repoRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
}

// --- Tests ---

test('loads repo-quality-setup SKILL.md content', () => {
	const result = run('repo-quality-setup');
	assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('repository-owned'), 'expected repository quality skill content');
	assert.ok(result.stdout.includes('---'), 'expected YAML frontmatter');
});

test('loads core-guardrails SKILL.md content', () => {
	const result = run('core-guardrails');
	assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('guardrails'), 'expected guardrails content');
});

test('path traversal with .. fails with exit 1', () => {
	const result = run('../../../etc/passwd');
	assert.strictEqual(result.status, 1, 'expected exit code 1 for path traversal');
	assert.ok(result.stderr.includes('traversal'), `expected traversal error, got: ${result.stderr}`);
});

test('path traversal with . fails with exit 1', () => {
	const result = run('./core-guardrails');
	assert.strictEqual(result.status, 1, 'expected exit code 1 for . traversal');
	assert.ok(result.stderr.includes('traversal'), `expected traversal error, got: ${result.stderr}`);
});

test('nonexistent skill fails with exit 1', () => {
	const result = run('nonexistent-skill-zzz');
	assert.strictEqual(result.status, 1, 'expected exit code 1 for missing skill');
	assert.ok(result.stderr.includes('not found'), `expected not found error, got: ${result.stderr}`);
});

test('no arguments shows usage and fails', () => {
	const result = run();
	assert.strictEqual(result.status, 1, 'expected exit code 1 for no args');
	assert.ok(result.stderr.includes('Usage'), `expected usage message, got: ${result.stderr}`);
});

test('skill name with backslash traversal fails', () => {
	const result = run('..\\..\\etc\\passwd');
	assert.strictEqual(result.status, 1, 'expected exit code 1 for backslash traversal');
});

console.log(`\nskill-load tests: ${passed} passed`);
