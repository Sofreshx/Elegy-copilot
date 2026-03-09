'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  getRepoStateKey,
  resolveProjectionStorage,
} = require('./catalogProjectionService');
const sessions = require('./sessions');
const {
  loadSkillSearchTelemetry,
  telemetryStoragePath,
} = require('./skillSearchService');

const CATALOG_AUDIT_EVENT_CONTRACT_VERSION = 'catalog_asset_audit_v1';
const ASSET_AUDIT_ANALYTICS_CONTRACT_VERSION = 'asset_audit_analytics_v1';
const DEFAULT_AUDIT_LIMIT = 50;
const DEFAULT_ANALYTICS_RECENT_LIMIT = 25;
const MAX_AUDIT_BYTES = 4 * 1024 * 1024;
const MAX_RECENT_PER_ASSET = 12;
const MAX_USAGE_EVENTS = 500;

function safeStat(absPath, fsImpl = fs) {
  try {
    return fsImpl.statSync(absPath);
  } catch {
    return null;
  }
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

function resolveCatalogAuditLogPath(copilotHomeAbs, pathImpl = path) {
  return pathImpl.join(path.resolve(copilotHomeAbs), 'catalog', 'audit', 'events.jsonl');
}

function createAuditEventId(cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return cryptoImpl.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampString(value, maxLength = 240) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return undefined;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object') {
    return {
      kind: 'system',
      id: 'catalog-audit-analytics',
      label: 'catalog-audit-analytics',
    };
  }
  return {
    kind: clampString(actor.kind, 64) || 'system',
    id: clampString(actor.id, 128) || clampString(actor.label, 128) || 'catalog-audit-analytics',
    label: clampString(actor.label, 128) || clampString(actor.id, 128) || 'catalog-audit-analytics',
  };
}

