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
  parseExecutionState,
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
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

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

test('parseExecutionState normalizes additive execution overlays', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'executing',
    status: 'active',
    mode: 'replanned',
    summary: 'Working through the persisted execution overlay.',
    activeGroup: { groupId: 'G-01', title: 'Runtime Overlay', status: 'in-progress' },
    activeWorkUnit: { workUnitId: 'WU-002', title: 'Persist state', status: 'in-progress' },
    nextUnit: { workUnitId: 'WU-003', rationale: 'merge the UI overlay' },
    blockers: [{ label: 'Validation scope unresolved', details: 'Integration coverage stays out of scope.' }],
    replanCount: 1,
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
        ],
      },
    ],
  }));

  assert.deepStrictEqual(overlay.warnings, []);
  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.schemaVersion, 'execution-state-v1');
  assert.strictEqual(overlay.executionState.activeGroup.id, 'G-01');
  assert.strictEqual(overlay.executionState.activeWorkUnit.id, 'WU-002');
  assert.strictEqual(overlay.executionState.nextUnit.workUnitId, 'WU-003');
  assert.strictEqual(overlay.executionState.tree.length, 1);
  assert.strictEqual(overlay.executionState.tree[0].children.length, 2);
  assert.strictEqual(overlay.diagnostics.recovery.status, 'ready');
  assert.strictEqual(overlay.diagnostics.integrity.status, 'healthy');
  assert.strictEqual(overlay.diagnostics.queue.depth, 1);
});

test('parseExecutionState derives active refs and bounded queued follow-up work from the tree', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'executing',
    status: 'active',
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
          { workUnitId: 'WU-003', kind: 'work-unit', title: 'Render diagnostics', status: 'queued', next: true },
          { workUnitId: 'WU-004', kind: 'work-unit', title: 'Polish display', status: 'queued', next: true },
        ],
      },
    ],
  }));

  assert.deepStrictEqual(overlay.warnings, []);
  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.activeGroup.id, 'G-01');
  assert.strictEqual(overlay.executionState.activeWorkUnit.id, 'WU-002');
  assert.strictEqual(overlay.executionState.nextUnit.workUnitId, 'WU-003');
  assert.deepStrictEqual(overlay.executionState.nextUnit.workUnitIds, ['WU-003', 'WU-004']);
  assert.strictEqual(overlay.executionState.nextUnit.parallelCandidate, true);
  assert.strictEqual(overlay.diagnostics.recovery.status, 'ready');
  assert.strictEqual(overlay.diagnostics.recovery.resumable, true);
  assert.strictEqual(overlay.diagnostics.queue.depth, 2);
  assert.strictEqual(overlay.diagnostics.overlap.parallelCandidateCount, 2);
  assert.deepStrictEqual(overlay.diagnostics.overlap.boundedPreviewIds, ['WU-003', 'WU-004']);
});

test('parseExecutionState prefers normalized tree recovery over conflicting top-level refs', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'executing',
    status: 'active',
    activeGroup: { groupId: 'G-99', title: 'Stale group', status: 'queued' },
    activeWorkUnit: { workUnitId: 'WU-999', title: 'Stale work', status: 'queued' },
    nextUnit: { workUnitId: 'WU-998', rationale: 'Stale queued follow-up.' },
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
          { workUnitId: 'WU-003', kind: 'work-unit', title: 'Render diagnostics', status: 'queued', next: true },
          { workUnitId: 'WU-004', kind: 'work-unit', title: 'Polish display', status: 'queued', next: true },
          { workUnitId: 'WU-005', kind: 'work-unit', title: 'Document recovery', status: 'queued', next: true },
          { workUnitId: 'WU-006', kind: 'work-unit', title: 'Overflow preview', status: 'queued', next: true },
        ],
      },
    ],
  }));

  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.activeGroup.id, 'G-01');
  assert.strictEqual(overlay.executionState.activeWorkUnit.id, 'WU-002');
  assert.strictEqual(overlay.executionState.nextUnit.workUnitId, 'WU-003');
  assert.deepStrictEqual(overlay.executionState.nextUnit.workUnitIds, ['WU-003', 'WU-004', 'WU-005']);
  assert.ok(overlay.warnings.some((warning) => /activeGroup disagrees with normalized execution tree/i.test(warning)));
  assert.ok(overlay.warnings.some((warning) => /activeWorkUnit disagrees with normalized execution tree/i.test(warning)));
  assert.ok(overlay.warnings.some((warning) => /nextUnit disagrees with normalized execution tree/i.test(warning)));
  assert.ok(overlay.warnings.some((warning) => /derived nextUnit batch exceeded 3/i.test(warning)));
  assert.strictEqual(overlay.diagnostics.recovery.status, 'degraded');
  assert.strictEqual(overlay.diagnostics.recovery.resumable, true);
  assert.strictEqual(overlay.diagnostics.queue.depth, 3);
  assert.deepStrictEqual(overlay.diagnostics.queue.nextUnitIds, ['WU-003', 'WU-004', 'WU-005']);
});

test('parseExecutionState ignores out-of-branch next markers when deriving queued follow-up diagnostics', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'executing',
    status: 'active',
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
          { workUnitId: 'WU-003', kind: 'work-unit', title: 'Render diagnostics', status: 'queued', next: true },
          { workUnitId: 'WU-004', kind: 'work-unit', title: 'Polish display', status: 'queued', next: true },
        ],
      },
      {
        groupId: 'G-02',
        kind: 'group',
        title: 'Deferred Branch',
        status: 'queued',
        children: [
          { workUnitId: 'WU-101', kind: 'work-unit', title: 'Out-of-branch follow-up', status: 'queued', next: true },
        ],
      },
    ],
  }));

  assert.deepStrictEqual(overlay.warnings, []);
  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.nextUnit.workUnitId, 'WU-003');
  assert.deepStrictEqual(overlay.executionState.nextUnit.workUnitIds, ['WU-003', 'WU-004']);
  assert.strictEqual(overlay.diagnostics.queue.depth, 2);
  assert.deepStrictEqual(overlay.diagnostics.queue.nextUnitIds, ['WU-003', 'WU-004']);
  assert.strictEqual(overlay.diagnostics.overlap.parallelCandidateCount, 2);
  assert.deepStrictEqual(overlay.diagnostics.overlap.boundedPreviewIds, ['WU-003', 'WU-004']);
});

