'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  applyActivationToBundles,
  buildRoutingPolicySnapshot,
  resolveCatalogActivationState,
} = require('../lib/catalogActivationState');
const catalogProjectionLib = require('../lib/catalogProjectionService');
const catalogMutationLib = require('../lib/catalogMutationService');
const repoInventoryLib = require('../lib/repoInventoryService');
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
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const MAX_AUDIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

function safeStat(absPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(absPath);
  } catch {
    return null;
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
  const hasPersistedSnapshot = Boolean(persistedSnapshot);
  const shouldBuildFallback = options.allowFallback !== false && !persistedSnapshot;
  let snapshot = persistedSnapshot;
  let readMode = hasPersistedSnapshot ? 'persisted-snapshot' : 'missing';
  let buildError = null;

  if (shouldBuildFallback) {
    try {
      snapshot = deps.catalogProjection.buildCatalogProjection(catalogOptions);
      readMode = 'filesystem-fallback';
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
  const inputFiles = {
    manifest: describeFile(snapshot?.inputs?.manifestPath, deps.fs),
    metadataIndex: describeFile(snapshot?.inputs?.metadataIndexPath, deps.fs),
    registry: describeFile(snapshot?.inputs?.registryPath, deps.fs),
    providerCatalog: describeFile(snapshot?.inputs?.providerCatalogPath, deps.fs),
    providerState: describeFile(snapshot?.inputs?.providerStatePath, deps.fs),
    snapshot: describeFile(projectionContext.storage.snapshotPath, deps.fs),
  };
  const warnings = summarizeWarnings(snapshot);

  return {
    schemaVersion: snapshot?.schemaVersion || null,
    generatedAt: snapshot?.generatedAt || null,
    readMode: projectionContext.readMode,
    repoContext: snapshot?.repoContext || projectionContext.storage.repoContext || null,
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
  deps.sendJson(ctx.res, 200, {
    kind: 'catalog.summary',
    deterministic: true,
    summary: buildSnapshotEnvelope(
      projectionContext.snapshot,
      projectionContext,
      deps,
      deps.catalogRuntimeState,
      { activation, routingPolicy },
    ),
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

      const searchResponse = request.kind === 'skill'
        ? searchSkills(request, {
          snapshot: projectionContext.snapshot,
          copilotHome: ctx.copilotHomeAbs,
          routingPolicy,
          repoId: request.repoId || projectionContext.snapshot?.repoContext?.repoId,
          repoPath: request.repoPath || projectionContext.snapshot?.repoContext?.repoPath,
          workspaceId: request.workspaceId || undefined,
          workspacePath: request.workspacePath || undefined,
        })
        : {
          results: buildSearchResults(projectionContext.snapshot, request, routingPolicy),
          routingPolicy: routingPolicy
            ? {
              ...routingPolicy,
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
        routingPolicy: searchResponse.routingPolicy || null,
        snapshot: buildSnapshotEnvelope(
          projectionContext.snapshot,
          projectionContext,
          deps,
          deps.catalogRuntimeState,
          { activation, routingPolicy: searchResponse.routingPolicy || routingPolicy || null },
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
  deps.sendJson(ctx.res, 200, buildRepoInventoryResponse('catalog.repos.list', {
    count: inventory.repos.length,
    selectedRepo: inventory.selectedRepo,
    storage: inventory.storage,
    repos: inventory.repos,
  }));
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

function register(deps = {}) {
  const resolvedDeps = {
    fs: deps.fs || fs,
    path: deps.path || path,
    crypto: deps.crypto || crypto,
    catalogProjection: deps.catalogProjection || catalogProjectionLib,
    catalogMutation: deps.catalogMutation || catalogMutationLib,
    repoInventory: deps.repoInventory || repoInventoryLib,
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    catalogRuntimeState: deps.catalogRuntimeState || createCatalogRuntimeState(),
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
