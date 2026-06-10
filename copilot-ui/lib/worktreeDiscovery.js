'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WORKTREE_DISCOVERY_CONTRACT_VERSION = '1';
const WORKTREE_DISCOVERY_SOURCES = Object.freeze({
  ELEGY: 'elegy',
  OPENCODE: 'opencode',
  CODEX: 'codex',
  MANUAL: 'manual',
  UNKNOWN: 'unknown',
});
const WORKTREE_DISCOVERY_SORT_STABLE_THRESHOLD_MS = 10;
const MAX_GIT_STATUS_FILES = 2000;
const GIT_PROBE_TIMEOUT_MS = 4000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asOptionalString(value) {
  const normalized = asTrimmedString(value);
  return normalized || null;
}

function asNonNegativeInteger(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function asIsoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nowIso(nowFn) {
  return new Date(typeof nowFn === 'function' ? nowFn() : Date.now()).toISOString();
}

function normalizeAbsolutePath(pathImpl, value) {
  const normalized = asTrimmedString(value);
  if (!normalized) return null;
  return pathImpl.resolve(normalized);
}

function normalizeComparablePath(pathImpl, value) {
  const normalized = normalizeAbsolutePath(pathImpl, value);
  if (!normalized) return '';
  return normalized.replace(/\\/g, '/').toLowerCase();
}

function asTrimmedStringOrNull(value) {
  const normalized = asTrimmedString(value);
  return normalized || null;
}

function runChild(childProcessImpl, command, args, options) {
  return new Promise((resolve) => {
    const child = childProcessImpl.execFile(command, args, {
      ...options,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          code: Number(error && error.code) || 1,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          message: asTrimmedString(error && error.message) || `${command} ${args.join(' ')} failed`,
        });
        return;
      }
      resolve({
        ok: true,
        code: 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        message: '',
      });
    });
    if (options && typeof options.timeout === 'number' && options.timeout > 0) {
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, options.timeout);
      child.once('close', () => clearTimeout(timer));
    }
  });
}

function runGit(childProcessImpl, args, cwd, options = {}) {
  return runChild(childProcessImpl, 'git', args, {
    cwd,
    timeout: options.timeoutMs || GIT_PROBE_TIMEOUT_MS,
  });
}

function parseGitWorktreePorcelain(output) {
  const entries = [];
  const lines = String(output || '').split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (line === '') {
      if (current && current.path) {
        entries.push(current);
      }
      current = null;
      continue;
    }
    if (!current) {
      current = { path: null, head: null, branch: null, detached: false, bare: false, locked: null, prunable: null, reason: null, guid: null };
    }
    if (line.startsWith('worktree ')) {
      current.path = asTrimmedString(line.slice('worktree '.length));
    } else if (line.startsWith('HEAD ')) {
      current.head = asTrimmedString(line.slice('HEAD '.length));
    } else if (line.startsWith('branch ')) {
      const ref = asTrimmedString(line.slice('branch '.length));
      current.branch = ref ? ref.replace(/^refs\/heads\//, '') : null;
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line.startsWith('locked')) {
      const reason = asTrimmedString(line.slice('locked'.length));
      current.locked = reason || '';
    } else if (line.startsWith('prunable')) {
      const reason = asTrimmedString(line.slice('prunable'.length));
      current.prunable = reason || '';
    } else if (line.startsWith('reason ')) {
      current.reason = asTrimmedString(line.slice('reason '.length));
    } else if (line.startsWith('guid ')) {
      current.guid = asTrimmedString(line.slice('guid '.length));
    }
  }
  if (current && current.path) {
    entries.push(current);
  }
  return entries;
}

