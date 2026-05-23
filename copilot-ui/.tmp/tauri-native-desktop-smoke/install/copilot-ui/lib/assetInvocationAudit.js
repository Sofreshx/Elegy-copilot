'use strict';

const {
  appendCatalogAuditEvent,
  readCatalogAuditEvents,
} = require('./catalogAuditAnalytics');
const {
  loadCatalogProjectionSnapshot,
} = require('./catalogProjectionService');
const {
  loadSkillSearchTelemetry,
} = require('./skillSearchService');

const SESSION_SKILL_USAGE_CONTRACT_VERSION = 'session_skill_usage_v1';
const DEFAULT_AUDIT_SCAN_LIMIT = 1000;

function clampString(value, maxLength = 128) {
  const text = String(value == null ? '' : value).trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, Math.max(0, maxLength));
}

function asObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function slugifyToken(value) {
  return clampString(value, 256)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildLookupKeys(value) {
  const raw = clampString(value, 256).toLowerCase();
  if (!raw) {
    return [];
  }

  const tail = raw.split(/[/:]+/).pop() || '';
  const stripped = raw.replace(/^(skill|agent|prompt)[-:_/]+/, '');
  const keys = new Set();

  for (const candidate of [raw, tail, stripped, slugifyToken(raw), slugifyToken(tail), slugifyToken(stripped)]) {
    const normalized = clampString(candidate, 256).toLowerCase();
    if (normalized) {
      keys.add(normalized);
    }
  }

  return Array.from(keys);
}

function uniqueStrings(values, maxItems = 8, maxLength = 128) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
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

function normalizeScope(scope) {
  const source = asObject(scope);
  if (!source) {
    return null;
  }

  const kind = clampString(source.kind, 32);
  if (!kind) {
    return null;
  }

  const out = { kind };
  const repoId = clampString(source.repoId, 128);
  if (repoId) {
    out.repoId = repoId;
  }
  const workspaceId = clampString(source.workspaceId, 128);
  if (workspaceId) {
    out.workspaceId = workspaceId;
  }
  const displayName = clampString(source.displayName || source.repoLabel, 128);
  if (displayName) {
    out.displayName = displayName;
  }
  return out;
}

function descriptorFromObject(input) {
  const source = asObject(input);
  if (!source) {
    return null;
  }

  const nestedAsset = asObject(source.asset);
  const nestedMetadata = asObject(source.metadata);
  const nestedCatalogAsset = asObject(source.catalogAsset);
  const nestedAssetMetadata = asObject(source.assetMetadata);
  const scope =
    normalizeScope(source.scope)
    || normalizeScope(nestedAsset?.scope)
    || normalizeScope(nestedMetadata?.scope)
    || normalizeScope(nestedCatalogAsset?.scope)
    || normalizeScope(nestedAssetMetadata?.scope);

  const assetId = clampString(
    source.assetId
      || nestedAsset?.assetId
      || nestedMetadata?.assetId
      || nestedCatalogAsset?.assetId
      || nestedAssetMetadata?.assetId,
    128,
  );
  const assetKey = clampString(
    source.assetKey
      || nestedAsset?.assetKey
      || nestedMetadata?.assetKey
      || nestedCatalogAsset?.assetKey
      || nestedAssetMetadata?.assetKey,
    128,
  );
  const assetKind = clampString(
    source.assetKind
      || source.kind
      || nestedAsset?.assetKind
      || nestedAsset?.kind
      || nestedMetadata?.assetKind
      || nestedMetadata?.kind
      || nestedCatalogAsset?.assetKind
      || nestedCatalogAsset?.kind
      || nestedAssetMetadata?.assetKind
      || nestedAssetMetadata?.kind,
    32,
  );
  const repoId = clampString(
    source.repoId
      || nestedAsset?.repoId
      || nestedMetadata?.repoId
      || nestedCatalogAsset?.repoId
      || nestedAssetMetadata?.repoId
      || scope?.repoId,
    128,
  );

  if (!assetId && !assetKey && !assetKind && !repoId && !scope) {
    return null;
  }

  return {
    assetId: assetId || null,
    assetKey: assetKey || null,
    assetKind: assetKind || null,
    repoId: repoId || null,
    scope,
  };
}

function toolNamesForLookup(tool) {
  const source = asObject(tool);
  if (!source) {
    return [];
  }
  return uniqueStrings([
    source.toolName,
    source.name,
    source.id,
    source.function,
    source.tool,
    source.metadata && source.metadata.toolName,
    source.metadata && source.metadata.name,
    source.asset && source.asset.toolName,
  ], 8, 128);
}

function resolveFromAvailableTools(toolName, availableTools) {
  const lookupKeys = new Set(buildLookupKeys(toolName));
  if (!lookupKeys.size) {
    return null;
  }

  let matched = null;
  for (const tool of Array.isArray(availableTools) ? availableTools : []) {
    const names = toolNamesForLookup(tool);
    const matches = names.some((name) => buildLookupKeys(name).some((key) => lookupKeys.has(key)));
    if (!matches) {
      continue;
    }

    const descriptor =
      descriptorFromObject(tool)
      || descriptorFromObject(tool && tool.metadata)
      || descriptorFromObject(tool && tool.asset)
      || descriptorFromObject(tool && tool.catalogAsset)
      || descriptorFromObject(tool && tool.assetMetadata);

    if (!descriptor) {
      continue;
    }

    if (matched && matched.assetId && descriptor.assetId && matched.assetId !== descriptor.assetId) {
      return null;
    }

    matched = {
      ...descriptor,
      toolName: names[0] || clampString(toolName, 128) || null,
    };
  }

  return matched;
}

function loadSnapshotCandidates(options, deps = {}) {
  const loadSnapshot = deps.loadCatalogProjectionSnapshot || loadCatalogProjectionSnapshot;
  const copilotHome = clampString(options.copilotHome, 1024);
  const repoPath = clampString(options.repoPath, 1024);
  const snapshots = [];

  if (copilotHome && repoPath) {
    const repoSnapshot = loadSnapshot({ copilotHome, repoPath });
    if (repoSnapshot) {
      snapshots.push(repoSnapshot);
    }
  }

  if (copilotHome) {
    const globalSnapshot = loadSnapshot({ copilotHome });
    if (globalSnapshot) {
      const duplicate = snapshots.some((snapshot) => snapshot?.storage?.snapshotPath === globalSnapshot?.storage?.snapshotPath);
      if (!duplicate) {
        snapshots.push(globalSnapshot);
      }
    }
  }

  return snapshots;
}

function collectAssetAliases(asset) {
  const selectedEntry = asObject(asset && asset.selectedEntry);
  const metadata = {
    ...(asObject(asset && asset.metadata) || {}),
    ...(asObject(selectedEntry && selectedEntry.metadata) || {}),
  };
  const namespace = clampString(metadata.namespace, 128);
  const logicalName = clampString(metadata.logicalName, 128);
  const assetKey = clampString(asset && asset.assetKey, 128);
  const kind = clampString(asset && asset.kind, 32);

  return uniqueStrings([
    asset && asset.assetId,
    assetKey,
    logicalName,
    namespace && logicalName ? `${namespace}/${logicalName}` : '',
    namespace && logicalName ? `${namespace}:${logicalName}` : '',
    assetKey && kind ? `${kind}-${assetKey}` : '',
    ...(Array.isArray(metadata.aliasKeys) ? metadata.aliasKeys : []),
  ], 16, 128);
}

function resolveFromSnapshots(descriptor, options, deps = {}) {
  const snapshots = loadSnapshotCandidates(options, deps);
  if (!snapshots.length) {
    return null;
  }

  const candidates = new Map();
  for (const snapshot of snapshots) {
    const effectiveAssets = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
    for (const asset of effectiveAssets) {
      if (!asset || !asset.assetId) {
        continue;
      }
      candidates.set(asset.assetId, asset);
    }
  }

  if (descriptor?.assetId && candidates.has(descriptor.assetId)) {
    return {
      asset: candidates.get(descriptor.assetId),
      resolutionSource: 'catalog-snapshot',
    };
  }

  const lookupKeys = new Set([
    ...(descriptor?.assetKey ? buildLookupKeys(descriptor.assetKey) : []),
    ...(options.toolName ? buildLookupKeys(options.toolName) : []),
  ]);

  if (!lookupKeys.size) {
    return null;
  }

  let match = null;
  for (const asset of candidates.values()) {
    const aliases = collectAssetAliases(asset);
    const isMatch = aliases.some((alias) => buildLookupKeys(alias).some((key) => lookupKeys.has(key)));
    if (!isMatch) {
      continue;
    }
    if (match && match.assetId !== asset.assetId) {
      return null;
    }
    match = asset;
  }

  if (!match) {
    return null;
  }

  return {
    asset: match,
    resolutionSource: 'catalog-snapshot',
  };
}

function resolveInvocationAsset(options = {}, deps = {}) {
  const explicitDescriptor = descriptorFromObject(options.eventData)
    || descriptorFromObject(options);
  const toolDescriptor = resolveFromAvailableTools(options.toolName, options.availableTools);
  const snapshotMatch = resolveFromSnapshots(explicitDescriptor || toolDescriptor, options, deps);
  const asset = snapshotMatch?.asset || null;
  const resolvedScope =
    normalizeScope(options.scope)
    || explicitDescriptor?.scope
    || toolDescriptor?.scope
    || normalizeScope(asset?.scope);
  const resolvedRepoId = clampString(
    options.repoId
      || explicitDescriptor?.repoId
      || toolDescriptor?.repoId
      || asset?.scope?.repoId
      || snapshotMatch?.asset?.scope?.repoId,
    128,
  );

  return {
    assetId: clampString(
      options.assetId
        || explicitDescriptor?.assetId
        || toolDescriptor?.assetId
        || asset?.assetId,
      128,
    ) || null,
    assetKey: clampString(
      options.assetKey
        || explicitDescriptor?.assetKey
        || toolDescriptor?.assetKey
        || asset?.assetKey,
      128,
    ) || null,
    assetKind: clampString(
      options.assetKind
        || explicitDescriptor?.assetKind
        || toolDescriptor?.assetKind
        || asset?.kind,
      32,
    ) || null,
    repoId: resolvedRepoId || null,
    scope: resolvedScope,
    resolutionSource:
      explicitDescriptor?.assetId || explicitDescriptor?.assetKey
        ? 'event-data'
        : toolDescriptor
          ? 'available-tools'
          : snapshotMatch?.resolutionSource || 'unresolved',
  };
}

function resolveTelemetryCorrelation(options = {}, resolvedAsset, deps = {}) {
  const sessionId = clampString(options.sessionId, 128);
  const copilotHome = clampString(options.copilotHome, 1024);
  if (!sessionId || !copilotHome || !resolvedAsset?.assetId) {
    return null;
  }

  const loadTelemetry = deps.loadSkillSearchTelemetry || loadSkillSearchTelemetry;
  const telemetryResult = loadTelemetry({
    copilotHome,
    repoId: options.repoId || resolvedAsset.repoId || undefined,
    repoPath: options.repoPath || undefined,
  });
  const recent = Array.isArray(telemetryResult?.telemetry?.recent) ? telemetryResult.telemetry.recent : [];

  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const event = recent[index];
    if (clampString(event?.sessionId, 128) !== sessionId || !clampString(event?.correlationId, 128)) {
      continue;
    }

    if (event.eventType === 'asset.search.selected') {
      const selectedAssetId = clampString(event?.assetId || event?.search?.selectedAssetId, 128);
      if (selectedAssetId && selectedAssetId === resolvedAsset.assetId) {
        return {
          correlationId: clampString(event.correlationId, 128),
          source: 'search-selected',
          eventType: event.eventType,
        };
      }
    }

    if (event.eventType === 'asset.search.result') {
      const topResults = Array.isArray(event?.details?.topResults) ? event.details.topResults : [];
      const matched = topResults.some((entry) => clampString(entry?.assetId, 128) === resolvedAsset.assetId);
      if (matched) {
        return {
          correlationId: clampString(event.correlationId, 128),
          source: 'search-result',
          eventType: event.eventType,
        };
      }
    }
  }

  return null;
}

