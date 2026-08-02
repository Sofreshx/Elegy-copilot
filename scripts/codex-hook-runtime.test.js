#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.resolve(
  __dirname,
  '..',
  'codex-assets',
  'hooks',
  'elegy-workflow-improvement',
  'elegy-codex-hook.mjs',
);

let passed = 0;

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-hook-runtime-'));
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

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

function writeVerifiedBinding(root, sessionId, threadId) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'bindings.json'), `${JSON.stringify({
    schemaVersion: 1,
    bindings: {
      [sessionId]: {
        canonicalThreadId: threadId,
        verified: true,
        verificationReceipt: 'desktop-runtime-binding-v1',
        boundAt: '2026-08-01T00:00:00.000Z',
      },
    },
  }, null, 2)}\n`);
}

function runHook(root, event, input, extraEnv = {}) {
  const result = childProcess.spawnSync(process.execPath, [hookPath, event], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      ELEGY_CODEX_WORKFLOW_HOME: root,
      ...extraEnv,
    },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function runQueue(root, ...args) {
  const result = childProcess.spawnSync(process.execPath, [hookPath, 'queue', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELEGY_CODEX_WORKFLOW_HOME: root,
      ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1',
    },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function runStatus(root, sessionId = '', cwd = process.cwd()) {
  const args = [hookPath, 'status'];
  if (sessionId) args.push(sessionId);
  const result = childProcess.spawnSync(process.execPath, args, {
    encoding: 'utf8',
    cwd,
    env: { ...process.env, ELEGY_CODEX_WORKFLOW_HOME: root },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function initializeGitRepository(root) {
  const repository = path.join(root, 'instruction-engine');
  fs.mkdirSync(repository, { recursive: true });
  const git = (...args) => {
    const result = childProcess.spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    return String(result.stdout || '').trim();
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'goal-session@example.invalid');
  git('config', 'user.name', 'Goal Session Test');
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'baseline\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'baseline');
  return { repository, git, headRef: git('rev-parse', 'HEAD') };
}

function checkpointJson(overrides = {}) {
  return {
    schemaVersion: '1',
    goalId: 'goal-hook-runtime',
    phase: 'implementation',
    completedWaveIds: ['wave-1'],
    activeWaveId: 'wave-2',
    decisions: ['Use only the native lifecycle hooks.'],
    repositoryHeads: ['instruction-engine: main -> abc123'],
    validationEvidence: ['node --test scripts/codex-hook-runtime.test.js: pending'],
    blockers: [],
    externalGates: ['none'],
    nextAction: 'Continue after compact.',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function checkpointMessage(overrides = {}) {
  return `SESSION_CHECKPOINT\n\`\`\`json\n${JSON.stringify(checkpointJson(overrides), null, 2)}\n\`\`\``;
}

function checkpointMessageFrom(checkpoint) {
  return `SESSION_CHECKPOINT\n\`\`\`json\n${JSON.stringify(checkpoint, null, 2)}\n\`\`\``;
}

function goalFrameJson(overrides = {}) {
  return {
    schemaVersion: '1',
    kind: 'goal-session.frame',
    goalId: 'goal-hook-runtime',
    successCriteria: ['Preserve a resumable goal run.'],
    canonicalAuthority: 'instruction-engine',
    planning: {
      surface: 'roadmap',
      scopeKey: 'instruction-engine',
      goalRef: 'goal-hook-runtime',
      roadmapRef: 'roadmap-hook-runtime',
      planRef: 'plan-hook-runtime',
      workPointRefs: ['wp-hook-runtime'],
      projectRunRef: 'run-hook-runtime',
      authorityStatus: 'resolved',
    },
    repositories: [{
      repositoryId: 'instruction-engine',
      branch: 'main',
      baseRef: 'main',
      headRef: 'abc123',
      worktreeStatus: 'clean',
      ownedPaths: ['codex-assets/**'],
      changedPaths: [],
      commitRef: 'abc123',
    }],
    dependencyWaves: [{
      waveId: 'wave-1',
      dependsOn: [],
      status: 'active',
      workPointRef: 'wp-hook-runtime',
      planRef: 'plan-hook-runtime',
      projectRunRef: 'run-hook-runtime',
    }],
    integrationOwner: 'root',
    readiness: { codeReadiness: ['ready'], environmentReadiness: ['not-applicable'] },
    validation: [{ waveId: 'wave-1', owner: 'test-runner', expectedEvidence: ['focused test'], status: 'pending' }],
    stopEscalationContinuation: { stop: ['authority drift'], escalate: ['root'], continueWhen: ['validation passes'] },
    checkpointPolicy: { beforeFanOut: true, afterEachWave: true, beforePhaseTransition: true },
    retrospectiveEligibility: 'manual_after_closure',
    ...overrides,
  };
}

function goalFrameMessage(overrides = {}) {
  return `GOAL_SESSION_FRAME\n\`\`\`json\n${JSON.stringify(goalFrameJson(overrides), null, 2)}\n\`\`\``;
}

function checkpointV2Json(overrides = {}) {
  return {
    schemaVersion: '2',
    goalId: 'goal-hook-runtime',
    phase: 'implementation',
    planning: goalFrameJson().planning,
    completedWaveIds: ['wave-1'],
    activeWaveId: 'wave-1',
    decisions: ['Use only the native lifecycle hooks.'],
    repositories: goalFrameJson().repositories,
    validationEvidence: ['focused hook test: pending'],
    blockers: [],
    externalGates: ['none'],
    nextAction: 'Continue after compact.',
    resume: { status: 'fresh', checkedAt: null, drift: [] },
    gitCheckpoint: { status: 'clean-no-commit', commitSha: null, reason: 'manual run', validationRefs: ['focused hook test'] },
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function goalAndCheckpointV2Message() {
  return `${goalFrameMessage()}\n${checkpointMessageFrom(checkpointV2Json())}`;
}

function agentResultMessage(status = 'completed', overrides = {}) {
  return `AGENT_RESULT\n\`\`\`json\n${JSON.stringify({
    taskId: 'task-1',
    agentId: 'child-1',
    role: 'worker',
    status,
    ownedScope: ['codex-assets/hooks/**'],
    repositoryId: 'instruction-engine',
    baseRef: 'main',
    headRef: 'abc123',
    outcome: ['Implemented hook runtime.'],
    evidence: ['focused test'],
    validation: ['pass'],
    dependencies: [],
    blockers: [],
    residualRisks: [],
    payload: { kind: 'implementation', changes: [], handoff: null },
    ...overrides,
  }, null, 2)}\n\`\`\``;
}

test('Stop persists only a valid last-assistant SESSION_CHECKPOINT for a verified binding', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-a', 'thread-a');
    const result = runHook(root, 'Stop', {
      session_id: 'codex-session-a',
      last_assistant_message: [
        checkpointMessage({ nextAction: 'Run the focused hook tests.' }),
      ].join(''),
    });

    assert.strictEqual(result.continue, true);
    const checkpointPath = path.join(root, 'sessions', 'thread-a', 'checkpoint.json');
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    assert.strictEqual(checkpoint.canonicalThreadId, 'thread-a');
    assert.strictEqual(checkpoint.codexSessionId, 'codex-session-a');
    assert.match(checkpoint.checkpointId, /^cp-[a-f0-9]{10}-000001$/);
    assert.strictEqual(checkpoint.sequence, 1);
    assert.strictEqual(checkpoint.previousCheckpointId, null);
    assert.strictEqual(checkpoint.checkpoint.nextAction, 'Run the focused hook tests.');
    assert.deepStrictEqual(checkpoint.checkpoint.completedWaveIds, ['wave-1']);
    assert.match(checkpoint.expiresAt, /^2026-/);
    assert.ok(fs.existsSync(path.join(root, 'sessions', 'thread-a', 'checkpoints', `${checkpoint.checkpointId}.json`)));
  });
});

test('Stop retains ordered checkpoint history and keeps checkpoint.json as the latest compatible record', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-history', 'thread-history');
    runHook(root, 'Stop', {
      session_id: 'codex-session-history',
      last_assistant_message: checkpointMessage({ nextAction: 'First action.' }),
    });
    const first = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-history', 'checkpoint.json'), 'utf8'));
    runHook(root, 'Stop', {
      session_id: 'codex-session-history',
      last_assistant_message: checkpointMessage({ nextAction: 'Second action.', updatedAt: '2026-08-01T00:01:00.000Z' }),
    });
    const second = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-history', 'checkpoint.json'), 'utf8'));
    assert.strictEqual(second.sequence, 2);
    assert.strictEqual(second.previousCheckpointId, first.checkpointId);
    assert.strictEqual(second.checkpoint.nextAction, 'Second action.');
    assert.strictEqual(fs.readdirSync(path.join(root, 'sessions', 'thread-history', 'checkpoints')).length, 2);
  });
});

test('runtime status distinguishes unbound, bound, persisted, and Git-drift states', () => {
  withTempDir((root) => {
    const { repository, headRef } = initializeGitRepository(root);
    assert.strictEqual(runStatus(root, 'missing-session', repository).activationState, 'unbound');
    writeVerifiedBinding(root, 'codex-session-status', 'thread-status');
    assert.strictEqual(runStatus(root, 'codex-session-status', repository).activationState, 'bound');
    const frame = goalFrameJson({
      repositories: [{
        ...goalFrameJson().repositories[0],
        branch: 'main',
        baseRef: headRef,
        headRef,
        worktreeStatus: 'clean',
        changedPaths: [],
        commitRef: headRef,
      }],
    });
    const checkpoint = checkpointV2Json({
      planning: frame.planning,
      repositories: frame.repositories,
      activeWaveId: 'wave-1',
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-status',
      cwd: repository,
      last_assistant_message: `${goalFrameMessage(frame)}\n${checkpointMessageFrom(checkpoint)}`,
    });
    const persisted = runStatus(root, 'codex-session-status', repository);
    assert.strictEqual(persisted.activationState, 'checkpoint-persisted');
    assert.strictEqual(persisted.historyCount, 1);
    assert.strictEqual(persisted.reconciliation.status, 'reconciled');
    assert.strictEqual(persisted.operatorView.phase, 'implementation');
    assert.strictEqual(persisted.operatorView.reconciliationStatus, 'reconciled');
    fs.writeFileSync(path.join(repository, 'tracked.txt'), 'drifted\n');
    const drifted = runStatus(root, 'codex-session-status', repository);
    assert.strictEqual(drifted.reconciliation.status, 'drifted');
    assert.ok(drifted.reconciliation.drift.some((entry) => entry.code === 'worktree_status_changed'));
  });
});

test('PreCompact never needs a transcript and SessionStart injects the latest same-session checkpoint', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-b', 'thread-b');
    runHook(root, 'Stop', {
      session_id: 'codex-session-b',
      last_assistant_message: checkpointMessage(),
    });
    const precompact = runHook(root, 'PreCompact', {
      session_id: 'codex-session-b',
      transcript_path: path.join(root, 'must-not-be-read.jsonl'),
      trigger: 'auto',
    });
    assert.strictEqual(precompact.continue, true);
    const precompactState = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-b', 'precompact.json'), 'utf8'));
    assert.strictEqual(precompactState.checkpointStatus, 'valid');

    const started = runHook(root, 'SessionStart', {
      session_id: 'codex-session-b',
      source: 'compact',
    });
    assert.strictEqual(started.continue, true);
    assert.match(started.hookSpecificOutput.additionalContext, /Continue after compact/);
    assert.ok(Buffer.byteLength(started.hookSpecificOutput.additionalContext, 'utf8') <= 1500);
  });
});

test('Stop accepts a schema-valid checkpoint even when JSON key order differs from the emission order', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-reordered', 'thread-reordered');
    const reordered = Object.fromEntries(Object.entries(checkpointJson()).reverse());
    runHook(root, 'Stop', {
      session_id: 'codex-session-reordered',
      last_assistant_message: checkpointMessageFrom(reordered),
    });
    const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-reordered', 'checkpoint.json'), 'utf8'));
    assert.strictEqual(checkpoint.checkpoint.goalId, 'goal-hook-runtime');
  });
});

