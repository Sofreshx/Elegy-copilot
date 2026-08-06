#!/usr/bin/env node
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.resolve(__dirname, '..', 'codex-assets', 'hooks', 'elegy-workflow-improvement', 'elegy-codex-hook.mjs');
let passed = 0;

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-codex-hook-runtime-'));
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function test(name, fn) {
  try { fn(); passed += 1; console.log(`  PASS: ${name}`); }
  catch (error) { console.error(`  FAIL: ${name}`); console.error(`    ${error.stack || error.message}`); process.exitCode = 1; }
}

function writeVerifiedBinding(root, sessionId, threadId) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'bindings.json'), `${JSON.stringify({
    schemaVersion: 1,
    bindings: { [sessionId]: { canonicalThreadId: threadId, verified: true, verificationReceipt: 'desktop-runtime-binding-v1' } },
  }, null, 2)}\n`);
}

function runHook(root, event, input, extraEnv = {}) {
  const result = childProcess.spawnSync(process.execPath, [hookPath, event], {
    input: JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ELEGY_CODEX_WORKFLOW_HOME: root, ...extraEnv },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function runStatus(root, sessionId = '') {
  const result = childProcess.spawnSync(process.execPath, [hookPath, 'status', ...(sessionId ? [sessionId] : [])], {
    encoding: 'utf8', env: { ...process.env, ELEGY_CODEX_WORKFLOW_HOME: root },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function runQueue(root, ...args) {
  const result = childProcess.spawnSync(process.execPath, [hookPath, 'queue', ...args], {
    encoding: 'utf8', env: { ...process.env, ELEGY_CODEX_WORKFLOW_HOME: root, ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' },
  });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout || '{}');
}

function initializeGitRepository(parent, name) {
  const repository = path.join(parent, name);
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
  return { repository, git };
}

function baseline(repositories, overrides = {}) {
  return {
    schemaVersion: '1', kind: 'baseline', goalId: 'goal-hook-runtime',
    goal: 'Preserve a compact resumable work session.',
    successCriteria: ['Resume at the correct wave.', 'Detect repository drift.'],
    authority: 'instruction-engine/docs/system',
    scope: ['hook runtime', 'goal-session skill'],
    protected: ['Preserve existing dirty changes.', 'No publication.'],
    dependencyWaves: [
      { waveId: 'contract', dependsOn: [], deliverable: 'Compact contract' },
      { waveId: 'runtime', dependsOn: ['contract'], deliverable: 'Runtime materialization' },
    ],
    current: { activeWave: 'contract', nextAction: 'Implement the compact contract.' },
    repositories: repositories.map(({ repository, id = path.basename(repository) }) => ({
      repositoryId: id, root: repository, ownedPaths: ['**'], protectedPaths: [], preserveExistingChanges: true,
    })),
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    schemaVersion: '1', kind: 'update', goalId: 'goal-hook-runtime', event: 'wave-complete',
    completedWaveIds: ['contract'], activeWave: 'runtime',
    changed: ['Compact contract'], validated: ['Focused contract tests passed'],
    nextAction: 'Implement runtime materialization.',
    git: { status: 'uncommitted', reason: 'Commit not requested.' },
    ...overrides,
  };
}

function hiddenRecord(record, visible = 'Checkpoint: compact state updated') {
  return `${visible}\n\n<!-- ELEGY_SESSION_STATE\n${JSON.stringify(record)}\n-->`;
}

function agentResultMessage(status = 'completed', overrides = {}) {
  return `AGENT_RESULT\n\`\`\`json\n${JSON.stringify({
    taskId: 'task-1', agentId: 'child-1', role: 'worker', status,
    ownedScope: ['codex-assets/hooks/**'], repositoryId: 'instruction-engine', baseRef: 'main', headRef: 'abc123',
    outcome: ['Implemented hook runtime.'], evidence: ['focused test'], validation: ['pass'], dependencies: [], blockers: [], residualRisks: [],
    payload: { kind: 'implementation', changes: [], handoff: null }, ...overrides,
  })}\n\`\`\``;
}

test('Stop persists one hidden compact baseline without requiring a duplicate checkpoint', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-a', 'thread-a');
  assert.deepStrictEqual(runHook(root, 'Stop', { session_id: 'session-a', last_assistant_message: hiddenRecord(baseline([repo])) }), { continue: true });
  const state = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-a', 'session-state.json'), 'utf8'));
  assert.strictEqual(state.sequence, 0);
  assert.strictEqual(state.materialized.activeWave, 'contract');
  assert.strictEqual(state.observations[0].worktreeStatus, 'clean');
  assert.ok(!fs.existsSync(path.join(root, 'sessions', 'thread-a', 'checkpoint.json')));
}));

test('Stop preserves an existing compact baseline and its immutable update sequence', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-baseline-repeat', 'thread-baseline-repeat');
  runHook(root, 'Stop', { session_id: 'session-baseline-repeat', last_assistant_message: hiddenRecord(baseline([repo])) });
  runHook(root, 'Stop', { session_id: 'session-baseline-repeat', last_assistant_message: hiddenRecord(update()) });
  const statePath = path.join(root, 'sessions', 'thread-baseline-repeat', 'session-state.json');
  const before = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const result = runHook(root, 'Stop', {
    session_id: 'session-baseline-repeat',
    last_assistant_message: hiddenRecord(baseline([repo], { goal: 'Replacement goal must not overwrite progress.' })),
  });
  const after = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.match(result.systemMessage, /baseline already exists/);
  assert.deepStrictEqual(after, before);
  assert.strictEqual(after.sequence, 1);
  const wrappers = fs.readdirSync(path.join(root, 'sessions', 'thread-baseline-repeat', 'session-updates'));
  assert.strictEqual(wrappers.length, 1);
  assert.match(wrappers[0], /^up-.*-000001\.json$/);
}));

test('differential updates materialize and empty arrays clear current blockers and gates', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-b', 'thread-b');
  runHook(root, 'Stop', { session_id: 'session-b', last_assistant_message: hiddenRecord(baseline([repo])) });
  runHook(root, 'Stop', { session_id: 'session-b', last_assistant_message: hiddenRecord(update({
    event: 'blocked', completedWaveIds: undefined, activeWave: 'contract', changed: undefined, validated: undefined,
    blockers: [{ blockerId: 'choice', owner: 'user', summary: 'Choose the runtime contract.', blocking: true }],
    gates: [{ gateId: 'approval', owner: 'user', blocking: true, status: 'pending' }], risks: ['Decision pending.'],
    nextAction: 'Wait for a decision.', git: undefined,
  })) });
  runHook(root, 'Stop', { session_id: 'session-b', last_assistant_message: hiddenRecord(update({ blockers: [], gates: [], risks: [] })) });
  const state = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-b', 'session-state.json'), 'utf8'));
  assert.deepStrictEqual(state.materialized.completedWaveIds, ['contract']);
  assert.strictEqual(state.materialized.activeWave, 'runtime');
  assert.deepStrictEqual(state.materialized.blockers, []);
  assert.deepStrictEqual(state.materialized.gates, []);
  assert.strictEqual(state.materialized.git.status, 'uncommitted');
  assert.strictEqual(state.sequence, 2);
}));

