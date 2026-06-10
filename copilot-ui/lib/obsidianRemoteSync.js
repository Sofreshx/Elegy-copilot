'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const obsidianNotes = require('./obsidianNotes');

const OBSIDIAN_SYNC_SCHEMA_VERSION = 1;
const OBSIDIAN_SOURCE_FIELDS = ['sourceId', 'provider', 'host', 'owner', 'repo', 'branch', 'notesPath'];
const DEFAULT_TIMER_RETRY_LIMIT = 4;
const DEFAULT_SYNC_LEASE_MIN_MS = 30_000;
const DEFAULT_SYNC_LEASE_MAX_MS = 120_000;

class ObsidianSyncConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ObsidianSyncConflictError';
    this.code = 'obsidian_sync_conflict';
    this.conflicts = Array.isArray(details.conflicts) ? details.conflicts.slice() : [];
    this.appliedCount = Number.isFinite(details.appliedCount) ? details.appliedCount : 0;
    this.deletedCount = Number.isFinite(details.deletedCount) ? details.deletedCount : 0;
    this.skippedCount = Number.isFinite(details.skippedCount) ? details.skippedCount : 0;
    this.cursor = normalizeString(details.cursor) || undefined;
  }
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeIsoString(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeTrigger(value) {
  return normalizeString(value).toLowerCase() === 'timer' ? 'timer' : 'manual';
}

function resolveSyncLeaseDurationMs(config) {
  const timeoutMs = Number.isFinite(config && config.remoteSyncTimeoutMs) && config.remoteSyncTimeoutMs > 0
    ? config.remoteSyncTimeoutMs
    : 15_000;
  return Math.max(DEFAULT_SYNC_LEASE_MIN_MS, Math.min(DEFAULT_SYNC_LEASE_MAX_MS, timeoutMs * 2));
}

function normalizeSyncLease(value) {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const token = normalizeString(record.token);
  const acquiredAt = normalizeIsoString(record.acquiredAt);
  const expiresAt = normalizeIsoString(record.expiresAt);
  if (!token || !acquiredAt || !expiresAt) {
    return null;
  }
  return {
    token,
    acquiredAt,
    expiresAt,
    trigger: normalizeTrigger(record.trigger),
  };
}

function isSyncLeaseActive(lease, nowMs = Date.now()) {
  const normalizedLease = normalizeSyncLease(lease);
  if (!normalizedLease) {
    return false;
  }
  const expiresAtMs = Date.parse(normalizedLease.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
}

function buildSyncLease(config, trigger, nowMs = Date.now()) {
  return {
    token: typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex'),
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + resolveSyncLeaseDurationMs(config)).toISOString(),
    trigger: normalizeTrigger(trigger),
  };
}

function hashContent(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, absPath);
}

function resolveSyncRoot(elegyHomeAbs) {
  return path.join(path.resolve(elegyHomeAbs || '.'), 'obsidian-sync');
}

function deriveRepoSyncKey(repo) {
  const repoId = normalizeString(repo && repo.repoId);
  const repoPath = normalizeString(repo && repo.repoPath);
  const input = repoId || repoPath || 'selected-repo';
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 24);
}

function resolveRepoStatePath(elegyHomeAbs, repo) {
  return path.join(resolveSyncRoot(elegyHomeAbs), 'repos', `${deriveRepoSyncKey(repo)}.json`);
}

function resolveRepoLeasePath(elegyHomeAbs, repo) {
  return path.join(resolveSyncRoot(elegyHomeAbs), 'leases', `${deriveRepoSyncKey(repo)}.lock.json`);
}

function resolveAggregateStatusPath(elegyHomeAbs) {
  return path.join(resolveSyncRoot(elegyHomeAbs), 'status.json');
}