function inferWorktreeSource(absolutePath, persistedSource) {
  const explicit = asTrimmedStringOrNull(persistedSource);
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower === 'elegy' || lower === 'executor' || lower === 'registry') return WORKTREE_DISCOVERY_SOURCES.ELEGY;
    if (lower === 'opencode') return WORKTREE_DISCOVERY_SOURCES.OPENCODE;
    if (lower === 'codex') return WORKTREE_DISCOVERY_SOURCES.CODEX;
    if (lower === 'manual') return WORKTREE_DISCOVERY_SOURCES.MANUAL;
  }
  if (!absolutePath) return WORKTREE_DISCOVERY_SOURCES.UNKNOWN;
  const normalized = absolutePath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.codex/worktrees/')) {
    return WORKTREE_DISCOVERY_SOURCES.CODEX;
  }
  if (normalized.includes('/.local/share/opencode/worktree/')) {
    return WORKTREE_DISCOVERY_SOURCES.OPENCODE;
  }
  if (normalized.includes('/.elegy/repo-state/')) {
    return WORKTREE_DISCOVERY_SOURCES.ELEGY;
  }
  if (/\/[^/]+-worktrees(\/|$)/.test(normalized)) {
    return WORKTREE_DISCOVERY_SOURCES.ELEGY;
  }
  return WORKTREE_DISCOVERY_SOURCES.MANUAL;
}