test('malformed, oversized, cross-goal, and legacy records are ignored explicitly', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-c', 'thread-c');
  let result = runHook(root, 'Stop', { session_id: 'session-c', last_assistant_message: '<!-- ELEGY_SESSION_STATE\n{"kind":"baseline"}\n-->' });
  assert.match(result.systemMessage, /malformed|unsupported/);
  runHook(root, 'Stop', { session_id: 'session-c', last_assistant_message: hiddenRecord(baseline([repo])) });
  result = runHook(root, 'Stop', { session_id: 'session-c', last_assistant_message: hiddenRecord(update({ goalId: 'other' })) });
  assert.match(result.systemMessage, /no matching baseline/);
  result = runHook(root, 'Stop', { session_id: 'session-c', last_assistant_message: 'SESSION_CHECKPOINT\n```json\n{}\n```' });
  assert.match(result.systemMessage, /legacy.*ignored/i);
  const huge = baseline([repo], { goal: 'x'.repeat(9000) });
  result = runHook(root, 'Stop', { session_id: 'session-c', last_assistant_message: hiddenRecord(huge) });
  assert.match(result.systemMessage, /malformed|unsupported/);
}));

test('PreCompact refreshes multi-repository observations without inventing semantic progress', () => withTempDir((root) => {
  const one = initializeGitRepository(root, 'one');
  const two = initializeGitRepository(root, 'two');
  fs.writeFileSync(path.join(one.repository, 'tracked.txt'), 'pre-existing dirty change\n');
  writeVerifiedBinding(root, 'session-d', 'thread-d');
  runHook(root, 'Stop', { session_id: 'session-d', last_assistant_message: hiddenRecord(baseline([one, two])) });
  fs.writeFileSync(path.join(two.repository, 'tracked.txt'), 'work before compaction\n');
  runHook(root, 'PreCompact', { session_id: 'session-d', trigger: 'auto' });
  const state = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-d', 'session-state.json'), 'utf8'));
  assert.strictEqual(state.sequence, 0);
  assert.strictEqual(state.materialized.activeWave, 'contract');
  assert.strictEqual(state.observations.find((entry) => entry.repositoryId === 'two').worktreeStatus, 'dirty');
  const started = runHook(root, 'SessionStart', { session_id: 'session-d', source: 'compact' });
  assert.doesNotMatch(started.systemMessage || '', /drift detected/i);
}));

