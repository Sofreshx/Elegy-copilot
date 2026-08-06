const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GOAL_SESSION_RECORD_SCHEMA_VERSION,
  GOAL_SESSION_GIT_STATUSES,
  materializeGoalSessionState,
  normalizeGoalSessionBaseline,
  normalizeGoalSessionRecord,
  normalizeGoalSessionUpdate,
} = require('../dist');

function baseline(overrides = {}) {
  return {
    schemaVersion: GOAL_SESSION_RECORD_SCHEMA_VERSION,
    kind: 'baseline',
    goalId: 'compact-goal-session',
    goal: 'Replace heavy session snapshots with compact resumability records.',
    successCriteria: ['Persist scope and next action.', 'Detect repository drift.'],
    authority: 'instruction-engine/docs/system',
    scope: ['contracts', 'Codex hook', 'goal-session skill'],
    protected: ['Preserve unrelated dirty changes.', 'No publication or installation.'],
    dependencyWaves: [
      { waveId: 'contract', dependsOn: [], deliverable: 'Compact shared contract' },
      { waveId: 'runtime', dependsOn: ['contract'], deliverable: 'Materializing runtime' },
    ],
    current: { activeWave: 'contract', nextAction: 'Implement the contract.' },
    repositories: [{
      repositoryId: 'instruction-engine',
      root: 'C:/repo/instruction-engine',
      ownedPaths: ['contracts/**', 'codex-assets/**'],
      protectedPaths: ['package.json', 'scripts/start-local.ps1'],
      preserveExistingChanges: true,
    }],
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    schemaVersion: GOAL_SESSION_RECORD_SCHEMA_VERSION,
    kind: 'update',
    goalId: 'compact-goal-session',
    event: 'wave-complete',
    completedWaveIds: ['contract'],
    activeWave: 'runtime',
    changed: ['Compact contract and tests'],
    validated: ['contracts goal-session tests passed'],
    nextAction: 'Implement runtime persistence.',
    git: { status: 'uncommitted', reason: 'Commit not requested.' },
    ...overrides,
  };
}

test('normalizes a compact baseline and omits inactive optional modules', () => {
  const normalized = normalizeGoalSessionBaseline(baseline());
  assert.equal(normalized.schemaVersion, '1');
  assert.equal(normalized.current.activeWave, 'contract');
  assert.equal(normalized.repositories[0].preserveExistingChanges, true);
  assert.equal('planning' in normalized, false);
  assert.equal('assurance' in normalized, false);
});

test('keeps only supplied planning references and non-default assurance', () => {
  const normalized = normalizeGoalSessionBaseline(baseline({
    planning: { scopeKey: 'instruction-engine', planRef: 'plan:compact-session' },
    assurance: { mode: 'advisory', status: 'suggested' },
  }));
  assert.deepEqual(normalized.planning, { scopeKey: 'instruction-engine', planRef: 'plan:compact-session' });
  assert.deepEqual(normalized.assurance, { mode: 'advisory', status: 'suggested' });
});

test('normalizes a differential update without timestamps or repeated baseline state', () => {
  const normalized = normalizeGoalSessionUpdate(update());
  assert.equal(normalized.event, 'wave-complete');
  assert.equal(normalized.git.status, 'uncommitted');
  assert.equal('authority' in normalized, false);
  assert.equal('updatedAt' in normalized, false);
  assert.deepEqual(GOAL_SESSION_GIT_STATUSES, ['committed', 'clean', 'uncommitted', 'not-applicable']);
});

test('materializes ordered updates and lets empty current-state arrays clear blockers and gates', () => {
  const blocked = update({
    event: 'blocked',
    completedWaveIds: undefined,
    activeWave: 'contract',
    changed: undefined,
    validated: undefined,
    blockers: [{ blockerId: 'decision', owner: 'user', summary: 'Choose a contract.', blocking: true }],
    gates: [{ gateId: 'approval', owner: 'user', blocking: true, status: 'pending' }],
    risks: ['Contract decision is pending.'],
    nextAction: 'Wait for the decision.',
    git: undefined,
  });
  const cleared = update({ blockers: [], gates: [], risks: [], decisions: ['User approved compact records.'] });
  const state = materializeGoalSessionState(baseline(), [blocked, cleared]);
  assert.deepEqual(state.completedWaveIds, ['contract']);
  assert.equal(state.activeWave, 'runtime');
  assert.deepEqual(state.blockers, []);
  assert.deepEqual(state.gates, []);
  assert.deepEqual(state.risks, []);
  assert.deepEqual(state.decisions, ['User approved compact records.']);
});

test('rejects empty updates, obsolete git status, and fabricated closure state', () => {
  assert.throws(() => normalizeGoalSessionUpdate({
    schemaVersion: '1', kind: 'update', goalId: 'compact-goal-session', event: 'decision',
  }), /state change/);
  assert.throws(() => normalizeGoalSessionUpdate(update({ git: { status: 'blocked-uncommitted' } })), /git.status/);
  assert.throws(() => normalizeGoalSessionUpdate(update({ event: 'closure', activeWave: 'runtime' })), /closure/);
  assert.throws(() => normalizeGoalSessionUpdate(update({ event: 'decision', activeWave: null })), /only for closure/);
});

test('rejects null/default ceremony and invalid wave graphs', () => {
  assert.throws(() => normalizeGoalSessionBaseline(baseline({ planning: {} })), /planning/);
  assert.throws(() => normalizeGoalSessionBaseline(baseline({ assurance: { mode: 'normal', status: 'not-requested' } })), /assurance.mode/);
  assert.throws(() => normalizeGoalSessionBaseline(baseline({
    dependencyWaves: [{ waveId: 'contract', dependsOn: ['contract'], deliverable: 'Invalid' }],
  })), /itself|cycle/);
});

test('requires strict assurance evidence only when it is operationally relevant', () => {
  assert.throws(() => normalizeGoalSessionBaseline(baseline({
    assurance: { mode: 'strict', status: 'passed', gateRef: 'deploy' },
  })), /evidenceRefs/);
  const normalized = normalizeGoalSessionBaseline(baseline({
    assurance: { mode: 'strict', status: 'blocked', gateRef: 'deploy', evidenceRefs: ['check:deploy'], decisionRef: 'user:accept' },
  }));
  assert.equal(normalized.assurance.status, 'blocked');
  const state = materializeGoalSessionState(baseline({
    assurance: { mode: 'strict', status: 'requested', gateRef: 'deploy' },
  }), [update({ assurance: { mode: 'strict', status: 'passed', gateRef: 'deploy', evidenceRefs: ['check:deploy'] } })]);
  assert.equal(state.assurance.status, 'passed');
});

test('materialization rejects cross-goal updates and dependency violations', () => {
  assert.throws(() => materializeGoalSessionState(baseline(), [update({ goalId: 'other' })]), /goalId/);
  assert.throws(() => materializeGoalSessionState(baseline(), [update({ completedWaveIds: ['runtime'] })]), /dependencies/);
});

test('normalizes either record kind through the union entrypoint', () => {
  assert.equal(normalizeGoalSessionRecord(baseline()).kind, 'baseline');
  assert.equal(normalizeGoalSessionRecord(update()).kind, 'update');
});
