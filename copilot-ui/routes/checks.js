'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const { discoverChecks, runAllChecks, runAllChecksWithProfile, syncCiState: syncCheckCiState } = require('../lib/gitCheckRunner');
const { resolveCommitCheckConfig } = require('../lib/commitCheckConfig');
const elegyChecks = require('../lib/elegyChecksRunner');
const defaultQualityService = require('../lib/repoQualityService');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { discoverCheckPlan } = require('../lib/checkPlanService');

const backgroundCheckRuns = new Map();

function persistCheckResults(repoPath, results) {
  // The SQLite-backed Elegy runner is the canonical local evidence authority.
  // Keep the JSON writer only for legacy/canonical compatibility runners so a
  // completed run cannot produce two divergent freshness records.
  if (!results || results.source === 'elegy-checks') return;
  try {
    const { deriveRepoId, writeCheckState } = require('../lib/checkState');
    const repoId = deriveRepoId(repoPath);
    const config = resolveCommitCheckConfig(repoPath);
    let ciSyncResult = null;
    try { ciSyncResult = syncCheckCiState(repoPath); } catch {}
    writeCheckState(repoId, repoPath, results, config, ciSyncResult);
  } catch (err) {
    // Persistence failure is non-blocking — the completed run remains available to the caller.
    console.error('Failed to persist check state:', err.message);
  }
}

async function executeCheckRun(repoPath, runOptions, hasProfileOptions) {
  const results = hasProfileOptions
    ? await runAllChecksWithProfile(repoPath, runOptions)
    : await runAllChecks(repoPath);
  persistCheckResults(repoPath, results);
  return results;
}