test('compact injection keeps a near-6KiB valid checkpoint within the conservative 1,500-token context cap', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-large', 'thread-large');
    const validationEvidence = Array.from({ length: 20 }, (_, index) => `validation-${index}: ${'x'.repeat(220)}`);
    runHook(root, 'Stop', {
      session_id: 'codex-session-large',
      last_assistant_message: checkpointMessage({ validationEvidence }),
    });
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-large', source: 'compact' });
    const context = started.hookSpecificOutput.additionalContext;
    assert.ok(Math.ceil(Buffer.byteLength(context, 'utf8') / 3) <= 1500);
    const injectedJson = context.match(/SESSION_CHECKPOINT\n```json\n([\s\S]*?)\n```/)[1];
    assert.strictEqual(JSON.parse(injectedJson).goalId, 'goal-hook-runtime');
  });
});

test('Stop persists the goal frame and schema-v2 checkpoint, then compact resume injects planning refs', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-v2', 'thread-v2');
    runHook(root, 'Stop', {
      session_id: 'codex-session-v2',
      last_assistant_message: goalAndCheckpointV2Message(),
    });
    const sessionRoot = path.join(root, 'sessions', 'thread-v2');
    const frame = JSON.parse(fs.readFileSync(path.join(sessionRoot, 'goal-session.json'), 'utf8'));
    const checkpoint = JSON.parse(fs.readFileSync(path.join(sessionRoot, 'checkpoint.json'), 'utf8'));
    assert.strictEqual(frame.frame.kind, 'goal-session.frame');
    assert.strictEqual(frame.frame.planning.roadmapRef, 'roadmap-hook-runtime');
    assert.strictEqual(checkpoint.checkpoint.schemaVersion, '2');
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-v2', source: 'compact' });
    assert.match(started.hookSpecificOutput.additionalContext, /roadmap-hook-runtime/);
    assert.match(started.hookSpecificOutput.additionalContext, /schemaVersion/);
  });
});

