'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { getRepoStateKey } = require('./catalogProjectionService');
const repoInventoryService = require('./repoInventoryService');

const WORKTREE_CONTRACT_VERSION = '1';
const WORKTREE_MODES = Object.freeze({
  SHARED: 'shared',
  DEDICATED: 'dedicated',
});
const WORKTREE_STATES = Object.freeze({
  SHARED: 'shared',
  PENDING_PREPARATION: 'pending_preparation',
  READY: 'ready',
  ACTIVE: 'active',
  REUSABLE: 'reusable',
  INTERRUPTED: 'interrupted',
});
const WORKTREE_CLEANUP_POLICIES = Object.freeze({
  MANUAL: 'manual',
  REUSE: 'reuse',
});
const WORKTREE_CLEANUP_STATES = Object.freeze({
  NOT_REQUESTED: 'not_requested',
  MANUAL_REQUIRED: 'manual_required',
  REUSE_READY: 'reuse_ready',
});
const WORKTREE_RECOVERY_MODES = Object.freeze({
  MANUAL: 'manual',
  REUSE: 'reuse',
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value) {
  const normalized = asTrimmedString(value);
  return normalized || null;
}

function asNullableIsoString(value) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nowIso(nowFn) {
  return new Date(typeof nowFn === 'function' ? nowFn() : Date.now()).toISOString();
}

function normalizeMode(value, fallback = WORKTREE_MODES.SHARED) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === WORKTREE_MODES.DEDICATED) return WORKTREE_MODES.DEDICATED;
  if (normalized === WORKTREE_MODES.SHARED) return WORKTREE_MODES.SHARED;
  return fallback;
}

function normalizeState(value, mode, fallback = null) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (Object.values(WORKTREE_STATES).includes(normalized)) {
    return normalized;
  }
  if (fallback && Object.values(WORKTREE_STATES).includes(fallback)) {
    return fallback;
  }
  return mode === WORKTREE_MODES.SHARED ? WORKTREE_STATES.SHARED : WORKTREE_STATES.PENDING_PREPARATION;
}

function normalizeCleanupPolicy(value, fallback = WORKTREE_CLEANUP_POLICIES.MANUAL) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === WORKTREE_CLEANUP_POLICIES.REUSE) return WORKTREE_CLEANUP_POLICIES.REUSE;
  if (normalized === WORKTREE_CLEANUP_POLICIES.MANUAL) return WORKTREE_CLEANUP_POLICIES.MANUAL;
  return fallback;
}