function sanitizeList(values, maxItems = 8, maxLength = 64) {
  if (!Array.isArray(values)) {
    return [];
  }
  const out = [];
  for (const value of values) {
    const normalized = clampString(value, maxLength);
    if (!normalized || out.includes(normalized)) {
      continue;
    }
    out.push(normalized);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function sanitizeSearchPayload(search) {
  if (!search || typeof search !== 'object') {
    return undefined;
  }
  const query = search.query && typeof search.query === 'object'
    ? {
      query: clampString(search.query.query, 160),
      repoId: clampString(search.query.repoId, 128),
      workspaceId: clampString(search.query.workspaceId, 128),
      frameworks: sanitizeList(search.query.frameworks),
      stacks: sanitizeList(search.query.stacks),
      languages: sanitizeList(search.query.languages),
      tags: sanitizeList(search.query.tags),
      limit: Number.isFinite(search.query.limit) ? Math.max(1, Math.floor(search.query.limit)) : undefined,
      includeVaultOnly: typeof search.query.includeVaultOnly === 'boolean' ? search.query.includeVaultOnly : undefined,
      includeDisabled: typeof search.query.includeDisabled === 'boolean' ? search.query.includeDisabled : undefined,
      includeDeprecated: typeof search.query.includeDeprecated === 'boolean' ? search.query.includeDeprecated : undefined,
      preferLoadMode: clampString(search.query.preferLoadMode, 32),
      sessionId: clampString(search.query.sessionId, 128),
      correlationId: clampString(search.query.correlationId, 128),
    }
    : undefined;
  const sanitized = {
    ...(query ? { query } : {}),
    ...(Number.isFinite(search.resultCount) ? { resultCount: Math.max(0, Math.floor(search.resultCount)) } : {}),
    ...(clampString(search.selectedAssetId, 128) ? { selectedAssetId: clampString(search.selectedAssetId, 128) } : {}),
    ...(clampString(search.missReason, 64) ? { missReason: clampString(search.missReason, 64) } : {}),
  };
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function sanitizeDetails(details) {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (value == null) {
      continue;
    }
    if (key.toLowerCase().includes('path')) {
      continue;
    }
    if (typeof value === 'string') {
      const normalized = clampString(value, 240);
      if (normalized) {
        out[key] = normalized;
      }
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      if (key === 'topResults') {
        out[key] = value
          .filter((entry) => entry && typeof entry === 'object')
          .slice(0, 5)
          .map((entry) => ({
            ...(clampString(entry.assetId, 128) ? { assetId: clampString(entry.assetId, 128) } : {}),
            ...(clampString(entry.assetKey, 128) ? { assetKey: clampString(entry.assetKey, 128) } : {}),
            ...(Number.isFinite(entry.score) ? { score: Number(entry.score) } : {}),
            ...(Number.isFinite(entry.rank) ? { rank: Math.max(1, Math.floor(entry.rank)) } : {}),
            explanationCodes: sanitizeList(entry.explanationCodes, 8, 48),
          }));
      } else {
        const sanitized = sanitizeList(value, 12, 128);
        if (sanitized.length) {
          out[key] = sanitized;
        }
      }
      continue;
    }
    if (typeof value === 'object') {
      if (key === 'stats') {
        const stats = {};
        for (const [statsKey, statsValue] of Object.entries(value)) {
          if (typeof statsValue === 'number' || typeof statsValue === 'boolean') {
            stats[statsKey] = statsValue;
          }
        }
        if (Object.keys(stats).length) {
          out[key] = stats;
        }
      }
    }
  }

  return Object.keys(out).length ? out : undefined;
}

function sanitizeScope(scope) {
  if (!scope || typeof scope !== 'object') {
    return undefined;
  }
  const kind = clampString(scope.kind, 32);
  if (!kind) {
    return undefined;
  }
  const out = {
    kind,
  };
  const repoId = clampString(scope.repoId, 128);
  if (repoId) {
    out.repoId = repoId;
  }
  const workspaceId = clampString(scope.workspaceId, 128);
  if (workspaceId) {
    out.workspaceId = workspaceId;
  }
  const displayName = clampString(scope.displayName || scope.repoLabel, 128);
  if (displayName) {
    out.displayName = displayName;
  }
  return out;
}

function createCatalogAuditEvent(eventInput = {}, deps = {}) {
  const cryptoImpl = deps.crypto || crypto;
  return {
    schemaVersion: 1,
    contractVersion: CATALOG_AUDIT_EVENT_CONTRACT_VERSION,
    deterministic: true,
    eventId: createAuditEventId(cryptoImpl),
    eventType: clampString(eventInput.eventType, 128) || 'unspecified',
    occurredAt: new Date().toISOString(),
    actor: normalizeActor(eventInput.actor),
    ...(clampString(eventInput.assetId, 128) ? { assetId: clampString(eventInput.assetId, 128) } : {}),
    ...(clampString(eventInput.assetKey, 128) ? { assetKey: clampString(eventInput.assetKey, 128) } : {}),
    ...(clampString(eventInput.assetKind, 32) ? { assetKind: clampString(eventInput.assetKind, 32) } : {}),
    ...(sanitizeScope(eventInput.scope) ? { scope: sanitizeScope(eventInput.scope) } : {}),
    ...(clampString(eventInput.repoId, 128) ? { repoId: clampString(eventInput.repoId, 128) } : {}),
    ...(clampString(eventInput.sessionId, 128) ? { sessionId: clampString(eventInput.sessionId, 128) } : {}),
    ...(clampString(eventInput.correlationId, 128) ? { correlationId: clampString(eventInput.correlationId, 128) } : {}),
    ...(sanitizeSearchPayload(eventInput.search) ? { search: sanitizeSearchPayload(eventInput.search) } : {}),
    ...(sanitizeDetails(eventInput.details) ? { details: sanitizeDetails(eventInput.details) } : {}),
    ...(clampString(eventInput.source, 64) ? { source: clampString(eventInput.source, 64) } : {}),
  };
}

function appendCatalogAuditEvent(copilotHomeAbs, eventInput, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  const auditLogPath = resolveCatalogAuditLogPath(copilotHomeAbs, pathImpl);
  const event = createCatalogAuditEvent(eventInput, deps);
  try {
    fsImpl.mkdirSync(pathImpl.dirname(auditLogPath), { recursive: true });
    fsImpl.appendFileSync(auditLogPath, `${JSON.stringify(event)}\n`, 'utf8');
    return {
      logged: true,
      path: auditLogPath,
      event,
    };
  } catch (error) {
    return {
      logged: false,
      path: auditLogPath,
      event,
      error: String(error && error.message ? error.message : error),
    };
  }
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

      for (let index = 0; index < buffer.length; index += 1) {
        if (buffer[index] === 10) {
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

function readCatalogAuditEvents(copilotHomeAbs, limit = DEFAULT_AUDIT_LIMIT, deps = {}) {
  const fsImpl = deps.fs || fs;
  const pathImpl = deps.path || path;
  return tailJsonlLines(resolveCatalogAuditLogPath(copilotHomeAbs, pathImpl), limit, fsImpl)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function assetFingerprint(asset) {
  if (!asset || typeof asset !== 'object') {
    return null;
  }
  const selectedEntry = asset.selectedEntry || {};
  const contentHash = asset.installState?.contentHash
    || selectedEntry.installState?.contentHash
    || null;
  return JSON.stringify({
    assetId: asset.assetId || null,
    selectedLayer: asset.selectedLayer || selectedEntry.layer || null,
    enabled: asset.enabled === false ? false : true,
    installed: Boolean(asset.installed),
    available: Boolean(asset.available),
    contentHash,
    title: selectedEntry.title || null,
    description: selectedEntry.description || null,
    recommendationCount: Array.isArray(asset.recommendations) ? asset.recommendations.length : 0,
    reasonCodes: Array.isArray(asset.reasons) ? asset.reasons.map((reason) => reason && reason.code).filter(Boolean) : [],
  });
}

function toAssetAuditShape(asset) {
  if (!asset || typeof asset !== 'object') {
    return null;
  }
  return {
    assetId: asset.assetId,
    assetKey: asset.assetKey,
    assetKind: asset.kind,
    repoId: asset.scope?.repoId,
    scope: asset.scope,
  };
}

function diffProjectionLifecycleEvents(previousSnapshot, nextSnapshot) {
  const previousAssets = new Map(
    (Array.isArray(previousSnapshot?.effectiveAssets) ? previousSnapshot.effectiveAssets : [])
      .filter((asset) => asset && asset.assetId)
      .map((asset) => [asset.assetId, asset]),
  );
  const nextAssets = new Map(
    (Array.isArray(nextSnapshot?.effectiveAssets) ? nextSnapshot.effectiveAssets : [])
      .filter((asset) => asset && asset.assetId)
      .map((asset) => [asset.assetId, asset]),
  );
  const events = [];
  const assetIds = new Set([...previousAssets.keys(), ...nextAssets.keys()]);

  for (const assetId of assetIds) {
    const previousAsset = previousAssets.get(assetId);
    const nextAsset = nextAssets.get(assetId);

    if (!previousAsset && nextAsset && nextAsset.selectedLayer === 'repo-local') {
      events.push({
        eventType: 'asset.lifecycle.created',
        source: 'projection-diff',
        ...toAssetAuditShape(nextAsset),
        details: {
          selectedLayer: nextAsset.selectedLayer,
          reason: 'repo_local_asset_detected',
        },
      });
      continue;
    }

    if (previousAsset && !nextAsset && previousAsset.selectedLayer === 'repo-local') {
      events.push({
        eventType: 'asset.lifecycle.removed',
        source: 'projection-diff',
        ...toAssetAuditShape(previousAsset),
        details: {
          selectedLayer: previousAsset.selectedLayer,
          reason: 'repo_local_asset_removed',
        },
      });
      continue;
    }

    if (!previousAsset || !nextAsset) {
      continue;
    }

    if (previousAsset.enabled !== nextAsset.enabled) {
      events.push({
        eventType: nextAsset.enabled ? 'asset.lifecycle.enabled' : 'asset.lifecycle.disabled',
        source: 'projection-diff',
        ...toAssetAuditShape(nextAsset),
        details: {
          selectedLayer: nextAsset.selectedLayer,
          reason: nextAsset.enabled ? 'overlay_state_enabled' : 'overlay_state_disabled',
        },
      });
    }

    const previousRepoLocal = previousAsset.selectedLayer === 'repo-local';
    const nextRepoLocal = nextAsset.selectedLayer === 'repo-local';

    if (!previousRepoLocal && nextRepoLocal) {
      events.push({
        eventType: 'asset.lifecycle.created',
        source: 'projection-diff',
        ...toAssetAuditShape(nextAsset),
        details: {
          selectedLayer: nextAsset.selectedLayer,
          reason: 'repo_local_override_created',
        },
      });
      continue;
    }

    if (previousRepoLocal && !nextRepoLocal) {
      events.push({
        eventType: 'asset.lifecycle.removed',
        source: 'projection-diff',
        ...toAssetAuditShape(previousAsset),
        details: {
          selectedLayer: previousAsset.selectedLayer,
          reason: 'repo_local_override_removed',
        },
      });
      continue;
    }

    if (previousRepoLocal && nextRepoLocal && assetFingerprint(previousAsset) !== assetFingerprint(nextAsset)) {
      events.push({
        eventType: 'asset.lifecycle.updated',
        source: 'projection-diff',
        ...toAssetAuditShape(nextAsset),
        details: {
          selectedLayer: nextAsset.selectedLayer,
          reason: 'repo_local_content_changed',
        },
      });
    }
  }

  return events;
}

function recordProjectionLifecycleEvents(copilotHomeAbs, previousSnapshot, nextSnapshot, deps = {}) {
  const lifecycleEvents = diffProjectionLifecycleEvents(previousSnapshot, nextSnapshot);
  return lifecycleEvents.map((event) => appendCatalogAuditEvent(copilotHomeAbs, event, deps));
}

function addRecent(list, event, limit) {
  if (!event) {
    return;
  }
  list.push(event);
  list.sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')));
  if (list.length > limit) {
    list.length = limit;
  }
}

function createAssetSummary(asset) {
  const selectedEntry = asset?.selectedEntry || {};
  return {
    assetId: asset.assetId,
    assetKey: asset.assetKey,
    kind: asset.kind,
    current: {
      enabled: Boolean(asset.enabled),
      installed: Boolean(asset.installed),
      available: Boolean(asset.available),
      recommended: Boolean(asset.recommended),
      selectedLayer: asset.selectedLayer || null,
      scope: asset.scope || null,
      title: selectedEntry.title || null,
      description: selectedEntry.description || null,
    },
    lifecycle: {
      counts: {
        created: 0,
        updated: 0,
        removed: 0,
        installed: 0,
        enabled: 0,
        disabled: 0,
      },
      lastEventAt: null,
    },
    search: {
      sampled: {
        queryCount: 0,
        resultCount: 0,
        selectedCount: 0,
        missCount: 0,
      },
      lastEventAt: null,
    },
    usage: {
      invocationCount: 0,
      sessionCount: 0,
      repoCount: 0,
    },
    activity: {
      repoIds: [],
      sessionIds: [],
    },
    recentEvents: [],
  };
}

function ensureAssetSummary(assetMap, assetId, extras = {}) {
  if (!assetId) {
    return null;
  }
  if (!assetMap.has(assetId)) {
    assetMap.set(assetId, {
      assetId,
      assetKey: extras.assetKey || null,
      kind: extras.kind || extras.assetKind || null,
      current: {
        enabled: false,
        installed: false,
        available: false,
        recommended: false,
        selectedLayer: null,
        scope: extras.scope || null,
        title: null,
        description: null,
      },
      lifecycle: {
        counts: {
          created: 0,
          updated: 0,
          removed: 0,
          installed: 0,
          enabled: 0,
          disabled: 0,
        },
        lastEventAt: null,
      },
      search: {
        sampled: {
          queryCount: 0,
          resultCount: 0,
          selectedCount: 0,
          missCount: 0,
        },
        lastEventAt: null,
      },
      usage: {
        invocationCount: 0,
        sessionCount: 0,
        repoCount: 0,
      },
      activity: {
        repoIds: [],
        sessionIds: [],
      },
      recentEvents: [],
    });
  }
  return assetMap.get(assetId);
}

function ensureRepoSummary(repoMap, repoId, extras = {}) {
  const key = clampString(repoId, 128) || 'unscoped';
  if (!repoMap.has(key)) {
    repoMap.set(key, {
      repoId: key === 'unscoped' ? null : key,
      repoLabel: extras.repoLabel || null,
      assetIds: new Set(),
      sessionIds: new Set(),
      lifecycle: {
        created: 0,
        updated: 0,
        removed: 0,
        installed: 0,
        enabled: 0,
        disabled: 0,
      },
      search: {
        queryCount: 0,
        resultCount: 0,
        selectedCount: 0,
        missCount: 0,
      },
      usage: {
        invocationCount: 0,
      },
      lastEventAt: null,
    });
  }
  return repoMap.get(key);
}

function ensureSessionSummary(sessionMap, sessionId, extras = {}) {
  const key = clampString(sessionId, 128) || 'unknown-session';
  if (!sessionMap.has(key)) {
    sessionMap.set(key, {
      sessionId: key === 'unknown-session' ? null : key,
      status: extras.status || null,
      startTime: extras.startTime || null,
      lastEventTime: extras.lastEventTime || null,
      repoId: extras.repoId || null,
      repoLabel: extras.repoLabel || null,
      assetIds: new Set(),
      search: {
        queryCount: 0,
        resultCount: 0,
        selectedCount: 0,
        missCount: 0,
      },
      usage: {
        invocationCount: 0,
      },
    });
  }
  return sessionMap.get(key);
}

function noteActivity(summary, repoId, sessionId) {
  if (repoId && !summary.activity.repoIds.includes(repoId)) {
    summary.activity.repoIds.push(repoId);
    summary.activity.repoIds.sort((left, right) => left.localeCompare(right));
  }
  if (sessionId && !summary.activity.sessionIds.includes(sessionId)) {
    summary.activity.sessionIds.push(sessionId);
    summary.activity.sessionIds.sort((left, right) => left.localeCompare(right));
  }
}

function updateLifecycleSummary(summary, bucket, occurredAt) {
  if (!summary || !bucket) {
    return;
  }
  summary.lifecycle.counts[bucket] = (summary.lifecycle.counts[bucket] || 0) + 1;
  if (!summary.lifecycle.lastEventAt || String(occurredAt || '') > String(summary.lifecycle.lastEventAt || '')) {
    summary.lifecycle.lastEventAt = occurredAt || summary.lifecycle.lastEventAt;
  }
}

function updateSearchSummary(summary, bucket, occurredAt, amount = 1) {
  if (!summary || !bucket) {
    return;
  }
  summary.search.sampled[bucket] = (summary.search.sampled[bucket] || 0) + amount;
  if (!summary.search.lastEventAt || String(occurredAt || '') > String(summary.search.lastEventAt || '')) {
    summary.search.lastEventAt = occurredAt || summary.search.lastEventAt;
  }
}

function sessionDir(copilotHomeAbs, sessionId, pathImpl = path) {
  return pathImpl.join(path.resolve(copilotHomeAbs), 'session-state', String(sessionId || ''));
}

function resolveRepoContextFromSession(session) {
  const cwd = typeof session?.cwd === 'string' && session.cwd.trim() ? session.cwd.trim() : '';
  const repo = typeof session?.repo === 'string' && session.repo.trim() ? session.repo.trim() : '';
  const candidate = cwd || repo;
  if (!candidate || !path.isAbsolute(candidate)) {
    return null;
  }
  return getRepoStateKey(candidate);
}

function buildAssetAliasMap(snapshot) {
  const aliasMap = new Map();
  const effectiveAssets = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
  for (const asset of effectiveAssets) {
    if (!asset || !asset.assetId) {
      continue;
    }
    const aliases = new Set([
      asset.assetId,
      asset.assetKey,
      ...(Array.isArray(asset.selectedEntry?.metadata?.aliasKeys) ? asset.selectedEntry.metadata.aliasKeys : []),
      ...(Array.isArray(asset.metadata?.aliasKeys) ? asset.metadata.aliasKeys : []),
    ]);
    for (const alias of aliases) {
      const normalized = String(alias || '').trim().toLowerCase();
      if (normalized && !aliasMap.has(normalized)) {
        aliasMap.set(normalized, asset.assetId);
      }
    }
  }
  return aliasMap;
}

function filterEvents(events, filters = {}) {
  return events.filter((event) => {
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
  });
}

function buildAssetAuditAnalytics(options = {}) {
  const copilotHomeAbs = path.resolve(options.copilotHome || options.copilotHomeAbs || '~/.copilot');
  const snapshot = options.snapshot || null;
  const analyticsRecentLimit = Math.max(
    1,
    Number(options.recentLimit) || DEFAULT_ANALYTICS_RECENT_LIMIT,
  );
  const filters = options.filters && typeof options.filters === 'object' ? options.filters : {};
  const auditLogPath = resolveCatalogAuditLogPath(copilotHomeAbs);
  const searchTelemetryPath = telemetryStoragePath({
    copilotHome: copilotHomeAbs,
    repoId: options.repoId,
    repoPath: options.repoPath,
  });
  const auditEvents = filterEvents(
    readCatalogAuditEvents(copilotHomeAbs, Math.max(analyticsRecentLimit * 8, 200)),
    filters,
  );
  const { telemetry } = loadSkillSearchTelemetry({
    copilotHome: copilotHomeAbs,
    repoId: options.repoId,
    repoPath: options.repoPath,
  });
  const assetSummaries = new Map();
  const repoSummaries = new Map();
  const sessionSummaries = new Map();
  const recentEvents = [];
  const effectiveAssets = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
  const assetAliasMap = buildAssetAliasMap(snapshot);

  for (const asset of effectiveAssets) {
    assetSummaries.set(asset.assetId, createAssetSummary(asset));
  }

  const lifecycleBucketByEventType = {
    'asset.lifecycle.created': 'created',
    'asset.lifecycle.updated': 'updated',
    'asset.lifecycle.removed': 'removed',
    'asset.lifecycle.installed': 'installed',
    'asset.updated': 'updated',
    'asset.removed': 'removed',
    'asset.installed': 'installed',
    'asset.lifecycle.enabled': 'enabled',
    'asset.lifecycle.disabled': 'disabled',
  };

  for (const event of auditEvents) {
    const bucket = lifecycleBucketByEventType[event.eventType];
    const assetSummary = event.assetId
      ? ensureAssetSummary(assetSummaries, event.assetId, {
        assetKey: event.assetKey,
        assetKind: event.assetKind,
        scope: event.scope,
      })
      : null;
    const repoSummary = ensureRepoSummary(repoSummaries, event.repoId || event.scope?.repoId, {
      repoLabel: event.scope?.displayName,
    });

    if (bucket && assetSummary) {
      updateLifecycleSummary(assetSummary, bucket, event.occurredAt);
      noteActivity(assetSummary, event.repoId || event.scope?.repoId, event.sessionId);
      addRecent(assetSummary.recentEvents, { ...event, source: event.source || 'audit-log' }, MAX_RECENT_PER_ASSET);
    }
    if (bucket) {
      repoSummary.lifecycle[bucket] += 1;
      repoSummary.lastEventAt = event.occurredAt || repoSummary.lastEventAt;
      if (event.assetId) {
        repoSummary.assetIds.add(event.assetId);
      }
      if (event.sessionId) {
        repoSummary.sessionIds.add(event.sessionId);
      }
    }

    addRecent(recentEvents, { ...event, source: event.source || 'audit-log' }, analyticsRecentLimit);
  }

  const telemetryEvents = Array.isArray(telemetry?.recent) ? telemetry.recent.slice() : [];
  for (const event of telemetryEvents) {
    if (filters.eventType && event.eventType !== filters.eventType) {
      continue;
    }
    if (filters.repoId && event.repoId !== filters.repoId) {
      continue;
    }
    if (filters.sessionId && event.sessionId !== filters.sessionId) {
      continue;
    }
    if (filters.correlationId && event.correlationId !== filters.correlationId) {
      continue;
    }
    if (filters.assetId && event.assetId !== filters.assetId) {
      const topResults = Array.isArray(event.details?.topResults) ? event.details.topResults : [];
      if (!topResults.some((entry) => entry?.assetId === filters.assetId)) {
        continue;
      }
    }

    const repoSummary = ensureRepoSummary(repoSummaries, event.repoId);
    if (event.sessionId) {
      repoSummary.sessionIds.add(event.sessionId);
    }
    const sessionSummary = event.sessionId
      ? ensureSessionSummary(sessionSummaries, event.sessionId)
      : null;
    if (sessionSummary && event.repoId && !sessionSummary.repoId) {
      sessionSummary.repoId = event.repoId;
    }

    if (event.eventType === 'asset.search.query') {
      repoSummary.search.queryCount += 1;
      if (sessionSummary) {
        sessionSummary.search.queryCount += 1;
      }
    } else if (event.eventType === 'asset.search.miss') {
      repoSummary.search.missCount += 1;
      if (sessionSummary) {
        sessionSummary.search.missCount += 1;
      }
    } else if (event.eventType === 'asset.search.selected' && event.assetId) {
      const assetSummary = assetSummaries.get(event.assetId);
      const resolvedAssetSummary = assetSummary || ensureAssetSummary(assetSummaries, event.assetId, {
        assetKey: event.assetKey,
        assetKind: event.assetKind,
      });
      if (resolvedAssetSummary) {
        updateSearchSummary(resolvedAssetSummary, 'selectedCount', event.occurredAt, 1);
        noteActivity(resolvedAssetSummary, event.repoId, event.sessionId);
        addRecent(resolvedAssetSummary.recentEvents, { ...event, source: 'search-telemetry' }, MAX_RECENT_PER_ASSET);
      }
      repoSummary.search.selectedCount += 1;
      if (event.assetId) {
        repoSummary.assetIds.add(event.assetId);
      }
      if (sessionSummary) {
        sessionSummary.search.selectedCount += 1;
        sessionSummary.assetIds.add(event.assetId);
      }
    } else if (event.eventType === 'asset.search.result') {
      const topResults = Array.isArray(event.details?.topResults) ? event.details.topResults : [];
      repoSummary.search.resultCount += 1;
      if (sessionSummary) {
        sessionSummary.search.resultCount += 1;
      }
      for (const topResult of topResults) {
        if (!topResult?.assetId) {
          continue;
        }
        const assetSummary = ensureAssetSummary(assetSummaries, topResult.assetId, {
          assetKey: topResult.assetKey,
        });
        if (!assetSummary) {
          continue;
        }
        updateSearchSummary(assetSummary, 'resultCount', event.occurredAt, 1);
        noteActivity(assetSummary, event.repoId, event.sessionId);
        addRecent(assetSummary.recentEvents, {
          ...event,
          assetId: topResult.assetId,
          assetKey: topResult.assetKey,
          source: 'search-telemetry',
        }, MAX_RECENT_PER_ASSET);
        repoSummary.assetIds.add(topResult.assetId);
        if (sessionSummary) {
          sessionSummary.assetIds.add(topResult.assetId);
        }
      }
    }

    addRecent(recentEvents, { ...event, source: 'search-telemetry' }, analyticsRecentLimit);
  }

  const discoveredSessions = sessions.listSessions(copilotHomeAbs, {
    recentLimit: MAX_USAGE_EVENTS,
  });
  for (const session of discoveredSessions) {
    const repoContext = resolveRepoContextFromSession(session);
    const sessionSummary = ensureSessionSummary(sessionSummaries, session.id, {
      status: session.status,
      startTime: session.startTime,
      lastEventTime: session.lastEventTime,
      repoId: repoContext?.repoId,
      repoLabel: repoContext?.repoLabel,
    });
    if (repoContext?.repoId) {
      const repoSummary = ensureRepoSummary(repoSummaries, repoContext.repoId, { repoLabel: repoContext.repoLabel });
      repoSummary.sessionIds.add(session.id);
    }

    const usage = sessions.getAgentUsage(sessionDir(copilotHomeAbs, session.id), MAX_USAGE_EVENTS);
    for (const [rawAgentName, count] of Object.entries(usage)) {
      const normalizedName = String(rawAgentName || '').trim().toLowerCase();
      const assetId =
        assetAliasMap.get(normalizedName)
        || assetAliasMap.get(`agent-${normalizedName}`);
      if (!assetId) {
        continue;
      }
      const assetSummary = assetSummaries.get(assetId);
      if (!assetSummary) {
        continue;
      }
      const repoId = repoContext?.repoId || sessionSummary.repoId || null;
      assetSummary.usage.invocationCount += count;
      noteActivity(assetSummary, repoId, session.id);
      sessionSummary.usage.invocationCount += count;
      sessionSummary.assetIds.add(assetId);
      if (repoId) {
        const repoSummary = ensureRepoSummary(repoSummaries, repoId, { repoLabel: repoContext?.repoLabel });
        repoSummary.usage.invocationCount += count;
        repoSummary.assetIds.add(assetId);
        repoSummary.sessionIds.add(session.id);
      }
    }
  }

  for (const summary of assetSummaries.values()) {
    summary.usage.sessionCount = summary.activity.sessionIds.length;
    summary.usage.repoCount = summary.activity.repoIds.length;
  }

  const filteredAssets = Array.from(assetSummaries.values())
    .filter((summary) => {
      if (filters.assetId && summary.assetId !== filters.assetId) {
        return false;
      }
      if (filters.repoId && !summary.activity.repoIds.includes(filters.repoId) && summary.current.scope?.repoId !== filters.repoId) {
        return false;
      }
      if (filters.sessionId && !summary.activity.sessionIds.includes(filters.sessionId)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => left.assetId.localeCompare(right.assetId));

  const filteredRepos = Array.from(repoSummaries.values())
    .filter((summary) => {
      if (filters.repoId && summary.repoId !== filters.repoId) {
        return false;
      }
      if (filters.sessionId && !summary.sessionIds.has(filters.sessionId)) {
        return false;
      }
      if (filters.assetId && !summary.assetIds.has(filters.assetId)) {
        return false;
      }
      return true;
    })
    .map((summary) => ({
      ...summary,
      assetIds: Array.from(summary.assetIds).sort((left, right) => left.localeCompare(right)),
      sessionIds: Array.from(summary.sessionIds).sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => String(left.repoId || '').localeCompare(String(right.repoId || '')));

  const filteredSessions = Array.from(sessionSummaries.values())
    .filter((summary) => {
      if (filters.sessionId && summary.sessionId !== filters.sessionId) {
        return false;
      }
      if (filters.repoId && summary.repoId !== filters.repoId) {
        return false;
      }
      if (filters.assetId && !summary.assetIds.has(filters.assetId)) {
        return false;
      }
      return true;
    })
    .map((summary) => ({
      ...summary,
      assetIds: Array.from(summary.assetIds).sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => String(right.lastEventTime || '').localeCompare(String(left.lastEventTime || '')));

  const projectionStorage = resolveProjectionStorage({
    copilotHome: copilotHomeAbs,
    repoId: options.repoId,
    repoPath: options.repoPath,
  });

  return {
    contractVersion: ASSET_AUDIT_ANALYTICS_CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    deterministic: true,
    filters,
    storage: {
      auditLog: {
        path: auditLogPath,
        exists: Boolean(safeStat(auditLogPath)),
      },
      searchTelemetry: {
        path: searchTelemetryPath,
        exists: Boolean(safeStat(searchTelemetryPath)),
      },
      projection: {
        snapshotPath: projectionStorage.snapshotPath,
        repoContext: projectionStorage.repoContext || null,
      },
    },
    telemetry: {
      contractVersion: telemetry?.contractVersion || null,
      sample: telemetry?.sample || null,
      countersByEventType: telemetry?.countersByEventType || {},
      countersByMissReason: telemetry?.countersByMissReason || {},
    },
    stats: {
      assetCount: filteredAssets.length,
      repoCount: filteredRepos.length,
      sessionCount: filteredSessions.length,
      auditEventCount: auditEvents.length,
      sampledSearchEventCount: telemetryEvents.length,
    },
    assets: filteredAssets,
    repos: filteredRepos,
    sessions: filteredSessions,
    recentEvents,
  };
}

module.exports = {
  ASSET_AUDIT_ANALYTICS_CONTRACT_VERSION,
  CATALOG_AUDIT_EVENT_CONTRACT_VERSION,
  appendCatalogAuditEvent,
  buildAssetAuditAnalytics,
  createCatalogAuditEvent,
  diffProjectionLifecycleEvents,
  readCatalogAuditEvents,
  recordProjectionLifecycleEvents,
  resolveCatalogAuditLogPath,
};