test('schema-v2 checkpoints preserve structured evidence records while legacy strings remain valid', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-structured', 'thread-structured');
    const checkpoint = checkpointV2Json({
      validationReceipts: [{
        receiptId: 'focused-tests',
        check: 'Focused hook runtime tests',
        kind: 'test',
        status: 'passed',
        command: 'node scripts/codex-hook-runtime.test.js',
        exitCode: 0,
        durationMs: 250,
        artifactRef: null,
        observedAt: '2026-08-02T12:00:00.000Z',
        headRef: 'abc123',
      }],
      blockerRecords: [{
        blockerId: 'runtime-version',
        code: 'node-runtime-drift',
        severity: 'medium',
        owner: 'environment',
        blocking: false,
        status: 'accepted',
        evidenceRefs: ['node --version'],
        nextDecision: 'Upgrade later.',
      }],
      externalGateRecords: [{
        gateId: 'hook-trust',
        owner: 'user',
        blocking: true,
        status: 'pending',
        evidenceRefs: ['hooks/list'],
        continueWhen: 'Trust is confirmed.',
      }],
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-structured',
      last_assistant_message: checkpointMessageFrom(checkpoint),
    });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-structured', 'checkpoint.json'), 'utf8'));
    assert.strictEqual(persisted.checkpoint.validationReceipts[0].status, 'passed');
    assert.strictEqual(persisted.checkpoint.blockerRecords[0].blocking, false);
    assert.strictEqual(persisted.checkpoint.externalGateRecords[0].gateId, 'hook-trust');
  });
});

