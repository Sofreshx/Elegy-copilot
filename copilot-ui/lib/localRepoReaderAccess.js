'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ACCESS_SCHEMA_VERSION = 1;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath) {
  const raw = normalizeString(inputPath);
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function resolveElegyHome(inputPath) {
  return path.resolve(expandHome(inputPath || '~/.elegy'));
}

function resolveAccessPath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'catalog', 'local-repo-reader', 'access.json');
}

function readJsonIfExists(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

function normalizeAlias(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeRepoPath(repoPath) {
  const normalized = normalizeString(repoPath);
  return normalized ? path.resolve(expandHome(normalized)) : '';
}

function normalizeRepoEntry(entry) {
  const root = normalizeRepoPath(entry?.root || entry?.repoPath);
  const alias = normalizeAlias(entry?.alias || entry?.label || entry?.repoLabel || entry?.repoId || path.basename(root));
  if (!root || !alias) return null;
  return {
    repoId: normalizeString(entry?.repoId) || alias,
    alias,
    root,
    label: normalizeString(entry?.label || entry?.repoLabel) || alias,
    enabled: entry?.enabled !== false,
  };
}

function createDefaultAccessState() {
  return {
    schemaVersion: ACCESS_SCHEMA_VERSION,
    updatedAt: null,
    repos: [],
  };
}

function loadAccessState(elegyHome) {
  const raw = readJsonIfExists(resolveAccessPath(elegyHome));
  const state = createDefaultAccessState();
  if (!raw || typeof raw !== 'object') return state;
  state.updatedAt = normalizeString(raw.updatedAt) || null;
  state.repos = Array.isArray(raw.repos)
    ? raw.repos.map(normalizeRepoEntry).filter(Boolean).sort((left, right) => left.alias.localeCompare(right.alias))
    : [];
  return state;
}

function saveAccessState(elegyHome, state) {
  const normalized = createDefaultAccessState();
  normalized.updatedAt = new Date().toISOString();
  normalized.repos = Array.isArray(state?.repos)
    ? state.repos.map(normalizeRepoEntry).filter(Boolean).sort((left, right) => left.alias.localeCompare(right.alias))
    : [];
  writeJsonAtomic(resolveAccessPath(elegyHome), normalized);
  return normalized;
}

function listAccess(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const state = loadAccessState(elegyHome);
  return {
    storage: {
      path: resolveAccessPath(elegyHome),
      exists: fs.existsSync(resolveAccessPath(elegyHome)),
    },
    ...state,
  };
}

function enableRepo(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const repoPath = normalizeRepoPath(options.repoPath || options.root);
  if (!repoPath) {
    throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw Object.assign(new Error(`Repo path does not exist: ${repoPath}`), { statusCode: 404 });
  }
  const nextRepo = normalizeRepoEntry({
    repoId: options.repoId,
    alias: options.alias,
    repoPath,
    repoLabel: options.repoLabel || options.label,
    enabled: true,
  });
  if (!nextRepo) {
    throw Object.assign(new Error('Unable to normalize repo access entry'), { statusCode: 400 });
  }

  const state = loadAccessState(elegyHome);
  const repos = state.repos.filter((entry) =>
    entry.repoId !== nextRepo.repoId
    && entry.alias !== nextRepo.alias
    && path.resolve(entry.root).toLowerCase() !== path.resolve(nextRepo.root).toLowerCase()
  );
  repos.push(nextRepo);
  const saved = saveAccessState(elegyHome, { ...state, repos });
  return {
    enabled: true,
    repo: nextRepo,
    access: listAccess({ elegyHome }),
    saved,
  };
}

function disableRepo(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const repoId = normalizeString(options.repoId);
  const alias = normalizeAlias(options.alias);
  const repoPath = normalizeRepoPath(options.repoPath || options.root);
  if (!repoId && !alias && !repoPath) {
    throw Object.assign(new Error('repoId, alias, or repoPath is required'), { statusCode: 400 });
  }

  const state = loadAccessState(elegyHome);
  const removed = [];
  const repos = state.repos.filter((entry) => {
    const matches = (
      (repoId && entry.repoId === repoId)
      || (alias && entry.alias === alias)
      || (repoPath && path.resolve(entry.root).toLowerCase() === repoPath.toLowerCase())
    );
    if (matches) removed.push(entry);
    return !matches;
  });
  if (!removed.length) {
    throw Object.assign(new Error('Repo is not enabled for Local Repo Reader'), { statusCode: 404 });
  }
  saveAccessState(elegyHome, { ...state, repos });
  return {
    disabled: true,
    removed,
    access: listAccess({ elegyHome }),
  };
}

module.exports = {
  ACCESS_SCHEMA_VERSION,
  resolveAccessPath,
  loadAccessState,
  saveAccessState,
  listAccess,
  enableRepo,
  disableRepo,
};