function buildDefaultRepoState(repo, config) {
  return {
    schemaVersion: OBSIDIAN_SYNC_SCHEMA_VERSION,
    repoKey: deriveRepoSyncKey(repo),
    repoId: normalizeString(repo && repo.repoId) || undefined,
    repoPath: normalizeString(repo && repo.repoPath) || undefined,
    repoLabel: normalizeString(repo && repo.repoLabel) || undefined,
    cursor: undefined,
    noteStates: {},
    syncLease: undefined,
    summary: {
      repoKey: deriveRepoSyncKey(repo),
      repoId: normalizeString(repo && repo.repoId) || undefined,
      repoPath: normalizeString(repo && repo.repoPath) || undefined,
      repoLabel: normalizeString(repo && repo.repoLabel) || undefined,
      configured: Boolean(config && config.remoteSyncUrl && config.vaultPath),
      state: config && config.remoteSyncUrl && config.vaultPath ? 'idle' : 'disabled',
      pollEnabled: Boolean(config && config.remoteSyncUrl && config.vaultPath),
      pollIntervalMs: config && config.remoteSyncUrl && config.vaultPath ? config.remoteSyncPollIntervalMs : undefined,
      syncing: false,
      appliedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      conflictCount: 0,
      reason: undefined,
      nextAttemptAt: undefined,
      cooldownUntil: undefined,
      retryCount: 0,
      retryLimit: DEFAULT_TIMER_RETRY_LIMIT,
      lastFailureAt: undefined,
      lastFailureReason: undefined,
      leaseAcquiredAt: undefined,
      leaseExpiresAt: undefined,
      leaseTrigger: undefined,
      lastStaleLeaseRecoveredAt: undefined,
      message: config && config.remoteSyncUrl && config.vaultPath
        ? 'Remote pull sync is configured and waiting for the next poll.'
        : 'Remote pull sync is not configured.',
      updatedAt: new Date().toISOString(),
    },
  };
}

