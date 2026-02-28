'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_CREATE_IDEMPOTENCY_TTL_MS,
  DEFAULT_ROUTE_LOCK_TTL_MS,
  FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_SUPPORTED_PROVIDERS,
  FINISH_COMPATIBILITY_RECEIPT_REQUIRED_FIELDS,
  FINISH_COMPATIBILITY_RECEIPT_OPTIONAL_FIELDS,
  PLANNING_API_CONTRACT_VERSION,
  PLANNING_PERSISTENCE_HEALTH_KIND,
  PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION,
  SHARED_PROVIDER_LIFECYCLE_CAPABILITIES,
  buildPlanningPersistenceHealthEnvelope,
  buildFinishCompatibilityHookContract,
  evaluateProviderLifecycleCapability,
  buildLifecycleUnsupportedCapabilityMarker,
  createPlanningApiState,
  buildPlanningRouteLockKey,
  acquirePlanningRouteLock,
  releasePlanningRouteLock,
  replacePlanningProjectionFromPersistedRecords,
  createPlanningRecordOperation,
  comparePlanningRecordsOperation,
  evictPlanningIdempotencyEntry,
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
  assert.strictEqual(conflict.body.error.reason, 'idempotency_key_payload_mismatch');
  assert.strictEqual(conflict.body.deterministic, true);

  const expired = createPlanningRecordOperation(state, {
    context: baseContext,
    request: baseRequest,
    nowMs: 1_000 + DEFAULT_CREATE_IDEMPOTENCY_TTL_MS + 1,
  });
  assert.strictEqual(expired.statusCode, 200);
  assert.strictEqual(expired.body.idempotency.outcome, 'expired_reapplied');
  assert.notStrictEqual(expired.body.record.recordId, firstRecordId);
});

test('create idempotency eviction removes stale replay entry after failed durable write rollback', () => {
  const state = createPlanningApiState();
  const context = { userId: 'user-1', repoId: 'repo-1' };
  const request = {
    scope: 'repo',
    title: 'rollback create',
    summary: 'idempotency rollback',
    state: 'thought',
    score: 0.1,
    idempotencyKey: 'idem-create-rollback-1',
  };

  const first = createPlanningRecordOperation(state, {
    context,
    request,
    nowMs: 5_000,
  });

  assert.strictEqual(first.statusCode, 200);
  assert.strictEqual(first.body.idempotency.outcome, 'applied');

  const evicted = evictPlanningIdempotencyEntry(state, {
    operation: 'create',
    scopeKey: first.body.idempotency.scopeKey,
    idempotencyKey: request.idempotencyKey,
  });

  assert.strictEqual(evicted.ok, true);
  assert.strictEqual(evicted.evicted, true);
  assert.strictEqual(evicted.reason, 'evicted');

  const replayAfterEviction = createPlanningRecordOperation(state, {
    context,
    request,
    nowMs: 5_100,
  });

  assert.strictEqual(replayAfterEviction.statusCode, 200);
  assert.strictEqual(replayAfterEviction.body.idempotency.replay, false);
  assert.strictEqual(replayAfterEviction.body.idempotency.outcome, 'applied');
  assert.notStrictEqual(replayAfterEviction.body.record.recordId, first.body.record.recordId);
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
  assert.strictEqual(firstCompare.body.precedence.deterministic, true);
  assert.ok(Array.isArray(firstCompare.body.precedence.rules));
  assert.ok(firstCompare.body.precedence.rules.length >= 1);
  assert.deepStrictEqual(secondCompare.body.precedence, firstCompare.body.precedence);

  const firstOrder = firstCompare.body.matches.map((entry) => entry.recordId);
  const secondOrder = secondCompare.body.matches.map((entry) => entry.recordId);
  assert.deepStrictEqual(firstOrder, secondOrder);
  assert.deepStrictEqual(firstOrder, [
    createA.body.record.recordId,
    createB.body.record.recordId,
  ]);
});

