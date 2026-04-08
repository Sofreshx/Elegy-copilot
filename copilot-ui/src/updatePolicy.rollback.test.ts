import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRollbackPolicy } from './rollbackPolicy';
import {
  evaluateUpdateCandidate,
  evaluateUpdateCheck,
  resolveDesktopReleaseChannelContract,
} from './updatePolicy';

test('channel policy remains backward compatible when rollback policy is omitted', () => {
  const decision = evaluateUpdateCandidate({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    candidateVersion: '1.2.4',
  });

  assert.deepStrictEqual(decision, {
    channel: 'stable',
    allowed: true,
    reason: 'allowed_by_channel_policy',
  });
});

test('stable channel still blocks prerelease candidates before rollback checks', () => {
  const policy = resolveRollbackPolicy('{"updatesEnabled":true}');
  const decision = evaluateUpdateCandidate({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    candidateVersion: '1.2.4-rc.1',
    rollbackPolicy: policy,
  });

  assert.deepStrictEqual(decision, {
    channel: 'stable',
    allowed: false,
    reason: 'stable_channel_blocks_prerelease_candidate',
  });
});

test('rollback policy blocks update checks and candidates with machine-readable reasons', () => {
  const policy = resolveRollbackPolicy('{"updatesEnabled":false}');

  const checkDecision = evaluateUpdateCheck({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    rollbackPolicy: policy,
  });
  assert.deepStrictEqual(checkDecision, {
    channel: 'stable',
    allowed: false,
    reason: 'updates_disabled_globally',
  });

  const candidateDecision = evaluateUpdateCandidate({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    candidateVersion: '1.2.4',
    rollbackPolicy: policy,
  });
  assert.deepStrictEqual(candidateDecision, {
    channel: 'stable',
    allowed: false,
    reason: 'updates_disabled_globally',
  });
});

test('rollback policy fail-closed reason propagates through update decision logic', () => {
  const unavailablePolicy = resolveRollbackPolicy('');

  const decision = evaluateUpdateCheck({
    appVersion: '1.2.3',
    explicitChannel: 'stable',
    rollbackPolicy: unavailablePolicy,
  });

  assert.deepStrictEqual(decision, {
    channel: 'stable',
    allowed: false,
    reason: 'rollback_policy_source_unavailable',
  });
});

test('desktop release contract keeps app, sdk, and cli lanes aligned', () => {
  assert.deepStrictEqual(
    resolveDesktopReleaseChannelContract({
      appVersion: '1.2.3-rc.1',
    }),
    {
      ok: true,
      contract: {
        channel: 'prerelease',
        sdkChannel: 'prerelease',
        cliChannel: 'prerelease',
      },
    },
  );
});

test('invalid explicit update channel fails closed instead of drifting to inferred lane', () => {
  assert.deepStrictEqual(
    resolveDesktopReleaseChannelContract({
      appVersion: '1.2.3-rc.1',
      explicitChannel: 'beta',
    }),
    {
      ok: false,
      contract: {
        channel: 'unknown',
        sdkChannel: 'unknown',
        cliChannel: 'unknown',
      },
      reason: 'update_channel_invalid',
      explicitChannel: 'beta',
    },
  );

  assert.deepStrictEqual(
    evaluateUpdateCheck({
      appVersion: '1.2.3-rc.1',
      explicitChannel: 'beta',
      rollbackPolicy: resolveRollbackPolicy('{"updatesEnabled":true}'),
    }),
    {
      channel: 'unknown',
      allowed: false,
      reason: 'update_channel_invalid',
    },
  );
});
