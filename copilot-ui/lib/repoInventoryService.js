'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sessions = require('./sessions');
const {
  getRepoStateKey,
  loadCatalogProjectionSnapshot,
  resolveProjectionStorage,
} = require('./catalogProjectionService');
const repoDiscovery = require('./repoDiscoveryService');

const REPO_INVENTORY_SCHEMA_VERSION = 1;

function normalizePathForKey(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/').trim().toLowerCase();
}

function expandHome(inputPath) {
  const raw = String(inputPath || '').trim();
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

function safeStat(absPath) {
  try {
    return fs.statSync(absPath);
  } catch {
    return null;
  }
}

function safeReadDir(absPath, options) {
  try {
    return fs.readdirSync(absPath, options);
  } catch {
    return [];
  }
}

function readJsonIfExists(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
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

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => normalizeString(value))
    .filter(Boolean);
}

function uniqueSorted(values) {
  return Array.from(new Set(normalizeArray(values))).sort((left, right) => left.localeCompare(right));
}

function maxIso(left, right) {
  const leftMs = Date.parse(left || '');
  const rightMs = Date.parse(right || '');
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs)) {
    return leftMs >= rightMs ? left : right;
  }
  return left || right || null;
}

function normalizeRepoPath(repoPath) {
  const trimmed = normalizeString(repoPath);
  return trimmed ? path.resolve(trimmed) : '';
}

function isDirectory(absPath) {
  return Boolean(safeStat(absPath)?.isDirectory());
}

function isFile(absPath) {
  return Boolean(safeStat(absPath)?.isFile());
}

function detectGitRootKind(repoPath) {
  if (!repoPath) {
    return 'missing';
  }
  const gitPath = path.join(repoPath, '.git');
  if (isDirectory(gitPath)) {
    return 'directory';
  }
  if (isFile(gitPath)) {
    return 'file';
  }
  return 'missing';
}

function resolveRepoInventoryPath(elegyHome) {
  return path.join(resolveElegyHome(elegyHome), 'catalog', 'repo-inventory.json');
}

function createDefaultInventoryState() {
  return {
    schemaVersion: REPO_INVENTORY_SCHEMA_VERSION,
    selectedRepoId: null,
    selectedRepoPath: null,
    selectedAt: null,
    manualRepos: [],
  };
}

function normalizeManualRepoEntry(entry, now = new Date().toISOString()) {
  const repoPath = normalizeRepoPath(entry?.repoPath);
  if (!repoPath) {
    return null;
  }
  const repoKey = getRepoStateKey(repoPath);
  return {
    repoId: repoKey.repoId,
    repoPath,
    repoLabel: normalizeString(entry?.repoLabel || entry?.label) || repoKey.repoLabel,
    addedAt: normalizeString(entry?.addedAt) || now,
    updatedAt: normalizeString(entry?.updatedAt) || normalizeString(entry?.addedAt) || now,
    pinned: typeof entry?.pinned === 'boolean' ? entry.pinned : false,
    lastActivityMs: typeof entry?.lastActivityMs === 'number' && Number.isFinite(entry.lastActivityMs) ? entry.lastActivityMs : null,
    canonicalRemote: normalizeString(entry?.canonicalRemote) || null,
  };
}

function loadRepoInventoryState(elegyHome) {
  const inventoryPath = resolveRepoInventoryPath(elegyHome);
  const raw = readJsonIfExists(inventoryPath);
  const state = createDefaultInventoryState();
  if (!raw || typeof raw !== 'object') {
    return state;
  }

  state.selectedRepoId = normalizeString(raw.selectedRepoId) || null;
  state.selectedRepoPath = normalizeRepoPath(raw.selectedRepoPath) || null;
  state.selectedAt = normalizeString(raw.selectedAt) || null;
  state.manualRepos = Array.isArray(raw.manualRepos)
    ? raw.manualRepos
      .map((entry) => normalizeManualRepoEntry(entry))
      .filter(Boolean)
      .sort((left, right) => String(left.repoPath || '').localeCompare(String(right.repoPath || '')))
    : [];
  return state;
}

