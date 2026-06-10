'use strict';

const path = require('path');
const sessions = require('./sessions');
const repoInventoryService = require('./repoInventoryService');

const IS_WIN = process.platform === 'win32';

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  const resolved = path.resolve(p.trim());
  return IS_WIN ? resolved.toLowerCase() : resolved;
}

/**
 * Derive a projectId for a session by matching it against known projects.
 * 5-step fallback chain:
 *   1. Exact match — session repo or cwd matches project repoPath
 *   2. Worktree match — session path is under project .worktrees/ or sibling worktree
 *   3. Sandbox match — session sandboxParentRepo matches project repoPath
 *   4. SDK session match — session repository.fullName matches project canonicalRemote
 *   5. null — no match
 */
function deriveProjectId(session, projects) {
  if (!session || !Array.isArray(projects) || projects.length === 0) return null;

  const sessionRepo = normalizePath(session.repo);
  const sessionCwd = normalizePath(session.cwd);

  // Step 1: Exact match on repo or cwd
  for (const project of projects) {
    const projectPath = normalizePath(project.repoPath);
    if (!projectPath) continue;
    if ((sessionRepo && sessionRepo === projectPath) || (sessionCwd && sessionCwd === projectPath)) {
      return project.repoId || project.projectId || null;
    }
  }

  // Step 2: Worktree match — session path is under {project.repoPath}/.worktrees/
  const pathsToCheck = [sessionRepo, sessionCwd].filter(Boolean);
  for (const sp of pathsToCheck) {
    for (const project of projects) {
      const projectPath = normalizePath(project.repoPath);
      if (!projectPath) continue;
      const worktreePrefix = projectPath + (IS_WIN ? '\\.worktrees\\' : '/.worktrees/');
      if (sp.startsWith(worktreePrefix)) {
        return project.repoId || project.projectId || null;
      }
    }
  }

  // Step 3: Sandbox match — session has sandboxParentRepo
  const sandboxParent = normalizePath(session.sandboxParentRepo);
  if (sandboxParent) {
    for (const project of projects) {
      const projectPath = normalizePath(project.repoPath);
      if (projectPath && sandboxParent === projectPath) {
        return project.repoId || project.projectId || null;
      }
    }
  }

  // Step 4: SDK session match — session.repository.fullName matches project.canonicalRemote
  const repoFullName = session.repository && typeof session.repository === 'object'
    ? (session.repository.fullName || '').trim().toLowerCase()
    : '';
  if (repoFullName) {
    for (const project of projects) {
      const remote = (project.canonicalRemote || '').trim().toLowerCase();
      if (remote && remote === repoFullName) {
        return project.repoId || project.projectId || null;
      }
      // Also check if the remote ends with the fullName (e.g., github.com/org/repo contains org/repo)
      if (remote && remote.endsWith('/' + repoFullName)) {
        return project.repoId || project.projectId || null;
      }
    }
  }

  // Step 5: no match
  return null;
}

const STATUS_ACTIVE = new Set(['active', 'running', 'in_progress']);
const STATUS_IDLE = new Set(['idle', 'waiting', 'paused']);
const STATUS_COMPLETED = new Set(['completed', 'done', 'finished']);
const STATUS_FAILED = new Set(['failed', 'error', 'crashed']);

function normalizeStatus(session) {
  const raw = ((session && (session.resolvedStatus || session.status)) || '').trim().toLowerCase();
  if (STATUS_ACTIVE.has(raw)) return 'active';
  if (STATUS_IDLE.has(raw)) return 'idle';
  if (STATUS_COMPLETED.has(raw)) return 'completed';
  if (STATUS_FAILED.has(raw)) return 'failed';
  return 'unknown';
}

function parseTime(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
    const d = new Date(trimmed);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function computeElapsed(session) {
  const start = parseTime(session.startTime);
  const end = parseTime(session.lastEventTime);
  if (start != null && end != null && end >= start) return end - start;
  return null;
}

function extractRepoLabel(repoPath) {
  if (!repoPath || typeof repoPath !== 'string') return null;
  const trimmed = repoPath.trim();
  if (!trimmed) return null;
  const base = path.basename(trimmed);
  return base || null;
}

function mapToUnifiedSummary(reconciledSession, projects) {
  const session = reconciledSession || {};
  return {
    sessionId: session.id || null,
    projectId: deriveProjectId(session, projects),
    source: session.canonicalSource || session.source || 'local',
    status: normalizeStatus(session),
    objective: session.objective || session.title || null,
    startedAtMs: parseTime(session.startTime),
    updatedAtMs: parseTime(session.lastEventTime),
    elapsedMs: computeElapsed(session),
    repoLabel: session.repoLabel || extractRepoLabel(session.repo) || null,
    isolationMode: session.mode || null,
    actorSummary: session.actorSummary || null,
    taskCount: session.taskCount || 0,
    orchestration: session.orchestration || null,
  };
}

function buildUnifiedSessions(elegyHome, options) {
  const opts = options || {};

  // 1. Load projects from repo inventory
  let projects = [];
  try {
    const state = repoInventoryService.loadRepoInventoryState(elegyHome);
    projects = (state && Array.isArray(state.manualRepos)) ? state.manualRepos : [];
  } catch {
    projects = [];
  }

  // 2. Load CLI sessions
  let cliSessions = [];
  try {
    cliSessions = sessions.listSessions(elegyHome, opts);
  } catch {
    cliSessions = [];
  }

  // 3. Load sandbox sessions (wrap in try/catch, default to empty)
  let sandboxSessions = [];
  try {
    sandboxSessions = sessions.listSandboxSessions(opts.sandboxesHome || elegyHome, opts);
  } catch {
    sandboxSessions = [];
  }

  // 4. Combine all into one array, tag source if not present
  const combined = [];
  for (const s of cliSessions) {
    combined.push(s.source ? s : { ...s, source: 'cli' });
  }
  for (const s of sandboxSessions) {
    combined.push(s.source ? s : { ...s, source: 'sandbox' });
  }

  // 5. Deduplicate
  const deduped = sessions.dedupeAllSources(combined);

  // 6. Map each through mapToUnifiedSummary
  const unified = deduped.map((s) => mapToUnifiedSummary(s, projects));

  // 7. Sort by updatedAtMs desc (most recent first), nulls last
  unified.sort((a, b) => {
    const aTime = a.updatedAtMs;
    const bTime = b.updatedAtMs;
    if (aTime == null && bTime == null) return 0;
    if (aTime == null) return 1;
    if (bTime == null) return -1;
    return bTime - aTime;
  });

  return unified;
}

module.exports = {
  deriveProjectId,
  normalizeStatus,
  parseTime,
  computeElapsed,
  extractRepoLabel,
  mapToUnifiedSummary,
  buildUnifiedSessions,
};