test('projection replacement from persisted records updates cache deterministically', () => {
  const state = createPlanningApiState();

  const first = replacePlanningProjectionFromPersistedRecords(state, {
    records: [
      {
        recordId: 'planning-000002',
        scope: 'user',
        ownerId: 'user-1',
        title: 'B',
        summary: 'beta',
        state: 'research',
        score: 0.5,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:01.000Z',
      },
      {
        recordId: 'planning-000001',
        scope: 'repo',
        ownerId: 'user-1',
        repoId: 'repo-1',
        title: 'A',
        summary: 'alpha',
        state: 'queued',
        score: 0.7,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:02.000Z',
      },
    ],
    nextRecordNumber: 3,
  });

  assert.strictEqual(first.changed, true);
  assert.strictEqual(first.recordsCount, 2);
  assert.strictEqual(first.nextRecordNumber, 3);
  assert.strictEqual(state.recordsById.size, 2);
  assert.strictEqual(first.precedence.deterministic, true);
  assert.ok(Array.isArray(first.precedence.rules));

  const second = replacePlanningProjectionFromPersistedRecords(state, {
    records: [
      {
        recordId: 'planning-000002',
        scope: 'user',
        ownerId: 'user-1',
        title: 'B',
        summary: 'beta',
        state: 'research',
        score: 0.5,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:01.000Z',
      },
      {
        recordId: 'planning-000001',
        scope: 'repo',
        ownerId: 'user-1',
        repoId: 'repo-1',
        title: 'A',
        summary: 'alpha',
        state: 'queued',
        score: 0.7,
        createdAt: '2026-02-26T00:00:00.000Z',
        updatedAt: '2026-02-26T00:00:02.000Z',
      },
    ],
    nextRecordNumber: 3,
  });

  assert.strictEqual(second.changed, false);
  assert.strictEqual(second.recordsVersion, first.recordsVersion);
});

test('projection hydration after crash drops non-durable in-memory records and restores deterministically on restart', () => {
  const state = createPlanningApiState();
  const context = { userId: 'user-1', repoId: 'repo-1' };

  const durableRecords = [
    {
      recordId: 'planning-000050',
      scope: 'repo',
      ownerId: 'user-1',
      repoId: 'repo-1',
      title: 'Durable baseline',
      summary: 'persisted authority row',
      state: 'queued',
      score: 0.8,
      createdAt: '2026-02-26T04:00:00.000Z',
      updatedAt: '2026-02-26T04:05:00.000Z',
    },
  ];

  replacePlanningProjectionFromPersistedRecords(state, {
    records: durableRecords,
    nextRecordNumber: 51,
  });

  const nonDurableCreate = createPlanningRecordOperation(state, {
    context,
    request: {
      scope: 'repo',
      title: 'Non-durable local create',
      summary: 'simulated crash before write-through commit acknowledgement zzzxqtoken123',
      state: 'research',
      score: 0.4,
      idempotencyKey: 'crash-local-create',
    },
    nowMs: Date.parse('2026-02-26T04:10:00.000Z'),
  });

  assert.strictEqual(nonDurableCreate.statusCode, 200);

  const preRecoveryList = state.recordsById.size;
  assert.strictEqual(preRecoveryList, 2);

  const recovered = replacePlanningProjectionFromPersistedRecords(state, {
    records: durableRecords,
    nextRecordNumber: 51,
  });

  assert.strictEqual(typeof recovered.changed, 'boolean');
  assert.strictEqual(recovered.recordsCount, 1);
  assert.strictEqual(state.recordsById.has('planning-000050'), true);
  assert.strictEqual(state.recordsById.has(nonDurableCreate.body.record.recordId), false);

  const compareAfterRecovery = comparePlanningRecordsOperation(state, {
    context,
    request: {
      scopes: ['repo'],
      query: 'zzzxqtoken123',
      idempotencyKey: 'cmp-post-recovery',
    },
    nowMs: Date.parse('2026-02-26T04:12:00.000Z'),
    implementedOutcomesRootAbs: process.cwd(),
  });

  assert.strictEqual(compareAfterRecovery.statusCode, 200);
  assert.deepStrictEqual(
    compareAfterRecovery.body.matches.map((entry) => entry.recordId),
    ['planning-000050'],
  );

  const restarted = createPlanningApiState();
  const restartedProjection = replacePlanningProjectionFromPersistedRecords(restarted, {
    records: durableRecords,
    nextRecordNumber: 51,
  });
  assert.strictEqual(restartedProjection.recordsCount, 1);

  const compareAfterRestart = comparePlanningRecordsOperation(restarted, {
    context,
    request: {
      scopes: ['repo'],
      query: 'durable baseline',
      idempotencyKey: 'cmp-post-restart',
    },
    nowMs: Date.parse('2026-02-26T04:13:00.000Z'),
    implementedOutcomesRootAbs: process.cwd(),
  });

  assert.strictEqual(compareAfterRestart.statusCode, 200);
  assert.deepStrictEqual(
    compareAfterRestart.body.matches.map((entry) => entry.recordId),
    ['planning-000050'],
  );
});

