'use strict';

/**
 * Catalog Policy Service
 * 
 * Explainable routing and asset policy engine. Unifies catalog effective assets
 * and external source installables into a candidate model, applies eligibility
 * rules with deterministic block codes, scores candidates, and returns a full
 * route explanation decision.
 * 
 * This is the decision/explanation layer. It does NOT modify any source of truth:
 * - Catalog projection → inventory (read-only)
 * - Activation state → policy input (read-only)
 * - External sources → source/installable state (read-only)
 * - Audit/search telemetry → evidence (read-only)
 */

const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROUTING_POLICY_SCHEMA_VERSION = 1;

const ALL_KINDS = ['skill', 'agent', 'mcp', 'cli-tool'];

const TASK_ROUTING_KINDS = ['skill', 'agent'];
const TOOL_ROUTING_KINDS = ['mcp', 'cli-tool'];

const BLOCK_CODE = Object.freeze({
  DISABLED: 'disabled',
  NOT_INSTALLED: 'not-installed',
  UNSUPPORTED_HARNESS: 'unsupported-harness',
  NOT_IN_ACTIVE_BUNDLE: 'not-in-active-bundle',
  EXTERNAL_SOURCE_NOT_ACTIVATED: 'external-source-not-activated',
  DEPRECATED: 'deprecated',
  PROJECTION_UNAVAILABLE: 'projection-unavailable',
  KIND_NOT_APPLICABLE: 'kind-not-applicable',
  ACTIVATION_LAYER_MISMATCH: 'activation-layer-mismatch',
  STALE_SOURCE: 'stale-source',
  MISSING_INSTALL_SURFACE: 'missing-install-surface',
});

const SUGGESTED_OPERATION = Object.freeze({
  ENABLE_ASSET: 'enable-asset',
  ACTIVATE_SOURCE_INSTALLABLE: 'activate-source-installable',
  REFRESH_SOURCE: 'refresh-source',
  INSTALL_HARNESS_SURFACE: 'install-harness-surface',
  REBUILD_PROJECTION: 'rebuild-projection',
});

// Scoring weights for text match explanations
const TEXT_SCORE_WEIGHTS = Object.freeze({
  'exact-name': 100,
  'name': 60,
  'description': 25,
  'tags': 20,
  'framework': 18,
  'repo-local': 8,
  'load-mode': 6,
  'recommendation': 4,
});

// Eligibility bonus constants
const ELIGIBILITY_BONUS = 10;
const INSTALLED_BONUS = 5;
const ENABLED_BONUS = 5;
const ACTIVE_BUNDLE_BONUS = 3;
const REPO_LOCAL_BONUS = 2;
const RECOMMENDED_BONUS = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item != null);
}

function uniqueStrings(arr) {
  return [...new Set(normalizeArray(arr).map((item) => String(item)).filter(Boolean))];
}

function tokenizeSearchText(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return [];
  return raw.split(/\s+/).filter((token) => token.length > 0);
}