function saveRepoInventoryState(elegyHome, state) {
  const inventoryPath = resolveRepoInventoryPath(elegyHome);
  const normalized = createDefaultInventoryState();
  normalized.selectedRepoId = normalizeString(state?.selectedRepoId) || null;
  normalized.selectedRepoPath = normalizeRepoPath(state?.selectedRepoPath) || null;
  normalized.selectedAt = normalizeString(state?.selectedAt) || null;
  normalized.manualRepos = Array.isArray(state?.manualRepos)
    ? state.manualRepos
      .map((entry) => normalizeManualRepoEntry(entry))
      .filter(Boolean)
      .sort((left, right) => String(left.repoPath || '').localeCompare(String(right.repoPath || '')))
    : [];
  writeJsonAtomic(inventoryPath, normalized);
  return normalized;
}

function buildCandidate(input = {}) {
  const repoPath = normalizeRepoPath(input.repoPath);
  const repoKey = repoPath ? getRepoStateKey(repoPath) : null;
  const repoId = normalizeString(input.repoId) || repoKey?.repoId || '';
  if (!repoId && !repoPath) {
    return null;
  }
  return {
    repoId: repoId || null,
    repoPath: repoPath || null,
    repoLabel: normalizeString(input.repoLabel || input.label) || repoKey?.repoLabel || null,
    source: normalizeString(input.source) || 'unknown',
    registered: Boolean(input.registered),
    selected: Boolean(input.selected),
    lastSeenAt: normalizeString(input.lastSeenAt) || null,
    snapshotPath: normalizeString(input.snapshotPath) || null,
    snapshot: input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : null,
  };
}

function mergeCandidate(map, candidate) {
  const normalized = buildCandidate(candidate);
  if (!normalized) {
    return;
  }

  const mergeKey = normalized.repoId
    ? `repo:${normalized.repoId.toLowerCase()}`
    : `path:${normalizePathForKey(normalized.repoPath)}`;
  const existing = map.get(mergeKey) || {
    repoId: normalized.repoId,
    repoPath: normalized.repoPath,
    repoLabel: normalized.repoLabel,
    sources: new Set(),
    registered: false,
    selected: false,
    lastSeenAt: null,
    snapshotPath: null,
    snapshot: null,
  };

  existing.repoId = existing.repoId || normalized.repoId;
  existing.repoPath = existing.repoPath || normalized.repoPath;
  existing.repoLabel = existing.repoLabel || normalized.repoLabel;
  if (normalized.repoPath && !existing.repoPath) {
    existing.repoPath = normalized.repoPath;
  }
  if (normalized.repoLabel && (!existing.repoLabel || normalized.source === 'manual')) {
    existing.repoLabel = normalized.repoLabel;
  }
  if (normalized.source) {
    existing.sources.add(normalized.source);
  }
  existing.registered = existing.registered || normalized.registered;
  existing.selected = existing.selected || normalized.selected;
  existing.lastSeenAt = maxIso(existing.lastSeenAt, normalized.lastSeenAt);
  existing.snapshotPath = existing.snapshotPath || normalized.snapshotPath;
  existing.snapshot = existing.snapshot || normalized.snapshot;

  map.set(mergeKey, existing);
}

function readProjectionHints(elegyHome) {
  const projectionsDir = path.join(resolveElegyHome(elegyHome), 'catalog', 'projections');
  const hints = new Map();

  for (const entry of safeReadDir(projectionsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^repo-.+\.json$/i.test(entry.name)) {
      continue;
    }
    const snapshotPath = path.join(projectionsDir, entry.name);
    const snapshot = readJsonIfExists(snapshotPath);
    if (!snapshot || typeof snapshot !== 'object') {
      continue;
    }
    const repoContext = snapshot.repoContext;
    if (!repoContext || typeof repoContext !== 'object') {
      continue;
    }
    const repoId = normalizeString(repoContext.repoId);
    const repoPath = normalizeRepoPath(repoContext.repoPath);
    if (!repoId && !repoPath) {
      continue;
    }
    const candidate = buildCandidate({
      repoId,
      repoPath,
      repoLabel: repoContext.repoLabel || repoContext.displayName,
      source: 'catalog-projection',
      lastSeenAt: normalizeString(snapshot.generatedAt),
      snapshotPath,
      snapshot,
    });
    if (candidate?.repoId) {
      hints.set(candidate.repoId, candidate);
    }
  }

  return hints;
}

function readRepoStateHints(elegyHome, projectionHints) {
  const repoStateDir = path.join(resolveElegyHome(elegyHome), 'repo-state');
  return safeReadDir(repoStateDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const projection = projectionHints.get(entry.name);
      return buildCandidate({
        repoId: entry.name,
        repoPath: projection?.repoPath,
        repoLabel: projection?.repoLabel,
        source: 'repo-state',
        lastSeenAt: projection?.lastSeenAt,
        snapshotPath: projection?.snapshotPath,
        snapshot: projection?.snapshot,
      });
    })
    .filter(Boolean);
}

