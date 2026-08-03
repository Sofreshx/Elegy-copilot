'use strict';

const fs = require('fs');
const path = require('path');

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { discover, isDiscoveryStale, SCHEMA_VERSION } = require('../lib/commandDiscovery');
const {
  startRun,
  stopRun,
  getRun,
  getActiveRun,
  readRunOutcomes,
  getExecutionStateDir,
} = require('../lib/executionRunner');

const DISCOVERY_FILE = 'discovery.json';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getDiscoveryPath(repoPath) {
  return path.join(getExecutionStateDir(repoPath), DISCOVERY_FILE);
}

function readCachedDiscovery(repoPath) {
  const filePath = getDiscoveryPath(repoPath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeDiscovery(repoPath, discovery) {
  const filePath = getDiscoveryPath(repoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(discovery, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function resolveDiscovery(repoPath, force) {
  const cached = readCachedDiscovery(repoPath);
  const schemaMismatch = cached !== null && cached.schemaVersion !== SCHEMA_VERSION;
  if (!force && cached && !schemaMismatch && !isDiscoveryStale(cached)) {
    return { discovery: cached, fromCache: true };
  }
  const discovery = discover(repoPath);
  writeDiscovery(repoPath, discovery);
  return { discovery, fromCache: false };
}

function flattenCommands(discovery) {
  const out = new Map();
  for (const group of discovery.categories || []) {
    for (const cmd of group.commands || []) {
      out.set(cmd.id, cmd);
    }
  }
  return out;
}

function deriveSetupStatus(repoPath, discovery, activeRun, outcomes) {
  if (discovery.setup && activeRun && activeRun.kind === 'setup' && activeRun.status === 'running') {
    return { status: 'running', runId: activeRun.runId };
  }
  if (discovery.setup) {
    const outcome = outcomes.setup || {};
    if (typeof outcome.lastExitCode === 'number') {
      return {
        status: outcome.lastExitCode === 0 ? 'done' : 'failed',
        lastRunAt: outcome.lastRunAt,
        lastExitCode: outcome.lastExitCode,
      };
    }
  }
  return { status: 'not-started' };
}

function requireRepoPath(u, res, sendJson) {
  const repoPath = normalizeString(u.searchParams.get('repoPath'));
  if (!isNonEmptyString(repoPath)) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return null;
  }
  const root = repoPath;
  if (!fs.existsSync(root)) {
    sendJson(res, 404, { error: 'Repository path not found' });
    return null;
  }
  return root;
}

function handleGetOverview(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  try {
    const root = requireRepoPath(u, res, sendJson);
    if (!root) return;

    const { discovery } = resolveDiscovery(root, false);
    const outcomes = readRunOutcomes(root);
    const activeRun = getActiveRun(root);
    const setupStatus = deriveSetupStatus(root, discovery, activeRun, outcomes);

    sendJson(res, 200, {
      repoPath: root,
      discovery,
      setup: setupStatus,
      activeRun,
      lastRuns: outcomes,
    });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

function handleRefresh(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  try {
    const root = requireRepoPath(u, res, sendJson);
    if (!root) return;

    const { discovery } = resolveDiscovery(root, true);
    sendJson(res, 200, { repoPath: root, discovery });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

async function handleRunCommand(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson, readJsonBody } = deps;
  try {
    const root = requireRepoPath(u, res, sendJson);
    if (!root) return;

    let body;
    try {
      body = await readJsonBody(ctx.req);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const repoPath = normalizeString(body?.repoPath);
    const commandId = normalizeString(body?.commandId);
    if (!isNonEmptyString(repoPath)) {
      sendJson(res, 400, { error: 'repoPath is required' });
      return;
    }
    if (!isNonEmptyString(commandId)) {
      sendJson(res, 400, { error: 'commandId is required' });
      return;
    }
    if (repoPath !== root) {
      sendJson(res, 400, { error: 'repoPath mismatch' });
      return;
    }

    const { discovery } = resolveDiscovery(root, false);
    const commands = flattenCommands(discovery);
    const command = commands.get(commandId);
    if (!command) {
      sendJson(res, 404, { error: `Command '${commandId}' not found in discovered commands` });
      return;
    }

    const result = startRun({
      repoPath: root,
      commandId,
      command: command.command,
      args: command.args,
      cwd: root,
      kind: 'command',
    });
    if (!result.ok) {
      sendJson(res, result.code === 'busy' ? 409 : result.code === 'invalid_command' ? 403 : 500, {
        error: result.error,
        code: result.code,
      });
      return;
    }
    sendJson(res, 200, { runId: result.runId, run: result.record });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

async function handleRunSetup(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson, readJsonBody } = deps;
  try {
    const root = requireRepoPath(u, res, sendJson);
    if (!root) return;

    let body;
    try {
      body = await readJsonBody(ctx.req);
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const repoPath = normalizeString(body?.repoPath);
    if (!isNonEmptyString(repoPath)) {
      sendJson(res, 400, { error: 'repoPath is required' });
      return;
    }
    if (repoPath !== root) {
      sendJson(res, 400, { error: 'repoPath mismatch' });
      return;
    }

    const { discovery } = resolveDiscovery(root, false);
    if (!discovery.setup) {
      sendJson(res, 404, { error: 'No setup command discovered for this repository' });
      return;
    }
    const commands = flattenCommands(discovery);
    const setupCommand = commands.get(discovery.setup.id);
    if (!setupCommand) {
      sendJson(res, 404, { error: 'Setup command not found' });
      return;
    }

    const result = startRun({
      repoPath: root,
      commandId: 'setup',
      command: setupCommand.command,
      args: setupCommand.args,
      cwd: root,
      kind: 'setup',
    });
    if (!result.ok) {
      sendJson(res, result.code === 'busy' ? 409 : result.code === 'invalid_command' ? 403 : 500, {
        error: result.error,
        code: result.code,
      });
      return;
    }
    sendJson(res, 200, { runId: result.runId, run: result.record });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

function handleGetRun(ctx, deps) {
  const { res, u, match } = ctx;
  const { sendJson } = deps;
  try {
    const runId = decodeURIComponent(match?.[1] || '');
    if (!runId) {
      sendJson(res, 400, { error: 'runId is required' });
      return;
    }
    const run = getRun(runId);
    if (!run) {
      sendJson(res, 404, { error: `Run '${runId}' not found` });
      return;
    }
    sendJson(res, 200, { run });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

async function handleStopRun(ctx, deps) {
  const { res, u, match } = ctx;
  const { sendJson } = deps;
  try {
    const runId = decodeURIComponent(match?.[1] || '');
    if (!runId) {
      sendJson(res, 400, { error: 'runId is required' });
      return;
    }
    const result = await stopRun(runId);
    if (!result.ok) {
      sendJson(res, 404, { error: result.error, code: result.code });
      return;
    }
    sendJson(res, 200, { run: result.record });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/execution/overview', handler: (ctx) => handleGetOverview(ctx, deps) },
    { method: 'POST', path: '/api/execution/refresh', handler: (ctx) => handleRefresh(ctx, deps) },
    { method: 'POST', path: '/api/execution/run', handler: (ctx) => handleRunCommand(ctx, deps) },
    { method: 'POST', path: '/api/execution/setup', handler: (ctx) => handleRunSetup(ctx, deps) },
    { method: 'GET', path: /^\/api\/execution\/runs\/([^/]+)$/, handler: (ctx) => handleGetRun(ctx, deps) },
    { method: 'POST', path: /^\/api\/execution\/runs\/([^/]+)\/stop$/, handler: (ctx) => handleStopRun(ctx, deps) },
  ];
}

module.exports = {
  register,
  handleGetOverview,
  handleRefresh,
  handleRunCommand,
  handleRunSetup,
  handleGetRun,
  handleStopRun,
  resolveDiscovery,
  deriveSetupStatus,
};
