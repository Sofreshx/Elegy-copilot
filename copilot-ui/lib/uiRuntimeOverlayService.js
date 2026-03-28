'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoInventoryService = require('./repoInventoryService');

const STATE_VERSION = 1;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function resolveUiRuntimeOverlayStatePath(copilotHome, pathImpl = path) {
  return pathImpl.join(pathImpl.resolve(String(copilotHome || '.')), 'ui-runtime-overlay', 'state.json');
}

function isDirectory(fsImpl, absPath) {
  try {
    return fsImpl.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function writeJsonAtomic(fsImpl, pathImpl, absPath, value) {
  const dirPath = pathImpl.dirname(absPath);
  const tempPath = pathImpl.join(
    dirPath,
    `.${pathImpl.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fsImpl.mkdirSync(dirPath, { recursive: true });
  fsImpl.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fsImpl.renameSync(tempPath, absPath);
}

function createStateShape() {
  return {
    version: STATE_VERSION,
    sessions: [],
  };
}

function createSessionId(cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  return `uiro-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseRuntimeUrl(value) {
  const runtimeUrl = asTrimmedString(value);
  if (!runtimeUrl) {
    throw Object.assign(new Error('runtimeUrl is required'), { statusCode: 400 });
  }

  let parsed;
  try {
    parsed = new URL(runtimeUrl);
  } catch {
    throw Object.assign(new Error('runtimeUrl must be a valid http or https URL'), { statusCode: 400 });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('runtimeUrl must use http or https'), { statusCode: 400 });
  }

  return {
    runtimeUrl: parsed.toString(),
    runtimeOrigin: parsed.origin,
  };
}

function isPathInside(parentPath, candidatePath, pathImpl = path) {
  const relativePath = pathImpl.relative(pathImpl.resolve(parentPath), pathImpl.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !pathImpl.isAbsolute(relativePath));
}

function normalizeStatus(value) {
  return asTrimmedString(value) === 'closed' ? 'closed' : 'attached';
}

function normalizePhase(value, status) {
  const normalized = asTrimmedString(value);
  if (normalized) {
    return normalized;
  }
  return status === 'closed' ? 'closed' : 'attached';
}

function normalizeEvidence(value) {
  if (!isObject(value)) {
    return null;
  }
  return clone(value);
}

function normalizeSessionRecord(value, pathImpl = path) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const repoId = asTrimmedString(value.repoId);
  const repoPath = asTrimmedString(value.repoPath) ? pathImpl.resolve(String(value.repoPath)) : '';
  const repoLabel = asTrimmedString(value.repoLabel);
  const packageRoot = asTrimmedString(value.packageRoot) ? pathImpl.resolve(String(value.packageRoot)) : '';
  const createdAt = asNullableIsoString(value.createdAt);
  const updatedAt = asNullableIsoString(value.updatedAt);

  if (!id || !repoId || !repoPath || !repoLabel || !packageRoot || !createdAt || !updatedAt) {
    return null;
  }

  let runtime;
  try {
    runtime = parseRuntimeUrl(value.runtimeUrl);
  } catch {
    return null;
  }

  const status = normalizeStatus(value.status);

  return {
    id,
    status,
    runtimeUrl: runtime.runtimeUrl,
    runtimeOrigin: runtime.runtimeOrigin,
    repoId,
    repoPath,
    repoLabel,
    packageRoot,
    phase: normalizePhase(value.phase, status),
    evidence: normalizeEvidence(value.evidence),
    createdAt,
    updatedAt,
    closedAt: status === 'closed' ? asNullableIsoString(value.closedAt) : null,
  };
}

function sortSessions(sessions) {
  return sessions
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
}

class UiRuntimeOverlayService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._fs = deps.fs || fs;
    this._path = deps.path || path;
    this._crypto = deps.crypto || crypto;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._repoInventory = deps.repoInventory || repoInventoryService;
    this._statePath = resolveUiRuntimeOverlayStatePath(this._config.copilotHome || '.', this._path);
  }

  get statePath() {
    return this._statePath;
  }

  listSessions() {
    return sortSessions(this._loadState().sessions).map((session) => clone(session));
  }

  createSession(input = {}) {
    const repo = this._resolveSelectedRepo();
    const runtime = parseRuntimeUrl(input.runtimeUrl);
    const packageRoot = this._resolvePackageRoot(repo, input.packageRoot);
    const timestamp = nowIso(this._now);
    const session = {
      id: createSessionId(this._crypto),
      status: 'attached',
      runtimeUrl: runtime.runtimeUrl,
      runtimeOrigin: runtime.runtimeOrigin,
      repoId: repo.repoId,
      repoPath: repo.repoPath,
      repoLabel: repo.repoLabel,
      packageRoot,
      phase: 'attached',
      evidence: {
        source: 'copilot-ui',
        kind: 'runtime-url-registration',
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: null,
    };

    const state = this._loadState();
    state.sessions = sortSessions([session, ...state.sessions]);
    this._saveState(state);
    return clone(session);
  }

  closeSession(sessionId) {
    const normalizedId = asTrimmedString(sessionId);
    if (!normalizedId) {
      throw Object.assign(new Error('session id is required'), { statusCode: 400 });
    }

    const state = this._loadState();
    const sessionIndex = state.sessions.findIndex((entry) => entry.id === normalizedId);
    if (sessionIndex < 0) {
      throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
    }

    const existing = state.sessions[sessionIndex];
    if (existing.status === 'closed') {
      return clone(existing);
    }

    const timestamp = nowIso(this._now);
    const closedSession = {
      ...existing,
      status: 'closed',
      phase: 'closed',
      updatedAt: timestamp,
      closedAt: timestamp,
    };

    state.sessions[sessionIndex] = closedSession;
    state.sessions = sortSessions(state.sessions);
    this._saveState(state);
    return clone(closedSession);
  }

  _loadState() {
    let raw = null;
    try {
      raw = JSON.parse(this._fs.readFileSync(this._statePath, 'utf8'));
    } catch {
      raw = null;
    }

    const sessions = Array.isArray(raw?.sessions)
      ? raw.sessions
        .map((entry) => normalizeSessionRecord(entry, this._path))
        .filter(Boolean)
      : [];

    return {
      version: STATE_VERSION,
      sessions: sortSessions(sessions),
    };
  }

  _saveState(state) {
    const normalized = createStateShape();
    normalized.sessions = sortSessions(Array.isArray(state?.sessions)
      ? state.sessions
        .map((entry) => normalizeSessionRecord(entry, this._path))
        .filter(Boolean)
      : []);
    writeJsonAtomic(this._fs, this._path, this._statePath, normalized);
    return normalized;
  }

  _resolveSelectedRepo() {
    const inventory = this._repoInventory.listKnownRepos({
      copilotHome: this._config.copilotHome,
      engineRoot: this._config.engineRoot,
    });
    const repo = inventory && isObject(inventory.selectedRepo) ? inventory.selectedRepo : null;
    const repoId = asTrimmedString(repo?.repoId);
    const repoPath = asTrimmedString(repo?.repoPath) ? this._path.resolve(String(repo.repoPath)) : '';
    const repoLabel = asTrimmedString(repo?.repoLabel) || (repoPath ? this._path.basename(repoPath) : '');

    if (!repo || !repoId || !repoPath || !repoLabel) {
      throw Object.assign(new Error('A Catalog repo must be selected before attaching a runtime.'), { statusCode: 409 });
    }

    if (!isDirectory(this._fs, repoPath)) {
      throw Object.assign(new Error('The selected Catalog repo is no longer available on disk.'), { statusCode: 409 });
    }

    return {
      repoId,
      repoPath,
      repoLabel,
    };
  }

  _resolvePackageRoot(repo, packageRootInput) {
    const rawPackageRoot = asTrimmedString(packageRootInput);
    if (!rawPackageRoot) {
      return repo.repoPath;
    }

    const resolvedPackageRoot = this._path.isAbsolute(rawPackageRoot)
      ? this._path.resolve(rawPackageRoot)
      : this._path.resolve(repo.repoPath, rawPackageRoot);

    if (!isPathInside(repo.repoPath, resolvedPackageRoot, this._path)) {
      throw Object.assign(new Error('packageRoot must resolve to a directory under the selected repo.'), { statusCode: 400 });
    }

    if (!isDirectory(this._fs, resolvedPackageRoot)) {
      throw Object.assign(new Error('packageRoot must resolve to an existing directory under the selected repo.'), { statusCode: 400 });
    }

    return resolvedPackageRoot;
  }
}

function createUiRuntimeOverlayService(config = {}, deps = {}) {
  return new UiRuntimeOverlayService(config, deps);
}

module.exports = {
  STATE_VERSION,
  UiRuntimeOverlayService,
  resolveUiRuntimeOverlayStatePath,
  createUiRuntimeOverlayService,
};