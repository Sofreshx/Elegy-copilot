'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { SESSION_ORCHESTRATION_CONTRACT_VERSION } = require('../lib/runtimeContracts');
const {
  WORKTREE_DISCOVERY_CONTRACT_VERSION,
  discoverAndMergeWorktrees,
} = require('../lib/worktreeDiscovery');

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

async function handleListWorktrees(ctx, deps) {
  const executor = requireExecutor(ctx.res, deps);
  if (!executor) return;

  let searchParams;
  if (ctx.u && typeof ctx.u.searchParams?.get === 'function') {
    searchParams = ctx.u.searchParams;
  } else {
    const url = new URL(ctx.pathname || 'http://localhost/api/executor/worktrees', 'http://localhost');
    searchParams = url.searchParams;
  }
  const repoId = (searchParams.get('repoId') || '').trim() || null;
  const repoPath = (searchParams.get('repoPath') || '').trim() || null;
  const includeGit = searchParams.get('includeGit') !== 'false';

  const persisted = executor.listWorktrees({ repoId });
  if (!includeGit || !repoPath) {
    deps.sendJson(ctx.res, 200, {
      worktrees: persisted,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath: repoPath || null,
        gitListOk: null,
        gitListError: null,
        persistedCount: persisted.length,
        discoveredCount: 0,
      },
    });
    return;
  }

  try {
    const result = await deps.worktreeDiscovery.discoverAndMergeWorktrees({
      repoPath,
      persistedRecords: persisted,
    });
    deps.sendJson(ctx.res, 200, {
      worktrees: result.mergedRecords,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath: result.repoPath || repoPath,
        gitListOk: result.gitListOk,
        gitListError: result.gitListError,
        persistedCount: result.persistedCount,
        discoveredCount: result.discoveredCount,
      },
    });
  } catch (error) {
    deps.sendJson(ctx.res, 200, {
      worktrees: persisted,
      orchestrationContractVersion: SESSION_ORCHESTRATION_CONTRACT_VERSION,
      worktreeDiscovery: {
        contractVersion: WORKTREE_DISCOVERY_CONTRACT_VERSION,
        repoId,
        repoPath,
        gitListOk: false,
        gitListError: error && error.message ? error.message : String(error),
        persistedCount: persisted.length,
        discoveredCount: 0,
      },
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    executorService: deps.executorService || null,
    workflowLayerService: deps.workflowLayerService || null,
    worktreeDiscovery: deps.worktreeDiscovery || { discoverAndMergeWorktrees },
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

module.exports = { register, handleListWorktrees };
