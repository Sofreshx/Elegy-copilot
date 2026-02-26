'use strict';

const assert = require('assert');

const {
  containsUnsafeShellSyntax,
  validateOpenTerminalLifecyclePayload,
  canReadPlanningRecord,
  canWritePlanningRecord,
  filterPlanningRecordsForCompare,
  validatePlanningMergeConfirmationToken,
  validatePlanningMergeIdempotency,
  validatePlanningMergeAtomicEnvelope,
  recordPlanningCompareReceipt,
  issuePlanningMergeIntent,
  executePlanningMerge,
} = require('./server');
const { createPlanningApiState } = require('./lib/planningApiContracts');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

async function run() {
  await test('validateOpenTerminalLifecyclePayload accepts strict valid payload', async () => {
    const result = validateOpenTerminalLifecyclePayload({
      sandboxId: 'sb-1',
      launcher: 'pwsh',
      profile: 'default',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        sandboxId: 'sb-1',
        launcher: 'pwsh',
        profile: 'default',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload denies env injection', async () => {
    const result = validateOpenTerminalLifecyclePayload({
      sandboxId: 'sb-1',
      environment: { PATH: '/tmp' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'env_injection_denied',
        reason: 'forbidden_field:environment',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload rejects fuzz metacharacters', async () => {
    const fuzz = ['sb-1;whoami', 'sb-1&&echo', 'sb-1${HOME}', 'sb-1$(whoami)'];
    for (const sandboxId of fuzz) {
      const result = validateOpenTerminalLifecyclePayload({ sandboxId });
      assert.deepStrictEqual(result, {
        ok: false,
        error: {
          code: 'invalid_lifecycle_payload',
          reason: 'unsafe_shell_syntax:sandboxId',
        },
      });
    }
  });

  await test('containsUnsafeShellSyntax detects expansion markers', async () => {
    assert.strictEqual(containsUnsafeShellSyntax('safe-id'), false);
    assert.strictEqual(containsUnsafeShellSyntax('bad$HOME'), true);
    assert.strictEqual(containsUnsafeShellSyntax('bad%USERPROFILE%'), true);
  });

  await test('canReadPlanningRecord defaults to deny when identity is missing', async () => {
    const record = { scope: 'global', ownerId: 'user-1' };
    assert.strictEqual(canReadPlanningRecord(record, {}), false);
    assert.strictEqual(canWritePlanningRecord(record, {}), false);
  });

  await test('canReadPlanningRecord enforces repo and owner matching for repo records', async () => {
    const record = { scope: 'repo', ownerId: 'user-1', repoId: 'repo-1' };
    assert.strictEqual(canReadPlanningRecord(record, { userId: 'user-1', repoId: 'repo-1' }), true);
    assert.strictEqual(canReadPlanningRecord(record, { userId: 'user-1', repoId: 'repo-2' }), false);
    assert.strictEqual(canReadPlanningRecord(record, { userId: 'user-2', repoId: 'repo-1' }), false);
  });

  await test('canReadPlanningRecord enforces owner match for global records', async () => {
    const record = { scope: 'global', ownerId: 'user-1' };
    assert.strictEqual(canReadPlanningRecord(record, { userId: 'user-1' }), true);
    assert.strictEqual(canReadPlanningRecord(record, { userId: 'user-2' }), false);
  });

  await test('filterPlanningRecordsForCompare requires explicit scope filters and reports denied scopes', async () => {
    const records = [
      { scope: 'repo', ownerId: 'user-1', repoId: 'repo-1', recordId: 'r1' },
      { scope: 'global', ownerId: 'user-1', recordId: 'g1' },
      { scope: 'global', ownerId: 'user-2', recordId: 'g2' },
    ];

    const empty = filterPlanningRecordsForCompare(records, { userId: 'user-1' });
    assert.deepStrictEqual(empty, { records: [], deniedScopes: [] });

    const missingRepoContext = filterPlanningRecordsForCompare(records, {
      userId: 'user-1',
      requestedScopes: ['repo', 'global'],
    });
    assert.deepStrictEqual(missingRepoContext.records.map((entry) => entry.recordId), ['g1']);
    assert.deepStrictEqual(missingRepoContext.deniedScopes, ['repo']);

    const fullContext = filterPlanningRecordsForCompare(records, {
      userId: 'user-1',
      repoId: 'repo-1',
      requestedScopes: ['repo', 'global'],
    });
    assert.deepStrictEqual(fullContext.records.map((entry) => entry.recordId).sort(), ['g1', 'r1']);
    assert.deepStrictEqual(fullContext.deniedScopes, []);
  });

  await test('validatePlanningMergeConfirmationToken accepts valid token and rejects expired token', async () => {
    const issuedAt = '2026-02-26T00:00:00.000Z';
    const expiresAt = '2026-02-26T00:10:00.000Z';

    const ok = validatePlanningMergeConfirmationToken({
      tokenId: 'tok-1',
      actorId: 'user-1',
      sourceIdsHash: 'src-hash',
      targetId: 'target-1',
      compareHash: 'cmp-hash',
      issuedAt,
      expiresAt,
    }, { nowMs: Date.parse('2026-02-26T00:05:00.000Z'), actorId: 'user-1', targetId: 'target-1', compareHash: 'cmp-hash' });

    assert.strictEqual(ok.ok, true);

    const expired = validatePlanningMergeConfirmationToken({
      tokenId: 'tok-1',
      actorId: 'user-1',
      sourceIdsHash: 'src-hash',
      targetId: 'target-1',
      compareHash: 'cmp-hash',
      issuedAt,
      expiresAt,
    }, { nowMs: Date.parse('2026-02-26T00:11:00.000Z') });

    assert.deepStrictEqual(expired, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'token_expired' },
    });
  });

  await test('validatePlanningMergeConfirmationToken rejects mismatch and consumed token', async () => {
    const token = {
      tokenId: 'tok-1',
      actorId: 'user-1',
      sourceIdsHash: 'src-hash',
      targetId: 'target-1',
      compareHash: 'cmp-hash',
      issuedAt: '2026-02-26T00:00:00.000Z',
      expiresAt: '2026-02-26T00:05:00.000Z',
    };

    const mismatch = validatePlanningMergeConfirmationToken(token, { nowMs: Date.parse('2026-02-26T00:01:00.000Z'), actorId: 'user-2' });
    assert.deepStrictEqual(mismatch, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'actor_mismatch' },
    });

    const consumed = validatePlanningMergeConfirmationToken({ ...token, consumedAt: '2026-02-26T00:01:30.000Z' }, { nowMs: Date.parse('2026-02-26T00:02:00.000Z') });
    assert.deepStrictEqual(consumed, {
      ok: false,
      error: { code: 'invalid_confirmation_token', reason: 'token_consumed' },
    });
  });

  await test('validatePlanningMergeIdempotency supports replay and rejects payload mismatch', async () => {
    const request = {
      idempotencyKey: 'idem-1',
      actorId: 'user-1',
      targetId: 'target-1',
      sourceIdsHash: 'sources-a',
      compareHash: 'cmp-a',
      operationType: 'merge',
    };

    const first = validatePlanningMergeIdempotency(request, null);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.replay, false);

    const replay = validatePlanningMergeIdempotency(request, {
      idempotencyKey: 'idem-1',
      payloadHash: first.payloadHash,
    });
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.replay, true);

    const conflict = validatePlanningMergeIdempotency({ ...request, compareHash: 'cmp-b' }, {
      idempotencyKey: 'idem-1',
      payloadHash: first.payloadHash,
    });
    assert.deepStrictEqual(conflict, {
      ok: false,
      error: { code: 'idempotency_conflict', reason: 'idempotency_key_payload_mismatch' },
    });
  });

  await test('validatePlanningMergeAtomicEnvelope requires all atomic components', async () => {
    const valid = validatePlanningMergeAtomicEnvelope({
      targetUpdate: { id: 'target-1' },
      sourceTransitions: [{ id: 'source-1', to: 'merged' }],
      lineageLinks: [{ from: 'source-1', to: 'target-1' }],
      auditEvent: { event: 'merge_accepted' },
      tokenConsumedWrite: { tokenId: 'tok-1' },
    });
    assert.deepStrictEqual(valid, { ok: true });

    const missing = validatePlanningMergeAtomicEnvelope({
      targetUpdate: { id: 'target-1' },
      sourceTransitions: [],
      lineageLinks: [{ from: 'source-1', to: 'target-1' }],
      auditEvent: { event: 'merge_accepted' },
      tokenConsumedWrite: { tokenId: 'tok-1' },
    });
    assert.deepStrictEqual(missing, {
      ok: false,
      error: { code: 'invalid_atomic_envelope', reason: 'invalid_sourceTransitions' },
    });
  });

  await test('issuePlanningMergeIntent issues server token and executePlanningMerge consumes it atomically', async () => {
    const planningState = createPlanningApiState();
    const compareReceipt = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1', repoId: 'repo-1' },
      {
        requestedScopes: ['repo'],
        deniedScopes: [],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        implementedOutcomes: { sources: [] },
        versionVector: { pinned: { planningRecordsVersion: 2 } },
        newerDataAvailable: false,
      },
      Date.parse('2026-02-26T01:00:00.000Z'),
    );

    const intent = issuePlanningMergeIntent(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload: {
        compareReceiptId: compareReceipt.receiptId,
        targetId: 'target-1',
        sourceIds: ['source-1'],
      },
      nowMs: Date.parse('2026-02-26T01:00:00.000Z'),
    });

    assert.strictEqual(intent.statusCode, 200);
    assert.ok(intent.body.intentToken);

    const merge = executePlanningMerge(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload: {
        idempotencyKey: 'merge-1',
        compareReceiptId: compareReceipt.receiptId,
        tokenId: intent.body.intentToken.tokenId,
        targetId: 'target-1',
        sourceIdsHash: intent.body.intentToken.sourceIdsHash,
        compareHash: intent.body.intentToken.compareHash,
        sourceIds: ['source-1'],
        versionVector: { planningRecordsVersion: 2 },
      },
      nowMs: Date.parse('2026-02-26T01:01:00.000Z'),
    });

    assert.strictEqual(merge.statusCode, 200);
    assert.strictEqual(merge.body.mergeAccepted, true);
    assert.strictEqual(merge.body.idempotency.replay, false);
    assert.ok(merge.body.mergeRecord);

    const replay = executePlanningMerge(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload: {
        idempotencyKey: 'merge-1',
        compareReceiptId: compareReceipt.receiptId,
        tokenId: intent.body.intentToken.tokenId,
        targetId: 'target-1',
        sourceIdsHash: intent.body.intentToken.sourceIdsHash,
        compareHash: intent.body.intentToken.compareHash,
        sourceIds: ['source-1'],
        versionVector: { planningRecordsVersion: 2 },
      },
      nowMs: Date.parse('2026-02-26T01:01:30.000Z'),
    });

    assert.strictEqual(replay.statusCode, 200);
    assert.strictEqual(replay.body.idempotency.replay, true);

    const consumedToken = executePlanningMerge(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload: {
        idempotencyKey: 'merge-2',
        compareReceiptId: compareReceipt.receiptId,
        tokenId: intent.body.intentToken.tokenId,
        targetId: 'target-1',
        sourceIdsHash: intent.body.intentToken.sourceIdsHash,
        compareHash: intent.body.intentToken.compareHash,
        sourceIds: ['source-1'],
        versionVector: { planningRecordsVersion: 2 },
      },
      nowMs: Date.parse('2026-02-26T01:02:00.000Z'),
    });

    assert.strictEqual(consumedToken.statusCode, 409);
    assert.deepStrictEqual(consumedToken.body.error, {
      code: 'invalid_confirmation_token',
      reason: 'token_consumed',
    });
  });

  await test('executePlanningMerge rejects snapshot mismatch', async () => {
    const planningState = createPlanningApiState();
    const compareReceipt = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1' },
      {
        requestedScopes: ['user'],
        deniedScopes: [],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        implementedOutcomes: { sources: [] },
        versionVector: { pinned: { planningRecordsVersion: 10 } },
        newerDataAvailable: false,
      },
      Date.parse('2026-02-26T01:10:00.000Z'),
    );

    const intent = issuePlanningMergeIntent(planningState, {
      context: { userId: 'user-1' },
      payload: {
        compareReceiptId: compareReceipt.receiptId,
        targetId: 'target-1',
        sourceIds: ['source-1'],
      },
      nowMs: Date.parse('2026-02-26T01:10:00.000Z'),
    });

    const mismatch = executePlanningMerge(planningState, {
      context: { userId: 'user-1' },
      payload: {
        idempotencyKey: 'merge-snapshot-mismatch',
        compareReceiptId: compareReceipt.receiptId,
        tokenId: intent.body.intentToken.tokenId,
        targetId: 'target-1',
        sourceIdsHash: intent.body.intentToken.sourceIdsHash,
        compareHash: intent.body.intentToken.compareHash,
        sourceIds: ['source-1'],
        versionVector: { planningRecordsVersion: 99 },
      },
      nowMs: Date.parse('2026-02-26T01:10:30.000Z'),
    });

    assert.strictEqual(mismatch.statusCode, 409);
    assert.deepStrictEqual(mismatch.body.error, {
      code: 'invalid_confirmation_token',
      reason: 'snapshot_version_mismatch',
    });
  });

  await test('issuePlanningMergeIntent rejects non-pass compare receipts', async () => {
    const planningState = createPlanningApiState();
    const compareReceipt = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1' },
      {
        requestedScopes: ['user'],
        deniedScopes: ['repo'],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        implementedOutcomes: { sources: [] },
        versionVector: { pinned: { planningRecordsVersion: 1 } },
        newerDataAvailable: false,
      },
      Date.parse('2026-02-26T01:20:00.000Z'),
    );

    const intent = issuePlanningMergeIntent(planningState, {
      context: { userId: 'user-1' },
      payload: {
        compareReceiptId: compareReceipt.receiptId,
        targetId: 'target-1',
        sourceIds: ['source-1'],
      },
      nowMs: Date.parse('2026-02-26T01:20:10.000Z'),
    });

    assert.strictEqual(intent.statusCode, 409);
    assert.deepStrictEqual(intent.body.error, {
      code: 'merge_gate_blocked',
      reason: 'denied_scopes_present',
    });
  });

  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});