test('parseExecutionState excludes NONE sentinels from queued overlay diagnostics', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'executing',
    status: 'active',
    summary: 'Execution remains active with no queued follow-up work.',
    activeGroup: { groupId: 'G-01', title: 'Runtime Overlay', status: 'in-progress' },
    activeWorkUnit: { workUnitId: 'WU-002', title: 'Persist state', status: 'in-progress' },
    nextUnit: { workUnitId: 'NONE', rationale: 'No follow-up work is queued.' },
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
        ],
      },
    ],
  }));

  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.nextUnit.workUnitId, 'NONE');
  assert.strictEqual(overlay.diagnostics.queue.depth, 0);
  assert.strictEqual(overlay.diagnostics.queue.nextUnitCount, 0);
  assert.deepStrictEqual(overlay.diagnostics.queue.nextUnitIds, []);
  assert.strictEqual(overlay.diagnostics.overlap.parallelCandidateCount, 0);
});

test('parseExecutionState collapses stale terminal recovery markers before building diagnostics', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    updatedAt: '2026-03-23T12:34:56Z',
    lifecycle: 'finished',
    status: 'completed',
    summary: 'Execution already terminated after the runtime snapshot was persisted.',
    activeGroup: { groupId: 'G-01', title: 'Runtime Overlay', status: 'in-progress' },
    activeWorkUnit: { workUnitId: 'WU-002', title: 'Persist state', status: 'in-progress' },
    nextUnit: { workUnitId: 'WU-003', rationale: 'stale queued follow-up' },
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Runtime Overlay',
        status: 'in-progress',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist state', status: 'in-progress', current: true },
          { workUnitId: 'WU-003', kind: 'work-unit', title: 'Render diagnostics', status: 'queued', next: true },
        ],
      },
    ],
  }));

  assert.ok(overlay.executionState);
  assert.strictEqual(overlay.executionState.activeGroup, null);
  assert.strictEqual(overlay.executionState.activeWorkUnit, null);
  assert.strictEqual(overlay.executionState.nextUnit, null);
  assert.strictEqual(overlay.executionState.tree[0].status, 'implemented');
  assert.strictEqual(overlay.executionState.tree[0].current, false);
  assert.strictEqual(overlay.executionState.tree[0].children[1].status, 'done');
  assert.strictEqual(overlay.executionState.tree[0].children[1].current, false);
  assert.strictEqual(overlay.executionState.tree[0].children[2].status, 'done');
  assert.strictEqual(overlay.executionState.tree[0].children[2].next, false);
  assert.strictEqual(overlay.diagnostics.recovery.status, 'terminal');
  assert.strictEqual(overlay.diagnostics.recovery.resumable, false);
  assert.strictEqual(overlay.diagnostics.queue.depth, 0);
  assert.deepStrictEqual(overlay.diagnostics.queue.nextUnitIds, []);
});

test('parseExecutionState degrades malformed trees with duplicate ids and conflicting current markers', () => {
  const overlay = parseExecutionState(JSON.stringify({
    schemaVersion: 'execution-state-v1',
    lifecycle: 'executing',
    status: 'active',
    tree: [
      {
        groupId: 'G-01',
        kind: 'group',
        title: 'Primary group',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Primary unit', status: 'in-progress', current: true },
        ],
      },
      {
        groupId: 'G-02',
        kind: 'group',
        title: 'Conflicting group',
        current: true,
        children: [
          { workUnitId: 'WU-001', kind: 'work-unit', title: 'Duplicate unit', status: 'queued' },
          { workUnitId: 'WU-002', kind: 'work-unit', title: 'Blocked sibling', status: 'queued', current: true, blocked: true },
        ],
      },
    ],
  }));

  assert.ok(overlay.executionState);
  assert.ok(overlay.warnings.some((warning) => /duplicate execution tree node ids/i.test(warning)));
  assert.ok(overlay.warnings.some((warning) => /multiple current execution nodes detected/i.test(warning)));
  assert.strictEqual(overlay.executionState.activeGroup.id, 'G-01');
  assert.strictEqual(overlay.executionState.activeWorkUnit.id, 'WU-001');
  assert.strictEqual(overlay.executionState.tree[1].current, false);
  assert.strictEqual(overlay.diagnostics.integrity.status, 'degraded');
  assert.strictEqual(overlay.diagnostics.blockedNodeCount, 1);
});

