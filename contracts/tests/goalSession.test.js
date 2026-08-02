const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION,
  GOAL_SESSION_FRAME_SCHEMA_VERSION,
  GOAL_SESSION_ASSURANCE_MODES,
  GOAL_SESSION_ASSURANCE_STATUSES,
  GOAL_SESSION_ATTENTION_SEVERITIES,
  GOAL_SESSION_ATTENTION_STATUSES,
  normalizeGoalSessionCheckpoint,
  normalizeGoalSessionFrame,
} = require('../dist');

function frameInput(overrides = {}) {
  return {
    schemaVersion: GOAL_SESSION_FRAME_SCHEMA_VERSION,
    kind: 'goal-session.frame',
    goalId: 'goal-self-improvement',
    successCriteria: ['Persist the plan across compaction.'],
    canonicalAuthority: 'instruction-engine/docs/system',
    planning: {
      surface: 'both',
      scopeKey: 'instruction-engine',
      goalRef: 'goal-self-improvement',
      roadmapRef: 'roadmap-self-improvement',
      planRef: 'plan:self-improvement',
      workPointRefs: ['wave-1'],
      projectRunRef: 'run-self-improvement',
      authorityStatus: 'resolved',
    },
    repositories: [{
      repositoryId: 'instruction-engine',
      branch: 'main',
      baseRef: 'abc123',
      headRef: 'def456',
      worktreeStatus: 'clean',
      ownedPaths: ['codex-assets/**'],
      changedPaths: [],
      commitRef: null,
    }],
    dependencyWaves: [{
      waveId: 'wave-1',
      dependsOn: [],
      status: 'active',
      workPointRef: 'wave-1',
      planRef: 'plan:self-improvement',
      projectRunRef: 'run-self-improvement',
    }],
    integrationOwner: 'root',
    readiness: {
      codeReadiness: ['Repository authority confirmed.'],
      environmentReadiness: ['No external gate required.'],
    },
    validation: [{
      waveId: 'wave-1',
      owner: 'test-runner',
      expectedEvidence: ['node --test'],
      status: 'pending',
    }],
    stopEscalationContinuation: {
      stop: ['Authority conflict'],
      escalate: ['Credential gate'],
      continueWhen: ['Validation passes'],
    },
    checkpointPolicy: {
      beforeFanOut: true,
      afterEachWave: true,
      beforePhaseTransition: true,
    },
    retrospectiveEligibility: 'manual_after_closure',
    ...overrides,
  };
}