test('optional assurance policy and attention signals survive checkpoint persistence and compact resume', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-attention', 'thread-attention');
    const attentionSignals = [{
      signalId: 'risk-deployment-owner',
      signalKey: 'environment-gate',
      severity: 'medium',
      summary: 'Deployment ownership is not confirmed.',
      evidenceRefs: ['frame:readiness.environmentReadiness[0]'],
      whyItMatters: 'The final wave may require a human gate.',
      whenToRevisit: 'Before deployment.',
      status: 'open',
    }];
    const frame = goalFrameJson({
      assurancePolicy: { mode: 'advisory', verificationStatus: 'suggested' },
      attentionSignals,
    });
    const checkpoint = checkpointV2Json({
      planning: frame.planning,
      repositories: frame.repositories,
      assurancePolicy: { mode: 'advisory', verificationStatus: 'suggested' },
      attentionSignals,
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-attention',
      last_assistant_message: `${goalFrameMessage(frame)}\n${checkpointMessageFrom(checkpoint)}`,
    });
    const sessionRoot = path.join(root, 'sessions', 'thread-attention');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionRoot, 'goal-session.json'), 'utf8')).frame.assurancePolicy.mode, 'advisory');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionRoot, 'checkpoint.json'), 'utf8')).checkpoint.attentionSignals[0].signalKey, 'environment-gate');
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-attention', source: 'compact' });
    assert.match(started.hookSpecificOutput.additionalContext, /Deployment ownership is not confirmed/);
    assert.match(started.hookSpecificOutput.additionalContext, /"mode":"advisory"/);
  });
});

