#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLANNING_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack-planning.js');

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
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planpack-parallel-safety-test-'));
	const filePath = path.join(dir, 'plan.md');
	try {
		fs.writeFileSync(filePath, content, 'utf8');
		fn(filePath);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function runValidator(filePath, args = []) {
	return childProcess.spawnSync(process.execPath, [PLANNING_VALIDATOR_PATH, filePath, ...args], {
		encoding: 'utf8',
		stdio: 'pipe',
	});
}

function buildPlanPack({
	parallelSafe = 'no',
	dependsOn = '[]',
	nextUnits = '[]',
	includeExpectedFiles = true,
	expectedFilesBody = '- scripts/validate-planpack.js (modify)',
} = {}) {
	const expectedFilesSection = includeExpectedFiles
		? `#### Expected Files (optional)\n${expectedFilesBody}\n\n`
		: '';

	return `# Plan Pack — Parallel Safety Validation Test
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Validate parallel-safe work-unit requirements.
- Success Criteria:
  - Planning validator enforces graph-level parallel-safety metadata.

## Context Loaded (exact files)
- scripts/validate-planpack.js

## Assumptions + Constraints
- Keep planning validation deterministic.

## Decisions (with rationale)
- Require explicit ownership declarations for parallel-safe WUs.

## Dropped / Deferred
- None.

## Work Unit Groups
| Group | Title | Depends On | Parallel Notes |
| --- | --- | --- | --- |
| G-01-foundation | Foundation |  | explicit only |

## Work Unit Graph
| Group | Work Unit ID | Title | Depends On | Next Units | Parallel Safe |
| --- | --- | --- | --- | --- | --- |
| G-01-foundation | WU-001 | Validate graph semantics | ${dependsOn} | ${nextUnits} | ${parallelSafe} |

## Work Unit Index
| Group | Work Unit ID | Title | Spec Heading |
| --- | --- | --- | --- |
| G-01-foundation | WU-001 | Validate graph semantics | ### WU-001 — Validate graph semantics |

## Work Unit Specs

### WU-001 — Validate graph semantics

#### Context
- Ensure parallel-safe metadata is machine-checkable.

#### Acceptance Criteria
- Planning validation passes on valid graph metadata.
- Planning validation fails on invalid graph metadata.

#### Plan / Approach
- Update the validator to parse the Work Unit Graph deterministically.

${expectedFilesSection}#### Validation
- node scripts/validate-planpack-planning.js <planpack> --ac-enforcement fail

## Execution Notes
- Planning artifact uses base progress tracker sections only.

## Risks / Rollback
- Risk: false positives for legacy plan formats.

## Validation
- node scripts/validate-planpack-planning.js <planpack> --ac-enforcement fail

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Session Metadata
- Session ID: 20260312_000000_PARALLEL
- Date: 2026-03-12
- Owner: test

## Work Unit Groups Overview
| Group | Title | Status | Depends On |
| --- | --- | --- | --- |
| G-01 | Foundation | not-started | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting to begin |

## Next Unit
**WU-001** — validate graph semantics

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |

## Execution Log
- 2026-03-12T00:00:00Z — planning artifact created
`;
}

test('planning validator rejects parallel-safe WUs that omit Expected Files', () => {
	const planContent = buildPlanPack({ parallelSafe: 'yes', includeExpectedFiles: false });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail when a parallel-safe WU omits Expected Files');
		assert.match(result.stderr, /Parallel Safe=yes must include subsection: #### Expected Files/i);
	});
});

test('planning validator rejects parallel-safe WUs with empty Expected Files bullets', () => {
	const planContent = buildPlanPack({ parallelSafe: 'yes', expectedFilesBody: 'scripts/validate-planpack.js (modify)' });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail when Expected Files lacks bullets');
		assert.match(result.stderr, /must list at least one expected file bullet/i);
	});
});

test('planning validator rejects invalid Work Unit Graph parallel-safe values', () => {
	const planContent = buildPlanPack({ parallelSafe: 'maybe' });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail invalid Parallel Safe values');
		assert.match(result.stderr, /Parallel Safe must be yes or no/i);
	});
});

test('planning validator rejects non-array dependency cells in the Work Unit Graph', () => {
	const planContent = buildPlanPack({ dependsOn: 'WU-000', nextUnits: '[]' });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail invalid dependency array cells');
		assert.match(result.stderr, /Depends On must be a JSON array/i);
	});
});

test('planning validator accepts valid parallel-safe graph metadata when ownership is declared', () => {
	const planContent = buildPlanPack({ parallelSafe: 'yes' });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(filePath, ['--ac-enforcement', 'fail']);
		assert.strictEqual(result.status, 0, `planning validator should pass, stderr: ${result.stderr}`);
		assert.match(result.stdout, /planpack ok \(1 work units\)/i);
	});
});

if (!process.exitCode) {
	console.log(`\n  ${passed} passed\n`);
}