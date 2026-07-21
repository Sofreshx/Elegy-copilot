'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { discoverChecks, runAllChecks, runAllChecksWithProfile, syncCiState: syncCheckCiState } = require('../lib/gitCheckRunner');
const { resolveCommitCheckConfig } = require('../lib/commitCheckConfig');
const elegyChecks = require('../lib/elegyChecksRunner');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

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
    const profiles = checks.profiles || {};
    sendJson(res, 200, {
      repoPath,
      checksAvailable: checks.length,
      source,
      groups: checks.groups || {},
      profiles,
      checks: checks.map((c) => ({
        name: c.name,
        path: c.path,
        description: c.description,
        group: c.group || null,
        blocking: c.blocking !== false,
        ciWorkflow: c.ciWorkflow || null,
        ciJob: c.ciJob || null,
        ciRequired: c.ciRequired === true,
        source: c.source || 'none',
        required: c.required !== false,
        skippable: c.skippable || false,
        requiresReasonOnSkip: c.requiresReasonOnSkip !== false,
        defaultProfiles: c.defaultProfiles || [],
        cost: c.cost || 'fast',
        opensWindow: c.opensWindow || false,
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

      const profile = payload.profile || undefined;
      const selectedLanes = payload.selectedLane || undefined;
      const selectedGroup = payload.selectedGroup || undefined;
      const skipLanesRaw = payload.skipLanes || {};
      const skipLanesMap = new Map(Object.entries(skipLanesRaw));
      const hasProfileOptions = profile || selectedLanes || selectedGroup || skipLanesMap.size > 0;

      const results = hasProfileOptions
        ? await runAllChecksWithProfile(repoPath, { profile, selectedLanes, selectedGroup, skipLanes: skipLanesMap })
        : await runAllChecks(repoPath);

      // Persist check results to disk (non-blocking)
      try {
        const { deriveRepoId, writeCheckState } = require('../lib/checkState');
        const repoId = deriveRepoId(repoPath);
        const config = resolveCommitCheckConfig(repoPath);
        let ciSyncResult = null;
        try { ciSyncResult = syncCheckCiState(repoPath); } catch {}
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
  const { res, u } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const scope = u.searchParams.get('scope') || undefined;
    const result = syncCheckCiState(repoPath, { scope });
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
    const elegyState = elegyChecks.getState(repoPath);
    if (elegyState) {
      sendJson(res, 200, {
        ...elegyState,
        profile: (elegyState.lastRun && elegyState.lastRun.profile) || null,
      });
      return;
    }

    const { getCheckState, deriveRepoId } = require('../lib/checkState');
    const repoId = deriveRepoId(repoPath);
    const config = resolveCommitCheckConfig(repoPath);
    const state = getCheckState(repoId, repoPath, config);
    const profile = (state.lastRun && state.lastRun.profile) || null;
    sendJson(res, 200, {
      ...state,
      profile,
      history: (state.history || []).map((entry) => ({
        timestamp: entry.timestamp,
        overallPass: entry.overallPass,
        profile: entry.profile || null,
        checksRun: Object.keys(entry.lanes || {}).length,
      })),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function sendElegyResult(res, sendJson, result, unavailableMessage) {
  if (!result) {
    sendJson(res, 404, { error: unavailableMessage });
    return;
  }
  if (result.error) {
    sendJson(res, 500, result);
    return;
  }
  sendJson(res, 200, result);
}

function handleChecksAudit(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);
  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }
  const result = elegyChecks.audit(repoPath);
  sendElegyResult(res, sendJson, result, 'elegy-checks is not available for this repo');
}

function handleChecksDoctor(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);
  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }
  const result = elegyChecks.doctor(repoPath);
  sendElegyResult(res, sendJson, result, 'elegy-checks is not available for this repo');
}

function handleChecksHistory(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);
  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }
  const result = elegyChecks.history(repoPath, {
    limit: u.searchParams.get('limit'),
    offset: u.searchParams.get('offset'),
  });
  sendElegyResult(res, sendJson, result, 'elegy-checks is not available for this repo');
}

function handleChecksLogs(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);
  const runId = u.searchParams.get('runId') || u.searchParams.get('run-id');
  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }
  if (!isNonEmptyString(runId)) {
    sendJson(res, 400, { error: 'runId query parameter is required' });
    return;
  }
  const result = elegyChecks.logs(repoPath, {
    runId,
    check: u.searchParams.get('check') || undefined,
    limit: u.searchParams.get('limit'),
    offset: u.searchParams.get('offset'),
  });
  sendElegyResult(res, sendJson, result, 'elegy-checks is not available for this repo');
}

function handlePacksList(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx) || process.cwd();
  const result = elegyChecks.packsList(repoPath);
  sendElegyResult(res, sendJson, result, 'elegy-checks binary is not available');
}

function handleChecksApply(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;
  return Promise.resolve()
    .then(() => readJsonBody(req))
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      const result = elegyChecks.applyRecommendations(repoPath, {
        proposal: payload.proposal || undefined,
        all: payload.all === true,
      });
      sendElegyResult(res, sendJson, result, 'elegy-checks is not available for this repo');
    })
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handlePackShow(ctx, deps) {
  const { res, match } = ctx;
  const { sendJson } = deps;
  const packId = match && match[1] ? decodeURIComponent(match[1]) : '';
  const repoPath = resolveRepoPath(ctx) || process.cwd();
  const result = elegyChecks.packShow(repoPath, packId);
  sendElegyResult(res, sendJson, result, 'elegy-checks binary is not available');
}

function handleHooksState(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx) || process.cwd();

  try {
    const hooksScript = path.join(repoPath, 'scripts', 'setup-git-hooks.mjs');
    if (!fs.existsSync(hooksScript)) {
      sendJson(res, 200, {
        available: false,
        reason: 'setup-git-hooks.mjs not found — run commit-check-setup first',
      });
      return;
    }

    const result = spawnSync(process.execPath, [hooksScript, '--status', '--json', repoPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });

    if (result.status !== 0) {
      sendJson(res, 500, { error: 'Failed to read hooks state', stderr: result.stderr });
      return;
    }

    const state = JSON.parse(result.stdout);
    sendJson(res, 200, { available: true, ...state });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleHooksSetup(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx) || process.cwd();

  try {
    const hooksScript = path.join(repoPath, 'scripts', 'setup-git-hooks.mjs');
    if (!fs.existsSync(hooksScript)) {
      sendJson(res, 404, { error: 'setup-git-hooks.mjs not found — run commit-check-setup first' });
      return;
    }

    const result = spawnSync(process.execPath, [hooksScript, '--json', repoPath], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });

    const output = JSON.parse(result.stdout);
    sendJson(res, 200, output);
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
    { method: 'GET', path: '/api/git/checks/audit', handler: (ctx) => handleChecksAudit(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/doctor', handler: (ctx) => handleChecksDoctor(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/history', handler: (ctx) => handleChecksHistory(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/logs', handler: (ctx) => handleChecksLogs(ctx, deps) },
    { method: 'POST', path: '/api/git/checks/apply', handler: (ctx) => handleChecksApply(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/packs', handler: (ctx) => handlePacksList(ctx, deps) },
    { method: 'GET', path: /^\/api\/git\/checks\/packs\/([^/]+)$/, handler: (ctx) => handlePackShow(ctx, deps) },
    { method: 'GET', path: '/api/git/hooks/state', handler: (ctx) => handleHooksState(ctx, deps) },
    { method: 'POST', path: '/api/git/hooks/setup', handler: (ctx) => handleHooksSetup(ctx, deps) },
  ];
}

module.exports = { register };
