'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { SESSION_ORCHESTRATION_CONTRACT_VERSION } = require('../lib/runtimeContracts');

function toErrorPayload(error, fallbackStatusCode = 500) {
  if (!error || typeof error !== 'object') {
    return {
      statusCode: fallbackStatusCode,
      body: { error: String(error || 'Unknown error') },
    };
  }

  return {
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : fallbackStatusCode,
    body: {
      error: String(error.message || error),
    },
  };
}

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

function handleCreateJob(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  deps.readJsonBody(ctx.req)
    .then((body) => executor.createJob(body && typeof body === 'object' ? body : {}))
    .then((result) => deps.sendJson(ctx.res, 201, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
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

function handleResolveWorktree(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  deps.readJsonBody(ctx.req)
    .then((body) => executor.resolveWorktree(body && typeof body === 'object' ? body : {}))
    .then((result) => deps.sendJson(ctx.res, 200, {
      ...result,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
    }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleTriggerJob(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  const jobId = decodeURIComponent(ctx.match[1] || '').trim();

  Promise.resolve()
    .then(() => executor.triggerJob(jobId, { source: 'manual' }))
    .then((run) => deps.sendJson(ctx.res, 200, { run }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleCancelJob(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;
  const jobId = decodeURIComponent(ctx.match[1] || '').trim();

  Promise.resolve()
    .then(() => executor.cancelJob(jobId))
    .then((result) => deps.sendJson(ctx.res, 200, result))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
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
    {
      method: 'POST',
      path: '/api/executor/jobs',
      handler: (ctx) => handleCreateJob(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/executor/worktrees/resolve',
      handler: (ctx) => handleResolveWorktree(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/executor\/jobs\/([^/]+)\/trigger$/,
      handler: (ctx) => handleTriggerJob(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/executor\/jobs\/([^/]+)\/cancel$/,
      handler: (ctx) => handleCancelJob(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
