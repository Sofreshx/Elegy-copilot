'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { compareAssetCatalogEntries } = require('@instruction-engine/contracts');

const {
  buildCatalogProjection,
  resolveProjectionStorage,
} = require('./catalogProjectionService');
const {
  buildRoutingPolicySnapshot,
} = require('./catalogActivationState');

const SKILL_SEARCH_TELEMETRY_CONTRACT_VERSION = 'skill_search_telemetry_v1';
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_TELEMETRY_CAPACITY = 200;
const DEFAULT_TELEMETRY_RESULTS_CAP = 5;

function normalizeList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const value of values) {
    const entry = String(value || '').trim().toLowerCase();
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized;
}

function tokenize(value) {
  return normalizeList(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9+#.-]+/i),
  );
}

function normalizeText(value) {
  return tokenize(value).join(' ');
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

function normalizeSearchQuery(query) {
  const raw = typeof query === 'string' ? { query } : query || {};
  const normalizedQuery = normalizeText(raw.query || '');
  const tokens = tokenize(raw.query || '');
  const repoPath = raw.repoPath ? path.resolve(raw.repoPath) : undefined;
  const workspacePath = raw.workspacePath ? path.resolve(raw.workspacePath) : undefined;

  return {
    query: String(raw.query || '').trim(),
    normalizedQuery,
    tokens,
    repoId: raw.repoId ? String(raw.repoId).trim() : undefined,
    repoPath,
    workspaceId: raw.workspaceId ? String(raw.workspaceId).trim() : undefined,
    workspacePath,
    frameworks: normalizeList(raw.frameworks),
    stacks: normalizeList(raw.stacks),
    languages: normalizeList(raw.languages),
    tags: normalizeList(raw.tags),
    limit: Number.isFinite(raw.limit) ? Math.max(1, Math.floor(raw.limit)) : DEFAULT_SEARCH_LIMIT,
    includeVaultOnly: raw.includeVaultOnly !== false,
    includeDisabled: raw.includeDisabled === true,
    includeDeprecated: raw.includeDeprecated === true,
    overrideRoutingPolicy: raw.overrideRoutingPolicy === true,
    preferLoadMode: raw.preferLoadMode ? String(raw.preferLoadMode).trim() : undefined,
    sessionId: raw.sessionId ? String(raw.sessionId).trim() : undefined,
    correlationId: raw.correlationId ? String(raw.correlationId).trim() : undefined,
  };
}

function hasSearchInputs(query) {
  return Boolean(
    query.normalizedQuery ||
      query.frameworks.length ||
      query.stacks.length ||
      query.languages.length ||
      query.tags.length ||
      query.repoId ||
      query.repoPath ||
      query.workspaceId ||
      query.workspacePath ||
      query.preferLoadMode,
  );
}

function collectSurface(state) {
  const entry = state.selectedEntry;
  const metadata = entry?.metadata || {};
  const targeting = entry?.targeting || {};
  const aliases = normalizeList([state.assetKey, state.assetId, ...(metadata.aliasKeys || [])]);
  const title = normalizeText(entry?.title || state.assetKey);
  const description = normalizeText(entry?.description || '');
  const descriptionTokens = tokenize(entry?.description || '');
  const triggers = normalizeList(metadata.triggersOn);
  const tags = normalizeList(targeting.tags);
  const frameworks = normalizeList(targeting.frameworks);
  const stacks = normalizeList(targeting.stacks);
  const languages = normalizeList(targeting.languages);

  return {
    entry,
    aliases,
    aliasTexts: aliases.map((value) => normalizeText(value)),
    title,
    description,
    descriptionTokens,
    triggers,
    triggerTexts: triggers.map((value) => normalizeText(value)),
    tags,
    frameworks,
    stacks,
    languages,
  };
}

function countTokenOverlap(sourceTokens, queryTokens) {
  if (!sourceTokens.length || !queryTokens.length) {
    return 0;
  }
  const set = new Set(sourceTokens);
  let count = 0;
  for (const token of queryTokens) {
    if (set.has(token)) {
      count += 1;
    }
  }
  return count;
}

function intersectList(left, right) {
  if (!left.length || !right.length) {
    return [];
  }
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function addExplanation(explanations, code, weight, message, layer) {
  const existing = explanations.find((item) => item.code === code);
  if (existing) {
    existing.weight += weight;
    if (message && !existing.message.includes(message)) {
      existing.message = `${existing.message} ${message}`.trim();
    }
    return;
  }
  explanations.push({
    code,
    weight,
    message,
    layer,
  });
}

function matchTargeting(surfaceValues, explicitValues, queryTokens, code, label, explanations) {
  const matches = intersectList(surfaceValues, explicitValues);
  if (matches.length) {
    addExplanation(
      explanations,
      code,
      Math.min(36, 18 + matches.length * 6),
      `Matched ${label}: ${matches.join(', ')}.`,
    );
  }

  const tokenMatches = intersectList(surfaceValues, queryTokens);
  const unmatchedTokenMatches = tokenMatches.filter((value) => !matches.includes(value));
  if (unmatchedTokenMatches.length) {
    addExplanation(
      explanations,
      code,
      Math.min(24, unmatchedTokenMatches.length * 8),
      `Query text overlapped ${label}: ${unmatchedTokenMatches.join(', ')}.`,
    );
  }
}

function scoreSkill(state, query) {
  if (!state?.selectedEntry || state.kind !== 'skill' || !state.available) {
    return null;
  }
  if (!query.includeDisabled && state.enabled === false) {
    return null;
  }
  if (!query.includeDeprecated && state.deprecated) {
    return null;
  }
  if (!query.includeVaultOnly && state.selectedLayer === 'vault-only') {
    return null;
  }

  const surface = collectSurface(state);
  const explanations = [];

  if (query.normalizedQuery) {
    const exactAliasMatch = surface.aliasTexts.some((value) => value === query.normalizedQuery);
    const exactTitleMatch = surface.title === query.normalizedQuery;
    if (exactAliasMatch || exactTitleMatch) {
      addExplanation(
        explanations,
        'exact-name',
        160,
        `Exact match on ${exactAliasMatch ? 'skill key or alias' : 'skill title'}.`,
        surface.entry.layer,
      );
    } else {
      const aliasContains = surface.aliasTexts.some((value) => value.includes(query.normalizedQuery));
      const titleContains = surface.title.includes(query.normalizedQuery);
      const nameOverlap = countTokenOverlap(
        tokenize([...surface.aliases, surface.title].join(' ')),
        query.tokens,
      );
      if (aliasContains || titleContains || nameOverlap) {
        addExplanation(
          explanations,
          'name',
          Math.min(72, (aliasContains || titleContains ? 36 : 0) + nameOverlap * 12),
          `Matched skill title, key, or aliases${nameOverlap ? ` on ${nameOverlap} token(s)` : ''}.`,
          surface.entry.layer,
        );
      }
    }

    const exactTriggerMatch = surface.triggerTexts.some((value) => value === query.normalizedQuery);
    const triggerContains = surface.triggerTexts.some((value) => value.includes(query.normalizedQuery));
    const triggerOverlap = countTokenOverlap(surface.triggers.flatMap(tokenize), query.tokens);
    if (exactTriggerMatch || triggerContains || triggerOverlap) {
      addExplanation(
        explanations,
        'trigger',
        Math.min(64, (exactTriggerMatch ? 32 : 0) + (triggerContains ? 16 : 0) + triggerOverlap * 8),
        `Matched metadata triggers${triggerOverlap ? ` on ${triggerOverlap} token(s)` : ''}.`,
        surface.entry.layer,
      );
    }

    const tagOverlap = countTokenOverlap(surface.tags, query.tokens);
    if (tagOverlap) {
      addExplanation(
        explanations,
        'tags',
        Math.min(36, tagOverlap * 12),
        `Matched targeting tags: ${intersectList(surface.tags, query.tokens).join(', ')}.`,
        surface.entry.layer,
      );
    }

    const descriptionContains = surface.description.includes(query.normalizedQuery);
    const descriptionOverlap = countTokenOverlap(surface.descriptionTokens, query.tokens);
    if (descriptionContains || descriptionOverlap) {
      addExplanation(
        explanations,
        'description',
        Math.min(30, (descriptionContains ? 12 : 0) + descriptionOverlap * 4),
        `Matched skill description${descriptionOverlap ? ` on ${descriptionOverlap} token(s)` : ''}.`,
        surface.entry.layer,
      );
    }
  }

  matchTargeting(surface.frameworks, query.frameworks, query.tokens, 'framework', 'frameworks', explanations);
  matchTargeting(surface.stacks, query.stacks, query.tokens, 'stack', 'stacks', explanations);
  matchTargeting(surface.languages, query.languages, query.tokens, 'language', 'languages', explanations);

  const explicitTagMatches = intersectList(surface.tags, query.tags);
  if (explicitTagMatches.length) {
    addExplanation(
      explanations,
      'tags',
      Math.min(30, 14 + explicitTagMatches.length * 6),
      `Matched requested tags: ${explicitTagMatches.join(', ')}.`,
      surface.entry.layer,
    );
  }

  const repoPathMatch =
    Boolean(query.repoPath) &&
    Boolean(state.scope?.repoPath) &&
    path.resolve(state.scope.repoPath) === query.repoPath;
  const repoIdMatch = Boolean(query.repoId) && state.scope?.repoId === query.repoId;
  if (repoPathMatch || repoIdMatch || (state.selectedLayer === 'repo-local' && (query.repoPath || query.repoId))) {
    addExplanation(
      explanations,
      'repo-local',
      state.selectedLayer === 'repo-local' ? 28 : 16,
      state.selectedLayer === 'repo-local'
        ? 'Repo-local variant matches the active repository context.'
        : 'Skill applies to the requested repository context.',
      state.selectedLayer,
    );
  }

  const workspacePathMatch =
    Boolean(query.workspacePath) &&
    Boolean(state.scope?.workspacePath) &&
    path.resolve(state.scope.workspacePath) === query.workspacePath;
  const workspaceIdMatch = Boolean(query.workspaceId) && state.scope?.workspaceId === query.workspaceId;
  if (workspacePathMatch || workspaceIdMatch) {
    addExplanation(
      explanations,
      'workspace',
      18,
      'Skill targets the requested workspace context.',
      state.selectedLayer,
    );
  }

  if (query.preferLoadMode && state.installState?.loadMode === query.preferLoadMode) {
    addExplanation(
      explanations,
      'load-mode',
      query.preferLoadMode === 'on-demand' && state.selectedLayer === 'vault-only' ? 22 : 14,
      query.preferLoadMode === 'on-demand' && state.selectedLayer === 'vault-only'
        ? 'Vault-first on-demand content matches the requested load mode.'
        : `Matched preferred load mode: ${query.preferLoadMode}.`,
      state.selectedLayer,
    );
  }

  const matchingRecommendations = (state.recommendations || []).filter((recommendation) => {
    if (recommendation.repoId && query.repoId && recommendation.repoId !== query.repoId) {
      return false;
    }
    if (recommendation.framework && query.frameworks.length && !query.frameworks.includes(String(recommendation.framework).toLowerCase())) {
      return false;
    }
    if (recommendation.stack && query.stacks.length && !query.stacks.includes(String(recommendation.stack).toLowerCase())) {
      return false;
    }
    return true;
  });
  if (matchingRecommendations.length) {
    const recommendationWeight = matchingRecommendations.reduce(
      (sum, item) => sum + Math.max(1, Number(item.score) || 1),
      0,
    );
    addExplanation(
      explanations,
      'recommendation',
      Math.min(28, 10 + recommendationWeight),
      matchingRecommendations[0].reason || 'Catalog recommendation matches the current context.',
      'targeted-recommendation',
    );
  }

  const score = explanations.reduce((sum, explanation) => sum + explanation.weight, 0);
  const qualifyingCodes = new Set([
    'exact-name',
    'name',
    'trigger',
    'description',
    'tags',
    'framework',
    'stack',
    'language',
  ]);
  const hasPrimaryQualifier = explanations.some((explanation) => qualifyingCodes.has(explanation.code));
  const hasContextOnlyQuery = Boolean(
    !query.normalizedQuery &&
      !query.frameworks.length &&
      !query.stacks.length &&
      !query.languages.length &&
      !query.tags.length &&
      (query.repoId ||
        query.repoPath ||
        query.workspaceId ||
        query.workspacePath ||
        query.preferLoadMode),
  );
  if ((!score || (!hasPrimaryQualifier && !hasContextOnlyQuery)) && hasSearchInputs(query)) {
    return null;
  }

  return {
    assetId: state.assetId,
    entry: surface.entry,
    effectiveState: state,
    score,
    explanations: explanations
      .sort((left, right) => right.weight - left.weight || left.code.localeCompare(right.code))
      .slice(0, 10)
      .map((explanation) => explanation),
  };
}

function compareResults(left, right) {
  const scoreCompare = right.score - left.score;
  if (scoreCompare !== 0) {
    return scoreCompare;
  }
  const leftEntry = left.entry || left.effectiveState?.selectedEntry;
  const rightEntry = right.entry || right.effectiveState?.selectedEntry;
  if (leftEntry && rightEntry && leftEntry.layer !== rightEntry.layer) {
    const precedenceCompare = compareAssetCatalogEntries(rightEntry, leftEntry);
    if (precedenceCompare !== 0) {
      return precedenceCompare;
    }
  }
  const keyCompare = String(left.effectiveState?.assetKey || '').localeCompare(
    String(right.effectiveState?.assetKey || ''),
  );
  if (keyCompare !== 0) {
    return keyCompare;
  }
  return String(left.assetId || '').localeCompare(String(right.assetId || ''));
}

function resolveSkillSearchSnapshot(options = {}) {
  return options.snapshot || buildCatalogProjection(options);
}

function resolveRoutingPolicy(query, options, snapshot) {
  if (options.routingPolicy && typeof options.routingPolicy === 'object') {
    return options.routingPolicy;
  }
  if (!options.copilotHome || !snapshot) {
    return null;
  }
  return buildRoutingPolicySnapshot({
    snapshot,
    copilotHome: options.copilotHome,
    repoPath: query.repoPath || options.repoPath || snapshot?.repoContext?.repoPath,
  });
}

function filterAssetIdsByRoutingPolicy(assetStates, routingPolicy, overrideRoutingPolicy) {
  if (!routingPolicy || overrideRoutingPolicy) {
    return Array.isArray(assetStates) ? assetStates : [];
  }

  const eligibleAssetIds = new Set(
    Array.isArray(routingPolicy.eligibleAssetIds) ? routingPolicy.eligibleAssetIds : []
  );
  return (Array.isArray(assetStates) ? assetStates : []).filter((asset) => eligibleAssetIds.has(asset.assetId));
}

function sanitizeQueryForTelemetry(query) {
  return {
    query: normalizeText(query.query).slice(0, 160) || undefined,
    repoId: query.repoId,
    workspaceId: query.workspaceId,
    frameworks: query.frameworks.slice(0, 8),
    stacks: query.stacks.slice(0, 8),
    languages: query.languages.slice(0, 8),
    tags: query.tags.slice(0, 8),
    limit: query.limit,
    includeVaultOnly: query.includeVaultOnly,
    includeDisabled: query.includeDisabled,
    includeDeprecated: query.includeDeprecated,
    overrideRoutingPolicy: query.overrideRoutingPolicy,
    preferLoadMode: query.preferLoadMode,
    sessionId: query.sessionId,
    correlationId: query.correlationId,
  };
}

function telemetryStoragePath(options = {}) {
  const storage = resolveProjectionStorage(options);
  return path.join(storage.catalogRoot, 'search-telemetry.json');
}

function createEmptyTelemetry(capacity = DEFAULT_TELEMETRY_CAPACITY, maxResultsPerEvent = DEFAULT_TELEMETRY_RESULTS_CAP) {
  return {
    contractVersion: SKILL_SEARCH_TELEMETRY_CONTRACT_VERSION,
    sample: {
      capacity,
      size: 0,
      dropped: 0,
      deterministic: true,
      maxResultsPerEvent,
    },
    countersByEventType: {},
    countersByMissReason: {},
    recent: [],
  };
}

function loadSkillSearchTelemetry(options = {}) {
  const telemetryPath = telemetryStoragePath(options);
  const loaded = readJsonIfExists(telemetryPath);
  const capacity = Math.max(1, Number(options.telemetryCapacity) || DEFAULT_TELEMETRY_CAPACITY);
  const maxResultsPerEvent = Math.max(
    1,
    Number(options.maxResultsPerEvent) || DEFAULT_TELEMETRY_RESULTS_CAP,
  );

  if (!loaded || typeof loaded !== 'object') {
    return { telemetryPath, telemetry: createEmptyTelemetry(capacity, maxResultsPerEvent) };
  }

  const recent = Array.isArray(loaded.recent) ? loaded.recent.filter(Boolean) : [];
  return {
    telemetryPath,
    telemetry: {
      contractVersion: loaded.contractVersion || SKILL_SEARCH_TELEMETRY_CONTRACT_VERSION,
      sample: {
        capacity: Number(loaded.sample?.capacity) || capacity,
        size: recent.length,
        dropped: Number(loaded.sample?.dropped) || 0,
        deterministic: true,
        maxResultsPerEvent:
          Number(loaded.sample?.maxResultsPerEvent) || maxResultsPerEvent,
      },
      countersByEventType:
        loaded.countersByEventType && typeof loaded.countersByEventType === 'object'
          ? loaded.countersByEventType
          : {},
      countersByMissReason:
        loaded.countersByMissReason && typeof loaded.countersByMissReason === 'object'
          ? loaded.countersByMissReason
          : {},
      recent,
    },
  };
}

function nextTelemetryEventId(eventType, payload) {
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify({ eventType, payload, at: Date.now() }))
    .digest('hex');
  return `skill-search-${hash.slice(0, 16)}`;
}

function persistTelemetryEvent(eventType, payload, options = {}) {
  const { telemetryPath, telemetry } = loadSkillSearchTelemetry(options);
  const recent = telemetry.recent.slice();
  const event = {
    eventId: nextTelemetryEventId(eventType, payload),
    eventType,
    occurredAt: new Date().toISOString(),
    actor: {
      kind: 'system',
      label: 'skill-search-service',
    },
    assetId: payload.assetId,
    assetKey: payload.assetKey,
    assetKind: 'skill',
    repoId: payload.repoId,
    sessionId: payload.sessionId,
    correlationId: payload.correlationId,
    search: payload.search,
    details: payload.details,
  };

  telemetry.countersByEventType[eventType] = (telemetry.countersByEventType[eventType] || 0) + 1;
  if (payload.missReason) {
    telemetry.countersByMissReason[payload.missReason] =
      (telemetry.countersByMissReason[payload.missReason] || 0) + 1;
  }

  recent.push(event);
  const overflow = Math.max(0, recent.length - telemetry.sample.capacity);
  if (overflow > 0) {
    recent.splice(0, overflow);
    telemetry.sample.dropped += overflow;
  }

  telemetry.recent = recent;
  telemetry.sample.size = recent.length;
  telemetry.contractVersion = SKILL_SEARCH_TELEMETRY_CONTRACT_VERSION;

  writeJsonAtomic(telemetryPath, telemetry);
  return { telemetryPath, event, telemetry };
}

function searchSkills(inputQuery, options = {}) {
  const snapshot = resolveSkillSearchSnapshot(options);
  const query = normalizeSearchQuery(inputQuery);
  const routingPolicy = resolveRoutingPolicy(query, options, snapshot);
  const allSkills = Array.isArray(snapshot?.effectiveAssets)
    ? snapshot.effectiveAssets.filter((asset) => asset.kind === 'skill')
    : [];
  const policyScopedSkills = filterAssetIdsByRoutingPolicy(
    allSkills,
    routingPolicy,
    query.overrideRoutingPolicy,
  );

  let missReason = null;
  if (!allSkills.length) {
    missReason = 'empty-catalog';
  }

  const scored = policyScopedSkills
    .map((asset) => scoreSkill(asset, query))
    .filter(Boolean)
    .sort(compareResults)
    .map((result, index) => ({
      ...result,
      rank: index + 1,
    }));

  const filteredCount = allSkills.length - scored.length;
  if (!scored.length && !missReason) {
    missReason = filteredCount === allSkills.length && allSkills.length > 0 ? 'no-match' : 'all-filtered';
  }

  const results = scored.slice(0, query.limit);
  const response = {
    query,
    snapshot,
    routingPolicy: routingPolicy
      ? {
        ...routingPolicy,
        mode: query.overrideRoutingPolicy ? 'explicit-override' : 'eligible-only',
      }
      : null,
    totalCandidates: allSkills.length,
    filteredCount,
    results,
    bestResult: results[0] || null,
    missReason,
  };

  if (options.persistTelemetry !== false) {
    const telemetryOptions = {
      ...options,
      repoId: query.repoId || options.repoId || snapshot?.repoContext?.repoId,
      repoPath: query.repoPath || options.repoPath || snapshot?.repoContext?.repoPath,
      workspaceId: query.workspaceId || options.workspaceId,
      workspacePath: query.workspacePath || options.workspacePath,
    };
    const sanitizedQuery = sanitizeQueryForTelemetry(query);
    persistTelemetryEvent(
      'asset.search.query',
      {
        repoId: telemetryOptions.repoId,
        sessionId: query.sessionId,
        correlationId: query.correlationId,
        search: {
          query: sanitizedQuery,
        },
        details: {
          totalCandidates: allSkills.length,
          includeDisabled: query.includeDisabled,
          includeDeprecated: query.includeDeprecated,
          routingPolicyMode: response.routingPolicy?.mode || null,
        },
      },
      telemetryOptions,
    );

    if (results.length) {
      const topResults = results
        .slice(0, Math.max(1, Number(options.maxResultsPerEvent) || DEFAULT_TELEMETRY_RESULTS_CAP))
        .map((result) => ({
          assetId: result.assetId,
          assetKey: result.effectiveState.assetKey,
          score: result.score,
          rank: result.rank,
          explanationCodes: result.explanations.map((item) => item.code),
        }));
      persistTelemetryEvent(
        'asset.search.result',
        {
          repoId: telemetryOptions.repoId,
          sessionId: query.sessionId,
          correlationId: query.correlationId,
          search: {
            query: sanitizedQuery,
            resultCount: results.length,
          },
          details: {
            topResults,
            routingPolicyMode: response.routingPolicy?.mode || null,
          },
        },
        telemetryOptions,
      );
    } else {
      persistTelemetryEvent(
        'asset.search.miss',
        {
          repoId: telemetryOptions.repoId,
          sessionId: query.sessionId,
          correlationId: query.correlationId,
          missReason: missReason || 'no-match',
          search: {
            query: sanitizedQuery,
            resultCount: 0,
            missReason: missReason || 'no-match',
          },
          details: {
            totalCandidates: allSkills.length,
            filteredCount,
            routingPolicyMode: response.routingPolicy?.mode || null,
          },
        },
        telemetryOptions,
      );
    }
  }

  return response;
}

function resolveSkill(inputQuery, options = {}) {
  const search = searchSkills(inputQuery, options);
  const [first, second] = search.results;
  const gap = first && second ? first.score - second.score : first ? first.score : 0;
  const confident = Boolean(
    first &&
      (first.explanations.some((item) => item.code === 'exact-name') ||
        first.score >= 90 ||
        gap >= 24),
  );

  return {
    ...search,
    confidenceGap: gap,
    confident,
  };
}

function recordSkillSearchSelection(selection = {}, options = {}) {
  const query = normalizeSearchQuery(selection.query || selection.searchQuery || {});
  const result = selection.result || {};
  const assetId = String(selection.assetId || result.assetId || '').trim();
  const assetKey = String(
    selection.assetKey || result.effectiveState?.assetKey || result.entry?.assetKey || '',
  ).trim();

  return persistTelemetryEvent(
    'asset.search.selected',
    {
      assetId: assetId || undefined,
      assetKey: assetKey || undefined,
      repoId: query.repoId || options.repoId,
      sessionId: query.sessionId,
      correlationId: query.correlationId,
      search: {
        query: sanitizeQueryForTelemetry(query),
        resultCount: Number(selection.resultCount) || undefined,
        selectedAssetId: assetId || undefined,
      },
      details: {
        score: Number(result.score) || undefined,
        rank: Number(result.rank) || undefined,
        explanationCodes: Array.isArray(result.explanations)
          ? result.explanations.map((item) => item.code)
          : undefined,
      },
    },
    options,
  );
}

module.exports = {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_TELEMETRY_CAPACITY,
  DEFAULT_TELEMETRY_RESULTS_CAP,
  SKILL_SEARCH_TELEMETRY_CONTRACT_VERSION,
  loadSkillSearchTelemetry,
  normalizeSearchQuery,
  persistTelemetryEvent,
  recordSkillSearchSelection,
  resolveSkill,
  sanitizeQueryForTelemetry,
  searchSkills,
  telemetryStoragePath,
};