function readSessionHints(elegyHome) {
  return sessions.listSessions(resolveElegyHome(elegyHome))
    .map((session) => {
      const candidatePath = normalizeRepoPath(session?.cwd || session?.repo);
      if (!candidatePath || !path.isAbsolute(candidatePath)) {
        return null;
      }
      const repoKey = getRepoStateKey(candidatePath);
      return buildCandidate({
        repoId: repoKey.repoId,
        repoPath: repoKey.repoPath,
        repoLabel: repoKey.repoLabel,
        source: 'session-state',
        lastSeenAt: session.lastEventTime
          ? new Date(session.lastEventTime).toISOString()
          : session.startTime
            ? new Date(session.startTime).toISOString()
            : null,
      });
    })
    .filter(Boolean);
}

function parsePackageJson(repoPath) {
  return readJsonIfExists(path.join(repoPath, 'package.json'));
}

function collectRepoHints(repoPath) {
  if (!repoPath || !isDirectory(repoPath)) {
    return {
      packageName: null,
      stacks: [],
      frameworks: [],
      languages: [],
      targets: [],
      inputPaths: [],
    };
  }

  const packageJsonPath = path.join(repoPath, 'package.json');
  const packageJson = parsePackageJson(repoPath);
  const deps = {
    ...(packageJson && typeof packageJson.dependencies === 'object' ? packageJson.dependencies : {}),
    ...(packageJson && typeof packageJson.devDependencies === 'object' ? packageJson.devDependencies : {}),
  };
  const dependencyNames = Object.keys(deps).map((name) => name.toLowerCase());

  const stacks = new Set();
  const frameworks = new Set();
  const languages = new Set();
  const targets = new Set();
  const inputPaths = [];

  function addInput(relPath) {
    const absPath = path.join(repoPath, relPath);
    if (safeStat(absPath)) {
      inputPaths.push(absPath);
      return true;
    }
    return false;
  }

  if (addInput('package.json')) {
    stacks.add('node');
    languages.add(addInput('tsconfig.json') || dependencyNames.includes('typescript') ? 'typescript' : 'javascript');
    if (Array.isArray(packageJson?.workspaces)) {
      targets.add('monorepo');
    }
    if (dependencyNames.includes('react')) frameworks.add('react');
    if (dependencyNames.includes('next')) frameworks.add('nextjs');
    if (dependencyNames.includes('vue')) frameworks.add('vue');
    if (dependencyNames.includes('@angular/core')) frameworks.add('angular');
    if (dependencyNames.includes('svelte')) frameworks.add('svelte');
    if (dependencyNames.includes('express')) frameworks.add('express');
    if (dependencyNames.includes('@nestjs/core')) frameworks.add('nestjs');
    if (dependencyNames.includes('electron')) frameworks.add('electron');

    if (frameworks.has('react') || frameworks.has('nextjs') || frameworks.has('vue') || frameworks.has('angular') || frameworks.has('svelte')) {
      targets.add('frontend');
    }
    if (frameworks.has('express') || frameworks.has('nestjs')) {
      targets.add('backend');
    }
    if (frameworks.has('electron')) {
      targets.add('desktop');
    }
  }

  if (addInput('pyproject.toml') || addInput('requirements.txt')) {
    stacks.add('python');
    languages.add('python');
  }
  if (addInput('go.mod')) {
    stacks.add('go');
    languages.add('go');
  }
  if (addInput('Cargo.toml')) {
    stacks.add('rust');
    languages.add('rust');
  }
  if (addInput('pom.xml') || addInput('build.gradle') || addInput('build.gradle.kts')) {
    stacks.add('java');
    languages.add('java');
  }
  if (safeReadDir(repoPath, { withFileTypes: true }).some((entry) => entry.isFile() && /\.(csproj|fsproj|vbproj|sln)$/i.test(entry.name))) {
    stacks.add('dotnet');
    languages.add('csharp');
    targets.add('backend');
  }

  return {
    packageName: normalizeString(packageJson?.name) || null,
    stacks: Array.from(stacks).sort((left, right) => left.localeCompare(right)),
    frameworks: Array.from(frameworks).sort((left, right) => left.localeCompare(right)),
    languages: Array.from(languages).sort((left, right) => left.localeCompare(right)),
    targets: Array.from(targets).sort((left, right) => left.localeCompare(right)),
    inputPaths,
  };
}