test('parseStructuredState merges execution-state overlay without replacing plan framing', () => {
  const text = `# Plan Pack — Execution Overlay Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime Overlay | implemented | 1 | 3 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | contract landed |
| G-01 | WU-002 | queued | WU-003 | waiting |

## Next Unit
**WU-002** — persist the runtime overlay

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      updatedAt: '2026-03-23T12:34:56Z',
      lifecycle: 'executing',
      status: 'active',
      summary: 'Overlay captured mid-run execution progress.',
      activeGroup: { groupId: 'G-01', title: 'Runtime Overlay', status: 'in-progress' },
      activeWorkUnit: { workUnitId: 'WU-002', title: 'Persist overlay', status: 'in-progress' },
      nextUnit: { workUnitId: 'WU-003', rationale: 'merge the UI overlay' },
      replanCount: 2,
      blockers: ['Waiting on narrow validation routing'],
      tree: [
        {
          groupId: 'G-01',
          kind: 'group',
          title: 'Runtime Overlay',
          status: 'in-progress',
          current: true,
          children: [
            { workUnitId: 'WU-001', kind: 'work-unit', title: 'Contract', status: 'done' },
            { workUnitId: 'WU-002', kind: 'work-unit', title: 'Persist overlay', status: 'in-progress', current: true },
            { workUnitId: 'WU-003', kind: 'work-unit', title: 'UI merge', status: 'queued', next: true },
          ],
        },
      ],
    }),
  });

  assert.ok(structured.meta.executionState);
  assert.strictEqual(structured.meta.executionOverlay.present, true);
  assert.strictEqual(structured.meta.executionOverlay.applied, true);
  assert.strictEqual(structured.nextUnit.workUnitId, 'WU-003');
  assert.strictEqual(structured.groups[0].planStatus, 'implemented');
  assert.strictEqual(structured.groups[0].status, 'in-progress');
  assert.strictEqual(structured.groups[0].active, true);
  assert.strictEqual(structured.workUnits[1].planStatus, 'queued');
  assert.strictEqual(structured.workUnits[1].status, 'in-progress');
  assert.strictEqual(structured.workUnits[1].active, true);
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.recovery.status, 'ready');
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.queue.depth, 1);
  assert.strictEqual(structured.meta.closureSummary.reviewVerdict, 'APPROVED');
});

test('parseStructuredState keeps runtime-only execution overlay groups and work units additive', () => {
  const text = `# Plan Pack — Runtime Only Overlay
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Planned group | queued | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | queued | — | seeded from plan |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      activeGroup: { groupId: 'G-02', title: 'Runtime-only group', status: 'in-progress' },
      activeWorkUnit: { workUnitId: 'WU-002', title: 'Runtime-only work unit', status: 'in-progress' },
      nextUnit: { workUnitId: 'WU-003', rationale: 'Queued from runtime overlay only' },
      tree: [
        {
          groupId: 'G-02',
          kind: 'group',
          title: 'Runtime-only group',
          status: 'in-progress',
          current: true,
          children: [
            { workUnitId: 'WU-002', kind: 'work-unit', title: 'Runtime-only work unit', status: 'in-progress', current: true },
            { workUnitId: 'WU-003', kind: 'work-unit', title: 'Queued runtime work unit', status: 'queued', next: true },
          ],
        },
      ],
    }),
  });

  const runtimeOnlyGroup = structured.groups.find((group) => group.group === 'G-02');
  const runtimeOnlyActiveWorkUnit = structured.workUnits.find((workUnit) => workUnit.workUnitId === 'WU-002');
  const runtimeOnlyNextWorkUnit = structured.workUnits.find((workUnit) => workUnit.workUnitId === 'WU-003');

  assert.ok(runtimeOnlyGroup);
  assert.strictEqual(runtimeOnlyGroup.title, 'Runtime-only group');
  assert.strictEqual(runtimeOnlyGroup.planStatus, null);
  assert.strictEqual(runtimeOnlyGroup.status, 'in-progress');
  assert.strictEqual(runtimeOnlyGroup.active, true);
  assert.strictEqual(runtimeOnlyGroup.wusTotal, 2);
  assert.ok(runtimeOnlyActiveWorkUnit);
  assert.strictEqual(runtimeOnlyActiveWorkUnit.group, 'G-02');
  assert.strictEqual(runtimeOnlyActiveWorkUnit.planStatus, null);
  assert.strictEqual(runtimeOnlyActiveWorkUnit.status, 'in-progress');
  assert.strictEqual(runtimeOnlyActiveWorkUnit.active, true);
  assert.ok(runtimeOnlyNextWorkUnit);
  assert.strictEqual(runtimeOnlyNextWorkUnit.group, 'G-02');
  assert.strictEqual(runtimeOnlyNextWorkUnit.next, true);
  assert.strictEqual(runtimeOnlyNextWorkUnit.status, 'queued');
  assert.strictEqual(structured.groups[0].group, 'G-01');
  assert.strictEqual(structured.workUnits[0].workUnitId, 'WU-001');
});

test('parseStructuredState applies execution refs to planned rows when overlay tree is absent', () => {
  const text = `# Plan Pack — Ref Only Overlay
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime Overlay | implemented | 1 | 3 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | contract landed |
| G-01 | WU-002 | queued | WU-003 | waiting |
| G-01 | WU-003 | queued | — | pending |

## Next Unit
**WU-002** — persist the runtime overlay
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'executing',
      activeGroup: {
        groupId: 'G-01',
        title: 'Runtime Overlay',
        status: 'in-progress',
        summary: 'Group is actively executing from ref-only overlay.',
      },
      activeWorkUnit: {
        workUnitId: 'WU-002',
        title: 'Persist overlay',
        status: 'in-progress',
        summary: 'Current work unit picked up without tree nodes.',
      },
      nextUnit: {
        workUnitId: 'WU-003',
        rationale: 'Queued from next-unit ref only.',
      },
    }),
  });

  assert.strictEqual(structured.groups[0].planStatus, 'implemented');
  assert.strictEqual(structured.groups[0].status, 'in-progress');
  assert.strictEqual(structured.groups[0].runtimeStatus, 'in-progress');
  assert.strictEqual(structured.groups[0].runtimeSummary, 'Group is actively executing from ref-only overlay.');
  assert.strictEqual(structured.groups[0].active, true);
  assert.strictEqual(structured.workUnits[1].planStatus, 'queued');
  assert.strictEqual(structured.workUnits[1].status, 'in-progress');
  assert.strictEqual(structured.workUnits[1].runtimeStatus, 'in-progress');
  assert.strictEqual(structured.workUnits[1].runtimeSummary, 'Current work unit picked up without tree nodes.');
  assert.strictEqual(structured.workUnits[1].active, true);
  assert.strictEqual(structured.workUnits[2].status, 'queued');
  assert.strictEqual(structured.workUnits[2].runtimeStatus, 'queued');
  assert.strictEqual(structured.workUnits[2].runtimeSummary, 'Queued from next-unit ref only.');
  assert.strictEqual(structured.workUnits[2].next, true);
  assert.strictEqual(structured.nextUnit.workUnitId, 'WU-003');
});

test('parseStructuredState fails soft when execution-state overlay is invalid JSON', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | not-started | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting |

## Next Unit
**WU-001** — wait

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |
`;

  const structured = parseStructuredState(text, {
    executionStateText: '{"schemaVersion": "execution-state-v1"',
  });

  assert.strictEqual(structured.meta.executionState, undefined);
  assert.strictEqual(structured.meta.executionOverlay.present, true);
  assert.strictEqual(structured.meta.executionOverlay.applied, false);
  assert.ok(structured.warnings.some((warning) => warning.includes('Execution State: invalid execution-state.json JSON payload')));
  assert.strictEqual(structured.nextUnit.workUnitId, 'WU-001');
});

