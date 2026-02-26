'use strict';

const assert = require('assert');

const {
  containsUnsafeShellSyntax,
  validateOpenTerminalLifecyclePayload,
  validateFinishLifecyclePayload,
  validateFinishCanonicalSandboxIdInvariant,
  canReadPlanningRecord,
  canWritePlanningRecord,
  filterPlanningRecordsForCompare,
  validatePlanningMergeConfirmationToken,
  validatePlanningMergeIdempotency,
  validatePlanningMergeAtomicEnvelope,
  deriveBackfillRecoveryMarker,
  recordPlanningCompareReceipt,
  issuePlanningMergeIntent,
  executePlanningMerge,
  rollbackMergeCommitAfterPersistenceFailure,
  evaluatePlanningDurabilityDependencyGate,
  resolveLifecycleCapabilityGate,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  evaluateLifecycleMixedVersionCompatibility,
} = require('./server');
const {
  createPlanningApiState,
  FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION,
} = require('./lib/planningApiContracts');

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

  await test('validateOpenTerminalLifecyclePayload rejects missing sandboxId deterministically', async () => {
    const result = validateOpenTerminalLifecyclePayload({});

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: 'missing_or_invalid_sandbox_id',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload rejects invalid sandboxId format deterministically', async () => {
    const result = validateOpenTerminalLifecyclePayload({ sandboxId: 'sb_invalid' });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: 'invalid_sandbox_id_format',
      },
    });
  });

  await test('validateOpenTerminalLifecyclePayload rejects unexpected fields deterministically', async () => {
    const result = validateOpenTerminalLifecyclePayload({ sandboxId: 'sb-1', extra: true });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: 'unexpected_field:extra',
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

  await test('validateFinishLifecyclePayload accepts finish payload without PR path (defaults skip-pr)', async () => {
    const result = validateFinishLifecyclePayload({
      sandboxId: 'sb-edited-canonical',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        sandboxId: 'sb-edited-canonical',
        prAction: 'skip-pr',
      },
    });
  });

  await test('validateFinishLifecyclePayload accepts finish payload with open-pr path', async () => {
    const result = validateFinishLifecyclePayload({
      sandboxId: 'sb-edited-canonical',
      prAction: 'open-pr',
      baseBranch: 'main',
      headBranch: 'feature/canonical-id',
    });

    assert.deepStrictEqual(result, {
      ok: true,
      value: {
        sandboxId: 'sb-edited-canonical',
        prAction: 'open-pr',
        baseBranch: 'main',
        headBranch: 'feature/canonical-id',
      },
    });
  });

  await test('validateFinishLifecyclePayload rejects PR branches when action is not open-pr', async () => {
    const result = validateFinishLifecyclePayload({
      sandboxId: 'sb-edited-canonical',
      prAction: 'skip-pr',
      baseBranch: 'main',
      headBranch: 'feature/canonical-id',
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'invalid_lifecycle_payload',
        reason: 'pr_branches_require_open_pr_action',
      },
    });
  });

  await test('validateFinishCanonicalSandboxIdInvariant keeps canonical sandboxId stable for skip-pr finish path', async () => {
    const result = validateFinishCanonicalSandboxIdInvariant({
      canonicalSandboxId: 'sb-edited-canonical',
      prAction: 'skip-pr',
      trackerBody: {
        ok: true,
        action: 'finish',
        result: {
          sandboxId: 'sb-edited-canonical',
          status: 'finished',
          close: {
            result: {
              sandboxId: 'sb-edited-canonical',
            },
          },
        },
      },
      providerState: {
        selectedProvider: 'non-docker',
        defaultProvider: 'non-docker',
      },
    });

    assert.deepStrictEqual(result, { ok: true });
  });

  await test('validateFinishCanonicalSandboxIdInvariant keeps canonical sandboxId stable for open-pr finish path', async () => {
    const result = validateFinishCanonicalSandboxIdInvariant({
      canonicalSandboxId: 'sb-edited-canonical',
      prAction: 'open-pr',
      trackerBody: {
        ok: true,
        action: 'finish',
        result: {
          sandboxId: 'sb-edited-canonical',
          status: 'finished',
          pr: {
            action: 'open-pr',
            outcome: 'open-pr:failure',
          },
          close: {
            result: {
              sandboxId: 'sb-edited-canonical',
            },
          },
        },
      },
      providerState: {
        selectedProvider: 'docker',
        defaultProvider: 'non-docker',
      },
    });

    assert.deepStrictEqual(result, { ok: true });
  });

  await test('validateFinishCanonicalSandboxIdInvariant returns deterministic conflict marker when skip-pr path rewrites canonical sandboxId', async () => {
    const result = validateFinishCanonicalSandboxIdInvariant({
      canonicalSandboxId: 'sb-edited-canonical',
      prAction: 'skip-pr',
      trackerBody: {
        ok: true,
        action: 'finish',
        result: {
          sandboxId: 'sb-rewritten',
          status: 'finished',
        },
      },
      providerState: {
        selectedProvider: 'non-docker',
        defaultProvider: 'non-docker',
      },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, 409);
    assert.strictEqual(result.body.error, 'Lifecycle canonical sandboxId invariant violated');
    assert.strictEqual(result.body.code, 'canonical_sandbox_id_invariant_violation');
    assert.strictEqual(result.body.reason, 'canonical_sandbox_id_mismatch');
    assert.strictEqual(result.body.deterministic, true);
    assert.ok(result.body.invariant);
    assert.strictEqual(result.body.invariant.marker, 'conflict');
    assert.strictEqual(result.body.invariant.expectedSandboxId, 'sb-edited-canonical');
    assert.strictEqual(result.body.invariant.receivedSandboxId, 'sb-rewritten');
    assert.strictEqual(result.body.invariant.receivedPath, 'result.sandboxId');
    assert.deepStrictEqual(result.body.invariant.reasonCodes, [
      'canonical_sandbox_id_mismatch',
      'canonical_sandbox_id_persisted_invariant',
      'finish_pr_skip_path',
    ]);
  });

  await test('validateFinishCanonicalSandboxIdInvariant returns deterministic conflict marker when open-pr path rewrites canonical sandboxId', async () => {
    const result = validateFinishCanonicalSandboxIdInvariant({
      canonicalSandboxId: 'sb-edited-canonical',
      prAction: 'open-pr',
      trackerBody: {
        ok: true,
        action: 'finish',
        result: {
          sandboxId: 'sb-edited-canonical',
          close: {
            result: {
              sandboxId: 'sb-rewritten-open-pr',
            },
          },
        },
      },
      providerState: {
        selectedProvider: 'docker',
        defaultProvider: 'non-docker',
        migration: {
          required: true,
          reasonCodes: ['persisted_selected_provider_invalid'],
        },
      },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.statusCode, 409);
    assert.strictEqual(result.body.code, 'canonical_sandbox_id_invariant_violation');
    assert.strictEqual(result.body.invariant.marker, 'conflict');
    assert.strictEqual(result.body.invariant.receivedPath, 'result.close.result.sandboxId');
    assert.strictEqual(result.body.invariant.expectedSandboxId, 'sb-edited-canonical');
    assert.strictEqual(result.body.invariant.receivedSandboxId, 'sb-rewritten-open-pr');
    assert.ok(result.body.invariant.reasonCodes.includes('finish_pr_open_path'));
    assert.ok(result.body.invariant.reasonCodes.includes('provider_state_migration_present'));
    assert.deepStrictEqual(result.body.invariant.providerState.migration, {
      required: true,
      reasonCodes: ['persisted_selected_provider_invalid'],
    });
  });

  await test('containsUnsafeShellSyntax detects expansion markers', async () => {
    assert.strictEqual(containsUnsafeShellSyntax('safe-id'), false);
    assert.strictEqual(containsUnsafeShellSyntax('bad$HOME'), true);
    assert.strictEqual(containsUnsafeShellSyntax('bad%USERPROFILE%'), true);
  });

  await test('resolveLifecycleCapabilityGate allows shared lifecycle capabilities for both providers', async () => {
    const actions = ['create', 'start', 'stop', 'open-terminal'];
    const providers = ['non-docker', 'docker'];

    for (const provider of providers) {
      for (const action of actions) {
        const gate = resolveLifecycleCapabilityGate(action, {
          selectedProvider: provider,
          defaultProvider: provider,
        });
        assert.strictEqual(gate.allowed, true);
        assert.strictEqual(gate.capability.provider, provider);
        assert.strictEqual(gate.capability.action, action);
        assert.strictEqual(gate.capability.shared, true);
        assert.strictEqual(gate.capability.supported, true);
        assert.ok(gate.finishCompatibilityHook);
        assert.strictEqual(gate.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
        assert.strictEqual(gate.finishCompatibilityHook.kind, 'lifecycle.finish.compatibility-hook');
        assert.strictEqual(gate.finishCompatibilityHook.providerAgnostic, true);
      }
    }
  });

  await test('resolveLifecycleCapabilityGate allows finish lifecycle action for both providers', async () => {
    const providers = ['non-docker', 'docker'];

    for (const provider of providers) {
      const gate = resolveLifecycleCapabilityGate('finish', {
        selectedProvider: provider,
        defaultProvider: provider,
      });

      assert.strictEqual(gate.allowed, true);
      assert.strictEqual(gate.capability.provider, provider);
      assert.strictEqual(gate.capability.action, 'finish');
      assert.strictEqual(gate.capability.shared, true);
      assert.strictEqual(gate.capability.supported, true);
      assert.strictEqual(gate.capability.reason, 'finish_sequence_supported');
      assert.ok(gate.finishCompatibilityHook);
      assert.strictEqual(gate.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
    }
  });

  await test('resolveLifecycleCapabilityGate returns deterministic unsupported marker for non-shared capabilities', async () => {
    const gate = resolveLifecycleCapabilityGate('pr-open', {
      selectedProvider: 'non-docker',
      defaultProvider: 'non-docker',
    });

    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.statusCode, 501);
    assert.strictEqual(gate.body.error, 'Lifecycle capability unsupported');
    assert.strictEqual(gate.body.code, 'lifecycle_capability_unsupported');
    assert.strictEqual(gate.body.action, 'pr-open');
    assert.strictEqual(gate.body.reason, 'provider_capability_unsupported');
    assert.strictEqual(gate.body.deterministic, true);
    assert.strictEqual(gate.body.unsupported.marker, 'unsupported');
    assert.strictEqual(gate.body.unsupported.provider, 'non-docker');
    assert.strictEqual(gate.body.unsupported.shared, false);
    assert.ok(gate.finishCompatibilityHook);
    assert.strictEqual(gate.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
    assert.ok(gate.body.finishCompatibilityHook);
    assert.strictEqual(gate.body.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
    assert.ok(gate.body.capability.finishCompatibilityHook);
  });

  await test('evaluateLifecycleMixedVersionCompatibility fails closed for new client against old tracker when compatibility headers are missing', async () => {
    const result = evaluateLifecycleMixedVersionCompatibility({
      action: 'create',
      direction: 'new_client_old_tracker',
      headers: {},
    });

    assert.strictEqual(result.compatible, false);
    assert.strictEqual(result.statusCode, 501);
    assert.strictEqual(result.reason, 'tracker_contract_version_missing');
    assert.strictEqual(result.body.error, 'Lifecycle compatibility unsupported');
    assert.strictEqual(result.body.code, 'lifecycle_compatibility_unsupported');
    assert.strictEqual(result.body.action, 'create');
    assert.strictEqual(result.body.deterministic, true);
    assert.strictEqual(result.body.unsupported.marker, 'unsupported');
    assert.strictEqual(result.body.unsupported.direction, 'new_client_old_tracker');
    assert.strictEqual(result.body.unsupported.expected.contractVersion, LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION);
    assert.strictEqual(result.body.unsupported.expected.capability, LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY);
    assert.strictEqual(result.body.unsupported.received.contractVersion, null);
    assert.strictEqual(result.body.unsupported.received.capability, null);
  });

  await test('evaluateLifecycleMixedVersionCompatibility accepts supported tracker compatibility headers deterministically', async () => {
    const result = evaluateLifecycleMixedVersionCompatibility({
      action: 'finish',
      direction: 'new_client_old_tracker',
      headers: {
        'x-instruction-engine-lifecycle-contract-version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
        'x-instruction-engine-lifecycle-capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
      },
    });

    assert.deepStrictEqual(result, {
      compatible: true,
      direction: 'new_client_old_tracker',
      reason: 'compatibility_supported',
      receivedContractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
      receivedCapability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
    });
  });

  await test('evaluatePlanningDurabilityDependencyGate reports deterministic ready marker when WS3 authority contracts are satisfied', async () => {
    const gate = evaluatePlanningDurabilityDependencyGate({
      env: {
        INSTRUCTION_ENGINE_FORCE_WS3_AUTHORITY_GATE_BLOCKED: '0',
      },
    });

    assert.strictEqual(gate.deterministic, true);
    assert.strictEqual(gate.required, true);
    assert.strictEqual(gate.ready, true);
    assert.strictEqual(gate.marker, 'ready');
    assert.strictEqual(gate.reason, 'ws3_authority_contract_ready');
    assert.deepStrictEqual(gate.reasonCodes, ['ws3_authority_contract_ready']);
    assert.ok(gate.ws3);
    assert.ok(gate.ws3.sessionReconciliationContractVersion);
    assert.ok(gate.ws3.planningPrecedenceContractVersion);
    assert.ok(gate.ws3.planningScopePrecedence.user > gate.ws3.planningScopePrecedence.repo);
    assert.ok(gate.ws3.planningScopePrecedence.repo > gate.ws3.planningScopePrecedence.global);
    assert.ok(gate.ws3.sourcePrecedence.runtime > gate.ws3.sourcePrecedence.artifact);
  });

  await test('evaluatePlanningDurabilityDependencyGate fails closed with explicit dependency marker when forced blocked', async () => {
    const gate = evaluatePlanningDurabilityDependencyGate({
      env: {
        INSTRUCTION_ENGINE_FORCE_WS3_AUTHORITY_GATE_BLOCKED: '1',
      },
    });

    assert.strictEqual(gate.deterministic, true);
    assert.strictEqual(gate.required, true);
    assert.strictEqual(gate.ready, false);
    assert.strictEqual(gate.marker, 'dependency-blocked');
    assert.strictEqual(gate.reason, 'ws3_authority_gate_forced_blocked');
    assert.deepStrictEqual(gate.reasonCodes, ['ws3_authority_gate_forced_blocked']);
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

  await test('recordPlanningCompareReceipt dedupes and sorts stale/conflict downgrade markers deterministically', async () => {
    const planningState = createPlanningApiState();

    const first = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1' },
      {
        requestedScopes: ['repo', 'user'],
        deniedScopes: ['repo', 'repo', 'user'],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        newerDataAvailable: true,
        implementedOutcomes: {
          sources: [
            { sourceId: 'source-z', sourceType: 'plan-md', status: 'stale', reason: 'source_stale' },
            { sourceId: 'source-a', sourceType: 'final-md', status: 'invalid', reason: 'schema_validation_failed' },
            { sourceId: 'source-a', sourceType: 'final-md', status: 'invalid', reason: 'schema_validation_failed' },
          ],
        },
        versionVector: { pinned: { planningRecordsVersion: 3 } },
      },
      Date.parse('2026-02-26T02:30:00.000Z'),
    );

    const second = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1' },
      {
        requestedScopes: ['user', 'repo'],
        deniedScopes: ['user', 'repo'],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        newerDataAvailable: true,
        implementedOutcomes: {
          sources: [
            { sourceId: 'source-a', sourceType: 'final-md', status: 'invalid', reason: 'schema_validation_failed' },
            { sourceId: 'source-z', sourceType: 'plan-md', status: 'stale', reason: 'source_stale' },
          ],
        },
        versionVector: { pinned: { planningRecordsVersion: 3 } },
      },
      Date.parse('2026-02-26T02:30:01.000Z'),
    );

    assert.strictEqual(first.gateState, 'auth-denied');
    assert.strictEqual(first.reason, 'denied_scopes_present');
    assert.strictEqual(second.gateState, 'auth-denied');
    assert.strictEqual(second.reason, 'denied_scopes_present');

    assert.deepStrictEqual(
      first.downgrade.staleMarkers.map((marker) => marker.sourceId),
      ['source-z', 'version-vector'],
    );
    assert.deepStrictEqual(
      first.downgrade.conflictMarkers.map((marker) => marker.sourceId),
      ['scope:repo', 'scope:user', 'source-a'],
    );
    assert.deepStrictEqual(first.downgrade.reasonCodes, [
      'denied_scope_present',
      'denied_scopes_present',
      'implemented_source_conflict',
      'implemented_source_stale',
      'newer_data_available',
      'schema_validation_failed',
      'source_stale',
    ]);

    assert.deepStrictEqual(second.downgrade.staleMarkers, first.downgrade.staleMarkers);
    assert.deepStrictEqual(second.downgrade.conflictMarkers, first.downgrade.conflictMarkers);
    assert.deepStrictEqual(second.downgrade.reasonCodes, first.downgrade.reasonCodes);
  });

  await test('deriveBackfillRecoveryMarker returns deterministic recovery-visible outputs for all checkpoint/ledger states', async () => {
    const consistent = deriveBackfillRecoveryMarker({ hasCheckpoint: true, hasLedgerData: true });
    assert.deepStrictEqual(consistent, {
      requiresRecovery: false,
      marker: null,
      status: null,
      reason: 'checkpoint_and_data_consistent',
    });

    const checkpointOnly = deriveBackfillRecoveryMarker({ hasCheckpoint: true, hasLedgerData: false });
    assert.strictEqual(checkpointOnly.requiresRecovery, true);
    assert.strictEqual(checkpointOnly.marker, 'recovery_checkpoint_only');
    assert.strictEqual(checkpointOnly.status, 'recovery_checkpoint_only');
    assert.strictEqual(checkpointOnly.reason, 'checkpoint_without_data');

    const ledgerOnly = deriveBackfillRecoveryMarker({ hasCheckpoint: false, hasLedgerData: true });
    assert.strictEqual(ledgerOnly.requiresRecovery, true);
    assert.strictEqual(ledgerOnly.marker, 'recovery_ledger_only');
    assert.strictEqual(ledgerOnly.status, 'recovery_ledger_only');
    assert.strictEqual(ledgerOnly.reason, 'data_without_checkpoint');

    const missingBoth = deriveBackfillRecoveryMarker({ hasCheckpoint: false, hasLedgerData: false });
    assert.strictEqual(missingBoth.requiresRecovery, true);
    assert.strictEqual(missingBoth.marker, 'recovery_missing_both');
    assert.strictEqual(missingBoth.status, 'recovery_missing_both');
    assert.strictEqual(missingBoth.reason, 'checkpoint_and_data_missing');
  });

  await test('deriveBackfillRecoveryMarker models crash write-through and restart recovery sequence deterministically', async () => {
    const crashAfterCheckpointWrite = deriveBackfillRecoveryMarker({
      hasCheckpoint: true,
      hasLedgerData: false,
    });

    assert.deepStrictEqual(crashAfterCheckpointWrite, {
      requiresRecovery: true,
      marker: 'recovery_checkpoint_only',
      status: 'recovery_checkpoint_only',
      reason: 'checkpoint_without_data',
    });

    const crashAfterLedgerWrite = deriveBackfillRecoveryMarker({
      hasCheckpoint: false,
      hasLedgerData: true,
    });

    assert.deepStrictEqual(crashAfterLedgerWrite, {
      requiresRecovery: true,
      marker: 'recovery_ledger_only',
      status: 'recovery_ledger_only',
      reason: 'data_without_checkpoint',
    });

    const recoveredAfterRestart = deriveBackfillRecoveryMarker({
      hasCheckpoint: true,
      hasLedgerData: true,
    });

    assert.deepStrictEqual(recoveredAfterRestart, {
      requiresRecovery: false,
      marker: null,
      status: null,
      reason: 'checkpoint_and_data_consistent',
    });

    const replayedRecoveryCheck = deriveBackfillRecoveryMarker({
      hasCheckpoint: true,
      hasLedgerData: true,
    });
    assert.deepStrictEqual(replayedRecoveryCheck, recoveredAfterRestart);
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

  await test('rollbackMergeCommitAfterPersistenceFailure clears merge replay state so retries re-attempt durable commit', async () => {
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
      Date.parse('2026-02-26T01:30:00.000Z'),
    );

    const intent = issuePlanningMergeIntent(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload: {
        compareReceiptId: compareReceipt.receiptId,
        targetId: 'target-1',
        sourceIds: ['source-1'],
      },
      nowMs: Date.parse('2026-02-26T01:30:00.000Z'),
    });

    const payload = {
      idempotencyKey: 'merge-rollback-1',
      compareReceiptId: compareReceipt.receiptId,
      tokenId: intent.body.intentToken.tokenId,
      targetId: 'target-1',
      sourceIdsHash: intent.body.intentToken.sourceIdsHash,
      compareHash: intent.body.intentToken.compareHash,
      sourceIds: ['source-1'],
      versionVector: { planningRecordsVersion: 2 },
    };

    const merge = executePlanningMerge(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload,
      nowMs: Date.parse('2026-02-26T01:31:00.000Z'),
    });

    assert.strictEqual(merge.statusCode, 200);
    assert.strictEqual(merge.body.idempotency.replay, false);
    assert.strictEqual(planningState.mergeIdempotencyRecords.has('merge-rollback-1'), true);
    assert.ok(planningState.mergeIntentTokens.get(intent.body.intentToken.tokenId).consumedAt);

    rollbackMergeCommitAfterPersistenceFailure(planningState, merge.body);

    assert.strictEqual(planningState.mergeIdempotencyRecords.has('merge-rollback-1'), false);
    assert.strictEqual(planningState.mergeIntentTokens.get(intent.body.intentToken.tokenId).consumedAt, null);

    const retry = executePlanningMerge(planningState, {
      context: { userId: 'user-1', repoId: 'repo-1' },
      payload,
      nowMs: Date.parse('2026-02-26T01:31:30.000Z'),
    });

    assert.strictEqual(retry.statusCode, 200);
    assert.strictEqual(retry.body.idempotency.replay, false);
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

  await test('recordPlanningCompareReceipt includes deterministic stale/conflict downgrade markers', async () => {
    const planningState = createPlanningApiState();
    const receipt = recordPlanningCompareReceipt(
      planningState,
      { userId: 'user-1' },
      {
        requestedScopes: ['user', 'repo'],
        deniedScopes: ['repo'],
        planningRecords: [{ recordId: 'source-1' }],
        matches: [{ recordId: 'source-1' }],
        newerDataAvailable: true,
        implementedOutcomes: {
          sources: [
            { sourceId: 'source-stale', sourceType: 'plan-md', status: 'stale', reason: 'source_stale' },
            { sourceId: 'source-invalid', sourceType: 'plans-index', status: 'invalid', reason: 'schema_validation_failed' },
          ],
        },
        versionVector: { pinned: { planningRecordsVersion: 5 } },
      },
      Date.parse('2026-02-26T01:25:00.000Z'),
    );

    assert.strictEqual(receipt.gateState, 'auth-denied');
    assert.strictEqual(receipt.reason, 'denied_scopes_present');
    assert.ok(receipt.downgrade);
    assert.strictEqual(receipt.downgrade.deterministic, true);
    assert.strictEqual(receipt.downgrade.downgraded, true);

    const staleReasons = receipt.downgrade.staleMarkers.map((marker) => marker.reason);
    assert.ok(staleReasons.includes('source_stale'));
    assert.ok(staleReasons.includes('newer_data_available'));

    const conflictReasons = receipt.downgrade.conflictMarkers.map((marker) => marker.reason);
    assert.ok(conflictReasons.includes('schema_validation_failed'));
    assert.ok(conflictReasons.includes('denied_scope_present'));

    assert.deepStrictEqual(receipt.downgrade.reasonCodes, [
      'denied_scope_present',
      'denied_scopes_present',
      'implemented_source_conflict',
      'implemented_source_stale',
      'newer_data_available',
      'schema_validation_failed',
      'source_stale',
    ]);
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