function checkpointInput(overrides = {}) {
  return {
    schemaVersion: GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION,
    goalId: 'goal-self-improvement',
    phase: 'implementation',
    planning: frameInput().planning,
    completedWaveIds: [],
    activeWaveId: 'wave-1',
    decisions: ['Keep scheduled automation disabled.'],
    repositories: frameInput().repositories,
    validationEvidence: ['pending: node --test'],
    blockers: [],
    externalGates: [],
    nextAction: 'Run focused tests.',
    resume: {
      status: 'fresh',
      checkedAt: null,
      drift: [],
    },
    gitCheckpoint: {
      status: 'clean-no-commit',
      commitSha: null,
      reason: 'No commit requested.',
      validationRefs: [],
    },
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

test('normalizes a goal frame with durable roadmap and repository references', () => {
  const normalized = normalizeGoalSessionFrame(frameInput());
  assert.equal(normalized.schemaVersion, '1');
  assert.equal(normalized.planning.scopeKey, 'instruction-engine');
  assert.equal(normalized.planning.projectRunRef, 'run-self-improvement');
  assert.deepEqual(normalized.repositories[0].ownedPaths, ['codex-assets/**']);
  assert.deepEqual(normalized.assurancePolicy, { mode: 'normal', verificationStatus: 'not-requested', gateRef: null, evidenceRefs: [], decisionRef: null });
  assert.deepEqual(normalized.attentionSignals, []);
});

test('normalizes a v2 checkpoint with resume and git-boundary evidence', () => {
  const normalized = normalizeGoalSessionCheckpoint(checkpointInput());
  assert.equal(normalized.schemaVersion, '2');
  assert.equal(normalized.resume.status, 'fresh');
  assert.equal(normalized.gitCheckpoint.status, 'clean-no-commit');
  assert.deepEqual(normalized.assurancePolicy, { mode: 'normal', verificationStatus: 'not-requested', gateRef: null, evidenceRefs: [], decisionRef: null });
  assert.deepEqual(normalized.attentionSignals, []);
  assert.deepEqual(normalized.validationReceipts, []);
  assert.deepEqual(normalized.blockerRecords, []);
  assert.deepEqual(normalized.externalGateRecords, []);
});

test('normalizes structured validation, blocker, and external-gate receipts', () => {
  const normalized = normalizeGoalSessionCheckpoint(checkpointInput({
    validationReceipts: [{
      receiptId: 'validation-1',
      check: 'Focused goal-session tests',
      kind: 'test',
      status: 'passed',
      command: 'node --test contracts/tests/goalSession.test.js',
      exitCode: 0,
      durationMs: 125,
      artifactRef: null,
      observedAt: '2026-08-02T12:00:00.000Z',
      headRef: 'def456',
    }],
    blockerRecords: [{
      blockerId: 'environment-node',
      code: 'node-runtime-drift',
      severity: 'medium',
      owner: 'environment',
      blocking: false,
      status: 'accepted',
      evidenceRefs: ['node --version'],
      nextDecision: 'Upgrade at the next environment checkpoint.',
    }],
    externalGateRecords: [{
      gateId: 'hook-trust',
      owner: 'user',
      blocking: true,
      status: 'pending',
      evidenceRefs: ['hooks/list'],
      continueWhen: 'The installed hook is reviewed and trusted.',
    }],
  }));

  assert.equal(normalized.validationReceipts[0].exitCode, 0);
  assert.equal(normalized.blockerRecords[0].blocking, false);
  assert.equal(normalized.externalGateRecords[0].status, 'pending');
});

test('rejects malformed structured checkpoint receipts', () => {
  assert.throws(
    () => normalizeGoalSessionCheckpoint(checkpointInput({
      validationReceipts: [{
        receiptId: 'validation-1',
        check: 'Focused tests',
        kind: 'test',
        status: 'passed',
        command: null,
        exitCode: 0,
        durationMs: -1,
        artifactRef: null,
        observedAt: 'not-a-date',
        headRef: null,
      }],
    })),
    /durationMs|observedAt/,
  );
});

test('rejects a roadmap goal checkpoint without durable planning identity', () => {
  assert.throws(
    () => normalizeGoalSessionCheckpoint(checkpointInput({
      planning: { ...frameInput().planning, roadmapRef: null, planRef: null },
    })),
    /roadmapRef|planRef/,
  );
});

test('rejects repository drift states that omit a head or owned paths', () => {
  assert.throws(
    () => normalizeGoalSessionCheckpoint(checkpointInput({
      repositories: [{
        ...frameInput().repositories[0],
        headRef: '',
        ownedPaths: [],
      }],
    })),
    /headRef|ownedPaths/,
  );
});

test('rejects frames that the native hook would not persist', () => {
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({ successCriteria: [] })),
    /successCriteria/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({ checkpointPolicy: { beforeFanOut: true, afterEachWave: true, beforePhaseTransition: false } })),
    /checkpointPolicy/,
  );
});

test('rejects cyclic waves and validation references to unknown waves', () => {
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      dependencyWaves: [{ ...frameInput().dependencyWaves[0], dependsOn: ['wave-1'] }],
    })),
    /cycle|dependsOn|itself/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      validation: [{ ...frameInput().validation[0], waveId: 'missing-wave' }],
    })),
    /validation.*wave|unknown wave/,
  );
});

