'use strict';

const assert = require('node:assert/strict');

const { register } = require('./executor');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequest(body) {
  const listeners = new Map();
  return {
    __body: body,
    on(eventName, handler) {
      if (!listeners.has(eventName)) {
        listeners.set(eventName, new Set());
      }
      listeners.get(eventName).add(handler);
    },
  };
}

function createResponse() {
  const state = {
    statusCode: null,
    bodyText: '',
  };

  return {
    writeHead(statusCode) {
      state.statusCode = statusCode;
    },
    end(text) {
      state.bodyText = String(text || '');
    },
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.bodyText.trim() ? JSON.parse(state.bodyText) : null;
    },
  };
}

async function invoke(routes, method, pathname, body) {
  const req = createRequest(body);
  const res = createResponse();

  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      route.handler({ req, res, match: null, pathname });
      await sleep(0);
      return { req, res };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        route.handler({ req, res, match, pathname });
        await sleep(0);
        return { req, res };
      }
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invokeWithQuery(routes, method, fullPath, deps) {
  const req = createRequest(null);
  const res = createResponse();
  const queryIndex = fullPath.indexOf('?');
  const pathname = queryIndex === -1 ? fullPath : fullPath.slice(0, queryIndex);
  const search = queryIndex === -1 ? '' : fullPath.slice(queryIndex);
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      const ctx = {
        req,
        res,
        match: null,
        pathname: fullPath,
        u: {
          pathname,
          search,
          searchParams: new URLSearchParams(search.startsWith('?') ? search.slice(1) : search),
        },
      };
      const result = route.handler(ctx, deps);
      if (result && typeof result.then === 'function') {
        await result;
      } else {
        await sleep(0);
      }
      return { req, res };
    }
  }
  throw new Error(`Route not found for ${method} ${fullPath}`);
}