function collectRepoAssetPresence(repoPath) {
  if (!repoPath || !isDirectory(repoPath)) {
    return {
      hasRepoAssets: false,
      hasSkills: false,
      hasAgents: false,
      skillCount: 0,
      agentCount: 0,
      skillsPath: path.join(repoPath || '', '.github', 'skills'),
      agentsPath: path.join(repoPath || '', '.github', 'agents'),
      inputPaths: [],
    };
  }

  const skillsPath = path.join(repoPath, '.github', 'skills');
  const agentsPath = path.join(repoPath, '.github', 'agents');
  const skillCount = safeReadDir(skillsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isFile(path.join(skillsPath, entry.name, 'SKILL.md')))
    .length;
  const agentCount = safeReadDir(agentsPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.agent\.md$/i.test(entry.name))
    .length;
  const inputPaths = [];
  if (safeStat(skillsPath)) inputPaths.push(skillsPath);
  if (safeStat(agentsPath)) inputPaths.push(agentsPath);

  return {
    hasRepoAssets: skillCount > 0 || agentCount > 0,
    hasSkills: skillCount > 0,
    hasAgents: agentCount > 0,
    skillCount,
    agentCount,
    skillsPath,
    agentsPath,
    inputPaths,
  };
}

function collectOverlayInfo(elegyHome, repoId) {
  if (!repoId) {
    return {
      path: null,
      exists: false,
      registryPath: null,
      registryExists: false,
      enabledCount: 0,
      disabledCount: 0,
      hasKnownAssets: false,
    };
  }

  const repoStatePath = path.join(resolveElegyHome(elegyHome), 'repo-state', repoId);
  const registryPath = path.join(repoStatePath, 'registry.json');
  const registry = readJsonIfExists(registryPath);
  const sections = ['skills', 'agents', 'mcpProviders'];
  let enabledCount = 0;
  let disabledCount = 0;

  for (const section of sections) {
    const data = registry?.[section];
    if (!data || typeof data !== 'object') {
      continue;
    }
    enabledCount += normalizeArray(data.enabled).length;
    disabledCount += normalizeArray(data.disabled).length;
  }

  return {
    path: repoStatePath,
    exists: isDirectory(repoStatePath),
    registryPath,
    registryExists: isFile(registryPath),
    enabledCount,
    disabledCount,
    hasKnownAssets: enabledCount > 0 || disabledCount > 0,
  };
}

function newestInputAt(paths) {
  const times = normalizeArray(paths)
    .map((inputPath) => safeStat(inputPath))
    .filter(Boolean)
    .map((stat) => stat.mtime.toISOString());
  if (!times.length) {
    return null;
  }
  return times.sort((left, right) => right.localeCompare(left))[0];
}

function readSnapshotInfo(elegyHome, repo) {
  const storage = resolveProjectionStorage({
    elegyHome: resolveElegyHome(elegyHome),
    repoId: repo.repoId,
    repoPath: repo.repoPath,
  });
  const snapshot = repo.snapshot || loadCatalogProjectionSnapshot({
    elegyHome: resolveElegyHome(elegyHome),
    repoId: repo.repoId,
    repoPath: repo.repoPath,
  });
  const snapshotFile = safeStat(storage.snapshotPath);

  return {
    path: storage.snapshotPath,
    exists: Boolean(snapshotFile?.isFile()),
    generatedAt: normalizeString(snapshot?.generatedAt) || null,
    updatedAt: snapshotFile?.mtime?.toISOString() || null,
    warningCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0,
    entryCount: Number.isFinite(snapshot?.stats?.entryCount) ? snapshot.stats.entryCount : null,
    effectiveCount: Number.isFinite(snapshot?.stats?.effectiveCount) ? snapshot.stats.effectiveCount : null,
  };
}

function resolveScanStatus(repoPath, snapshot, inputPaths) {
  if (!repoPath) {
    return 'unresolved';
  }
  if (!isDirectory(repoPath)) {
    return 'missing';
  }
  if (!snapshot.exists) {
    return 'not-scanned';
  }
  const generatedMs = Date.parse(snapshot.generatedAt || snapshot.updatedAt || '');
  const latestInputMs = Date.parse(newestInputAt(inputPaths) || '');
  if (Number.isFinite(generatedMs) && Number.isFinite(latestInputMs) && latestInputMs > generatedMs + 1000) {
    return 'stale';
  }
  return 'ready';
}

