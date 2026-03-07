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
	const result = childProcess.spawnSync(process.execPath, [scriptPath, ...args], {
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
});

test('search "wolverine" returns wolverine-core and wolverine-http', () => {
	const result = run('--json', 'wolverine');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	const names = parsed.map((r) => r.name);
	assert.ok(names.includes('wolverine-core'), `expected wolverine-core in results, got: ${names.join(', ')}`);
	assert.ok(names.includes('wolverine-http'), `expected wolverine-http in results, got: ${names.join(', ')}`);
});

test('search "auth" returns auth-related skills', () => {
	const result = run('--json', 'auth');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected at least one auth-related skill');
	const names = parsed.map((r) => r.name);
	assert.ok(names.includes('auth') || names.includes('firebase-auth'), `expected auth or firebase-auth, got: ${names.join(', ')}`);
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
	const result = run('--json', 'critic');
	assert.strictEqual(result.status, 0);
	const parsed = JSON.parse(result.stdout);
	assert.ok(parsed.length > 0, 'expected at least one result');
	assert.strictEqual(parsed[0].name, 'critic', 'exact match should be first');
	assert.strictEqual(parsed[0].score, 100, 'exact match should score 100');
});

test('human format output contains skill name and vault path', () => {
	const result = run('wolverine');
	assert.strictEqual(result.status, 0);
	const output = result.stdout;
	assert.ok(output.includes('wolverine-core'), 'expected wolverine-core in output');
	assert.ok(output.includes('SKILL.md'), 'expected SKILL.md path in output');
});

console.log(`\nskill-search tests: ${passed} passed`);