test('evolving assurance status and attention signals do not invalidate the same goal run', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-attention-evolves', 'thread-attention-evolves');
    const initialSignal = {
      signalId: 'risk-deployment-owner',
      signalKey: 'environment-gate',
      severity: 'medium',
      summary: 'Deployment ownership is not confirmed.',
      evidenceRefs: ['frame:readiness.environmentReadiness[0]'],
      whyItMatters: 'The final wave may require a human gate.',
      whenToRevisit: 'Before deployment.',
      status: 'open',
    };
    const laterSignal = {
      ...initialSignal,
      signalId: 'risk-deployment-owner-resolved',
      status: 'resolved',
      summary: 'Deployment ownership was confirmed.',
    };
    const frame = goalFrameJson({
      assurancePolicy: { mode: 'advisory', verificationStatus: 'suggested' },
      attentionSignals: [initialSignal],
    });
    const checkpoint = checkpointV2Json({
      planning: frame.planning,
      repositories: frame.repositories,
      assurancePolicy: { mode: 'advisory', verificationStatus: 'passed' },
      attentionSignals: [laterSignal],
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-attention-evolves',
      last_assistant_message: `${goalFrameMessage(frame)}\n${checkpointMessageFrom(checkpoint)}`,
    });
    const sessionRoot = path.join(root, 'sessions', 'thread-attention-evolves');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionRoot, 'goal-session.json'), 'utf8')).frame.assurancePolicy.verificationStatus, 'suggested');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sessionRoot, 'checkpoint.json'), 'utf8')).checkpoint.assurancePolicy.verificationStatus, 'passed');
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-attention-evolves', source: 'compact' });
    assert.match(started.hookSpecificOutput.additionalContext, /Deployment ownership was confirmed/);
    assert.match(started.hookSpecificOutput.additionalContext, /"verificationStatus":"passed"/);
    assert.doesNotMatch(started.hookSpecificOutput.additionalContext, /"verificationStatus":"suggested"/);
    assert.doesNotMatch(started.hookSpecificOutput.additionalContext, /"status":"open"/);
  });
});

test('attention projection prioritizes open critical signals over historical entries', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-attention-priority', 'thread-attention-priority');
    const signals = [
      ...Array.from({ length: 4 }, (_, index) => ({
        signalId: `resolved-${index}`,
        signalKey: 'historical-risk',
        severity: 'low',
        summary: `Resolved historical signal ${index}.`,
        evidenceRefs: [`receipt:${index}`],
        whyItMatters: 'It was already handled.',
        whenToRevisit: 'Never unless reopened.',
        status: 'resolved',
      })),
      {
        signalId: 'open-critical',
        signalKey: 'security-gate',
        severity: 'critical',
        summary: 'Security review is still open.',
        evidenceRefs: ['review:security'],
        whyItMatters: 'The deployment gate may fail.',
        whenToRevisit: 'Before deployment.',
        status: 'open',
      },
    ];
    const frame = goalFrameJson({ attentionSignals: signals });
    const checkpoint = checkpointV2Json({ planning: frame.planning, repositories: frame.repositories, attentionSignals: signals });
    runHook(root, 'Stop', {
      session_id: 'codex-session-attention-priority',
      last_assistant_message: `${goalFrameMessage(frame)}\n${checkpointMessageFrom(checkpoint)}`,
    });
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-attention-priority', source: 'compact' });
    assert.match(started.hookSpecificOutput.additionalContext, /Security review is still open/);
  });
});

test('hook attention validation rejects whitespace-only evidence references', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-attention-invalid', 'thread-attention-invalid');
    const frame = goalFrameJson({ attentionSignals: [{
      signalId: 'risk-invalid',
      signalKey: 'missing-evidence',
      severity: 'high',
      summary: 'This signal has no evidence.',
      evidenceRefs: ['   '],
      whyItMatters: 'It cannot be revisited safely.',
      whenToRevisit: 'Before merge.',
      status: 'open',
    }] });
    runHook(root, 'Stop', {
      session_id: 'codex-session-attention-invalid',
      last_assistant_message: goalFrameMessage(frame),
    });
    assert.equal(fs.existsSync(path.join(root, 'sessions', 'thread-attention-invalid', 'goal-session.json')), false);
  });
});

test('hook assurance validation enforces low-friction mode/status combinations', () => {
  for (const [suffix, assurancePolicy] of [
    ['normal-blocked', { mode: 'normal', verificationStatus: 'blocked' }],
    ['strict-suggested', { mode: 'strict', verificationStatus: 'suggested' }],
  ]) {
    withTempDir((root) => {
      const sessionId = `codex-session-${suffix}`;
      const threadId = `thread-${suffix}`;
      writeVerifiedBinding(root, sessionId, threadId);
      runHook(root, 'Stop', {
        session_id: sessionId,
        last_assistant_message: goalFrameMessage(goalFrameJson({ assurancePolicy })),
      });
      assert.equal(fs.existsSync(path.join(root, 'sessions', threadId, 'goal-session.json')), false);
    });
  }
});

