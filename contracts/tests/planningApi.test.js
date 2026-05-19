const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OBSIDIAN_SYNCED_NOTE_ID_PREFIX,
  PLANNING_API_CONTRACT_VERSION,
  ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION,
  SYNCED_NOTE_SOURCE_ID_PATTERN,
  SYNCED_NOTE_SOURCE_PRIMARY_PROVIDER,
  SYNCED_NOTE_SOURCE_FALLBACK_PROVIDERS,
  assertSyncedNoteSourceIdMatches,
  buildPlanningApiEnvelope,
  buildPlanningApiErrorEnvelope,
  canonicalizeObsidianSyncedNoteConfig,
  computeRoadmapWorkflowArtifactChecksum,
  canonicalizeSyncedNoteSourceLocator,
  deriveObsidianSyncedNoteId,
  deriveSyncedNoteSourceId,
  getSyncedNoteSourceProviderPolicy,
  normalizeSyncedNoteSourceId,
  normalizeRoadmapWorkflowStructuredArtifact,
  parseRoadmapWorkflowMarkdownArtifact,
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

test('synced-note source ids reject malformed values before comparing locator drift', () => {
  const locator = {
    provider: 'github',
    host: 'github.com',
    owner: 'InstructionEngine',
    repo: 'workspace',
    branch: 'main',
    notesPath: 'docs/planning/synced-note.md',
  };

  assert.throws(
    () => normalizeSyncedNoteSourceId('snsrc_invalid'),
    /must match snsrc_<32 lowercase hex characters>/i,
  );
  assert.throws(
    () => assertSyncedNoteSourceIdMatches(locator, 'snsrc_invalid'),
    /must match snsrc_<32 lowercase hex characters>/i,
  );
});

test('synced-note provider policy keeps github primary and fallbacks explicit', () => {
  assert.deepEqual(getSyncedNoteSourceProviderPolicy(SYNCED_NOTE_SOURCE_PRIMARY_PROVIDER), {
    provider: 'github',
    tier: 'primary',
    backend: 'github',
    explicit: true,
  });

  assert.deepEqual(
    SYNCED_NOTE_SOURCE_FALLBACK_PROVIDERS.map((provider) => getSyncedNoteSourceProviderPolicy(provider)),
    [
      {
        provider: 'gitea',
        tier: 'fallback',
        backend: 'gitea',
        explicit: true,
      },
      {
        provider: 'git',
        tier: 'fallback',
        backend: 'git',
        explicit: true,
      },
    ],
  );
});

test('obsidian synced-note config canonicalizes the external notes template without changing authority semantics', () => {
  assert.deepEqual(
    canonicalizeObsidianSyncedNoteConfig({
      vaultPath: 'C:\\Users\\planner\\Obsidian',
      notesPathTemplate: './Planning\\{repoId}',
      cliPath: 'C:\\Tools\\obsidian.exe',
      syncCommand: ['obsidian', 'pull'],
    }),
    {
      vaultPath: 'C:\\Users\\planner\\Obsidian',
      notesPathTemplate: 'Planning/{repoId}',
      cliPath: 'C:\\Tools\\obsidian.exe',
      syncCommand: ['obsidian', 'pull'],
    },
  );
});

test('obsidian synced-note ids stay deterministic for the selected repo context', () => {
  const derivedId = deriveObsidianSyncedNoteId({
    repoId: 'repo-instruction-engine',
    vaultName: 'Ops Planning',
    notePath: 'Planning/repo-instruction-engine/current-work.md',
  });

  assert.match(derivedId, new RegExp(`^${OBSIDIAN_SYNCED_NOTE_ID_PREFIX}_[a-f0-9]{32}$`));
  assert.equal(
    derivedId,
    deriveObsidianSyncedNoteId({
      repoId: 'repo-instruction-engine',
      vaultName: 'Ops Planning',
      notePath: 'Planning\\repo-instruction-engine\\current-work.md',
    }),
  );
  assert.notEqual(
    derivedId,
    deriveObsidianSyncedNoteId({
      repoId: 'repo-instruction-engine',
      vaultName: 'Ops Planning',
      notePath: 'Planning/repo-instruction-engine/follow-up.md',
    }),
  );
});

test('roadmap workflow structured artifacts normalize required deterministic fields', () => {
  const normalized = normalizeRoadmapWorkflowStructuredArtifact({
    kind: 'roadmap.review.result',
    roadmapId: 'RM-core',
    sliceId: 'RM-core-001',
    phase: 'review',
    status: 'pass',
    repoId: 'instruction-engine',
    followUps: ['none'],
    requiresUserDecision: true,
    suggestedNextAction: 'plan-next-slice',
    acceptance: {
      allPassed: true,
      failedChecks: [],
    },
  });

  assert.deepEqual(normalized, {
    schemaVersion: ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION,
    kind: 'roadmap.review.result',
    roadmapId: 'RM-core',
    sliceId: 'RM-core-001',
    phase: 'review',
    status: 'pass',
    repoId: 'instruction-engine',
    followUps: ['none'],
    requiresUserDecision: true,
    suggestedNextAction: 'plan-next-slice',
    acceptance: {
      allPassed: true,
      failedChecks: [],
    },
  });
});

test('roadmap workflow markdown parser extracts structured block and checksum deterministically', () => {
  const markdown = `# Review\n\nEverything looks good.\n\n## Structured State\n\n\
\
\
\`\`\`json\n{\n  "kind": "roadmap.review.result",\n  "roadmapId": "RM-core",\n  "sliceId": "RM-core-001",\n  "phase": "review",\n  "status": "pass",\n  "followUps": [],\n  "requiresUserDecision": true\n}\n\`\`\``;

  const parsed = parseRoadmapWorkflowMarkdownArtifact(markdown);

  assert.equal(parsed.artifact.kind, 'roadmap.review.result');
  assert.equal(parsed.artifact.roadmapId, 'RM-core');
  assert.equal(parsed.artifact.sliceId, 'RM-core-001');
  assert.equal(parsed.structuredBlock.includes('"phase": "review"'), true);
  assert.equal(parsed.checksum, computeRoadmapWorkflowArtifactChecksum(markdown));
});