function readJsonFile(absPath, fallback) {
  if (!fs.existsSync(absPath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonExclusive(absPath, value) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

function removeFileIfExists(absPath) {
  try {
    fs.unlinkSync(absPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function readPersistedRepoSyncLease({ elegyHomeAbs, repo }) {
  return normalizeSyncLease(readJsonFile(resolveRepoLeasePath(elegyHomeAbs, repo), null));
}

function resolveRepoLeaseClaimPath(elegyHomeAbs, repo, leaseToken) {
  return path.join(resolveSyncRoot(elegyHomeAbs), 'leases', `${deriveRepoSyncKey(repo)}.${leaseToken}.reclaim.json`);
}

function tryReclaimStaleRepoSyncLease({ elegyHomeAbs, repo, lease }) {
  const normalizedLease = normalizeSyncLease(lease);
  if (!normalizedLease || isSyncLeaseActive(normalizedLease)) {
    return false;
  }

  const claimPath = resolveRepoLeaseClaimPath(elegyHomeAbs, repo, normalizedLease.token);
  if (!writeJsonExclusive(claimPath, {
    token: normalizedLease.token,
    claimedAt: new Date().toISOString(),
    pid: process.pid,
  })) {
    return false;
  }

  try {
    const persistedLease = readPersistedRepoSyncLease({ elegyHomeAbs, repo });
    if (!persistedLease) {
      return true;
    }
    if (persistedLease.token !== normalizedLease.token || isSyncLeaseActive(persistedLease)) {
      return false;
    }

    removeFileIfExists(resolveRepoLeasePath(elegyHomeAbs, repo));
    return true;
  } finally {
    removeFileIfExists(claimPath);
  }
}

function readRepoSyncState({ elegyHomeAbs, repo, config }) {
  const fallback = buildDefaultRepoState(repo, config);
  const raw = readJsonFile(resolveRepoStatePath(elegyHomeAbs, repo), fallback);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fallback;
  }
  return {
    ...fallback,
    ...raw,
    noteStates: raw.noteStates && typeof raw.noteStates === 'object' && !Array.isArray(raw.noteStates)
      ? raw.noteStates
      : {},
    syncLease: normalizeSyncLease(raw.syncLease) || undefined,
    summary: raw.summary && typeof raw.summary === 'object' && !Array.isArray(raw.summary)
      ? { ...fallback.summary, ...raw.summary }
      : fallback.summary,
  };
}

function writeRepoSyncState({ elegyHomeAbs, repo, state }) {
  writeJsonAtomic(resolveRepoStatePath(elegyHomeAbs, repo), state);
}

function readAggregateRepoSummaries(elegyHomeAbs) {
  const reposDirectory = path.join(resolveSyncRoot(elegyHomeAbs), 'repos');
  if (!fs.existsSync(reposDirectory) || !fs.statSync(reposDirectory).isDirectory()) {
    return {};
  }

  const repoSummaries = {};
  const repoFiles = fs.readdirSync(reposDirectory)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));

  for (const repoFile of repoFiles) {
    const repoState = readJsonFile(path.join(reposDirectory, repoFile), null);
    if (!repoState || typeof repoState !== 'object' || Array.isArray(repoState)) {
      continue;
    }

    const summary = repoState.summary;
    const repoKey = normalizeString(summary && summary.repoKey) || normalizeString(repoState.repoKey);
    if (!repoKey || !summary || typeof summary !== 'object' || Array.isArray(summary)) {
      continue;
    }

    repoSummaries[repoKey] = {
      ...summary,
      repoKey,
    };
  }

  return repoSummaries;
}

function updateAggregateStatus({ elegyHomeAbs }) {
  const statusPath = resolveAggregateStatusPath(elegyHomeAbs);
  const next = {
    schemaVersion: OBSIDIAN_SYNC_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    repos: readAggregateRepoSummaries(elegyHomeAbs),
  };
  writeJsonAtomic(statusPath, next);
}

function persistRepoState({ elegyHomeAbs, repo, state }) {
  writeRepoSyncState({ elegyHomeAbs, repo, state });
  updateAggregateStatus({ elegyHomeAbs });
  return state;
}

function persistRepoSummary({ elegyHomeAbs, repo, config, summaryPatch }) {
  const current = readRepoSyncState({ elegyHomeAbs, repo, config });
  const summary = {
    ...current.summary,
    ...summaryPatch,
    repoKey: current.repoKey,
    repoId: current.repoId,
    repoPath: current.repoPath,
    repoLabel: current.repoLabel,
    configured: Boolean(config && config.remoteSyncUrl && config.vaultPath),
    pollEnabled: Boolean(config && config.remoteSyncUrl && config.vaultPath),
    pollIntervalMs: config && config.remoteSyncUrl && config.vaultPath ? config.remoteSyncPollIntervalMs : undefined,
    updatedAt: new Date().toISOString(),
  };
  const nextState = {
    ...current,
    summary,
  };
  return persistRepoState({ elegyHomeAbs, repo, state: nextState });
}

function acquireRepoSyncLease({ elegyHomeAbs, repo, config, trigger }) {
  const current = readRepoSyncState({ elegyHomeAbs, repo, config });
  const persistedLease = readPersistedRepoSyncLease({ elegyHomeAbs, repo });
  const activeLease = persistedLease || normalizeSyncLease(current.syncLease);
  if (isSyncLeaseActive(activeLease)) {
    return {
      acquired: false,
      activeLease,
      staleLeaseRecovered: false,
      state: current,
    };
  }

  if (persistedLease && !tryReclaimStaleRepoSyncLease({ elegyHomeAbs, repo, lease: persistedLease })) {
    const latestState = readRepoSyncState({ elegyHomeAbs, repo, config });
    return {
      acquired: false,
      activeLease: readPersistedRepoSyncLease({ elegyHomeAbs, repo }) || normalizeSyncLease(latestState.syncLease),
      staleLeaseRecovered: false,
      state: latestState,
    };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const lease = buildSyncLease(config, trigger, nowMs);
  if (!writeJsonExclusive(resolveRepoLeasePath(elegyHomeAbs, repo), lease)) {
    const latestState = readRepoSyncState({ elegyHomeAbs, repo, config });
    return {
      acquired: false,
      activeLease: readPersistedRepoSyncLease({ elegyHomeAbs, repo }) || normalizeSyncLease(latestState.syncLease),
      staleLeaseRecovered: false,
      state: latestState,
    };
  }

  const staleLeaseRecovered = Boolean(activeLease);
  const nextState = {
    ...current,
    syncLease: lease,
    summary: {
      ...current.summary,
      state: 'syncing',
      syncing: true,
      lastAttemptAt: nowIso,
      reason: staleLeaseRecovered ? 'stale_lease_recovered' : 'sync_in_progress',
      message: normalizeTrigger(trigger) === 'manual'
        ? 'Manual Obsidian sync is running.'
        : 'Timer-based Obsidian sync poll is running.',
      leaseAcquiredAt: lease.acquiredAt,
      leaseExpiresAt: lease.expiresAt,
      leaseTrigger: lease.trigger,
      lastStaleLeaseRecoveredAt: staleLeaseRecovered ? nowIso : current.summary.lastStaleLeaseRecoveredAt,
      updatedAt: nowIso,
    },
  };

  return {
    acquired: true,
    activeLease: lease,
    staleLeaseRecovered,
    state: persistRepoState({ elegyHomeAbs, repo, state: nextState }),
  };
}

function releaseRepoSyncLease({ elegyHomeAbs, repo, config, leaseToken, summaryPatch }) {
  const current = readRepoSyncState({ elegyHomeAbs, repo, config });
  const persistedLease = readPersistedRepoSyncLease({ elegyHomeAbs, repo });
  const activeLease = persistedLease || normalizeSyncLease(current.syncLease);
  const safeLeaseToken = normalizeString(leaseToken);

  if (activeLease && activeLease.token !== safeLeaseToken && isSyncLeaseActive(activeLease)) {
    return current;
  }

  const nextState = {
    ...current,
    summary: {
      ...current.summary,
      ...summaryPatch,
      syncing: false,
      leaseAcquiredAt: undefined,
      leaseExpiresAt: undefined,
      leaseTrigger: undefined,
      updatedAt: new Date().toISOString(),
    },
  };

  if (!persistedLease || persistedLease.token === safeLeaseToken || !isSyncLeaseActive(persistedLease)) {
    removeFileIfExists(resolveRepoLeasePath(elegyHomeAbs, repo));
  }

  if (!activeLease || activeLease.token === safeLeaseToken || !isSyncLeaseActive(activeLease)) {
    delete nextState.syncLease;
  }

  return persistRepoState({ elegyHomeAbs, repo, state: nextState });
}

function buildRemoteFeedUrl(config, repo, cursor, effectiveSource) {
  const baseUrl = normalizeString(config && config.remoteSyncUrl);
  if (!baseUrl) {
    return '';
  }

  const hasRepoIdPlaceholder = baseUrl.includes('{repoId}');
  const hasRepoLabelPlaceholder = baseUrl.includes('{repoLabel}');
  const hasRepoPathPlaceholder = baseUrl.includes('{repoPath}');
  const hasCursorPlaceholder = baseUrl.includes('{cursor}');
  const hasRepoIdQueryParam = /[?&]repoId=/.test(baseUrl);
  const hasRepoLabelQueryParam = /[?&]repoLabel=/.test(baseUrl);
  const hasRepoPathQueryParam = /[?&]repoPath=/.test(baseUrl);
  const hasCursorQueryParam = /[?&]cursor=/.test(baseUrl);
  const sourceValues = effectiveSource && typeof effectiveSource === 'object'
    ? {
      sourceId: encodeURIComponent(normalizeString(effectiveSource.id)),
      provider: encodeURIComponent(normalizeString(effectiveSource.provider)),
      host: encodeURIComponent(normalizeString(effectiveSource.host)),
      owner: encodeURIComponent(normalizeString(effectiveSource.owner)),
      repo: encodeURIComponent(normalizeString(effectiveSource.repo)),
      branch: encodeURIComponent(normalizeString(effectiveSource.branch)),
      notesPath: encodeURIComponent(normalizeString(effectiveSource.notesPath)),
    }
    : {};
  const repoId = encodeURIComponent(normalizeString(repo && repo.repoId));
  const repoLabel = encodeURIComponent(normalizeString(repo && repo.repoLabel));
  const repoPath = encodeURIComponent(normalizeString(repo && repo.repoPath));
  const cursorValue = encodeURIComponent(normalizeString(cursor));
  let nextUrl = baseUrl
    .replace(/\{repoId\}/g, repoId)
    .replace(/\{repoLabel\}/g, repoLabel)
    .replace(/\{repoPath\}/g, repoPath)
    .replace(/\{cursor\}/g, cursorValue);

  OBSIDIAN_SOURCE_FIELDS.forEach((field) => {
    nextUrl = nextUrl.replace(new RegExp(`\\{${field}\\}`, 'g'), sourceValues[field] || '');
  });

  if (hasRepoPathQueryParam && repoPath && !hasRepoPathPlaceholder) {
    nextUrl = nextUrl.replace(/([?&]repoPath=)([^&#]*)/i, `$1${repoPath}`);
  }

  OBSIDIAN_SOURCE_FIELDS.forEach((field) => {
    const queryPattern = new RegExp(`([?&]${field}=)([^&#]*)`, 'i');
    if (queryPattern.test(nextUrl) && sourceValues[field] && !baseUrl.includes(`{${field}}`)) {
      nextUrl = nextUrl.replace(queryPattern, `$1${sourceValues[field]}`);
    }
  });

  if (!hasRepoIdPlaceholder && !hasRepoIdQueryParam && repoId) {
    nextUrl += `${nextUrl.includes('?') ? '&' : '?'}repoId=${repoId}`;
  }
  if (!hasRepoLabelPlaceholder && !hasRepoLabelQueryParam && repoLabel) {
    nextUrl += `${nextUrl.includes('?') ? '&' : '?'}repoLabel=${repoLabel}`;
  }
  if (!hasCursorPlaceholder && !hasCursorQueryParam && cursorValue) {
    nextUrl += `${nextUrl.includes('?') ? '&' : '?'}cursor=${cursorValue}`;
  }

  OBSIDIAN_SOURCE_FIELDS.forEach((field) => {
    const queryPattern = new RegExp(`[?&]${field}=`, 'i');
    if (!baseUrl.includes(`{${field}}`) && !queryPattern.test(baseUrl) && sourceValues[field]) {
      nextUrl += `${nextUrl.includes('?') ? '&' : '?'}${field}=${sourceValues[field]}`;
    }
  });

  return nextUrl;
}

async function pullRemoteFeed({ config, repo, cursor, effectiveSource, fetchImpl, processImpl }) {
  const remoteUrl = buildRemoteFeedUrl(config, repo, cursor, effectiveSource);
  if (!remoteUrl) {
    return { notes: [], nextCursor: normalizeString(cursor) || undefined };
  }

  const timeoutMs = Number.isFinite(config && config.remoteSyncTimeoutMs) && config.remoteSyncTimeoutMs > 0
    ? config.remoteSyncTimeoutMs
    : 15_000;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = setTimeout(() => {
    if (controller) {
      controller.abort();
    }
  }, timeoutMs);

  try {
    const headers = { Accept: 'application/json' };
    const authTokenEnv = normalizeString(config && config.remoteSyncAuthTokenEnv);
    const token = authTokenEnv && processImpl && processImpl.env ? normalizeString(processImpl.env[authTokenEnv]) : '';
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(remoteUrl, {
      method: 'GET',
      headers,
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) {
      throw new Error(`Remote sync feed request failed with ${response.status}`);
    }
    const payload = await response.json();
    const notes = Array.isArray(payload && payload.notes)
      ? payload.notes
      : (Array.isArray(payload && payload.items) ? payload.items : []);
    return {
      notes,
      nextCursor: normalizeString(payload && (payload.nextCursor || payload.cursor)) || normalizeString(cursor) || undefined,
      receivedAt: normalizeIsoString(payload && payload.receivedAt) || new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeRemoteNote(item) {
  const notePath = obsidianNotes.normalizeRelativePath(item && (item.notePath || item.path), '');
  if (!notePath) {
    return null;
  }

  const deleted = item && item.deleted === true;
  const hasStringContent = typeof item.content === 'string';
  if (!deleted && !hasStringContent) {
    return {
      notePath,
      deleted: false,
      invalid: true,
      validationError: 'non_deleted_content_must_be_string',
      sha256: normalizeString(item && item.sha256) || undefined,
      lastModifiedAt: normalizeIsoString(item && item.lastModifiedAt),
    };
  }

  return {
    notePath,
    content: hasStringContent ? item.content : '',
    deleted,
    sha256: normalizeString(item && item.sha256) || undefined,
    lastModifiedAt: normalizeIsoString(item && item.lastModifiedAt),
  };
}

function readLocalFileState(noteAbsolutePath) {
  try {
    const stat = fs.statSync(noteAbsolutePath);
    if (!stat.isFile()) {
      return {
        exists: false,
        hash: '',
      };
    }

    return {
      exists: true,
      hash: hashContent(fs.readFileSync(noteAbsolutePath, 'utf8')),
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        exists: false,
        hash: '',
      };
    }
    throw error;
  }
}

function localFileStatesMatch(left, right) {
  const leftExists = Boolean(left && left.exists);
  const rightExists = Boolean(right && right.exists);
  if (leftExists !== rightExists) {
    return false;
  }
  if (!leftExists) {
    return true;
  }
  return normalizeString(left && left.hash) === normalizeString(right && right.hash);
}

function stageTextWrite(absPath, content) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, String(content || ''), 'utf8');

  let committed = false;
  return {
    tempPath,
    commit() {
      fs.renameSync(tempPath, absPath);
      committed = true;
    },
    cleanup() {
      if (committed || !fs.existsSync(tempPath)) {
        return;
      }
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // best-effort
      }
    },
  };
}

function isProtectedRemoteNotePath(notePath) {
  return obsidianNotes.isToolManagedNotePath(notePath);
}

function applyRemoteFeed({ elegyHomeAbs, repo, config, feed }) {
  const currentState = readRepoSyncState({ elegyHomeAbs, repo, config });
  const baseStatus = obsidianNotes.resolveObsidianStatus({
    repo,
    elegyHomeAbs,
    copilotHome: elegyHomeAbs,
  });
  const notesDirectory = obsidianNotes.resolveNotesDirectory(config, repo);
  fs.mkdirSync(notesDirectory.absolute, { recursive: true });

  const conflicts = [];
  const integrityConflicts = [];
  const validationConflicts = [];
  const protectedNamespaceConflicts = [];
  const plannedOperations = [];
  const projectedNoteStates = { ...currentState.noteStates };
  const projectedFiles = new Map();
  const baselineFiles = new Map();
  const normalizedEntries = [];

  for (const rawEntry of Array.isArray(feed && feed.notes) ? feed.notes : []) {
    const entry = normalizeRemoteNote(rawEntry);
    if (!entry) {
      continue;
    }

    if (entry.invalid) {
      validationConflicts.push(entry.notePath);
      continue;
    }

    normalizedEntries.push(entry);
  }

  if (validationConflicts.length > 0) {
    const uniqueConflicts = Array.from(new Set(validationConflicts));
    throw new ObsidianSyncConflictError(
      `Remote Obsidian sync rejected ${uniqueConflicts.length} malformed note(s) because non-deleted feed entries must include string content; local notes were left unchanged.`,
      {
        conflicts: uniqueConflicts,
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        cursor: currentState.cursor,
      },
    );
  }

  for (const entry of normalizedEntries) {
    if (isProtectedRemoteNotePath(entry.notePath)) {
      protectedNamespaceConflicts.push(entry.notePath);
      continue;
    }

    const remoteHash = hashContent(entry.content);
    if (entry.sha256 && entry.sha256 !== remoteHash) {
      integrityConflicts.push(entry.notePath);
      continue;
    }

    const noteAbsolutePath = path.join(notesDirectory.absolute, ...entry.notePath.split('/'));
    const previousEntry = projectedNoteStates[entry.notePath] || null;
    const baselineFile = baselineFiles.has(noteAbsolutePath)
      ? baselineFiles.get(noteAbsolutePath)
      : readLocalFileState(noteAbsolutePath);
    baselineFiles.set(noteAbsolutePath, baselineFile);
    const localFile = projectedFiles.has(noteAbsolutePath)
      ? projectedFiles.get(noteAbsolutePath)
      : baselineFile;
    projectedFiles.set(noteAbsolutePath, localFile);
    const localHash = localFile.exists ? localFile.hash : '';
    const hasTrackedBaseline = Boolean(previousEntry && normalizeString(previousEntry.remoteHash));
    const localMissingSinceLastSync = hasTrackedBaseline && !localFile.exists;
    const localChangedSinceLastSync = localFile.exists && (
      (hasTrackedBaseline && localHash !== normalizeString(previousEntry.remoteHash))
      || (!hasTrackedBaseline && localHash !== remoteHash)
    );

    if (entry.deleted) {
      if (localFile.exists && localChangedSinceLastSync) {
        conflicts.push(entry.notePath);
        continue;
      }

      plannedOperations.push({
        type: 'delete',
        entry,
        noteAbsolutePath,
        baselineFile,
        existed: localFile.exists,
      });
      projectedFiles.set(noteAbsolutePath, { exists: false, hash: '' });
      delete projectedNoteStates[entry.notePath];
      continue;
    }

    if (localMissingSinceLastSync || (localFile.exists && localChangedSinceLastSync && localHash !== remoteHash)) {
      conflicts.push(entry.notePath);
      continue;
    }

    plannedOperations.push({
      type: !localFile.exists || localHash !== remoteHash ? 'write' : 'skip',
      entry,
      noteAbsolutePath,
      baselineFile,
      remoteHash,
    });
    projectedFiles.set(noteAbsolutePath, { exists: true, hash: remoteHash });
    projectedNoteStates[entry.notePath] = {
      remoteHash,
      syncedAt: new Date().toISOString(),
      lastRemoteModifiedAt: entry.lastModifiedAt || undefined,
    };
  }

  if (protectedNamespaceConflicts.length > 0) {
    const uniqueConflicts = Array.from(new Set(protectedNamespaceConflicts));
    throw new ObsidianSyncConflictError(
      `Remote Obsidian sync rejected ${uniqueConflicts.length} protected namespace change(s); _instruction-engine/** is tool-managed and local notes were left unchanged.`,
      {
        conflicts: uniqueConflicts,
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        cursor: currentState.cursor,
      },
    );
  }

  if (integrityConflicts.length > 0) {
    const uniqueConflicts = Array.from(new Set(integrityConflicts));
    throw new ObsidianSyncConflictError(
      `Remote Obsidian sync rejected ${uniqueConflicts.length} note(s) because the feed sha256 did not match the provided content; local notes were left unchanged.`,
      {
        conflicts: uniqueConflicts,
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        cursor: currentState.cursor,
      },
    );
  }

  if (conflicts.length > 0) {
    const uniqueConflicts = Array.from(new Set(conflicts));
    throw new ObsidianSyncConflictError(
      `Remote Obsidian sync detected ${uniqueConflicts.length} conflict(s); local notes were left unchanged.`,
      {
        conflicts: uniqueConflicts,
        appliedCount: 0,
        deletedCount: 0,
        skippedCount: 0,
        cursor: currentState.cursor,
      },
    );
  }

  const nextState = {
    ...currentState,
    noteStates: { ...currentState.noteStates },
  };
  let appliedCount = 0;
  let skippedCount = 0;
  let deletedCount = 0;
  const stagedWrites = [];

  try {
    plannedOperations.forEach((operation) => {
      if (operation.type !== 'write') {
        return;
      }
      const stagedWrite = stageTextWrite(operation.noteAbsolutePath, operation.entry.content);
      operation.stagedWrite = stagedWrite;
      stagedWrites.push(stagedWrite);
    });

    const finalConflicts = [];
    const revalidatedTargets = new Set();
    plannedOperations.forEach((operation) => {
      if (revalidatedTargets.has(operation.noteAbsolutePath)) {
        return;
      }
      revalidatedTargets.add(operation.noteAbsolutePath);
      const currentFile = readLocalFileState(operation.noteAbsolutePath);
      if (!localFileStatesMatch(currentFile, operation.baselineFile)) {
        finalConflicts.push(operation.entry.notePath);
      }
    });

    if (finalConflicts.length > 0) {
      const uniqueConflicts = Array.from(new Set(finalConflicts));
      throw new ObsidianSyncConflictError(
        `Remote Obsidian sync detected ${uniqueConflicts.length} conflict(s); local notes were left unchanged.`,
        {
          conflicts: uniqueConflicts,
          appliedCount: 0,
          deletedCount: 0,
          skippedCount: 0,
          cursor: currentState.cursor,
        },
      );
    }

    for (const operation of plannedOperations) {
      if (operation.type === 'delete') {
        if (operation.existed) {
          fs.unlinkSync(operation.noteAbsolutePath);
          deletedCount += 1;
        }
        delete nextState.noteStates[operation.entry.notePath];
        continue;
      }

      if (operation.type === 'write') {
        operation.stagedWrite.commit();
        if (operation.entry.lastModifiedAt) {
          const modifiedAt = new Date(operation.entry.lastModifiedAt);
          try {
            fs.utimesSync(operation.noteAbsolutePath, modifiedAt, modifiedAt);
          } catch {
            // best-effort
          }
        }
        appliedCount += 1;
      } else {
        skippedCount += 1;
      }

      nextState.noteStates[operation.entry.notePath] = {
        remoteHash: operation.remoteHash,
        syncedAt: new Date().toISOString(),
        lastRemoteModifiedAt: operation.entry.lastModifiedAt || undefined,
      };
    }
  } finally {
    stagedWrites.forEach((stagedWrite) => stagedWrite.cleanup());
  }

  if (feed && normalizeString(feed.nextCursor)) {
    nextState.cursor = normalizeString(feed.nextCursor);
  }

  const message = appliedCount > 0 || deletedCount > 0
    ? `Remote Obsidian sync applied ${appliedCount} update(s) and ${deletedCount} deletion(s).`
    : 'Remote Obsidian sync found no note changes.';
  nextState.summary = {
    ...nextState.summary,
    state: 'success',
    syncing: false,
    conflictCount: 0,
    appliedCount,
    deletedCount,
    skippedCount,
    cursor: nextState.cursor,
    message,
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  };
  writeRepoSyncState({ elegyHomeAbs, repo, state: nextState });
  updateAggregateStatus({ elegyHomeAbs, summary: nextState.summary });

  return {
    status: baseStatus,
    state: 'success',
    appliedCount,
    deletedCount,
    skippedCount,
    conflictCount: 0,
    conflicts: [],
    cursor: nextState.cursor,
    message,
  };
}

module.exports = {
  OBSIDIAN_SYNC_SCHEMA_VERSION,
  DEFAULT_TIMER_RETRY_LIMIT,
  ObsidianSyncConflictError,
  deriveRepoSyncKey,
  resolveSyncRoot,
  resolveAggregateStatusPath,
  normalizeSyncLease,
  isSyncLeaseActive,
  readRepoSyncState,
  writeRepoSyncState,
  persistRepoSummary,
  acquireRepoSyncLease,
  releaseRepoSyncLease,
  pullRemoteFeed,
  applyRemoteFeed,
};