test('projection replacement resolves duplicate recordId deterministically via precedence then hash tiebreak', () => {
  const state = createPlanningApiState();

  const duplicateA = {
    recordId: 'planning-000100',
    scope: 'repo',
    ownerId: 'user-1',
    repoId: 'repo-1',
    title: 'Duplicate A',
    summary: 'alpha',
    state: 'research',
    score: 0.5,
    createdAt: '2026-02-26T00:00:00.000Z',
    updatedAt: '2026-02-26T00:00:01.000Z',
  };

  const duplicateB = {
    ...duplicateA,
    scope: 'user',
    title: 'Duplicate B',
    summary: 'beta',
  };

  const first = replacePlanningProjectionFromPersistedRecords(state, {
    records: [duplicateA, duplicateB],
    nextRecordNumber: 101,
  });

  const second = replacePlanningProjectionFromPersistedRecords(state, {
    records: [duplicateB, duplicateA],
    nextRecordNumber: 101,
  });

  assert.strictEqual(first.recordsCount, 1);
  assert.strictEqual(second.recordsCount, 1);
  assert.strictEqual(first.projectionHash, second.projectionHash);

  const winner = state.recordsById.get('planning-000100');
  assert.ok(winner);
  assert.strictEqual(winner.scope, 'user');
  assert.strictEqual(winner.title, 'Duplicate B');
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
    assert.strictEqual(byId.get('stale-plan').stale, true);
    assert.strictEqual(byId.get('stale-plan').conflict, false);
    assert.strictEqual(byId.get('stale-plan').marker, 'stale');
    assert.strictEqual(byId.get('stale-plan').reasonCode, 'source_stale');
    assert.strictEqual(byId.get('missing-final').status, 'unavailable');
    assert.strictEqual(byId.get('missing-final').conflict, true);
    assert.strictEqual(byId.get('missing-final').marker, 'conflict');
    assert.strictEqual(byId.get('invalid-index').status, 'invalid');
    assert.strictEqual(byId.get('invalid-index').conflict, true);
    assert.strictEqual(byId.get('invalid-index').marker, 'conflict');
    assert.strictEqual(byId.get('traversal-denied').reason, 'path_traversal_denied');
    assert.strictEqual(byId.get('traversal-denied').conflict, true);

    assert.strictEqual(compare.body.implementedOutcomes.staleMarkers.length, 1);
    assert.strictEqual(compare.body.implementedOutcomes.staleMarkers[0].sourceId, 'stale-plan');
    assert.strictEqual(compare.body.implementedOutcomes.staleMarkers[0].reason, 'source_stale');

    const conflictMarkerIds = compare.body.implementedOutcomes.conflictMarkers.map((marker) => marker.sourceId);
    assert.deepStrictEqual(conflictMarkerIds, ['invalid-index', 'missing-final', 'traversal-denied']);

    assert.deepStrictEqual(compare.body.implementedOutcomes.reasonCodes, [
      'path_traversal_denied',
      'schema_validation_failed',
      'source_missing',
      'source_stale',
    ]);
  });
});

