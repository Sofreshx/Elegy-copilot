'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const repoInventoryService = require('../lib/repoInventoryService');
const sessionsLib = require('../lib/sessions');

/**
 * Lazy require for sessionAggregation — handles concurrent development
 * where the module may not exist yet (WU-0.2).
 */
function getSessionAggregation() {
  try { return require('../lib/sessionAggregation'); }
  catch { return null; }
}

/**
 * Load sessions using sessionAggregation if available, otherwise fall back
 * to sessionsLib.listSessions.
 */
function loadSessions(copilotHome, deps) {
  const agg = deps._sessionAggregationOverride !== undefined
    ? deps._sessionAggregationOverride
    : getSessionAggregation();
  if (agg && typeof agg.buildUnifiedSessions === 'function') {
    try {
      return agg.buildUnifiedSessions(copilotHome);
    } catch {
      // fall through to fallback
    }
  }
  return deps.sessions.listSessions(copilotHome);
}

/**
 * Derive a health indicator from session statuses.
 *   - 'error' if any session has status 'error'
 *   - 'degraded' if any session has status 'failed' or 'missing'
 *   - 'ok' otherwise
 */
function deriveHealthIndicator(sessions) {
  let health = 'ok';
  for (const s of sessions) {
    const st = (s.status || '').toLowerCase();
    if (st === 'error') return 'error';
    if (st === 'failed' || st === 'missing') {
      health = 'degraded';
    }
  }
  return health;
}

function normalizePath(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const resolved = require('node:path').resolve(trimmed);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function resolveProject(projectId, ctx, deps) {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId) return null;

  try {
    const state = deps.repoInventory.loadRepoInventoryState(ctx.copilotHomeAbs || ctx.copilotHome);
    const entry = (state.manualRepos || []).find((repo) => repo.repoId === normalizedProjectId);
    if (!entry) return null;
    return {
      projectId: entry.repoId,
      repoId: entry.repoId,
      repoPath: entry.repoPath,
      canonicalRemote: entry.canonicalRemote || null,
    };
  } catch {
    return null;
  }
}

function matchesProjectSession(session, project) {
  if (!project) return false;
  if (session.projectId === project.projectId) return true;
  if (session.repoId === project.repoId) return true;
  if (session.repo === project.repoPath) return true;

  const projectPath = normalizePath(project.repoPath);
  const sessionRepo = normalizePath(session.repo);
  const sessionCwd = normalizePath(session.cwd);
  if (projectPath && (sessionRepo === projectPath || sessionCwd === projectPath)) {
    return true;
  }

  const repositoryFullName = session.repository && typeof session.repository === 'object'
    ? String(session.repository.fullName || '').trim().toLowerCase()
    : '';
  const canonicalRemote = String(project.canonicalRemote || '').trim().toLowerCase();
  if (repositoryFullName && canonicalRemote && canonicalRemote === repositoryFullName) {
    return true;
  }

  return false;
}

/**
 * Build recent activity from sessions (last 10 by most-recent timestamp desc).
 */
function buildRecentActivity(sessions, limit) {
  const sorted = sessions.slice().sort((a, b) => {
    const aTime = a.lastEventTime || a.startTime || 0;
    const bTime = b.lastEventTime || b.startTime || 0;
    return bTime - aTime;
  });
  return sorted.slice(0, limit).map((s) => ({
    type: 'session',
    timestamp: s.lastEventTime || s.startTime || null,
    summary: `Session ${s.id || s.storageId || 'unknown'} [${s.status || 'unknown'}]`,
  }));
}

function handleDashboardSummary(ctx, deps) {
  try {
    const sessions = loadSessions(ctx.copilotHome, deps);
    const list = Array.isArray(sessions) ? sessions : [];

    const activeSessionCount = list.filter((s) => s.status === 'active').length;
    const totalSessionCount = list.length;
    const recentActivity = buildRecentActivity(list, 10);
    const healthIndicator = deriveHealthIndicator(list);

    deps.sendJson(ctx.res, 200, {
      activeSessionCount,
      totalSessionCount,
      recentActivity,
      healthIndicator,
    });
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'dashboard_summary_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function handleProjectSessions(ctx, deps) {
  try {
    const projectId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
    if (!projectId) {
      deps.sendJson(ctx.res, 400, { error: 'missing_project_id', message: 'Project ID is required' });
      return;
    }

    const project = resolveProject(projectId, ctx, deps);
    const sessions = loadSessions(ctx.copilotHome, deps);
    const list = Array.isArray(sessions) ? sessions : [];

    const filtered = list.filter((s) => {
      if (matchesProjectSession(s, project)) return true;
      if (s.projectId === projectId) return true;
      if (s.repo === projectId) return true;
      if (s.repoId === projectId) return true;
      return false;
    });

    deps.sendJson(ctx.res, 200, filtered);
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'project_sessions_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function handleProjectActivity(ctx, deps) {
  try {
    const projectId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
    if (!projectId) {
      deps.sendJson(ctx.res, 400, { error: 'missing_project_id', message: 'Project ID is required' });
      return;
    }

    const project = resolveProject(projectId, ctx, deps);
    const sessions = loadSessions(ctx.copilotHome, deps);
    const list = Array.isArray(sessions) ? sessions : [];

    const filtered = list.filter((s) => {
      if (matchesProjectSession(s, project)) return true;
      if (s.projectId === projectId) return true;
      if (s.repo === projectId) return true;
      if (s.repoId === projectId) return true;
      return false;
    });

    const activity = filtered.map((s) => ({
      type: 'session',
      timestamp: s.lastEventTime || s.startTime || null,
      summary: `Session ${s.id || s.storageId || 'unknown'} [${s.status || 'unknown'}]`,
    }));

    activity.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    deps.sendJson(ctx.res, 200, activity.slice(0, 20));
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'project_activity_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    repoInventory: deps.repoInventory || repoInventoryService,
    sessions: deps.sessions || sessionsLib,
  };

  // Allow tests to override or disable sessionAggregation.
  // When 'sessionAggregation' key is present in deps (even if null), use that value.
  // When absent, leave undefined so loadSessions falls back to lazy require.
  if ('sessionAggregation' in deps) {
    resolvedDeps._sessionAggregationOverride = deps.sessionAggregation;
  }

  return [
    {
      method: 'GET',
      path: '/api/dashboard/summary',
      handler: (ctx) => handleDashboardSummary(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/projects\/([^/]+)\/sessions$/,
      handler: (ctx) => handleProjectSessions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/projects\/([^/]+)\/activity$/,
      handler: (ctx) => handleProjectActivity(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
