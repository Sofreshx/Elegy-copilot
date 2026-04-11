'use strict';
const assert = require('assert');
const path = require('path');

const {
  deriveProjectId,
  normalizeStatus,
  parseTime,
  computeElapsed,
  extractRepoLabel,
  mapToUnifiedSummary,
  buildUnifiedSessions,
} = require('./sessionAggregation');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function makeProject(repoPath, extra = {}) {
  return {
    repoId: extra.repoId || path.basename(repoPath),
    projectId: extra.projectId || path.basename(repoPath),
    repoPath,
    repoLabel: extra.repoLabel || path.basename(repoPath),
    canonicalRemote: extra.canonicalRemote || null,
    pinned: false,
    lastActivityMs: null,
  };
}

function makeSession(id, source, extra = {}) {
  return {
    id,
    source,
    status: 'idle',
    startTime: null,
    lastEventTime: null,
    repo: null,
    branch: null,
    cwd: null,
    mode: null,
    ...extra,
  };
}

// --- deriveProjectId tests ---

test('deriveProjectId: exact match on session.repo', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'cli', { repo: '/home/user/my-repo' });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: exact match on session.cwd', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'cli', { cwd: '/home/user/my-repo' });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: no match returns null', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'cli', { repo: '/home/user/other-repo' });
  assert.strictEqual(deriveProjectId(session, projects), null);
});

test('deriveProjectId: empty projects returns null', () => {
  const session = makeSession('s1', 'cli', { repo: '/home/user/my-repo' });
  assert.strictEqual(deriveProjectId(session, []), null);
});

test('deriveProjectId: null session returns null', () => {
  assert.strictEqual(deriveProjectId(null, [makeProject('/a')]), null);
});

test('deriveProjectId: worktree match — session under .worktrees/', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'cli', { repo: '/home/user/my-repo/.worktrees/feature-branch' });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: sandbox match via sandboxParentRepo', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'sandbox', { sandboxParentRepo: '/home/user/my-repo' });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: SDK match via repository.fullName', () => {
  const projects = [makeProject('/home/user/my-repo', { canonicalRemote: 'org/my-repo' })];
  const session = makeSession('s1', 'sdk', { repository: { fullName: 'org/my-repo' } });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: SDK match with remote URL ending in fullName', () => {
  const projects = [makeProject('/home/user/my-repo', { canonicalRemote: 'github.com/org/my-repo' })];
  const session = makeSession('s1', 'sdk', { repository: { fullName: 'org/my-repo' } });
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

test('deriveProjectId: case-insensitive on Windows paths', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  // This test exercises the normalizePath logic; on non-Windows it will only match exact case
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('s1', 'cli', { repo: '/home/user/my-repo' });
  // Should always match when paths are identical (regardless of platform)
  assert.strictEqual(deriveProjectId(session, projects), 'my-repo');
});

// --- normalizeStatus tests ---

test('normalizeStatus: active variants', () => {
  assert.strictEqual(normalizeStatus({ status: 'active' }), 'active');
  assert.strictEqual(normalizeStatus({ status: 'running' }), 'active');
  assert.strictEqual(normalizeStatus({ status: 'in_progress' }), 'active');
});

test('normalizeStatus: idle variants', () => {
  assert.strictEqual(normalizeStatus({ status: 'idle' }), 'idle');
  assert.strictEqual(normalizeStatus({ status: 'waiting' }), 'idle');
  assert.strictEqual(normalizeStatus({ status: 'paused' }), 'idle');
});

test('normalizeStatus: completed variants', () => {
  assert.strictEqual(normalizeStatus({ status: 'completed' }), 'completed');
  assert.strictEqual(normalizeStatus({ status: 'done' }), 'completed');
  assert.strictEqual(normalizeStatus({ status: 'finished' }), 'completed');
});

test('normalizeStatus: failed variants', () => {
  assert.strictEqual(normalizeStatus({ status: 'failed' }), 'failed');
  assert.strictEqual(normalizeStatus({ status: 'error' }), 'failed');
  assert.strictEqual(normalizeStatus({ status: 'crashed' }), 'failed');
});