test('SubagentStart includes bounded goal-run planning context when a verified frame exists', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-v2-agent', 'thread-v2-agent');
    runHook(root, 'Stop', {
      session_id: 'codex-session-v2-agent',
      last_assistant_message: goalAndCheckpointV2Message(),
    });
    const started = runHook(root, 'SubagentStart', {
      session_id: 'codex-session-v2-agent',
      agent_id: 'child-planning',
      agent_type: 'worker',
    });
    assert.match(started.hookSpecificOutput.additionalContext, /goal-hook-runtime/);
    assert.match(started.hookSpecificOutput.additionalContext, /roadmap-hook-runtime/);
    assert.ok(Math.ceil(Buffer.byteLength(started.hookSpecificOutput.additionalContext, 'utf8') / 3) <= 600);
  });
});

test('large goal-frame context fails soft within the compact injection ceiling', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-large-frame', 'thread-large-frame');
    const largeFrame = goalFrameJson({
      successCriteria: Array.from({ length: 24 }, (_, index) => `criterion-${index}-${'x'.repeat(180)}`),
      canonicalAuthority: 'authority-'.repeat(100),
      readiness: {
        codeReadiness: Array.from({ length: 12 }, (_, index) => `code-${index}-${'y'.repeat(160)}`),
        environmentReadiness: Array.from({ length: 12 }, (_, index) => `env-${index}-${'z'.repeat(160)}`),
      },
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-large-frame',
      last_assistant_message: `GOAL_SESSION_FRAME\n\`\`\`json\n${JSON.stringify(largeFrame)}\n\`\`\``,
    });
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-large-frame', source: 'compact' });
    assert.ok(started.hookSpecificOutput);
    assert.ok(Math.ceil(Buffer.byteLength(started.hookSpecificOutput.additionalContext, 'utf8') / 3) <= 1500);
  });
});

test('Stop rejects a frame and checkpoint that describe different goals', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-mismatch', 'thread-mismatch');
    const frame = goalFrameMessage({ goalId: 'goal-a' });
    const checkpoint = checkpointMessageFrom(checkpointV2Json({ goalId: 'goal-b' }));
    runHook(root, 'Stop', {
      session_id: 'codex-session-mismatch',
      last_assistant_message: `${frame}\n${checkpoint}`,
    });
    const sessionRoot = path.join(root, 'sessions', 'thread-mismatch');
    assert.ok(!fs.existsSync(path.join(sessionRoot, 'goal-session.json')));
    assert.ok(!fs.existsSync(path.join(sessionRoot, 'checkpoint.json')));
  });
});

test('compact projection preserves null planning references and prioritizes the current checkpoint', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-null', 'thread-null');
    const frame = goalFrameJson({
      goalId: 'goal-null',
      planning: {
        surface: 'none',
        scopeKey: null,
        goalRef: null,
        roadmapRef: null,
        planRef: null,
        workPointRefs: [],
        projectRunRef: null,
        authorityStatus: 'manual',
      },
      repositories: Array.from({ length: 6 }, (_, index) => ({
        ...goalFrameJson().repositories[0],
        repositoryId: `repo-${index}`,
        ownedPaths: Array.from({ length: 8 }, (_, pathIndex) => `repo-${index}/owned-${pathIndex}-${'x'.repeat(120)}`),
        changedPaths: Array.from({ length: 8 }, (_, pathIndex) => `repo-${index}/changed-${pathIndex}-${'y'.repeat(120)}`),
      })),
      dependencyWaves: Array.from({ length: 8 }, (_, index) => ({
        waveId: `wave-${index}`,
        dependsOn: index === 0 ? [] : [`wave-${index - 1}`],
        status: index === 0 ? 'active' : 'pending',
        workPointRef: null,
        planRef: null,
        projectRunRef: null,
      })),
    });
    const checkpoint = checkpointV2Json({
      goalId: 'goal-null',
      planning: frame.planning,
      repositories: frame.repositories,
      activeWaveId: 'wave-0',
      completedWaveIds: [],
      nextAction: 'Resume the active wave.',
    });
    runHook(root, 'Stop', {
      session_id: 'codex-session-null',
      last_assistant_message: `${goalFrameMessage(frame)}\n${checkpointMessageFrom(checkpoint)}`,
    });
    const started = runHook(root, 'SessionStart', { session_id: 'codex-session-null', source: 'compact' });
    const context = started.hookSpecificOutput.additionalContext;
    assert.match(context, /SESSION_CHECKPOINT/);
    assert.match(context, /Resume the active wave/);
    assert.match(context, /"roadmapRef":null/);
    assert.doesNotMatch(context, /"roadmapRef":"null"/);
    assert.ok(Math.ceil(Buffer.byteLength(context, 'utf8') / 3) <= 1500);
  });
});