test('implemented-outcomes stale/conflict marker collections remain deterministic across repeated compares', () => {
  withTempDir((root) => {
    const sessionDir = path.join(root, 'session-state', 'session-deterministic');
    const plansDir = path.join(sessionDir, 'plans');
    fs.mkdirSync(plansDir, { recursive: true });

    const stalePlanPath = path.join(sessionDir, 'plan.md');
    fs.writeFileSync(stalePlanPath, '# Plan Pack\n\n## Work Unit Specs\n', 'utf8');
    fs.utimesSync(stalePlanPath, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));

    const invalidIndexPath = path.join(plansDir, 'index.json');
    fs.writeFileSync(invalidIndexPath, '{"plans":"not-an-array"}', 'utf8');

    const state = createPlanningApiState();
    const context = { userId: 'user-1' };

    const request = {
      scopes: ['user'],
      query: 'outcomes',
      staleAfterMs: 1,
      implementedOutcomeSources: [
        { sourceType: 'plans-index', path: 'session-state/session-deterministic/plans/index.json', sourceId: 'invalid-index' },
        { sourceType: 'final-md', path: 'session-state/session-deterministic/final.md', sourceId: 'missing-final' },
        { sourceType: 'plan-md', path: 'session-state/session-deterministic/plan.md', sourceId: 'stale-plan' },
      ],
    };

    const first = comparePlanningRecordsOperation(state, {
      context,
      request: {
        ...request,
        idempotencyKey: 'cmp-deterministic-1',
      },
      nowMs: Date.parse('2026-02-26T00:00:00.000Z'),
      implementedOutcomesRootAbs: root,
    });

    const second = comparePlanningRecordsOperation(state, {
      context,
      request: {
        ...request,
        idempotencyKey: 'cmp-deterministic-2',
      },
      nowMs: Date.parse('2026-02-26T00:00:01.000Z'),
      implementedOutcomesRootAbs: root,
    });

    assert.strictEqual(first.statusCode, 200);
    assert.strictEqual(second.statusCode, 200);

    assert.deepStrictEqual(
      second.body.implementedOutcomes.staleMarkers,
      first.body.implementedOutcomes.staleMarkers,
    );
    assert.deepStrictEqual(
      second.body.implementedOutcomes.conflictMarkers,
      first.body.implementedOutcomes.conflictMarkers,
    );
    assert.deepStrictEqual(
      second.body.implementedOutcomes.reasonCodes,
      first.body.implementedOutcomes.reasonCodes,
    );
  });
});

