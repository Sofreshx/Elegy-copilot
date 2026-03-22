const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLANNING_API_CONTRACT_VERSION,
  SYNCED_NOTE_SOURCE_ID_PATTERN,
  assertSyncedNoteSourceIdMatches,
  buildPlanningApiEnvelope,
  buildPlanningApiErrorEnvelope,
  canonicalizeSyncedNoteSourceLocator,
  deriveSyncedNoteSourceId,
} = require('../dist');

test('planning api envelope builder keeps shared contract metadata authoritative', () => {
  assert.deepEqual(
    buildPlanningApiEnvelope('planning.persistence.export', {
      code: 'planning_persistence_export_ready',
      reason: 'planning_persistence_export_ready',
    }),
    {
      code: 'planning_persistence_export_ready',
      reason: 'planning_persistence_export_ready',
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.export',
      deterministic: true,
    },
  );
});

test('planning api error envelope builder preserves payload details', () => {
  assert.deepEqual(
    buildPlanningApiErrorEnvelope(
      'planning.persistence.init',
      {
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: 'boom',
      },
      {
        ready: false,
      },
    ),
    {
      ready: false,
      error: {
        code: 'planning_persistence_init_failed',
        reason: 'planning_persistence_init_failed',
        message: 'boom',
      },
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.persistence.init',
      deterministic: true,
    },
  );
});

test('synced-note source ids derive from the canonical locator tuple', () => {
  const canonical = canonicalizeSyncedNoteSourceLocator({
    provider: 'github',
    host: 'GitHub.COM',
    owner: 'InstructionEngine',
    repo: 'workspace',
    branch: 'main',
    notesPath: './docs\\planning/synced-note.md',
  });

  assert.deepEqual(canonical, {
    provider: 'github',
    host: 'github.com',
    owner: 'InstructionEngine',
    repo: 'workspace',
    branch: 'main',
    notesPath: 'docs/planning/synced-note.md',
  });

  const derivedId = deriveSyncedNoteSourceId(canonical);
  assert.match(derivedId, SYNCED_NOTE_SOURCE_ID_PATTERN);
  assert.equal(
    derivedId,
    deriveSyncedNoteSourceId({
      provider: 'github',
      host: 'github.com',
      owner: 'InstructionEngine',
      repo: 'workspace',
      branch: 'main',
      notesPath: 'docs/planning/synced-note.md',
    }),
  );
});

test('synced-note source ids fail closed when the locator tuple changes', () => {
  const locator = {
    provider: 'gitea',
    host: 'git.example.test',
    owner: 'team-planning',
    repo: 'tracker',
    branch: 'main',
    notesPath: 'notes/synced.md',
  };
  const derivedId = deriveSyncedNoteSourceId(locator);

  assert.equal(assertSyncedNoteSourceIdMatches(locator, derivedId), derivedId);
  assert.throws(
    () => assertSyncedNoteSourceIdMatches({ ...locator, branch: 'feature/seed' }, derivedId),
    /id mismatch/i,
  );
});