function recordExplicitAssetInvocation(options = {}, deps = {}) {
  try {
    const copilotHome = clampString(options.copilotHome, 1024);
    if (!copilotHome) {
      return { logged: false, skippedReason: 'missing-copilot-home' };
    }

    const toolName = clampString(options.toolName || options.eventData?.toolName, 128);
    const toolCallId = clampString(options.toolCallId || options.eventData?.toolCallId, 128);
    const sessionId = clampString(options.sessionId || options.eventData?.sessionId, 128);
    const resolvedAsset = resolveInvocationAsset({
      ...options,
      toolName,
      toolCallId,
      sessionId,
    }, deps);

    if (!resolvedAsset.assetId) {
      return {
        logged: false,
        skippedReason: 'asset-unresolved',
        resolutionSource: resolvedAsset.resolutionSource,
      };
    }

    const explicitCorrelationId = clampString(options.correlationId || options.eventData?.correlationId, 128);
    const correlatedTelemetry = explicitCorrelationId
      ? null
      : resolveTelemetryCorrelation({
        ...options,
        sessionId,
        repoId: resolvedAsset.repoId || options.repoId,
      }, resolvedAsset, deps);
    const correlationId = explicitCorrelationId || correlatedTelemetry?.correlationId || '';

    const appendEvent = deps.appendCatalogAuditEvent || appendCatalogAuditEvent;
    return appendEvent(copilotHome, {
      eventType: 'asset.invoked',
      actor: options.actor || {
        kind: 'runtime',
        id: 'sdk-bridge',
        label: 'sdk-bridge',
      },
      assetId: resolvedAsset.assetId,
      assetKey: resolvedAsset.assetKey || undefined,
      assetKind: resolvedAsset.assetKind || undefined,
      scope: resolvedAsset.scope || undefined,
      repoId: resolvedAsset.repoId || undefined,
      sessionId: sessionId || undefined,
      correlationId: correlationId || undefined,
      toolName: toolName || undefined,
      toolCallId: toolCallId || undefined,
      details: {
        hookEventType: 'tool.user_requested',
        resolutionSource: resolvedAsset.resolutionSource,
        correlationSource: correlatedTelemetry?.source || (explicitCorrelationId ? 'event-data' : undefined),
        correlatedSearchEventType: correlatedTelemetry?.eventType,
      },
      source: clampString(options.source, 64) || 'sdk-bridge',
    }, deps);
  } catch (error) {
    return {
      logged: false,
      error: String(error && error.message ? error.message : error),
    };
  }
}

