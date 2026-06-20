'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseGitWorktreePorcelain,
  inferWorktreeSource,
  parseAheadBehindPorcelain,
  parseStatusPorcelainV2Lines,
  resolveStatusCountsFromFiles,
  mergePersistedAndDiscoveredWorktrees,
  sortWorktreesForDisplay,
  buildGitDiscoveredWorktreeRecord,
  discoverAndMergeWorktrees,
  WORKTREE_DISCOVERY_SOURCES,
  normalizeComparablePath,
} = require('./worktreeDiscovery');
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
function fakeChildProcess(handlers) {
  return {
    execFile(command, args, options, callback) {
      const key = `${command} ${args.join(' ')}`;
      const handler = handlers[key];
      if (!handler) {
        callback(Object.assign(new Error(`unexpected call: ${key}`), { code: 1 }), '', '');
        return { on() {}, once() {} };
      }
      Promise.resolve()
        .then(() => handler({ command, args, options }))
        .then((result) => {
          if (result && result.ok === false) {
            const error = new Error(result.message || `${command} ${args.join(' ')} failed`);
            if (Number.isFinite(result.code)) error.code = result.code;
            callback(error, result.stdout || '', result.stderr || '');
            return;
          }
          callback(null, (result && result.stdout) || '', (result && result.stderr) || '');
        })
        .catch((error) => {
          callback(error, '', String(error && error.message) || '');
        });
      return { on() {}, once() {} };
    },
  };
}
function nowIso(value) {
  return new Date(typeof value === 'function' ? value() : value).toISOString();
}
async function run() {
  await test('parseGitWorktreePorcelain parses mixed detached, bare, locked, and prunable entries', () => {
    const output = [
      'worktree C:/repos/main',
      'HEAD abcdef0123456789',
      'branch refs/heads/main',
      '',
      'worktree C:/repos/feature',
      'HEAD 1234567890abcdef',
      'branch refs/heads/feature/x',
      'locked working tree locked',
      '',
      'worktree C:/repos/detached',
      'HEAD deadbeefcafebabe',
      'detached',
      '',
      'worktree C:/repos/bare',
      'HEAD 0000000000000000',
      'bare',
      '',
      'worktree C:/repos/prunable',
      'HEAD feedfacefeedface',
      'branch refs/heads/old',
      'prunable gitdir file points to non-existent location',
      '',
    ].join('\n');
    const parsed = parseGitWorktreePorcelain(output);
    assert.equal(parsed.length, 5);
    assert.equal(parsed[0].path, 'C:/repos/main');
    assert.equal(parsed[0].branch, 'main');
    assert.equal(parsed[1].branch, 'feature/x');
    assert.equal(parsed[1].locked, 'working tree locked');
    assert.equal(parsed[2].detached, true);
    assert.equal(parsed[2].branch, null);
    assert.equal(parsed[3].bare, true);
    assert.equal(parsed[4].prunable, 'gitdir file points to non-existent location');
  });
  await test('inferWorktreeSource maps paths to expected source buckets', () => {
    const pathImpl = path;
    assert.equal(
      inferWorktreeSource(pathImpl.resolve('C:/Users/me/.codex/worktrees/436c/elegy-copilot'), null),
      WORKTREE_DISCOVERY_SOURCES.CODEX,
    );
    assert.equal(
      inferWorktreeSource(pathImpl.resolve('C:/Users/me/.local/share/opencode/worktree/proj/branch'), null),
      WORKTREE_DISCOVERY_SOURCES.OPENCODE,
    );
    assert.equal(
      inferWorktreeSource(pathImpl.resolve('C:/repos/repo-worktrees/wt-1'), null),
      WORKTREE_DISCOVERY_SOURCES.ELEGY,
    );
    assert.equal(
      inferWorktreeSource(pathImpl.resolve('C:/Users/me/.elegy/repo-state/repoId/worktrees/wt-1'), null),
      WORKTREE_DISCOVERY_SOURCES.ELEGY,
    );
    assert.equal(
      inferWorktreeSource(pathImpl.resolve('C:/repos/manual-tmp'), null),
      WORKTREE_DISCOVERY_SOURCES.MANUAL,
    );
    assert.equal(inferWorktreeSource(null, 'codex'), WORKTREE_DISCOVERY_SOURCES.CODEX);
    assert.equal(inferWorktreeSource(null, 'opencode'), WORKTREE_DISCOVERY_SOURCES.OPENCODE);
    assert.equal(inferWorktreeSource(null, 'elegy'), WORKTREE_DISCOVERY_SOURCES.ELEGY);
  });
  await test('parseAheadBehindPorcelain handles branch.ab, plain ahead/behind text, and zero values', () => {
    assert.deepEqual(parseAheadBehindPorcelain('# branch.ab +3 -2'), { ahead: 3, behind: 2 });
    assert.deepEqual(parseAheadBehindPorcelain('Your branch is ahead of origin/main by 4 commits'), { ahead: 4, behind: 0 });
    assert.deepEqual(parseAheadBehindPorcelain('Your branch is behind origin/main by 1 commit'), { ahead: 0, behind: 1 });
    assert.deepEqual(parseAheadBehindPorcelain(''), { ahead: 0, behind: 0 });
  });
  await test('parseStatusPorcelainV2Lines collects staged/unstaged/untracked entries', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head main',
      '1 .M N... 100644 100644 100644 abc123 file-modified',
      '1 M. N... 100644 100644 100644 abc123 file-staged',
      '1 A. N... 100644 100644 100644 abc123 file-added',
      '1 D. N... 100644 100644 100644 abc123 file-deleted',
      '1 .D N... 100644 100644 100644 abc123 file-deleted-worktree',
      '? untracked-file',
    ].join('\n');
    const files = parseStatusPorcelainV2Lines(output);
    assert.equal(files.length, 6);
    const counts = resolveStatusCountsFromFiles(files);
    assert.equal(counts.staged, 3);
    assert.equal(counts.unstaged, 2);
    assert.equal(counts.untracked, 1);
    assert.equal(counts.changed, 6);
  });
  await test('mergePersistedAndDiscoveredWorktrees dedupes by comparable path and prefers persisted app metadata', () => {
    const persisted = [
      {
        worktreeId: 'wt-1',
        repoId: 'elegy-copilot',
        repoPath: 'C:/repos/elegy-copilot',
        mode: 'dedicated',
        path: 'C:\\repos\\elegy-copilot-worktrees\\wt-1',
        source: 'executor',
        status: 'ready',
        launch: { blocked: false, reason: null },
        assignment: { sessionId: 'sess-1', runId: 'run-1', overlaySessionId: null },
        lifecycle: { lastSeenAt: '2026-06-01T00:00:00.000Z' },
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ];
    const discovered = [
      {
        path: 'C:/repos/elegy-copilot-worktrees/wt-1',
        branch: 'feature/missing',
        source: 'elegy',
        git: { head: 'abc', ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0, changed: 1, detached: false },
        validation: { pathExists: true, gitWorktree: true, checkedAt: '2026-06-02T00:00:00.000Z' },
        lifecycle: { lastSeenAt: '2026-06-02T00:00:00.000Z' },
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
      {
        path: 'C:/Users/me/.codex/worktrees/436c/elegy-copilot',
        branch: 'main',
        source: 'codex',
        git: { head: 'def', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, changed: 0, detached: true },
        validation: { pathExists: true, gitWorktree: true, checkedAt: '2026-06-02T00:00:00.000Z' },
        lifecycle: { lastSeenAt: '2026-06-02T00:00:00.000Z' },
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    ];
    const merged = mergePersistedAndDiscoveredWorktrees(persisted, discovered);
    assert.equal(merged.length, 2);
    const persistedMerged = merged.find((entry) => entry.worktreeId === 'wt-1');
    const discoveredOnly = merged.find((entry) => entry.path.toLowerCase().includes('.codex'));
    assert.equal(persistedMerged._merged, 'both');
    assert.equal(persistedMerged.branch, 'feature/missing');
    assert.equal(persistedMerged.source, 'elegy');
    assert.equal(persistedMerged.git.changed, 1);
    assert.equal(persistedMerged.assignment.sessionId, 'sess-1');
    assert.equal(discoveredOnly._discoveredOnly, true);
    assert.equal(discoveredOnly.source, 'codex');
    assert.equal(discoveredOnly._discovered, true);
  });
  await test('sortWorktreesForDisplay orders by updatedAt, lifecycle.lastSeenAt, then stable git-list order', () => {
    const pathImpl = path;
    const records = [
      {
        path: pathImpl.resolve('C:/repos/c'),
        updatedAt: '2026-05-01T00:00:00.000Z',
        lifecycle: { lastSeenAt: null },
        git: { mtimeMs: 0 },
        _stableOrder: 5,
      },
      {
        path: pathImpl.resolve('C:/repos/a'),
        updatedAt: null,
        lifecycle: { lastSeenAt: '2026-06-05T00:00:00.000Z' },
        git: { mtimeMs: 0 },
        _stableOrder: 99,
      },
      {
        path: pathImpl.resolve('C:/repos/b'),
        updatedAt: '2026-06-04T00:00:00.000Z',
        lifecycle: { lastSeenAt: null },
        git: { mtimeMs: 0 },
        _stableOrder: 0,
      },
      {
        path: pathImpl.resolve('C:/repos/d'),
        updatedAt: null,
        lifecycle: { lastSeenAt: null },
        git: { mtimeMs: Date.parse('2026-06-01T00:00:00.000Z') },
        _stableOrder: 0,
      },
    ];
    const sorted = sortWorktreesForDisplay(records);
    assert.equal(sorted[0].path, pathImpl.resolve('C:/repos/a'));
    assert.equal(sorted[1].path, pathImpl.resolve('C:/repos/b'));
    assert.equal(sorted[2].path, pathImpl.resolve('C:/repos/d'));
    assert.equal(sorted[3].path, pathImpl.resolve('C:/repos/c'));
  });
  await test('buildGitDiscoveredWorktreeRecord produces stable ids and source label', () => {
    const fsImpl = {
      statSync() { return { isDirectory: () => true, mtimeMs: 1717200000000 }; },
    };
    const pathImpl = path;
    const entry = {
      path: 'C:/Users/me/.local/share/opencode/worktree/proj/branch',
      head: 'feedface',
      branch: 'branch',
      detached: false,
      bare: false,
      locked: '',
      prunable: '',
    };
    const probe = {
      pathExists: true,
      error: null,
      branch: 'branch',
      detached: false,
      ahead: 1,
      behind: 2,
      staged: 1,
      unstaged: 3,
      untracked: 0,
      changed: 4,
    };
    const record = buildGitDiscoveredWorktreeRecord({
      gitEntry: entry,
      probe,
      fs: fsImpl,
      path: pathImpl,
      source: WORKTREE_DISCOVERY_SOURCES.OPENCODE,
      stableOrder: 2,
    });
    assert.equal(record.source, 'opencode');
    assert.equal(record._discovered, true);
    assert.equal(record._discoveredOnly, true);
    assert.match(record.worktreeId, /^wt-git-[0-9a-f]{8}$/);
    assert.equal(record.branch, 'branch');
    assert.equal(record.git.ahead, 1);
    assert.equal(record.git.changed, 4);
    assert.equal(record._stableOrder, 2);
    assert.equal(record.validation.pathExists, true);
  });
  await test('buildGitDiscoveredWorktreeRecord generates distinct ids for different paths/heads', () => {
    const fsImpl = { statSync() { return { isDirectory: () => true, mtimeMs: 0 }; } };
    const pathImpl = path;
    const base = (path, head) => buildGitDiscoveredWorktreeRecord({
      gitEntry: { path, head, branch: null, detached: true, bare: false, locked: '', prunable: '' },
      probe: { pathExists: true, error: null, branch: null, detached: true, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, changed: 0 },
      fs: fsImpl,
      path: pathImpl,
      source: WORKTREE_DISCOVERY_SOURCES.MANUAL,
      stableOrder: 0,
    });
    const a = base('C:/a', '1');
    const b = base('C:/a', '2');
    const c = base('C:/b', '1');
    assert.notEqual(a.worktreeId, b.worktreeId);
    assert.notEqual(a.worktreeId, c.worktreeId);
  });
  await test('discoverAndMergeWorktrees returns only persisted records when repoPath is missing', async () => {
    const pathImpl = path;
    const persisted = [
      { path: 'C:/repos/keep', updatedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const result = await discoverAndMergeWorktrees(
      { repoPath: null, persistedRecords: persisted },
      { fs, path: pathImpl, childProcess: fakeChildProcess({}) },
    );
    assert.equal(result.gitListOk, false);
    assert.equal(result.persistedCount, 1);
    assert.equal(result.discoveredCount, 0);
    assert.equal(result.mergedRecords.length, 1);
    assert.equal(result.mergedRecords[0].path, 'C:/repos/keep');
  });
  await test('discoverAndMergeWorktrees merges git discovery with persisted records using fake child process', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-wt-discovery-'));
    const repoPath = path.join(tmpRoot, 'elegy-copilot');
    const wt1 = path.join(tmpRoot, 'elegy-copilot-worktrees', 'wt-1');
    const wt2 = path.join(tmpRoot, 'manual-tmp');
    const codex = path.join(tmpRoot, '.codex', 'worktrees', '436c', 'elegy-copilot');
    fs.mkdirSync(wt1, { recursive: true });
    fs.mkdirSync(wt2, { recursive: true });
    fs.mkdirSync(codex, { recursive: true });
    fs.writeFileSync(path.join(wt1, '.git'), 'gitdir: C:/fake/wt-1');
    fs.writeFileSync(path.join(codex, '.git'), 'gitdir: C:/fake/codex');
    const handlers = {
      'git worktree list --porcelain': async () => ({
        ok: true,
        stdout: [
          `worktree ${wt1}`,
          'HEAD abc111',
          'branch refs/heads/feature/missing',
          '',
          `worktree ${wt2}`,
          'HEAD abc222',
          'detached',
          '',
          `worktree ${codex}`,
          'HEAD abc333',
          'detached',
          '',
        ].join('\n'),
        stderr: '',
      }),
      'git status --porcelain=v2 --branch': async ({ options }) => {
        if (options.cwd === wt1) {
          return { ok: true, stdout: '# branch.head feature/missing\n# branch.ab +0 -1\n1 .M N... 100644 100644 100644 aaa file-modified\n? untracked.txt', stderr: '' };
        }
        if (options.cwd === wt2) {
          return { ok: true, stdout: '# branch.oid abc222\n# branch.head (detached)\n', stderr: '' };
        }
        if (options.cwd === codex) {
          return { ok: true, stdout: '# branch.oid abc333\n# branch.head (detached)\n1 M. N... 100644 100644 100644 aaa file-staged', stderr: '' };
        }
        return { ok: true, stdout: '', stderr: 'unknown' };
      },
    };
    const persisted = [
      {
        worktreeId: 'wt-1',
        repoId: 'elegy-copilot',
        repoPath,
        mode: 'dedicated',
        path: wt1,
        source: 'executor',
        status: 'ready',
        launch: { blocked: false, reason: null },
        assignment: { sessionId: 'sess-1', runId: 'run-1', overlaySessionId: null },
        lifecycle: { lastSeenAt: '2026-06-02T00:00:00.000Z' },
        updatedAt: '2026-06-02T00:00:00.000Z',
      },
    ];
    try {
      const result = await discoverAndMergeWorktrees(
        { repoPath, persistedRecords: persisted },
        { fs, path, childProcess: fakeChildProcess(handlers) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.persistedCount, 1);
      assert.equal(result.discoveredCount, 3);
      assert.equal(result.mergedRecords.length, 3);
      const persistedMerged = result.mergedRecords.find((entry) => entry.worktreeId === 'wt-1');
      const codexOnly = result.mergedRecords.find((entry) => normalizeComparablePath(path, entry.path) === normalizeComparablePath(path, codex));
      const manualOnly = result.mergedRecords.find((entry) => normalizeComparablePath(path, entry.path) === normalizeComparablePath(path, wt2));
      assert.equal(persistedMerged._merged, 'both');
      assert.equal(persistedMerged.branch, 'feature/missing');
      assert.equal(persistedMerged.assignment.sessionId, 'sess-1');
      assert.equal(persistedMerged.git.behind, 1);
      assert.equal(persistedMerged.git.changed, 2);
      assert.equal(codexOnly._discoveredOnly, true);
      assert.equal(codexOnly.source, 'codex');
      assert.equal(codexOnly.git.detached, true);
      assert.equal(codexOnly.git.staged, 1);
      assert.equal(manualOnly.source, 'manual');
      assert.equal(manualOnly.git.detached, true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('discoverAndMergeWorktrees isolates per-worktree probe failures without failing the response', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-wt-discovery-fail-'));
    const repoPath = path.join(tmpRoot, 'repo');
    const good = path.join(tmpRoot, 'repo', 'good');
    const broken = path.join(tmpRoot, 'repo', 'broken');
    fs.mkdirSync(good, { recursive: true });
    fs.mkdirSync(broken, { recursive: true });
    fs.mkdirSync(repoPath, { recursive: true });
    const handlers = {
      'git worktree list --porcelain': async () => ({
        ok: true,
        stdout: [
          `worktree ${good}`,
          'HEAD aaa',
          'branch refs/heads/good',
          '',
          `worktree ${broken}`,
          'HEAD bbb',
          'branch refs/heads/broken',
          '',
        ].join('\n'),
        stderr: '',
      }),
      'git status --porcelain=v2 --branch': async ({ options }) => {
        if (options.cwd === good) {
          return { ok: true, stdout: '# branch.head good\n', stderr: '' };
        }
        return { ok: false, code: 128, stdout: '', stderr: 'fatal: not a git repository', message: 'git status failed' };
      },
    };
    try {
      const result = await discoverAndMergeWorktrees(
        { repoPath, persistedRecords: [] },
        { fs, path, childProcess: fakeChildProcess(handlers) },
      );
      assert.equal(result.ok, true);
      assert.equal(result.discoveredCount, 2);
      const goodRecord = result.mergedRecords.find((entry) => normalizeComparablePath(path, entry.path) === normalizeComparablePath(path, good));
      const brokenRecord = result.mergedRecords.find((entry) => normalizeComparablePath(path, entry.path) === normalizeComparablePath(path, broken));
      assert.equal(goodRecord.validation.pathExists, true);
      assert.equal(goodRecord.git.probeError, null);
      assert.equal(brokenRecord.validation.pathExists, true);
      assert.match(brokenRecord.git.probeError, /not a git repository/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  await test('discoverAndMergeWorktrees returns empty list when git is not on PATH and does not throw', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-wt-discovery-empty-'));
    const repoPath = path.join(tmpRoot, 'repo');
    fs.mkdirSync(repoPath, { recursive: true });
    const handlers = {
      'git worktree list --porcelain': async () => ({ ok: false, code: 'ENOENT', stdout: '', stderr: '', message: 'spawn git ENOENT' }),
    };
    try {
      const result = await discoverAndMergeWorktrees(
        { repoPath, persistedRecords: [] },
        { fs, path, childProcess: fakeChildProcess(handlers) },
      );
      assert.equal(result.ok, false);
      assert.equal(result.discoveredCount, 0);
      assert.equal(result.mergedRecords.length, 0);
      assert.ok(result.gitListError && result.gitListError.length > 0);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}
run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
