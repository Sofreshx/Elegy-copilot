'use strict';

const assert = require('assert');
const { register } = require('./repoOperations');

async function main() {
  const payload = {
    schemaVersion: 4,
    generatedAt: '2026-08-03T10:00:00.000Z',
    summary: { trackedRepos: 0, reposNeedingAttention: 0, syncIssues: 0, staleBranches: 0, openPullRequests: 0 },
    warnings: [],
    capabilities: {},
    repositories: [],
  };
  const bodyQueue = [];
  const calls = [];
  const routes = register({
    service: {
      getOverview: async (context, input) => {
        calls.push(['overview', context, input]);
        return payload;
      },
      syncRepositories: async (context, input) => {
        calls.push(['sync', context, input]);
        return { contractVersion: 'repo-operations.action.v4', operation: 'sync' };
      },
      fetchRemotes: async (context, input) => {
        calls.push(['fetch', context, input]);
        return { contractVersion: 'repo-operations.action.v4', operation: 'fetch' };
      },
      analyzeEntities: async (context, input) => {
        calls.push(['analyze', context, input]);
        return { contractVersion: 'repo-operations.action.v4', operation: 'analyze' };
      },
      cleanupWorktrees: async (context, input) => {
        calls.push(['cleanup', context, input]);
        return { contractVersion: 'repo-operations.action.v4', operation: 'cleanup' };
      },
      startAgentRun: async (input) => {
        calls.push(['agent-start', input]);
        return { run: { id: 'run-1', status: 'queued' } };
      },
      getAgentRun: async (input) => {
        calls.push(['agent-get', input]);
        return { id: input.runId, status: 'awaiting-approval' };
      },
      approveAgentRun: async (input) => {
        calls.push(['agent-approve', input]);
        return { id: input.runId, status: 'completed' };
      },
      cancelAgentRun: async (input) => {
        calls.push(['agent-cancel', input]);
        return { id: input.runId, status: 'cancelled' };
      },
    },
    readJsonBody: async () => bodyQueue.shift() || {},
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
  });

  assert.strictEqual(routes.length, 9);
  assert.deepStrictEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/repo-operations/overview',
    'POST /api/repo-operations/sync',
    'POST /api/repo-operations/fetch',
    'POST /api/repo-operations/analyze',
    'POST /api/repo-operations/cleanup',
    'POST /api/repo-operations/agent-runs',
    'GET /^\\/api\\/repo-operations\\/agent-runs\\/([^/]+)$/',
    'POST /^\\/api\\/repo-operations\\/agent-runs\\/([^/]+)\\/approve$/',
    'POST /^\\/api\\/repo-operations\\/agent-runs\\/([^/]+)\\/cancel$/',
  ]);

  const response = {};
  await routes[0].handler({ res: response, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(response.body, payload);
  assert.deepStrictEqual(calls[0], ['overview', { elegyHome: 'C:/home/.elegy', engineRoot: 'C:/work/engine' }, { mode: 'fresh' }]);

  const syncWithoutConfirmation = {};
  bodyQueue.push({});
  await routes[1].handler({ req: {}, res: syncWithoutConfirmation, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(syncWithoutConfirmation.status, 400);
  assert.strictEqual(syncWithoutConfirmation.body.code, 'confirmation-required');

  const syncResponse = {};
  bodyQueue.push({ confirmed: true });
  await routes[1].handler({ req: {}, res: syncResponse, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(syncResponse.status, 200);
  assert.strictEqual(syncResponse.body.operation, 'sync');

  const fetchResponse = {};
  bodyQueue.push({ confirmed: true, repoIds: ['alpha'] });
  await routes[2].handler({ req: {}, res: fetchResponse, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(fetchResponse.status, 200);
  assert.strictEqual(fetchResponse.body.operation, 'fetch');

  const analysisResponse = {};
  bodyQueue.push({ entities: [{ repoId: 'alpha', entityId: 'local:feature/one' }] });
  await routes[3].handler({ req: {}, res: analysisResponse, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(analysisResponse.status, 200);
  assert.strictEqual(analysisResponse.body.operation, 'analyze');

  const cleanupResponse = {};
  bodyQueue.push({ confirmed: true, candidates: [{ repoId: 'alpha', worktreePath: 'C:/work/alpha-feature', branch: 'feature/merged', observedBranchSha: 'feature', observedDefaultSha: 'main' }] });
  await routes[4].handler({ req: {}, res: cleanupResponse, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(cleanupResponse.status, 200);
  assert.strictEqual(cleanupResponse.body.operation, 'cleanup');

  const startResponse = {};
  bodyQueue.push({ repoId: 'alpha', prNumber: 1, targetBranch: 'main', observedHeadSha: 'head', observedBaseSha: 'base' });
  await routes[5].handler({ req: {}, res: startResponse, elegyHomeAbs: 'C:/home/.elegy', engineRoot: 'C:/work/engine' });
  assert.strictEqual(startResponse.status, 201);
  assert.strictEqual(startResponse.body.run.status, 'queued');

  const getResponse = {};
  await routes[6].handler({ req: {}, res: getResponse, match: ['/api/repo-operations/agent-runs/run-1', 'run-1'] });
  assert.strictEqual(getResponse.status, 200);
  assert.strictEqual(getResponse.body.status, 'awaiting-approval');

  const approveResponse = {};
  bodyQueue.push({});
  await routes[7].handler({ req: {}, res: approveResponse, match: ['/api/repo-operations/agent-runs/run-1/approve', 'run-1'] });
  assert.strictEqual(approveResponse.status, 200);
  assert.strictEqual(approveResponse.body.status, 'completed');

  const cancelResponse = {};
  bodyQueue.push({});
  await routes[8].handler({ req: {}, res: cancelResponse, match: ['/api/repo-operations/agent-runs/run-1/cancel', 'run-1'] });
  assert.strictEqual(cancelResponse.status, 200);
  assert.strictEqual(cancelResponse.body.status, 'cancelled');
  assert.deepStrictEqual(calls[1][0], 'sync');
  assert.deepStrictEqual(calls[1][2], { confirmed: true });
  assert.strictEqual(calls[2][0], 'fetch');
  assert.strictEqual(calls[3][0], 'analyze');
  assert.strictEqual(calls[4][0], 'cleanup');
  assert.strictEqual(calls[5][0], 'agent-start');
  assert.strictEqual(calls[6][0], 'agent-get');
  assert.strictEqual(calls[7][0], 'agent-approve');
  assert.strictEqual(calls[8][0], 'agent-cancel');

  const modeCalls = [];
  const modeRoutes = register({
    service: {
      getOverview: async (context, input) => {
        modeCalls.push([context, input]);
        return payload;
      },
    },
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
  });
  const cachedResponse = {};
  await modeRoutes[0].handler({
    res: cachedResponse,
    u: new URL('http://127.0.0.1/api/repo-operations/overview?mode=cached'),
    elegyHomeAbs: 'C:/home/.elegy',
    engineRoot: 'C:/work/engine',
  });
  assert.strictEqual(cachedResponse.status, 200);
  assert.deepStrictEqual(modeCalls[0], [{ elegyHome: 'C:/home/.elegy', engineRoot: 'C:/work/engine' }, { mode: 'cached' }]);

  const invalidModeResponse = {};
  await modeRoutes[0].handler({
    res: invalidModeResponse,
    u: new URL('http://127.0.0.1/api/repo-operations/overview?mode=unsafe'),
  });
  assert.strictEqual(invalidModeResponse.status, 400);
  assert.strictEqual(invalidModeResponse.body.code, 'invalid-overview-mode');
  assert.strictEqual(modeCalls.length, 1, 'invalid modes must stop before the overview service');

  const errorResponse = {};
  const errorRoutes = register({
    service: { getOverview: async () => { throw new Error('inventory unavailable'); } },
    sendJson: (res, status, body) => {
      res.status = status;
      res.body = body;
    },
  });
  await errorRoutes[0].handler({ res: errorResponse });
  assert.strictEqual(errorResponse.status, 500);
  assert.strictEqual(errorResponse.body.code, 'repo_operations_overview_failed');

  console.log('repoOperations.test.js: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
