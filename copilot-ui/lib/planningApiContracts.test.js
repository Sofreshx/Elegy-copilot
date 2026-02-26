'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_CREATE_IDEMPOTENCY_TTL_MS,
  createPlanningApiState,
  createPlanningRecordOperation,
  comparePlanningRecordsOperation,
} = require('./planningApiContracts');

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

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-ws4-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('create idempotency supports replay, conflict, and expiry handling', () => {
  const state = createPlanningApiState();
  const baseContext = { userId: 'user-1', repoId: 'repo-1' };
  const baseRequest = {
    scope: 'repo',
    title: 'WS4 idea',
    summary: 'idempotency behavior',
    state: 'thought',
    score: 0.3,
    idempotencyKey: 'idem-create-1',
  };

  const first = createPlanningRecordOperation(state, {
    context: baseContext,
    request: baseRequest,
    nowMs: 1_000,
  });
  assert.strictEqual(first.statusCode, 200);
  assert.strictEqual(first.body.idempotency.outcome, 'applied');
  const firstRecordId = first.body.record.recordId;

  const replay = createPlanningRecordOperation(state, {
    context: baseContext,
    request: baseRequest,
    nowMs: 1_500,
  });
  assert.strictEqual(replay.statusCode, 200);
  assert.strictEqual(replay.body.idempotency.replay, true);
  assert.strictEqual(replay.body.idempotency.outcome, 'replay');
  assert.strictEqual(replay.body.record.recordId, firstRecordId);

  const conflict = createPlanningRecordOperation(state, {
    context: baseContext,
    request: {
      ...baseRequest,
      summary: 'changed payload',
    },
    nowMs: 2_000,
  });
  assert.strictEqual(conflict.statusCode, 409);
  assert.strictEqual(conflict.body.error.code, 'idempotency_conflict');

  const expired = createPlanningRecordOperation(state, {
    context: baseContext,
    request: baseRequest,
    nowMs: 1_000 + DEFAULT_CREATE_IDEMPOTENCY_TTL_MS + 1,
  });
  assert.strictEqual(expired.statusCode, 200);
  assert.strictEqual(expired.body.idempotency.outcome, 'expired_reapplied');
  assert.notStrictEqual(expired.body.record.recordId, firstRecordId);
});

test('compare is deterministic for repeated runs and tie cases', () => {
  const state = createPlanningApiState();
  const context = { userId: 'user-1' };

  const createA = createPlanningRecordOperation(state, {
    context,
    request: {
      scope: 'user',
      title: 'tie candidate',
      summary: 'same text',
      state: 'research',
      score: 0.5,
      idempotencyKey: 'create-a',
    },
    nowMs: 10_000,
  });
  assert.strictEqual(createA.statusCode, 200);

  const createB = createPlanningRecordOperation(state, {
    context,
    request: {
      scope: 'user',
      title: 'tie candidate',
      summary: 'same text',
      state: 'research',
      score: 0.5,
      idempotencyKey: 'create-b',
    },
    nowMs: 10_000,
  });
  assert.strictEqual(createB.statusCode, 200);

  const firstCompare = comparePlanningRecordsOperation(state, {
    context,
    request: {
      scopes: ['user'],
      query: 'tie same text',
      idempotencyKey: 'cmp-1',
    },
    nowMs: 20_000,
    implementedOutcomesRootAbs: process.cwd(),
  });

  const secondCompare = comparePlanningRecordsOperation(state, {
    context,
    request: {
      scopes: ['user'],
      query: 'tie same text',
      idempotencyKey: 'cmp-2',
    },
    nowMs: 20_100,
    implementedOutcomesRootAbs: process.cwd(),
  });

  assert.strictEqual(firstCompare.statusCode, 200);
  assert.strictEqual(secondCompare.statusCode, 200);

  const firstOrder = firstCompare.body.matches.map((entry) => entry.recordId);
  const secondOrder = secondCompare.body.matches.map((entry) => entry.recordId);
  assert.deepStrictEqual(firstOrder, secondOrder);
  assert.deepStrictEqual(firstOrder, [
    createA.body.record.recordId,
    createB.body.record.recordId,
  ]);
});

