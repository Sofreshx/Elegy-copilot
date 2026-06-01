'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { SESSION_ORCHESTRATION_CONTRACT_VERSION } = require('../lib/runtimeContracts');

function requireExecutor(res, deps) {
  if (deps.executorService) {
    return deps.executorService;
  }

  deps.sendJson(res, 503, {
    error: 'Executor service is unavailable.',
  });
  return null;
}

function handleHealth(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, {
    ...executor.getHealth(),
    workflowLayer: deps.workflowLayerService && typeof deps.workflowLayerService.getHealth === 'function'
      ? deps.workflowLayerService.getHealth()
      : null,
    orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
  });
}

function handleListJobs(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, { jobs: executor.listJobs() });
}

function handleListRuns(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  deps.sendJson(ctx.res, 200, { runs: executor.listRuns() });
}

function handleGetRun(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  const runId = decodeURIComponent(ctx.match[1] || '').trim();
  const run = executor.getRun(runId);
  if (!run) {
    deps.sendJson(ctx.res, 404, { error: 'Executor run not found' });
    return;
  }

  deps.sendJson(ctx.res, 200, run);
}

function handleListWorktrees(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  const url = new URL(ctx.pathname || 'http://localhost/api/executor/worktrees', 'http://localhost');
  const repoId = (url.searchParams.get('repoId') || '').trim();
  deps.sendJson(ctx.res, 200, {
    worktrees: executor.listWorktrees({ repoId: repoId || null }),
    orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
  });
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    executorService: deps.executorService || null,
    workflowLayerService: deps.workflowLayerService || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/executor/health',
      handler: (ctx) => handleHealth(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/jobs',
      handler: (ctx) => handleListJobs(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/worktrees',
      handler: (ctx) => handleListWorktrees(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/executor/runs',
      handler: (ctx) => handleListRuns(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/executor\/runs\/([^/]+)$/,
      handler: (ctx) => handleGetRun(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
