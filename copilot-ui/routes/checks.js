'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { discoverChecks, runAllChecks, runAllChecksWithProfile } = require('../lib/gitCheckRunner');
const { resolveCommitCheckConfig } = require('../lib/commitCheckConfig');
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