test('parseStructuredState fails soft when execution-state overlay schemaVersion is unsupported', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | not-started | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | not-started | WU-001 | waiting |

## Next Unit
**WU-001** — wait

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v2',
      lifecycle: 'finished',
      status: 'completed',
      nextUnit: { workUnitId: 'NONE', rationale: 'Would incorrectly clear next unit if applied.' },
    }),
  });

  assert.strictEqual(structured.meta.executionState, undefined);
  assert.strictEqual(structured.meta.executionOverlay.present, true);
  assert.strictEqual(structured.meta.executionOverlay.applied, false);
  assert.ok(structured.warnings.some((warning) => warning.includes('Execution State: unsupported execution-state.json schemaVersion: execution-state-v2')));
  assert.strictEqual(structured.nextUnit.workUnitId, 'WU-001');
  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
});

test('parseStructuredState derives summaries from the merged execution-state next unit', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | implemented | 1 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | landed |

## Next Unit
**WU-002** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      status: 'completed',
      summary: 'Execution overlay shows there is no remaining next unit.',
      nextUnit: {
        workUnitId: 'NONE',
        rationale: 'All tracked work is complete.',
      },
    }),
  });

  assert.strictEqual(structured.nextUnit.workUnitId, 'NONE');
  assert.deepStrictEqual(structured.meta.intentFrame.nextSuggestedUnits, ['NONE']);
  assert.deepStrictEqual(structured.meta.closureSummary.followUps.activeContinuation, []);
  assert.strictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.queue.depth, 0);
  assert.deepStrictEqual(structured.meta.executionOverlay.diagnostics.queue.nextUnitIds, []);
  assert.ok(!structured.workUnits.some((workUnit) => workUnit.workUnitId === 'NONE'));
});

test('parseStructuredState preserves NONE sentinels without creating runtime-only queued work units', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | in-progress | 0 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | in-progress | — | active work remains in progress |

## Next Unit
**WU-002** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'executing',
      status: 'active',
      summary: 'Execution remains active with no queued follow-up work.',
      activeGroup: { groupId: 'G-01', title: 'Example', status: 'in-progress' },
      activeWorkUnit: { workUnitId: 'WU-001', title: 'Example unit', status: 'in-progress' },
      nextUnit: {
        workUnitId: 'NONE',
        rationale: 'No follow-up work is queued.',
      },
      tree: [
        {
          groupId: 'G-01',
          kind: 'group',
          title: 'Example',
          status: 'in-progress',
          current: true,
          children: [
            { workUnitId: 'WU-001', kind: 'work-unit', title: 'Example unit', status: 'in-progress', current: true },
          ],
        },
      ],
    }),
  });

  assert.strictEqual(structured.nextUnit.workUnitId, 'NONE');
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.queue.depth, 0);
  assert.deepStrictEqual(structured.meta.executionOverlay.diagnostics.queue.nextUnitIds, []);
  assert.strictEqual(structured.workUnits.length, 1);
  assert.ok(!structured.workUnits.some((workUnit) => workUnit.workUnitId === 'NONE'));
  assert.ok(!structured.workUnits.some((workUnit) => workUnit.next));
});

test('parseStructuredState derives terminal closure metadata from execution-state status and lifecycle', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
  | G-01 | Example | in-progress | 1 | 2 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | landed |
  | G-01 | WU-002 | queued | — | stale tracker residue |

## Next Unit
**WU-002** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Runtime state shows execution has already terminated.',
    }),
  });

  assert.strictEqual(structured.nextUnit, null);
  assert.strictEqual(structured.groups[0].planStatus, 'in-progress');
  assert.strictEqual(structured.groups[0].status, 'implemented');
  assert.strictEqual(structured.groups[0].runtimeStatus, 'implemented');
  assert.strictEqual(structured.groups[0].active, false);
  assert.strictEqual(structured.workUnits[1].planStatus, 'queued');
  assert.strictEqual(structured.workUnits[1].status, 'done');
  assert.strictEqual(structured.workUnits[1].runtimeStatus, 'done');
  assert.strictEqual(structured.workUnits[1].next, false);
  assert.deepStrictEqual(structured.meta.intentFrame.nextSuggestedUnits, []);
  assert.deepStrictEqual(structured.meta.closureSummary.followUps.activeContinuation, []);
  assert.strictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.finality, 'terminal');
  assert.strictEqual(structured.meta.closureSummary.executionStatus, 'completed');
  assert.strictEqual(structured.meta.closureSummary.executionLifecycle, 'finished');
});

test('parseStructuredState does not surface failed terminal execution overlays as completed', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
  | G-01 | Example | in-progress | 1 | 2 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | landed |
  | G-01 | WU-002 | in-progress | — | stale tracker residue |

## Next Unit
**WU-002** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'terminated',
      status: 'failed',
      summary: 'Runtime state shows execution terminated unsuccessfully.',
    }),
  });

  assert.strictEqual(structured.nextUnit, null);
  assert.strictEqual(structured.groups[0].planStatus, 'in-progress');
  assert.strictEqual(structured.groups[0].status, 'failed');
  assert.strictEqual(structured.groups[0].runtimeStatus, 'failed');
  assert.strictEqual(structured.groups[0].active, false);
  assert.strictEqual(structured.workUnits[1].planStatus, 'in-progress');
  assert.strictEqual(structured.workUnits[1].status, 'failed');
  assert.strictEqual(structured.workUnits[1].runtimeStatus, 'failed');
  assert.strictEqual(structured.workUnits[1].active, false);
  assert.deepStrictEqual(structured.meta.intentFrame.nextSuggestedUnits, []);
  assert.deepStrictEqual(structured.meta.closureSummary.followUps.activeContinuation, []);
  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
  assert.notStrictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.finality, 'terminal');
  assert.strictEqual(structured.meta.closureSummary.executionStatus, 'failed');
  assert.strictEqual(structured.meta.closureSummary.executionLifecycle, 'terminated');
});