function generateCorrelationId(crypto) {
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (crypto && typeof crypto.randomBytes === 'function') {
    return crypto.randomBytes(16).toString('hex');
  }
  // Fallback for environments without crypto
  return `route-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function listIncludesAny(list, tokens) {
  const normalized = normalizeArray(list).map((item) => String(item).toLowerCase());
  return tokens.some((token) => normalized.some((item) => item.includes(token)));
}

function textIncludesAny(text, tokens) {
  const lower = String(text || '').toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

// ---------------------------------------------------------------------------
// Candidate normalization
// ---------------------------------------------------------------------------

/**
 * Convert an effective asset (from catalog projection) into a RouteCandidateStatus.
 */
function normalizeEffectiveAsset(effective, options = {}) {
  const entry = effective.selectedEntry || effective;
  const id = normalizeString(effective.assetId || entry.assetId);
  const key = normalizeString(effective.assetKey || entry.assetKey || id);
  const kind = normalizeString(effective.kind || entry.kind);
  const title = normalizeString(entry.title);
  const description = normalizeString(entry.description);

  const available = Boolean(effective.available !== false);
  const installed = Boolean(effective.installed === true);
  const enabled = Boolean(effective.enabled !== false);
  const deprecated = Boolean(effective.deprecated === true);
  const recommended = Boolean(effective.recommended === true);

  const contentLayer = normalizeString(effective.selectedLayer || entry.layer);
  const loadMode = normalizeString(
    effective.installState?.loadMode || entry.installState?.loadMode
  );
  const bundleIds = normalizeArray(
    effective.bundleIds || entry.bundleIds || []
  );

  return {
    id,
    key,
    kind,
    title: title || key,
    description: description || undefined,
    sourceId: normalizeString(effective.provenance?.providerId || entry.provenance?.providerId) || 'built-in',
    sourceType: 'catalog',
    available,
    installed,
    enabled,
    eligible: true, // will be set later
    score: 0,
    explanations: [],
    blockedReasons: [],
    actions: [],
    contentLayer: contentLayer || undefined,
    bundleIds,
    tags: normalizeArray(entry?.targeting?.tags),
    frameworks: [
      ...normalizeArray(entry?.targeting?.frameworks),
      ...normalizeArray(entry?.metadata?.frameworks),
    ],
    loadMode: loadMode || undefined,
    recommended,
    deprecated,
  };
}

/**
 * Convert an external source installable into a RouteCandidateStatus.
 */
function normalizeExternalInstallable(installable, source, options = {}) {
  const id = normalizeString(installable.id || installable.installableId);
  const key = normalizeString(installable.key || installable.name || id);
  const kind = normalizeString(installable.kind);
  const title = normalizeString(installable.title || installable.name);
  const description = normalizeString(installable.description);
  const sourceId = normalizeString(source?.sourceId);

  // External installables are only "installed" once activated for a target harness
  const activation = source?.activation || {};
  const targetHarness = normalizeString(options.targetHarness);
  const activated = targetHarness
    ? Boolean(activation[targetHarness] === true || activation[targetHarness]?.activated === true)
    : Object.values(activation).some((v) => v === true || (v && v.activated === true));

  const available = Boolean(installable.available !== false && source?.sync?.status !== 'error');
  const installed = activated;
  const enabled = activated;

  // Check if source is stale (> 24 hours since last sync)
  let staleSource = false;
  if (source?.sync?.lastSyncedAt) {
    const syncedAt = new Date(source.sync.lastSyncedAt).getTime();
    const now = Date.now();
    staleSource = (now - syncedAt) > 24 * 60 * 60 * 1000;
  }

  return {
    id,
    key,
    kind,
    title: title || key,
    description: description || undefined,
    sourceId: sourceId || 'external',
    sourceType: 'external',
    available,
    installed,
    enabled,
    eligible: true,
    score: 0,
    explanations: [],
    blockedReasons: [],
    actions: [],
    contentLayer: 'source',
    bundleIds: [],
    loadMode: undefined,
    recommended: false,
    deprecated: Boolean(installable.deprecated === true),
    _staleSource: staleSource,
    _sourceId: sourceId,
    _targetHarness: targetHarness,
  };
}

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

/**
 * Collect all candidates from effective assets and external sources.
 */
function collectCandidates(options = {}) {
  const candidates = [];
  const { snapshot, externalSources, targetHarness, fallbackCurated } = options;

  // 1. From catalog projection (skills, agents)
  const effectiveAssets = Array.isArray(snapshot?.effectiveAssets)
    ? snapshot.effectiveAssets
    : [];
  for (const effective of effectiveAssets) {
    if (!effective || typeof effective !== 'object') continue;
    const kind = normalizeString(effective.kind);
    // Only include kinds that are in our routing scope
    if (!ALL_KINDS.includes(kind)) continue;
    candidates.push(normalizeEffectiveAsset(effective, options));
  }

  // 2. From external sources (MCP servers, CLI tools)
  // fallbackCurated mode excludes external/provider/imported assets
  if (!fallbackCurated) {
    const sources = Array.isArray(externalSources?.sources)
      ? externalSources.sources
      : [];
    for (const source of sources) {
      const installables = Array.isArray(source?.installables)
        ? source.installables
        : [];
      for (const installable of installables) {
        if (!installable || typeof installable !== 'object') continue;
        const kind = normalizeString(installable.kind);
        if (!ALL_KINDS.includes(kind)) continue;
        candidates.push(
          normalizeExternalInstallable(installable, source, {
            targetHarness,
          })
        );
      }
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Block reason computation
// ---------------------------------------------------------------------------

/**
 * Compute block reasons for a candidate.
 * Returns an array of block codes.
 */
function computeBlockReasons(candidate, options = {}) {
  const {
    activationState,
    routingPolicy,
    overrideRoutingPolicy,
    kinds,
    intent,
    targetHarness,
  } = options;
  const reasons = [];

  // If override is set, skip all eligibility checks
  if (overrideRoutingPolicy) return reasons;

  // 1. Kind not applicable for intent
  if (kinds && kinds.length > 0) {
    if (!kinds.includes(candidate.kind)) {
      reasons.push(BLOCK_CODE.KIND_NOT_APPLICABLE);
    }
  }

  // 2. Intent-based kind filtering
  if (!reasons.includes(BLOCK_CODE.KIND_NOT_APPLICABLE)) {
    if (intent === 'task-routing' && TOOL_ROUTING_KINDS.includes(candidate.kind)) {
      // MCP/CLI tools are not primary for task routing
      // They're not fully blocked, but we note they're less relevant
      // (we handle this via scoring, not blocking, so no block code here)
    }
    if (intent === 'tool-routing' && candidate.kind === 'skill') {
      // Skills are not primary for tool routing - same approach
    }
  }

  // 3. Deprecated
  if (candidate.deprecated) {
    reasons.push(BLOCK_CODE.DEPRECATED);
  }

  // 4. Disabled
  if (candidate.enabled === false) {
    reasons.push(BLOCK_CODE.DISABLED);
  }

  // 5. Not installed
  if (candidate.installed === false && candidate.available === true) {
    reasons.push(BLOCK_CODE.NOT_INSTALLED);
  }

  // 6. Projection unavailable (not available at all)
  if (candidate.available === false && candidate.installed === false) {
    reasons.push(BLOCK_CODE.PROJECTION_UNAVAILABLE);
  }

  // 7. External source specific checks
  if (candidate.sourceType === 'external') {
    // External source not activated for target harness
    if (!candidate.installed) {
      // Check if activation exists but for different harness
      if (candidate._targetHarness) {
        reasons.push(BLOCK_CODE.EXTERNAL_SOURCE_NOT_ACTIVATED);
      }
    }

    // Stale source
    if (candidate._staleSource) {
      reasons.push(BLOCK_CODE.STALE_SOURCE);
    }
  }

  // 8. Not in active bundle (for catalog assets only)
  if (candidate.sourceType === 'catalog' && routingPolicy) {
    const eligibleAssetIds = new Set(
      Array.isArray(routingPolicy.eligibleAssetIds)
        ? routingPolicy.eligibleAssetIds
        : []
    );
    if (eligibleAssetIds.size > 0 && !eligibleAssetIds.has(candidate.id)) {
      reasons.push(BLOCK_CODE.NOT_IN_ACTIVE_BUNDLE);
    }
  }

  // 9. Activation layer mismatch
  if (candidate.sourceType === 'catalog' && activationState) {
    const activeBundleIds = new Set(
      Array.isArray(activationState.activeBundleIds)
        ? activationState.activeBundleIds
        : []
    );
    // If the candidate has bundles but none are active
    if (
      candidate.bundleIds.length > 0 &&
      activeBundleIds.size > 0 &&
      !candidate.bundleIds.some((bid) => activeBundleIds.has(bid))
    ) {
      if (!reasons.includes(BLOCK_CODE.NOT_IN_ACTIVE_BUNDLE)) {
        reasons.push(BLOCK_CODE.NOT_IN_ACTIVE_BUNDLE);
      }
    }
  }

  return reasons;
}

// ---------------------------------------------------------------------------
// Suggested actions
// ---------------------------------------------------------------------------

/**
 * Compute suggested actions for a blocked candidate.
 */
function computeSuggestedActions(candidate, blockReasons, options = {}) {
  const actions = [];
  const { targetHarness } = options;

  for (const reason of blockReasons) {
    switch (reason) {
      case BLOCK_CODE.DISABLED:
        actions.push({
          operation: SUGGESTED_OPERATION.ENABLE_ASSET,
          label: `Enable "${candidate.title || candidate.key}"`,
          targetId: candidate.id,
          targetKind: candidate.kind,
          route: '/api/catalog/assets/enable',
        });
        break;

      case BLOCK_CODE.NOT_INSTALLED:
        if (candidate.sourceType === 'catalog') {
          actions.push({
            operation: SUGGESTED_OPERATION.ENABLE_ASSET,
            label: `Install "${candidate.title || candidate.key}"`,
            targetId: candidate.id,
            targetKind: candidate.kind,
            route: '/api/catalog/assets/install',
          });
        }
        break;

      case BLOCK_CODE.EXTERNAL_SOURCE_NOT_ACTIVATED:
        actions.push({
          operation: SUGGESTED_OPERATION.ACTIVATE_SOURCE_INSTALLABLE,
          label: `Activate "${candidate.title || candidate.key}" for ${targetHarness || 'target harness'}`,
          targetId: candidate._sourceId || candidate.id,
          targetKind: 'source',
          route: '/api/catalog/sources/activate',
        });
        break;

      case BLOCK_CODE.STALE_SOURCE:
        actions.push({
          operation: SUGGESTED_OPERATION.REFRESH_SOURCE,
          label: `Refresh source for "${candidate.title || candidate.key}"`,
          targetId: candidate._sourceId || candidate.id,
          targetKind: 'source',
          route: '/api/catalog/sources/refresh',
        });
        break;

      case BLOCK_CODE.NOT_IN_ACTIVE_BUNDLE:
        actions.push({
          operation: 'activate-bundle',
          label: `Activate bundle containing "${candidate.title || candidate.key}"`,
          targetId: candidate.bundleIds[0] || candidate.id,
          targetKind: 'bundle',
          route: '/api/catalog/activation',
        });
        break;

      case BLOCK_CODE.PROJECTION_UNAVAILABLE:
        actions.push({
          operation: SUGGESTED_OPERATION.REBUILD_PROJECTION,
          label: 'Rebuild catalog projection',
          targetId: 'catalog',
          targetKind: 'projection',
          route: '/api/catalog/refresh',
        });
        break;

      case BLOCK_CODE.DEPRECATED:
        // Deprecated assets don't have a direct fix action
        actions.push({
          operation: 'acknowledge-deprecated',
          label: `"${candidate.title || candidate.key}" is deprecated and may be removed`,
          targetId: candidate.id,
          targetKind: candidate.kind,
        });
        break;

      default:
        break;
    }
  }

  // Deduplicate actions by operation+targetId
  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.operation}:${action.targetId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Build text-match explanations and score for a candidate.
 */
function scoreCandidateText(candidate, query) {
  const explanations = [];
  const queryLower = normalizeString(query).toLowerCase();
  const tokens = tokenizeSearchText(query);
  const keyLower = normalizeString(candidate.key).toLowerCase();
  const titleLower = normalizeString(candidate.title).toLowerCase();
  const descLower = normalizeString(candidate.description).toLowerCase();

  if (queryLower && (keyLower === queryLower || titleLower === queryLower)) {
    explanations.push({
      code: 'exact-name',
      weight: TEXT_SCORE_WEIGHTS['exact-name'],
      message: `Exact match for "${query}".`,
    });
  } else if (queryLower && (keyLower.includes(queryLower) || titleLower.includes(queryLower))) {
    explanations.push({
      code: 'name',
      weight: TEXT_SCORE_WEIGHTS['name'],
      message: 'Matched candidate name/title.',
    });
  }

  if (tokens.length > 0 && tokens.some((token) => descLower.includes(token))) {
    explanations.push({
      code: 'description',
      weight: TEXT_SCORE_WEIGHTS['description'],
      message: 'Matched candidate description.',
    });
  }

  if (tokens.length > 0 && candidate.tags && listIncludesAny(candidate.tags, tokens)) {
    explanations.push({
      code: 'tags',
      weight: TEXT_SCORE_WEIGHTS['tags'],
      message: 'Matched candidate tags.',
    });
  }

  return explanations;
}

/**
 * Compute eligibility bonus for a candidate.
 */
function computeEligibilityScore(candidate) {
  let bonus = 0;
  const explanations = [];

  if (candidate.eligible) {
    bonus += ELIGIBILITY_BONUS;
    explanations.push({
      code: 'eligible',
      weight: ELIGIBILITY_BONUS,
      message: 'Candidate is eligible for routing.',
    });
  }

  if (candidate.installed) {
    bonus += INSTALLED_BONUS;
    explanations.push({
      code: 'installed',
      weight: INSTALLED_BONUS,
      message: 'Candidate is installed.',
    });
  }

  if (candidate.enabled) {
    bonus += ENABLED_BONUS;
    explanations.push({
      code: 'enabled',
      weight: ENABLED_BONUS,
      message: 'Candidate is enabled.',
    });
  }

  if (candidate.bundleIds && candidate.bundleIds.length > 0) {
    bonus += ACTIVE_BUNDLE_BONUS;
    explanations.push({
      code: 'in-bundle',
      weight: ACTIVE_BUNDLE_BONUS,
      message: 'Candidate belongs to active bundles.',
    });
  }

  if (candidate.contentLayer === 'repo-local' || candidate.contentLayer === 'repo-state-overlay') {
    bonus += REPO_LOCAL_BONUS;
    explanations.push({
      code: 'repo-local',
      weight: REPO_LOCAL_BONUS,
      message: 'Candidate is repo-local.',
    });
  }

  if (candidate.recommended) {
    bonus += RECOMMENDED_BONUS;
    explanations.push({
      code: 'recommendation',
      weight: RECOMMENDED_BONUS,
      message: 'Candidate is currently recommended.',
    });
  }

  return { bonus, explanations };
}

/**
 * Score a single candidate by combining text match and eligibility bonuses.
 */
function scoreCandidate(candidate, query, intent, kinds) {
  const textExplanations = query ? scoreCandidateText(candidate, query) : [];
  const { bonus, explanations: eligibilityExplanations } = computeEligibilityScore(candidate);

  // Intent-based adjustments
  let intentBonus = 0;
  if (intent === 'task-routing' && TASK_ROUTING_KINDS.includes(candidate.kind)) {
    intentBonus = 3;
    eligibilityExplanations.push({
      code: 'intent-match',
      weight: 3,
      message: 'Kind matches task-routing intent.',
    });
  } else if (intent === 'tool-routing' && TOOL_ROUTING_KINDS.includes(candidate.kind)) {
    intentBonus = 3;
    eligibilityExplanations.push({
      code: 'intent-match',
      weight: 3,
      message: 'Kind matches tool-routing intent.',
    });
  } else if (intent === 'install-recommendation' && !candidate.installed && candidate.available) {
    intentBonus = 5;
    eligibilityExplanations.push({
      code: 'install-gap',
      weight: 5,
      message: 'Candidate is an install gap (not installed but available).',
    });
  } else if (intent === 'source-diagnostics') {
    // Source diagnostics wants to surface issues, not hide them
    intentBonus = 1;
  }

  const allExplanations = [...textExplanations, ...eligibilityExplanations];
  const totalScore = allExplanations.reduce((sum, ex) => sum + ex.weight, 0) + intentBonus;

  return {
    score: totalScore,
    explanations: allExplanations,
  };
}

// ---------------------------------------------------------------------------
// Candidate sorting
// ---------------------------------------------------------------------------

/**
 * Sort candidates by preference:
 * 1. Eligible before blocked
 * 2. Higher score first
 * 3. Catalog before external (same score)
 * 4. Installed before uninstalled (same score)
 * 5. Enabled before disabled (same score)
 * 6. Alphabetical by key (tiebreaker)
 */
function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    // Eligible first
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    // Higher score first
    if (b.score !== a.score) return b.score - a.score;
    // Catalog before external
    if (a.sourceType !== b.sourceType) {
      return a.sourceType === 'catalog' ? -1 : 1;
    }
    // Installed before uninstalled
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    // Enabled before disabled
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    // Alphabetical
    return String(a.key || '').localeCompare(String(b.key || ''));
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Explain a routing decision.
 * 
 * @param {object} request - Route explanation request
 * @param {string} request.query - Search/route query
 * @param {string} [request.repoPath] - Absolute repo path
 * @param {string} [request.repoId] - Registered repo ID
 * @param {string} [request.targetHarness] - Target harness (copilot, codex, opencode, antigravity)
 * @param {string} request.intent - Routing intent
 * @param {string[]} [request.kinds] - Capability kinds to consider
 * @param {boolean} [request.overrideRoutingPolicy] - Bypass routing policy
 * @param {boolean} [request.fallbackCurated] - When true, exclude external/provider/imported assets (catalog-only mode)
 * 
 * @param {object} [options] - Dependencies and pre-loaded state
 * @param {object} [options.snapshot] - Catalog projection snapshot
 * @param {object} [options.activationState] - Resolved activation state
 * @param {object} [options.routingPolicy] - Routing policy snapshot
 * @param {object} [options.externalSources] - External sources list result
 * @param {string} [options.correlationId] - Correlation ID
 * @param {object} [options.crypto] - Crypto module for ID generation
 * 
 * @returns {object} RouteExplanationDecision
 */
function explainRoute(request, options = {}) {
  const query = normalizeString(request?.query || '');
  const intent = request?.intent || 'task-routing';
  const kinds = Array.isArray(request?.kinds) && request.kinds.length > 0
    ? request.kinds.filter((k) => ALL_KINDS.includes(k))
    : ALL_KINDS;
  const targetHarness = normalizeString(request?.targetHarness);
  const overrideRoutingPolicy = Boolean(request?.overrideRoutingPolicy);
  const fallbackCurated = Boolean(request?.fallbackCurated);
  const correlationId =
    options.correlationId ||
    request?.correlationId ||
    generateCorrelationId(options.crypto);

  // 1. Collect all candidates
  const rawCandidates = collectCandidates({
    snapshot: options.snapshot,
    externalSources: options.externalSources,
    targetHarness,
    fallbackCurated,
  });

  // 2. Filter by requested kinds
  const kindSet = new Set(kinds);
  let candidates = rawCandidates.filter((c) => kindSet.has(c.kind));

  // 3. Compute block reasons for each candidate
  for (const candidate of candidates) {
    const blockReasons = computeBlockReasons(candidate, {
      activationState: options.activationState,
      routingPolicy: options.routingPolicy,
      overrideRoutingPolicy,
      kinds,
      intent,
      targetHarness,
    });
    candidate.blockedReasons = blockReasons;
    candidate.eligible = blockReasons.length === 0;
    candidate.actions = blockReasons.length > 0
      ? computeSuggestedActions(candidate, blockReasons, { targetHarness })
      : [];
  }

  // 4. Score candidates
  for (const candidate of candidates) {
    const { score, explanations } = scoreCandidate(candidate, query, intent, kinds);
    candidate.score = score;
    candidate.explanations = explanations;
  }

  // 5. Sort by preference
  candidates = sortCandidates(candidates);

  // 6. Clean internal fields
  candidates = candidates.map((c) => {
    const { _staleSource, _sourceId, _targetHarness, ...clean } = c;
    return clean;
  });

  // 7. Build decision
  const eligibleCandidates = candidates.filter((c) => c.eligible && c.score > 0);
  const blockedCandidates = candidates.filter((c) => !c.eligible);
  const decision = eligibleCandidates.length > 0 ? eligibleCandidates[0] : undefined;

  const blocks = blockedCandidates.map((c) => ({
    candidateId: c.id,
    candidateKey: c.key,
    kind: c.kind,
    blockedReasons: c.blockedReasons,
    suggestedActions: c.actions,
  }));

  // Collect all suggested actions from blocked candidates
  const suggestedActions = [];
  const seenActions = new Set();
  for (const block of blocks) {
    for (const action of block.suggestedActions) {
      const actionKey = `${action.operation}:${action.targetId}`;
      if (!seenActions.has(actionKey)) {
        seenActions.add(actionKey);
        suggestedActions.push(action);
      }
    }
  }

  // 8. Build policy snapshot
  const policy = {
    schemaVersion: ROUTING_POLICY_SCHEMA_VERSION,
    profile: options.routingPolicy?.profile || options.activationState?.plannerProfile || 'balanced',
    orchestrationPolicy:
      options.routingPolicy?.orchestrationPolicy ||
      options.activationState?.orchestrationPolicy ||
      'balanced',
    activeBundleIds: uniqueStrings(
      options.routingPolicy?.activeBundleIds || options.activationState?.activeBundleIds || []
    ),
    totalCandidates: candidates.length,
    eligibleCount: eligibleCandidates.length,
    blockedCount: blockedCandidates.length,
    failClosed: options.routingPolicy?.failClosed !== false,
    targetHarness: targetHarness || undefined,
    intent,
    overrideApplied: overrideRoutingPolicy,
  };

  return {
    kind: 'catalog.route.explanation',
    deterministic: true,
    correlationId,
    decision,
    candidates,
    policy,
    blocks: blocks.length > 0 ? blocks : undefined,
    suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
    decidedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helper: build a lightweight policy snapshot for search integration
// ---------------------------------------------------------------------------

/**
 * Build a compact eligibility filter that can be used by the search endpoint
 * to apply the same policy decisions without re-running the full explainRoute.
 * 
 * Returns { eligibleAssetIds, blockMap } where blockMap maps assetId → blockReasons[].
 */
function buildEligibilityFilter(request, options = {}) {
  const result = explainRoute(request, options);
  const eligibleAssetIds = new Set(
    result.candidates
      .filter((c) => c.eligible && c.sourceType === 'catalog')
      .map((c) => c.id)
  );
  const blockMap = {};
  for (const block of result.blocks || []) {
    blockMap[block.candidateId] = block.blockedReasons;
  }
  return { eligibleAssetIds, blockMap, routingPolicy: result.policy };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  BLOCK_CODE,
  SUGGESTED_OPERATION,
  TEXT_SCORE_WEIGHTS,
  ALL_KINDS,
  TASK_ROUTING_KINDS,
  TOOL_ROUTING_KINDS,
  explainRoute,
  buildEligibilityFilter,
  normalizeEffectiveAsset,
  normalizeExternalInstallable,
  collectCandidates,
  computeBlockReasons,
  computeSuggestedActions,
  scoreCandidate,
  sortCandidates,
};
