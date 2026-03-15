'use strict';

const assert = require('assert');
const {
  PLANNING_PRECEDENCE_CONTRACT_VERSION,
  PLANNING_STATES,
  PLANNING_SCOPES,
  PLANNING_SCOPE_PRECEDENCE,
  PLANNING_RECORD_PRECEDENCE_RULES,
  TERMINAL_PLANNING_STATES,
  PLANNING_TRANSITION_MATRIX,
  normalizePlanningState,
  normalizePlanningScope,
  getPlanningScopePrecedence,
  isValidPlanningTransition,
  comparePlanningRecords,
  parseStructuredState,
} = require('./planState');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

test('exports planning state constants and transition matrix', () => {
  assert.deepStrictEqual(PLANNING_STATES, [
    'thought',
    'research',
    'pre-plan',
    'queued',
    'implemented',
    'merged',
    'superseded',
  ]);
  assert.deepStrictEqual(TERMINAL_PLANNING_STATES, ['merged', 'superseded']);
  assert.deepStrictEqual(PLANNING_SCOPES, ['user', 'repo', 'global']);
  assert.ok(Array.isArray(PLANNING_TRANSITION_MATRIX.thought));
});

test('valid transitions support forward path and branch to terminal states', () => {
  assert.strictEqual(isValidPlanningTransition('thought', 'research'), true);
  assert.strictEqual(isValidPlanningTransition('research', 'pre-plan'), true);
  assert.strictEqual(isValidPlanningTransition('pre-plan', 'queued'), true);
  assert.strictEqual(isValidPlanningTransition('queued', 'implemented'), true);
  assert.strictEqual(isValidPlanningTransition('implemented', 'merged'), true);
  assert.strictEqual(isValidPlanningTransition('thought', 'merged'), true);
  assert.strictEqual(isValidPlanningTransition('research', 'merged'), true);
  assert.strictEqual(isValidPlanningTransition('thought', 'superseded'), true);
  assert.strictEqual(isValidPlanningTransition('implemented', 'superseded'), true);
});

test('invalid transitions reject terminal exits and self transitions', () => {
  assert.strictEqual(isValidPlanningTransition('merged', 'implemented'), false);
  assert.strictEqual(isValidPlanningTransition('superseded', 'queued'), false);
  assert.strictEqual(isValidPlanningTransition('thought', 'thought'), false);
  assert.strictEqual(isValidPlanningTransition('research', 'queued'), false);
  assert.strictEqual(isValidPlanningTransition('unknown', 'queued'), false);
});

test('normalizePlanningState canonicalizes case and separators', () => {
  assert.strictEqual(normalizePlanningState(' Thought '), 'thought');
  assert.strictEqual(normalizePlanningState('PRE_PLAN'), 'pre-plan');
  assert.strictEqual(normalizePlanningState('pre plan'), 'pre-plan');
  assert.strictEqual(normalizePlanningState('preplan'), 'pre-plan');
  assert.strictEqual(normalizePlanningState(''), null);
  assert.strictEqual(normalizePlanningState('not-a-state'), null);
  assert.strictEqual(normalizePlanningState(null), null);
});

test('normalizePlanningScope accepts string and record input', () => {
  assert.strictEqual(normalizePlanningScope(' Repo '), 'repo');
  assert.strictEqual(normalizePlanningScope({ scope: 'GLOBAL' }), 'global');
  assert.strictEqual(normalizePlanningScope({ source: 'user' }), 'user');
  assert.strictEqual(normalizePlanningScope({ scope: 'invalid' }), '');
});

test('exports frozen planning precedence contract constants and helper', () => {
  assert.strictEqual(PLANNING_PRECEDENCE_CONTRACT_VERSION, '1');
  assert.deepStrictEqual(PLANNING_SCOPE_PRECEDENCE, {
    user: 3,
    repo: 2,
    global: 1,
  });
  assert.deepStrictEqual(PLANNING_RECORD_PRECEDENCE_RULES, [
    'scope-precedence:user>repo>global',
    'score-desc:null-invalid=-1',
    'updatedAt-desc:null-invalid=epoch',
    'createdAt-desc:null-invalid=epoch',
    'recordId-asc',
  ]);

  assert.strictEqual(getPlanningScopePrecedence({ scope: 'user' }), 3);
  assert.strictEqual(getPlanningScopePrecedence({ source: 'repo' }), 2);
  assert.strictEqual(getPlanningScopePrecedence('global'), 1);
  assert.strictEqual(getPlanningScopePrecedence({ scope: 'unknown' }), 0);
});