test('parseStructuredState collapses stale terminal overlay recovery state even when a tree is still present', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | in-progress | 1 | 3 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | landed |
| G-01 | WU-002 | in-progress | WU-003 | stale active residue |
| G-01 | WU-003 | queued | — | stale queued residue |

## Next Unit
**WU-003** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const structured = parseStructuredState(text, {
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution is already terminal for this slice.',
      activeGroup: { groupId: 'G-01', title: 'Example', status: 'in-progress' },
      activeWorkUnit: { workUnitId: 'WU-002', title: 'Example unit', status: 'in-progress' },
      nextUnit: { workUnitId: 'WU-003', rationale: 'stale queued follow-up' },
      tree: [
        {
          groupId: 'G-01',
          kind: 'group',
          title: 'Example',
          status: 'in-progress',
          current: true,
          children: [
            { workUnitId: 'WU-001', kind: 'work-unit', title: 'WU-001', status: 'done' },
            { workUnitId: 'WU-002', kind: 'work-unit', title: 'WU-002', status: 'in-progress', current: true },
            { workUnitId: 'WU-003', kind: 'work-unit', title: 'WU-003', status: 'queued', next: true },
          ],
        },
      ],
    }),
  });

  assert.strictEqual(structured.nextUnit, null);
  assert.strictEqual(structured.meta.executionState.activeGroup, null);
  assert.strictEqual(structured.meta.executionState.activeWorkUnit, null);
  assert.strictEqual(structured.meta.executionState.nextUnit, null);
  assert.strictEqual(structured.meta.executionState.tree[0].current, false);
  assert.strictEqual(structured.meta.executionState.tree[0].children[1].current, false);
  assert.strictEqual(structured.meta.executionState.tree[0].children[2].next, false);
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.recovery.status, 'terminal');
  assert.strictEqual(structured.meta.executionOverlay.diagnostics.queue.depth, 0);
  assert.deepStrictEqual(structured.meta.executionOverlay.diagnostics.queue.nextUnitIds, []);
  assert.strictEqual(structured.groups[0].planStatus, 'in-progress');
  assert.strictEqual(structured.groups[0].status, 'implemented');
  assert.strictEqual(structured.groups[0].runtimeStatus, 'implemented');
  assert.strictEqual(structured.groups[0].active, false);
  assert.strictEqual(structured.workUnits[1].planStatus, 'in-progress');
  assert.strictEqual(structured.workUnits[1].status, 'done');
  assert.strictEqual(structured.workUnits[1].runtimeStatus, 'done');
  assert.strictEqual(structured.workUnits[1].active, false);
  assert.strictEqual(structured.workUnits[2].planStatus, 'queued');
  assert.strictEqual(structured.workUnits[2].status, 'done');
  assert.strictEqual(structured.workUnits[2].runtimeStatus, 'done');
  assert.strictEqual(structured.workUnits[2].next, false);
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
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

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
- docs/system/session-state-artifacts.md

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

test('parseStructuredState still derives resume and framing metadata when progress tracker heading is absent', () => {
  const text = `# Plan Pack — Unstructured Resume Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
`;

  const handoffText = `## Handoff Manifest
- Session: expected-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep metadata derivation available for unstructured legacy plans.

## Exploration Summary
- copilot-ui/lib/planState.js

## User Constraints
- none

## Immediate Next Actions
- Resume with the next targeted fix.

## Next Plan Ideas
- Add broader tracker coverage later.

## Watch Outs
- Do not require tracker headings for derived metadata.

## Open Risks
- none
`;

  const propositionText = `## 2026-03-23T10:00:00Z — after-execution — workflow-executor

### Summary
- Derived metadata remains available for trackerless plans.

### Immediate Next Actions
- Resume with the next targeted fix.

### Details
Legacy plans without a progress tracker should still publish review and framing metadata.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    requireHandoff: true,
    sessionId: 'expected-session',
  });

  assert.deepStrictEqual(structured.groups, []);
  assert.deepStrictEqual(structured.workUnits, []);
  assert.deepStrictEqual(structured.checkpoints, []);
  assert.strictEqual(structured.nextUnit, null);
  assert.ok(structured.warnings.includes('No "# Plan-Pack Progress Tracker" heading found; treating as v0/unstructured'));
  assert.strictEqual(structured.meta.reviewLedger.approved, true);
  assert.strictEqual(structured.meta.resume.ready, true);
  assert.ok(structured.meta.intentFrame);
  assert.strictEqual(structured.meta.intentFrame.summary, 'Derived metadata remains available for trackerless plans.');
  assert.ok(structured.meta.closureSummary);
  assert.strictEqual(structured.meta.closureSummary.reviewVerdict, 'APPROVED');
});

test('parseStructuredState fails closed on the latest review ledger verdict', () => {
  const text = `# Plan Pack — Latest Review Verdict Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
| 2 | reviewer-sonnet-4-6 | CHANGES_REQUESTED | tighten resume approval logic | pending |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Foundation | in-progress | 1 | 2 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | waiting on revisions |

## Next Unit
**WU-002** — apply the requested changes

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: pending |
`;

  const structured = parseStructuredState(text);

  assert.strictEqual(structured.meta.reviewLedger.rows.length, 2);
  assert.strictEqual(structured.meta.reviewLedger.rows[1].verdict, 'CHANGES_REQUESTED');
  assert.strictEqual(structured.meta.reviewLedger.approved, false);
  assert.strictEqual(structured.meta.resume.ready, false);
  assert.ok(structured.meta.resume.blockers.includes('review_approval_missing'));
  assert.ok(structured.warnings.some((warning) => warning.includes('Review Ledger: review ledger missing resumable approval verdict')));
  assert.strictEqual(structured.meta.closureSummary.reviewVerdict, 'CHANGES_REQUESTED');
});

test('parseStructuredState does not emit completed when terminal closure hints remain blocked', () => {
  const text = `# Plan Pack — Blocked Terminal Closure Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |
| 2 | reviewer-sonnet-4-6 | CHANGES_REQUESTED | capture follow-up fixes before closeout | pending |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Closure | in-progress | 1 | 1 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | — | review follow-up still required |

## Next Unit
NONE — terminal execution reached pending reviewer sign-off

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const propositionText = `## 2026-03-23T10:00:00Z — after-execution — workflow-executor

### Summary
- Execution reached its terminal handoff point.

### Immediate Next Actions
- Address the requested review revisions before closing the session.
`;

  const structured = parseStructuredState(text, {
    propositionText,
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution reached a persisted terminal runtime state.',
    }),
  });

  assert.strictEqual(structured.nextUnit, null);
  assert.strictEqual(structured.meta.reviewLedger.approved, false);
  assert.strictEqual(structured.meta.resume.ready, false);
  assert.strictEqual(structured.meta.closureSummary.reviewVerdict, 'CHANGES_REQUESTED');
  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
  assert.strictEqual(structured.meta.closureSummary.finality, 'terminal');
  assert.strictEqual(structured.meta.closureSummary.executionStatus, 'completed');
  assert.strictEqual(structured.meta.closureSummary.executionLifecycle, 'finished');
  assert.notStrictEqual(structured.meta.closureSummary.outcome, 'completed');
});

