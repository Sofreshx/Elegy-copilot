'use strict';

const repoInventoryLib = require('../lib/repoInventoryService');
const repoOperationsLib = require('../lib/repoOperationsService');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function createDefaultService(deps = {}) {
  return repoOperationsLib.createRepoOperationsService({
    inventory: async (context) => (deps.repoInventory || repoInventoryLib).listKnownRepos({
      elegyHome: context.elegyHome,
      engineRoot: context.engineRoot,
      includeUnavailable: true,
      readOnly: true,
    }),
    git: deps.git,
    github: deps.github,
    runCommand: deps.runCommand,
    childProcessImpl: deps.childProcess,
    commandTimeoutMs: deps.commandTimeoutMs,
    githubTimeoutMs: deps.githubTimeoutMs,
    actionTimeoutMs: deps.actionTimeoutMs,
    agentTimeoutMs: deps.agentTimeoutMs,
    concurrency: deps.concurrency,
    now: deps.now,
    fsImpl: deps.fs,
    pathImpl: deps.path,
    env: deps.env,
    detectOpenCodeBin: deps.detectOpenCodeBin,
    agentRunner: deps.agentRunner,
    activityReader: deps.activityReader,
    sessions: deps.sessions,
    executorService: deps.executorService,
  });
}

function requestContext(ctx) {
  return {
    elegyHome: ctx.elegyHomeAbs || ctx.elegyHome,
    engineRoot: ctx.engineRoot,
  };
}

async function readBody(ctx, readJsonBody) {
  try {
    const body = await readJsonBody(ctx.req);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch (error) {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: error?.statusCode || 400, code: 'invalid-json-body' });
  }
}

function sendRouteError(res, error, sendJson, fallbackCode) {
  const status = Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
  sendJson(res, status, {
    ok: false,
    error: error?.message || 'Repo Operations request failed.',
    code: error?.code || fallbackCode,
  });
}

async function handleOverview(ctx, service, sendJson) {
  try {
    const overview = await service.getOverview({
      elegyHome: ctx.elegyHomeAbs || ctx.elegyHome || null,
      engineRoot: ctx.engineRoot || null,
    });
    sendJson(ctx.res, 200, overview);
  } catch (error) {
    sendJson(ctx.res, 500, {
      error: String(error?.message || error || 'Repo Operations scan failed'),
      code: 'repo_operations_overview_failed',
    });
  }
}

async function handleSync(ctx, service, sendJson, readJsonBody) {
  try {
    const body = await readBody(ctx, readJsonBody);
    if (body.confirmed !== true) {
      sendJson(ctx.res, 400, {
        ok: false,
        error: 'Explicit confirmation is required to sync eligible repositories.',
        code: 'confirmation-required',
      });
      return;
    }
    const result = await service.syncRepositories(requestContext(ctx), { ...body, confirmed: true });
    sendJson(ctx.res, 200, result);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_sync_failed');
  }
}

async function handleCleanup(ctx, service, sendJson, readJsonBody) {
  try {
    const body = await readBody(ctx, readJsonBody);
    if (body.confirmed !== true) {
      sendJson(ctx.res, 400, {
        ok: false,
        error: 'Explicit confirmation is required to clean merged worktrees.',
        code: 'confirmation-required',
      });
      return;
    }
    if (!Array.isArray(body.candidates)) {
      sendJson(ctx.res, 400, {
        ok: false,
        error: 'A cleanup candidate list is required.',
        code: 'candidate-list-required',
      });
      return;
    }
    const result = await service.cleanupWorktrees(requestContext(ctx), { ...body, confirmed: true });
    sendJson(ctx.res, 200, result);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_cleanup_failed');
  }
}

async function handleStartAgentRun(ctx, service, sendJson, readJsonBody) {
  try {
    const body = await readBody(ctx, readJsonBody);
    const result = await service.startAgentRun({ ...body, context: requestContext(ctx) });
    sendJson(ctx.res, 201, result);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_agent_run_start_failed');
  }
}

async function handleGetAgentRun(ctx, service, sendJson) {
  try {
    const runId = decodeURIComponent(ctx.match?.[1] || '').trim();
    const run = await service.getAgentRun({ runId, context: requestContext(ctx) });
    sendJson(ctx.res, 200, run);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_agent_run_get_failed');
  }
}

async function handleApproveAgentRun(ctx, service, sendJson, readJsonBody) {
  try {
    await readBody(ctx, readJsonBody);
    const runId = decodeURIComponent(ctx.match?.[1] || '').trim();
    const run = await service.approveAgentRun({ runId, context: requestContext(ctx) });
    sendJson(ctx.res, 200, run);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_agent_run_approval_failed');
  }
}

async function handleCancelAgentRun(ctx, service, sendJson, readJsonBody) {
  try {
    await readBody(ctx, readJsonBody);
    const runId = decodeURIComponent(ctx.match?.[1] || '').trim();
    const run = await service.cancelAgentRun({ runId, context: requestContext(ctx) });
    sendJson(ctx.res, 200, run);
  } catch (error) {
    sendRouteError(ctx.res, error, sendJson, 'repo_operations_agent_run_cancel_failed');
  }
}

function register(deps = {}) {
  const service = deps.service || deps.repoOperationsService || createDefaultService(deps);
  const sendJson = deps.sendJson || defaultSendJson;
  const readJsonBody = deps.readJsonBody || defaultReadJsonBody;
  return [
    {
      method: 'GET',
      path: '/api/repo-operations/overview',
      handler: (ctx) => handleOverview(ctx, service, sendJson),
    },
    {
      method: 'POST',
      path: '/api/repo-operations/sync',
      handler: (ctx) => handleSync(ctx, service, sendJson, readJsonBody),
    },
    {
      method: 'POST',
      path: '/api/repo-operations/cleanup',
      handler: (ctx) => handleCleanup(ctx, service, sendJson, readJsonBody),
    },
    {
      method: 'POST',
      path: '/api/repo-operations/agent-runs',
      handler: (ctx) => handleStartAgentRun(ctx, service, sendJson, readJsonBody),
    },
    {
      method: 'GET',
      path: /^\/api\/repo-operations\/agent-runs\/([^/]+)$/,
      handler: (ctx) => handleGetAgentRun(ctx, service, sendJson),
    },
    {
      method: 'POST',
      path: /^\/api\/repo-operations\/agent-runs\/([^/]+)\/approve$/,
      handler: (ctx) => handleApproveAgentRun(ctx, service, sendJson, readJsonBody),
    },
    {
      method: 'POST',
      path: /^\/api\/repo-operations\/agent-runs\/([^/]+)\/cancel$/,
      handler: (ctx) => handleCancelAgentRun(ctx, service, sendJson, readJsonBody),
    },
  ];
}

module.exports = {
  createDefaultService,
  handleOverview,
  handleSync,
  handleCleanup,
  handleStartAgentRun,
  handleGetAgentRun,
  handleApproveAgentRun,
  handleCancelAgentRun,
  register,
};