test('comparePlanningRecords sorts by precedence before score', () => {
  const records = [
    { recordId: 'g1', scope: 'global', score: 999, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { recordId: 'r1', scope: 'repo', score: 2, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
    { recordId: 'u1', scope: 'user', score: -10, updatedAt: '2026-01-02T00:00:00Z', createdAt: '2026-01-01T00:00:00Z' },
  ];

  records.sort(comparePlanningRecords);
  assert.deepStrictEqual(records.map((entry) => entry.recordId), ['u1', 'r1', 'g1']);
});

test('comparePlanningRecords handles null and NaN score plus null timestamps deterministically', () => {
  const records = [
    { recordId: 'b', scope: 'repo', score: null, updatedAt: null, createdAt: '2026-01-03T00:00:00Z' },
    { recordId: 'a', scope: 'repo', score: Number.NaN, updatedAt: null, createdAt: '2026-01-03T00:00:00Z' },
    { recordId: 'c', scope: 'repo', score: 0, updatedAt: null, createdAt: null },
    { recordId: 'd', scope: 'repo', score: 0, updatedAt: '2026-01-02T00:00:00Z', createdAt: null },
  ];

  records.sort(comparePlanningRecords);
  assert.deepStrictEqual(records.map((entry) => entry.recordId), ['d', 'c', 'a', 'b']);
});

test('comparePlanningRecords falls back to source when scope is absent', () => {
  const records = [
    { recordId: '2', source: 'repo', score: 1, updatedAt: null, createdAt: null },
    { recordId: '1', source: 'user', score: 1, updatedAt: null, createdAt: null },
  ];

  records.sort(comparePlanningRecords);
  assert.deepStrictEqual(records.map((entry) => entry.recordId), ['1', '2']);
});

test('parseStructuredState supports comma-separated parallel next-unit batches', () => {
  const text = `# Plan Pack — Parallel Resume Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Context Loaded
- file.md

## Assumptions + Constraints
- none

## Decisions
- none

## Dropped / Deferred
- none

## Work Unit Groups
- none

## Work Unit Graph
- none

## Work Unit Index
- none

## Work Unit Specs
- none

## Execution Notes
- none

## Risks / Rollback
- none

## Validation
- none

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Foundation | in-progress | 1 | 3 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002, WU-003 | ready for parallel-safe fan-out |

## Next Unit
**WU-002, WU-003** — parallel-safe sibling work units for G-01

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |

## Execution Log
- 2026-03-12T00:00:00Z — WU-001 completed (status: passed)
`;

  const structured = parseStructuredState(text);
  assert.ok(structured.nextUnit);
  assert.deepStrictEqual(structured.nextUnit.workUnitIds, ['WU-002', 'WU-003']);
  assert.strictEqual(structured.nextUnit.parallelCandidate, true);
});

test('parseStructuredState emits review-ledger and handoff warnings for blocked resume state', () => {
  const text = `# Plan Pack — Resume Blocked Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Context Loaded
- file.md

## Assumptions + Constraints
- none

## Decisions
- none

## Dropped / Deferred
- none

## Work Unit Groups
- none

## Work Unit Graph
- none

## Work Unit Index
- none

## Work Unit Specs
- none

## Execution Notes
- none

## Risks / Rollback
- none

## Validation
- none

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Foundation | not-started | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting |

## Next Unit
**WU-001** — waiting to begin

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |

## Execution Log
- 2026-03-12T00:00:00Z — planning artifact created
`;

  const structured = parseStructuredState(text, {
    handoffText: `## Handoff Manifest\n- Session: wrong-session\n- Plan: plan.md (status: DRAFT)\n`,
    requireHandoff: true,
    sessionId: 'expected-session',
  });

  assert.strictEqual(structured.meta.resume.ready, false);
  assert.ok(structured.meta.resume.blockers.includes('review_approval_missing'));
  assert.ok(structured.meta.resume.blockers.includes('handoff_invalid'));
  assert.ok(structured.warnings.some((warning) => warning.includes('Review Ledger: missing review ledger section')));
  assert.ok(structured.warnings.some((warning) => warning.includes('Handoff: handoff manifest Session mismatch')));
});

test('parseStructuredState marks resume ready when review ledger approval and handoff are valid', () => {
  const text = `# Plan Pack — Resume Ready Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Context Loaded
- file.md

## Assumptions + Constraints
- none

## Decisions
- none

## Dropped / Deferred
- none

## Work Unit Groups
- none

## Work Unit Graph
- none

## Work Unit Index
- none

## Work Unit Specs
- none

## Execution Notes
- none

## Risks / Rollback
- none

## Validation
- none

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-opus-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Foundation | in-progress | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting |

## Next Unit
**WU-001** — waiting to begin

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |

## Execution Log
- 2026-03-12T00:00:00Z — planning artifact created
`;

  const handoffText = `## Handoff Manifest
- Session: expected-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep execution sequential until explicit parallel-safe ownership exists.

## Exploration Summary
- engine-assets/agents/elegy-orchestrator.agent.md

## User Constraints
- none

## Immediate Next Actions
- Execute WU-001.

## Next Plan Ideas
- Consider broader resume-contract hardening later.

## Watch Outs
- Preserve expected-file ownership for parallel-safe work.

## Open Risks
- none
`;

  const structured = parseStructuredState(text, {
    handoffText,
    requireHandoff: true,
    sessionId: 'expected-session',
  });

  assert.strictEqual(structured.meta.reviewLedger.approved, true);
  assert.strictEqual(structured.meta.resume.ready, true);
  assert.deepStrictEqual(structured.meta.resume.blockers, []);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}