test('parseStructuredState allows successful terminal execution overlays to complete without handoff artifacts', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Example | implemented | 1 | 2 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | landed |
| G-01 | WU-002 | queued | — | stale tracker residue |

## Next Unit
**WU-002** — stale tracker next unit

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const structured = parseStructuredState(text, {
    requireHandoff: true,
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Runtime state shows execution has already terminated successfully.',
    }),
  });

  assert.strictEqual(structured.nextUnit, null);
  assert.strictEqual(structured.meta.reviewLedger.approved, true);
  assert.strictEqual(structured.meta.resume.ready, false);
  assert.ok(structured.meta.resume.blockers.includes('handoff_missing'));
  assert.ok(structured.warnings.some((warning) => warning.includes('Handoff: missing handoff artifact')));
  assert.strictEqual(structured.meta.closureSummary.summary, 'Runtime state shows execution has already terminated successfully.');
  assert.strictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.finality, 'terminal');
  assert.strictEqual(structured.meta.closureSummary.executionStatus, 'completed');
  assert.strictEqual(structured.meta.closureSummary.executionLifecycle, 'finished');
});

test('parseStructuredState derives intent frame and closure summary from existing session artifacts', () => {
  const text = `# Plan Pack — Framing Example
<!-- IE_PLAN_PACK_VERSION: 1 -->
## Goal + Success Criteria
- Goal: Example

## Context Loaded
- docs/system/session-state-artifacts.md

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
| 1 | reviewer-sonnet-4-6 | APPROVED | — | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Foundation | implemented | 1 | 2 | — |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | WU-002 | foundation landed |

## Next Unit
**WU-002** — finish the UI inspection surface

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const handoffText = `## Handoff Manifest
- Session: expected-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep the derived summaries additive to structured-state metadata.

## Exploration Summary
- copilot-ui/lib/sessionArtifacts.js

## User Constraints
- Do not introduce new required artifact files.

## Immediate Next Actions
- Finish the Session Details framing cards.

## Next Plan Ideas
- Consider broader planning-surface adoption after this slice.

## Watch Outs
- Preserve raw artifacts as supporting detail.

## Open Risks
- Verification coverage is still narrow.
`;

  const propositionText = `## 2026-03-23T10:00:00Z — after-execution — workflow-executor

### Summary
- Session framing cards are now derived from persisted artifacts.
- Structured-state now publishes additive framing metadata.

### Immediate Next Actions
- Confirm the Session Details UI reads the derived summaries.

### Next Plan Ideas
- Extend the same summaries into planning surfaces later.

### Watch Outs
- Avoid reintroducing raw-artifact-first UX assumptions.

### Open Risks
- Final closeout evidence is still limited to narrow validation.

### Details
Derived framing data should remain deterministic and partial when artifacts are missing.
`;

  const verificationGuideText = `## Summary
Runtime framing surfaces now lead the session detail workflow.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js
- copilot-ui/ui/src/tabs/Sessions/SessionDetail.tsx

## Where to Verify
- UI: Sessions > Session Details

## Validation Requirements
- unit: Required for the parser and UI slice.
- browser: Not required for this framing-only change.

## Tested Coverage
- unit: Focused unit planState parser tests.
- integration: Sessions route structured-state checks.

## Coverage Gaps
- browser: No browser-driven UI verification ran in this session.

## Verification Steps
- Run the focused planState and sessions route tests.

## Expected Outcomes
- Session Intent Frame appears before raw artifacts.
- Session Closure Summary shows validation evidence and follow-ups.
`;

  const finalText = `## Summary
- Deprecated final closeout text should not control structured-state.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    finalText,
    requireHandoff: true,
    sessionId: 'expected-session',
  });

  assert.strictEqual(structured.meta.intentFrame.summary, 'Session framing cards are now derived from persisted artifacts. Structured-state now publishes additive framing metadata.');
  assert.deepStrictEqual(structured.meta.intentFrame.inScope, [
    'Confirm the Session Details UI reads the derived summaries.',
    'Finish the Session Details framing cards.',
  ]);
  assert.deepStrictEqual(structured.meta.intentFrame.successSignals, [
    'unit-tests — after group completion',
    'Session Intent Frame appears before raw artifacts.',
    'Session Closure Summary shows validation evidence and follow-ups.',
  ]);
  assert.deepStrictEqual(structured.meta.intentFrame.validationRequirements, [
    'unit: Required for the parser and UI slice.',
    'browser: Not required for this framing-only change.',
  ]);
  assert.strictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.confidence, 'high');
  assert.deepStrictEqual(structured.meta.closureSummary.changedFiles, [
    'copilot-ui/lib/sessionArtifacts.js',
    'copilot-ui/ui/src/tabs/Sessions/SessionDetail.tsx',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.validationRequirements, [
    'unit: Required for the parser and UI slice.',
    'browser: Not required for this framing-only change.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.validationCoverage, [
    'unit: Focused unit planState parser tests.',
    'integration: Sessions route structured-state checks.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.coverageGaps, [
    'browser: No browser-driven UI verification ran in this session.',
  ]);
  assert.ok(structured.meta.closureSummary.validationEvidence.some((entry) => entry.includes('Review ledger verdict: APPROVED')));
  assert.deepStrictEqual(structured.meta.closureSummary.followUps.activeContinuation, []);
  assert.ok(!structured.meta.closureSummary.sourceArtifacts.includes('final'));
});