function pruneBackgroundCheckRuns() {
  if (backgroundCheckRuns.size <= 100) return;
  const entries = [...backgroundCheckRuns.entries()]
    .filter(([, job]) => job.status !== 'running')
    .sort(([, left], [, right]) => left.startedAt.localeCompare(right.startedAt));
  while (backgroundCheckRuns.size > 100 && entries.length > 0) {
    const [runId] = entries.shift();
    backgroundCheckRuns.delete(runId);
  }
}

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
    const checks = discoverChecks(repoPath) || [];
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
        gateStrength: c.gateStrength || null,
        determinism: c.determinism || null,
        sourcePack: c.sourcePack || null,
        tags: c.tags || [],
        severity: c.severity || null,
        promotionState: c.promotionState || null,
        owner: c.owner || null,
      })),
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleChecksPlan(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const selected = u.searchParams.getAll('selected')
      .flatMap((value) => value.split(',').map((item) => item.trim()).filter(Boolean));
    sendJson(res, 200, discoverCheckPlan(repoPath, {
      action: u.searchParams.get('action') || 'commit',
      selectionMode: u.searchParams.get('selectionMode') || 'change-aware',
      selectedIds: selected.length > 0 ? selected : undefined,
    }));
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function handleChecksGitHubHistory(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson, qualityService } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  try {
    const reader = qualityService.readGitHubState || defaultQualityService.readGitHubState;
    const requestedBranch = u.searchParams.get('branch');
    const historyOptions = {
      limit: u.searchParams.get('limit') || undefined,
      branch: requestedBranch === 'all' ? null : requestedBranch || undefined,
    };
    const remote = reader(repoPath, {
      ...historyOptions,
    }) || {};
    sendJson(res, 200, {
      source: 'github',
      available: remote.available === true,
      reason: remote.reason || null,
      provider: remote.provider || 'github',
      repository: remote.repository || null,
      branch: remote.branch || (requestedBranch === 'all' ? null : requestedBranch) || null,
      runs: Array.isArray(remote.runs) ? remote.runs : [],
      mergedIntoLocalEvidence: false,
    });
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error), source: 'github', mergedIntoLocalEvidence: false });
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
      const selectedLanes = payload.selectedLanes || payload.selectedLane || undefined;
      const selectedGroup = payload.selectedGroup || undefined;
      const skipLanesRaw = payload.skipLanes || {};
      const skipLanesMap = new Map(Object.entries(skipLanesRaw));
      const runAll = payload.runAll === true;
      const action = isNonEmptyString(payload.action) ? payload.action.trim() : undefined;
      const planHash = isNonEmptyString(payload.planHash) ? payload.planHash.trim() : undefined;
      const planPath = isNonEmptyString(payload.planPath) ? payload.planPath.trim() : undefined;
      const selectionMode = isNonEmptyString(payload.selectionMode) ? payload.selectionMode.trim() : undefined;
      const runOptions = {
        profile,
        selectedLanes,
        selectedGroup,
        skipLanes: skipLanesMap,
        runAll,
        action,
        planHash,
        planPath,
        selectionMode,
      };
      const hasProfileOptions = profile || selectedLanes || selectedGroup || skipLanesMap.size > 0 || runAll || action || planHash || planPath || selectionMode;

      if (planHash || selectedLanes) {
        const planAction = ['commit', 'push', 'ci-local', 'release'].includes(action)
          ? action
          : profile === 'push' ? 'push' : profile === 'release' ? 'release' : 'commit';
        const currentPlan = discoverCheckPlan(repoPath, {
          action: planAction,
          selectionMode: selectionMode || 'change-aware',
          selectedIds: Array.isArray(selectedLanes)
            ? selectedLanes
            : isNonEmptyString(selectedLanes) ? [selectedLanes] : undefined,
        });
        if (planHash && currentPlan.planHash !== planHash) {
          throw Object.assign(new Error('The check plan is stale; rediscover the recommended proof before running.'), { statusCode: 409 });
        }
        const requestedLanes = Array.isArray(selectedLanes)
          ? selectedLanes
          : isNonEmptyString(selectedLanes) ? [selectedLanes] : [];
        if (requestedLanes.length > 0) {
          const requiredProfile = runAll ? null : profile || planAction;
          const required = currentPlan.requiredChecks.filter((candidate) => (
            requiredProfile === null
              || candidate.defaultProfiles?.includes(requiredProfile)
          ));
          const missing = required
            .map((candidate) => candidate.id)
            .filter((id) => !requestedLanes.includes(id));
          if (missing.length > 0) {
            throw Object.assign(new Error(`Required blocking lanes were omitted: ${missing.join(', ')}`), { statusCode: 409 });
          }
        }
      }

      if (payload.background === true) {
        const runId = `check-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const job = {
          runId,
          repoPath,
          profile: profile || null,
          status: 'running',
          startedAt: new Date().toISOString(),
          endedAt: null,
          result: null,
          error: null,
        };
        backgroundCheckRuns.set(runId, job);
        pruneBackgroundCheckRuns();
        void executeCheckRun(repoPath, runOptions, Boolean(hasProfileOptions))
          .then((results) => {
            job.status = 'complete';
            job.endedAt = new Date().toISOString();
            job.result = results;
          })
          .catch((error) => {
            job.status = 'failed';
            job.endedAt = new Date().toISOString();
            job.error = String(error.message || error);
          });
        sendJson(res, 200, {
          runId,
          repoPath,
          profile: profile || null,
          status: 'running',
          startedAt: job.startedAt,
          source: 'local',
        });
        return;
      }

      const results = await executeCheckRun(repoPath, runOptions, Boolean(hasProfileOptions));
      sendJson(res, 200, results);
    })
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleCheckRunStatus(ctx, deps) {
  const { res, match } = ctx;
  const { sendJson } = deps;
  const runId = match && match[1] ? decodeURIComponent(match[1]) : '';
  const job = backgroundCheckRuns.get(runId);
  if (!job) {
    sendJson(res, 404, { error: 'Check run was not found', runId });
    return;
  }
  sendJson(res, 200, { ...job });
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
      // Preserve lane/evidence details for clients that understand the
      // richer state contract; add the legacy checksRun convenience field.
      history: (state.history || []).map((entry) => ({
        ...entry,
        profile: entry.profile || null,
        checksRun: entry.checksRun ?? Object.keys(entry.lanes || {}).length,
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
    branch: u.searchParams.get('branch') || undefined,
    limit: u.searchParams.get('limit'),
    offset: u.searchParams.get('offset'),
  });
  const normalized = result && !result.error && !Object.prototype.hasOwnProperty.call(result, 'branch')
    ? { ...result, branch: u.searchParams.get('branch') === 'all' ? null : u.searchParams.get('branch') || null }
    : result;
  sendElegyResult(res, sendJson, normalized, 'elegy-checks is not available for this repo');
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

function handleQualityStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson, qualityService } = deps;
  const repoPath = resolveRepoPath(ctx);
  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

  return Promise.resolve(qualityService.buildRepoQualityStatus(repoPath))
    .then((status) => sendJson(res, 200, status))
    .catch((error) => sendJson(res, 500, { error: String(error.message || error) }));
}

function handleQualitySetupTask(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody, qualityService, launchRepoQualityTask } = deps;
  return Promise.resolve()
    .then(() => readJsonBody(req))
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const repoPath = isNonEmptyString(payload.repoPath) ? payload.repoPath.trim() : '';
      if (!repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      return qualityService.createRepoQualitySetupTask(repoPath, {
        launchTask: launchRepoQualityTask,
      });
    })
    .then((result) => sendJson(res, 200, result))
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function handleHooksState(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const repoPath = resolveRepoPath(ctx);

  if (!repoPath) {
    sendJson(res, 400, { error: 'repoPath query parameter is required' });
    return;
  }

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

      const hooksScript = path.join(repoPath, 'scripts', 'setup-git-hooks.mjs');
      if (!fs.existsSync(hooksScript)) {
        throw Object.assign(new Error('setup-git-hooks.mjs not found — run repo-quality-setup first'), { statusCode: 404 });
      }

      const result = spawnSync(process.execPath, [hooksScript, '--json', repoPath], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      if (result.status !== 0) {
        throw new Error(result.stderr || 'Failed to set up hooks');
      }
      sendJson(res, 200, JSON.parse(result.stdout));
    })
    .catch((error) => {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
      sendJson(res, statusCode, { error: String(error.message || error) });
    });
}

function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || require('./_helpers').readJsonBody;
  const qualityService = context.qualityService || defaultQualityService;
  const launchRepoQualityTask = context.launchRepoQualityTask;
  const deps = { sendJson, readJsonBody, qualityService, launchRepoQualityTask };

  return [
    { method: 'GET', path: '/api/git/checks/discover', handler: (ctx) => handleChecksDiscover(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/plan', handler: (ctx) => handleChecksPlan(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/github-history', handler: (ctx) => handleChecksGitHubHistory(ctx, deps) },
    { method: 'POST', path: '/api/git/checks/run', handler: (ctx) => handleChecksRun(ctx, deps) },
    { method: 'GET', path: /^\/api\/git\/checks\/runs\/([^/]+)$/, handler: (ctx) => handleCheckRunStatus(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/state', handler: (ctx) => handleCheckState(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/ci-sync', handler: (ctx) => handleCiSync(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/audit', handler: (ctx) => handleChecksAudit(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/doctor', handler: (ctx) => handleChecksDoctor(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/history', handler: (ctx) => handleChecksHistory(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/logs', handler: (ctx) => handleChecksLogs(ctx, deps) },
    { method: 'POST', path: '/api/git/checks/apply', handler: (ctx) => handleChecksApply(ctx, deps) },
    { method: 'GET', path: '/api/git/checks/packs', handler: (ctx) => handlePacksList(ctx, deps) },
    { method: 'GET', path: /^\/api\/git\/checks\/packs\/([^/]+)$/, handler: (ctx) => handlePackShow(ctx, deps) },
    { method: 'GET', path: '/api/git/quality/status', handler: (ctx) => handleQualityStatus(ctx, deps) },
    { method: 'POST', path: '/api/git/quality/setup-task', handler: (ctx) => handleQualitySetupTask(ctx, deps) },
    { method: 'GET', path: '/api/git/hooks/state', handler: (ctx) => handleHooksState(ctx, deps) },
    { method: 'POST', path: '/api/git/hooks/setup', handler: (ctx) => handleHooksSetup(ctx, deps) },
  ];
}

module.exports = { register };