async function run() {
  const calls = [];
  const listWorktreesCalls = [];
  const executorService = {
    getHealth() {
      calls.push('health');
      return { enabled: true, state: 'ready', jobCount: 1, runCount: 1, activeRunCount: 0, scheduledJobCount: 0, openedSessionCount: 1 };
    },
    listJobs() {
      calls.push('jobs');
      return [{ id: 'job-1', title: 'job-1', prompt: 'test', retryPolicy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, jitterRatio: 0 }, status: 'idle', createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z' }];
    },
    listRuns() {
      calls.push('runs');
      return [{ id: 'run-1', jobId: 'job-1', status: 'succeeded', attemptCount: 1, maxAttempts: 3, createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z', events: [] }];
    },
    listWorktrees(options) {
      listWorktreesCalls.push(options);
      if (options && options.repoId === 'repo-1') {
        return [{
          worktreeId: 'wt-1',
          repoId: 'repo-1',
          repoPath: '/repo-1',
          mode: 'dedicated',
          path: '/repo-1-worktrees/wt-1',
          source: 'executor',
          status: 'ready',
          launch: { blocked: false, reason: null },
          updatedAt: '2026-03-20T00:00:00.000Z',
        }];
      }
      if (options && options.repoId === 'repo-empty') {
        return [];
      }
      return [{
        worktreeId: 'wt-all',
        repoId: 'repo-1',
        repoPath: '/repo-1',
        mode: 'dedicated',
        path: '/repo-1-worktrees/wt-all',
        source: 'executor',
        status: 'ready',
        launch: { blocked: false, reason: null },
      }];
    },
    getRun(runId) {
      calls.push(`run:${runId}`);
      return { id: runId, jobId: 'job-1', status: 'succeeded', attemptCount: 1, maxAttempts: 3, createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z', events: [] };
    },
  };

  const fakeDiscovery = {
    async discoverAndMergeWorktrees(input) {
      return {
        ok: true,
        repoPath: input && input.repoPath,
        gitListOk: true,
        gitListError: null,
        persistedCount: (input && input.persistedRecords && input.persistedRecords.length) || 0,
        discoveredCount: 2,
        mergedRecords: [
          ...(input && input.persistedRecords ? input.persistedRecords : []),
          {
            worktreeId: 'wt-codex-1',
            path: '/Users/me/.codex/worktrees/436c/instruction-engine',
            mode: 'discovered',
            source: 'codex',
            status: 'discovered',
            branch: 'main',
            git: { head: 'abc', ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, changed: 0, detached: true },
            validation: { pathExists: true, gitWorktree: true, checkedAt: '2026-06-01T00:00:00.000Z' },
            _discovered: true,
            _discoveredOnly: true,
          },
          {
            worktreeId: 'wt-opencode-1',
            path: '/Users/me/.local/share/opencode/worktree/proj/branch',
            mode: 'discovered',
            source: 'opencode',
            status: 'discovered',
            branch: 'feature/x',
            git: { head: 'def', ahead: 0, behind: 0, staged: 0, unstaged: 1, untracked: 0, changed: 1, detached: false },
            validation: { pathExists: true, gitWorktree: true, checkedAt: '2026-06-01T00:00:00.000Z' },
            _discovered: true,
            _discoveredOnly: true,
          },
        ],
      };
    },
  };

  const routes = register({
    executorService,
    worktreeDiscovery: fakeDiscovery,
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    readJsonBody: async (req) => req.__body || {},
  });

  await test('GET executor routes return health, jobs, worktrees, runs, and run detail', async () => {
    const health = await invoke(routes, 'GET', '/api/executor/health');
    const jobs = await invoke(routes, 'GET', '/api/executor/jobs');
    const worktrees = await invokeWithQuery(
      routes,
      'GET',
      '/api/executor/worktrees?repoId=repo-1',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    const runs = await invoke(routes, 'GET', '/api/executor/runs');
    const run = await invoke(routes, 'GET', '/api/executor/runs/run-1');

    assert.equal(health.res.statusCode, 200);
    assert.equal(health.res.body.orchestrationContractVersion, '1');
    assert.equal(jobs.res.statusCode, 200);
    assert.equal(worktrees.res.statusCode, 200);
    assert.equal(worktrees.res.body.worktrees[0].worktreeId, 'wt-1');
    assert.equal(runs.res.statusCode, 200);
    assert.equal(run.res.statusCode, 200);
    assert.equal(run.res.body.id, 'run-1');
  });

  await test('GET /api/executor/worktrees filters persisted registry by repoId query', async () => {
    listWorktreesCalls.length = 0;
    const response = await invokeWithQuery(
      routes,
      'GET',
      '/api/executor/worktrees?repoId=repo-1',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    assert.equal(response.res.statusCode, 200);
    assert.equal(listWorktreesCalls.length, 1);
    assert.equal(listWorktreesCalls[0].repoId, 'repo-1');
    assert.equal(response.res.body.worktrees[0].worktreeId, 'wt-1');
  });

  await test('GET /api/executor/worktrees returns empty list when registry has no entries for repo', async () => {
    listWorktreesCalls.length = 0;
    const response = await invokeWithQuery(
      routes,
      'GET',
      '/api/executor/worktrees?repoId=repo-empty',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.body.worktrees.length, 0);
    assert.equal(response.res.body.worktreeDiscovery.discoveredCount, 0);
  });

  await test('GET /api/executor/worktrees merges persisted registry records with git discovery when repoPath is provided', async () => {
    listWorktreesCalls.length = 0;
    const response = await invokeWithQuery(
      routes,
      'GET',
      '/api/executor/worktrees?repoId=repo-1&repoPath=/repos/instruction-engine',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    assert.equal(response.res.statusCode, 200);
    assert.equal(listWorktreesCalls.length, 1);
    assert.equal(listWorktreesCalls[0].repoId, 'repo-1');
    const worktrees = response.res.body.worktrees;
    assert.equal(worktrees.length, 3);
    const persistedRecord = worktrees.find((w) => w.worktreeId === 'wt-1');
    const codexOnly = worktrees.find((w) => w.worktreeId === 'wt-codex-1');
    const opencodeOnly = worktrees.find((w) => w.worktreeId === 'wt-opencode-1');
    assert.ok(persistedRecord);
    assert.equal(persistedRecord.repoId, 'repo-1');
    assert.equal(persistedRecord.path, '/repo-1-worktrees/wt-1');
    assert.ok(codexOnly);
    assert.equal(codexOnly._discoveredOnly, true);
    assert.equal(codexOnly.source, 'codex');
    assert.equal(codexOnly.git.detached, true);
    assert.ok(opencodeOnly);
    assert.equal(opencodeOnly.source, 'opencode');
    assert.equal(opencodeOnly.git.changed, 1);
    const discovery = response.res.body.worktreeDiscovery;
    assert.equal(discovery.contractVersion, '1');
    assert.equal(discovery.repoId, 'repo-1');
    assert.equal(discovery.gitListOk, true);
    assert.equal(discovery.discoveredCount, 2);
    assert.equal(discovery.persistedCount, 1);
  });

  await test('GET /api/executor/worktrees does not call git discovery when includeGit=false', async () => {
    listWorktreesCalls.length = 0;
    let discoveryCalls = 0;
    const guardedDiscovery = {
      async discoverAndMergeWorktrees() {
        discoveryCalls += 1;
        return { mergedRecords: [], persistedCount: 0, discoveredCount: 0, gitListOk: null };
      },
    };
    const guardedRoutes = register({
      executorService,
      worktreeDiscovery: guardedDiscovery,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
    });
    const response = await invokeWithQuery(
      guardedRoutes,
      'GET',
      '/api/executor/worktrees?repoId=repo-1&repoPath=/repos/instruction-engine&includeGit=false',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    assert.equal(response.res.statusCode, 200);
    assert.equal(discoveryCalls, 0);
    assert.equal(response.res.body.worktreeDiscovery.discoveredCount, 0);
    assert.equal(response.res.body.worktreeDiscovery.gitListOk, null);
  });

  await test('GET /api/executor/worktrees returns persisted records with gitListError when discovery throws', async () => {
    listWorktreesCalls.length = 0;
    const explodingDiscovery = {
      async discoverAndMergeWorktrees() {
        throw new Error('git exploded');
      },
    };
    const explodingRoutes = register({
      executorService,
      worktreeDiscovery: explodingDiscovery,
      sendJson(res, code, payload) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(payload));
      },
    });
    const response = await invokeWithQuery(
      explodingRoutes,
      'GET',
      '/api/executor/worktrees?repoId=repo-1&repoPath=/repos/instruction-engine',
      { sendJson(res, code, payload) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); } },
    );
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.body.worktrees[0].worktreeId, 'wt-1');
    assert.equal(response.res.body.worktreeDiscovery.gitListOk, false);
    assert.match(response.res.body.worktreeDiscovery.gitListError, /git exploded/);
  });

  // ─── Cleanup route tests ─────────────────────────────────────────────────
  await test('POST /api/executor/worktrees/cleanup/analyze rejects empty body', async () => {
    const { res } = await invoke(routes, 'POST', '/api/executor/worktrees/cleanup/analyze', null);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'repoPath and worktreePath are required');
  });

  await test('POST /api/executor/worktrees/cleanup/analyze rejects missing repoPath', async () => {
    const { res } = await invoke(routes, 'POST', '/api/executor/worktrees/cleanup/analyze', { worktreePath: '/test' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'repoPath and worktreePath are required');
  });

  await test('POST /api/executor/worktrees/cleanup/analyze rejects missing worktreePath', async () => {
    const { res } = await invoke(routes, 'POST', '/api/executor/worktrees/cleanup/analyze', { repoPath: '/test' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'repoPath and worktreePath are required');
  });

  await test('POST /api/executor/worktrees/cleanup/remove rejects missing repoPath', async () => {
    const { res } = await invoke(routes, 'POST', '/api/executor/worktrees/cleanup/remove', null);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'repoPath and worktreePath are required');
  });

  await test('POST /api/executor/worktrees/prune rejects missing repoPath', async () => {
    const { res } = await invoke(routes, 'POST', '/api/executor/worktrees/prune', null);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'repoPath is required');
  });

  await test('all cleanup routes are registered with correct methods and paths', async () => {
    const routeEntries = routes.map((r) => `${r.method} ${r.path instanceof RegExp ? r.path.source : r.path}`);
    assert.ok(routeEntries.includes('POST /api/executor/worktrees/cleanup/analyze'), 'analyze route missing');
    assert.ok(routeEntries.includes('POST /api/executor/worktrees/cleanup/remove'), 'remove route missing');
    assert.ok(routeEntries.includes('POST /api/executor/worktrees/prune'), 'prune route missing');
  });

  await test('handleCleanupAnalyze, handleCleanupRemove, handlePrune are exported', async () => {
    const mod = require('./executor');
    assert.equal(typeof mod.handleCleanupAnalyze, 'function');
    assert.equal(typeof mod.handleCleanupRemove, 'function');
    assert.equal(typeof mod.handlePrune, 'function');
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