test('unbound sessions fail open and require a manual verified binding', () => {
  withTempDir((root) => {
    const result = runHook(root, 'SessionStart', {
      session_id: 'unbound-codex-session',
      source: 'compact',
    });
    assert.strictEqual(result.continue, true);
    assert.match(result.systemMessage, /verified.*binding.*manual/i);
    assert.ok(!fs.existsSync(path.join(root, 'sessions', 'unbound-codex-session')));
  });
});

test('Windows-invalid thread and agent identifiers fail closed before filesystem writes', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-invalid-id', 'thread:invalid');
    const result = runHook(root, 'Stop', {
      session_id: 'codex-session-invalid-id',
      last_assistant_message: checkpointMessage(),
    });
    assert.deepStrictEqual(result, { continue: true });
    assert.ok(!fs.existsSync(path.join(root, 'sessions')));
  });
});

test('managed subagents receive the AGENT_RESULT contract while SubagentStop classifies receipt telemetry only', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-c', 'thread-c');
    const started = runHook(root, 'SubagentStart', {
      session_id: 'codex-session-c',
      agent_id: 'child-1',
      agent_type: 'worker',
    });
    assert.match(started.hookSpecificOutput.additionalContext, /AGENT_RESULT/);
    assert.match(started.hookSpecificOutput.additionalContext, /failed\|interrupted/);

    const stopped = runHook(root, 'SubagentStop', {
      session_id: 'codex-session-c',
      agent_id: 'child-1',
      agent_type: 'worker',
      last_assistant_message: agentResultMessage('failed'),
      agent_transcript_path: path.join(root, 'subagent.jsonl'),
    });
    assert.deepStrictEqual(stopped, { continue: true });
    runHook(root, 'SubagentStop', {
      session_id: 'codex-session-c',
      agent_id: 'child-2',
      agent_type: 'worker',
      last_assistant_message: 'No structured receipt here.',
    });
    runHook(root, 'SubagentStop', {
      session_id: 'codex-session-c',
      agent_id: 'child-3',
      agent_type: 'worker',
      last_assistant_message: agentResultMessage('interrupted', { agentId: 'child-3' }),
    });
    const telemetry = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-c', 'telemetry.json'), 'utf8'));
    assert.strictEqual(telemetry.events[0].event, 'SubagentStop');
    assert.strictEqual(telemetry.events[0].receipt, 'valid');
    assert.strictEqual(telemetry.events[0].status, 'failed');
    assert.strictEqual(telemetry.events[1].receipt, 'missing');
    assert.strictEqual(telemetry.events[1].status, null);
    assert.strictEqual(telemetry.events[2].receipt, 'valid');
    assert.strictEqual(telemetry.events[2].status, 'interrupted');
    assert.ok(!JSON.stringify(telemetry).includes('Implemented hook runtime'));
    assert.ok(!JSON.stringify(telemetry).includes('subagent.jsonl'));
  });
});

test('SubagentStop persists a full redacted receipt only when its identity, role, refs, and payload kind are valid', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-receipt', 'thread-receipt');
    const input = {
      session_id: 'codex-session-receipt',
      agent_id: 'child-receipt',
      agent_type: 'worker',
    };

    runHook(root, 'SubagentStop', {
      ...input,
      last_assistant_message: agentResultMessage('completed', {
        agentId: 'another-child',
        repositoryId: 42,
      }),
    });
    const receiptPath = path.join(root, 'sessions', 'thread-receipt', 'receipts', 'child-receipt.json');
    assert.ok(!fs.existsSync(receiptPath));

    runHook(root, 'SubagentStop', {
      ...input,
      last_assistant_message: agentResultMessage('completed', {
        agentId: 'child-receipt',
        outcome: ['Implemented a credential token=super-secret-value.'],
      }),
    });
    const persisted = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert.strictEqual(persisted.canonicalThreadId, 'thread-receipt');
    assert.strictEqual(persisted.codexSessionId, 'codex-session-receipt');
    assert.strictEqual(persisted.agentId, 'child-receipt');
    assert.strictEqual(persisted.receipt.status, 'completed');
    assert.deepStrictEqual(persisted.receipt.outcome, ['Implemented a credential token=[REDACTED]']);
  });
});

test('SubagentStart supplies a bounded, redacted context from recent verified receipts in the same session', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-context', 'thread-context');
    runHook(root, 'SubagentStop', {
      session_id: 'codex-session-context',
      agent_id: 'child-prior',
      agent_type: 'worker',
      last_assistant_message: agentResultMessage('completed', {
        agentId: 'child-prior',
        outcome: ['Completed groundwork with token=do-not-share.'],
        validation: ['node --test focused: pass'],
      }),
    });

    const started = runHook(root, 'SubagentStart', {
      session_id: 'codex-session-context',
      agent_id: 'child-next',
      agent_type: 'reviewer',
    });
    const context = started.hookSpecificOutput.additionalContext;
    assert.match(context, /Recent verified subagent receipts/);
    assert.match(context, /child-prior/);
    assert.match(context, /token=\[REDACTED\]/);
    assert.ok(Math.ceil(Buffer.byteLength(context, 'utf8') / 3) <= 600);
  });
});

