import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateRollbackCandidate, evaluateRollbackCurrentVersion, resolveRollbackPolicy } from './rollbackPolicy';

test('resolveRollbackPolicy fails closed when source is unavailable', () => {
  const policy = resolveRollbackPolicy(null);
  assert.deepStrictEqual(policy, {
    ok: false,
    reason: 'rollback_policy_source_unavailable',
  });

  const decision = evaluateRollbackCurrentVersion({
    channel: 'stable',
    currentVersion: '1.2.3',
    rollbackPolicy: policy,
  });

  assert.deepStrictEqual(decision, {
    allowed: false,
    reason: 'rollback_policy_source_unavailable',
  });
});

test('resolveRollbackPolicy rejects malformed input', () => {
  const malformed = resolveRollbackPolicy('{"updatesEnabled":"yes"}');
  assert.deepStrictEqual(malformed, {
    ok: false,
    reason: 'rollback_policy_malformed',
  });
});

test('global updates disabled blocks current and candidates', () => {
  const policy = resolveRollbackPolicy('{"updatesEnabled":false}');
  assert.equal(policy.ok, true);

  const currentDecision = evaluateRollbackCurrentVersion({
    channel: 'stable',
    currentVersion: '1.2.3',
    rollbackPolicy: policy,
  });
  assert.strictEqual(currentDecision.reason, 'updates_disabled_globally');

  const candidateDecision = evaluateRollbackCandidate({
    channel: 'stable',
    currentVersion: '1.2.3',
    candidateVersion: '1.2.4',
    rollbackPolicy: policy,
  });
  assert.strictEqual(candidateDecision.reason, 'updates_disabled_globally');
});

test('minimum safe threshold and channel ceiling enforce rollback guardrails', () => {
  const policy = resolveRollbackPolicy(
    JSON.stringify({
      updatesEnabled: true,
      minimumSafeVersion: '1.2.3',
      channelVersionCeilings: {
        stable: '1.2.5',
      },
    }),
  );
  assert.equal(policy.ok, true);

  const unsafeCurrent = evaluateRollbackCurrentVersion({
    channel: 'stable',
    currentVersion: '1.2.2',
    rollbackPolicy: policy,
  });
  assert.strictEqual(unsafeCurrent.reason, 'current_version_below_minimum_safe');

  const unsafeCandidate = evaluateRollbackCandidate({
    channel: 'stable',
    currentVersion: '1.2.3',
    candidateVersion: '1.2.2',
    rollbackPolicy: policy,
  });
  assert.strictEqual(unsafeCandidate.reason, 'candidate_version_below_minimum_safe');

  const aboveCeiling = evaluateRollbackCandidate({
    channel: 'stable',
    currentVersion: '1.2.3',
    candidateVersion: '1.2.6',
    rollbackPolicy: policy,
  });
  assert.strictEqual(aboveCeiling.reason, 'candidate_version_above_channel_ceiling');

  const allowed = evaluateRollbackCandidate({
    channel: 'stable',
    currentVersion: '1.2.3',
    candidateVersion: '1.2.5',
    rollbackPolicy: policy,
  });
  assert.deepStrictEqual(allowed, {
    allowed: true,
    reason: 'allowed_by_rollback_policy',
  });
});