function enrichRepo(repo, options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs || options.copilotHome || options.copilotHomeAbs);
  const repoPath = normalizeRepoPath(repo.repoPath) || null;
  const repoKey = repoPath ? getRepoStateKey(repoPath) : null;
  const overlay = collectOverlayInfo(elegyHome, repo.repoId || repoKey?.repoId);
  const snapshot = readSnapshotInfo(elegyHome, {
    repoId: repo.repoId || repoKey?.repoId,
    repoPath,
    snapshot: repo.snapshot,
  });
  const assets = collectRepoAssetPresence(repoPath);
  const hints = collectRepoHints(repoPath);
  const fallbackLabel = repoKey?.repoLabel || (repo.repoId ? `repo-${repo.repoId}` : 'unknown-repo');
  const rawLabel = normalizeString(repo.repoLabel);
  const label = (
    hints.packageName && (!rawLabel || rawLabel === fallbackLabel)
      ? hints.packageName
      : rawLabel
  ) || hints.packageName || fallbackLabel;
  const inputPaths = [
    ...assets.inputPaths,
    ...hints.inputPaths,
    overlay.registryPath,
  ].filter(Boolean);

  return {
    repoId: repo.repoId || repoKey?.repoId || null,
    repoPath,
    repoLabel: label,
    selected: Boolean(repo.selected),
    registered: Boolean(repo.registered),
    sources: Array.from(repo.sources || []).sort((left, right) => left.localeCompare(right)),
    exists: repoPath ? isDirectory(repoPath) : false,
    gitRootPresent: repoPath ? (isDirectory(path.join(repoPath, '.git')) || isFile(path.join(repoPath, '.git'))) : false,
    gitRootKind: detectGitRootKind(repoPath),
    isWorktreeCheckout: detectGitRootKind(repoPath) === 'file',
    scanStatus: resolveScanStatus(repoPath, snapshot, inputPaths),
    lastSeenAt: repo.lastSeenAt || null,
    lastRefreshAt: snapshot.generatedAt || snapshot.updatedAt || null,
    assets: {
      hasRepoAssets: assets.hasRepoAssets || overlay.hasKnownAssets,
      hasSkills: assets.hasSkills,
      hasAgents: assets.hasAgents,
      skillCount: assets.skillCount,
      agentCount: assets.agentCount,
      overlayEnabledCount: overlay.enabledCount,
      overlayDisabledCount: overlay.disabledCount,
      skillsPath: assets.skillsPath,
      agentsPath: assets.agentsPath,
    },
    hints: {
      stacks: hints.stacks,
      frameworks: hints.frameworks,
      languages: hints.languages,
      targets: hints.targets,
    },
    snapshot,
    repoState: overlay,
  };
}

function compareRepos(left, right) {
  if (left.selected !== right.selected) {
    return left.selected ? -1 : 1;
  }
  if (left.registered !== right.registered) {
    return left.registered ? -1 : 1;
  }
  return String(left.repoLabel || left.repoId || '').localeCompare(String(right.repoLabel || right.repoId || ''));
}

