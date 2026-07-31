#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack-planning.js');
const EXECUTION_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack-execution.js');
const DIRECT_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack.js');

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

function withTempPlanFile(content, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-plan-v2-test-'));
	const filePath = path.join(dir, 'plan.md');
	try {
		fs.writeFileSync(filePath, content, 'utf8');
		fn(filePath);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function runValidator(filePath, validatorPath = VALIDATOR_PATH) {
	return childProcess.spawnSync(process.execPath, [validatorPath, filePath, '--ac-enforcement', 'fail'], {
		encoding: 'utf8',
		stdio: 'pipe',
	});
}

function buildPlan({ tasks, acceptance = '- The planned behavior is observable and validated.', delivery = 'Create atomic commits and prepare a reviewable PR summary.' } = {}) {
	return `# Plan — Delegated work
<!-- IE_PLAN_VERSION: 2 -->

## Goal
Make planned work easy to execute safely with bounded agents.

## Acceptance Criteria
${acceptance}

## Approach
Keep the plan concise and let the main agent own integration.

## Work

${tasks}

## Delivery
${delivery}
`;
}

function task(id, {
	dependsOn = 'none',
	mode = 'write',
	parallel = 'no',
	delegate = '',
	scope = 'src/feature.ts',
	doneWhen = 'The requested behavior is implemented without unrelated changes.',
	validate = 'node --test test/feature.test.js',
	stopIf = '',
} = {}) {
	const lines = [
		`### ${id} — Implement bounded behavior`,
		`- Depends on: ${dependsOn}`,
		`- Mode: ${mode}`,
		`- Parallel: ${parallel}`,
	];
	if (delegate) lines.push(`- Can delegate: ${delegate}`);
	lines.push(`- Scope: ${scope}`);
	lines.push(`- Done when: ${doneWhen}`);
	lines.push(`- Validate: ${validate}`);
	if (stopIf) lines.push(`- Stop if: ${stopIf}`);
	return `${lines.join('\n')}\n`;
}

test('accepts a concise version-2 plan with a delegable parallel task', () => {
	const content = buildPlan({
		tasks: task('T-001', {
			mode: 'read',
			parallel: 'yes',
			delegate: 'explorer',
			scope: 'docs/system/ and relevant tests',
			validate: 'rg -n "acceptance" docs/system',
		}),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.strictEqual(result.status, 0, `expected valid plan, stderr: ${result.stderr}`);
		assert.match(result.stdout, /plan ok \(1 tasks\)/i);
	});
});

test('direct validator accepts v2 plan structure for documented compatibility', () => {
	const content = buildPlan({ tasks: task('T-001') });
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath, DIRECT_VALIDATOR_PATH);
		assert.strictEqual(result.status, 0, result.stderr);
	});
});

test('v2 heading without a version marker reports the v2 marker requirement', () => {
	const content = buildPlan({ tasks: task('T-001') }).replace('<!-- IE_PLAN_VERSION: 2 -->\n', '');
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /missing required version marker: <!-- IE_PLAN_VERSION: 2 -->/i);
		assert.doesNotMatch(result.stderr, /IE_PLAN_PACK_VERSION/);
	});
});

test('does not misclassify the legacy version marker as an unsupported v2 marker', () => {
	const legacy = `# Plan Pack — Legacy\n<!-- IE_PLAN_PACK_VERSION: 1 -->\n## Goal + Success Criteria\n- Goal: Preserve legacy parsing.\n- Success Criteria:\n  - Legacy plans still parse.\n`;
	withTempPlanFile(legacy, (filePath) => {
		const result = childProcess.spawnSync(process.execPath, [path.resolve(__dirname, 'validate-planpack-planning.js'), filePath], {
			encoding: 'utf8',
			stdio: 'pipe',
		});
		assert.notStrictEqual(result.status, 0);
		assert.doesNotMatch(result.stderr, /unsupported plan version/i);
	});
});

test('rejects a version-2 plan with a missing task dependency', () => {
	const content = buildPlan({ tasks: task('T-001', { dependsOn: 'T-999' }) });
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /references missing task: T-999/i);
	});
});

test('rejects overlapping parallel write scopes', () => {
	const content = buildPlan({
		tasks: [
			task('T-001', { parallel: 'yes', scope: 'src/features' }),
			task('T-002', { parallel: 'yes', scope: 'src/features/button.ts' }),
		].join('\n'),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /parallel write scope overlap/i);
	});
});

test('rejects overlapping parallel write scopes expressed as globs', () => {
	const content = buildPlan({
		tasks: [
			task('T-001', { parallel: 'yes', scope: '*' }),
			task('T-002', { parallel: 'yes', scope: 'src/features/button.ts' }),
		].join('\n'),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /parallel write scope overlap/i);
	});
});

test('rejects a delegation role that does not match the task mode', () => {
	const content = buildPlan({
		tasks: task('T-001', { mode: 'write', delegate: 'explorer' }),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /explorer delegation requires Mode=read/i);
	});
});

test('accepts sweeper delegation for a bounded write task', () => {
	const content = buildPlan({
		tasks: task('T-001', { mode: 'write', delegate: 'sweeper' }),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.strictEqual(result.status, 0, result.stderr);
	});
});

test('rejects cyclic task dependencies', () => {
	const content = buildPlan({
		tasks: [
			task('T-001', { dependsOn: 'T-002' }),
			task('T-002', { dependsOn: 'T-001' }),
		].join('\n'),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /task dependency cycle/i);
	});
});

test('rejects a task missing an execution contract field', () => {
	const content = buildPlan({
		tasks: task('T-001').replace('- Validate: node --test test/feature.test.js\n', ''),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /T-001 missing required field: validate/i);
	});
});

test('rejects a plan without a concrete goal', () => {
	const content = buildPlan({
		tasks: task('T-001'),
	});
	withTempPlanFile(content.replace('Make planned work easy to execute safely with bounded agents.', '-'), (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /Goal must describe the requested outcome/i);
	});
});

test('rejects vague top-level acceptance criteria', () => {
	const content = buildPlan({
		acceptance: '- It works as expected.',
		tasks: task('T-001'),
	});
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /acceptance criteria.*vague/i);
	});
});

test('rejects the unfilled documented plan template', () => {
	const content = buildPlan({
		acceptance: '- <observable, testable result>',
		delivery: '- Commit shape: <atomic commit boundary or "no commit requested">',
		tasks: task('T-001', {
			scope: '<path/or/topic>',
			doneWhen: '<concrete result>',
			validate: '<command or observable check>',
		}),
	})
		.replace('# Plan — Delegated work', '# Plan — <Title>')
		.replace('Make planned work easy to execute safely with bounded agents.', '- <one concise statement of the requested outcome>')
		.replace('### T-001 — Implement bounded behavior', '### T-001 — <task title>');
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /placeholder/i);
	});
});

test('execution validator fails closed for v2 until execution evidence is defined', () => {
	const content = buildPlan({ tasks: task('T-001') });
	withTempPlanFile(content, (filePath) => {
		const result = runValidator(filePath, EXECUTION_VALIDATOR_PATH);
		assert.notStrictEqual(result.status, 0);
		assert.match(result.stderr, /v2 execution validation is not defined/i);
	});
});

if (!process.exitCode) {
	console.log(`\n  ${passed} passed\n`);
}