test('parseStructuredState does not backfill structured validation requirements from checkpoints when the verification guide section is absent', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Runtime Adoption | implemented | 1 | 1 | - |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |

## Next Unit
**NONE** - terminal outcome reached

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const handoffText = `## Handoff Manifest
- Session: checkpoint-only-validation-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Immediate Next Actions
- NONE
`;

  const propositionText = `## 2026-04-03T12:00:00Z - after-execution - workflow-executor

### Summary
- Structured-state should keep checkpoint signals out of structured validation requirements.
`;

  const verificationGuideText = `## Summary
Structured-state should keep checkpoint signals out of structured validation requirements.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js

## Where to Verify
- API: GET /api/sessions/:id/structured-state

## Verification Steps
- Run the focused structured-state tests.

## Expected Outcomes
- Structured validation requirements stay empty when the section is absent.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    sessionId: 'checkpoint-only-validation-session',
  });

  assert.deepStrictEqual(structured.meta.intentFrame.successSignals, [
    'unit-tests — after group completion',
    'Structured validation requirements stay empty when the section is absent.',
  ]);
  assert.deepStrictEqual(structured.meta.intentFrame.validationRequirements, []);
  assert.deepStrictEqual(structured.meta.closureSummary.validationRequirements, []);
  assert.ok(structured.meta.closureSummary.validationEvidence.includes('unit-tests passed (after group completion)'));
});

test('parseStructuredState keeps approved review verdict visible without letting it create high confidence on its own', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Structured State Confidence | implemented | 1 | 1 | - |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |

## Next Unit
**NONE** - terminal outcome reached
`;

  const handoffText = `## Handoff Manifest
- Session: review-only-confidence-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep review approval separate from validation evidence in closure scoring.

## Exploration Summary
- docs/system/validation-governance.md

## User Constraints
- none

## Immediate Next Actions
- NONE

## Next Plan Ideas
- NONE

## Watch Outs
- Review approval alone must not overstate validation confidence.

## Open Risks
- Narrow validation still has not run.
`;

  const propositionText = `## 2026-04-03T12:00:00Z - after-execution - workflow-executor

### Summary
- Structured-state now separates review approval from affirmative validation evidence.

### Immediate Next Actions
- NONE

### Next Plan Ideas
- NONE

### Watch Outs
- Do not let review approval alone imply tested confidence.

### Open Risks
- Focused validation evidence is still absent.
`;

  const verificationGuideText = `## Summary
Review approval remains visible in structured-state, but no validation coverage ran.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js

## Where to Verify
- API: GET /api/sessions/:id/structured-state

## Verification Steps
- Inspect the closure summary confidence field.

## Expected Outcomes
- Review approval remains visible without producing high confidence.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    sessionId: 'review-only-confidence-session',
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution finished without persisted validation coverage.',
    }),
  });

  assert.strictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.confidence, 'medium');
  assert.ok(structured.meta.closureSummary.validationEvidence.some((entry) => entry.includes('Review ledger verdict: APPROVED')));
  assert.deepStrictEqual(structured.meta.closureSummary.validationCoverage, []);
});

test('parseStructuredState fails closed when mandatory validation remains uncovered', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Validation Governance | implemented | 1 | 1 | - |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |

## Next Unit
**NONE** - terminal outcome reached

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const handoffText = `## Handoff Manifest
- Session: validation-session
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep closure reporting aligned with validation governance.

## Exploration Summary
- docs/system/validation-governance.md

## User Constraints
- none

## Immediate Next Actions
- NONE

## Next Plan Ideas
- NONE

## Watch Outs
- Missing mandatory validation must remain explicit.

## Open Risks
- Integration validation has not run yet.
`;

  const propositionText = `## 2026-04-03T12:00:00Z - after-execution - workflow-executor

### Summary
- Cross-boundary closure metadata landed.

### Immediate Next Actions
- NONE

### Next Plan Ideas
- NONE

### Watch Outs
- Do not overstate closure when required validation is missing.

### Open Risks
- Integration validation still has not run.
`;

  const verificationGuideText = `## Summary
Validation governance metadata is now exposed through structured-state.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js

## Where to Verify
- API: GET /api/sessions/:id/structured-state

## Validation Requirements
- integration: Required for this cross-boundary workflow slice.
- browser: Not required for this non-UI change.

## Tested Coverage
- unit: Focused unit tests for the structured-state parser.

## Coverage Gaps
- integration: Validation did not run for this session.

## Verification Steps
- Run the focused structured-state tests.

## Expected Outcomes
- Closure metadata remains explicit about missing mandatory validation.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    sessionId: 'validation-session',
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution terminated, but broader validation is still missing.',
    }),
  });

  assert.strictEqual(structured.meta.closureSummary.reviewVerdict, 'APPROVED');
  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
  assert.notStrictEqual(structured.meta.closureSummary.outcome, 'completed');
  assert.strictEqual(structured.meta.closureSummary.confidence, 'low');
  assert.strictEqual(structured.meta.closureSummary.finality, 'terminal');
  assert.deepStrictEqual(structured.meta.closureSummary.validationRequirements, [
    'integration: Required for this cross-boundary workflow slice.',
    'browser: Not required for this non-UI change.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.validationCoverage, [
    'unit: Focused unit tests for the structured-state parser.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.coverageGaps, [
    'integration: Validation did not run for this session.',
  ]);
  assert.ok(structured.meta.closureSummary.blockers.includes('Mandatory validation is required but persisted validation coverage is incomplete.'));
});