function listKnownRepos(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs || options.copilotHome || options.copilotHomeAbs);
  const state = loadRepoInventoryState(elegyHome);
  const repos = new Map();
  const projectionHints = readProjectionHints(elegyHome);
  const workspaceScan = repoDiscovery.resolveWorkspaceScanRoots({
    elegyHome,
    roots: Array.isArray(options.workspaceScanRoots) ? options.workspaceScanRoots : undefined,
  });
  const discoveredRepos = repoDiscovery.discoverReposFromRoots({
    roots: workspaceScan.scanRoots,
  });

  if (options.engineRoot) {
    mergeCandidate(repos, {
      repoPath: options.engineRoot,
      source: 'workspace',
    });
  }

  for (const manualRepo of state.manualRepos) {
    mergeCandidate(repos, {
      repoPath: manualRepo.repoPath,
      repoLabel: manualRepo.repoLabel,
      source: 'manual',
      registered: true,
      lastSeenAt: manualRepo.updatedAt || manualRepo.addedAt,
    });
  }

  const explicitRepoPaths = []
    .concat(options.explicitRepoPaths || [])
    .concat(options.repoPath ? [options.repoPath] : []);
  for (const repoPath of explicitRepoPaths) {
    mergeCandidate(repos, {
      repoPath,
      source: 'explicit',
    });
  }

  if (state.selectedRepoPath || state.selectedRepoId) {
    mergeCandidate(repos, {
      repoPath: state.selectedRepoPath,
      repoId: state.selectedRepoId,
      source: 'selected',
      selected: true,
    });
  }

  for (const sessionRepo of readSessionHints(elegyHome)) {
    mergeCandidate(repos, sessionRepo);
  }

  for (const projection of projectionHints.values()) {
    mergeCandidate(repos, projection);
  }

  for (const repoStateRepo of readRepoStateHints(elegyHome, projectionHints)) {
    mergeCandidate(repos, repoStateRepo);
  }

  for (const discoveredRepo of discoveredRepos.repos) {
    mergeCandidate(repos, {
      repoPath: discoveredRepo.repoPath,
      repoLabel: discoveredRepo.repoLabel,
      source: 'workspace-scan',
    });
  }

  const repoList = Array.from(repos.values())
    .map((repo) => {
      const selected = Boolean(
        repo.selected
        || (state.selectedRepoId && repo.repoId && state.selectedRepoId === repo.repoId)
        || (
          state.selectedRepoPath
          && repo.repoPath
          && normalizePathForKey(state.selectedRepoPath) === normalizePathForKey(repo.repoPath)
        )
      );
      return enrichRepo({
        ...repo,
        selected,
      }, { elegyHome });
    })
    .sort(compareRepos);

  const selectedRepo = repoList.find((repo) => repo.selected) || null;

  return {
    schemaVersion: REPO_INVENTORY_SCHEMA_VERSION,
    storage: {
      path: resolveRepoInventoryPath(elegyHome),
      exists: isFile(resolveRepoInventoryPath(elegyHome)),
    },
    workspaceScan: {
      storage: workspaceScan.storage,
      defaultRoots: workspaceScan.defaultRoots,
      customScanRoots: workspaceScan.customScanRoots,
      scanRoots: workspaceScan.scanRoots,
    },
    selectedRepoId: state.selectedRepoId || selectedRepo?.repoId || null,
    selectedRepoPath: state.selectedRepoPath || selectedRepo?.repoPath || null,
    selectedRepo,
    repos: repoList,
  };
}

function resolveRepoEntry(inventory, selector = {}) {
  const repoPath = normalizeRepoPath(selector.repoPath);
  const repoId = normalizeString(selector.repoId);
  if (!inventory || !Array.isArray(inventory.repos)) {
    return null;
  }
  if (!repoPath && !repoId) {
    return inventory.selectedRepo || null;
  }
  return inventory.repos.find((repo) => (
    (repoId && repo.repoId === repoId)
    || (
      repoPath
      && repo.repoPath
      && normalizePathForKey(repo.repoPath) === normalizePathForKey(repoPath)
    )
  )) || null;
}

function registerRepo(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs || options.copilotHome || options.copilotHomeAbs);
  const repoPath = normalizeRepoPath(options.repoPath);
  if (!repoPath) {
    throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
  }
  if (!isDirectory(repoPath)) {
    throw Object.assign(new Error(`Repo path does not exist: ${repoPath}`), { statusCode: 404 });
  }

  const now = new Date().toISOString();
  const repoKey = getRepoStateKey(repoPath);
  const state = loadRepoInventoryState(elegyHome);
  const manualRepos = state.manualRepos.filter(
    (entry) => normalizePathForKey(entry.repoPath) !== normalizePathForKey(repoPath),
  );
  manualRepos.push({
    repoId: repoKey.repoId,
    repoPath,
    repoLabel: normalizeString(options.repoLabel || options.label) || repoKey.repoLabel,
    addedAt: now,
    updatedAt: now,
  });

  const nextState = {
    ...state,
    manualRepos,
  };
  if (options.select === true) {
    nextState.selectedRepoId = repoKey.repoId;
    nextState.selectedRepoPath = repoPath;
    nextState.selectedAt = now;
  }
  saveRepoInventoryState(elegyHome, nextState);
  const inventory = listKnownRepos({
    elegyHome,
    engineRoot: options.engineRoot,
    explicitRepoPaths: [repoPath],
    workspaceScanRoots: options.workspaceScanRoots,
  });
  return {
    repo: resolveRepoEntry(inventory, { repoPath, repoId: repoKey.repoId }),
    inventory,
  };
}