test('planning persistence health envelope remains deterministic and backward compatible', () => {
  const envelope = buildPlanningPersistenceHealthEnvelope({
    contractVersion: '1',
    required: 1,
    configured: true,
    usable: false,
    status: ' configured_no_client ',
    errors: ['zeta', 'alpha', 'zeta'],
    lastError: '  planning_persistence_client_unavailable  ',
    governance: {
      ready: false,
      code: ' planning_persistence_client_unavailable ',
      reason: ' planning_persistence_client_unavailable ',
      reasonCodes: ['zeta', 'alpha', 'alpha'],
    },
    migrations: {
      schemaTable: ' ie_schema_versions ',
      latestVersion: '003_planning_backfill_items_ledger_init',
      manifestCount: '3.5',
      checksumBaseline: ' abcdef1234 ',
      baselineEnforced: 1,
      baselineMismatch: 0,
      appliedCount: '4.5',
      appliedVersions: ['003', '001', '002', '002'],
      driftDetected: 0,
      checksumValidation: {
        outcome: ' pass ',
        reason: ' all_manifest_checksums_match ',
        checkedVersionCount: '4.5',
        checkedVersions: ['003', '001', '002', '002'],
        manifestVersionCount: '3.5',
        manifestChecksumBaseline: ' abcdef1234 ',
        enforcement: ' fail_closed ',
      },
      lastRunAt: '2026-02-26T00:00:00.000Z',
    },
  });

  assert.strictEqual(envelope.contractVersion, '1');
  assert.strictEqual(envelope.kind, PLANNING_PERSISTENCE_HEALTH_KIND);
  assert.strictEqual(envelope.deterministic, true);
  assert.strictEqual(envelope.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
  assert.strictEqual(envelope.required, true);
  assert.strictEqual(envelope.configured, true);
  assert.strictEqual(envelope.usable, false);
  assert.strictEqual(envelope.status, 'configured_no_client');
  assert.deepStrictEqual(envelope.errors, ['alpha', 'zeta']);
  assert.strictEqual(envelope.lastError, 'planning_persistence_client_unavailable');
  assert.ok(envelope.governance);
  assert.strictEqual(envelope.governance.deterministic, true);
  assert.strictEqual(envelope.governance.failClosed, true);
  assert.strictEqual(envelope.governance.ready, false);
  assert.strictEqual(envelope.governance.code, 'planning_persistence_client_unavailable');
  assert.strictEqual(envelope.governance.reason, 'planning_persistence_client_unavailable');
  assert.deepStrictEqual(envelope.governance.reasonCodes, ['alpha', 'zeta']);
  assert.strictEqual(envelope.migrations.schemaTable, 'ie_schema_versions');
  assert.strictEqual(envelope.migrations.latestVersion, '003_planning_backfill_items_ledger_init');
  assert.strictEqual(envelope.migrations.manifestCount, 3);
  assert.strictEqual(envelope.migrations.checksumBaseline, 'abcdef1234');
  assert.strictEqual(envelope.migrations.baselineEnforced, true);
  assert.strictEqual(envelope.migrations.baselineMismatch, false);
  assert.strictEqual(envelope.migrations.appliedCount, 4);
  assert.deepStrictEqual(envelope.migrations.appliedVersions, ['001', '002', '003']);
  assert.strictEqual(envelope.migrations.driftDetected, false);
  assert.ok(envelope.migrations.checksumValidation);
  assert.strictEqual(envelope.migrations.checksumValidation.outcome, 'pass');
  assert.strictEqual(envelope.migrations.checksumValidation.reason, 'all_manifest_checksums_match');
  assert.strictEqual(envelope.migrations.checksumValidation.checkedVersionCount, 4);
  assert.deepStrictEqual(envelope.migrations.checksumValidation.checkedVersions, ['001', '002', '003']);
  assert.strictEqual(envelope.migrations.checksumValidation.manifestVersionCount, 3);
  assert.strictEqual(envelope.migrations.checksumValidation.manifestChecksumBaseline, 'abcdef1234');
  assert.strictEqual(envelope.migrations.checksumValidation.enforcement, 'fail_closed');
  assert.strictEqual(envelope.migrations.checksumValidation.failure, null);
  assert.strictEqual(envelope.migrations.lastRunAt, '2026-02-26T00:00:00.000Z');
});

test('planning route lock primitives enforce deterministic conflict and release semantics', () => {
  const state = createPlanningApiState();
  const lockKey = buildPlanningRouteLockKey({
    routeKind: 'planning.create',
    actorId: 'user-1',
    repoId: 'repo-1',
  });

  const first = acquirePlanningRouteLock(state, {
    routeKind: 'planning.create',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'req-a',
    nowMs: 1_000,
  });

  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.acquired, true);
  assert.strictEqual(first.reentrant, false);
  assert.strictEqual(first.lock.lockKey, lockKey);
  assert.strictEqual(first.lock.ttlMs, DEFAULT_ROUTE_LOCK_TTL_MS);

  const conflict = acquirePlanningRouteLock(state, {
    routeKind: 'planning.create',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'req-b',
    nowMs: 1_500,
  });

  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.conflict, true);
  assert.strictEqual(conflict.code, 'planning_route_lock_conflict');
  assert.strictEqual(conflict.reason, 'lock_already_held');
  assert.strictEqual(conflict.lock.lockKey, lockKey);
  assert.strictEqual(conflict.lock.heldBy, 'req-a');

  const reentrant = acquirePlanningRouteLock(state, {
    routeKind: 'planning.create',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'req-a',
    nowMs: 1_600,
  });

  assert.strictEqual(reentrant.ok, true);
  assert.strictEqual(reentrant.reentrant, true);

  const released = releasePlanningRouteLock(state, first.lock);
  assert.strictEqual(released.ok, true);
  assert.strictEqual(released.released, true);

  const afterRelease = acquirePlanningRouteLock(state, {
    routeKind: 'planning.create',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'req-b',
    nowMs: 1_700,
  });
  assert.strictEqual(afterRelease.ok, true);
  assert.strictEqual(afterRelease.acquired, true);
});

test('planning route lock expires and is reacquired by a different owner', () => {
  const state = createPlanningApiState();

  const first = acquirePlanningRouteLock(state, {
    routeKind: 'planning.merge',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'owner-a',
    nowMs: 10_000,
    ttlMs: 100,
  });
  assert.strictEqual(first.ok, true);

  const second = acquirePlanningRouteLock(state, {
    routeKind: 'planning.merge',
    actorId: 'user-1',
    repoId: 'repo-1',
    ownerId: 'owner-b',
    nowMs: 10_150,
    ttlMs: 100,
  });

  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.lock.ownerId, 'owner-b');
});