test('defaults assurance to low-friction normal mode and preserves bounded attention signals', () => {
  const normalized = normalizeGoalSessionFrame(frameInput({
    assurancePolicy: {
      mode: 'advisory',
      verificationStatus: 'suggested',
    },
    attentionSignals: [{
      signalId: 'risk-1',
      signalKey: 'unverified-assumption',
      severity: 'medium',
      summary: 'Deployment ownership is not yet confirmed.',
      evidenceRefs: ['frame:readiness.environmentReadiness[0]'],
      whyItMatters: 'The deployment wave may stop at an external gate.',
      whenToRevisit: 'Before entering deployment.',
      status: 'open',
    }],
  }));

  assert.deepEqual(normalized.assurancePolicy, { mode: 'advisory', verificationStatus: 'suggested', gateRef: null, evidenceRefs: [], decisionRef: null });
  assert.equal(normalized.attentionSignals[0].signalKey, 'unverified-assumption');
  assert.deepEqual(GOAL_SESSION_ASSURANCE_MODES, ['normal', 'advisory', 'strict']);
  assert.deepEqual(GOAL_SESSION_ASSURANCE_STATUSES, ['not-requested', 'suggested', 'requested', 'passed', 'blocked', 'stale']);
  assert.deepEqual(GOAL_SESSION_ATTENTION_SEVERITIES, ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(GOAL_SESSION_ATTENTION_STATUSES, ['open', 'accepted', 'resolved', 'stale']);
});

test('rejects unbounded or evidence-free attention signals', () => {
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      attentionSignals: [{
        signalId: 'risk-1',
        signalKey: 'scope-drift',
        severity: 'high',
        summary: 'Changed paths need review.',
        evidenceRefs: [],
        whyItMatters: 'The merge scope may be wrong.',
        whenToRevisit: 'Before merge.',
        status: 'open',
      }],
    })),
    /evidenceRefs/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      attentionSignals: Array.from({ length: 13 }, (_, index) => ({
        signalId: `risk-${index}`,
        signalKey: 'repeated-risk',
        severity: 'low',
        summary: 'Repeated signal.',
        evidenceRefs: [`evidence:${index}`],
        whyItMatters: 'It may matter later.',
        whenToRevisit: 'At the next relevant goal.',
        status: 'open',
      })),
    })),
    /at most 12/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      assurancePolicy: { mode: 'normal', verificationStatus: 'blocked' },
    })),
    /normal assurance/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      assurancePolicy: { mode: 'strict', verificationStatus: 'suggested' },
    })),
    /strict assurance/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      assurancePolicy: { mode: 'strict', verificationStatus: 'passed', gateRef: 'deploy:production' },
    })),
    /evidenceRefs/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      assurancePolicy: { mode: 'strict', verificationStatus: 'blocked', gateRef: 'deploy:production', evidenceRefs: ['check:deployment-readiness'] },
    })),
    /decisionRef/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      attentionSignals: [{
        signalId: 'risk-1',
        signalKey: 'scope-drift',
        severity: 'high',
        summary: 'Changed paths need review.',
        evidenceRefs: ['   '],
        whyItMatters: 'The merge scope may be wrong.',
        whenToRevisit: 'Before merge.',
        status: 'open',
      }],
    })),
    /evidenceRefs/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      attentionSignals: [{
        signalId: 'risk-1',
        signalKey: 'scope-drift',
        severity: 'high',
        summary: 'x'.repeat(513),
        evidenceRefs: ['evidence:1'],
        whyItMatters: 'The merge scope may be wrong.',
        whenToRevisit: 'Before merge.',
        status: 'open',
      }],
    })),
    /exceeds 512/,
  );
  assert.throws(
    () => normalizeGoalSessionFrame(frameInput({
      successCriteria: Array.from({ length: 80 }, (_, index) => `criterion-${index}-${'x'.repeat(300)}`),
    })),
    /frame exceeds the size limit/,
  );
});

test('normalizes explicit strict assurance evidence and user decision references', () => {
  const normalized = normalizeGoalSessionFrame(frameInput({
    assurancePolicy: {
      mode: 'strict',
      verificationStatus: 'blocked',
      gateRef: 'deploy:production',
      evidenceRefs: ['check:deployment-readiness'],
      decisionRef: 'user:accepted-blocked',
    },
  }));
  assert.deepEqual(normalized.assurancePolicy, {
    mode: 'strict',
    verificationStatus: 'blocked',
    gateRef: 'deploy:production',
    evidenceRefs: ['check:deployment-readiness'],
    decisionRef: 'user:accepted-blocked',
  });
});
