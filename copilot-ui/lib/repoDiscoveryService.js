'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_DISCOVERY_SCHEMA_VERSION = 1;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath) {
  const raw = normalizeString(inputPath);
  if (!raw) {
    return raw;
  }
  if (raw === '~') {
    return os.homedir();
  }
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

function resolveElegyHome(inputPath) {
  return path.resolve(expandHome(inputPath || '~/.elegy'));
}

function safeStat(absPath, fsModule = fs) {
  try {
    return fsModule.statSync(absPath);
  } catch {
    return null;
  }
}

function safeReadDir(absPath, options, fsModule = fs) {
  try {
    return fsModule.readdirSync(absPath, options);
  } catch {
    return [];
  }
}

function isDirectory(absPath, fsModule = fs) {
  return Boolean(safeStat(absPath, fsModule)?.isDirectory());
}

function isFile(absPath, fsModule = fs) {
  return Boolean(safeStat(absPath, fsModule)?.isFile());
}

function readJsonIfExists(absPath, fsModule = fs) {
  try {
    const stat = fsModule.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fsModule.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(absPath, value, fsModule = fs, pathModule = path) {
  const dir = pathModule.dirname(absPath);
  fsModule.mkdirSync(dir, { recursive: true });
  const tempPath = pathModule.join(
    dir,
    `.${pathModule.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fsModule.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fsModule.renameSync(tempPath, absPath);
}

function normalizeScanRoot(scanRoot, pathModule = path) {
  const normalized = expandHome(scanRoot);
  return normalized ? pathModule.resolve(normalized) : '';
}

function uniqueSortedPaths(values, pathModule = path) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => normalizeScanRoot(value, pathModule))
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right));
}

function resolveRepoDiscoveryStatePath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'catalog', 'repo-discovery.json');
}

function createDefaultRepoDiscoveryState() {
  return {
    schemaVersion: REPO_DISCOVERY_SCHEMA_VERSION,
    customScanRoots: [],
  };
}

function loadRepoDiscoveryState(elegyHome, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const statePath = resolveRepoDiscoveryStatePath(elegyHome);
  const raw = readJsonIfExists(statePath, fsModule);
  const state = createDefaultRepoDiscoveryState();
  if (!raw || typeof raw !== 'object') {
    return state;
  }
  state.customScanRoots = uniqueSortedPaths(raw.customScanRoots, pathModule);
  return state;
}

function saveRepoDiscoveryState(elegyHome, state, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const statePath = resolveRepoDiscoveryStatePath(elegyHome);
  const normalized = createDefaultRepoDiscoveryState();
  normalized.customScanRoots = uniqueSortedPaths(state?.customScanRoots, pathModule);
  writeJsonAtomic(statePath, normalized, fsModule, pathModule);
  return normalized;
}

function listDefaultWorkspaceScanRoots(options = {}) {
  const pathModule = options.pathModule || path;
  const osModule = options.osModule || os;
  const homeDir = normalizeString(options.homeDir)
    ? pathModule.resolve(normalizeString(options.homeDir))
    : pathModule.resolve(osModule.homedir());
  const platform = normalizeString(options.platform) || process.platform;

  return uniqueSortedPaths([
    platform === 'win32' ? pathModule.join(homeDir, 'Documents', 'GitHub') : null,
    platform === 'win32' ? pathModule.join(homeDir, 'source', 'repos') : null,
    pathModule.join(homeDir, 'GitHub'),
    pathModule.join(homeDir, 'projects'),
    pathModule.join(homeDir, 'dev'),
    pathModule.join(homeDir, 'workspace'),
    pathModule.join(homeDir, 'code'),
    pathModule.join(homeDir, 'repos'),
  ], pathModule);
}

function resolveWorkspaceScanRoots(options = {}) {
  const pathModule = options.pathModule || path;
  const state = options.state || loadRepoDiscoveryState(options.elegyHome, options);
  const defaultRoots = options.includeDefaultRoots === false
    ? []
    : listDefaultWorkspaceScanRoots(options);
  const customScanRoots = uniqueSortedPaths(state.customScanRoots, pathModule);
  const scanRoots = Array.isArray(options.roots)
    ? uniqueSortedPaths(options.roots, pathModule)
    : uniqueSortedPaths([
      ...defaultRoots,
      ...customScanRoots,
      ...(Array.isArray(options.extraRoots) ? options.extraRoots : []),
    ], pathModule);

  return {
    storage: {
      path: resolveRepoDiscoveryStatePath(options.elegyHome),
      exists: isFile(resolveRepoDiscoveryStatePath(options.elegyHome), options.fsModule || fs),
    },
    defaultRoots,
    customScanRoots,
    scanRoots,
  };
}

function hasGitDirectory(repoPath, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const gitPath = pathModule.join(repoPath, '.git');
  return isDirectory(gitPath, fsModule) || isFile(gitPath, fsModule);
}

function listSubdirectories(absPath, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  return safeReadDir(absPath, { withFileTypes: true }, fsModule)
    .filter((entry) => entry.isDirectory())
    .map((entry) => pathModule.join(absPath, entry.name));
}

function buildScannedRepo(scanRoot, repoPath, options = {}) {
  const pathModule = options.pathModule || path;
  const relativePath = pathModule.relative(scanRoot, repoPath);
  const repoLabel = relativePath
    ? relativePath.split(pathModule.sep).join('/')
    : pathModule.basename(repoPath);
  return {
    scanRoot,
    repoPath: pathModule.resolve(repoPath),
    repoLabel: repoLabel || pathModule.basename(repoPath),
  };
}

function discoverReposInRoot(scanRoot, options = {}) {
  const fsModule = options.fsModule || fs;
  const pathModule = options.pathModule || path;
  const normalizedRoot = normalizeScanRoot(scanRoot, pathModule);
  if (!normalizedRoot || !isDirectory(normalizedRoot, fsModule)) {
    return {
      scanRoot: normalizedRoot,
      repos: [],
    };
  }

  const repos = new Map();
  function maybeAddRepo(candidatePath) {
    const normalizedCandidate = normalizeScanRoot(candidatePath, pathModule);
    if (!normalizedCandidate || !hasGitDirectory(normalizedCandidate, { fsModule, pathModule })) {
      return;
    }
    repos.set(normalizedCandidate.toLowerCase(), buildScannedRepo(normalizedRoot, normalizedCandidate, { pathModule }));
  }

  maybeAddRepo(normalizedRoot);
  const levelOne = listSubdirectories(normalizedRoot, { fsModule, pathModule });
  for (const childPath of levelOne) {
    maybeAddRepo(childPath);
    for (const grandchildPath of listSubdirectories(childPath, { fsModule, pathModule })) {
      maybeAddRepo(grandchildPath);
    }
  }

  return {
    scanRoot: normalizedRoot,
    repos: Array.from(repos.values()).sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
  };
}

function discoverReposFromRoots(options = {}) {
  const roots = uniqueSortedPaths(options.roots, options.pathModule || path);
  const discoveredRoots = [];
  const repos = new Map();

  for (const scanRoot of roots) {
    const rootResult = discoverReposInRoot(scanRoot, options);
    if (rootResult.repos.length) {
      discoveredRoots.push(rootResult);
    }
    for (const repo of rootResult.repos) {
      const mergeKey = repo.repoPath.toLowerCase();
      const existing = repos.get(mergeKey) || {
        repoPath: repo.repoPath,
        repoLabel: repo.repoLabel,
        scanRoots: new Set(),
      };
      existing.repoLabel = existing.repoLabel || repo.repoLabel;
      existing.scanRoots.add(rootResult.scanRoot);
      repos.set(mergeKey, existing);
    }
  }

  return {
    roots: discoveredRoots.sort((left, right) => left.scanRoot.localeCompare(right.scanRoot)),
    repos: Array.from(repos.values())
      .map((repo) => ({
        repoPath: repo.repoPath,
        repoLabel: repo.repoLabel,
        scanRoots: Array.from(repo.scanRoots).sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.repoPath.localeCompare(right.repoPath)),
  };
}

module.exports = {
  REPO_DISCOVERY_SCHEMA_VERSION,
  resolveRepoDiscoveryStatePath,
  createDefaultRepoDiscoveryState,
  loadRepoDiscoveryState,
  saveRepoDiscoveryState,
  listDefaultWorkspaceScanRoots,
  resolveWorkspaceScanRoots,
  hasGitDirectory,
  discoverReposInRoot,
  discoverReposFromRoots,
};
