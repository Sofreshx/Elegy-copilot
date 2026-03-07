#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, 'friction-emit.mjs');
const eventsDir = path.resolve(repoRoot, 'docs', 'issues', 'friction-events');

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

function cleanupEvents() {
	if (fs.existsSync(eventsDir)) {
		for (const f of fs.readdirSync(eventsDir)) {
			if (f.startsWith('friction-') && f.endsWith('.json')) {
				fs.unlinkSync(path.join(eventsDir, f));
			}
		}
	}
}

cleanupEvents();

// --- Tests ---

test('dry-run prints valid JSON event without writing', () => {
	const result = run(
		'--dry-run',
		'--title', 'Bad pattern',
		'--reason', 'Brittle coupling',
		'--importance', 'high',
		'--context', 'src/foo.cs',
	);
	assert.strictEqual(result.status, 0, `exit: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('[dry-run]'), 'expected dry-run marker');

	// Extract JSON from output (after the dry-run line)
	const jsonStart = result.stdout.indexOf('{');
	const json = result.stdout.substring(jsonStart);
	const event = JSON.parse(json);
	assert.strictEqual(event.category, 'friction');
	assert.strictEqual(event.severity, 'error');
	assert.strictEqual(event.message, 'Bad pattern');
	assert.strictEqual(event.metadata.reason, 'Brittle coupling');
});

test('emits friction event file', () => {
	cleanupEvents();
	const result = run(
		'--title', 'Test friction',
		'--reason', 'Test reason',
		'--importance', 'low',
		'--context', 'test/file.ts',
	);
	assert.strictEqual(result.status, 0, `exit: ${result.status}, stderr: ${result.stderr}`);
	assert.ok(result.stdout.includes('Emitted:'), 'expected Emitted message');

	// Check file was written
	const files = fs.readdirSync(eventsDir).filter((f) => f.startsWith('friction-') && f.endsWith('.json'));
	assert.ok(files.length > 0, 'expected at least one friction event file');

	const event = JSON.parse(fs.readFileSync(path.join(eventsDir, files[0]), 'utf8'));
	assert.strictEqual(event.category, 'friction');
	assert.strictEqual(event.severity, 'info');
	assert.strictEqual(event.entityKind, 'skill');
	assert.strictEqual(event.entityId, 'implementation-friction');

	cleanupEvents();
});

test('validates JSON against monitoring-event schema', () => {
	const result = run(
		'--dry-run',
		'--title', 'Schema test',
		'--reason', 'reason',
		'--importance', 'medium',
		'--context', 'ctx',
	);
	assert.strictEqual(result.status, 0);
	const jsonStart = result.stdout.indexOf('{');
	const event = JSON.parse(result.stdout.substring(jsonStart));

	// All required fields present
	assert.ok(event.eventId, 'eventId required');
	assert.ok(event.timestamp, 'timestamp required');
	assert.ok(event.entityKind, 'entityKind required');
	assert.ok(event.entityId, 'entityId required');
	assert.ok(event.category, 'category required');
	assert.ok(event.severity, 'severity required');
	assert.ok(event.message, 'message required');
});

test('rejects invalid importance value', () => {
	const result = run(
		'--title', 'Test',
		'--reason', 'reason',
		'--importance', 'extreme',
		'--context', 'ctx',
	);
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('Invalid importance'), `expected importance error, got: ${result.stderr}`);
});

test('rejects missing required fields', () => {
	const result = run('--title', 'Only title');
	assert.strictEqual(result.status, 1);
	assert.ok(result.stderr.includes('--reason'), `expected reason required, got: ${result.stderr}`);
	assert.ok(result.stderr.includes('--importance'), `expected importance required, got: ${result.stderr}`);
	assert.ok(result.stderr.includes('--context'), `expected context required, got: ${result.stderr}`);
});

test('includes cluster-id in metadata when provided', () => {
	const result = run(
		'--dry-run',
		'--title', 'Cluster test',
		'--reason', 'reason',
		'--importance', 'critical',
		'--context', 'ctx',
		'--cluster-id', 'CLU-001',
	);
	assert.strictEqual(result.status, 0);
	const jsonStart = result.stdout.indexOf('{');
	const event = JSON.parse(result.stdout.substring(jsonStart));
	assert.strictEqual(event.metadata.clusterId, 'CLU-001');
	assert.strictEqual(event.severity, 'critical');
});

test('severity mapping is correct', () => {
	const mappings = [
		['low', 'info'],
		['medium', 'warning'],
		['high', 'error'],
		['critical', 'critical'],
	];
	for (const [importance, severity] of mappings) {
		const result = run(
			'--dry-run',
			'--title', `Test ${importance}`,
			'--reason', 'r',
			'--importance', importance,
			'--context', 'c',
		);
		assert.strictEqual(result.status, 0, `failed for ${importance}`);
		const jsonStart = result.stdout.indexOf('{');
		const event = JSON.parse(result.stdout.substring(jsonStart));
		assert.strictEqual(event.severity, severity, `expected ${severity} for ${importance}`);
	}
});

cleanupEvents();
console.log(`\nfriction-emit tests: ${passed} passed`);