function unregisterRepo(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs || options.copilotHome || options.copilotHomeAbs);
  const repoPath = normalizeRepoPath(options.repoPath);
  const repoId = normalizeString(options.repoId);
  if (!repoPath && !repoId) {
    throw Object.assign(new Error('repoPath or repoId is required'), { statusCode: 400 });
  }

  const state = loadRepoInventoryState(elegyHome);
  const removed = [];
  const manualRepos = state.manualRepos.filter((entry) => {
    const matchesPath = repoPath && normalizePathForKey(entry.repoPath) === normalizePathForKey(repoPath);
    const matchesId = repoId && entry.repoId === repoId;
    if (matchesPath || matchesId) {
      removed.push(entry);
      return false;
    }
    return true;
  });
  if (!removed.length) {
    throw Object.assign(new Error('Repo is not manually registered'), { statusCode: 404 });
  }

  const removedRepoId = removed[0].repoId;
  const removedRepoPath = removed[0].repoPath;
  const shouldClearSelection = (
    (state.selectedRepoId && removedRepoId && state.selectedRepoId === removedRepoId)
    || (
      state.selectedRepoPath
      && removedRepoPath
      && normalizePathForKey(state.selectedRepoPath) === normalizePathForKey(removedRepoPath)
    )
  );

  const nextState = {
    ...state,
    manualRepos,
    selectedRepoId: shouldClearSelection ? null : state.selectedRepoId,
    selectedRepoPath: shouldClearSelection ? null : state.selectedRepoPath,
    selectedAt: shouldClearSelection ? null : state.selectedAt,
  };
  saveRepoInventoryState(elegyHome, nextState);
  const inventory = listKnownRepos({
    elegyHome,
    engineRoot: options.engineRoot,
    explicitRepoPaths: removedRepoPath ? [removedRepoPath] : [],
    workspaceScanRoots: options.workspaceScanRoots,
  });
  return {
    removed: {
      repoId: removedRepoId,
      repoPath: removedRepoPath,
    },
    selectionCleared: shouldClearSelection,
    inventory,
  };
}

function selectRepo(options = {}) {
  const elegyHome = resolveElegyHome(options.elegyHome || options.elegyHomeAbs);
  const state = loadRepoInventoryState(elegyHome);

  if (options.clear === true) {
    saveRepoInventoryState(elegyHome, {
      ...state,
      selectedRepoId: null,
      selectedRepoPath: null,
      selectedAt: null,
    });
    return {
      repo: null,
      inventory: listKnownRepos({
        elegyHome,
        engineRoot: options.engineRoot,
        workspaceScanRoots: options.workspaceScanRoots,
      }),
    };
  }

  const inventory = listKnownRepos({
    elegyHome,
    engineRoot: options.engineRoot,
    explicitRepoPaths: options.repoPath ? [options.repoPath] : [],
    workspaceScanRoots: options.workspaceScanRoots,
  });
  const repo = resolveRepoEntry(inventory, {
    repoId: options.repoId,
    repoPath: options.repoPath,
  });
  if (!repo) {
    throw Object.assign(new Error('Unknown repo selection'), { statusCode: 404 });
  }

  saveRepoInventoryState(elegyHome, {
    ...state,
    selectedRepoId: repo.repoId,
    selectedRepoPath: repo.repoPath,
    selectedAt: new Date().toISOString(),
  });

  const refreshedInventory = listKnownRepos({
    elegyHome,
    engineRoot: options.engineRoot,
    explicitRepoPaths: repo.repoPath ? [repo.repoPath] : [],
    workspaceScanRoots: options.workspaceScanRoots,
  });
  return {
    repo: resolveRepoEntry(refreshedInventory, {
      repoId: repo.repoId,
      repoPath: repo.repoPath,
    }),
    inventory: refreshedInventory,
  };
}

/**
 * Extract the canonical remote (owner/repo) from the git config at the given repo path.
 * Parses .git/config directly — does NOT shell out to git.
 * Returns null if no remote origin or URL is not parseable as GitHub/GitLab style.
 * @param {string} repoPath
 * @returns {string|null}
 */