function isSkillInvocationEvent(event) {
  const assetKind = clampString(event?.assetKind, 32).toLowerCase();
  const assetId = clampString(event?.assetId, 128).toLowerCase();
  return assetKind === 'skill' || assetId.startsWith('skill-');
}

function getSessionSkillUsageSummary(options = {}, deps = {}) {
  const copilotHome = clampString(options.copilotHome, 1024);
  const sessionId = clampString(options.sessionId, 128);
  const limit = Math.max(1, Math.floor(Number(options.limit) || DEFAULT_AUDIT_SCAN_LIMIT));
  const summary = {
    contractVersion: SESSION_SKILL_USAGE_CONTRACT_VERSION,
    sessionId: sessionId || null,
    totalInvocations: 0,
    uniqueSkillCount: 0,
    skills: [],
  };

  if (!copilotHome || !sessionId) {
    return summary;
  }

  const readEvents = deps.readCatalogAuditEvents || readCatalogAuditEvents;
  const events = readEvents(copilotHome, limit, deps);
  const usageByAssetId = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.eventType !== 'asset.invoked' || clampString(event.sessionId, 128) !== sessionId) {
      continue;
    }
    if (!isSkillInvocationEvent(event)) {
      continue;
    }

    const assetId = clampString(event.assetId, 128);
    if (!assetId) {
      continue;
    }

    if (!usageByAssetId.has(assetId)) {
      usageByAssetId.set(assetId, {
        assetId,
        assetKey: clampString(event.assetKey, 128) || null,
        assetKind: clampString(event.assetKind, 32) || 'skill',
        invocationCount: 0,
        lastInvokedAt: null,
        toolNames: [],
      });
    }

    const entry = usageByAssetId.get(assetId);
    entry.invocationCount += 1;
    entry.lastInvokedAt =
      !entry.lastInvokedAt || String(event.occurredAt || '') > String(entry.lastInvokedAt || '')
        ? event.occurredAt || entry.lastInvokedAt
        : entry.lastInvokedAt;
    entry.toolNames = uniqueStrings([...entry.toolNames, event.toolName], 4, 128);
    summary.totalInvocations += 1;
  }

  summary.skills = Array.from(usageByAssetId.values())
    .sort((left, right) => {
      if (right.invocationCount !== left.invocationCount) {
        return right.invocationCount - left.invocationCount;
      }
      return left.assetId.localeCompare(right.assetId);
    });
  summary.uniqueSkillCount = summary.skills.length;
  return summary;
}

module.exports = {
  SESSION_SKILL_USAGE_CONTRACT_VERSION,
  getSessionSkillUsageSummary,
  recordExplicitAssetInvocation,
  resolveInvocationAsset,
};