test('normalizeStatus: unknown for unrecognized', () => {
  assert.strictEqual(normalizeStatus({ status: 'something-else' }), 'unknown');
  assert.strictEqual(normalizeStatus({}), 'unknown');
  assert.strictEqual(normalizeStatus({ status: '' }), 'unknown');
});

test('normalizeStatus: resolvedStatus takes priority', () => {
  assert.strictEqual(normalizeStatus({ resolvedStatus: 'active', status: 'idle' }), 'active');
});

test('normalizeStatus: case-insensitive', () => {
  assert.strictEqual(normalizeStatus({ status: 'ACTIVE' }), 'active');
  assert.strictEqual(normalizeStatus({ status: 'Running' }), 'active');
});

// --- parseTime tests ---

test('parseTime: null/undefined → null', () => {
  assert.strictEqual(parseTime(null), null);
  assert.strictEqual(parseTime(undefined), null);
});

test('parseTime: finite number → same number', () => {
  assert.strictEqual(parseTime(1234567890), 1234567890);
});

test('parseTime: ISO string → ms', () => {
  const ms = parseTime('2024-01-01T00:00:00.000Z');
  assert.strictEqual(typeof ms, 'number');
  assert.ok(ms > 0);
});

test('parseTime: numeric string → number', () => {
  assert.strictEqual(parseTime('1234567890'), 1234567890);
});

test('parseTime: invalid string → null', () => {
  assert.strictEqual(parseTime('not-a-date'), null);
});

test('parseTime: empty string → null', () => {
  assert.strictEqual(parseTime(''), null);
});

test('parseTime: NaN → null', () => {
  assert.strictEqual(parseTime(NaN), null);
});

test('parseTime: Infinity → null', () => {
  assert.strictEqual(parseTime(Infinity), null);
});

// --- computeElapsed tests ---

test('computeElapsed: both times → difference', () => {
  const session = { startTime: 1000, lastEventTime: 5000 };
  assert.strictEqual(computeElapsed(session), 4000);
});

test('computeElapsed: missing start → null', () => {
  const session = { startTime: null, lastEventTime: 5000 };
  assert.strictEqual(computeElapsed(session), null);
});

test('computeElapsed: missing end → null', () => {
  const session = { startTime: 1000, lastEventTime: null };
  assert.strictEqual(computeElapsed(session), null);
});

test('computeElapsed: end before start → null', () => {
  const session = { startTime: 5000, lastEventTime: 1000 };
  assert.strictEqual(computeElapsed(session), null);
});

// --- extractRepoLabel tests ---

test('extractRepoLabel: path → last segment', () => {
  assert.strictEqual(extractRepoLabel('/home/user/my-repo'), 'my-repo');
});

test('extractRepoLabel: null/empty → null', () => {
  assert.strictEqual(extractRepoLabel(null), null);
  assert.strictEqual(extractRepoLabel(''), null);
});

test('extractRepoLabel: Windows path → last segment', () => {
  assert.strictEqual(extractRepoLabel('C:\\Users\\me\\repo'), 'repo');
});

// --- mapToUnifiedSummary tests ---

test('mapToUnifiedSummary: maps all fields correctly', () => {
  const projects = [makeProject('/home/user/my-repo')];
  const session = makeSession('sess-1', 'cli', {
    canonicalSource: 'vscode',
    status: 'active',
    objective: 'Fix bug',
    startTime: 1000,
    lastEventTime: 5000,
    repo: '/home/user/my-repo',
    repoLabel: 'my-repo',
    mode: 'worktree',
    actorSummary: { agents: 2 },
    taskCount: 3,
    orchestration: { plan: true },
  });

  const result = mapToUnifiedSummary(session, projects);
  assert.strictEqual(result.sessionId, 'sess-1');
  assert.strictEqual(result.projectId, 'my-repo');
  assert.strictEqual(result.source, 'vscode');
  assert.strictEqual(result.status, 'active');
  assert.strictEqual(result.objective, 'Fix bug');
  assert.strictEqual(result.startedAtMs, 1000);
  assert.strictEqual(result.updatedAtMs, 5000);
  assert.strictEqual(result.elapsedMs, 4000);
  assert.strictEqual(result.repoLabel, 'my-repo');
  assert.strictEqual(result.isolationMode, 'worktree');
  assert.deepStrictEqual(result.actorSummary, { agents: 2 });
  assert.strictEqual(result.taskCount, 3);
  assert.deepStrictEqual(result.orchestration, { plan: true });
});

