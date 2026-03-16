#!/usr/bin/env node
'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLANNING_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack-planning.js');
const FULL_VALIDATOR_PATH = path.resolve(__dirname, 'validate-planpack.js');

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

function withTempPlanFile(content, fn) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-planpack-planning-test-'));
	const filePath = path.join(dir, 'plan.md');
	try {
		fs.writeFileSync(filePath, content, 'utf8');
		fn(filePath);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function runValidator(validatorPath, filePath, args = []) {
	return childProcess.spawnSync(process.execPath, [validatorPath, filePath, ...args], {
		encoding: 'utf8',
		stdio: 'pipe',
	});
}

function buildPlanningPlanPack({ omitNextUnit = false, omitStatusTable = false, graphRow } = {}) {
	return `# Plan Pack — Planning Validation Test
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Validate planning-only planpack structure.
- Success Criteria:
  - Planning validator accepts a structurally valid pre-execution plan.

## Context Loaded (exact files)
- scripts/validate-planpack-planning.js

## Assumptions + Constraints
- Keep planning validation deterministic.

## Decisions (with rationale)
- Validate fresh plans without execution evidence.

## Dropped / Deferred
- None.

## Work Unit Groups
| Group | Title | Depends On | Parallel Notes |
| --- | --- | --- | --- |
| G-01-foundation | Foundation |  | serial |

## Work Unit Graph
| Group | Work Unit ID | Title | Depends On | Next Units | Parallel Safe |
| --- | --- | --- | --- | --- | --- |
${graphRow || '| G-01-foundation | WU-001 | Establish planning validation | [] | [] | no |'}

## Work Unit Index
| Group | Work Unit ID | Title | Spec Heading |
| --- | --- | --- | --- |
| G-01-foundation | WU-001 | Establish planning validation | ### WU-001 — Establish planning validation |

## Work Unit Specs

### WU-001 — Establish planning validation

#### Context
- Ensure fresh approved plans can validate before execution evidence exists.

#### Acceptance Criteria
- Planning validation passes without stream evidence.
- Planning validation still enforces base tracker sections.

#### Plan / Approach
- Add planning-only validation entrypoint in scripts/validate-planpack-planning.js.

#### Validation
- node scripts/validate-planpack-planning.js <planpack> --ac-enforcement fail

## Execution Notes
- Progress tracker starts with base planning sections only.

## Risks / Rollback
- Risk: full validator still rejects fresh plans by design.

## Validation
- node scripts/validate-planpack-planning.js <planpack> --ac-enforcement fail

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Session Metadata
- Session ID: 20260306_000000_PLAN
- Date: 2026-03-06
- Owner: test

## Work Unit Groups Overview
| Group | Title | Status | Depends On |
| --- | --- | --- | --- |
| G-01 | Foundation | not-started | — |

${omitStatusTable ? '' : `## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting to begin |

`}${omitNextUnit ? '' : `## Next Unit
**WU-001** — establish planning validation before execution begins

`}## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |

## Execution Log
- 2026-03-06T00:00:00Z — planning artifact created
`;
}

test('planning validator accepts a structurally valid pre-execution planpack without execution evidence sections', () => {
	const planContent = buildPlanningPlanPack();
	withTempPlanFile(planContent, (filePath) => {
		const planningResult = runValidator(PLANNING_VALIDATOR_PATH, filePath, ['--ac-enforcement', 'fail']);
		assert.strictEqual(planningResult.status, 0, `planning validator should pass, stderr: ${planningResult.stderr}`);

		const fullResult = runValidator(FULL_VALIDATOR_PATH, filePath);
		assert.notStrictEqual(fullResult.status, 0, 'full validator should still fail without execution evidence sections');
		assert.match(fullResult.stderr, /missing required stream evidence|missing required progress section: ## Final Gate Controls/i);
	});
});

test('planning validator still requires the base progress tracker next-unit section', () => {
	const planContent = buildPlanningPlanPack({ omitNextUnit: true });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(PLANNING_VALIDATOR_PATH, filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail when Next Unit is missing');
		assert.match(result.stderr, /missing required progress section: ## Next Unit section required/i);
	});
});

test('full validator still requires the base progress tracker next-unit section', () => {
	const planContent = buildPlanningPlanPack({ omitNextUnit: true });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(FULL_VALIDATOR_PATH, filePath);
		assert.notStrictEqual(result.status, 0, 'full validator should fail when Next Unit is missing');
		assert.match(result.stderr, /missing required progress section: ## Next Unit section required/i);
	});
});

test('planning validator still requires the base progress tracker status table', () => {
	const planContent = buildPlanningPlanPack({ omitStatusTable: true });
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(PLANNING_VALIDATOR_PATH, filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail when Work Unit Status Table is missing');
		assert.match(result.stderr, /missing required progress section: ## Work Unit Status Table section required \(markdown table required\)/i);
	});
});

test('planning validator rejects Work Unit Graph references to missing WU IDs', () => {
	const planContent = buildPlanningPlanPack({
		graphRow: '| G-01-foundation | WU-001 | Establish planning validation | ["WU-999"] | ["WU-998"] | no |',
	});
	withTempPlanFile(planContent, (filePath) => {
		const result = runValidator(PLANNING_VALIDATOR_PATH, filePath, ['--ac-enforcement', 'fail']);
		assert.notStrictEqual(result.status, 0, 'planning validator should fail on dangling Work Unit Graph references');
		assert.match(result.stderr, /WU-001 Work Unit Graph Depends On references missing WU-ID: WU-999/i);
		assert.match(result.stderr, /WU-001 Work Unit Graph Next Units references missing WU-ID: WU-998/i);
	});
});

if (!process.exitCode) {
	console.log(`\n  ${passed} passed\n`);
}