test('provider lifecycle shared capabilities are contract-equivalent across providers', () => {
  const providers = ['non-docker', 'docker'];

  for (const provider of providers) {
    for (const action of SHARED_PROVIDER_LIFECYCLE_CAPABILITIES) {
      const capability = evaluateProviderLifecycleCapability({ provider, action });
      assert.strictEqual(capability.contractVersion, PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION);
      assert.strictEqual(capability.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
      assert.strictEqual(capability.deterministic, true);
      assert.strictEqual(capability.provider, provider);
      assert.strictEqual(capability.action, action);
      assert.strictEqual(capability.shared, true);
      assert.strictEqual(capability.supported, true);
      assert.strictEqual(capability.marker, 'supported');
      assert.strictEqual(capability.reason, 'shared_capability_supported');
      assert.ok(capability.finishCompatibilityHook);
      assert.strictEqual(capability.finishCompatibilityHook.kind, 'lifecycle.finish.compatibility-hook');
      assert.strictEqual(capability.finishCompatibilityHook.providerAgnostic, true);
    }
  }
});

test('finish compatibility hook contract is deterministic and provider-agnostic for WS4 consumption', () => {
  const hook = buildFinishCompatibilityHookContract();

  assert.strictEqual(hook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
  assert.strictEqual(hook.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
  assert.strictEqual(hook.kind, 'lifecycle.finish.compatibility-hook');
  assert.strictEqual(hook.deterministic, true);
  assert.strictEqual(hook.action, 'finish');
  assert.strictEqual(hook.providerAgnostic, true);
  assert.deepStrictEqual(hook.supportedProviders, FINISH_COMPATIBILITY_SUPPORTED_PROVIDERS);
  assert.strictEqual(hook.scopeBoundary, 'ws2_contract_hook_only');
  assert.strictEqual(hook.ws4Ownership, 'finish_behavior_and_ux');
  assert.ok(hook.receipt);
  assert.strictEqual(hook.receipt.contractVersion, FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION);
  assert.strictEqual(hook.receipt.kind, 'lifecycle.finish.receipt');
  assert.strictEqual(hook.receipt.deterministic, true);
  assert.strictEqual(hook.receipt.providerAgnostic, true);
  assert.deepStrictEqual(hook.receipt.requiredFields, FINISH_COMPATIBILITY_RECEIPT_REQUIRED_FIELDS);
  assert.deepStrictEqual(hook.receipt.optionalFields, FINISH_COMPATIBILITY_RECEIPT_OPTIONAL_FIELDS);
});

test('provider lifecycle unsupported capability returns deterministic marker envelope', () => {
  const expectedHook = buildFinishCompatibilityHookContract();
  const unsupported = buildLifecycleUnsupportedCapabilityMarker({
    provider: 'non-docker',
    action: 'pr-open',
  });

  assert.ok(unsupported);
  assert.strictEqual(unsupported.error, 'Lifecycle capability unsupported');
  assert.strictEqual(unsupported.code, 'lifecycle_capability_unsupported');
  assert.strictEqual(unsupported.action, 'pr-open');
  assert.strictEqual(unsupported.reason, 'provider_capability_unsupported');
  assert.strictEqual(unsupported.deterministic, true);
  assert.strictEqual(unsupported.unsupported.marker, 'unsupported');
  assert.strictEqual(unsupported.unsupported.provider, 'non-docker');
  assert.strictEqual(unsupported.unsupported.shared, false);
  assert.ok(unsupported.finishCompatibilityHook);
  assert.deepStrictEqual(unsupported.finishCompatibilityHook, expectedHook);
  assert.strictEqual(unsupported.capability.supported, false);
  assert.strictEqual(unsupported.capability.contractVersion, PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION);
  assert.deepStrictEqual(unsupported.capability.finishCompatibilityHook, expectedHook);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(unsupported, 'prPrompt'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(unsupported, 'closeAllowed'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(unsupported, 'finishBehavior'), false);
  assert.strictEqual(unsupported.finishCompatibilityHook.scopeBoundary, 'ws2_contract_hook_only');
  assert.strictEqual(unsupported.finishCompatibilityHook.ws4Ownership, 'finish_behavior_and_ux');
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
