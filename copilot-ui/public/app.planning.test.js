'use strict';

const assert = require('assert');

const {
  PLANNING_GATE_STATES,
  mapPlanningGateState,
  isMergeEnabled,
  buildPlanningConflictRows,
  hasReviewedAllConflicts,
  resolvePlanningContextRestore,
  createPlanningIntentToken,
  validatePlanningIntentToken,
  buildCompareSnapshotHash,
  buildSourceIdsHash,
  normalizePlanningRecordSummary,
} = require('./app');

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

function run() {
  test('mapPlanningGateState resolves pass deterministically', () => {
    const gate = mapPlanningGateState({
      requestedScopes: ['user', 'repo'],
      deniedScopes: [],
      matches: [{ recordId: 'r1' }],
      sourceMarkers: [{ sourceId: 's1', status: 'available' }],
      newerDataAvailable: false,
    });
    assert.deepStrictEqual(gate, {
      state: PLANNING_GATE_STATES.PASS,
      reason: 'Compare satisfied gate checks',
    });
  });

  test('mapPlanningGateState resolves degraded when compare has denied scopes', () => {
    const gate = mapPlanningGateState({
      requestedScopes: ['user', 'repo', 'global'],
      deniedScopes: ['repo'],
      matches: [{ recordId: 'r1' }],
      sourceMarkers: [{ sourceId: 's1', status: 'available' }],
    });
    assert.strictEqual(gate.state, PLANNING_GATE_STATES.DEGRADED);
  });

  test('mapPlanningGateState resolves insufficient-data without matches and markers', () => {
    const gate = mapPlanningGateState({
      requestedScopes: ['user'],
      deniedScopes: [],
      matches: [],
      sourceMarkers: [],
    });
    assert.strictEqual(gate.state, PLANNING_GATE_STATES.INSUFFICIENT_DATA);
  });

  test('mapPlanningGateState keeps insufficient-data when matches are empty even with available markers', () => {
    const gate = mapPlanningGateState({
      requestedScopes: ['user'],
      deniedScopes: [],
      matches: [],
      sourceMarkers: [{ sourceId: 's1', status: 'available', reason: 'source_available' }],
    });
    assert.strictEqual(gate.state, PLANNING_GATE_STATES.INSUFFICIENT_DATA);
    assert.strictEqual(gate.reason, 'no_compare_matches');
  });

  test('mapPlanningGateState resolves explicit gate using deterministic downgrade primary reason', () => {
    const gate = mapPlanningGateState({
      gateState: 'degraded',
      downgrade: {
        deterministic: true,
        primaryReason: 'newer_data_available',
      },
    });

    assert.deepStrictEqual(gate, {
      state: PLANNING_GATE_STATES.DEGRADED,
      reason: 'newer_data_available',
    });
  });

  test('mapPlanningGateState derives degraded reason from stale/conflict markers deterministically', () => {
    const staleGate = mapPlanningGateState({
      requestedScopes: ['user'],
      deniedScopes: [],
      matches: [{ recordId: 'r1' }],
      sourceMarkers: [{ sourceId: 's1', status: 'stale', reason: 'source_stale' }],
      newerDataAvailable: false,
    });
    assert.strictEqual(staleGate.state, PLANNING_GATE_STATES.DEGRADED);
    assert.strictEqual(staleGate.reason, 'source_stale');

    const conflictGate = mapPlanningGateState({
      requestedScopes: ['user'],
      deniedScopes: [],
      matches: [{ recordId: 'r1' }],
      sourceMarkers: [{ sourceId: 's1', status: 'invalid', reason: 'schema_validation_failed' }],
      newerDataAvailable: false,
    });
    assert.strictEqual(conflictGate.state, PLANNING_GATE_STATES.DEGRADED);
    assert.strictEqual(conflictGate.reason, 'schema_validation_failed');
  });

  test('mapPlanningGateState resolves policy-blocked and auth-denied', () => {
    const blocked = mapPlanningGateState({ policyGateBlocked: true, reason: 'policy preflight failed' });
    assert.strictEqual(blocked.state, PLANNING_GATE_STATES.POLICY_BLOCKED);

    const denied = mapPlanningGateState({ httpStatus: 403, reason: 'missing_user_context' });
    assert.strictEqual(denied.state, PLANNING_GATE_STATES.AUTH_DENIED);
  });

  test('isMergeEnabled allows only pass gate state', () => {
    assert.strictEqual(isMergeEnabled(PLANNING_GATE_STATES.PASS), true);
    assert.strictEqual(isMergeEnabled(PLANNING_GATE_STATES.DEGRADED), false);
    assert.strictEqual(isMergeEnabled(PLANNING_GATE_STATES.INSUFFICIENT_DATA), false);
    assert.strictEqual(isMergeEnabled(PLANNING_GATE_STATES.POLICY_BLOCKED), false);
    assert.strictEqual(isMergeEnabled(PLANNING_GATE_STATES.AUTH_DENIED), false);
  });

  test('buildPlanningConflictRows picks deterministic winner with user > repo > global precedence', () => {
    const rows = buildPlanningConflictRows([
      {
        recordId: 'g1',
        scope: 'global',
        title: 'Global title',
        summary: 'Global summary',
        state: 'thought',
        updatedAt: '2026-02-26T00:01:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
      {
        recordId: 'r1',
        scope: 'repo',
        title: 'Repo title',
        summary: 'Repo summary',
        state: 'research',
        updatedAt: '2026-02-26T00:02:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
      {
        recordId: 'u1',
        scope: 'user',
        title: 'User title',
        summary: 'User summary',
        state: 'queued',
        updatedAt: '2026-02-26T00:03:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
    ]);

    assert.ok(rows.length >= 1);
    const titleRow = rows.find((row) => row.field === 'title');
    assert.ok(titleRow);
    assert.strictEqual(titleRow.winnerScope, 'user');
    assert.strictEqual(titleRow.winnerRecordId, 'u1');
    assert.strictEqual(titleRow.winnerValue, 'User title');
  });

  test('buildPlanningConflictRows uses deterministic recordId tiebreak within the same scope', () => {
    const rows = buildPlanningConflictRows([
      {
        recordId: 'repo-b',
        scope: 'repo',
        title: 'Repo Title B',
        summary: 'Repo Summary B',
        state: 'research',
        updatedAt: '2026-02-26T00:02:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
      {
        recordId: 'repo-a',
        scope: 'repo',
        title: 'Repo Title A',
        summary: 'Repo Summary A',
        state: 'research',
        updatedAt: '2026-02-26T00:02:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
      {
        recordId: 'global-1',
        scope: 'global',
        title: 'Global Title',
        summary: 'Global Summary',
        state: 'thought',
        updatedAt: '2026-02-26T00:02:00.000Z',
        createdAt: '2026-02-26T00:00:00.000Z',
      },
    ]);

    const titleRow = rows.find((row) => row.field === 'title');
    assert.ok(titleRow);
    assert.strictEqual(titleRow.valuesByScope.repo.recordId, 'repo-a');
    assert.strictEqual(titleRow.winnerScope, 'repo');
    assert.strictEqual(titleRow.winnerRecordId, 'repo-a');
  });

  test('resolvePlanningContextRestore applies deterministic precedence url > storage > ui', () => {
    const restored = resolvePlanningContextRestore({
      urlContext: {
        userId: ' url-user ',
        scopes: ['repo'],
        scopeSpecified: true,
      },
      storedContext: {
        userId: 'storage-user',
        repoId: 'storage-repo',
        query: 'storage-query',
        sessionId: 'storage-session',
        scopes: ['global'],
        scopeSpecified: true,
      },
      uiContext: {
        userId: 'ui-user',
        repoId: 'ui-repo',
        query: 'ui-query',
        sessionId: 'ui-session',
        scopes: ['user', 'repo', 'global'],
      },
    });

    assert.deepStrictEqual(restored.precedence, ['url', 'storage', 'ui']);
    assert.strictEqual(restored.deterministic, true);
    assert.deepStrictEqual(restored.context, {
      userId: 'url-user',
      repoId: 'storage-repo',
      query: 'storage-query',
      sessionId: 'storage-session',
      scopes: ['repo'],
    });
  });

  test('resolvePlanningContextRestore keeps explicit empty stored scopes and normalizes field safety', () => {
    const restored = resolvePlanningContextRestore({
      urlContext: {
        userId: '',
        scopeSpecified: false,
      },
      storedContext: {
        userId: ` ${'x'.repeat(700)} `,
        repoId: ' repo-1 ',
        query: ' q ',
        sessionId: ' session-1 ',
        scopes: [],
        scopeSpecified: true,
      },
      uiContext: {
        userId: 'ui-user',
        repoId: 'ui-repo',
        query: 'ui-query',
        sessionId: 'ui-session',
        scopes: ['user', 'repo', 'global'],
      },
    });

    assert.strictEqual(restored.context.userId.length, 512);
    assert.strictEqual(restored.context.repoId, 'repo-1');
    assert.strictEqual(restored.context.query, 'q');
    assert.strictEqual(restored.context.sessionId, 'session-1');
    assert.deepStrictEqual(restored.context.scopes, []);
  });

  test('hasReviewedAllConflicts enforces explicit review requirement', () => {
    const conflicts = [{ conflictKey: 'title' }, { conflictKey: 'summary' }];
    assert.strictEqual(hasReviewedAllConflicts(conflicts, new Set()), false);
    assert.strictEqual(hasReviewedAllConflicts(conflicts, new Set(['title'])), false);
    assert.strictEqual(hasReviewedAllConflicts(conflicts, new Set(['title', 'summary'])), true);
  });

  test('normalizePlanningRecordSummary preserves multiline note content deterministically', () => {
    const normalized = normalizePlanningRecordSummary('  first line\r\nsecond line\r\n\r\nthird line  ');
    assert.strictEqual(normalized, 'first line\nsecond line\n\nthird line');

    const blank = normalizePlanningRecordSummary('   \r\n   ');
    assert.strictEqual(blank, '');
  });

  test('validatePlanningIntentToken accepts valid token and rejects mismatch/expiry/replay', () => {
    const compare = {
      requestedScopes: ['user', 'repo', 'global'],
      deniedScopes: [],
      matches: [{ recordId: 'planning-1' }],
      versionVector: {
        pinned: {
          planningRecordsVersion: 4,
          implementedOutcomesVersion: 'hash-a',
        },
      },
    };

    const compareHash = buildCompareSnapshotHash(compare);
    const sourceIdsHash = buildSourceIdsHash(['s-1', 's-2']);

    const token = createPlanningIntentToken({
      tokenId: 'tok-1',
      actorId: 'user-1',
      targetId: 'planning-1',
      compareHash,
      sourceIdsHash,
      versionVector: compare.versionVector.pinned,
    }, {
      nowMs: Date.parse('2026-02-26T00:00:00.000Z'),
      ttlMs: 60_000,
    });

    const ok = validatePlanningIntentToken(token, {
      nowMs: Date.parse('2026-02-26T00:00:30.000Z'),
      actorId: 'user-1',
      targetId: 'planning-1',
      compareHash,
      sourceIdsHash,
      expectedVersionVector: compare.versionVector.pinned,
    });
    assert.strictEqual(ok.ok, true);

    const mismatch = validatePlanningIntentToken(token, {
      nowMs: Date.parse('2026-02-26T00:00:30.000Z'),
      actorId: 'user-1',
      targetId: 'planning-2',
      compareHash,
      sourceIdsHash,
      expectedVersionVector: compare.versionVector.pinned,
    });
    assert.deepStrictEqual(mismatch, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'target_mismatch' },
    });

    const expired = validatePlanningIntentToken(token, {
      nowMs: Date.parse('2026-02-26T00:02:01.000Z'),
      actorId: 'user-1',
      targetId: 'planning-1',
      compareHash,
      sourceIdsHash,
      expectedVersionVector: compare.versionVector.pinned,
    });
    assert.deepStrictEqual(expired, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'token_expired' },
    });

    const consumed = validatePlanningIntentToken({ ...token, consumedAt: '2026-02-26T00:00:40.000Z' }, {
      nowMs: Date.parse('2026-02-26T00:00:41.000Z'),
      actorId: 'user-1',
      targetId: 'planning-1',
      compareHash,
      sourceIdsHash,
      expectedVersionVector: compare.versionVector.pinned,
    });
    assert.deepStrictEqual(consumed, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'token_consumed' },
    });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run();