function normalizeCleanupState(value, fallback = WORKTREE_CLEANUP_STATES.NOT_REQUESTED) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (Object.values(WORKTREE_CLEANUP_STATES).includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeRecoveryMode(value, fallback = WORKTREE_RECOVERY_MODES.MANUAL) {
  const normalized = asTrimmedString(value).toLowerCase();
  if (normalized === WORKTREE_RECOVERY_MODES.REUSE) return WORKTREE_RECOVERY_MODES.REUSE;
  if (normalized === WORKTREE_RECOVERY_MODES.MANUAL) return WORKTREE_RECOVERY_MODES.MANUAL;
  return fallback;
}

function normalizePathValue(pathImpl, value) {
  const normalized = asTrimmedString(value);
  return normalized ? pathImpl.resolve(normalized) : null;
}

function normalizeComparablePath(pathImpl, value) {
  const normalized = normalizePathValue(pathImpl, value);
  if (!normalized) {
    return '';
  }
  return normalized.replace(/\\/g, '/').toLowerCase();
}

function isDirectory(fsImpl, absPath) {
  if (!absPath) return false;
  try {
    return fsImpl.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(fsImpl, absPath) {
  if (!absPath) return false;
  try {
    return fsImpl.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function readTextFileSafe(fsImpl, absPath) {
  try {
    return fsImpl.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

function parseGitdirReference(value) {
  const match = /^\s*gitdir:\s*(.+?)\s*$/i.exec(String(value || ''));
  return match ? match[1].trim() : '';
}

function resolveGitCheckoutMetadata(fsImpl, pathImpl, checkoutPath) {
  const normalizedCheckoutPath = normalizePathValue(pathImpl, checkoutPath);
  if (!normalizedCheckoutPath || !isDirectory(fsImpl, normalizedCheckoutPath)) {
    return null;
  }

  const gitEntryPath = pathImpl.join(normalizedCheckoutPath, '.git');
  if (isDirectory(fsImpl, gitEntryPath)) {
    return {
      checkoutPath: normalizedCheckoutPath,
      kind: 'git-dir',
      gitEntryPath,
      gitDir: gitEntryPath,
      commonDir: gitEntryPath,
    };
  }

  if (!isFile(fsImpl, gitEntryPath)) {
    return null;
  }

  const gitdirReference = parseGitdirReference(readTextFileSafe(fsImpl, gitEntryPath));
  if (!gitdirReference) {
    return null;
  }

  const gitDir = pathImpl.resolve(normalizedCheckoutPath, gitdirReference);
  if (!isDirectory(fsImpl, gitDir)) {
    return null;
  }

  const commondirReference = asTrimmedString(readTextFileSafe(fsImpl, pathImpl.join(gitDir, 'commondir')));
  const commonDir = commondirReference ? pathImpl.resolve(gitDir, commondirReference) : gitDir;
  return {
    checkoutPath: normalizedCheckoutPath,
    kind: 'git-file',
    gitEntryPath,
    gitDir,
    commonDir,
  };
}

function validateDedicatedWorktreePath(fsImpl, pathImpl, repoPath, worktreePath, repoId) {
  const normalizedWorktreePath = normalizePathValue(pathImpl, worktreePath);
  if (!normalizedWorktreePath || !isDirectory(fsImpl, normalizedWorktreePath)) {
    return {
      pathExists: false,
      isGitWorktree: false,
      repoMatches: false,
      ready: false,
      reason: 'Dedicated worktree metadata is reserved, but the worktree path is not prepared yet. Create or attach the git worktree and retry the launch.',
    };
  }

  const repoMetadata = resolveGitCheckoutMetadata(fsImpl, pathImpl, repoPath);
  if (!repoMetadata) {
    return {
      pathExists: true,
      isGitWorktree: false,
      repoMatches: false,
      ready: false,
      reason: `Primary checkout for repo ${repoId || 'unknown'} is unavailable or not a git working tree.`,
    };
  }

  const worktreeMetadata = resolveGitCheckoutMetadata(fsImpl, pathImpl, normalizedWorktreePath);
  if (!worktreeMetadata || worktreeMetadata.kind !== 'git-file') {
    return {
      pathExists: true,
      isGitWorktree: false,
      repoMatches: false,
      ready: false,
      reason: `Dedicated worktree path exists, but it is not an attached git worktree for repo ${repoId || 'unknown'}.`,
    };
  }

  const repoMatches = normalizeComparablePath(pathImpl, worktreeMetadata.commonDir)
    === normalizeComparablePath(pathImpl, repoMetadata.commonDir);
  return {
    pathExists: true,
    isGitWorktree: true,
    repoMatches,
    ready: repoMatches,
    reason: repoMatches
      ? null
      : `Dedicated worktree path exists, but it is not attached to repo ${repoId || 'unknown'}.`,
  };
}

function normalizeRequestedAssignment(input = {}) {
  return {
    sessionId: asOptionalString((input.assignment && input.assignment.sessionId) || input.sessionId),
    runId: asOptionalString((input.assignment && input.assignment.runId) || input.runId),
    overlaySessionId: asOptionalString((input.assignment && input.assignment.overlaySessionId) || input.overlaySessionId),
  };
}

function hasAssignment(assignment) {
  return Boolean(
    asOptionalString(assignment && assignment.sessionId)
    || asOptionalString(assignment && assignment.runId)
    || asOptionalString(assignment && assignment.overlaySessionId)
  );
}

function assignmentMatches(existing, requested) {
  const existingAssignment = existing || {};
  const requestedAssignment = requested || {};
  let matched = false;

  for (const key of ['sessionId', 'runId', 'overlaySessionId']) {
    const existingValue = asOptionalString(existingAssignment[key]);
    const requestedValue = asOptionalString(requestedAssignment[key]);
    if (!existingValue || !requestedValue) {
      continue;
    }
    if (existingValue !== requestedValue) {
      return false;
    }
    matched = true;
  }

  return matched;
}

function isSafelyReusableState(record) {
  const status = asTrimmedString(record && record.status).toLowerCase();
  const cleanupStatus = asTrimmedString(record && record.cleanup && record.cleanup.status).toLowerCase();
  const recoveryMode = asTrimmedString(record && record.recovery && record.recovery.mode).toLowerCase();
  const assigned = hasAssignment(record && record.assignment);

  if (status === WORKTREE_STATES.REUSABLE || cleanupStatus === WORKTREE_CLEANUP_STATES.REUSE_READY) {
    return true;
  }
  if (status === WORKTREE_STATES.INTERRUPTED && recoveryMode === WORKTREE_RECOVERY_MODES.REUSE && !assigned) {
    return true;
  }
  if ((status === WORKTREE_STATES.READY || status === WORKTREE_STATES.PENDING_PREPARATION) && !assigned) {
    return true;
  }
  return false;
}

function assessWorktreeReuse(record, requestedAssignment) {
  if (!record) {
    return {
      blocked: false,
      canMergeAssignment: true,
    };
  }

  const existingAssignment = record.assignment || {};
  if (assignmentMatches(existingAssignment, requestedAssignment)) {
    return {
      blocked: false,
      canMergeAssignment: true,
    };
  }

  if (isSafelyReusableState(record)) {
    return {
      blocked: false,
      canMergeAssignment: !hasAssignment(existingAssignment),
    };
  }

  if (hasAssignment(existingAssignment) || asTrimmedString(record.status).toLowerCase() === WORKTREE_STATES.ACTIVE) {
    return {
      blocked: true,
      canMergeAssignment: false,
      reason: 'Dedicated worktree is already assigned to another active session or run. Resume the current assignment or allocate a different worktree.',
    };
  }

  return {
    blocked: false,
    canMergeAssignment: false,
  };
}

function ensureDir(fsImpl, absPath) {
  fsImpl.mkdirSync(absPath, { recursive: true });
}

function writeJsonAtomic(fsImpl, pathImpl, absPath, value) {
  const dirPath = pathImpl.dirname(absPath);
  ensureDir(fsImpl, dirPath);
  const tempPath = pathImpl.join(
    dirPath,
    `.${pathImpl.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  fsImpl.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fsImpl.renameSync(tempPath, absPath);
}

function createWorktreeId(cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return `wt-${cryptoImpl.randomUUID()}`;
  }
  return `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRepoContext(input = {}, deps = {}) {
  const repoInventory = deps.repoInventory || repoInventoryService;
  const copilotHome = input.copilotHome || input.copilotHomeAbs || '.';
  const explicitRepoPath = asOptionalString(input.repoPath);
  const explicitRepoId = asOptionalString(input.repoId);
  const explicitRepoLabel = asOptionalString(input.repoLabel);

  if (explicitRepoPath) {
    const repoKey = getRepoStateKey(path.resolve(explicitRepoPath));
    return {
      repoId: explicitRepoId || repoKey.repoId,
      repoPath: path.resolve(explicitRepoPath),
      repoLabel: explicitRepoLabel || repoKey.repoLabel,
    };
  }

  if (!explicitRepoId) {
    return null;
  }

  const inventory = repoInventory.listKnownRepos({
    copilotHome,
  });
  const repo = repoInventory.resolveRepoEntry(inventory, { repoId: explicitRepoId });
  if (!repo || !repo.repoPath) {
    return explicitRepoLabel ? {
      repoId: explicitRepoId,
      repoPath: null,
      repoLabel: explicitRepoLabel,
    } : null;
  }

  return {
    repoId: explicitRepoId,
    repoPath: repo.repoPath,
    repoLabel: explicitRepoLabel || repo.repoLabel || explicitRepoId,
  };
}

function normalizeWorktreeRecord(pathImpl, input = {}, defaults = {}) {
  const mode = normalizeMode(input.mode || defaults.mode);
  const worktreeId = asOptionalString(input.worktreeId || input.id || defaults.worktreeId);
  const resolvedPath = normalizePathValue(pathImpl, input.path || input.worktreePath || defaults.path || defaults.worktreePath);
  const createdAt = asNullableIsoString(input.createdAt || defaults.createdAt);
  const updatedAt = asNullableIsoString(input.updatedAt || defaults.updatedAt);
  const stateFallback = mode === WORKTREE_MODES.SHARED
    ? WORKTREE_STATES.SHARED
    : (resolvedPath ? WORKTREE_STATES.READY : WORKTREE_STATES.PENDING_PREPARATION);

  return {
    contractVersion: WORKTREE_CONTRACT_VERSION,
    worktreeId,
    repoId: asOptionalString(input.repoId || defaults.repoId),
    repoPath: normalizePathValue(pathImpl, input.repoPath || defaults.repoPath),
    repoLabel: asOptionalString(input.repoLabel || defaults.repoLabel),
    mode,
    path: resolvedPath,
    branch: asOptionalString(input.branch || defaults.branch),
    source: asOptionalString(input.source || defaults.source),
    status: normalizeState(input.status || defaults.status, mode, stateFallback),
    launch: {
      blocked: input.launch && input.launch.blocked === true
        || input.launchBlocked === true
        || defaults.launchBlocked === true,
      reason: asOptionalString(
        (input.launch && input.launch.reason)
        || input.launchBlockedReason
        || defaults.launchBlockedReason
      ),
    },
    assignment: {
      sessionId: asOptionalString((input.assignment && input.assignment.sessionId) || input.sessionId || defaults.sessionId),
      runId: asOptionalString((input.assignment && input.assignment.runId) || input.runId || defaults.runId),
      overlaySessionId: asOptionalString(
        (input.assignment && input.assignment.overlaySessionId)
        || input.overlaySessionId
        || defaults.overlaySessionId
      ),
    },
    cleanup: {
      policy: normalizeCleanupPolicy(
        (input.cleanup && input.cleanup.policy) || input.cleanupPolicy || defaults.cleanupPolicy,
        mode === WORKTREE_MODES.DEDICATED ? WORKTREE_CLEANUP_POLICIES.REUSE : WORKTREE_CLEANUP_POLICIES.MANUAL
      ),
      status: normalizeCleanupState(
        (input.cleanup && input.cleanup.status) || input.cleanupStatus || defaults.cleanupStatus,
        mode === WORKTREE_MODES.DEDICATED ? WORKTREE_CLEANUP_STATES.MANUAL_REQUIRED : WORKTREE_CLEANUP_STATES.NOT_REQUESTED
      ),
      lastAttemptAt: asNullableIsoString(
        (input.cleanup && input.cleanup.lastAttemptAt) || defaults.cleanupLastAttemptAt
      ),
      lastError: asOptionalString((input.cleanup && input.cleanup.lastError) || defaults.cleanupLastError),
    },
    recovery: {
      mode: normalizeRecoveryMode(
        (input.recovery && input.recovery.mode) || input.recoveryMode || defaults.recoveryMode,
        mode === WORKTREE_MODES.DEDICATED ? WORKTREE_RECOVERY_MODES.REUSE : WORKTREE_RECOVERY_MODES.MANUAL
      ),
      orphaned: input.recovery && input.recovery.orphaned === true || input.orphaned === true || defaults.orphaned === true,
      reason: asOptionalString((input.recovery && input.recovery.reason) || input.recoveryReason || defaults.recoveryReason),
    },
    validation: {
      pathExists: input.validation && input.validation.pathExists === true
        || defaults.pathExists === true
        || false,
      gitWorktree: input.validation && input.validation.gitWorktree === true
        || defaults.gitWorktree === true
        || false,
      repoMatches: input.validation && input.validation.repoMatches === true
        || defaults.repoMatches === true
        || false,
      checkedAt: asNullableIsoString(
        (input.validation && input.validation.checkedAt)
        || defaults.validationCheckedAt
      ),
      reason: asOptionalString((input.validation && input.validation.reason) || defaults.validationReason),
    },
    lifecycle: {
      requestedAt: asNullableIsoString((input.lifecycle && input.lifecycle.requestedAt) || defaults.requestedAt || createdAt),
      allocatedAt: asNullableIsoString((input.lifecycle && input.lifecycle.allocatedAt) || defaults.allocatedAt),
      activatedAt: asNullableIsoString((input.lifecycle && input.lifecycle.activatedAt) || defaults.activatedAt),
      releasedAt: asNullableIsoString((input.lifecycle && input.lifecycle.releasedAt) || defaults.releasedAt),
      interruptedAt: asNullableIsoString((input.lifecycle && input.lifecycle.interruptedAt) || defaults.interruptedAt),
      lastSeenAt: asNullableIsoString((input.lifecycle && input.lifecycle.lastSeenAt) || defaults.lastSeenAt || updatedAt),
    },
    createdAt: createdAt || updatedAt || null,
    updatedAt: updatedAt || createdAt || null,
  };
}

class WorktreeService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._fs = deps.fs || fs;
    this._path = deps.path || path;
    this._crypto = deps.crypto || crypto;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._repoInventory = deps.repoInventory || repoInventoryService;
  }

  _resolveRepoStateRoot(copilotHome) {
    return this._path.join(this._path.resolve(String(copilotHome || '.')), 'repo-state');
  }

  _resolveWorktreesDir(copilotHome, repoId) {
    return this._path.join(this._resolveRepoStateRoot(copilotHome), String(repoId || ''), 'worktrees');
  }

  _resolveWorktreePath(copilotHome, repoId, worktreeId) {
    return this._path.join(this._resolveWorktreesDir(copilotHome, repoId), `${worktreeId}.json`);
  }

  _readRecord(absPath) {
    try {
      const parsed = JSON.parse(this._fs.readFileSync(absPath, 'utf8'));
      if (!isObject(parsed)) {
        return null;
      }
      const normalized = normalizeWorktreeRecord(this._path, parsed);
      if (!normalized.worktreeId || !normalized.repoId) {
        return null;
      }
      normalized.durablePath = absPath;
      normalized.validation.pathExists = isDirectory(this._fs, normalized.path);
      return normalized;
    } catch {
      return null;
    }
  }

  _writeRecord(copilotHome, record) {
    const normalized = normalizeWorktreeRecord(this._path, record);
    if (!normalized.worktreeId || !normalized.repoId) {
      throw Object.assign(new Error('worktreeId and repoId are required'), { statusCode: 400 });
    }
    const durablePath = this._resolveWorktreePath(copilotHome, normalized.repoId, normalized.worktreeId);
    writeJsonAtomic(this._fs, this._path, durablePath, normalized);
    return {
      ...normalized,
      durablePath,
    };
  }

  _buildDefaultDedicatedPath(repoPath, repoId, worktreeId) {
    const absoluteRepoPath = this._path.resolve(String(repoPath || '.'));
    const repoName = this._path.basename(absoluteRepoPath) || repoId || 'repo';
    const parent = this._path.dirname(absoluteRepoPath);
    return this._path.join(parent, `${repoName}-worktrees`, worktreeId);
  }

  _findPersistedRecordByPath(copilotHome, repoId, candidatePath) {
    const normalizedCandidate = normalizeComparablePath(this._path, candidatePath);
    if (!normalizedCandidate) {
      return null;
    }
    return this.listWorktrees({ copilotHome, repoId }).find((entry) => {
      return normalizeComparablePath(this._path, entry.path) === normalizedCandidate;
    }) || null;
  }

  getWorktree(copilotHome, repoId, worktreeId) {
    const normalizedRepoId = asTrimmedString(repoId);
    const normalizedWorktreeId = asTrimmedString(worktreeId);
    if (!normalizedRepoId || !normalizedWorktreeId) {
      return null;
    }
    return this._readRecord(this._resolveWorktreePath(copilotHome, normalizedRepoId, normalizedWorktreeId));
  }

  listWorktrees(options = {}) {
    const copilotHome = options.copilotHome || options.copilotHomeAbs || this._config.copilotHome || '.';
    const repoId = asOptionalString(options.repoId);
    const worktrees = [];

    if (repoId) {
      const dirPath = this._resolveWorktreesDir(copilotHome, repoId);
      let entries = [];
      try {
        entries = this._fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry || !entry.isFile() || !/\.json$/i.test(entry.name)) {
          continue;
        }
        const record = this._readRecord(this._path.join(dirPath, entry.name));
        if (record) {
          worktrees.push(record);
        }
      }
    } else {
      const repoStateRoot = this._resolveRepoStateRoot(copilotHome);
      let repoEntries = [];
      try {
        repoEntries = this._fs.readdirSync(repoStateRoot, { withFileTypes: true });
      } catch {
        repoEntries = [];
      }
      for (const entry of repoEntries) {
        if (!entry || !entry.isDirectory()) {
          continue;
        }
        worktrees.push(...this.listWorktrees({ copilotHome, repoId: entry.name }));
      }
    }

    return worktrees.sort((left, right) => {
      const rightMs = Date.parse(right.updatedAt || right.lifecycle.lastSeenAt || '') || 0;
      const leftMs = Date.parse(left.updatedAt || left.lifecycle.lastSeenAt || '') || 0;
      return rightMs - leftMs;
    });
  }

  resolveLaunchPlan(input = {}) {
    const copilotHome = input.copilotHome || input.copilotHomeAbs || this._config.copilotHome || '.';
    const repo = resolveRepoContext({
      copilotHome,
      repoId: input.repoId || (input.repo && input.repo.repoId),
      repoPath: input.repoPath || (input.repo && input.repo.repoPath),
      repoLabel: input.repoLabel || (input.repo && input.repo.repoLabel),
    }, {
      repoInventory: this._repoInventory,
    });

    if (!repo || !repo.repoId || !repo.repoPath) {
      throw Object.assign(new Error('repoId/repoPath are required to resolve worktree launch state.'), { statusCode: 400 });
    }

    const requested = isObject(input.worktree) ? input.worktree : {};
    const explicitId = asOptionalString(requested.worktreeId || requested.id);
    const explicitPath = normalizePathValue(this._path, requested.path || requested.worktreePath);
    const activeSessions = Array.isArray(input.activeSessions) ? input.activeSessions : [];
    const hasActiveSameRepoWriter = activeSessions.some((entry) => {
      if (!entry || entry.active === false) return false;
      return asTrimmedString(entry.repoId) === repo.repoId;
    });

    let mode = normalizeMode(
      requested.mode || input.mode || (hasActiveSameRepoWriter ? WORKTREE_MODES.DEDICATED : WORKTREE_MODES.SHARED)
    );

    if (mode === WORKTREE_MODES.SHARED && hasActiveSameRepoWriter) {
      mode = WORKTREE_MODES.DEDICATED;
    }

    if (mode === WORKTREE_MODES.SHARED) {
      return {
        repo,
        cwd: repo.repoPath,
        worktree: normalizeWorktreeRecord(this._path, {
          repoId: repo.repoId,
          repoPath: repo.repoPath,
          repoLabel: repo.repoLabel,
          mode,
          path: repo.repoPath,
          source: 'primary-checkout',
          status: WORKTREE_STATES.SHARED,
          launchBlocked: !isDirectory(this._fs, repo.repoPath),
          launchBlockedReason: isDirectory(this._fs, repo.repoPath)
            ? null
            : `Primary checkout is unavailable for repo ${repo.repoId}.`,
          pathExists: isDirectory(this._fs, repo.repoPath),
          requestedAt: nowIso(this._now),
          allocatedAt: nowIso(this._now),
          lastSeenAt: nowIso(this._now),
          cleanupPolicy: WORKTREE_CLEANUP_POLICIES.MANUAL,
          cleanupStatus: WORKTREE_CLEANUP_STATES.NOT_REQUESTED,
          recoveryMode: WORKTREE_RECOVERY_MODES.MANUAL,
        }),
      };
    }

    const persisted = explicitId
      ? this.getWorktree(copilotHome, repo.repoId, explicitId)
      : (explicitPath ? this._findPersistedRecordByPath(copilotHome, repo.repoId, explicitPath) : null);
    const requestedAssignment = normalizeRequestedAssignment({
      ...input,
      sessionId: input.sessionId || (requested && requested.sessionId),
      runId: input.runId || (requested && requested.runId),
      overlaySessionId: input.overlaySessionId || (requested && requested.overlaySessionId),
      assignment: input.assignment || (requested && requested.assignment),
    });
    const reuseAssessment = assessWorktreeReuse(persisted, requestedAssignment);
    const worktreeId = explicitId || (persisted && persisted.worktreeId) || createWorktreeId(this._crypto);
    const worktreePath = explicitPath
      || (persisted && persisted.path)
      || this._buildDefaultDedicatedPath(repo.repoPath, repo.repoId, worktreeId);
    const validation = validateDedicatedWorktreePath(this._fs, this._path, repo.repoPath, worktreePath, repo.repoId);
    const launchBlockedReason = reuseAssessment.reason || validation.reason;
    const launchBlocked = Boolean(launchBlockedReason);
    const mergedAssignment = reuseAssessment.canMergeAssignment
      ? {
        sessionId: requestedAssignment.sessionId || (persisted && persisted.assignment && persisted.assignment.sessionId) || null,
        runId: requestedAssignment.runId || (persisted && persisted.assignment && persisted.assignment.runId) || null,
        overlaySessionId: requestedAssignment.overlaySessionId || (persisted && persisted.assignment && persisted.assignment.overlaySessionId) || null,
      }
      : {
        sessionId: (persisted && persisted.assignment && persisted.assignment.sessionId) || null,
        runId: (persisted && persisted.assignment && persisted.assignment.runId) || null,
        overlaySessionId: (persisted && persisted.assignment && persisted.assignment.overlaySessionId) || null,
      };
    const nextStatus = validation.ready
      ? (persisted && persisted.status === WORKTREE_STATES.ACTIVE
        ? WORKTREE_STATES.ACTIVE
        : (persisted && persisted.status === WORKTREE_STATES.REUSABLE
          ? WORKTREE_STATES.REUSABLE
          : (persisted && persisted.status === WORKTREE_STATES.INTERRUPTED
            ? WORKTREE_STATES.INTERRUPTED
            : WORKTREE_STATES.READY)))
      : WORKTREE_STATES.PENDING_PREPARATION;
    const nextCleanupStatus = validation.ready
      ? (persisted && persisted.cleanup && persisted.cleanup.status
        ? persisted.cleanup.status
        : WORKTREE_CLEANUP_STATES.MANUAL_REQUIRED)
      : WORKTREE_CLEANUP_STATES.MANUAL_REQUIRED;
    const nextRecoveryMode = validation.ready
      ? ((persisted && persisted.recovery && persisted.recovery.mode) || WORKTREE_RECOVERY_MODES.REUSE)
      : WORKTREE_RECOVERY_MODES.MANUAL;

    const record = this._writeRecord(copilotHome, {
      ...(persisted || {}),
      worktreeId,
      repoId: repo.repoId,
      repoPath: repo.repoPath,
      repoLabel: repo.repoLabel,
      mode,
      path: worktreePath,
      branch: asOptionalString(requested.branch) || (persisted && persisted.branch),
      source: asOptionalString(requested.source) || (persisted && persisted.source) || 'executor',
      status: nextStatus,
      launch: {
        blocked: launchBlocked,
        reason: launchBlockedReason,
      },
      assignment: mergedAssignment,
      cleanup: {
        policy: asOptionalString(requested.cleanupPolicy) || (persisted && persisted.cleanup && persisted.cleanup.policy) || WORKTREE_CLEANUP_POLICIES.REUSE,
        status: nextCleanupStatus,
        lastAttemptAt: persisted && persisted.cleanup ? persisted.cleanup.lastAttemptAt : null,
        lastError: persisted && persisted.cleanup ? persisted.cleanup.lastError : null,
      },
      recovery: {
        mode: nextRecoveryMode,
        orphaned: persisted && persisted.recovery ? persisted.recovery.orphaned === true : false,
        reason: launchBlocked && !reuseAssessment.reason ? launchBlockedReason : (persisted && persisted.recovery ? persisted.recovery.reason : null),
      },
      validation: {
        pathExists: validation.pathExists,
        gitWorktree: validation.isGitWorktree,
        repoMatches: validation.repoMatches,
        checkedAt: nowIso(this._now),
        reason: validation.reason,
      },
      lifecycle: {
        requestedAt: (persisted && persisted.lifecycle && persisted.lifecycle.requestedAt) || nowIso(this._now),
        allocatedAt: nowIso(this._now),
        activatedAt: persisted && persisted.lifecycle ? persisted.lifecycle.activatedAt : null,
        releasedAt: persisted && persisted.lifecycle ? persisted.lifecycle.releasedAt : null,
        interruptedAt: persisted && persisted.lifecycle ? persisted.lifecycle.interruptedAt : null,
        lastSeenAt: nowIso(this._now),
      },
      createdAt: (persisted && persisted.createdAt) || nowIso(this._now),
      updatedAt: nowIso(this._now),
    });

    return {
      repo,
      cwd: launchBlocked ? null : worktreePath,
      worktree: record,
    };
  }

  markWorktreeActive(input = {}) {
    const copilotHome = input.copilotHome || input.copilotHomeAbs || this._config.copilotHome || '.';
    const repoId = asTrimmedString(input.repoId);
    const worktreeId = asTrimmedString(input.worktreeId);
    if (!repoId || !worktreeId) {
      return null;
    }
    const existing = this.getWorktree(copilotHome, repoId, worktreeId);
    if (!existing) {
      return null;
    }
    const requestedAssignment = normalizeRequestedAssignment(input);
    const reuseAssessment = assessWorktreeReuse(existing, requestedAssignment);
    if (reuseAssessment.blocked) {
      throw Object.assign(new Error(reuseAssessment.reason), { statusCode: 409 });
    }
    const validation = existing.mode === WORKTREE_MODES.DEDICATED
      ? validateDedicatedWorktreePath(this._fs, this._path, existing.repoPath, existing.path, existing.repoId)
      : { ready: isDirectory(this._fs, existing.path), reason: null, pathExists: isDirectory(this._fs, existing.path), isGitWorktree: false, repoMatches: false };
    if (!validation.ready) {
      throw Object.assign(new Error(validation.reason || 'Dedicated worktree launch is blocked.'), { statusCode: 409 });
    }
    return this._writeRecord(copilotHome, {
      ...existing,
      status: WORKTREE_STATES.ACTIVE,
      launch: {
        blocked: false,
        reason: null,
      },
      assignment: {
        sessionId: requestedAssignment.sessionId || (existing.assignment && existing.assignment.sessionId) || null,
        runId: requestedAssignment.runId || (existing.assignment && existing.assignment.runId) || null,
        overlaySessionId: requestedAssignment.overlaySessionId || (existing.assignment && existing.assignment.overlaySessionId) || null,
      },
      validation: {
        pathExists: validation.pathExists,
        gitWorktree: validation.isGitWorktree,
        repoMatches: validation.repoMatches,
        checkedAt: nowIso(this._now),
        reason: validation.reason,
      },
      lifecycle: {
        requestedAt: existing.lifecycle && existing.lifecycle.requestedAt,
        allocatedAt: existing.lifecycle && existing.lifecycle.allocatedAt,
        activatedAt: nowIso(this._now),
        releasedAt: existing.lifecycle && existing.lifecycle.releasedAt,
        interruptedAt: existing.lifecycle && existing.lifecycle.interruptedAt,
        lastSeenAt: nowIso(this._now),
      },
      updatedAt: nowIso(this._now),
    });
  }

  markWorktreeReusable(input = {}) {
    const copilotHome = input.copilotHome || input.copilotHomeAbs || this._config.copilotHome || '.';
    const repoId = asTrimmedString(input.repoId);
    const worktreeId = asTrimmedString(input.worktreeId);
    if (!repoId || !worktreeId) {
      return null;
    }
    const existing = this.getWorktree(copilotHome, repoId, worktreeId);
    if (!existing) {
      return null;
    }
    return this._writeRecord(copilotHome, {
      ...existing,
      status: WORKTREE_STATES.REUSABLE,
      assignment: {
        sessionId: null,
        runId: null,
        overlaySessionId: null,
      },
      cleanup: {
        policy: existing.cleanup && existing.cleanup.policy,
        status: WORKTREE_CLEANUP_STATES.REUSE_READY,
        lastAttemptAt: existing.cleanup && existing.cleanup.lastAttemptAt,
        lastError: existing.cleanup && existing.cleanup.lastError,
      },
      recovery: {
        mode: WORKTREE_RECOVERY_MODES.REUSE,
        orphaned: existing.recovery && existing.recovery.orphaned === true,
        reason: existing.recovery && existing.recovery.reason,
      },
      lifecycle: {
        requestedAt: existing.lifecycle && existing.lifecycle.requestedAt,
        allocatedAt: existing.lifecycle && existing.lifecycle.allocatedAt,
        activatedAt: existing.lifecycle && existing.lifecycle.activatedAt,
        releasedAt: nowIso(this._now),
        interruptedAt: existing.lifecycle && existing.lifecycle.interruptedAt,
        lastSeenAt: nowIso(this._now),
      },
      updatedAt: nowIso(this._now),
    });
  }

  markWorktreeInterrupted(input = {}) {
    const copilotHome = input.copilotHome || input.copilotHomeAbs || this._config.copilotHome || '.';
    const repoId = asTrimmedString(input.repoId);
    const worktreeId = asTrimmedString(input.worktreeId);
    if (!repoId || !worktreeId) {
      return null;
    }
    const existing = this.getWorktree(copilotHome, repoId, worktreeId);
    if (!existing) {
      return null;
    }
    return this._writeRecord(copilotHome, {
      ...existing,
      status: WORKTREE_STATES.INTERRUPTED,
      cleanup: {
        policy: existing.cleanup && existing.cleanup.policy,
        status: WORKTREE_CLEANUP_STATES.MANUAL_REQUIRED,
        lastAttemptAt: existing.cleanup && existing.cleanup.lastAttemptAt,
        lastError: existing.cleanup && existing.cleanup.lastError,
      },
      recovery: {
        mode: WORKTREE_RECOVERY_MODES.REUSE,
        orphaned: existing.recovery && existing.recovery.orphaned === true,
        reason: asOptionalString(input.reason) || 'interrupted',
      },
      lifecycle: {
        requestedAt: existing.lifecycle && existing.lifecycle.requestedAt,
        allocatedAt: existing.lifecycle && existing.lifecycle.allocatedAt,
        activatedAt: existing.lifecycle && existing.lifecycle.activatedAt,
        releasedAt: existing.lifecycle && existing.lifecycle.releasedAt,
        interruptedAt: nowIso(this._now),
        lastSeenAt: nowIso(this._now),
      },
      updatedAt: nowIso(this._now),
    });
  }
}

function createWorktreeService(config = {}, deps = {}) {
  return new WorktreeService(config, deps);
}

function resolveOpenCodeWorktreeBase() {
  return process.env.OPENCODE_WORKTREE_BASE
    || path.join(process.env.HOME || process.env.USERPROFILE || '~', '.local', 'share', 'opencode', 'worktree');
}

function buildOpenCodeWorktreeEnv(worktreePath, projectId) {
  const env = {
    OPENCODE_WORKTREE_BASE: resolveOpenCodeWorktreeBase(),
    OPENCODE_PROJECT_ID: projectId || '',
  };
  if (worktreePath) {
    env.OPENCODE_WORKTREE_PATH = worktreePath;
    env.OPENCODE_WORKTREE_ROOT = worktreePath;
  }
  return env;
}

function createOpenCodeWorktreeRecord(worktreeService, input = {}) {
  if (!worktreeService || typeof worktreeService.resolveLaunchPlan !== 'function') {
    return { error: 'worktreeService instance with resolveLaunchPlan method is required' };
  }

  const copilotHome = input.copilotHome || '.';
  const repoId = input.repoId;
  const branch = input.branch || 'main';
  const repoPath = input.repoPath;

  if (!repoId) {
    return { error: 'repoId is required' };
  }

  const worktreeBase = resolveOpenCodeWorktreeBase();
  const projectId = repoPath
    ? repoPath.replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('-').replace(/[^a-zA-Z0-9_-]/g, '-')
    : repoId;
  const worktreePath = path.join(worktreeBase, projectId, branch);

  const record = worktreeService.resolveLaunchPlan({
    copilotHome,
    repoId,
    repoPath,
    worktree: {
      mode: 'dedicated',
      worktreePath,
      branch,
    },
  });

  return {
    worktreePath,
    projectId,
    branch,
    env: buildOpenCodeWorktreeEnv(worktreePath, projectId),
    record: record && record.worktree ? record.worktree : null,
  };
}

module.exports = {
  WORKTREE_CONTRACT_VERSION,
  WORKTREE_MODES,
  WORKTREE_STATES,
  WORKTREE_CLEANUP_POLICIES,
  WORKTREE_CLEANUP_STATES,
  WORKTREE_RECOVERY_MODES,
  normalizeWorktreeRecord,
  validateDedicatedWorktreePath,
  createWorktreeId,
  createWorktreeService,
  WorktreeService,
  resolveOpenCodeWorktreeBase,
  buildOpenCodeWorktreeEnv,
  createOpenCodeWorktreeRecord,
};