function pathExists(fsImpl, absPath) {
  if (!absPath) return false;
  try {
    return fsImpl.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function readMtimeMs(fsImpl, absPath) {
  if (!absPath) return null;
  try {
    return fsImpl.statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
}

function resolveStatusCountsFromFiles(files) {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let changed = 0;
  for (const file of files) {
    const status = asTrimmedString(file && file.status);
    if (!status) continue;
    if (status === '??') {
      untracked += 1;
      changed += 1;
      continue;
    }
    const indexChar = status[0] === '.' ? ' ' : status[0];
    const workTree = status[1] === '.' ? ' ' : status[1];
    if (indexChar !== ' ') staged += 1;
    if (workTree !== ' ') unstaged += 1;
    if (indexChar !== ' ' || workTree !== ' ') {
      changed += 1;
    }
  }
  return { staged, unstaged, untracked, changed };
}

function parseAheadBehindPorcelain(output) {
  const text = String(output || '');
  const aheadMatch = text.match(/^#\s*branch\.ab\s*\+(\d+)\s+-(\d+)/m);
  if (aheadMatch) {
    return {
      ahead: asNonNegativeInteger(aheadMatch[1]),
      behind: asNonNegativeInteger(aheadMatch[2]),
    };
  }
  const ahead = (text.match(/ahead of [^\n]*?by (\d+)/i) || [])[1];
  const behind = (text.match(/behind [^\n]*?by (\d+)/i) || [])[1];
  return {
    ahead: ahead ? asNonNegativeInteger(ahead) : 0,
    behind: behind ? asNonNegativeInteger(behind) : 0,
  };
}

function parseStatusPorcelainV2Lines(output, maxFiles) {
  const files = [];
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#')) {
      // Header lines; skip.
      continue;
    }
    if (maxFiles && files.length >= maxFiles) break;
    if (line[0] === '?') {
      files.push({ status: '??', path: line.slice(2) });
      continue;
    }
    if (line.length < 4) continue;
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = `${line[2] || '.'}${line[3] || '.'}`;
      const rest = line.slice(4);
      const tokens = rest.split(' ');
      const pathValue = tokens.length > 6 ? tokens.slice(6).join(' ') : rest;
      files.push({ status: xy, path: pathValue });
    }
  }
  return files;
}

async function probeWorktreeGitStatus(childProcessImpl, fsImpl, pathImpl, worktreePath) {
  const normalizedPath = normalizeAbsolutePath(pathImpl, worktreePath);
  if (!normalizedPath) {
    return {
      ok: false,
      pathExists: false,
      error: 'worktree path is missing',
      branch: null,
      detached: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      changed: 0,
      files: [],
    };
  }
  const exists = pathExists(fsImpl, normalizedPath);
  if (!exists) {
    return {
      ok: false,
      pathExists: false,
      error: 'worktree path does not exist',
      branch: null,
      detached: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      changed: 0,
      files: [],
    };
  }
  const statusResult = await runGit(childProcessImpl, ['status', '--porcelain=v2', '--branch'], normalizedPath);
  if (!statusResult.ok) {
    return {
      ok: false,
      pathExists: true,
      error: statusResult.stderr || statusResult.message || 'git status failed',
      branch: null,
      detached: null,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      changed: 0,
      files: [],
    };
  }
  const stdout = statusResult.stdout;
  const lines = stdout.split(/\r?\n/);
  const branchLine = lines.find((line) => line.startsWith('# branch.'));
  let branch = null;
  let detached = null;
  const branchHeader = lines.find((line) => line.startsWith('# branch.head '));
  if (branchHeader) {
    const value = asTrimmedString(branchHeader.slice('# branch.head '.length));
    if (value === '(detached)') {
      detached = true;
    } else if (value) {
      branch = value;
      detached = false;
    }
  }
  const abLine = lines.find((line) => line.startsWith('# branch.ab '));
  const ab = abLine ? parseAheadBehindPorcelain(abLine) : { ahead: 0, behind: 0 };
  const files = parseStatusPorcelainV2Lines(stdout, MAX_GIT_STATUS_FILES)
    .map((entry) => ({ status: entry.status, path: entry.path }))
    .filter((entry) => entry.path);
  const counts = resolveStatusCountsFromFiles(files);
  return {
    ok: true,
    pathExists: true,
    error: null,
    branch,
    detached,
    ahead: ab.ahead,
    behind: ab.behind,
    staged: counts.staged,
    unstaged: counts.unstaged,
    untracked: counts.untracked,
    changed: counts.changed,
    files,
  };
}

async function listGitWorktrees(childProcessImpl, repoPath, options = {}) {
  const normalized = normalizeAbsolutePath(options.path || path, repoPath);
  if (!normalized) {
    return { ok: false, worktrees: [], error: 'repoPath is required for git worktree list', rawOutput: '' };
  }
  const result = await runGit(childProcessImpl, ['worktree', 'list', '--porcelain'], normalized);
  if (!result.ok) {
    return { ok: false, worktrees: [], error: result.stderr || result.message || 'git worktree list failed', rawOutput: result.stdout || '' };
  }
  const parsed = parseGitWorktreePorcelain(result.stdout);
  return { ok: true, worktrees: parsed, error: null, rawOutput: result.stdout || '' };
}

function generateDiscoveredWorktreeId(absolutePath, head) {
  const seed = `${absolutePath || ''}|${head || ''}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash |= 0;
  }
  const safe = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  return `wt-git-${safe}`;
}

function buildGitDiscoveredWorktreeRecord(options) {
  const { gitEntry, probe, path: pathImpl, source, stableOrder } = options;
  const normalizedPath = normalizeAbsolutePath(pathImpl, gitEntry && gitEntry.path);
  const isMainLike = !gitEntry.detached && gitEntry.branch
    ? false
    : null;
  return {
    worktreeId: generateDiscoveredWorktreeId(normalizedPath, gitEntry && gitEntry.head),
    repoId: null,
    repoPath: null,
    repoLabel: null,
    mode: 'discovered',
    path: normalizedPath,
    branch: gitEntry && gitEntry.branch ? gitEntry.branch : null,
    source,
    discovery: 'git-worktree-list',
    status: 'discovered',
    launch: { blocked: false, reason: null },
    assignment: { sessionId: null, runId: null, overlaySessionId: null },
    cleanup: { policy: 'unknown', status: 'unknown', lastAttemptAt: null, lastError: null },
    recovery: { mode: 'unknown', orphaned: false, reason: null },
    validation: {
      pathExists: Boolean(probe && probe.pathExists),
      gitWorktree: true,
      repoMatches: null,
      checkedAt: nowIso(options.now),
      reason: probe && probe.error ? probe.error : null,
    },
    git: {
      head: gitEntry && gitEntry.head ? gitEntry.head : null,
      detached: Boolean(gitEntry && gitEntry.detached),
      bare: Boolean(gitEntry && gitEntry.bare),
      locked: asTrimmedStringOrNull(gitEntry && gitEntry.locked),
      prunable: asTrimmedStringOrNull(gitEntry && gitEntry.prunable),
      guid: asTrimmedStringOrNull(gitEntry && gitEntry.guid),
      branch: gitEntry && gitEntry.branch ? gitEntry.branch : null,
      ahead: probe ? asNonNegativeInteger(probe.ahead) : 0,
      behind: probe ? asNonNegativeInteger(probe.behind) : 0,
      staged: probe ? asNonNegativeInteger(probe.staged) : 0,
      unstaged: probe ? asNonNegativeInteger(probe.unstaged) : 0,
      untracked: probe ? asNonNegativeInteger(probe.untracked) : 0,
      changed: probe ? asNonNegativeInteger(probe.changed) : 0,
      detachedFromBranch: isMainLike,
      probeError: probe && probe.error ? probe.error : null,
      mtimeMs: readMtimeMs(options.fs, normalizedPath),
    },
    lifecycle: {
      requestedAt: null,
      allocatedAt: null,
      activatedAt: null,
      releasedAt: null,
      interruptedAt: null,
      lastSeenAt: readMtimeMs(options.fs, normalizedPath)
        ? new Date(readMtimeMs(options.fs, normalizedPath)).toISOString()
        : null,
    },
    createdAt: null,
    updatedAt: readMtimeMs(options.fs, normalizedPath)
      ? new Date(readMtimeMs(options.fs, normalizedPath)).toISOString()
      : null,
    _discovered: true,
    _discoveredOnly: true,
    _stableOrder: typeof stableOrder === 'number' ? stableOrder : null,
  };
}

function mergePersistedAndDiscoveredWorktrees(persistedRecords, discoveredRecords, options = {}) {
  const pathImpl = options.path || path;
  const map = new Map();
  const persistedPaths = new Set();
  for (const entry of persistedRecords || []) {
    if (!isObject(entry) || !entry.path) continue;
    const key = normalizeComparablePath(pathImpl, entry.path);
    if (!key) continue;
    persistedPaths.add(key);
    map.set(key, {
      ...entry,
      _merged: 'persisted',
      _discovered: false,
      _discoveredOnly: false,
    });
  }
  for (const discovered of discoveredRecords || []) {
    if (!isObject(discovered) || !discovered.path) continue;
    const key = normalizeComparablePath(pathImpl, discovered.path);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        ...discovered,
        _merged: 'discovered',
        _discovered: true,
        _discoveredOnly: true,
      });
      continue;
    }
    const mergedGit = {
      head: discovered.git && discovered.git.head ? discovered.git.head : (existing.head || null),
      detached: discovered.git ? Boolean(discovered.git.detached) : (existing.detached || false),
      bare: discovered.git ? Boolean(discovered.git.bare) : (existing.bare || false),
      locked: discovered.git ? discovered.git.locked : null,
      prunable: discovered.git ? discovered.git.prunable : null,
      guid: discovered.git ? discovered.git.guid : null,
      branch: discovered.git ? discovered.git.branch : (existing.branch || null),
      ahead: discovered.git ? asNonNegativeInteger(discovered.git.ahead) : 0,
      behind: discovered.git ? asNonNegativeInteger(discovered.git.behind) : 0,
      staged: discovered.git ? asNonNegativeInteger(discovered.git.staged) : 0,
      unstaged: discovered.git ? asNonNegativeInteger(discovered.git.unstaged) : 0,
      untracked: discovered.git ? asNonNegativeInteger(discovered.git.untracked) : 0,
      changed: discovered.git ? asNonNegativeInteger(discovered.git.changed) : 0,
      probeError: discovered.git ? discovered.git.probeError : null,
      mtimeMs: discovered.git ? discovered.git.mtimeMs : null,
    };
    map.set(key, {
      ...existing,
      branch: existing.branch || discovered.branch || null,
      head: existing.head || (discovered.git && discovered.git.head) || null,
      detached: discovered.git ? Boolean(discovered.git.detached) : (existing.detached || false),
      source: inferWorktreeSource(discovered.path, existing.source || discovered.source),
      validation: {
        ...(existing.validation || {}),
        pathExists: discovered.validation ? discovered.validation.pathExists : (existing.validation && existing.validation.pathExists),
        gitWorktree: true,
        checkedAt: discovered.validation && discovered.validation.checkedAt ? discovered.validation.checkedAt : nowIso(options.now),
        reason: discovered.validation ? discovered.validation.reason : (existing.validation && existing.validation.reason),
      },
      git: mergedGit,
      _discovered: true,
      _discoveredOnly: false,
      _merged: 'both',
    });
  }
  return Array.from(map.values());
}

function sortWorktreesForDisplay(records, options = {}) {
  const pathImpl = options.path || path;
  const getTimestamp = (entry) => {
    const updatedAt = Date.parse(entry.updatedAt || '') || 0;
    const lastSeen = Date.parse((entry.lifecycle && entry.lifecycle.lastSeenAt) || '') || 0;
    if (updatedAt) return updatedAt;
    if (lastSeen) return lastSeen;
    if (entry.git && typeof entry.git.mtimeMs === 'number' && Number.isFinite(entry.git.mtimeMs)) {
      return entry.git.mtimeMs;
    }
    return 0;
  };
  return records.slice().sort((left, right) => {
    const leftTs = getTimestamp(left);
    const rightTs = getTimestamp(right);
    if (rightTs !== leftTs) return rightTs - leftTs;
    const leftStable = typeof left._stableOrder === 'number' ? left._stableOrder : Number.POSITIVE_INFINITY;
    const rightStable = typeof right._stableOrder === 'number' ? right._stableOrder : Number.POSITIVE_INFINITY;
    if (leftStable !== rightStable) return leftStable - rightStable;
    return normalizeComparablePath(pathImpl, left.path).localeCompare(normalizeComparablePath(pathImpl, right.path));
  });
}

async function discoverAndMergeWorktrees(input = {}, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const childProcessImpl = deps.childProcess || { execFile };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  const repoPath = normalizeAbsolutePath(pathImpl, input.repoPath);
  const persistedRecords = Array.isArray(input.persistedRecords) ? input.persistedRecords : [];

  if (!repoPath) {
    return {
      ok: true,
      repoPath: null,
      gitListOk: false,
      gitListError: 'repoPath is required for git worktree list',
      mergedRecords: sortWorktreesForDisplay(persistedRecords, { path: pathImpl }),
      persistedCount: persistedRecords.length,
      discoveredCount: 0,
      gitRecords: [],
    };
  }

  const listing = await listGitWorktrees(childProcessImpl, repoPath, { path: pathImpl });
  const probes = listing.ok
    ? await Promise.all(listing.worktrees.map((entry) => probeWorktreeGitStatus(childProcessImpl, fsImpl, pathImpl, entry && entry.path)))
    : [];

  const discoveredRecords = (listing.ok ? listing.worktrees : []).map((entry, index) => {
    const probe = probes[index] || { ok: false, error: 'probe missing', pathExists: false, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, changed: 0, files: [] };
    const source = inferWorktreeSource(normalizeAbsolutePath(pathImpl, entry.path), entry && entry.source);
    return buildGitDiscoveredWorktreeRecord({
      gitEntry: entry,
      probe,
      fs: fsImpl,
      path: pathImpl,
      source,
      stableOrder: index,
      now,
    });
  });

  const merged = mergePersistedAndDiscoveredWorktrees(persistedRecords, discoveredRecords, { path: pathImpl, now });
  const sorted = sortWorktreesForDisplay(merged, { path: pathImpl });
  return {
    ok: listing.ok,
    repoPath,
    gitListOk: listing.ok,
    gitListError: listing.error || null,
    mergedRecords: sorted,
    persistedCount: persistedRecords.length,
    discoveredCount: discoveredRecords.length,
    gitRecords: discoveredRecords,
  };
}

module.exports = {
  WORKTREE_DISCOVERY_CONTRACT_VERSION,
  WORKTREE_DISCOVERY_SOURCES,
  parseGitWorktreePorcelain,
  inferWorktreeSource,
  listGitWorktrees,
  probeWorktreeGitStatus,
  parseAheadBehindPorcelain,
  parseStatusPorcelainV2Lines,
  resolveStatusCountsFromFiles,
  mergePersistedAndDiscoveredWorktrees,
  sortWorktreesForDisplay,
  buildGitDiscoveredWorktreeRecord,
  discoverAndMergeWorktrees,
  normalizeComparablePath,
};