function extractCanonicalRemote(repoPath) {
  const resolved = normalizeRepoPath(repoPath);
  if (!resolved) {
    return null;
  }
  const gitConfigPath = path.join(resolved, '.git', 'config');
  let content;
  try {
    content = fs.readFileSync(gitConfigPath, 'utf8');
  } catch {
    return null;
  }

  // Find [remote "origin"] section and extract url line
  const lines = content.split(/\r?\n/);
  let inOriginSection = false;
  let originUrl = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[remote\s+"origin"\]$/i.test(trimmed)) {
      inOriginSection = true;
      continue;
    }
    if (inOriginSection && /^\[/.test(trimmed)) {
      // entered a new section, stop
      break;
    }
    if (inOriginSection) {
      const urlMatch = trimmed.match(/^url\s*=\s*(.+)$/i);
      if (urlMatch) {
        originUrl = urlMatch[1].trim();
        break;
      }
    }
  }

  if (!originUrl) {
    return null;
  }

  // Normalize SSH: git@github.com:owner/repo.git => owner/repo
  const sshMatch = originUrl.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    return normalizeSuffix(sshMatch[1]);
  }

  // Normalize HTTPS: https://github.com/owner/repo.git => owner/repo
  try {
    const parsed = new URL(originUrl);
    const pathname = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (pathname) {
      return normalizeSuffix(pathname);
    }
  } catch {
    // not a valid URL
  }

  return null;
}

function normalizeSuffix(raw) {
  const cleaned = raw.replace(/\.git$/, '').replace(/\/+$/, '').replace(/^\/+/, '');
  // Must look like owner/repo (at least two segments)
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length >= 2) {
    return segments.slice(0, 2).join('/');
  }
  return null;
}

/**
 * Build a Project-shaped view object from a manual repo entry.
 * Placeholder fields (sessionCount, activeSessionCount, installedAssetSummary)
 * are set to zero/empty and expected to be populated by the caller.
 * @param {object} entry — normalized manual repo entry
 * @returns {object}
 */
function getProjectView(entry) {
  return {
    projectId: entry.repoId,
    repoId: entry.repoId,
    repoPath: entry.repoPath,
    repoLabel: entry.repoLabel,
    canonicalRemote: entry.canonicalRemote || null,
    pinned: entry.pinned || false,
    lastActivityMs: entry.lastActivityMs || null,
    sessionCount: 0,
    activeSessionCount: 0,
    installedAssetSummary: { agents: 0, skills: 0 },
    createdAt: entry.addedAt,
    updatedAt: entry.updatedAt,
  };
}

/**
 * Update allowed project-level fields on a manual repo entry.
 * Allowed fields: pinned, lastActivityMs, canonicalRemote.
 * @param {string} elegyHome
 * @param {string} repoId
 * @param {object} fields
 * @returns {object|null} — updated entry, or null if repoId not found
 */
function updateProjectFields(elegyHome, repoId, fields) {
  const resolved = resolveElegyHome(elegyHome);
  const state = loadRepoInventoryState(resolved);
  const targetId = normalizeString(repoId);
  if (!targetId) {
    return null;
  }

  const index = state.manualRepos.findIndex((entry) => entry.repoId === targetId);
  if (index === -1) {
    return null;
  }

  const entry = state.manualRepos[index];
  const allowedFields = {};
  if (fields && typeof fields === 'object') {
    if (typeof fields.pinned === 'boolean') {
      allowedFields.pinned = fields.pinned;
    }
    if (typeof fields.lastActivityMs === 'number' && Number.isFinite(fields.lastActivityMs)) {
      allowedFields.lastActivityMs = fields.lastActivityMs;
    } else if (fields.lastActivityMs === null) {
      allowedFields.lastActivityMs = null;
    }
    if (typeof fields.canonicalRemote === 'string') {
      allowedFields.canonicalRemote = fields.canonicalRemote.trim() || null;
    } else if (fields.canonicalRemote === null) {
      allowedFields.canonicalRemote = null;
    }
  }

  const updated = {
    ...entry,
    ...allowedFields,
    updatedAt: new Date().toISOString(),
  };
  state.manualRepos[index] = updated;
  saveRepoInventoryState(resolved, state);

  // Re-load to get the fully normalized entry
  const refreshed = loadRepoInventoryState(resolved);
  return refreshed.manualRepos.find((e) => e.repoId === targetId) || updated;
}

module.exports = {
  REPO_INVENTORY_SCHEMA_VERSION,
  resolveRepoInventoryPath,
  loadRepoInventoryState,
  saveRepoInventoryState,
  listKnownRepos,
  resolveRepoEntry,
  registerRepo,
  unregisterRepo,
  selectRepo,
  extractCanonicalRemote,
  getProjectView,
  updateProjectFields,
};
