'use strict';

const crypto = require('crypto');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  applyActivationToBundles,
  buildRoutingPolicySnapshot,
  resolveCatalogActivationState,
} = require('../lib/catalogActivationState');
const catalogProjectionLib = require('../lib/catalogProjectionService');
const catalogMutationLib = require('../lib/catalogMutationService');
const externalSourcesLib = require('../lib/externalSources');
const { GLOBAL_HARNESSES, humanizeHarnessId, normalizeHarnessId } = require('../lib/harnessCatalog');
const providerCatalogLib = require('../lib/providerCatalog');
const repoInventoryLib = require('../lib/repoInventoryService');
const repoDiscoveryLib = require('../lib/repoDiscoveryService');
const {
  appendCatalogAuditEvent,
  buildAssetAuditAnalytics,
  readCatalogAuditEvents: readCatalogAuditEventsFromLib,
  recordProjectionLifecycleEvents,
  resolveCatalogAuditLogPath,
} = require('../lib/catalogAuditAnalytics');
const {
  normalizeSearchQuery,
  recordSkillSearchSelection,
  sanitizeQueryForTelemetry,
  searchSkills,
} = require('../lib/skillSearchService');
const { sendJson: defaultSendJson, sendText: defaultSendText, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const installLedgerLib = require('../lib/installLedger');
const { installSurfaces: defaultInstallSurfaces } = require('../lib/installSurfaces');
const catalogPolicyService = require('../lib/catalogPolicyService');

const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const INSTALL_SURFACE_HARNESSES = new Set(['codex', 'opencode', 'antigravity']);
const HARNESS_INSTALLABLE_KINDS = Object.freeze({
  copilot: new Set(['agent', 'skill']),
  codex: new Set(['agent', 'skill', 'mcp']),
  opencode: new Set(['agent', 'skill', 'mcp']),
  antigravity: new Set(['skill']),
  'gemini-cli': new Set(['mcp']),
  host: new Set(['cli-tool']),
});
const GLOBAL_CATALOG_KEY_FEATURES = Object.freeze({
  'skill::skill-discovery': {
    central: true,
    keyFeature: true,
    keyFeatureLabel: 'Retrieval',
    keyFeatureOrder: 0,
    scopeKinds: ['global', 'harness', 'repo'],
  },
  'skill::stack-detector': {
    central: true,
    keyFeature: true,
    keyFeatureLabel: 'Retrieval',
    keyFeatureOrder: 1,
    scopeKinds: ['global', 'harness', 'repo'],
  },
});

function normalizeComparablePathForPrefix(inputPath) {
  const resolved = path.resolve(String(inputPath || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathWithinRoot(rootAbs, candidateAbs) {
  const root = normalizeComparablePathForPrefix(rootAbs);
  const candidate = normalizeComparablePathForPrefix(candidateAbs);
  if (!root || !candidate) {
    return false;
  }
  if (candidate === root) {
    return true;
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

function safeResolveUnder(baseAbs, relPath, pathImpl = path) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw Object.assign(new Error('path must be a non-empty string'), { statusCode: 400 });
  }
  if (pathImpl.isAbsolute(relPath)) {
    throw Object.assign(new Error('path must be relative'), { statusCode: 400 });
  }
  const base = pathImpl.resolve(baseAbs);
  const abs = pathImpl.resolve(base, relPath);
  if (!isPathWithinRoot(base, abs)) {
    throw Object.assign(new Error('path escapes base'), { statusCode: 400 });
  }
  return abs;
}

function safeReadText(absPath, maxBytes = 512 * 1024, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    const bytesToRead = Math.min(stat.size, Math.max(1024, maxBytes));
    const fd = fsImpl.openSync(absPath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const bytesRead = fsImpl.readSync(fd, buffer, 0, bytesToRead, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      fsImpl.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function safeStat(absPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(absPath);
  } catch {
    return null;
  }
}

function safeReadDir(absPath, options, fsImpl = fs) {
  try {
    return fsImpl.readdirSync(absPath, options);
  } catch {
    return [];
  }
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

function clampInteger(value, defaultValue, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueStrings(values) {
  return Array.from(new Set(normalizeArray(values).map((entry) => entry.toLowerCase())));
}

function createAuditEventId(cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveAuditLogPath(copilotHomeAbs, pathImpl = path) {
  return pathImpl.join(path.resolve(copilotHomeAbs), 'catalog', 'audit', 'events.jsonl');
}

function appendAuditEvent(auditLogPath, event, deps) {
  const { fs: fsImpl, path: pathImpl } = deps;
  fsImpl.mkdirSync(pathImpl.dirname(auditLogPath), { recursive: true });
  fsImpl.appendFileSync(auditLogPath, JSON.stringify(event) + '\n', 'utf8');
}

function tailJsonlLines(filePath, limit, fsImpl = fs) {
  const stat = safeStat(filePath, fsImpl);
  if (!stat || !stat.isFile() || stat.size <= 0) {
    return [];
  }

  const fd = fsImpl.openSync(filePath, 'r');
  try {
    const chunkSize = 64 * 1024;
    const chunks = [];
    let bytesReadTotal = 0;
    let position = stat.size;
    let newlineCount = 0;
    const targetNewlines = Math.max(1, limit) + 5;

    while (position > 0 && newlineCount < targetNewlines && bytesReadTotal < MAX_AUDIT_BYTES) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      fsImpl.readSync(fd, buffer, 0, readSize, position);
      chunks.unshift(buffer);
      bytesReadTotal += readSize;

      for (let i = 0; i < buffer.length; i += 1) {
        if (buffer[i] === 10) {
          newlineCount += 1;
        }
      }
    }

    const text = Buffer.concat(chunks).toString('utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-limit);
  } finally {
    try {
      fsImpl.closeSync(fd);
    } catch {
      // ignore cleanup failures
    }
  }
}

function readAuditEvents(auditLogPath, limit, fsImpl = fs) {
  return tailJsonlLines(auditLogPath, limit, fsImpl)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function describeFile(absPath, fsImpl = fs) {
  if (!absPath) {
    return { path: null, exists: false, size: null, updatedAt: null };
  }
  const stat = safeStat(absPath, fsImpl);
  return {
    path: absPath,
    exists: Boolean(stat),
    size: stat ? stat.size : null,
    updatedAt: stat?.mtime?.toISOString() || null,
  };
}

function writeJsonAtomic(absPath, value, fsImpl = fs, pathImpl = path) {
  const dirPath = pathImpl.dirname(absPath);
  const tempPath = pathImpl.join(
    dirPath,
    `.${pathImpl.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fsImpl.mkdirSync(dirPath, { recursive: true });
  fsImpl.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fsImpl.renameSync(tempPath, absPath);
}

function normalizeProviderAction(value) {
  const normalized = normalizeString(value).toLowerCase() || 'install';
  if (normalized !== 'install' && normalized !== 'update') {
    throw Object.assign(new Error('action must be "install" or "update"'), { statusCode: 400 });
  }
  return normalized;
}

function resolveManagedImportProvider(providerCatalog, providerId) {
  const provider = (Array.isArray(providerCatalog?.providers) ? providerCatalog.providers : [])
    .find((entry) => normalizeString(entry?.id) === providerId);

  if (!provider) {
    throw Object.assign(new Error(`Unknown providerId: ${providerId}`), { statusCode: 404 });
  }

  if (normalizeString(provider.installStrategy) !== 'managed-import') {
    throw Object.assign(new Error(`Provider ${providerId} does not support managed installs`), { statusCode: 400 });
  }

  const namespace = normalizeString(provider?.assetLayout?.namespace);
  const owner = normalizeString(provider?.source?.owner);
  const repo = normalizeString(provider?.source?.repo);
  if (!namespace || !owner || !repo) {
    throw Object.assign(new Error(`Provider ${providerId} is missing managed install metadata`), { statusCode: 400 });
  }

  return {
    provider,
    namespace,
    marketplaceRef: `${owner}/${repo}`,
    pluginRef: `${namespace}@${providerId}`,
  };
}

function runProviderCommand(deps, command, args, timeoutMs) {
  if (typeof deps.executeProviderCommand === 'function') {
    return deps.executeProviderCommand({ command, args, timeoutMs });
  }

  const normalizedCommand = normalizeString(command);
  const platform = normalizeString(deps.process?.platform) || process.platform;
  const commandInvocation =
    platform === 'win32' && /\.(cmd|bat)$/i.test(normalizedCommand)
      ? {
          command: normalizeString(deps.process?.env?.ComSpec) || 'cmd.exe',
          args: ['/d', '/s', '/c', `"${normalizedCommand}"`, ...args],
        }
      : {
          command: normalizedCommand,
          args,
        };

  return new Promise((resolve, reject) => {
    deps.childProcess.execFile(
      commandInvocation.command,
      commandInvocation.args,
      {
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

function readDesktopCliManagerStateFromEnv(sourceEnv) {
  const raw = normalizeString(sourceEnv?.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function resolveManagedCliCommandFromRuntimeState(deps) {
  const state = readDesktopCliManagerStateFromEnv(deps.process?.env);
  const cliPath = normalizeString(state?.cliPath);
  if (state?.approved === true && cliPath) {
    return {
      cliPath,
      state,
    };
  }

  const blockedReason = normalizeString(state?.reason) || 'managed_cli_missing';
  throw Object.assign(
    new Error(`Managed Copilot CLI is unavailable for provider installs (${blockedReason}).`),
    { statusCode: 503 },
  );
}

async function executeManagedProviderInstall(deps, providerInstall, action, cliCommand) {
  const steps = [
    {
      id: 'marketplace-add',
      args: ['plugin', 'marketplace', 'add', providerInstall.marketplaceRef],
    },
    {
      id: action === 'update' ? 'plugin-update' : 'plugin-install',
      args: ['plugin', action === 'update' ? 'update' : 'install', providerInstall.pluginRef],
    },
  ];
  const results = [];

  for (const step of steps) {
    try {
      const output = await runProviderCommand(deps, cliCommand, step.args, 120000);
      results.push({
        step: step.id,
        command: cliCommand,
        args: step.args,
        ok: true,
        stdout: String(output.stdout || ''),
        stderr: String(output.stderr || ''),
      });
    } catch (error) {
      results.push({
        step: step.id,
        command: cliCommand,
        args: step.args,
        ok: false,
        stdout: String(error?.stdout || ''),
        stderr: String(error?.stderr || ''),
        error: String(error?.message || error),
      });
      throw Object.assign(new Error(`Provider command failed: ${step.id}`), {
        statusCode: error?.code === 'ENOENT' ? 503 : 502,
        commandResults: results,
      });
    }
  }

  return results;
}

function persistProviderInstallState(deps, copilotHomeAbs, providerId, entry) {
  const { statePath, state } = deps.providerCatalog.loadProviderInstallState(copilotHomeAbs);
  const nextState = {
    schemaVersion: Number(state?.schemaVersion) || 1,
    providers: {
      ...(state?.providers && typeof state.providers === 'object' ? state.providers : {}),
      [providerId]: entry,
    },
  };
  writeJsonAtomic(statePath, nextState, deps.fs, deps.path);
  return nextState.providers[providerId];
}

function normalizeRepoSelector(searchParams, body) {
  const source = body && typeof body === 'object' ? body : {};
  const repoPath = normalizeString(source.repoPath || searchParams?.get('repoPath'));
  const repoId = normalizeString(source.repoId || searchParams?.get('repoId'));
  return {
    ...(repoPath ? { repoPath } : {}),
    ...(repoId ? { repoId } : {}),
  };
}

function buildCatalogOptions(ctx, selector) {
  return {
    engineRoot: ctx.engineRoot,
    copilotHome: ctx.copilotHomeAbs,
    ...(selector && typeof selector === 'object' ? selector : {}),
  };
}

function buildActivationStateForProjection(ctx, projectionContext) {
  const repoPath = projectionContext?.snapshot?.repoContext?.repoPath || projectionContext?.storage?.repoContext?.repoPath || null;
  if (!projectionContext?.snapshot) {
    return null;
  }
  return resolveCatalogActivationState({
    snapshot: projectionContext.snapshot,
    copilotHome: ctx.copilotHomeAbs,
    repoPath,
  });
}

function buildRoutingPolicyForProjection(ctx, projectionContext, activationState = null) {
  const repoPath = projectionContext?.snapshot?.repoContext?.repoPath || projectionContext?.storage?.repoContext?.repoPath || null;
  if (!projectionContext?.snapshot) {
    return null;
  }
  return buildRoutingPolicySnapshot({
    snapshot: projectionContext.snapshot,
    activationState: activationState || buildActivationStateForProjection(ctx, projectionContext),
    copilotHome: ctx.copilotHomeAbs,
    repoPath,
  });
}

function createCatalogRuntimeState() {
  return {
    status: 'idle',
    refreshCount: 0,
    lastRequestedAt: null,
    lastCompletedAt: null,
    lastSuccessfulAt: null,
    lastDurationMs: null,
    lastReason: null,
    lastError: null,
    lastSnapshotPath: null,
  };
}

function markRuntimeRebuildStart(runtimeState, reason) {
  runtimeState.status = 'running';
  runtimeState.lastRequestedAt = new Date().toISOString();
  runtimeState.lastReason = reason || 'manual';
  runtimeState.lastError = null;
}

function markRuntimeRebuildSuccess(runtimeState, durationMs, snapshotPath, reason) {
  runtimeState.status = 'ready';
  runtimeState.refreshCount += 1;
  runtimeState.lastCompletedAt = new Date().toISOString();
  runtimeState.lastSuccessfulAt = runtimeState.lastCompletedAt;
  runtimeState.lastDurationMs = durationMs;
  runtimeState.lastSnapshotPath = snapshotPath || null;
  runtimeState.lastReason = reason || runtimeState.lastReason;
  runtimeState.lastError = null;
}

function markRuntimeRebuildFailure(runtimeState, durationMs, error, reason) {
  runtimeState.status = 'error';
  runtimeState.lastCompletedAt = new Date().toISOString();
  runtimeState.lastDurationMs = durationMs;
  runtimeState.lastReason = reason || runtimeState.lastReason;
  runtimeState.lastError = String(error && error.message ? error.message : error);
}

function buildProjectionContext(ctx, deps, selector = {}, options = {}) {
  const catalogOptions = buildCatalogOptions(ctx, selector);
  const storage = deps.catalogProjection.resolveProjectionStorage(catalogOptions);
  const persistedSnapshot = deps.catalogProjection.loadCatalogProjectionSnapshot(catalogOptions);
  const stalePersistedSnapshot = deps.catalogProjection.isCatalogProjectionSnapshotStale(
    persistedSnapshot,
    ctx.changeTracker ? ctx.changeTracker.get() : null,
  );
  const shouldBuildFallback = options.allowFallback !== false && (!persistedSnapshot || stalePersistedSnapshot);
  let snapshot = stalePersistedSnapshot ? null : persistedSnapshot;
  let readMode = persistedSnapshot
    ? (stalePersistedSnapshot ? 'stale-persisted-snapshot' : 'persisted-snapshot')
    : 'missing';
  let buildError = null;

  if (shouldBuildFallback) {
    try {
      snapshot = rebuildProjection(
        ctx,
        deps,
        selector,
        stalePersistedSnapshot ? 'catalog_change_tracker_rebuild' : 'catalog_read_fallback',
      );
      readMode = stalePersistedSnapshot ? 'change-tracker-rebuild' : 'filesystem-fallback';
    } catch (error) {
      buildError = error;
    }
  }

  return {
    catalogOptions,
    storage,
    persistedSnapshot,
    snapshot,
    readMode,
    buildError,
  };
}

function summarizeWarnings(snapshot) {
  const warnings = Array.isArray(snapshot?.warnings) ? snapshot.warnings : [];
  return {
    count: warnings.length,
    items: warnings,
  };
}

function buildFreshness(snapshot, files) {
  if (!snapshot) {
    return {
      status: 'missing',
      ageMs: null,
      latestInputAt: null,
      reasons: ['snapshot_missing'],
    };
  }

  const generatedMs = Date.parse(snapshot.generatedAt || '');
  const now = Date.now();
  const inputTimes = Object.values(files || {})
    .map((entry) => Date.parse(entry && entry.updatedAt ? entry.updatedAt : ''))
    .filter((value) => Number.isFinite(value));
  const latestInputMs = inputTimes.length > 0 ? Math.max(...inputTimes) : null;
  const reasons = [];

  if (Number.isFinite(latestInputMs) && Number.isFinite(generatedMs) && latestInputMs > generatedMs + 1000) {
    reasons.push('inputs_newer_than_snapshot');
  }

  return {
    status: reasons.length > 0 ? 'stale' : 'fresh',
    ageMs: Number.isFinite(generatedMs) ? Math.max(0, now - generatedMs) : null,
    latestInputAt: Number.isFinite(latestInputMs) ? new Date(latestInputMs).toISOString() : null,
    reasons,
  };
}

function buildSnapshotEnvelope(snapshot, projectionContext, deps, runtimeState, extra = {}) {
  const externalSourcesEngineRoot = snapshot?.engineRoot || deps.engineRoot || extra.engineRoot || process.cwd();
  const externalSourcesCopilotHome = projectionContext?.storage?.copilotHome || snapshot?.copilotHome;
  const externalSourcesSummary = deps.externalSources.listSources({
    engineRoot: externalSourcesEngineRoot,
    copilotHome: externalSourcesCopilotHome,
  });
  const inputFiles = {
    manifest: describeFile(snapshot?.inputs?.manifestPath, deps.fs),
    metadataIndex: describeFile(snapshot?.inputs?.metadataIndexPath, deps.fs),
    registry: describeFile(snapshot?.inputs?.registryPath, deps.fs),
    providerCatalog: describeFile(snapshot?.inputs?.providerCatalogPath, deps.fs),
    providerState: describeFile(snapshot?.inputs?.providerStatePath, deps.fs),
    externalSourcesCatalog: describeFile(externalSourcesSummary.catalogPath, deps.fs),
    externalSourcesUserSources: describeFile(externalSourcesSummary.userSourcesPath, deps.fs),
    externalSourcesState: describeFile(externalSourcesSummary.statePath, deps.fs),
    snapshot: describeFile(projectionContext.storage.snapshotPath, deps.fs),
  };
  const warnings = summarizeWarnings(snapshot);

  return {
    schemaVersion: snapshot?.schemaVersion || null,
    generatedAt: snapshot?.generatedAt || null,
    readMode: projectionContext.readMode,
    repoContext: snapshot?.repoContext || projectionContext.storage.repoContext || null,
    providers: Array.isArray(snapshot?.providers) ? snapshot.providers : [],
    externalSources: Array.isArray(externalSourcesSummary.sources) ? externalSourcesSummary.sources : [],
    storage: {
      catalogRoot: projectionContext.storage.catalogRoot,
      snapshotPath: projectionContext.storage.snapshotPath,
      snapshotExists: inputFiles.snapshot.exists,
    },
    stats: snapshot?.stats || null,
    warnings,
    inputs: inputFiles,
    freshness: buildFreshness(snapshot, {
      manifest: inputFiles.manifest,
      metadataIndex: inputFiles.metadataIndex,
      registry: inputFiles.registry,
      providerCatalog: inputFiles.providerCatalog,
      providerState: inputFiles.providerState,
    }),
    rebuild: {
      ...runtimeState,
    },
    ...extra,
  };
}

function readJsonIfExists(absPath, fsImpl = fs) {
  try {
    const stat = fsImpl.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fsImpl.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeDisplayText(value, fallback = 'Unknown') {
  const normalized = normalizeString(value);
  return normalized || fallback;
}

function humanizeCatalogKey(value) {
  return normalizeDisplayText(String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase()), 'Unknown');
}

function normalizeCatalogItemKind(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'mcp-server') {
    return 'mcp';
  }
  if (normalized === 'cli-tool') {
    return 'cli-tool';
  }
  return normalized;
}

function humanizeItemKind(kind) {
  switch (normalizeCatalogItemKind(kind)) {
    case 'skill':
      return 'Skill';
    case 'agent':
      return 'Agent';
    case 'mcp':
      return 'MCP';
    case 'cli-tool':
      return 'CLI Tool';
    default:
      return normalizeDisplayText(kind, 'Item');
  }
}

function normalizeDescription(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeScopeKinds(...values) {
  return Array.from(new Set(values.flatMap((value) => normalizeArray(value).map((entry) => normalizeString(entry).toLowerCase())).filter(Boolean)));
}

function buildConceptualCatalogKey(kind, rawValue) {
  const normalizedKind = normalizeCatalogItemKind(kind);
  const value = normalizeString(rawValue).replace(/\\/g, '/');
  if (!value) {
    return '';
  }
  const baseName = value.split('/').filter(Boolean).pop() || value;
  if (normalizedKind === 'agent') {
    return baseName
      .replace(/\.agent\.md$/i, '')
      .replace(/\.toml$/i, '')
      .replace(/\.md$/i, '');
  }
  if (normalizedKind === 'mcp') {
    return baseName;
  }
  return baseName;
}

function buildManifestConceptualCatalogKey(asset) {
  const kind = normalizeManifestAssetItemKind(asset?.type);
  const destination = normalizeString(asset?.destination).replace(/\\/g, '/');
  const source = normalizeString(asset?.source).replace(/\\/g, '/');
  return buildConceptualCatalogKey(kind, destination || source || normalizeString(asset?.id));
}

function buildGlobalCatalogFeatureKey(kind, conceptualKey) {
  return `${normalizeCatalogItemKind(kind)}::${normalizeString(conceptualKey).toLowerCase()}`;
}

function getGlobalCatalogFeatureMetadata(kind, conceptualKey) {
  return GLOBAL_CATALOG_KEY_FEATURES[buildGlobalCatalogFeatureKey(kind, conceptualKey)] || null;
}

function getHarnessSortIndex(harnessId) {
  const index = GLOBAL_HARNESSES.findIndex((entry) => entry.id === harnessId);
  return index >= 0 ? index : GLOBAL_HARNESSES.length;
}

function getSupportedHarnessCountForKind(kind) {
  const normalizedKind = normalizeCatalogItemKind(kind);
  return GLOBAL_HARNESSES.filter((harness) => HARNESS_INSTALLABLE_KINDS[harness.id]?.has(normalizedKind)).length;
}

function resolveHarnessSyncStatus(state) {
  if (!state.supported) {
    return 'unsupported';
  }
  if (state.expected) {
    return state.installed ? 'synced' : 'missing';
  }
  if (state.metadata?.actionKind === 'external-source') {
    if (state.active) {
      return 'active';
    }
    if (state.installed) {
      return 'installed';
    }
    return 'available';
  }
  if (state.installed) {
    return 'installed';
  }
  return 'available';
}

function sortHarnessStates(states) {
  return [...(Array.isArray(states) ? states : [])].sort((left, right) => {
    const harnessCompare = getHarnessSortIndex(normalizeHarnessId(left?.harnessId)) - getHarnessSortIndex(normalizeHarnessId(right?.harnessId));
    if (harnessCompare !== 0) {
      return harnessCompare;
    }
    return String(left?.title || '').localeCompare(String(right?.title || ''));
  });
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
}

function normalizeManifestAssetItemKind(type) {
  const normalized = normalizeString(type).toLowerCase();
  if (normalized === 'mcp-server') {
    return 'mcp';
  }
  return normalized;
}

function isManifestAssetSupportedForGlobalInventory(type) {
  const normalized = normalizeManifestAssetItemKind(type);
  return normalized === 'skill' || normalized === 'agent' || normalized === 'mcp';
}

function listHarnessRows(ctx) {
  return GLOBAL_HARNESSES.map((harness) => ({
    harnessId: harness.id,
    title: harness.title,
    homePath: normalizeString(ctx[harness.homeKey]) || null,
    skillsHomePath: harness.skillsHomeKey ? normalizeString(ctx[harness.skillsHomeKey]) || null : null,
    supportsMcp: harness.supportsMcp === true,
  }));
}

function detectHarnessInstallPath(ctx, harnessId, kind, paths) {
  const harness = GLOBAL_HARNESSES.find((entry) => entry.id === harnessId);
  if (!harness) {
    return null;
  }
  const homePath = normalizeString(ctx[harness.homeKey]);
  const skillsHomePath = harness.skillsHomeKey ? normalizeString(ctx[harness.skillsHomeKey]) : '';
  const candidates = normalizeStringList(paths);

  for (const candidatePath of candidates) {
    const normalizedCandidate = path.resolve(candidatePath);
    if (normalizeCatalogItemKind(kind) === 'skill' && skillsHomePath && isPathWithinRoot(skillsHomePath, normalizedCandidate)) {
      return normalizedCandidate;
    }
    if (homePath && isPathWithinRoot(homePath, normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

function buildHarnessState({
  ctx,
  harnessId,
  kind,
  installedPaths = [],
  installed,
  active,
  installPath,
  expected = false,
  canInstall = false,
  canActivate = false,
  canDeactivate = false,
  canSync = false,
  detail = null,
  metadata = null,
}) {
  const resolvedInstallPath = typeof installPath === 'string' || installPath === null
    ? normalizeString(installPath) || null
    : detectHarnessInstallPath(ctx, harnessId, kind, installedPaths);
  const supported = HARNESS_INSTALLABLE_KINDS[harnessId]?.has(normalizeCatalogItemKind(kind)) === true;
  const resolvedInstalled = typeof installed === 'boolean' ? installed : Boolean(resolvedInstallPath);
  const resolvedActive = typeof active === 'boolean' ? active : resolvedInstalled;
  return {
    harnessId,
    title: humanizeHarnessId(harnessId),
    supported,
    expected: supported && expected === true,
    installed: resolvedInstalled,
    active: resolvedActive,
    installPath: resolvedInstallPath,
    actions: {
      canInstall: supported && canInstall,
      canActivate: supported && canActivate,
      canDeactivate: supported && canDeactivate,
      canSync: supported && canSync,
    },
    detail,
    metadata,
    syncStatus: null,
  };
}

function buildSourceActionMetadata(kind, sourceEntry, selectedEntry) {
  const metadata = {};
  const normalizedKind = normalizeCatalogItemKind(kind);
  const sourcePath = normalizeString(sourceEntry?.contentPath);
  if (sourcePath) {
    metadata.contentSource = 'projection-entry';
    metadata.contentPath = sourcePath;
  }
  const viewPath = normalizeString(selectedEntry?.metadata?.viewPath);
  if (viewPath) {
    metadata.viewPath = viewPath;
  }
  if (normalizeString(sourceEntry?.layer) === 'source') {
    metadata.sourceLayer = sourceEntry.layer;
  }
  if (normalizedKind === 'skill' && normalizeString(selectedEntry?.installState?.loadMode)) {
    metadata.loadMode = selectedEntry.installState.loadMode;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function listManifestPatternMatches(engineRoot, sourceGlob, patternType, fsImpl = fs, pathImpl = path) {
  const normalized = String(sourceGlob || '').trim().replace(/\\/g, '/');
  if (!normalized || !normalized.includes('*')) {
    return normalized ? [normalized] : [];
  }

  const dirRel = path.posix.dirname(normalized);
  const basePattern = path.posix.basename(normalized);
  const matcher = new RegExp(`^${basePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`);
  const dirAbs = pathImpl.join(path.resolve(engineRoot), dirRel);
  let entries = [];
  try {
    entries = fsImpl.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => matcher.test(entry.name))
    .filter((entry) => {
      const normalizedType = normalizeString(patternType).toLowerCase();
      if (normalizedType === 'skill') {
        return typeof entry.isDirectory === 'function' ? entry.isDirectory() : false;
      }
      if (normalizedType === 'agent' || normalizedType === 'instructions') {
        return typeof entry.isFile === 'function' ? entry.isFile() : false;
      }
      return true;
    })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => path.posix.join(dirRel, entry.name));
}

function expandManifestAssets(engineRoot, manifestDocument) {
  const explicitAssets = Array.isArray(manifestDocument?.assets) ? manifestDocument.assets.filter(Boolean) : [];
  const byDestination = new Set(
    explicitAssets
      .map((asset) => normalizeString(asset?.destination).replace(/\\/g, '/'))
      .filter(Boolean)
  );
  const expandedAssets = [...explicitAssets];

  for (const pattern of Array.isArray(manifestDocument?.sourcePatterns) ? manifestDocument.sourcePatterns : []) {
    if (!pattern || typeof pattern !== 'object') {
      continue;
    }
    const destinationDir = normalizeString(pattern.destinationDir).replace(/\\/g, '/').replace(/\/$/, '');
    for (const sourceRel of listManifestPatternMatches(engineRoot, pattern.sourceGlob, pattern.type)) {
      const sourceBaseName = path.posix.basename(sourceRel);
      const destination = destinationDir ? path.posix.join(destinationDir, sourceBaseName) : sourceBaseName;
      if (byDestination.has(destination)) {
        continue;
      }
      byDestination.add(destination);
      expandedAssets.push({
        id: `${normalizeString(pattern.type)}-${sourceBaseName.replace(/\.[^.]+$/g, '')}`.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase(),
        type: pattern.type,
        source: sourceRel,
        destination,
      });
    }
  }

  return expandedAssets;
}

function buildProjectionInventory(summary, ctx, engineManifestAssetIds = new Set()) {
  const effectiveAssets = Array.isArray(summary?.effectiveAssets) ? summary.effectiveAssets : [];
  const grouped = {
    skill: [],
    agent: [],
    mcp: [],
  };

  for (const effectiveAsset of effectiveAssets) {
    if (!effectiveAsset || typeof effectiveAsset !== 'object') {
      continue;
    }
    const kind = normalizeCatalogItemKind(effectiveAsset.kind);
    if (kind !== 'skill' && kind !== 'agent') {
      continue;
    }

    const selectedEntry = effectiveAsset.selectedEntry && typeof effectiveAsset.selectedEntry === 'object'
      ? effectiveAsset.selectedEntry
      : {};
    const installState = effectiveAsset.installState && typeof effectiveAsset.installState === 'object'
      ? effectiveAsset.installState
      : {};
    const installedPaths = installState.installedPaths && typeof installState.installedPaths === 'object'
      ? Object.values(installState.installedPaths).filter((value) => typeof value === 'string')
      : [];
    const sourceActionMetadata = buildSourceActionMetadata(kind, selectedEntry, selectedEntry);

    grouped[kind].push({
      itemId: effectiveAsset.assetId,
      conceptualKey: buildConceptualCatalogKey(kind, normalizeString(effectiveAsset.assetKey) || normalizeString(selectedEntry.assetKey) || effectiveAsset.assetId),
      itemKey: normalizeString(effectiveAsset.assetKey) || normalizeString(selectedEntry.assetKey) || effectiveAsset.assetId,
      kind,
      title: normalizeDisplayText(selectedEntry.title || effectiveAsset.assetKey || effectiveAsset.assetId),
      description: normalizeDescription(selectedEntry.description),
      sourceType: 'catalog-asset',
      sourceId: null,
      providerId: normalizeString(selectedEntry?.provenance?.providerId || selectedEntry?.metadata?.provider) || null,
      readPath: sourceActionMetadata?.contentPath || null,
      detail: {
        itemType: 'catalog-asset',
        sourceLayer: normalizeString(selectedEntry.layer) || null,
        availability: normalizeString(installState.availability) || null,
        loadMode: normalizeString(installState.loadMode) || null,
        selectedLayer: normalizeString(effectiveAsset.selectedLayer) || null,
        readPath: sourceActionMetadata?.contentPath || null,
        scopeKind: normalizeString(selectedEntry?.scope?.kind || effectiveAsset?.scope?.kind) || null,
        scopeKinds: normalizeScopeKinds(
          selectedEntry?.targeting?.scopeKinds,
          selectedEntry?.scope?.kind,
          effectiveAsset?.scope?.kind,
        ),
      },
      actions: {
        kind: 'catalog-asset',
        installAssetId: engineManifestAssetIds.has(effectiveAsset.assetId) ? effectiveAsset.assetId : null,
        installSurfaceTargets: [],
      },
      harnessStates: listHarnessRows(ctx)
        .filter((harness) => harness.harnessId === 'copilot')
        .map((harness) => buildHarnessState({
          ctx,
          harnessId: harness.harnessId,
          kind,
          installedPaths,
          expected: engineManifestAssetIds.has(effectiveAsset.assetId),
          canInstall: harness.harnessId === 'copilot' && engineManifestAssetIds.has(effectiveAsset.assetId),
          detail: sourceActionMetadata,
          metadata: {
            actionKind: 'catalog-asset',
          },
        })),
    });
  }

  return grouped;
}

function loadManifestDocument(engineRoot, fileName, fsImpl = fs, pathImpl = path) {
  const manifestPath = pathImpl.join(path.resolve(engineRoot), fileName);
  const document = readJsonIfExists(manifestPath, fsImpl);
  return {
    manifestPath,
    document: document && typeof document === 'object' ? document : null,
  };
}

function buildInstalledPathCandidatesForManifestAsset(ctx, source, asset) {
  const destination = normalizeString(asset?.destination);
  if (!destination) {
    return [];
  }

  const candidates = [];
  if (source === 'codex') {
    const codexHome = normalizeString(ctx.codexHome);
    const codexSkillsHome = normalizeString(ctx.codexSkillsHome);
    if (normalizeManifestAssetItemKind(asset.type) === 'skill') {
      const suffix = destination.replace(/^skills[\\/]/i, '');
      if (codexSkillsHome) {
        candidates.push(path.join(codexSkillsHome, suffix));
      }
    } else if (codexHome) {
      candidates.push(path.join(codexHome, destination));
    }
  }

  if (source === 'opencode') {
    const opencodeHome = normalizeString(ctx.opencodeHome);
    const opencodeSkillsHome = normalizeString(ctx.opencodeSkillsHome);
    if (normalizeManifestAssetItemKind(asset.type) === 'skill') {
      const suffix = destination.replace(/^skills[\\/]/i, '');
      if (opencodeSkillsHome) {
        candidates.push(path.join(opencodeSkillsHome, suffix));
      }
    } else if (opencodeHome) {
      candidates.push(path.join(opencodeHome, destination));
    }
  }

  if (source === 'antigravity') {
    const geminiHome = normalizeString(ctx.geminiHome);
    const antigravitySkillsHome = normalizeString(ctx.antigravitySkillsHome);
    const normalizedKind = normalizeManifestAssetItemKind(asset.type);
    if (normalizedKind === 'skill') {
      const suffix = destination
        .replace(/^antigravity[\\/]skills[\\/]/i, '')
        .replace(/^skills[\\/]/i, '');
      if (antigravitySkillsHome) {
        candidates.push(path.join(antigravitySkillsHome, suffix));
      }
    } else if (normalizedKind === 'instructions' && geminiHome) {
      candidates.push(path.join(geminiHome, destination));
    }
  }

  return candidates;
}

function buildManifestInventory(ctx) {
  const manifests = [
    { source: 'codex', fileName: 'codex-assets/manifest.json', harnessId: 'codex', supportsItemInstall: false },
    { source: 'opencode', fileName: 'opencode-assets/manifest.json', harnessId: 'opencode', supportsItemInstall: false },
    { source: 'antigravity', fileName: 'antigravity-assets/manifest.json', harnessId: 'antigravity', supportsItemInstall: false },
  ];
  const grouped = {
    skill: [],
    agent: [],
    mcp: [],
  };
  const ledger = ctx.copilotHomeAbs ? installLedgerLib.readInstallLedger(ctx.copilotHomeAbs) : null;

  for (const manifestSource of manifests) {
    const manifestScan = loadManifestDocument(ctx.engineRoot, manifestSource.fileName);
    const assets = expandManifestAssets(ctx.engineRoot, manifestScan.document);
    for (const asset of assets) {
      const kind = normalizeManifestAssetItemKind(asset?.type);
      if (!isManifestAssetSupportedForGlobalInventory(asset?.type)) {
        continue;
      }
      const sourcePath = normalizeString(asset?.source);
      const sourceAbs = sourcePath ? path.join(path.resolve(ctx.engineRoot), sourcePath) : '';
      const conceptualKey = buildManifestConceptualCatalogKey(asset);
      const assetId = normalizeString(asset?.id);
      const installedPaths = buildInstalledPathCandidatesForManifestAsset(ctx, manifestSource.source, asset)
        .filter((candidate) => candidate && safeStat(candidate, fs));
      grouped[kind].push({
        itemId: assetId || `${manifestSource.harnessId}-${kind}-${grouped[kind].length + 1}`,
        conceptualKey,
        itemKey: normalizeString(asset?.destination || asset?.id) || `${manifestSource.harnessId}-${kind}`,
        kind,
        title: humanizeCatalogKey(conceptualKey || asset?.id || asset?.destination),
        description: normalizeDescription(manifestScan.document?.installDefaults?.description),
        sourceType: 'harness-manifest',
        sourceId: manifestSource.source,
        providerId: null,
        readPath: sourceAbs || null,
        detail: {
          itemType: 'harness-manifest',
          harnessId: manifestSource.harnessId,
          manifestPath: manifestScan.manifestPath,
          sourcePath,
          destination: normalizeString(asset?.destination) || null,
          readPath: sourceAbs || null,
          scopeKind: 'harness',
          scopeKinds: ['harness'],
        },
        actions: {
          kind: 'install-surface',
          installAssetId: null,
          installSurfaceTargets: INSTALL_SURFACE_HARNESSES.has(manifestSource.harnessId)
            ? [manifestSource.harnessId]
            : [],
        },
        harnessStates: listHarnessRows(ctx)
          .filter((harness) => harness.harnessId === manifestSource.harnessId)
          .map((harness) => buildHarnessState({
            ctx,
            harnessId: harness.harnessId,
            kind,
            installedPaths,
            expected: installLedgerLib.isAssetExpectedForUser(assetId, manifestSource.harnessId, ledger),
            canInstall: INSTALL_SURFACE_HARNESSES.has(harness.harnessId),
            canSync: INSTALL_SURFACE_HARNESSES.has(harness.harnessId),
            detail: {
              readPath: sourceAbs || null,
              sourcePath,
              destination: normalizeString(asset?.destination) || null,
            },
            metadata: {
              actionKind: 'install-surface',
            },
          })),
      });
    }
  }

  return grouped;
}

function buildExternalSourceInventory(summary, ctx) {
  const grouped = {
    skill: [],
    agent: [],
    mcp: [],
    'cli-tool': [],
  };
  const sources = Array.isArray(summary?.externalSources) ? summary.externalSources : [];

  const buildSourceVerificationDetail = (source) => {
    const sync = source?.sync && typeof source.sync === 'object' ? source.sync : {};
    return {
      sourceSyncStatus: normalizeString(sync.status) || null,
      sourceResolvedRef: normalizeString(sync.resolvedRef) || null,
      sourceLastError: normalizeString(sync.lastError) || null,
      sourceLastVerifiedAt: normalizeString(sync.lastVerifiedAt) || null,
      sourceVerificationStatus: normalizeString(sync.verificationStatus) || null,
      sourceVerificationWarnings: normalizeStringList(sync.verificationWarnings),
      sourceVerificationErrors: normalizeStringList(sync.verificationErrors),
    };
  };

  const buildExternalInstallableDetail = (entry) => ({
    enabled: entry?.enabled === true,
    installed: entry?.installed === true,
    managedName: normalizeString(entry?.managedName) || null,
    installedPath: normalizeString(entry?.installedPath) || null,
    overallStatus: normalizeString(entry?.overallStatus) || null,
    sourceStatus: normalizeString(entry?.sourceStatus) || null,
    lastVerifiedAt: normalizeString(entry?.lastVerifiedAt) || null,
    warnings: normalizeStringList(entry?.warnings),
    errors: normalizeStringList(entry?.errors),
    checks: Array.isArray(entry?.checks) ? entry.checks.filter((check) => Boolean(check && typeof check === 'object')) : [],
  });

  const buildExternalHarnessStates = (source, installable, kind, targetSupport, activation) => {
    if (kind === 'cli-tool') {
      const targetState = activation.host && typeof activation.host === 'object' ? activation.host : {};
      const targetInstallables = targetState.installables && typeof targetState.installables === 'object'
        ? targetState.installables
        : {};
      const entry = targetInstallables[installable.installableId] && typeof targetInstallables[installable.installableId] === 'object'
        ? targetInstallables[installable.installableId]
        : {};
      const detail = buildExternalInstallableDetail(entry);
      return [buildHarnessState({
        ctx,
        harnessId: 'host',
        kind,
        installed: detail.installed,
        active: detail.enabled,
        installPath: detail.installed || detail.enabled ? detail.installedPath : null,
        expected: false,
        canActivate: true,
        canDeactivate: true,
        detail,
        metadata: {
          actionKind: 'external-source',
          sourceId: normalizeString(source.sourceId) || null,
          installableId: normalizeString(installable.installableId) || null,
        },
      })];
    }

    return listHarnessRows(ctx)
      .filter((harness) => targetSupport.includes(harness.harnessId))
      .map((harness) => {
        const targetState = activation[harness.harnessId] && typeof activation[harness.harnessId] === 'object'
          ? activation[harness.harnessId]
          : {};
        const targetInstallables = targetState.installables && typeof targetState.installables === 'object'
          ? targetState.installables
          : {};
        const entry = targetInstallables[installable.installableId] && typeof targetInstallables[installable.installableId] === 'object'
          ? targetInstallables[installable.installableId]
          : {};
        const detail = buildExternalInstallableDetail(entry);
        return buildHarnessState({
          ctx,
          harnessId: harness.harnessId,
          kind,
          installed: detail.installed,
          active: detail.enabled,
          installPath: detail.installed || detail.enabled ? detail.installedPath : null,
          expected: false,
          canActivate: true,
          canDeactivate: true,
          detail,
          metadata: {
            actionKind: 'external-source',
            sourceId: normalizeString(source.sourceId) || null,
            installableId: normalizeString(installable.installableId) || null,
          },
        });
      });
  };

  for (const source of sources) {
    const installables = Array.isArray(source?.installables) ? source.installables : [];
    const activation = source?.activation && typeof source.activation === 'object' ? source.activation : {};
    for (const installable of installables) {
      const kind = normalizeCatalogItemKind(installable?.kind);
      if (kind !== 'skill' && kind !== 'mcp' && kind !== 'cli-tool') {
        continue;
      }
      const targetSupport = normalizeStringList(installable?.targetSupport);
      const installableMetadata = installable?.metadata && typeof installable.metadata === 'object'
        ? installable.metadata
        : {};
      const sourceVerificationDetail = buildSourceVerificationDetail(source);
      const externalReadPath = normalizeString(
        installableMetadata.relativeSkillFilePath
        || installableMetadata.readPath
        || installable?.sourcePath
        || installable?.relativePath
      ) || null;
      const conceptualKey = buildConceptualCatalogKey(kind, normalizeString(installable.installableId) || normalizeString(installable.name) || externalReadPath);
      grouped[kind].push({
        itemId: `${normalizeString(source.sourceId)}:${normalizeString(installable.installableId)}`,
        conceptualKey,
        itemKey: normalizeString(installable.installableId) || `${normalizeString(source.sourceId)}-${kind}`,
        kind,
        title: normalizeDisplayText(installable.title || installable.name || installable.installableId),
        description: normalizeDescription(installable.description || source.description),
        sourceType: 'external-source',
        sourceId: normalizeString(source.sourceId) || null,
        providerId: null,
        readPath: externalReadPath,
        detail: {
          itemType: 'external-source',
          sourceId: normalizeString(source.sourceId) || null,
          sourceTitle: normalizeDisplayText(source.title),
          installableId: normalizeString(installable.installableId) || null,
          relativePath: normalizeString(installable.relativePath) || null,
          sourcePath: normalizeString(installable.sourcePath) || null,
          readPath: externalReadPath,
          scopeKind: kind === 'cli-tool' ? 'global' : 'harness',
          scopeKinds: [kind === 'cli-tool' ? 'global' : 'harness'],
          ...sourceVerificationDetail,
        },
        actions: {
          kind: 'external-source',
          installAssetId: null,
          installSurfaceTargets: [],
        },
        harnessStates: buildExternalHarnessStates(source, installable, kind, targetSupport, activation),
      });
    }
  }

  return grouped;
}

function mergeHarnessStateMaps(existingStates, incomingStates) {
  const merged = new Map();
  for (const state of [...(Array.isArray(existingStates) ? existingStates : []), ...(Array.isArray(incomingStates) ? incomingStates : [])]) {
    if (!state || typeof state !== 'object') {
      continue;
    }
    const harnessId = normalizeHarnessId(state.harnessId);
    if (!harnessId) {
      continue;
    }
    const previous = merged.get(harnessId);
    if (!previous) {
      merged.set(harnessId, { ...state });
      continue;
    }
    const mergedMetadata = {
      ...(previous.metadata && typeof previous.metadata === 'object' ? previous.metadata : {}),
      ...(state.metadata && typeof state.metadata === 'object' ? state.metadata : {}),
    };
    const mergedDetail = {
      ...(previous.detail && typeof previous.detail === 'object' ? previous.detail : {}),
      ...(state.detail && typeof state.detail === 'object' ? state.detail : {}),
    };
    const mergedActions = {
      ...(previous.actions && typeof previous.actions === 'object' ? previous.actions : {}),
      ...(state.actions && typeof state.actions === 'object' ? state.actions : {}),
    };
    merged.set(harnessId, {
      ...previous,
      ...state,
      supported: previous.supported || state.supported,
      expected: previous.expected || state.expected,
      installed: previous.installed || state.installed,
      active: previous.active || state.active,
      installPath: previous.installPath || state.installPath || null,
      actions: mergedActions,
      detail: Object.keys(mergedDetail).length ? mergedDetail : null,
      metadata: Object.keys(mergedMetadata).length ? mergedMetadata : null,
    });
  }
  return sortHarnessStates(Array.from(merged.values())).map((state) => ({
    ...state,
    syncStatus: resolveHarnessSyncStatus(state),
  }));
}

function mergeInventoryItems(items) {
  const grouped = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const kind = normalizeCatalogItemKind(item.kind);
    const conceptualKey = normalizeString(item.conceptualKey || buildConceptualCatalogKey(kind, item.itemKey || item.itemId)).toLowerCase();
    const sourceType = normalizeString(item.sourceType).toLowerCase();
    const key = conceptualKey ? `${kind}::${conceptualKey}` : `${kind}::${normalizeString(item.itemId).toLowerCase()}::${sourceType}`;
    const previous = grouped.get(key);
    if (!previous) {
      grouped.set(key, {
        ...item,
        conceptualKey,
        harnessStates: mergeHarnessStateMaps([], item.harnessStates),
      });
      continue;
    }

    const mergedDetail = {
      ...(previous.detail && typeof previous.detail === 'object' ? previous.detail : {}),
      ...(item.detail && typeof item.detail === 'object' ? item.detail : {}),
    };
    const mergedActions = {
      ...(previous.actions && typeof previous.actions === 'object' ? previous.actions : {}),
      ...(item.actions && typeof item.actions === 'object' ? item.actions : {}),
      installSurfaceTargets: Array.from(new Set([
        ...normalizeArray(previous.actions?.installSurfaceTargets),
        ...normalizeArray(item.actions?.installSurfaceTargets),
      ])),
      installAssetId: previous.actions?.installAssetId || item.actions?.installAssetId || null,
    };
    const previousDetailScopeKinds = Array.isArray(previous.detail?.scopeKinds) ? previous.detail.scopeKinds : [];
    const nextDetailScopeKinds = Array.isArray(item.detail?.scopeKinds) ? item.detail.scopeKinds : [];
    grouped.set(key, {
      ...previous,
      itemId: previous.itemId || item.itemId,
      itemKey: previous.itemKey || item.itemKey,
      title: previous.title || item.title,
      description: previous.description || item.description,
      sourceType: previous.sourceType === 'catalog-asset' ? previous.sourceType : item.sourceType || previous.sourceType,
      sourceId: previous.sourceId || item.sourceId || null,
      providerId: previous.providerId || item.providerId || null,
      readPath: previous.readPath || item.readPath || null,
      detail: {
        ...mergedDetail,
        scopeKinds: normalizeScopeKinds(previousDetailScopeKinds, nextDetailScopeKinds),
        scopeKind: normalizeString(previous.detail?.scopeKind || item.detail?.scopeKind) || null,
      },
      actions: mergedActions,
      harnessStates: mergeHarnessStateMaps(previous.harnessStates, item.harnessStates),
      conceptualKey,
    });
  }

  return Array.from(grouped.values())
    .map((item) => {
      const feature = getGlobalCatalogFeatureMetadata(item.kind, item.conceptualKey);
      const harnessStates = mergeHarnessStateMaps([], item.harnessStates);
      const expectedHarnessCount = harnessStates.filter((state) => state.expected).length;
      const missingHarnessCount = harnessStates.filter((state) => state.syncStatus === 'missing').length;
      const installedHarnessCount = harnessStates.filter((state) => state.installed).length;
      const supportedHarnessCount = getSupportedHarnessCountForKind(item.kind);
      const scopeKinds = normalizeScopeKinds(item.detail?.scopeKinds, feature?.scopeKinds);
      const syncStatus = missingHarnessCount > 0
        ? 'missing'
        : expectedHarnessCount > 0
          ? 'synced'
          : installedHarnessCount > 0
            ? 'installed'
            : 'available';
      return {
        ...item,
        title: item.title || humanizeCatalogKey(item.conceptualKey || item.itemKey || item.itemId),
        detail: {
          ...(item.detail && typeof item.detail === 'object' ? item.detail : {}),
          scopeKinds,
          scopeKind: normalizeString(item.detail?.scopeKind) || (scopeKinds.length === 1 ? scopeKinds[0] : null),
        },
        harnessStates,
        central: feature?.central === true,
        keyFeature: feature?.keyFeature === true,
        keyFeatureLabel: feature?.keyFeatureLabel || null,
        keyFeatureOrder: Number.isFinite(feature?.keyFeatureOrder) ? feature.keyFeatureOrder : null,
        scopeKinds,
        syncStatus,
        expectedHarnessCount,
        missingHarnessCount,
        installedHarnessCount,
        supportedHarnessCount,
      };
    })
    .sort((left, right) => {
      const leftKeyOrder = Number.isFinite(left.keyFeatureOrder) ? left.keyFeatureOrder : Number.MAX_SAFE_INTEGER;
      const rightKeyOrder = Number.isFinite(right.keyFeatureOrder) ? right.keyFeatureOrder : Number.MAX_SAFE_INTEGER;
      if (leftKeyOrder !== rightKeyOrder) {
        return leftKeyOrder - rightKeyOrder;
      }
      if (Boolean(left.keyFeature) !== Boolean(right.keyFeature)) {
        return left.keyFeature ? -1 : 1;
      }
      if (Boolean(left.central) !== Boolean(right.central)) {
        return left.central ? -1 : 1;
      }
      if (left.missingHarnessCount !== right.missingHarnessCount) {
        return right.missingHarnessCount - left.missingHarnessCount;
      }
      const titleCompare = String(left.title || '').localeCompare(String(right.title || ''));
      if (titleCompare !== 0) {
        return titleCompare;
      }
      return String(left.itemId || '').localeCompare(String(right.itemId || ''));
    });
}

function buildGlobalCatalogInventory(summary, externalSourcesSummary, ctx) {
  const engineManifestScan = loadManifestDocument(ctx.engineRoot, 'engine-assets/manifest.json');
  const engineManifestAssetIds = new Set(
    expandManifestAssets(ctx.engineRoot, engineManifestScan.document)
      .map((asset) => normalizeString(asset?.id))
      .filter(Boolean)
  );
  const projectionInventory = buildProjectionInventory(summary, ctx, engineManifestAssetIds);
  const manifestInventory = buildManifestInventory(ctx);
  const externalInventory = buildExternalSourceInventory({ externalSources: externalSourcesSummary?.sources || [] }, ctx);

  const sections = ['skill', 'agent', 'mcp', 'cli-tool'].map((kind) => {
    const items = mergeInventoryItems([
      ...(projectionInventory[kind] || []),
      ...(manifestInventory[kind] || []),
      ...(externalInventory[kind] || []),
    ]);
    return {
      kind,
      title: humanizeItemKind(kind),
      count: items.length,
      items,
    };
  });

  const ledger = ctx.copilotHomeAbs ? installLedgerLib.readInstallLedger(ctx.copilotHomeAbs) : null;
  const harnesses = listHarnessRows(ctx).map((row) => ({
    ...row,
    optedIn: ledger ? Boolean(ledger.harnesses?.[row.harnessId]?.optedInAt) : false,
  }));

  return {
    harnesses,
    sections,
  };
}

function resolveExternalSourceReadablePath(ctx, sourceId, relativePath) {
  const normalizedSourceId = normalizeString(sourceId).toLowerCase();
  const normalizedRelativePath = normalizeString(relativePath).replace(/\\/g, '/');
  if (!normalizedSourceId || !normalizedRelativePath) {
    throw Object.assign(new Error('sourceId and path are required'), { statusCode: 400 });
  }
  const cacheRoot = depsResolveExternalSourceCacheRoot(ctx);
  const extractedRoot = path.join(cacheRoot, normalizedSourceId, 'extracted');
  const extractedEntries = safeReadDir(extractedRoot, { withFileTypes: true });
  const rootDirectory = extractedEntries.find((entry) => entry.isDirectory());
  if (!rootDirectory) {
    throw Object.assign(new Error(`Cached contents unavailable for source ${normalizedSourceId}`), { statusCode: 404 });
  }
  const sourceRoot = path.join(extractedRoot, rootDirectory.name);
  return safeResolveUnder(sourceRoot, normalizedRelativePath, path);
}

function depsResolveExternalSourceCacheRoot(ctx) {
  if (ctx.externalSources && typeof ctx.externalSources.resolveCacheRoot === 'function') {
    return ctx.externalSources.resolveCacheRoot(ctx.copilotHomeAbs);
  }
  return path.join(path.resolve(ctx.copilotHomeAbs), 'catalog', 'external-sources', 'cache');
}

function handleCatalogContent(ctx, deps) {
  const mode = normalizeString(ctx.u.searchParams.get('mode')).toLowerCase();
  const requestedPath = normalizeString(ctx.u.searchParams.get('path'));
  if (!mode || !requestedPath) {
    sendJsonError(ctx.res, deps.sendJson, 400, 'catalog.content', 'mode and path are required');
    return;
  }

  try {
    let absPath = null;
    if (mode === 'absolute') {
      absPath = path.resolve(requestedPath);
      const allowedRoots = listHarnessRows(ctx)
        .map((entry) => entry.homePath)
        .filter(Boolean)
        .concat(path.resolve(ctx.engineRoot));
      if (!allowedRoots.some((root) => isPathWithinRoot(root, absPath))) {
        throw Object.assign(new Error('Requested path is outside supported catalog roots'), { statusCode: 400 });
      }
    } else if (mode === 'engine') {
      absPath = safeResolveUnder(ctx.engineRoot, requestedPath, path);
    } else if (mode === 'external-source') {
      const sourceId = normalizeString(ctx.u.searchParams.get('sourceId'));
      absPath = resolveExternalSourceReadablePath({ ...ctx, externalSources: deps.externalSources }, sourceId, requestedPath);
    } else {
      throw Object.assign(new Error(`Unsupported mode: ${mode}`), { statusCode: 400 });
    }

    const text = safeReadText(absPath, 512 * 1024, deps.fs);
    if (text == null) {
      deps.sendText(ctx.res, 404, 'Catalog content not found at the resolved path.', 'text/plain; charset=utf-8');
      return;
    }
    deps.sendText(ctx.res, 200, text, 'text/plain; charset=utf-8');
  } catch (error) {
    sendJsonError(ctx.res, deps.sendJson, error.statusCode || 400, 'catalog.content', String(error.message || error));
  }
}

function normalizeCatalogFilters(searchParams) {
  return {
    assetId: normalizeString(searchParams.get('assetId')),
    assetKey: normalizeString(searchParams.get('assetKey')),
    kind: normalizeString(searchParams.get('kind')),
    scopeKind: normalizeString(searchParams.get('scopeKind')),
    repoId: normalizeString(searchParams.get('repoId')),
    layer: normalizeString(searchParams.get('layer')),
    text: normalizeString(searchParams.get('q') || searchParams.get('text')),
    installed: parseBooleanLike(searchParams.get('installed')),
    enabled: parseBooleanLike(searchParams.get('enabled')),
    recommended: parseBooleanLike(searchParams.get('recommended')),
    available: parseBooleanLike(searchParams.get('available')),
  };
}

function normalizeBundleFilters(searchParams) {
  return {
    bundleId: normalizeString(searchParams.get('bundleId')),
    classification: normalizeString(searchParams.get('classification')).toLowerCase(),
    scopeKind: normalizeString(searchParams.get('scopeKind')).toLowerCase(),
    language: normalizeString(searchParams.get('language')).toLowerCase(),
    framework: normalizeString(searchParams.get('framework')).toLowerCase(),
    stack: normalizeString(searchParams.get('stack')).toLowerCase(),
    tag: normalizeString(searchParams.get('tag')).toLowerCase(),
    text: normalizeString(searchParams.get('q') || searchParams.get('text')),
  };
}

function stripEmptyFields(input) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => value !== '' && value !== undefined)
  );
}

function tokenizeSearchText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function textIncludesAny(haystack, tokens) {
  const lower = String(haystack || '').trim().toLowerCase();
  return lower && tokens.some((token) => lower.includes(token));
}

function listIncludesAny(values, tokens) {
  return normalizeArray(values)
    .map((value) => value.toLowerCase())
    .some((value) => tokens.some((token) => value.includes(token)));
}

function buildSearchExplanations(effectiveState, query) {
  const explanations = [];
  const entry = effectiveState?.selectedEntry || effectiveState;
  const tokens = tokenizeSearchText(query.query);
  const queryLower = String(query.query || '').trim().toLowerCase();
  const assetKey = String(effectiveState?.assetKey || '').toLowerCase();
  const title = String(entry?.title || '').toLowerCase();
  const description = String(entry?.description || '').toLowerCase();
  const tags = normalizeArray(entry?.targeting?.tags).map((tag) => tag.toLowerCase());
  const frameworks = [
    ...normalizeArray(entry?.targeting?.frameworks),
    ...normalizeArray(entry?.metadata?.frameworks),
  ].map((item) => item.toLowerCase());

  if (queryLower && (assetKey === queryLower || title === queryLower)) {
    explanations.push({
      code: 'exact-name',
      weight: 100,
      message: `Exact match for "${query.query}".`,
      layer: effectiveState?.selectedLayer || null,
    });
  } else if (queryLower && (assetKey.includes(queryLower) || title.includes(queryLower))) {
    explanations.push({
      code: 'name',
      weight: 60,
      message: 'Matched asset name/title.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  if (tokens.length > 0 && tokens.some((token) => description.includes(token))) {
    explanations.push({
      code: 'description',
      weight: 25,
      message: 'Matched asset description.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  if (tokens.length > 0 && tags.some((tag) => tokens.some((token) => tag.includes(token)))) {
    explanations.push({
      code: 'tags',
      weight: 20,
      message: 'Matched catalog tags.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  const requestedFrameworks = uniqueStrings(query.frameworks);
  if (
    requestedFrameworks.length > 0
    && frameworks.some((framework) => requestedFrameworks.includes(framework))
  ) {
    explanations.push({
      code: 'framework',
      weight: 18,
      message: 'Matched requested frameworks.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  if (effectiveState?.selectedLayer === 'repo-local' || effectiveState?.scope?.kind === 'repo') {
    explanations.push({
      code: 'repo-local',
      weight: 8,
      message: 'Repo-local or repo-scoped asset.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  const effectiveLoadMode = effectiveState?.installState?.loadMode || entry?.installState?.loadMode;
  if (query.preferLoadMode && effectiveLoadMode === query.preferLoadMode) {
    explanations.push({
      code: 'load-mode',
      weight: 6,
      message: `Matched preferred load mode "${query.preferLoadMode}".`,
      layer: effectiveState?.selectedLayer || null,
    });
  }

  if (effectiveState?.recommended) {
    explanations.push({
      code: 'recommendation',
      weight: 4,
      message: 'Asset is currently recommended.',
      layer: effectiveState?.selectedLayer || null,
    });
  }

  return explanations;
}

function buildSearchResults(snapshot, request, routingPolicy = null) {
  const list = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
  const eligibleAssetIds = new Set(
    !request.overrideRoutingPolicy && Array.isArray(routingPolicy?.eligibleAssetIds)
      ? routingPolicy.eligibleAssetIds
      : []
  );
  const filtered = list.filter((asset) => {
    if (!asset || typeof asset !== 'object') {
      return false;
    }
    if (request.kind && asset.kind !== request.kind) {
      return false;
    }
    if (request.repoId && asset.scope?.repoId && asset.scope.repoId !== request.repoId) {
      return false;
    }
    if (!request.includeDisabled && asset.enabled === false) {
      return false;
    }
    if (!request.includeDeprecated && asset.deprecated === true) {
      return false;
    }
    if (!request.includeVaultOnly && asset.installState?.availability === 'vault-only') {
      return false;
    }
    if (eligibleAssetIds.size > 0 && !eligibleAssetIds.has(asset.assetId)) {
      return false;
    }
    if (!request.overrideRoutingPolicy && routingPolicy && eligibleAssetIds.size === 0) {
      return false;
    }
    if (request.tags.length > 0 && !listIncludesAny(asset.selectedEntry?.targeting?.tags, request.tags)) {
      return false;
    }
    if (request.frameworks.length > 0) {
      const frameworks = [
        ...normalizeArray(asset.selectedEntry?.targeting?.frameworks),
        ...normalizeArray(asset.selectedEntry?.metadata?.frameworks),
      ].map((entry) => entry.toLowerCase());
      if (!frameworks.some((framework) => request.frameworks.includes(framework))) {
        return false;
      }
    }

    const entry = asset.selectedEntry || asset;
    const tokens = tokenizeSearchText(request.query);
    return (
      textIncludesAny(asset.assetKey, tokens)
      || textIncludesAny(entry.title, tokens)
      || textIncludesAny(entry.description, tokens)
      || listIncludesAny(entry.targeting?.tags, tokens)
      || listIncludesAny(entry.metadata?.triggersOn, tokens)
    );
  });

  return filtered
    .map((effectiveState) => {
      const entry = effectiveState.selectedEntry || effectiveState;
      const explanations = buildSearchExplanations(effectiveState, request);
      const score = explanations.reduce((sum, explanation) => sum + explanation.weight, 0);
      return {
        assetId: effectiveState.assetId,
        entry,
        effectiveState,
        score,
        explanations,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return String(a.assetId || '').localeCompare(String(b.assetId || ''));
    })
    .slice(0, request.limit)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));
}

function recordAuditEvent(ctx, deps, eventInput) {
  return appendCatalogAuditEvent(ctx.copilotHomeAbs, {
    actor: {
      kind: 'ui',
      id: 'copilot-ui-backend',
      label: 'copilot-ui-backend',
    },
    ...eventInput,
  }, deps);
}

function parseSearchRequest(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    query: normalizeString(source.query || source.text),
    kind: normalizeString(source.kind || 'skill') || 'skill',
    repoId: normalizeString(source.repoId),
    repoPath: normalizeString(source.repoPath),
    frameworks: uniqueStrings(source.frameworks),
    stacks: uniqueStrings(source.stacks),
    languages: uniqueStrings(source.languages),
    tags: uniqueStrings(source.tags),
    limit: clampInteger(source.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT),
    includeVaultOnly: Boolean(source.includeVaultOnly),
    includeDisabled: Boolean(source.includeDisabled),
    includeDeprecated: Boolean(source.includeDeprecated),
    overrideRoutingPolicy: Boolean(source.overrideRoutingPolicy),
    preferLoadMode: normalizeString(source.preferLoadMode),
    workspaceId: normalizeString(source.workspaceId),
    workspacePath: normalizeString(source.workspacePath),
    sessionId: normalizeString(source.sessionId),
    correlationId: normalizeString(source.correlationId) || createAuditEventId(crypto),
  };
}

function rebuildProjection(ctx, deps, selector, reason) {
  const started = Date.now();
  markRuntimeRebuildStart(deps.catalogRuntimeState, reason);

  try {
    const snapshot = deps.catalogProjection.rebuildCatalogProjection(buildCatalogOptions(ctx, selector));
    const durationMs = Date.now() - started;
    markRuntimeRebuildSuccess(deps.catalogRuntimeState, durationMs, snapshot?.storage?.snapshotPath, reason);
    return snapshot;
  } catch (error) {
    const durationMs = Date.now() - started;
    markRuntimeRebuildFailure(deps.catalogRuntimeState, durationMs, error, reason);
    throw error;
  }
}

function refreshMutationSelectors(ctx, deps, selectors, reason) {
  return (selectors || [{}]).map((selector) => {
    const normalizedSelector = selector && typeof selector === 'object' ? selector : {};
    const snapshot = rebuildProjection(ctx, deps, normalizedSelector, reason);
    const catalogOptions = buildCatalogOptions(ctx, normalizedSelector);
    const projectionContext = {
      storage: deps.catalogProjection.resolveProjectionStorage(catalogOptions),
      readMode: 'persisted-snapshot',
    };
    return {
      selector: normalizedSelector,
      snapshot: buildSnapshotEnvelope(snapshot, projectionContext, deps, deps.catalogRuntimeState),
    };
  });
}

function executeCatalogMutation(ctx, deps, responseKind, mutateFn) {
  deps.readJsonBody(ctx.req)
    .then((body) => mutateFn(body, {
      engineRoot: ctx.engineRoot,
      copilotHomeAbs: ctx.copilotHomeAbs,
      refreshProjections: (selectors, reason) => refreshMutationSelectors(ctx, deps, selectors, reason),
      auditDeps: {
        fs: deps.fs,
        path: deps.path,
        crypto: deps.crypto,
      },
    }))
    .then((result) => {
      deps.sendJson(ctx.res, 200, {
        kind: responseKind,
        deterministic: true,
        ...result,
      });
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      responseKind,
      String(error.message || error),
    ));
}

function handleCatalogSummary(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.summary', detail);
    return;
  }

  const activation = buildActivationStateForProjection(ctx, projectionContext);
  const routingPolicy = buildRoutingPolicyForProjection(ctx, projectionContext, activation);
  const externalSourcesSummary = deps.externalSources.listSources({
    engineRoot: ctx.engineRoot,
    copilotHome: ctx.copilotHomeAbs,
    codexHome: ctx.codexHome,
    codexSkillsHome: ctx.codexSkillsHome,
    opencodeHome: ctx.opencodeHome,
    opencodeSkillsHome: ctx.opencodeSkillsHome,
    geminiHome: ctx.geminiHome,
    antigravityHome: ctx.antigravityHome,
    antigravitySkillsHome: ctx.antigravitySkillsHome,
  });
  const globalInventory = buildGlobalCatalogInventory(projectionContext.snapshot, externalSourcesSummary, ctx);
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.summary',
    deterministic: true,
    summary: buildSnapshotEnvelope(
      projectionContext.snapshot,
      projectionContext,
      deps,
      deps.catalogRuntimeState,
      { activation, routingPolicy, globalInventory },
    ),
    policySnapshot: {
      profile: routingPolicy?.profile || activation?.plannerProfile || 'balanced',
      orchestrationPolicy: routingPolicy?.orchestrationPolicy || activation?.orchestrationPolicy || 'balanced',
      activeBundleIds: routingPolicy?.activeBundleIds || activation?.activeBundleIds || [],
      eligibleAssetIds: routingPolicy?.eligibleAssetIds || [],
      eligibleAssetCount: Array.isArray(routingPolicy?.eligibleAssetIds) ? routingPolicy.eligibleAssetIds.length : 0,
      bundleSource: activation?.bundleSource || 'provider-defaults',
      plannerProfileSource: activation?.plannerProfileSource || 'provider-defaults',
      failClosed: routingPolicy?.failClosed !== false,
      freshness: {
        snapshotUpdatedAt: projectionContext?.snapshot?.updatedAt || null,
        snapshotGeneratedAt: projectionContext?.snapshot?.generatedAt || null,
      },
    },
  });
}

function handleCatalogAssets(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.assets.list', detail);
    return;
  }

  const filters = stripEmptyFields(normalizeCatalogFilters(ctx.u.searchParams));
  const assets = deps.catalogProjection.queryEffectiveCatalog(projectionContext.snapshot, filters);
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.assets.list',
    deterministic: true,
    filters,
    count: assets.length,
    snapshot: buildSnapshotEnvelope(projectionContext.snapshot, projectionContext, deps, deps.catalogRuntimeState),
    assets,
  });
}

function handleCatalogBundles(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.bundles.list', detail);
    return;
  }

  const filters = stripEmptyFields(normalizeBundleFilters(ctx.u.searchParams));
  const activation = buildActivationStateForProjection(ctx, projectionContext);
  const bundles = applyActivationToBundles(
    deps.catalogProjection.queryCatalogBundles(projectionContext.snapshot, filters),
    activation,
  );
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.bundles.list',
    deterministic: true,
    filters,
    count: bundles.length,
    snapshot: buildSnapshotEnvelope(projectionContext.snapshot, projectionContext, deps, deps.catalogRuntimeState, { activation }),
    bundles,
  });
}

function handleCatalogEntries(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.entries.list', detail);
    return;
  }

  const filters = stripEmptyFields(normalizeCatalogFilters(ctx.u.searchParams));
  const entries = deps.catalogProjection.queryCatalogEntries(projectionContext.snapshot, filters);
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.entries.list',
    deterministic: true,
    filters,
    count: entries.length,
    snapshot: buildSnapshotEnvelope(projectionContext.snapshot, projectionContext, deps, deps.catalogRuntimeState),
    entries,
  });
}

function handleCatalogAssetDetail(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.asset.detail', detail);
    return;
  }

  const assetId = decodeURIComponent(ctx.match[1] || '');
  const asset = deps.catalogProjection.getEffectiveAsset(projectionContext.snapshot, assetId);
  if (!asset) {
    sendJsonError(ctx.res, deps.sendJson, 404, 'catalog.asset.detail', `Unknown assetId: ${assetId}`);
    return;
  }

  const entries = deps.catalogProjection.queryCatalogEntries(projectionContext.snapshot, { assetId });
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.asset.detail',
    deterministic: true,
    asset,
    entries,
    snapshot: buildSnapshotEnvelope(projectionContext.snapshot, projectionContext, deps, deps.catalogRuntimeState),
  });
}

function handleCatalogRefresh(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const catalogOptions = buildCatalogOptions(ctx, selector);
      const previousSnapshot = deps.catalogProjection.loadCatalogProjectionSnapshot(catalogOptions);
      const snapshot = rebuildProjection(ctx, deps, selector, 'catalog_refresh');
      const projectionContext = {
        storage: deps.catalogProjection.resolveProjectionStorage(catalogOptions),
        readMode: 'persisted-snapshot',
      };
      const lifecycleAudit = recordProjectionLifecycleEvents(ctx.copilotHomeAbs, previousSnapshot, snapshot, deps);
      const audit = recordAuditEvent(ctx, deps, {
        eventType: 'catalog.rebuilt',
        repoId: snapshot?.repoContext?.repoId || null,
        scope: snapshot?.repoContext
          ? {
            kind: 'repo',
            repoId: snapshot.repoContext.repoId,
            repoPath: snapshot.repoContext.repoPath,
            displayName: snapshot.repoContext.repoLabel,
          }
          : { kind: 'global' },
        details: {
          stats: snapshot?.stats || null,
          warningCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0,
          durationMs: deps.catalogRuntimeState.lastDurationMs,
        },
      });

      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.refresh',
        deterministic: true,
        refreshed: true,
        audit: {
          logged: audit.logged,
          path: audit.path,
          eventId: audit.event.eventId,
          lifecycleEventIds: lifecycleAudit
            .filter((entry) => entry && entry.logged && entry.event?.eventId)
            .map((entry) => entry.event.eventId),
          lifecycleErrors: lifecycleAudit
            .filter((entry) => entry && entry.error)
            .map((entry) => entry.error),
          error: audit.error || null,
        },
        snapshot: buildSnapshotEnvelope(snapshot, projectionContext, deps, deps.catalogRuntimeState),
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.refresh', String(error.message || error)));
}

function handleCatalogAssetCreate(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.create', (body, mutationOptions) =>
    deps.catalogMutation.createAsset(mutationOptions, body, mutationOptions));
}

function handleCatalogAssetUpdate(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.update', (body, mutationOptions) =>
    deps.catalogMutation.updateAsset(mutationOptions, body, mutationOptions));
}

function handleCatalogAssetDelete(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.delete', (body, mutationOptions) =>
    deps.catalogMutation.deleteAsset(mutationOptions, body, mutationOptions));
}

function handleCatalogAssetInstall(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.install', (body, mutationOptions) =>
    deps.catalogMutation.installAsset(mutationOptions, body, mutationOptions));
}

function handleCatalogBundleUninstall(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.bundle.uninstall', (body, mutationOptions) =>
    deps.catalogMutation.uninstallBundle(mutationOptions, body, mutationOptions));
}

function handleCatalogProviderInstall(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const providerId = normalizeString(body?.providerId);
      if (!providerId) {
        throw Object.assign(new Error('providerId is required'), { statusCode: 400 });
      }

      const action = normalizeProviderAction(body?.action);
      const { providerCatalog } = deps.providerCatalog.loadProviderCatalog(ctx.engineRoot);
      const providerInstall = resolveManagedImportProvider(providerCatalog, providerId);
      const managedCli = resolveManagedCliCommandFromRuntimeState(deps);
      const attemptedAt = new Date().toISOString();

      try {
        const commandResults = await executeManagedProviderInstall(deps, providerInstall, action, managedCli.cliPath);
        const stateEntry = persistProviderInstallState(deps, ctx.copilotHomeAbs, providerId, {
          providerId,
          title: providerInstall.provider.title || providerId,
          installStrategy: providerInstall.provider.installStrategy || null,
          bridgeStrategy: providerInstall.provider.bridgeStrategy || null,
          installed: true,
          pluginRef: providerInstall.pluginRef,
          marketplaceRef: providerInstall.marketplaceRef,
          lastAction: action,
          lastAttemptAt: attemptedAt,
          lastSuccessAt: attemptedAt,
          lastError: null,
          lastCommandResults: commandResults,
        });

        const snapshot = rebuildProjection(ctx, deps, {}, 'catalog_provider_install');
        const projectionContext = {
          storage: deps.catalogProjection.resolveProjectionStorage(buildCatalogOptions(ctx, {})),
          readMode: 'persisted-snapshot',
        };

        deps.sendJson(ctx.res, 200, {
          kind: 'catalog.provider.install',
          deterministic: true,
          action,
          providerId,
          provider: {
            providerId,
            title: providerInstall.provider.title || providerId,
            installStrategy: providerInstall.provider.installStrategy || null,
            bridgeStrategy: providerInstall.provider.bridgeStrategy || null,
            cliPath: managedCli.cliPath,
            pluginRef: providerInstall.pluginRef,
            marketplaceRef: providerInstall.marketplaceRef,
          },
          state: stateEntry,
          commands: commandResults,
          snapshot: buildSnapshotEnvelope(snapshot, projectionContext, deps, deps.catalogRuntimeState),
        });
      } catch (error) {
        const commandResults = Array.isArray(error?.commandResults) ? error.commandResults : [];
        const stateEntry = persistProviderInstallState(deps, ctx.copilotHomeAbs, providerId, {
          providerId,
          title: providerInstall.provider.title || providerId,
          installStrategy: providerInstall.provider.installStrategy || null,
          bridgeStrategy: providerInstall.provider.bridgeStrategy || null,
          installed: false,
          pluginRef: providerInstall.pluginRef,
          marketplaceRef: providerInstall.marketplaceRef,
          lastAction: action,
          lastAttemptAt: attemptedAt,
          lastFailureAt: attemptedAt,
          lastError: String(error?.message || error),
          lastCommandResults: commandResults,
        });

        deps.sendJson(ctx.res, error.statusCode || 500, {
          kind: 'catalog.provider.install',
          deterministic: true,
          error: String(error?.message || error),
          action,
          providerId,
          state: stateEntry,
          commands: commandResults,
        });
      }
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.provider.install',
      String(error.message || error),
    ));
}

function handleCatalogSourcesList(ctx, deps) {
  try {
    const result = deps.externalSources.listSources({
      engineRoot: ctx.engineRoot,
      copilotHome: ctx.copilotHomeAbs,
      codexHome: ctx.codexHome,
      codexSkillsHome: ctx.codexSkillsHome,
      opencodeHome: ctx.opencodeHome,
      opencodeSkillsHome: ctx.opencodeSkillsHome,
      geminiHome: ctx.geminiHome,
      antigravityHome: ctx.antigravityHome,
      antigravitySkillsHome: ctx.antigravitySkillsHome,
    });
    deps.sendJson(ctx.res, 200, {
      kind: 'catalog.sources.list',
      deterministic: true,
      count: result.sources.length,
      sources: result.sources,
      storage: {
        catalogPath: result.catalogPath,
        userSourcesPath: result.userSourcesPath,
        statePath: result.statePath,
      },
    });
  } catch (error) {
    sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.list', String(error.message || error));
  }
}

function handleCatalogSourceDetail(ctx, deps) {
  try {
    const sourceId = normalizeString(ctx.match?.[1]);
    const result = deps.externalSources.getSourceDetail({
      engineRoot: ctx.engineRoot,
      copilotHome: ctx.copilotHomeAbs,
      codexHome: ctx.codexHome,
      codexSkillsHome: ctx.codexSkillsHome,
      opencodeHome: ctx.opencodeHome,
      opencodeSkillsHome: ctx.opencodeSkillsHome,
      geminiHome: ctx.geminiHome,
      antigravityHome: ctx.antigravityHome,
      antigravitySkillsHome: ctx.antigravitySkillsHome,
    }, sourceId);
    deps.sendJson(ctx.res, 200, {
      kind: 'catalog.sources.detail',
      deterministic: true,
      source: result.source,
      storage: {
        catalogPath: result.catalogPath,
        userSourcesPath: result.userSourcesPath,
        statePath: result.statePath,
      },
    });
  } catch (error) {
    sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.detail', String(error.message || error));
  }
}

function handleCatalogSourceAdd(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const result = deps.externalSources.addSource({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
      }, body);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.add',
        deterministic: true,
        source: result.source,
        userSourcesPath: result.userSourcesPath,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.add', String(error.message || error)));
}

function handleCatalogSourceRemove(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const sourceId = normalizeString(body?.sourceId);
      const result = deps.externalSources.removeSource({
        copilotHome: ctx.copilotHomeAbs,
      }, sourceId);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.remove',
        deterministic: true,
        ...result,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.remove', String(error.message || error)));
}

function handleCatalogSourceRefresh(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const sourceId = normalizeString(body?.sourceId);
      const result = await deps.externalSources.refreshSource({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
        codexHome: ctx.codexHome,
        codexSkillsHome: ctx.codexSkillsHome,
        opencodeHome: ctx.opencodeHome,
        opencodeSkillsHome: ctx.opencodeSkillsHome,
        geminiHome: ctx.geminiHome,
        antigravityHome: ctx.antigravityHome,
        antigravitySkillsHome: ctx.antigravitySkillsHome,
        fetch: deps.fetch,
      }, sourceId);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.refresh',
        deterministic: true,
        source: result.source,
        snapshot: result.snapshot,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.refresh', String(error.message || error)));
}

function handleCatalogSourceActivate(ctx, deps) {
  return deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const result = await deps.externalSources.activateInstallable({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
        codexHome: ctx.codexHome,
        codexSkillsHome: ctx.codexSkillsHome,
        opencodeHome: ctx.opencodeHome,
        opencodeSkillsHome: ctx.opencodeSkillsHome,
        geminiHome: ctx.geminiHome,
        antigravityHome: ctx.antigravityHome,
        antigravitySkillsHome: ctx.antigravitySkillsHome,
      }, body);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.activate',
        deterministic: true,
        source: result.source,
        installable: result.installable,
        target: result.target,
        materialized: result.materialized,
        state: result.state,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.activate', String(error.message || error)));
}

function handleCatalogSourceDeactivate(ctx, deps) {
  return deps.readJsonBody(ctx.req)
    .then((body) => {
      const result = deps.externalSources.deactivateInstallable({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
        codexHome: ctx.codexHome,
        codexSkillsHome: ctx.codexSkillsHome,
        opencodeHome: ctx.opencodeHome,
        opencodeSkillsHome: ctx.opencodeSkillsHome,
        geminiHome: ctx.geminiHome,
        antigravityHome: ctx.antigravityHome,
        antigravitySkillsHome: ctx.antigravitySkillsHome,
      }, body);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.deactivate',
        deterministic: true,
        source: result.source,
        installable: result.installable,
        target: result.target,
        removed: result.removed,
        state: result.state,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.deactivate', String(error.message || error)));
}

function handleCatalogSourceSyncInstallVerify(ctx, deps) {
  return deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const result = await deps.externalSources.syncInstallVerifySource({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
        codexHome: ctx.codexHome,
        codexSkillsHome: ctx.codexSkillsHome,
        opencodeHome: ctx.opencodeHome,
        opencodeSkillsHome: ctx.opencodeSkillsHome,
        geminiHome: ctx.geminiHome,
        antigravityHome: ctx.antigravityHome,
        antigravitySkillsHome: ctx.antigravitySkillsHome,
        fetch: deps.fetch,
        childProcess: deps.childProcess,
      }, body);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.sources.sync-install-verify',
        deterministic: true,
        source: result.source,
        snapshot: result.snapshot,
        overallStatus: result.overallStatus,
        sourceStatus: result.sourceStatus,
        installables: result.installables,
        targets: result.targets,
        checks: result.checks,
        warnings: result.warnings,
        errors: result.errors,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.sources.sync-install-verify', String(error.message || error)));
}

function handleCatalogSpecKitBootstrap(ctx, deps) {
  return deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const result = await deps.externalSources.bootstrapSpecKitRepo({
        engineRoot: ctx.engineRoot,
        copilotHome: ctx.copilotHomeAbs,
        codexHome: ctx.codexHome,
        codexSkillsHome: ctx.codexSkillsHome,
        opencodeHome: ctx.opencodeHome,
        opencodeSkillsHome: ctx.opencodeSkillsHome,
        geminiHome: ctx.geminiHome,
        antigravityHome: ctx.antigravityHome,
        antigravitySkillsHome: ctx.antigravitySkillsHome,
        fetch: deps.fetch,
        childProcess: deps.childProcess,
      }, body);
      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.tools.spec-kit.bootstrap',
        deterministic: true,
        source: result.source,
        installable: result.installable,
        repoPath: result.repoPath,
        integration: result.integration,
        script: result.script,
        command: result.command,
        overallStatus: result.overallStatus,
        sourceStatus: result.sourceStatus,
        checks: result.checks,
        warnings: result.warnings,
        errors: result.errors,
        bootstrap: result.bootstrap,
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.tools.spec-kit.bootstrap', String(error.message || error)));
}

function handleCatalogAssetEnable(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.enable', (body, mutationOptions) =>
    deps.catalogMutation.setAssetEnabled(mutationOptions, body, true, mutationOptions));
}

function handleCatalogAssetDisable(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.asset.disable', (body, mutationOptions) =>
    deps.catalogMutation.setAssetEnabled(mutationOptions, body, false, mutationOptions));
}

function handleCatalogActivationUpdate(ctx, deps) {
  executeCatalogMutation(ctx, deps, 'catalog.activation.update', (body, mutationOptions) =>
    deps.catalogMutation.updateCatalogActivation(mutationOptions, body, mutationOptions));
}

function handleSearchQuery(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = parseSearchRequest(body);
      if (!request.query) {
        throw Object.assign(new Error('query is required'), { statusCode: 400 });
      }

      const projectionContext = buildProjectionContext(ctx, deps, normalizeRepoSelector(null, request));
      if (!projectionContext.snapshot) {
        const detail = projectionContext.buildError
          ? String(projectionContext.buildError.message || projectionContext.buildError)
          : 'Catalog projection is unavailable.';
        sendJsonError(ctx.res, deps.sendJson, 503, 'catalog.search.query', detail);
        return;
      }
      const activation = buildActivationStateForProjection(ctx, projectionContext);
      const routingPolicy = buildRoutingPolicyForProjection(ctx, projectionContext, activation);

      // Unify search filtering through policy service
      let unifiedRoutingPolicy = null;
      let policyFilter = null;
      try {
        policyFilter = deps.catalogPolicy.buildEligibilityFilter(
          {
            query: request.query,
            repoPath: request.repoPath || projectionContext?.snapshot?.repoContext?.repoPath || null,
            repoId: request.repoId || projectionContext?.snapshot?.repoContext?.repoId || null,
            intent: 'task-routing',
            kinds: request.kind ? [request.kind] : ['skill'],
            overrideRoutingPolicy: request.overrideRoutingPolicy,
          },
          {
            snapshot: projectionContext.snapshot || null,
            activationState: activation,
            routingPolicy,
            externalSources: null,
            crypto: deps.crypto,
          },
        );
        unifiedRoutingPolicy = routingPolicy ? {
          ...routingPolicy,
          eligibleAssetIds: policyFilter.eligibleAssetIds.size > 0 ? [...policyFilter.eligibleAssetIds] : routingPolicy.eligibleAssetIds,
          policySource: 'catalog-policy-service',
        } : null;
      } catch (_) {
        // Policy service failure; fall back to original routing policy
        unifiedRoutingPolicy = routingPolicy;
        policyFilter = null;
      }

      const searchResponse = request.kind === 'skill'
        ? searchSkills(request, {
          snapshot: projectionContext.snapshot,
          copilotHome: ctx.copilotHomeAbs,
          routingPolicy: unifiedRoutingPolicy,
          repoId: request.repoId || projectionContext.snapshot?.repoContext?.repoId,
          repoPath: request.repoPath || projectionContext.snapshot?.repoContext?.repoPath,
          workspaceId: request.workspaceId || undefined,
          workspacePath: request.workspacePath || undefined,
        })
        : {
          results: buildSearchResults(projectionContext.snapshot, request, unifiedRoutingPolicy),
          routingPolicy: unifiedRoutingPolicy
            ? {
              ...unifiedRoutingPolicy,
              mode: request.overrideRoutingPolicy ? 'explicit-override' : 'eligible-only',
            }
            : null,
          totalCandidates: Array.isArray(projectionContext.snapshot?.effectiveAssets)
            ? projectionContext.snapshot.effectiveAssets.length
            : 0,
          filteredCount: 0,
          missReason: null,
        };
      const results = searchResponse.results;
      const sanitizedQuery = sanitizeQueryForTelemetry(normalizeSearchQuery(request));
      const topResults = results.slice(0, 5).map((result) => ({
        assetId: result.assetId,
        assetKey: result.effectiveState?.assetKey,
        score: result.score,
        rank: result.rank,
        explanationCodes: Array.isArray(result.explanations)
          ? result.explanations.map((item) => item.code)
          : [],
      }));
      const searchAudit = recordAuditEvent(ctx, deps, {
        eventType: 'asset.search.query',
        repoId: request.repoId || projectionContext.snapshot?.repoContext?.repoId || null,
        sessionId: request.sessionId || null,
        correlationId: request.correlationId,
        search: {
          query: sanitizedQuery,
          resultCount: results.length,
          missReason: searchResponse.missReason || undefined,
        },
        details: {
          readMode: projectionContext.readMode,
          totalCandidates: searchResponse.totalCandidates,
          filteredCount: searchResponse.filteredCount,
        },
      });

      const resultAudit = recordAuditEvent(ctx, deps, {
        eventType: results.length > 0 ? 'asset.search.result' : 'asset.search.miss',
        repoId: request.repoId || projectionContext.snapshot?.repoContext?.repoId || null,
        sessionId: request.sessionId || null,
        correlationId: request.correlationId,
        search: {
          query: {
            query: sanitizedQuery.query,
            correlationId: request.correlationId,
          },
          resultCount: results.length,
          selectedAssetId: results[0]?.assetId,
          missReason: searchResponse.missReason || undefined,
        },
        details: {
          topResults,
          topAssetId: results[0]?.assetId || null,
        },
      });

      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.search.query',
        deterministic: true,
        query: {
          query: request.query,
          kind: request.kind,
          repoId: request.repoId || projectionContext.snapshot?.repoContext?.repoId || null,
          repoPath: request.repoPath || null,
          frameworks: request.frameworks,
          stacks: request.stacks,
          languages: request.languages,
          tags: request.tags,
          limit: request.limit,
          includeVaultOnly: request.includeVaultOnly,
          includeDisabled: request.includeDisabled,
          includeDeprecated: request.includeDeprecated,
          overrideRoutingPolicy: request.overrideRoutingPolicy,
          preferLoadMode: request.preferLoadMode || null,
          workspaceId: request.workspaceId || null,
          workspacePath: request.workspacePath || null,
          sessionId: request.sessionId || null,
          correlationId: request.correlationId,
        },
        count: results.length,
        results,
        routingPolicy: searchResponse.routingPolicy || unifiedRoutingPolicy || null,
        policySnapshot: policyFilter ? {
          schemaVersion: 1,
          eligibleAssetIds: [...policyFilter.eligibleAssetIds],
          totalEligible: policyFilter.eligibleAssetIds.size,
          blockCount: Object.keys(policyFilter.blockMap).length,
          failClosed: true,
          source: 'catalog-policy-service',
        } : null,
        snapshot: buildSnapshotEnvelope(
          projectionContext.snapshot,
          projectionContext,
          deps,
          deps.catalogRuntimeState,
          { activation, routingPolicy: searchResponse.routingPolicy || unifiedRoutingPolicy || null },
        ),
        audit: {
          logged: Boolean(searchAudit.logged && resultAudit.logged),
          path: searchAudit.path,
          eventIds: [searchAudit.event.eventId, resultAudit.event.eventId],
          errors: [searchAudit.error, resultAudit.error].filter(Boolean),
        },
      });
    })
    .catch((error) => sendJsonError(ctx.res, deps.sendJson, error.statusCode || 500, 'catalog.search.query', String(error.message || error)));
}

function handleSearchSelection(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const source = body && typeof body === 'object' ? body : {};
      const repoId = normalizeString(
        source.repoId
        || source.query?.repoId
        || source.searchQuery?.repoId
        || source.result?.effectiveState?.scope?.repoId
        || source.result?.entry?.scope?.repoId,
      );
      const telemetryRecord = recordSkillSearchSelection({
        query: source.query || source.searchQuery || {},
        result: source.result || {},
        resultCount: source.resultCount,
        assetId: source.assetId,
        assetKey: source.assetKey,
      }, {
        copilotHome: ctx.copilotHomeAbs,
        repoId,
      });

      const audit = recordAuditEvent(ctx, deps, {
        eventType: telemetryRecord.event.eventType,
        assetId: telemetryRecord.event.assetId,
        assetKey: telemetryRecord.event.assetKey,
        assetKind: telemetryRecord.event.assetKind,
        repoId: telemetryRecord.event.repoId,
        sessionId: telemetryRecord.event.sessionId,
        correlationId: telemetryRecord.event.correlationId,
        search: telemetryRecord.event.search,
        details: telemetryRecord.event.details,
      });

      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.search.selection',
        deterministic: true,
        recorded: true,
        telemetry: {
          path: telemetryRecord.telemetryPath,
          eventId: telemetryRecord.event.eventId,
        },
        audit: {
          logged: audit.logged,
          path: audit.path,
          eventId: audit.event.eventId,
          error: audit.error || null,
        },
      });
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.search.selection',
      String(error.message || error),
    ));
}

function handleAuditAssets(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  const filters = stripEmptyFields({
    eventType: normalizeString(ctx.u.searchParams.get('eventType')),
    assetId: normalizeString(ctx.u.searchParams.get('assetId')),
    repoId: normalizeString(ctx.u.searchParams.get('repoId')),
    sessionId: normalizeString(ctx.u.searchParams.get('sessionId')),
    correlationId: normalizeString(ctx.u.searchParams.get('correlationId')),
  });
  const recentLimit = clampInteger(ctx.u.searchParams.get('limit'), DEFAULT_AUDIT_LIMIT, 1, MAX_AUDIT_LIMIT);
  const analytics = buildAssetAuditAnalytics({
    copilotHome: ctx.copilotHomeAbs,
    repoId: selector.repoId,
    repoPath: selector.repoPath,
    snapshot: projectionContext.snapshot,
    filters,
    recentLimit,
  });

  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.audit.assets',
    deterministic: true,
    snapshot: projectionContext.snapshot
      ? buildSnapshotEnvelope(projectionContext.snapshot, projectionContext, deps, deps.catalogRuntimeState)
      : null,
    analytics,
  });
}

function handleAuditEvents(ctx, deps) {
  const auditLogPath = resolveCatalogAuditLogPath(ctx.copilotHomeAbs, deps.path);
  const filters = stripEmptyFields({
    eventType: normalizeString(ctx.u.searchParams.get('eventType')),
    assetId: normalizeString(ctx.u.searchParams.get('assetId')),
    repoId: normalizeString(ctx.u.searchParams.get('repoId')),
    sessionId: normalizeString(ctx.u.searchParams.get('sessionId')),
    correlationId: normalizeString(ctx.u.searchParams.get('correlationId')),
  });
  const limit = clampInteger(ctx.u.searchParams.get('limit'), DEFAULT_AUDIT_LIMIT, 1, MAX_AUDIT_LIMIT);

  const events = readCatalogAuditEventsFromLib(ctx.copilotHomeAbs, limit, deps)
    .filter((event) => {
      if (filters.eventType && event.eventType !== filters.eventType) {
        return false;
      }
      if (filters.assetId && event.assetId !== filters.assetId) {
        return false;
      }
      if (filters.repoId && event.repoId !== filters.repoId) {
        return false;
      }
      if (filters.sessionId && event.sessionId !== filters.sessionId) {
        return false;
      }
      if (filters.correlationId && event.correlationId !== filters.correlationId) {
        return false;
      }
      return true;
    })
    .reverse();

  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.audit.events.list',
    deterministic: true,
    filters,
    count: events.length,
    storage: {
      path: auditLogPath,
      exists: safeStat(auditLogPath, deps.fs) !== null,
    },
    events,
  });
}

function handleRuntimeCatalogHealth(ctx, deps) {
  const selector = normalizeRepoSelector(ctx.u.searchParams);
  const projectionContext = buildProjectionContext(ctx, deps, selector);
  const auditLogPath = resolveCatalogAuditLogPath(ctx.copilotHomeAbs, deps.path);
  const auditFile = describeFile(auditLogPath, deps.fs);

  if (!projectionContext.snapshot) {
    const detail = projectionContext.buildError
      ? String(projectionContext.buildError.message || projectionContext.buildError)
      : 'Catalog projection is unavailable.';
    deps.sendJson(ctx.res, 200, {
      kind: 'runtime.catalog-health',
      deterministic: true,
      ok: false,
      error: detail,
      projection: buildSnapshotEnvelope(null, projectionContext, deps, deps.catalogRuntimeState),
      audit: {
        path: auditLogPath,
        exists: auditFile.exists,
        updatedAt: auditFile.updatedAt,
        size: auditFile.size,
      },
      changes: ctx.changeTracker ? ctx.changeTracker.get() : null,
    });
    return;
  }

  deps.sendJson(ctx.res, 200, {
    kind: 'runtime.catalog-health',
    deterministic: true,
    ok: true,
    projection: buildSnapshotEnvelope(
      projectionContext.snapshot,
      projectionContext,
      deps,
      deps.catalogRuntimeState,
      {
        activation: buildActivationStateForProjection(ctx, projectionContext),
        routingPolicy: buildRoutingPolicyForProjection(ctx, projectionContext),
      },
    ),
    audit: {
      path: auditLogPath,
      exists: auditFile.exists,
      updatedAt: auditFile.updatedAt,
      size: auditFile.size,
    },
    changes: ctx.changeTracker ? ctx.changeTracker.get() : null,
  });
}

function handleRouteExplain(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = body && typeof body === 'object' ? body : {};
      const query = normalizeString(request.query);
      const intent = request.intent || 'task-routing';
      const kinds = Array.isArray(request.kinds) && request.kinds.length > 0
        ? request.kinds
        : ['skill', 'agent', 'mcp', 'cli-tool'];
      const targetHarness = normalizeString(request.targetHarness);
      const overrideRoutingPolicy = Boolean(request.overrideRoutingPolicy);
      const correlationId = request.correlationId
        || (deps.crypto && deps.crypto.randomUUID ? deps.crypto.randomUUID() : `route-${Date.now()}`);

      // Build projection context (reuse existing pattern)
      const selector = normalizeRepoSelector(null, request);
      const projectionContext = buildProjectionContext(ctx, deps, selector);

      // Build activation state and routing policy
      const activation = buildActivationStateForProjection(ctx, projectionContext);
      const routingPolicy = buildRoutingPolicyForProjection(ctx, projectionContext, activation);

      // Fail-closed if projection is unavailable
      if (!projectionContext.snapshot) {
        const detail = projectionContext.buildError
          ? String(projectionContext.buildError.message || projectionContext.buildError)
          : 'Catalog projection is unavailable.';
        deps.sendJson(ctx.res, 503, {
          kind: 'catalog.route.explanation',
          deterministic: true,
          correlationId: correlationId,
          decision: null,
          candidates: [],
          policy: {
            schemaVersion: 1,
            profile: 'balanced',
            orchestrationPolicy: 'balanced',
            activeBundleIds: [],
            totalCandidates: 0,
            eligibleCount: 0,
            blockedCount: 0,
            failClosed: true,
            intent: intent,
            overrideApplied: false,
          },
          blocks: [],
          suggestedActions: [
            {
              operation: 'rebuild-projection',
              label: 'Rebuild catalog projection',
              targetId: 'catalog',
              targetKind: 'projection',
              route: '/api/catalog/refresh',
            },
          ],
          decidedAt: new Date().toISOString(),
          error: detail,
          audit: {
            logged: false,
            path: null,
            eventId: null,
            error: 'projection-unavailable',
          },
        });
        return;
      }

      // Load external sources for candidate enrichment
      let externalSourcesResult = null;
      try {
        externalSourcesResult = deps.externalSources.listSources({
          engineRoot: ctx.engineRoot,
          copilotHome: ctx.copilotHomeAbs,
          codexHome: ctx.codexHome,
          codexSkillsHome: ctx.codexSkillsHome,
          opencodeHome: ctx.opencodeHome,
          opencodeSkillsHome: ctx.opencodeSkillsHome,
          geminiHome: ctx.geminiHome,
          antigravityHome: ctx.antigravityHome,
          antigravitySkillsHome: ctx.antigravitySkillsHome,
        });
      } catch (_) {
        // External sources are best-effort; continue without them
      }

      // Call the policy service
      const decision = deps.catalogPolicy.explainRoute(
        {
          query,
          repoPath: request.repoPath || projectionContext?.snapshot?.repoContext?.repoPath || null,
          repoId: request.repoId || projectionContext?.snapshot?.repoContext?.repoId || null,
          targetHarness: targetHarness || undefined,
          intent,
          kinds,
          overrideRoutingPolicy,
          correlationId,
        },
        {
          snapshot: projectionContext.snapshot || null,
          activationState: activation,
          routingPolicy,
          externalSources: externalSourcesResult,
          correlationId,
          crypto: deps.crypto,
        },
      );

      // Record audit events for the route explanation
      const routeAudit = recordAuditEvent(ctx, deps, {
        eventType: 'catalog.route.explained',
        repoId: decision.policy?.targetHarness ? null : (request.repoId || projectionContext?.snapshot?.repoContext?.repoId || null),
        sessionId: request.sessionId || null,
        correlationId: decision.correlationId,
        details: {
          query: sanitizeQueryForTelemetry(normalizeSearchQuery({ query: request.query })),
          intent: decision.policy?.intent,
          targetHarness: decision.policy?.targetHarness || null,
          overrideApplied: decision.policy?.overrideApplied || false,
          totalCandidates: decision.policy?.totalCandidates,
          eligibleCount: decision.policy?.eligibleCount,
          blockedCount: decision.policy?.blockedCount,
          selectedAssetId: decision.decision?.id || null,
          selectedAssetKey: decision.decision?.key || null,
          selectedKind: decision.decision?.kind || null,
        },
      });

      // Send the response
      deps.sendJson(ctx.res, 200, {
        ...decision,
        audit: {
          logged: routeAudit.logged,
          path: routeAudit.path,
          eventId: routeAudit.event?.eventId || null,
          error: routeAudit.error || null,
        },
      });
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.route.explanation',
      String(error.message || error),
    ));
}

function buildRepoInventoryResponse(kind, payload) {
  return {
    kind,
    deterministic: true,
    ...payload,
  };
}

function listRepoInventory(ctx, deps, extra = {}) {
  return deps.repoInventory.listKnownRepos({
    copilotHome: ctx.copilotHomeAbs,
    engineRoot: ctx.engineRoot,
    explicitRepoPaths: extra.explicitRepoPaths || [],
  });
}

function filterWorktreeRepos(inventory) {
  const filteredRepos = inventory.repos.filter((r) => !r.isWorktreeCheckout);
  // If the selected repo is a worktree, clear it
  const selectedRepo = inventory.selectedRepo && inventory.selectedRepo.isWorktreeCheckout
    ? null
    : inventory.selectedRepo;
  return {
    ...inventory,
    repos: filteredRepos,
    selectedRepo,
  };
}

function normalizeRepoInventoryBody(body = {}) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    repoId: normalizeString(source.repoId),
    repoPath: normalizeString(source.repoPath),
    repoLabel: normalizeString(source.repoLabel || source.label),
    select: Boolean(source.select),
    clear: Boolean(source.clear),
  };
}

function explicitRepoPathsFromRequest(searchParams, body = null) {
  const bodySource = body && typeof body === 'object' ? body : {};
  const values = [];
  const queryValues = searchParams
    ? [
      ...searchParams.getAll('repoPath'),
      ...searchParams.getAll('explicitRepoPath'),
    ]
    : [];
  for (const value of queryValues) {
    const normalized = normalizeString(value);
    if (normalized) {
      values.push(normalized);
    }
  }
  const bodyValues = Array.isArray(bodySource.repoPaths) ? bodySource.repoPaths : [];
  for (const value of bodyValues) {
    const normalized = normalizeString(value);
    if (normalized) {
      values.push(normalized);
    }
  }
  if (normalizeString(bodySource.repoPath)) {
    values.push(normalizeString(bodySource.repoPath));
  }
  return Array.from(new Set(values));
}

function handleCatalogReposList(ctx, deps) {
  const inventory = listRepoInventory(ctx, deps, {
    explicitRepoPaths: explicitRepoPathsFromRequest(ctx.u.searchParams),
  });
  const filtered = filterWorktreeRepos(inventory);
  deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.list', {
    count: filtered.repos.length,
    selectedRepo: filtered.selectedRepo,
    storage: filtered.storage,
    workspaceScan: filtered.workspaceScan,
    repos: filtered.repos,
  }));
}

function handleCatalogRepoScanRoots(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const source = body && typeof body === 'object' ? body : {};
      const customScanRoots = normalizeArray(source.customScanRoots || source.scanRoots);
      deps.repoDiscovery.saveRepoDiscoveryState(ctx.copilotHomeAbs, {
        customScanRoots,
      });
      const inventory = listRepoInventory(ctx, deps);
      const filtered = filterWorktreeRepos(inventory);
      deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.scan-roots', {
        updated: true,
        count: filtered.repos.length,
        selectedRepo: filtered.selectedRepo,
        storage: filtered.storage,
        workspaceScan: filtered.workspaceScan,
        repos: filtered.repos,
      }));
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.repos.scan-roots',
      String(error.message || error),
    ));
}

function handleCatalogRepoRegister(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = normalizeRepoInventoryBody(body);
      if (!request.repoPath) {
        throw Object.assign(new Error('repoPath is required'), { statusCode: 400 });
      }
      const result = deps.repoInventory.registerRepo({
        copilotHome: ctx.copilotHomeAbs,
        engineRoot: ctx.engineRoot,
        repoPath: request.repoPath,
        repoLabel: request.repoLabel,
        select: request.select,
      });
      deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.register', {
        registered: true,
        repo: result.repo,
        selectedRepo: result.inventory.selectedRepo,
        storage: result.inventory.storage,
        workspaceScan: result.inventory.workspaceScan,
      }));
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.repos.register',
      String(error.message || error),
    ));
}

function handleCatalogRepoUnregister(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = normalizeRepoInventoryBody(body);
      const result = deps.repoInventory.unregisterRepo({
        copilotHome: ctx.copilotHomeAbs,
        engineRoot: ctx.engineRoot,
        repoId: request.repoId,
        repoPath: request.repoPath,
      });
      deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.unregister', {
        removed: true,
        repo: result.removed,
        selectionCleared: result.selectionCleared,
        selectedRepo: result.inventory.selectedRepo,
        storage: result.inventory.storage,
        workspaceScan: result.inventory.workspaceScan,
      }));
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.repos.unregister',
      String(error.message || error),
    ));
}

function handleCatalogRepoSelect(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = normalizeRepoInventoryBody(body);
      const result = deps.repoInventory.selectRepo({
        copilotHome: ctx.copilotHomeAbs,
        engineRoot: ctx.engineRoot,
        repoId: request.repoId,
        repoPath: request.repoPath,
        clear: request.clear,
      });
      deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.select', {
        selected: Boolean(result.repo),
        repo: result.repo,
        selectedRepo: result.inventory.selectedRepo,
        storage: result.inventory.storage,
        workspaceScan: result.inventory.workspaceScan,
      }));
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.repos.select',
      String(error.message || error),
    ));
}

function handleCatalogRepoRefresh(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then((body) => {
      const request = normalizeRepoInventoryBody(body);
      const inventory = listRepoInventory(ctx, deps, {
        explicitRepoPaths: explicitRepoPathsFromRequest(ctx.u.searchParams, body),
      });
      const repo = deps.repoInventory.resolveRepoEntry(inventory, {
        repoId: request.repoId || normalizeString(ctx.u.searchParams.get('repoId')),
        repoPath: request.repoPath || normalizeString(ctx.u.searchParams.get('repoPath')),
      });
      if (!repo) {
        throw Object.assign(new Error('Unknown repo selection for refresh'), { statusCode: 404 });
      }
      if (!repo.repoPath) {
        throw Object.assign(new Error(`Repo path is unknown for ${repo.repoId || 'selected repo'}`), { statusCode: 400 });
      }

      const selector = {
        repoId: repo.repoId,
        repoPath: repo.repoPath,
      };
      const catalogOptions = buildCatalogOptions(ctx, selector);
      const previousSnapshot = deps.catalogProjection.loadCatalogProjectionSnapshot(catalogOptions);
      const snapshot = rebuildProjection(ctx, deps, selector, 'catalog_repo_refresh');
      const projectionContext = {
        storage: deps.catalogProjection.resolveProjectionStorage(catalogOptions),
        readMode: 'persisted-snapshot',
      };
      const lifecycleAudit = recordProjectionLifecycleEvents(ctx.copilotHomeAbs, previousSnapshot, snapshot, deps);
      const audit = recordAuditEvent(ctx, deps, {
        eventType: 'catalog.repo.refreshed',
        repoId: repo.repoId || null,
        scope: {
          kind: 'repo',
          repoId: repo.repoId,
          repoPath: repo.repoPath,
          displayName: repo.repoLabel,
        },
        details: {
          stats: snapshot?.stats || null,
          warningCount: Array.isArray(snapshot?.warnings) ? snapshot.warnings.length : 0,
          durationMs: deps.catalogRuntimeState.lastDurationMs,
          scanStatus: repo.scanStatus,
        },
      });
      const refreshedInventory = listRepoInventory(ctx, deps, {
        explicitRepoPaths: [repo.repoPath],
      });
      const refreshedRepo = deps.repoInventory.resolveRepoEntry(refreshedInventory, selector);

      deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.refresh', {
        refreshed: true,
        repo: refreshedRepo,
        selectedRepo: refreshedInventory.selectedRepo,
        storage: refreshedInventory.storage,
        workspaceScan: refreshedInventory.workspaceScan,
        audit: {
          logged: audit.logged,
          path: audit.path,
          eventId: audit.event.eventId,
          lifecycleEventIds: lifecycleAudit
            .filter((entry) => entry && entry.logged && entry.event?.eventId)
            .map((entry) => entry.event.eventId),
          lifecycleErrors: lifecycleAudit
            .filter((entry) => entry && entry.error)
            .map((entry) => entry.error),
          error: audit.error || null,
        },
        snapshot: buildSnapshotEnvelope(snapshot, projectionContext, deps, deps.catalogRuntimeState),
      }));
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.repos.refresh',
      String(error.message || error),
    ));
}

function sendJsonError(res, sendJson, statusCode, kind, error) {
  sendJson(res, statusCode, {
    kind,
    deterministic: true,
    error,
  });
}

function collectManifestAssetIdsForHarness(engineRoot, harnessId) {
  const MANIFEST_FILE_BY_HARNESS = {
    codex: 'codex-assets/manifest.json',
    opencode: 'opencode-assets/manifest.json',
    antigravity: 'antigravity-assets/manifest.json',
  };
  const fileName = MANIFEST_FILE_BY_HARNESS[harnessId];
  if (!fileName) return [];
  const manifestScan = loadManifestDocument(engineRoot, fileName);
  const assets = expandManifestAssets(engineRoot, manifestScan.document);
  return assets
    .map((asset) => normalizeString(asset?.id))
    .filter(Boolean);
}

function handleHarnessOptIn(ctx, deps) {
  deps.readJsonBody(ctx.req)
    .then(async (body) => {
      const target = normalizeString(body?.target).toLowerCase();
      const optIn = body?.optIn === true;
      if (!['codex', 'opencode', 'antigravity'].includes(target)) {
        throw Object.assign(new Error('target must be codex, opencode, or antigravity'), { statusCode: 400 });
      }

      if (optIn) {
        const installOptions = {
          target,
          dryRun: false,
          force: false,
          pointerMode: body?.pointerMode !== false,
          engineRoot: deps.engineRoot || ctx.engineRoot,
          codexHome: ctx.codexHome,
          codexSkillsHome: ctx.codexSkillsHome,
          geminiHome: ctx.geminiHome,
          antigravityHome: ctx.antigravityHome,
          antigravitySkillsHome: ctx.antigravitySkillsHome,
          opencodeHome: ctx.opencodeHome,
          opencodeSkillsHome: ctx.opencodeSkillsHome,
        };
        await deps.installSurfaces(installOptions);
        const managedAssetIds = collectManifestAssetIdsForHarness(deps.engineRoot || ctx.engineRoot, target);
        installLedgerLib.setHarnessOptIn(ctx.copilotHomeAbs, target, managedAssetIds);
      } else {
        installLedgerLib.removeHarnessOptIn(ctx.copilotHomeAbs, target);
      }

      rebuildProjection(ctx, deps, {}, 'harness_opt_in');

      deps.sendJson(ctx.res, 200, {
        kind: 'catalog.harness_opt_in',
        deterministic: true,
        target,
        optedIn: optIn,
        assetCount: optIn ? collectManifestAssetIdsForHarness(deps.engineRoot || ctx.engineRoot, target).length : 0,
      });
    })
    .catch((error) => sendJsonError(
      ctx.res,
      deps.sendJson,
      error.statusCode || 500,
      'catalog.harness_opt_in',
      String(error.message || error),
    ));
}

function register(deps = {}) {
  const resolvedDeps = {
    childProcess: deps.childProcess || childProcess,
    fs: deps.fs || fs,
    path: deps.path || path,
    process: deps.process || process,
    crypto: deps.crypto || crypto,
    engineRoot: deps.engineRoot || process.cwd(),
    catalogProjection: deps.catalogProjection || catalogProjectionLib,
    catalogMutation: deps.catalogMutation || catalogMutationLib,
    externalSources: deps.externalSources || externalSourcesLib,
    providerCatalog: deps.providerCatalog || providerCatalogLib,
    executeProviderCommand: deps.executeProviderCommand,
    fetch: deps.fetch || globalThis.fetch,
    repoInventory: deps.repoInventory || repoInventoryLib,
    repoDiscovery: deps.repoDiscovery || repoDiscoveryLib,
    sendJson: deps.sendJson || defaultSendJson,
    sendText: deps.sendText || defaultSendText,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    catalogRuntimeState: deps.catalogRuntimeState || createCatalogRuntimeState(),
    installSurfaces: deps.installSurfaces || defaultInstallSurfaces,
    catalogPolicy: deps.catalogPolicy || catalogPolicyService,
  };

  return [
    {
      method: 'GET',
      path: '/api/catalog/repos',
      handler: (ctx) => handleCatalogReposList(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/repos/register',
      handler: (ctx) => handleCatalogRepoRegister(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/repos/scan-roots',
      handler: (ctx) => handleCatalogRepoScanRoots(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/repos/unregister',
      handler: (ctx) => handleCatalogRepoUnregister(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/repos/select',
      handler: (ctx) => handleCatalogRepoSelect(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/repos/refresh',
      handler: (ctx) => handleCatalogRepoRefresh(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/summary',
      handler: (ctx) => handleCatalogSummary(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/sources',
      handler: (ctx) => handleCatalogSourcesList(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/content',
      handler: (ctx) => handleCatalogContent(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/catalog\/sources\/([^/]+)$/,
      handler: (ctx) => handleCatalogSourceDetail(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/assets',
      handler: (ctx) => handleCatalogAssets(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/bundles',
      handler: (ctx) => handleCatalogBundles(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/catalog\/assets\/([^/]+)$/,
      handler: (ctx) => handleCatalogAssetDetail(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/catalog/entries',
      handler: (ctx) => handleCatalogEntries(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/refresh',
      handler: (ctx) => handleCatalogRefresh(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/add',
      handler: (ctx) => handleCatalogSourceAdd(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/remove',
      handler: (ctx) => handleCatalogSourceRemove(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/refresh',
      handler: (ctx) => handleCatalogSourceRefresh(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/activate',
      handler: (ctx) => handleCatalogSourceActivate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/deactivate',
      handler: (ctx) => handleCatalogSourceDeactivate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/sources/sync-install-verify',
      handler: (ctx) => handleCatalogSourceSyncInstallVerify(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/tools/spec-kit/bootstrap',
      handler: (ctx) => handleCatalogSpecKitBootstrap(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/harness-opt-in',
      handler: (ctx) => handleHarnessOptIn(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/create',
      handler: (ctx) => handleCatalogAssetCreate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/update',
      handler: (ctx) => handleCatalogAssetUpdate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/delete',
      handler: (ctx) => handleCatalogAssetDelete(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/install',
      handler: (ctx) => handleCatalogAssetInstall(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/bundles/uninstall',
      handler: (ctx) => handleCatalogBundleUninstall(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/providers/install',
      handler: (ctx) => handleCatalogProviderInstall(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/enable',
      handler: (ctx) => handleCatalogAssetEnable(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/assets/disable',
      handler: (ctx) => handleCatalogAssetDisable(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/activation',
      handler: (ctx) => handleCatalogActivationUpdate(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/catalog/route/explain',
      handler: (ctx) => handleRouteExplain(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/search/query',
      handler: (ctx) => handleSearchQuery(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/search/selection',
      handler: (ctx) => handleSearchSelection(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/audit/assets',
      handler: (ctx) => handleAuditAssets(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/audit/events',
      handler: (ctx) => handleAuditEvents(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/runtime/catalog-health',
      handler: (ctx) => handleRuntimeCatalogHealth(ctx, resolvedDeps),
    },
  ];
}

module.exports = {
  register,
};