test('resume injects compact state and pauses on drift in any declared repository', () => withTempDir((root) => {
  const one = initializeGitRepository(root, 'one');
  const two = initializeGitRepository(root, 'two');
  writeVerifiedBinding(root, 'session-e', 'thread-e');
  runHook(root, 'Stop', { session_id: 'session-e', last_assistant_message: hiddenRecord(baseline([one, two])) });
  fs.writeFileSync(path.join(two.repository, 'tracked.txt'), 'drift\n');
  const started = runHook(root, 'SessionStart', { session_id: 'session-e', source: 'compact' });
  assert.match(started.systemMessage, /drift detected/i);
  const context = started.hookSpecificOutput.additionalContext;
  assert.match(context, /ELEGY_SESSION_STATE/);
  assert.match(context, /RUNTIME_RECONCILIATION/);
  assert.match(context, /changed_paths_changed/);
  assert.ok(Math.ceil(Buffer.byteLength(context, 'utf8') / 3) <= 1500);
}));

test('hidden records are redacted before persistence and status reports legacy state as unsupported', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-f', 'thread-f');
  const record = baseline([repo], { protected: ['Keep token=super-secret-value out of state.'] });
  runHook(root, 'Stop', { session_id: 'session-f', last_assistant_message: hiddenRecord(record) });
  runHook(root, 'Stop', { session_id: 'session-f', last_assistant_message: hiddenRecord(update({
    event: 'decision', completedWaveIds: undefined, activeWave: undefined, changed: undefined, validated: undefined,
    gates: [{ gateId: 'paid-service', owner: 'user', blocking: false, status: 'pending' }],
    nextAction: 'Continue without the optional service.', git: undefined,
  })) });
  const sessionRoot = path.join(root, 'sessions', 'thread-f');
  fs.writeFileSync(path.join(sessionRoot, 'checkpoint.json'), '{}');
  const persisted = fs.readFileSync(path.join(sessionRoot, 'session-state.json'), 'utf8');
  assert.match(persisted, /token=\[REDACTED\]/);
  assert.doesNotMatch(persisted, /super-secret-value/);
  const status = runStatus(root, 'session-f');
  assert.strictEqual(status.compactState, 'valid');
  assert.strictEqual(status.legacyState, 'legacy-unsupported');
  assert.strictEqual(status.operatorView.activeWaveId, 'contract');
  assert.strictEqual(status.operatorView.blockingItemCount, 0);
}));

test('unbound and cross-session resumes fail open without leaking state', () => withTempDir((root) => {
  let result = runHook(root, 'SessionStart', { session_id: 'unbound', source: 'compact' });
  assert.match(result.systemMessage, /verified.*binding/i);
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-g', 'thread-g');
  runHook(root, 'Stop', { session_id: 'session-g', last_assistant_message: hiddenRecord(baseline([repo])) });
  writeVerifiedBinding(root, 'session-other', 'thread-other');
  result = runHook(root, 'SessionStart', { session_id: 'session-other', source: 'compact' });
  assert.match(result.systemMessage, /state unavailable/i);
}));

test('managed subagents bind receipts to the compact goal context', () => withTempDir((root) => {
  const repo = initializeGitRepository(root, 'instruction-engine');
  writeVerifiedBinding(root, 'session-h', 'thread-h');
  runHook(root, 'Stop', { session_id: 'session-h', last_assistant_message: hiddenRecord(baseline([repo])) });
  const started = runHook(root, 'SubagentStart', { session_id: 'session-h', agent_id: 'child-bound', agent_type: 'worker' });
  assert.match(started.hookSpecificOutput.additionalContext, /AGENT_RESULT/);
  const bindingMatch = started.hookSpecificOutput.additionalContext.match(/Goal-run binding: ```json\n([\s\S]+)\n```/);
  assert.ok(bindingMatch);
  const binding = JSON.parse(bindingMatch[1]);
  runHook(root, 'SubagentStop', {
    session_id: 'session-h', agent_id: 'child-bound', agent_type: 'worker',
    last_assistant_message: agentResultMessage('completed', {
      agentId: 'child-bound', payload: { kind: 'implementation', goalId: binding.goalId, activeWaveId: binding.activeWaveId, contextHash: binding.contextHash },
    }),
  });
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'sessions', 'thread-h', 'receipts', 'child-bound.json'), 'utf8'));
  assert.strictEqual(receipt.goalId, binding.goalId);
  assert.strictEqual(receipt.contextHash, binding.contextHash);
}));

test('SessionEnd queue behavior remains gated and idempotent', () => withTempDir((root) => {
  writeVerifiedBinding(root, 'session-i', 'thread-i');
  const input = { session_id: 'session-i', transcript_path: path.join(root, 'never-read.jsonl') };
  runHook(root, 'SessionEnd', input, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
  runHook(root, 'SessionEnd', input, { ELEGY_CODEX_WORKFLOW_QUEUE_ENABLED: '1' });
  const files = fs.readdirSync(path.join(root, 'queue')).filter((entry) => entry.endsWith('.json'));
  assert.strictEqual(files.length, 1);
  const claimed = runQueue(root, 'claim');
  assert.strictEqual(claimed.job.state, 'claimed');
  assert.ok(!JSON.stringify(claimed.job).includes('never-read'));
}));

if (!process.exitCode) console.log(`All ${passed} Codex hook runtime tests passed.`);