test('goal-run receipts echo and persist the verified context binding', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-bound-receipt', 'thread-bound-receipt');
    runHook(root, 'Stop', {
      session_id: 'codex-session-bound-receipt',
      last_assistant_message: goalAndCheckpointV2Message(),
    });
    const started = runHook(root, 'SubagentStart', {
      session_id: 'codex-session-bound-receipt',
      agent_id: 'child-bound',
      agent_type: 'worker',
    });
    const bindingMatch = started.hookSpecificOutput.additionalContext.match(/Goal-run binding: ```json\n([\s\S]+)\n```/);
    assert.ok(bindingMatch);
    const binding = JSON.parse(bindingMatch[1]);
    runHook(root, 'SubagentStop', {
      session_id: 'codex-session-bound-receipt',
      agent_id: 'child-bound',
      agent_type: 'worker',
      last_assistant_message: agentResultMessage('completed', {
        agentId: 'child-bound',
        payload: {
          kind: 'implementation',
          goalId: binding.goalId,
          activeWaveId: binding.activeWaveId,
          contextHash: binding.contextHash,
          changes: [],
          handoff: null,
        },
      }),
    });
    const receipt = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-bound-receipt', 'receipts', 'child-bound.json'), 'utf8'));
    assert.strictEqual(receipt.goalId, binding.goalId);
    assert.strictEqual(receipt.activeWaveId, binding.activeWaveId);
    assert.strictEqual(receipt.contextHash, binding.contextHash);
  });
});

test('SessionEnd creates a gated, idempotent, minimal queue job without a scheduler', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-d', 'thread-d');
    const input = {
      session_id: 'codex-session-d',
      transcript_path: path.join(root, 'never-read.jsonl'),
      reason: 'other',
    };
    const first = runHook(root, 'SessionEnd', input, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
    const second = runHook(root, 'SessionEnd', input, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
    assert.deepStrictEqual(first, { continue: true });
    assert.deepStrictEqual(second, { continue: true });
    const queueDir = path.join(root, 'queue');
    const jobs = fs.readdirSync(queueDir).filter((entry) => entry.endsWith('.json'));
    assert.strictEqual(jobs.length, 1);
    const job = JSON.parse(fs.readFileSync(path.join(queueDir, jobs[0]), 'utf8'));
    assert.strictEqual(job.state, 'pending');
    assert.strictEqual(job.canonicalThreadId, 'thread-d');
    assert.strictEqual(job.terminalEligibility, 'host_evaluator_pending');
    assert.strictEqual(job.evaluatorExcluded, false);
    assert.ok(!JSON.stringify(job).includes('never-read'));
  });
});

test('the gated queue has an atomic claimed lease, one retry, and terminal completion', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-e', 'thread-e');
    runHook(root, 'SessionEnd', { session_id: 'codex-session-e' }, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
    const firstClaim = runQueue(root, 'claim');
    assert.strictEqual(firstClaim.job.state, 'claimed');
    assert.strictEqual(firstClaim.job.attempts, 1);
    assert.ok(firstClaim.job.leaseExpiresAt);
    const afterFailure = runQueue(root, 'fail', firstClaim.job.id);
    assert.strictEqual(afterFailure.job.state, 'pending');
    const retry = runQueue(root, 'claim');
    assert.strictEqual(retry.job.attempts, 2);
    const completed = runQueue(root, 'complete', retry.job.id);
    assert.strictEqual(completed.job.state, 'completed');
  });
});

test('the queue can mark a host-excluded tombstone as skipped without treating deletion as supported', () => {
  withTempDir((root) => {
    writeVerifiedBinding(root, 'codex-session-f', 'thread-f');
    runHook(root, 'SessionEnd', { session_id: 'codex-session-f' }, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
    const claim = runQueue(root, 'claim');
    const tombstoned = runQueue(root, 'tombstone', claim.job.id);
    assert.strictEqual(tombstoned.job.state, 'skipped');
    assert.strictEqual(tombstoned.job.skipReason, 'tombstone_unsupported');
    assert.strictEqual(tombstoned.job.evaluatorExcluded, true);
  });
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`Passed ${passed} Codex hook runtime tests.`);
