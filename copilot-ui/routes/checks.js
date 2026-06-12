'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { discoverChecks, runAllChecks, resolveCommitCheckConfig } = require('../lib/gitCheckRunner');
const { syncCiState } = require('../lib/ciSync');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveRepoPath(ctx) {
  const { u } = ctx;
  const repoPath = u.searchParams.get('repoPath');
  if (!isNonEmptyString(repoPath)) {
    return null;
  }
  return repoPath.trim();
}

function handleChecksDiscover(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const checks = discoverChecks(repoPath);
    const source = checks.length > 0 && checks[0].source ? checks[0].source : 'none';
    sendJson(res, 200, {
      repoPath,
      checksAvailable: checks.length,
      source,
      checks: checks.map((c) => ({
        name: c.name,
        path: c.path,
        description: c.description,
        source: c.source || 'none',
      })),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleChecksRun(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;

  return Promise.resolve()
    .then(() => readJsonBody(req))
    .then(async (body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';

      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }

      const results = await runAllChecks(repoPath);

      // Persist check results to disk (non-blocking)
      try {
        const { deriveRepoId, writeCheckState } = require('../lib/checkState');
        const repoId = deriveRepoId(repoPath);
        const config = resolveCommitCheckConfig(repoPath);
        let ciSyncResult = null;
        try { ciSyncResult = syncCiState(repoPath); } catch {}
        writeCheckState(repoId, repoPath, results, config, ciSyncResult);
      } catch (err) {
        // Persistence failure is non-blocking — log but don't fail the request
        console.error('Failed to persist check state:', err.message);
      }

      sendJson(res, 200, results);
    })
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleCiSync(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const result = syncCiState(repoPath);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleCheckState(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const { getCheckState, deriveRepoId } = require('../lib/checkState');
    const repoId = deriveRepoId(repoPath);
    const config = resolveCommitCheckConfig(repoPath);
    const state = getCheckState(repoId, repoPath, config);
    sendJson(res, 200, state);
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || require('./_helpers').readJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET', path: '/api/git/checks/discover', handler: (ctx) => handleChecksDiscover(ctx, deps) },
    { method: 'POST', path: '/api/git/checks/run', handler: (ctx) => handleChecksRun(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/state', handler: (ctx) => handleCheckState(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/ci-sync', handler: (ctx) => handleCiSync(ctx, deps) },
  ];
}

module.exports = { register };