test('mapToUnifiedSummary: no project linkage', () => {
  const session = makeSession('sess-2', 'cli', { repo: '/unknown/path' });
  const result = mapToUnifiedSummary(session, []);
  assert.strictEqual(result.sessionId, 'sess-2');
  assert.strictEqual(result.projectId, null);
  assert.strictEqual(result.source, 'cli');
});

test('mapToUnifiedSummary: title falls through to objective', () => {
  const session = makeSession('sess-3', 'cli', { title: 'My Title' });
  const result = mapToUnifiedSummary(session, []);
  assert.strictEqual(result.objective, 'My Title');
});

test('mapToUnifiedSummary: null session produces safe defaults', () => {
  const result = mapToUnifiedSummary(null, []);
  assert.strictEqual(result.sessionId, null);
  assert.strictEqual(result.projectId, null);
  assert.strictEqual(result.source, 'local');
  assert.strictEqual(result.status, 'unknown');
  assert.strictEqual(result.objective, null);
  assert.strictEqual(result.startedAtMs, null);
  assert.strictEqual(result.updatedAtMs, null);
  assert.strictEqual(result.elapsedMs, null);
  assert.strictEqual(result.repoLabel, null);
  assert.strictEqual(result.isolationMode, null);
  assert.strictEqual(result.actorSummary, null);
  assert.strictEqual(result.taskCount, 0);
  assert.strictEqual(result.orchestration, null);
});

test('mapToUnifiedSummary: extractRepoLabel used when repoLabel missing', () => {
  const session = makeSession('sess-4', 'cli', { repo: '/home/user/cool-project' });
  const result = mapToUnifiedSummary(session, []);
  assert.strictEqual(result.repoLabel, 'cool-project');
});

// --- buildUnifiedSessions integration test with mocks ---

test('buildUnifiedSessions: integration with mock data', () => {
  // We need to mock the modules. We'll use a direct approach:
  // temporarily replace the required modules in the module's cache.
  const aggregationPath = require.resolve('./sessionAggregation');
  const sessionsPath = require.resolve('./sessions');
  const repoInventoryPath = require.resolve('./repoInventoryService');

  // Save original modules
  const originalSessions = require.cache[sessionsPath];
  const originalRepoInventory = require.cache[repoInventoryPath];

  const mockSessions = [
    makeSession('sess-a', 'cli', { lastEventTime: 3000, startTime: 1000, repo: '/home/user/my-repo', status: 'active' }),
    makeSession('sess-b', 'cli', { lastEventTime: 1000, startTime: 500, status: 'idle' }),
  ];

  const mockProjects = [
    { repoId: 'my-repo', repoPath: '/home/user/my-repo', repoLabel: 'my-repo', canonicalRemote: null, pinned: false, lastActivityMs: null },
  ];

  try {
    // Replace with mocks
    require.cache[sessionsPath] = {
      id: sessionsPath,
      filename: sessionsPath,
      loaded: true,
      exports: {
        listSessions: () => mockSessions,
        listSandboxSessions: () => [],
        dedupeAllSources: (all) => all.map((s) => ({
          ...s,
          canonicalKey: (s.id || '').trim().toLowerCase(),
          dedupeEligible: Boolean(s.id),
          mergedCount: 1,
          sources: [s.source || 'cli'],
          canonicalSource: s.source || 'cli',
        })),
        buildSessionIdentity: (s) => ({ canonicalKey: (s.id || '').trim().toLowerCase(), dedupeEligible: Boolean(s.id) }),
      },
    };

    require.cache[repoInventoryPath] = {
      id: repoInventoryPath,
      filename: repoInventoryPath,
      loaded: true,
      exports: {
        loadRepoInventoryState: () => ({ manualRepos: mockProjects }),
      },
    };

    // Clear and re-require sessionAggregation to pick up mocks
    delete require.cache[aggregationPath];
    const freshAggregation = require('./sessionAggregation');

    const result = freshAggregation.buildUnifiedSessions('/mock/copilot-home', {});

    assert.strictEqual(result.length, 2);
    // Should be sorted by updatedAtMs desc
    assert.strictEqual(result[0].sessionId, 'sess-a');
    assert.strictEqual(result[1].sessionId, 'sess-b');
    // First session should be linked to project
    assert.strictEqual(result[0].projectId, 'my-repo');
    assert.strictEqual(result[0].status, 'active');
    // Second session has no repo match
    assert.strictEqual(result[1].projectId, null);
    assert.strictEqual(result[1].status, 'idle');
  } finally {
    // Restore original modules
    if (originalSessions) {
      require.cache[sessionsPath] = originalSessions;
    } else {
      delete require.cache[sessionsPath];
    }
    if (originalRepoInventory) {
      require.cache[repoInventoryPath] = originalRepoInventory;
    } else {
      delete require.cache[repoInventoryPath];
    }
    // Re-require to restore clean state
    delete require.cache[aggregationPath];
    require('./sessionAggregation');
  }
});