test('parseStructuredState ignores unlabeled tested coverage and gaps when deriving structured validation metadata', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Validation Governance | implemented | 1 | 1 | - |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |

## Next Unit
**NONE** - terminal outcome reached

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const handoffText = `## Handoff Manifest
- Session: validation-session-no-gaps
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep closure reporting aligned with validation governance.

## Exploration Summary
- docs/system/validation-governance.md

## User Constraints
- none

## Immediate Next Actions
- NONE

## Next Plan Ideas
- NONE

## Watch Outs
- Missing mandatory validation must remain explicit.

## Open Risks
- Integration validation has not run yet.
`;

  const propositionText = `## 2026-04-03T12:00:00Z - after-execution - workflow-executor

### Summary
- Cross-boundary closure metadata landed.

### Immediate Next Actions
- NONE

### Next Plan Ideas
- NONE

### Watch Outs
- Do not overstate closure when required validation is missing.

### Open Risks
- Integration validation still has not run.
`;

  const verificationGuideText = `## Summary
Validation governance metadata is now exposed through structured-state.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js

## Where to Verify
- API: GET /api/sessions/:id/structured-state

## Validation Requirements
- integration: Required for this cross-boundary workflow slice.
- browser: Not required for this non-UI change.

## Tested Coverage
- Focused unit tests for the structured-state parser.

## Coverage Gaps
- Integration validation did not run for this session.

## Verification Steps
- Run the focused structured-state tests.

## Expected Outcomes
- Closure metadata remains explicit about missing mandatory validation.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    sessionId: 'validation-session-no-gaps',
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution terminated, but broader validation is still missing.',
    }),
  });

  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
  assert.strictEqual(structured.meta.closureSummary.confidence, 'low');
  assert.deepStrictEqual(structured.meta.closureSummary.validationRequirements, [
    'integration: Required for this cross-boundary workflow slice.',
    'browser: Not required for this non-UI change.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.validationCoverage, []);
  assert.deepStrictEqual(structured.meta.closureSummary.coverageGaps, []);
  assert.ok(structured.meta.closureSummary.blockers.includes('Mandatory validation is required but persisted validation coverage is incomplete.'));
});

test('parseStructuredState fails closed when a mandatory validation requirement is unlabeled', () => {
  const text = `# Plan Pack
## Review Ledger
| Round | Reviewer | Verdict | Required Revisions | Resolution |
| --- | --- | --- | --- | --- |
| 1 | reviewer-sonnet-4-6 | APPROVED | - | accepted |

# Plan-Pack Progress Tracker
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->

## Work Unit Groups Overview
| Group | Title | Status | WUs Done | WUs Total | Depends On |
| --- | --- | --- | --- | --- | --- |
| G-01 | Validation Governance | implemented | 1 | 1 | - |

## Work Unit Status Table
| Group | Work Unit ID | Status | Next Unit | Notes |
| --- | --- | --- | --- | --- |
| G-01 | WU-001 | done | - | execution finished |

## Next Unit
**NONE** - terminal outcome reached

## Checkpoints
| Group | Checkpoint | Trigger | Notes |
| --- | --- | --- | --- |
| G-01 | unit-tests | after group completion | status: passed |
`;

  const handoffText = `## Handoff Manifest
- Session: validation-session-unlabeled
- Plan: plan.md (status: APPROVED)
- Reviewer: Verdict: APPROVED

## Key Decisions
- Keep closure reporting aligned with validation governance.

## Exploration Summary
- docs/system/validation-governance.md

## User Constraints
- none

## Immediate Next Actions
- NONE

## Next Plan Ideas
- NONE

## Watch Outs
- Missing mandatory validation must remain explicit.

## Open Risks
- Broader validation expectations are still unresolved.
`;

  const propositionText = `## 2026-04-03T12:00:00Z - after-execution - workflow-executor

### Summary
- Cross-boundary closure metadata landed.

### Immediate Next Actions
- NONE

### Next Plan Ideas
- NONE

### Watch Outs
- Do not overstate closure when required validation is ambiguous.

### Open Risks
- Mandatory validation is stated, but the layer is not named.
`;

  const verificationGuideText = `## Summary
Validation governance metadata is now exposed through structured-state.

## Changed Files
- copilot-ui/lib/sessionArtifacts.js

## Where to Verify
- API: GET /api/sessions/:id/structured-state

## Validation Requirements
- Mandatory validation is required before closeout.

## Tested Coverage
- unit: Focused unit tests for the structured-state parser.

## Verification Steps
- Run the focused structured-state tests.

## Expected Outcomes
- Closure metadata remains explicit when mandatory validation is unlabeled.
`;

  const structured = parseStructuredState(text, {
    handoffText,
    propositionText,
    verificationGuideText,
    sessionId: 'validation-session-unlabeled',
    executionStateText: JSON.stringify({
      schemaVersion: 'execution-state-v1',
      lifecycle: 'finished',
      status: 'completed',
      summary: 'Execution terminated, but the mandatory validation requirement is still ambiguous.',
    }),
  });

  assert.strictEqual(structured.meta.closureSummary.outcome, 'paused');
  assert.strictEqual(structured.meta.closureSummary.confidence, 'low');
  assert.deepStrictEqual(structured.meta.closureSummary.validationRequirements, []);
  assert.deepStrictEqual(structured.meta.closureSummary.validationCoverage, [
    'unit: Focused unit tests for the structured-state parser.',
  ]);
  assert.deepStrictEqual(structured.meta.closureSummary.coverageGaps, []);
  assert.ok(structured.meta.closureSummary.blockers.includes('Mandatory validation is required but persisted validation coverage is incomplete.'));
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}