test('compare pins snapshot version and reports newerDataAvailable on mid-flight updates', () => {
  const state = createPlanningApiState();
  const context = { userId: 'user-1' };

  const base = createPlanningRecordOperation(state, {
    context,
    request: {
      scope: 'user',
      title: 'base record',
      summary: 'present at snapshot',
      state: 'research',
      score: 0.6,
      idempotencyKey: 'snapshot-base',
    },
    nowMs: 30_000,
  });
  assert.strictEqual(base.statusCode, 200);

  const compare = comparePlanningRecordsOperation(state, {
    context,
    request: {
      scopes: ['user'],
      query: 'base',
      idempotencyKey: 'cmp-snapshot',
    },
    nowMs: 31_000,
    beforeFinalize: () => {
      createPlanningRecordOperation(state, {
        context,
        request: {
          scope: 'user',
          title: 'late record',
          summary: 'added after snapshot',
          state: 'research',
          score: 0.8,
          idempotencyKey: 'snapshot-late',
        },
        nowMs: 31_100,
      });
    },
    implementedOutcomesRootAbs: process.cwd(),
  });

  assert.strictEqual(compare.statusCode, 200);
  assert.strictEqual(compare.body.newerDataAvailable, true);
  assert.ok(compare.body.versionVector.pinned.planningRecordsVersion < compare.body.versionVector.current.planningRecordsVersion);

  const ids = compare.body.matches.map((entry) => entry.recordId);
  assert.deepStrictEqual(ids, [base.body.record.recordId]);
});

test('implemented-outcomes ingestion emits stale/unavailable/invalid markers without omission', () => {
  withTempDir((root) => {
    const sessionDir = path.join(root, 'session-state', 'session-1');
    const plansDir = path.join(sessionDir, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });

    const stalePlanPath = path.join(sessionDir, 'plan.md');
    fs.writeFileSync(stalePlanPath, '# Plan Pack\n\n## Work Unit Specs\n', 'utf8');
    fs.utimesSync(stalePlanPath, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));

    const invalidIndexPath = path.join(plansDir, 'index.json');
    fs.writeFileSync(invalidIndexPath, '{"plans": "not-an-array"}', 'utf8');

    const state = createPlanningApiState();
    const context = { userId: 'user-1' };

    const compare = comparePlanningRecordsOperation(state, {
      context,
      request: {
        scopes: ['user'],
        query: 'outcomes',
        idempotencyKey: 'cmp-outcomes',
        staleAfterMs: 1,
        implementedOutcomeSources: [
          { sourceType: 'plan-md', path: 'session-state/session-1/plan.md', sourceId: 'stale-plan' },
          { sourceType: 'final-md', path: 'session-state/session-1/final.md', sourceId: 'missing-final' },
          { sourceType: 'plans-index', path: 'session-state/session-1/plans/index.json', sourceId: 'invalid-index' },
          { sourceType: 'plan-md', path: '../escape.md', sourceId: 'traversal-denied' },
        ],
      },
      nowMs: Date.parse('2026-02-26T00:00:00.000Z'),
      implementedOutcomesRootAbs: root,
    });

    assert.strictEqual(compare.statusCode, 200);

    const markers = compare.body.implementedOutcomes.sources;
    assert.strictEqual(markers.length, 4);

    const byId = new Map(markers.map((marker) => [marker.sourceId, marker]));
    assert.strictEqual(byId.get('stale-plan').status, 'stale');
    assert.strictEqual(byId.get('missing-final').status, 'unavailable');
    assert.strictEqual(byId.get('invalid-index').status, 'invalid');
    assert.strictEqual(byId.get('traversal-denied').reason, 'path_traversal_denied');
  });
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
