#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'skill-search.mjs');

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
	const result = childProcess.spawnSync(process.execPath, [scriptPath, '--no-telemetry', ...args], {
		cwd: repoRoot,
		stdio: 'pipe',
		encoding: 'utf8',
	});
	return result;
}

// --- Tests ---

test('empty query returns all entries (human format)', () => {
	const result = run();
	assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
	const lines = result.stdout.trim().split('\n').filter(Boolean);
	assert.ok(lines.length > 0, 'expected at least one result');
});

test('empty query with --json returns all entries as JSON array', () => {
	const result = run('--json');
	assert.strictEqual(result.status, 0, `exit code: ${result.status}, stderr: ${result.stderr}`);
	const parsed = JSON.parse(result.stdout);
	assert.ok(Array.isArray(parsed), 'expected JSON array');
	assert.ok(parsed.length > 0, 'expected at least one result');
	assert.ok(parsed[0].name, 'expected name field');
	assert.ok(parsed[0].vaultRef, 'expected vaultRef field');
	assert.ok(Array.isArray(parsed[0].explanations), 'expected explanations array');
});

test('search "commit" returns the repository commit-check capabilities', () => {
	const result = run('--json', 'commit');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	const names = parsed.map((r) => r.name);
	assert.ok(names.includes('commit-check-setup'), `expected commit-check-setup in results, got: ${names.join(', ')}`);
	assert.ok(names.includes('commit-validation-governance'), `expected commit-validation-governance in results, got: ${names.join(', ')}`);
});

test('search "documentation" returns documentation capabilities', () => {
	const result = run('--json', 'documentation');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected at least one documentation-related skill');
	const names = parsed.map((r) => r.name);
	assert.ok(names.includes('documentation-authoring'), `expected documentation-authoring, got: ${names.join(', ')}`);
});

test('non-matching query returns empty result with exit code 0', () => {
	const result = run('--json', 'zzz-nonexistent-skill-zzz');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(Array.isArray(parsed), 'expected JSON array');
	assert.strictEqual(parsed.length, 0, 'expected empty results');
});

test('results include vaultRef with SKILL.md path', () => {
	const result = run('--json', 'core-guardrails');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected at least one result');
	assert.ok(parsed[0].vaultRef.endsWith('/SKILL.md'), `expected vaultRef ending in /SKILL.md, got: ${parsed[0].vaultRef}`);
});

test('exact name match scores higher than trigger match', () => {
	const result = run('--json', 'security');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected at least one result');
	assert.strictEqual(parsed[0].name, 'security', 'exact match should be first');
	const nextScore = parsed[1] ? parsed[1].score : 0;
	assert.ok(parsed[0].score >= nextScore, 'exact match should rank first');
	assert.ok(parsed[0].reasons.includes('exact-name'), 'exact match should explain exact-name');
});

test('targeting flags influence ranking output', () => {
	const result = run('--json', '--prefer-load-mode', 'on-demand', 'commit');
	assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected targeting query to return at least one result');
	assert.ok(
		parsed[0].reasons.includes('load-mode'),
		'expected targeting-driven explanations',
	);
});

test('human format output contains skill name and vault path', () => {
	const result = run('agents-md-authoring');
	assert.strictEqual(result.status, 0);
	const output = result.stdout;
	assert.ok(output.includes('agents-md-authoring'), 'expected agents-md-authoring in output');
	assert.ok(output.includes('SKILL.md'), 'expected SKILL.md path in output');
});

console.log(`\nskill-search tests: ${passed} passed`);