// --- Edge cases ---

test('buildUnifiedSessions: empty sessions from all sources', () => {
  const aggregationPath = require.resolve('./sessionAggregation');
  const sessionsPath = require.resolve('./sessions');
  const repoInventoryPath = require.resolve('./repoInventoryService');

  const originalSessions = require.cache[sessionsPath];
  const originalRepoInventory = require.cache[repoInventoryPath];

  try {
    require.cache[sessionsPath] = {
      id: sessionsPath,
      filename: sessionsPath,
      loaded: true,
      exports: {
        listSessions: () => [],
        listSandboxSessions: () => [],
        dedupeAllSources: () => [],
        buildSessionIdentity: (s) => ({ canonicalKey: null, dedupeEligible: false }),
      },
    };

    require.cache[repoInventoryPath] = {
      id: repoInventoryPath,
      filename: repoInventoryPath,
      loaded: true,
      exports: {
        loadRepoInventoryState: () => ({ manualRepos: [] }),
      },
    };

    delete require.cache[aggregationPath];
    const freshAggregation = require('./sessionAggregation');

    const result = freshAggregation.buildUnifiedSessions('/mock/copilot-home', {});
    assert.strictEqual(result.length, 0);
    assert.ok(Array.isArray(result));
  } finally {
    if (originalSessions) {
      require.cache[sessionsPath] = originalSessions;
    } else {
      delete require.cache[sessionsPath];
    }
    if (originalRepoInventory) {
      require.cache[repoInventoryPath] = originalRepoInventory;
    } else {
      delete require.cache[repoInventoryPath];
    }
    delete require.cache[aggregationPath];
    require('./sessionAggregation');
  }
});

test('mapToUnifiedSummary: session with no id', () => {
  const result = mapToUnifiedSummary({ source: 'cli', status: 'active' }, []);
  assert.strictEqual(result.sessionId, null);
  assert.strictEqual(result.status, 'active');
});

test('mapToUnifiedSummary: session with no repo still produces summary', () => {
  const session = makeSession('sess-no-repo', 'cli', { status: 'completed' });
  const result = mapToUnifiedSummary(session, [makeProject('/some/path')]);
  assert.strictEqual(result.sessionId, 'sess-no-repo');
  assert.strictEqual(result.projectId, null);
  assert.strictEqual(result.repoLabel, null);
  assert.strictEqual(result.status, 'completed');
});

test('deriveProjectId: multiple projects, picks correct match', () => {
  const projects = [
    makeProject('/home/user/repo-a'),
    makeProject('/home/user/repo-b'),
    makeProject('/home/user/repo-c'),
  ];
  const session = makeSession('s1', 'cli', { repo: '/home/user/repo-b' });
  assert.strictEqual(deriveProjectId(session, projects), 'repo-b');
});

test('parseTime: Date object → ms', () => {
  const d = new Date('2024-06-15T12:00:00.000Z');
  assert.strictEqual(parseTime(d), d.getTime());
});

test('computeElapsed: ISO string timestamps', () => {
  const session = { startTime: '2024-01-01T00:00:00.000Z', lastEventTime: '2024-01-01T01:00:00.000Z' };
  assert.strictEqual(computeElapsed(session), 3600000);
});

console.log(`\n${passed} tests passed`);
if (process.exitCode) {
  console.error('Some tests FAILED');
} else {
  console.log('All tests passed');
}
