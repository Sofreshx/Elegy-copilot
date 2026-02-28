'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const planState = require('./planState');
const { sortPlanningCandidates } = require('./planningSemantic');
const {
  DEFAULT_RUNTIME_PROVIDER,
  RUNTIME_PROVIDERS,
  normalizeRuntimeProvider,
} = require('./runtimeContracts');

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';
const PLANNING_PERSISTENCE_HEALTH_KIND = 'planning.persistence.health';
const PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION = '1';
const FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION = '1';
const FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION = '1';
const DEFAULT_CREATE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COMPARE_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_ROUTE_LOCK_TTL_MS = 15 * 1000;
const MAX_ROUTE_LOCK_TTL_MS = 60 * 1000;
const DEFAULT_IMPLEMENTED_OUTCOMES_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COMPARE_LIMIT = 20;
const MAX_IMPLEMENTED_SOURCE_BYTES = 2 * 1024 * 1024;
const IMPLEMENTED_OUTCOME_SOURCE_TYPES = Object.freeze([
  'plan-md',
  'final-md',
  'plans-index',
]);

const SHARED_PROVIDER_LIFECYCLE_CAPABILITIES = Object.freeze([
  'create',
  'open-terminal',
  'start',
  'stop',
]);

const PROVIDER_LIFECYCLE_CAPABILITY_MATRIX = Object.freeze({
  [RUNTIME_PROVIDERS.NON_DOCKER]: Object.freeze([
    ...SHARED_PROVIDER_LIFECYCLE_CAPABILITIES,
  ]),
  [RUNTIME_PROVIDERS.DOCKER]: Object.freeze([
    ...SHARED_PROVIDER_LIFECYCLE_CAPABILITIES,
    'pr-open',
  ]),
});

const ALLOWLISTED_PROVIDER_LIFECYCLE_CAPABILITIES = Object.freeze([
  ...new Set([
    ...PROVIDER_LIFECYCLE_CAPABILITY_MATRIX[RUNTIME_PROVIDERS.NON_DOCKER],
    ...PROVIDER_LIFECYCLE_CAPABILITY_MATRIX[RUNTIME_PROVIDERS.DOCKER],
  ]),
]);

const FINISH_COMPATIBILITY_SUPPORTED_PROVIDERS = Object.freeze(
  Object.values(RUNTIME_PROVIDERS).slice().sort(deterministicStringCompare),
);

const FINISH_COMPATIBILITY_RECEIPT_REQUIRED_FIELDS = Object.freeze([
  'deterministic',
  'hookContractVersion',
  'issuedAt',
  'outcome',
  'provider',
  'receiptId',
  'resolvedAt',
  'status',
]);

const FINISH_COMPATIBILITY_RECEIPT_OPTIONAL_FIELDS = Object.freeze([
  'metadata',
  'reason',
]);

const IMPLEMENTED_OUTCOME_SOURCE_SET = new Set(IMPLEMENTED_OUTCOME_SOURCE_TYPES);

function buildPlanningPrecedenceMetadata() {
  return {
    contractVersion: planState.PLANNING_PRECEDENCE_CONTRACT_VERSION,
    rules: Array.isArray(planState.PLANNING_RECORD_PRECEDENCE_RULES)
      ? planState.PLANNING_RECORD_PRECEDENCE_RULES.slice()
      : [],
    deterministic: true,
  };
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value == null) {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(deterministicStringCompare);
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex');
}

function normalizeIdentity(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : '';
}

function normalizeString(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function normalizeLifecycleCapabilityAction(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeNowMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function normalizePositiveInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const floored = Math.floor(numeric);
  if (floored < 0) return fallback;
  return floored;
}

function normalizeIso(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeDeterministicStringArray(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];

  for (const value of list) {
    const token = normalizeString(value);
    if (!token) continue;
    normalized.push(token);
  }

  return [...new Set(normalized)].sort(deterministicStringCompare);
}

function normalizeImplementedOutcomeMarkerStatus(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'available') return 'available';
  if (normalized === 'stale') return 'stale';
  if (normalized === 'invalid') return 'invalid';
  if (normalized === 'unavailable') return 'unavailable';
  return 'unavailable';
}

function finalizeImplementedOutcomeMarker(input = {}) {
  const marker = isPlainObject(input) ? { ...input } : {};
  const status = normalizeImplementedOutcomeMarkerStatus(marker.status);
  const reason = normalizeString(marker.reason)
    || (status === 'available'
      ? 'source_available'
      : status === 'stale'
        ? 'source_stale'
        : 'source_unavailable');
  const stale = status === 'stale';
  const conflict = status === 'unavailable' || status === 'invalid';

  return {
    ...marker,
    status,
    reason,
    reasonCode: reason,
    stale,
    conflict,
    marker: stale ? 'stale' : conflict ? 'conflict' : 'none',
  };
}

function buildImplementedOutcomeMarkerCollections(markers) {
  const sourceMarkers = Array.isArray(markers) ? markers : [];
  const staleMarkers = [];
  const conflictMarkers = [];
  const reasonCodes = [];

  for (const marker of sourceMarkers) {
    const finalized = finalizeImplementedOutcomeMarker(marker);
    const summary = {
      sourceId: finalized.sourceId,
      sourceType: finalized.sourceType,
      path: finalized.path,
      status: finalized.status,
      reason: finalized.reasonCode,
      marker: finalized.marker,
    };

    if (finalized.stale) staleMarkers.push(summary);
    if (finalized.conflict) conflictMarkers.push(summary);
    if (finalized.stale || finalized.conflict) {
      reasonCodes.push(finalized.reasonCode);
    }
  }

  staleMarkers.sort((a, b) => deterministicStringCompare(String(a.sourceId || ''), String(b.sourceId || '')));
  conflictMarkers.sort((a, b) => deterministicStringCompare(String(a.sourceId || ''), String(b.sourceId || '')));

  return {
    staleMarkers,
    conflictMarkers,
    reasonCodes: normalizeDeterministicStringArray(reasonCodes),
  };
}

function normalizeScopeList(input, defaultScopes = []) {
  const requested = Array.isArray(input) ? input : defaultScopes;
  const accepted = new Set();

  for (const entry of requested) {
    const normalized = planState.normalizePlanningScope(entry);
    if (normalized) {
      accepted.add(normalized);
    }
  }

  return planState.PLANNING_SCOPES.filter((scope) => accepted.has(scope));
}

function normalizeState(value) {
  const normalized = planState.normalizePlanningState(value);
  return normalized || 'thought';
}

function normalizeScore(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeLimit(value, defaultValue = DEFAULT_COMPARE_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultValue;
  const floored = Math.floor(numeric);
  if (floored <= 0) return defaultValue;
  return Math.min(floored, 100);
}

function normalizeRelativePath(input) {
  if (typeof input !== 'string') return '';
  return input.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '');
}

function containsPathTraversal(input) {
  if (typeof input !== 'string' || !input.trim()) return true;
  if (path.isAbsolute(input)) return true;
  if (/^[A-Za-z]:/.test(input)) return true;

  const normalized = normalizeRelativePath(input);
  if (!normalized) return true;

  const segments = normalized.split('/');
  return segments.some((segment) => !segment || segment === '.' || segment === '..');
}

function safeResolveUnder(rootDirAbs, relativePath) {
  const root = path.resolve(rootDirAbs);
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error('path_escapes_root');
  }
  return resolved;
}

function normalizeTextForSearch(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokenize(value) {
  const normalized = normalizeTextForSearch(value);
  if (!normalized) return [];
  return normalized.split(/[^a-z0-9]+/i).filter(Boolean);
}

function roundSix(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1_000_000) / 1_000_000;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function lexicalScore(query, text) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;

  const source = normalizeTextForSearch(text);
  if (!source) return 0;

  let matches = 0;
  for (const token of queryTokens) {
    if (source.includes(token)) {
      matches += 1;
    }
  }

  return roundSix(matches / queryTokens.length);
}

function semanticScoreFromRecord(record) {
  const numeric = normalizeScore(record && record.score);
  if (numeric == null) return 0;
  if (numeric > 1 && numeric <= 100) return clamp(numeric / 100, 0, 1);
  return clamp(numeric, 0, 1);
}

function buildErrorBody(kind, code, reason, extras = {}) {
  return {
    contractVersion: PLANNING_API_CONTRACT_VERSION,
    kind,
    deterministic: true,
    error: {
      code,
      reason,
    },
    ...extras,
  };
}

function buildPlanningPersistenceHealthEnvelope(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const migrations = isPlainObject(source.migrations) ? source.migrations : {};
  const governance = isPlainObject(source.governance) ? source.governance : {};
  const checksumValidation = isPlainObject(migrations.checksumValidation)
    ? migrations.checksumValidation
    : {};

  const normalizedBaselineMismatch = Boolean(migrations.baselineMismatch)
    || Boolean(checksumValidation.baselineMismatch);
  const normalizedDriftDetected = Boolean(migrations.driftDetected)
    || Boolean(checksumValidation.driftDetected);

  return {
    contractVersion: normalizeString(source.contractVersion) || '1',
    kind: PLANNING_PERSISTENCE_HEALTH_KIND,
    deterministic: true,
    apiContractVersion: PLANNING_API_CONTRACT_VERSION,
    required: Boolean(source.required),
    configured: Boolean(source.configured),
    usable: Boolean(source.usable),
    status: normalizeString(source.status) || 'disabled',
    errors: normalizeDeterministicStringArray(source.errors),
    lastError: normalizeString(source.lastError) || null,
    governance: {
      deterministic: true,
      failClosed: governance.failClosed !== false,
      ready: Boolean(governance.ready),
      code: normalizeString(governance.code) || 'planning_persistence_disabled',
      reason: normalizeString(governance.reason)
        || normalizeString(governance.code)
        || 'planning_persistence_disabled',
      reasonCodes: normalizeDeterministicStringArray(governance.reasonCodes),
    },
    migrations: {
      schemaTable: normalizeString(migrations.schemaTable) || 'ie_schema_versions',
      latestVersion: normalizeString(migrations.latestVersion) || null,
      manifestCount: normalizePositiveInteger(migrations.manifestCount, 0),
      checksumBaseline: normalizeString(migrations.checksumBaseline) || null,
      baselineEnforced: migrations.baselineEnforced !== false,
      baselineMismatch: normalizedBaselineMismatch,
      appliedCount: normalizePositiveInteger(migrations.appliedCount, 0),
      appliedVersions: normalizeDeterministicStringArray(migrations.appliedVersions),
      driftDetected: normalizedDriftDetected,
      checksumValidation: {
        outcome: normalizeString(checksumValidation.outcome)
          || (normalizedDriftDetected || normalizedBaselineMismatch ? 'fail' : 'pass'),
        reason: normalizeString(checksumValidation.reason)
          || (normalizedBaselineMismatch
            ? 'manifest_checksum_baseline_mismatch'
            : normalizedDriftDetected
              ? 'manifest_checksum_drift_detected'
              : 'all_manifest_checksums_match'),
        driftDetected: normalizedDriftDetected,
        baselineMismatch: normalizedBaselineMismatch,
        checkedVersionCount: normalizePositiveInteger(checksumValidation.checkedVersionCount, 0),
        checkedVersions: normalizeDeterministicStringArray(checksumValidation.checkedVersions),
        manifestVersionCount: normalizePositiveInteger(checksumValidation.manifestVersionCount, 0),
        manifestChecksumBaseline: normalizeString(checksumValidation.manifestChecksumBaseline)
          || normalizeString(migrations.checksumBaseline)
          || null,
        enforcement: normalizeString(checksumValidation.enforcement) || 'fail_closed',
        failure: isPlainObject(checksumValidation.failure)
          ? {
            version: normalizeString(checksumValidation.failure.version) || null,
            expectedChecksum: normalizeString(checksumValidation.failure.expectedChecksum) || null,
            actualChecksum: normalizeString(checksumValidation.failure.actualChecksum) || null,
            unexpectedVersions: normalizeDeterministicStringArray(checksumValidation.failure.unexpectedVersions),
            detail: normalizeString(checksumValidation.failure.detail) || null,
          }
          : null,
      },
      lastRunAt: normalizeIso(migrations.lastRunAt),
    },
  };
}

function buildFinishCompatibilityHookContract() {
  return {
    contractVersion: FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION,
    apiContractVersion: PLANNING_API_CONTRACT_VERSION,
    kind: 'lifecycle.finish.compatibility-hook',
    deterministic: true,
    action: 'finish',
    providerAgnostic: true,
    supportedProviders: FINISH_COMPATIBILITY_SUPPORTED_PROVIDERS.slice(),
    scopeBoundary: 'ws2_contract_hook_only',
    ws4Ownership: 'finish_behavior_and_ux',
    receipt: {
      contractVersion: FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION,
      kind: 'lifecycle.finish.receipt',
      deterministic: true,
      providerAgnostic: true,
      requiredFields: FINISH_COMPATIBILITY_RECEIPT_REQUIRED_FIELDS.slice(),
      optionalFields: FINISH_COMPATIBILITY_RECEIPT_OPTIONAL_FIELDS.slice(),
    },
  };
}

function evaluateProviderLifecycleCapability(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const provider = normalizeRuntimeProvider(source.provider) || DEFAULT_RUNTIME_PROVIDER;
  const action = normalizeLifecycleCapabilityAction(source.action);
  const finishCompatibilityHook = buildFinishCompatibilityHookContract();
  const sharedActions = SHARED_PROVIDER_LIFECYCLE_CAPABILITIES.slice().sort(deterministicStringCompare);

  const providerActions = Array.isArray(PROVIDER_LIFECYCLE_CAPABILITY_MATRIX[provider])
    ? PROVIDER_LIFECYCLE_CAPABILITY_MATRIX[provider]
    : SHARED_PROVIDER_LIFECYCLE_CAPABILITIES;
  const supportedActions = providerActions.slice().sort(deterministicStringCompare);

  if (!action) {
    return {
      contractVersion: PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION,
      apiContractVersion: PLANNING_API_CONTRACT_VERSION,
      deterministic: true,
      provider,
      action: null,
      shared: false,
      supported: false,
      marker: 'unsupported',
      reason: 'action_missing',
      sharedActions,
      supportedActions,
      finishCompatibilityHook,
    };
  }

  if (!ALLOWLISTED_PROVIDER_LIFECYCLE_CAPABILITIES.includes(action)) {
    return {
      contractVersion: PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION,
      apiContractVersion: PLANNING_API_CONTRACT_VERSION,
      deterministic: true,
      provider,
      action,
      shared: false,
      supported: false,
      marker: 'unsupported',
      reason: 'action_not_allowlisted',
      sharedActions,
      supportedActions,
      finishCompatibilityHook,
    };
  }

  const shared = SHARED_PROVIDER_LIFECYCLE_CAPABILITIES.includes(action);
  const supported = supportedActions.includes(action);
  const reason = supported
    ? (shared ? 'shared_capability_supported' : 'provider_capability_supported')
    : (shared ? 'shared_capability_contract_violation' : 'provider_capability_unsupported');

  return {
    contractVersion: PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION,
    apiContractVersion: PLANNING_API_CONTRACT_VERSION,
    deterministic: true,
    provider,
    action,
    shared,
    supported,
    marker: supported ? 'supported' : 'unsupported',
    reason,
    sharedActions,
    supportedActions,
    finishCompatibilityHook,
  };
}

function buildLifecycleUnsupportedCapabilityMarker(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const capability = evaluateProviderLifecycleCapability(source);
  const finishCompatibilityHook = buildFinishCompatibilityHookContract();
  if (capability.supported) {
    return null;
  }

  return {
    error: 'Lifecycle capability unsupported',
    code: 'lifecycle_capability_unsupported',
    action: capability.action || normalizeLifecycleCapabilityAction(source.action) || null,
    reason: capability.reason,
    deterministic: true,
    unsupported: {
      marker: 'unsupported',
      provider: capability.provider,
      shared: capability.shared,
      reason: capability.reason,
    },
    finishCompatibilityHook,
    capability,
  };
}

function createPlanningApiState() {
  return {
    recordsById: new Map(),
    nextRecordNumber: 1,
    recordsVersion: 0,
    recordsProjectionHash: null,
    routeLocks: new Map(),
    idempotency: {
      create: new Map(),
      compare: new Map(),
    },
  };
}

function normalizeRouteLockTtlMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_ROUTE_LOCK_TTL_MS;
  const floored = Math.floor(numeric);
  if (floored <= 0) return DEFAULT_ROUTE_LOCK_TTL_MS;
  return Math.min(floored, MAX_ROUTE_LOCK_TTL_MS);
}

function buildPlanningRouteLockKey(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const routeKind = normalizeString(source.routeKind || source.kind).toLowerCase() || 'planning.unknown';
  const actorId = normalizeIdentity(source.actorId || source.userId) || 'anonymous';
  const repoId = normalizeIdentity(source.repoId) || '-';
  const scope = normalizeString(source.scope).toLowerCase() || '-';
  return ['planning.lock', routeKind, actorId, repoId, scope].join('|');
}

function ensurePlanningRouteLockStore(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('planning_api_state_required');
  }

  if (!(state.routeLocks instanceof Map)) {
    state.routeLocks = new Map();
  }

  return state.routeLocks;
}

function reapPlanningRouteLocks(store, nowMs) {
  for (const [lockKey, lock] of store.entries()) {
    const expiresAtMs = Number(lock && lock.expiresAtMs);
    if (!Number.isFinite(expiresAtMs) || nowMs > expiresAtMs) {
      store.delete(lockKey);
    }
  }
}

function acquirePlanningRouteLock(state, input = {}) {
  const source = isPlainObject(input) ? input : {};
  const lockStore = ensurePlanningRouteLockStore(state);
  const nowMs = normalizeNowMs(source.nowMs);
  const ttlMs = normalizeRouteLockTtlMs(source.ttlMs);
  const lockKey = buildPlanningRouteLockKey(source);
  const ownerId = normalizeString(source.ownerId) || 'anonymous-owner';

  reapPlanningRouteLocks(lockStore, nowMs);

  const existing = lockStore.get(lockKey);
  if (existing && existing.ownerId !== ownerId) {
    return {
      ok: false,
      conflict: true,
      code: 'planning_route_lock_conflict',
      reason: 'lock_already_held',
      deterministic: true,
      lock: {
        lockKey,
        ownerId,
        heldBy: existing.ownerId,
        expiresAt: new Date(existing.expiresAtMs).toISOString(),
      },
    };
  }

  const acquiredAtMs = existing && Number.isFinite(existing.acquiredAtMs)
    ? existing.acquiredAtMs
    : nowMs;
  const expiresAtMs = nowMs + ttlMs;

  lockStore.set(lockKey, {
    lockKey,
    ownerId,
    routeKind: normalizeString(source.routeKind || source.kind).toLowerCase() || 'planning.unknown',
    acquiredAtMs,
    expiresAtMs,
  });

  return {
    ok: true,
    deterministic: true,
    acquired: !existing,
    reentrant: Boolean(existing),
    lock: {
      lockKey,
      ownerId,
      routeKind: normalizeString(source.routeKind || source.kind).toLowerCase() || 'planning.unknown',
      ttlMs,
      acquiredAt: new Date(acquiredAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    },
  };
}

function releasePlanningRouteLock(state, handle) {
  const lockStore = ensurePlanningRouteLockStore(state);
  const source = isPlainObject(handle) ? handle : {};
  const lock = isPlainObject(source.lock) ? source.lock : source;
  const lockKey = normalizeString(lock.lockKey);
  const ownerId = normalizeString(lock.ownerId);

  if (!lockKey || !ownerId) {
    return {
      ok: false,
      released: false,
      deterministic: true,
      reason: 'invalid_lock_handle',
    };
  }

  const existing = lockStore.get(lockKey);
  if (!existing || existing.ownerId !== ownerId) {
    return {
      ok: true,
      released: false,
      deterministic: true,
      reason: 'lock_not_owned_or_missing',
    };
  }

  lockStore.delete(lockKey);
  return {
    ok: true,
    released: true,
    deterministic: true,
    reason: 'released',
  };
}

function normalizeProjectionNextRecordNumber(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const floored = Math.floor(numeric);
  return floored > 0 ? floored : fallback;
}

function replacePlanningProjectionFromPersistedRecords(state, input = {}) {
  const source = isPlainObject(input) ? input : {};
  const records = Array.isArray(source.records) ? source.records : [];
  const deduped = new Map();

  for (const entry of records) {
    if (!isPlainObject(entry)) continue;
    const recordId = normalizeString(entry.recordId);
    if (!recordId) continue;
    const candidate = cloneJson(entry);
    const existing = deduped.get(recordId);

    if (!existing) {
      deduped.set(recordId, candidate);
      continue;
    }

    const precedenceDiff = planState.comparePlanningRecords(candidate, existing);
    if (precedenceDiff < 0) {
      deduped.set(recordId, candidate);
      continue;
    }

    if (precedenceDiff > 0) {
      continue;
    }

    const candidateHash = hashPayload(candidate);
    const existingHash = hashPayload(existing);
    if (deterministicStringCompare(candidateHash, existingHash) < 0) {
      deduped.set(recordId, candidate);
    }
  }

  const normalizedRecords = [...deduped.values()].sort(planState.comparePlanningRecords);
  const projectionHash = hashPayload(normalizedRecords);
  const changed = String(state.recordsProjectionHash || '') !== projectionHash;

  state.recordsById = new Map(
    normalizedRecords.map((record) => [String(record.recordId), cloneJson(record)]),
  );

  state.nextRecordNumber = normalizeProjectionNextRecordNumber(
    source.nextRecordNumber,
    normalizeProjectionNextRecordNumber(state.nextRecordNumber, 1),
  );

  if (Number.isFinite(source.recordsVersion)) {
    state.recordsVersion = normalizePositiveInteger(source.recordsVersion, state.recordsVersion || 0);
  } else if (changed) {
    state.recordsVersion = normalizePositiveInteger((state.recordsVersion || 0) + 1, 0);
  } else {
    state.recordsVersion = normalizePositiveInteger(state.recordsVersion, 0);
  }

  state.recordsProjectionHash = projectionHash;

  return {
    changed,
    recordsCount: normalizedRecords.length,
    recordsVersion: state.recordsVersion,
    nextRecordNumber: state.nextRecordNumber,
    projectionHash,
    precedence: buildPlanningPrecedenceMetadata(),
  };
}

function toArrayFromRecordMap(recordsById) {
  return [...recordsById.values()].map((record) => cloneJson(record));
}

function selectRecordsByScope(state, context, scopes) {
  const requestedScopes = normalizeScopeList(scopes, []);
  const userId = normalizeIdentity(context && context.userId);
  const repoId = normalizeIdentity(context && context.repoId);

  const deniedScopes = [];
  const allowedScopes = new Set();

  for (const scope of requestedScopes) {
    if (!userId) {
      deniedScopes.push(scope);
      continue;
    }

    if (scope === 'repo') {
      if (!repoId) {
        deniedScopes.push(scope);
        continue;
      }
      allowedScopes.add(scope);
      continue;
    }

    if (scope === 'global' || scope === 'user') {
      allowedScopes.add(scope);
      continue;
    }

    deniedScopes.push(scope);
  }

  const records = [];
  for (const record of state.recordsById.values()) {
    const scope = planState.normalizePlanningScope(record);
    if (!scope || !allowedScopes.has(scope)) continue;

    const ownerId = normalizeIdentity(record.ownerId);
    if (!ownerId || ownerId !== userId) continue;

    if (scope === 'repo') {
      const recordRepoId = normalizeIdentity(record.repoId);
      if (!recordRepoId || recordRepoId !== repoId) continue;
    }

    records.push(cloneJson(record));
  }

  records.sort(planState.comparePlanningRecords);

  return {
    requestedScopes,
    deniedScopes: [...new Set(deniedScopes)].sort(),
    records,
  };
}

function readIdempotencyHeaderValue(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry.trim();
      }
    }
  }

  return '';
}

function runIdempotentOperation(state, options) {
  const operation = String(options.operation || '').trim();
  const scopeKey = String(options.scopeKey || '').trim();
  const idempotencyKey = readIdempotencyHeaderValue(options.idempotencyKey);
  const ttlMs = Number.isFinite(options.ttlMs) ? Number(options.ttlMs) : 0;
  const nowMs = normalizeNowMs(options.nowMs);
  const payloadHash = hashPayload(options.payload || {});

  if (!operation || !state.idempotency || !state.idempotency[operation]) {
    return {
      ok: false,
      statusCode: 500,
      error: buildErrorBody('planning.idempotency', 'idempotency_store_invalid', 'idempotency_store_unavailable'),
    };
  }

  if (!scopeKey) {
    return {
      ok: false,
      statusCode: 400,
      error: buildErrorBody('planning.idempotency', 'invalid_idempotency_scope', 'idempotency_scope_missing'),
    };
  }

  if (!idempotencyKey) {
    return {
      ok: false,
      statusCode: 400,
      error: buildErrorBody('planning.idempotency', 'invalid_idempotency', 'missing_or_invalid_idempotency_key'),
    };
  }

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return {
      ok: false,
      statusCode: 500,
      error: buildErrorBody('planning.idempotency', 'invalid_idempotency_ttl', 'idempotency_ttl_invalid'),
    };
  }

  const store = state.idempotency[operation];
  const mapKey = `${scopeKey}:${idempotencyKey}`;
  const existing = store.get(mapKey);

  let expiredReapplied = false;
  if (existing && Number(existing.expiresAtMs) <= nowMs) {
    store.delete(mapKey);
    expiredReapplied = true;
  }

  const active = store.get(mapKey);
  if (active) {
    if (String(active.payloadHash || '') !== payloadHash) {
      return {
        ok: false,
        statusCode: 409,
        conflict: true,
        error: buildErrorBody('planning.idempotency', 'idempotency_conflict', 'idempotency_key_payload_mismatch', {
          idempotency: {
            key: idempotencyKey,
            scopeKey,
            replay: false,
            conflict: true,
            ttlMs,
            expiresAt: new Date(Number(active.expiresAtMs)).toISOString(),
            outcome: 'conflict',
          },
        }),
      };
    }

    return {
      ok: true,
      replay: true,
      expiredReapplied: false,
      statusCode: 200,
      idempotencyKey,
      scopeKey,
      expiresAtMs: Number(active.expiresAtMs),
      response: cloneJson(active.response),
      outcome: 'replay',
    };
  }

  const executed = options.execute();
  const response = cloneJson(executed);
  const expiresAtMs = nowMs + ttlMs;

  store.set(mapKey, {
    payloadHash,
    response: cloneJson(response),
    expiresAtMs,
  });

  return {
    ok: true,
    replay: false,
    expiredReapplied,
    statusCode: 200,
    idempotencyKey,
    scopeKey,
    expiresAtMs,
    response,
    outcome: expiredReapplied ? 'expired_reapplied' : 'applied',
  };
}

function attachIdempotency(resultBody, meta) {
  const body = cloneJson(resultBody);
  body.idempotency = {
    key: meta.idempotencyKey,
    scopeKey: meta.scopeKey,
    replay: meta.replay === true,
    conflict: false,
    ttlMs: meta.ttlMs,
    expiresAt: new Date(meta.expiresAtMs).toISOString(),
    outcome: meta.outcome,
  };
  return body;
}

function evictPlanningIdempotencyEntry(state, input = {}) {
  const source = isPlainObject(input) ? input : {};
  const operation = normalizeString(source.operation).toLowerCase();
  const scopeKey = normalizeString(source.scopeKey);
  const idempotencyKey = readIdempotencyHeaderValue(source.idempotencyKey);

  if (!operation || !scopeKey || !idempotencyKey) {
    return {
      ok: false,
      deterministic: true,
      evicted: false,
      reason: 'invalid_idempotency_eviction_input',
    };
  }

  if (!state || !state.idempotency || !(state.idempotency[operation] instanceof Map)) {
    return {
      ok: false,
      deterministic: true,
      evicted: false,
      reason: 'idempotency_store_unavailable',
    };
  }

  const store = state.idempotency[operation];
  const mapKey = `${scopeKey}:${idempotencyKey}`;
  const evicted = store.delete(mapKey);

  return {
    ok: true,
    deterministic: true,
    evicted,
    reason: evicted ? 'evicted' : 'entry_missing',
  };
}

function createPlanningRecordOperation(state, input = {}) {
  const context = isPlainObject(input.context) ? input.context : {};
  const request = isPlainObject(input.request) ? input.request : {};
  const nowMs = normalizeNowMs(input.nowMs);

  const userId = normalizeIdentity(context.userId);
  const repoId = normalizeIdentity(context.repoId);

  if (!userId) {
    return {
      ok: false,
      statusCode: 403,
      body: buildErrorBody('planning.create', 'scope_visibility_denied', 'missing_user_context'),
    };
  }

  const scope = planState.normalizePlanningScope(request.scope);
  if (!scope) {
    return {
      ok: false,
      statusCode: 400,
      body: buildErrorBody('planning.create', 'invalid_record_scope', 'missing_or_invalid_scope'),
    };
  }

  if (scope === 'repo' && !repoId) {
    return {
      ok: false,
      statusCode: 403,
      body: buildErrorBody('planning.create', 'scope_visibility_denied', 'repo_scope_requires_repo_context'),
    };
  }

  const title = normalizeString(request.title);
  const summary = normalizeString(request.summary || request.text);
  const normalizedState = normalizeState(request.state || request.status);
  const score = normalizeScore(request.score);

  const ttlMs = Number.isFinite(input.idempotencyTtlMs)
    ? Number(input.idempotencyTtlMs)
    : DEFAULT_CREATE_IDEMPOTENCY_TTL_MS;

  const scopeKey = ['planning.create', userId, scope, scope === 'repo' ? repoId : '-'].join('|');

  const idempotent = runIdempotentOperation(state, {
    operation: 'create',
    scopeKey,
    idempotencyKey: request.idempotencyKey,
    ttlMs,
    nowMs,
    payload: {
      scope,
      title,
      summary,
      state: normalizedState,
      score,
    },
    execute: () => {
      const recordId = `planning-${String(state.nextRecordNumber).padStart(6, '0')}`;
      state.nextRecordNumber += 1;

      const createdAt = new Date(nowMs).toISOString();
      const record = {
        recordId,
        scope,
        ownerId: userId,
        repoId: scope === 'repo' ? repoId : null,
        title,
        summary,
        state: normalizedState,
        score,
        createdAt,
        updatedAt: createdAt,
      };

      state.recordsById.set(recordId, record);
      state.recordsVersion += 1;

      return {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.create',
        deterministic: true,
        versionVector: {
          planningRecordsVersion: state.recordsVersion,
        },
        record,
      };
    },
  });

  if (!idempotent.ok) {
    return {
      ok: false,
      statusCode: idempotent.statusCode,
      body: idempotent.error,
    };
  }

  const body = attachIdempotency(idempotent.response, {
    idempotencyKey: idempotent.idempotencyKey,
    scopeKey,
    replay: idempotent.replay,
    ttlMs,
    expiresAtMs: idempotent.expiresAtMs,
    outcome: idempotent.outcome,
  });

  return {
    ok: true,
    statusCode: 200,
    body,
  };
}

function listPlanningRecordsOperation(state, input = {}) {
  const context = isPlainObject(input.context) ? input.context : {};
  const userId = normalizeIdentity(context.userId);

  if (!userId) {
    return {
      ok: false,
      statusCode: 403,
      body: buildErrorBody('planning.list', 'scope_visibility_denied', 'missing_user_context'),
    };
  }

  const selected = selectRecordsByScope(state, context, input.scopes || planState.PLANNING_SCOPES);

  return {
    ok: true,
    statusCode: 200,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.list',
      deterministic: true,
      precedence: buildPlanningPrecedenceMetadata(),
      requestedScopes: selected.requestedScopes,
      deniedScopes: selected.deniedScopes,
      versionVector: {
        planningRecordsVersion: state.recordsVersion,
      },
      records: selected.records,
    },
  };
}

function searchPlanningRecordsOperation(state, input = {}) {
  const context = isPlainObject(input.context) ? input.context : {};
  const userId = normalizeIdentity(context.userId);

  if (!userId) {
    return {
      ok: false,
      statusCode: 403,
      body: buildErrorBody('planning.search', 'scope_visibility_denied', 'missing_user_context'),
    };
  }

  const selected = selectRecordsByScope(state, context, input.scopes || planState.PLANNING_SCOPES);
  const query = normalizeString(input.query);
  const limit = normalizeLimit(input.limit, DEFAULT_COMPARE_LIMIT);

  const candidates = selected.records.map((record) => ({
    candidateId: record.recordId,
    recordId: record.recordId,
    scope: record.scope,
    status: record.state,
    semanticScore: semanticScoreFromRecord(record),
    lexicalScore: lexicalScore(query, `${record.title || ''} ${record.summary || ''} ${record.recordId || ''}`),
    title: record.title || record.recordId,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  }));

  const sorted = sortPlanningCandidates(candidates).slice(0, limit);
  const results = sorted.map((entry, index) => ({
    rank: index + 1,
    recordId: entry.candidateId,
    score: entry.score,
    semanticScore: entry.semanticScore,
    lexicalScore: entry.lexicalScore,
    scope: entry.scope,
    status: entry.status,
    updatedAt: entry.updatedAtMs > 0 ? new Date(entry.updatedAtMs).toISOString() : null,
    createdAt: entry.createdAtMs > 0 ? new Date(entry.createdAtMs).toISOString() : null,
  }));

  return {
    ok: true,
    statusCode: 200,
    body: {
      contractVersion: PLANNING_API_CONTRACT_VERSION,
      kind: 'planning.search',
      deterministic: true,
      precedence: buildPlanningPrecedenceMetadata(),
      query,
      requestedScopes: selected.requestedScopes,
      deniedScopes: selected.deniedScopes,
      versionVector: {
        planningRecordsVersion: state.recordsVersion,
      },
      results,
    },
  };
}

function defaultImplementedSourcesForSession(sessionId) {
  const id = normalizeString(sessionId);
  if (!id) return [];

  return [
    { sourceType: 'plan-md', path: `session-state/${id}/plan.md`, sourceId: `plan-md:${id}` },
    { sourceType: 'final-md', path: `session-state/${id}/final.md`, sourceId: `final-md:${id}` },
    { sourceType: 'plans-index', path: `session-state/${id}/plans/index.json`, sourceId: `plans-index:${id}` },
  ];
}

function normalizeImplementedOutcomeSources(input = {}) {
  const request = isPlainObject(input) ? input : {};
  const rawSources = Array.isArray(request.sources) && request.sources.length
    ? request.sources
    : defaultImplementedSourcesForSession(request.sessionId);

  return rawSources.map((source, index) => {
    if (!isPlainObject(source)) {
      return {
        sourceId: `source-${index + 1}`,
        sourceType: '',
        path: '',
      };
    }

    const sourceType = normalizeString(source.sourceType || source.type).toLowerCase();
    const normalizedPath = normalizeRelativePath(source.path || '');
    const sourceId = normalizeString(source.sourceId)
      || `${sourceType || 'unknown'}:${normalizedPath || index + 1}`;

    return {
      sourceId,
      sourceType,
      path: normalizedPath,
    };
  });
}

function validatePlanLikeText(text) {
  if (typeof text !== 'string') return false;
  const normalized = text.trim();
  if (!normalized) return false;
  return normalized.includes('# Plan')
    || normalized.includes('Execution Plan')
    || normalized.includes('Plan-Pack Progress Tracker')
    || normalized.includes('WU-');
}

function readImplementedOutcomeSource(rootDirAbs, source, options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const staleAfterMs = Number.isFinite(options.staleAfterMs)
    ? Number(options.staleAfterMs)
    : DEFAULT_IMPLEMENTED_OUTCOMES_STALE_MS;
  const maxBytes = Number.isFinite(options.maxBytes) ? Number(options.maxBytes) : MAX_IMPLEMENTED_SOURCE_BYTES;

  const marker = {
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    path: source.path,
    status: 'unavailable',
    reason: 'source_unavailable',
    stale: false,
    ingestedCount: 0,
    updatedAt: null,
  };

  if (!IMPLEMENTED_OUTCOME_SOURCE_SET.has(source.sourceType)) {
    marker.status = 'invalid';
    marker.reason = 'source_not_allowlisted';
    return {
      marker,
      records: [],
    };
  }

  if (containsPathTraversal(source.path)) {
    marker.status = 'invalid';
    marker.reason = 'path_traversal_denied';
    return {
      marker,
      records: [],
    };
  }

  let absPath;
  try {
    absPath = safeResolveUnder(rootDirAbs, source.path);
  } catch {
    marker.status = 'invalid';
    marker.reason = 'path_traversal_denied';
    return {
      marker,
      records: [],
    };
  }

  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    marker.status = 'unavailable';
    marker.reason = 'source_missing';
    return {
      marker,
      records: [],
    };
  }

  if (!stat.isFile()) {
    marker.status = 'invalid';
    marker.reason = 'source_not_file';
    return {
      marker,
      records: [],
    };
  }

  if (stat.size > maxBytes) {
    marker.status = 'invalid';
    marker.reason = 'source_too_large';
    marker.updatedAt = new Date(stat.mtimeMs).toISOString();
    return {
      marker,
      records: [],
    };
  }

  let rawText;
  try {
    rawText = fs.readFileSync(absPath, 'utf8');
  } catch {
    marker.status = 'unavailable';
    marker.reason = 'source_unreadable';
    marker.updatedAt = new Date(stat.mtimeMs).toISOString();
    return {
      marker,
      records: [],
    };
  }

  const records = [];

  if (source.sourceType === 'plan-md' || source.sourceType === 'final-md') {
    if (!validatePlanLikeText(rawText)) {
      marker.status = 'invalid';
      marker.reason = 'schema_validation_failed';
      marker.updatedAt = new Date(stat.mtimeMs).toISOString();
      return {
        marker,
        records: [],
      };
    }

    records.push({
      recordId: `implemented:${source.sourceId}`,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      scope: 'global',
      state: 'implemented',
      title: `${source.sourceType} outcome`,
      summary: rawText.slice(0, 1024),
      score: 1,
      createdAt: new Date(stat.mtimeMs).toISOString(),
      updatedAt: new Date(stat.mtimeMs).toISOString(),
      implemented: true,
    });
  } else if (source.sourceType === 'plans-index') {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      marker.status = 'invalid';
      marker.reason = 'schema_validation_failed';
      marker.updatedAt = new Date(stat.mtimeMs).toISOString();
      return {
        marker,
        records: [],
      };
    }

    if (!isPlainObject(parsed) || !Array.isArray(parsed.plans)) {
      marker.status = 'invalid';
      marker.reason = 'schema_validation_failed';
      marker.updatedAt = new Date(stat.mtimeMs).toISOString();
      return {
        marker,
        records: [],
      };
    }

    for (const plan of parsed.plans) {
      if (!isPlainObject(plan)) continue;
      const id = normalizeString(plan.id);
      const status = normalizeState(plan.status || 'implemented');
      if (!id) continue;
      records.push({
        recordId: `implemented:${source.sourceId}:${id}`,
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        scope: 'global',
        state: status,
        title: `plan revision ${id}`,
        summary: normalizeString(plan.file || plan.verdict || ''),
        score: 1,
        createdAt: new Date(stat.mtimeMs).toISOString(),
        updatedAt: new Date(stat.mtimeMs).toISOString(),
        implemented: true,
      });
    }

    if (!records.length) {
      marker.status = 'invalid';
      marker.reason = 'schema_validation_failed';
      marker.updatedAt = new Date(stat.mtimeMs).toISOString();
      return {
        marker,
        records: [],
      };
    }
  }

  marker.updatedAt = new Date(stat.mtimeMs).toISOString();
  marker.ingestedCount = records.length;

  if (staleAfterMs > 0 && Number.isFinite(stat.mtimeMs) && nowMs - stat.mtimeMs > staleAfterMs) {
    marker.status = 'stale';
    marker.reason = 'source_stale';
    marker.stale = true;
  } else {
    marker.status = 'available';
    marker.reason = 'source_available';
    marker.stale = false;
  }

  records.sort((a, b) => deterministicStringCompare(String(a.recordId), String(b.recordId)));

  return {
    marker,
    records,
  };
}

function ingestImplementedOutcomeSources(rootDirAbs, input = {}) {
  const normalizedSources = normalizeImplementedOutcomeSources({
    sources: input.sources,
    sessionId: input.sessionId,
  });

  const markers = [];
  const records = [];

  for (const source of normalizedSources) {
    const ingested = readImplementedOutcomeSource(rootDirAbs, source, {
      nowMs: input.nowMs,
      staleAfterMs: input.staleAfterMs,
      maxBytes: input.maxBytes,
    });
    markers.push(finalizeImplementedOutcomeMarker(ingested.marker));
    records.push(...ingested.records);
  }

  markers.sort((a, b) => deterministicStringCompare(String(a.sourceId || ''), String(b.sourceId || '')));
  records.sort((a, b) => deterministicStringCompare(String(a.recordId || ''), String(b.recordId || '')));

  const markerCollections = buildImplementedOutcomeMarkerCollections(markers);

  const implementedOutcomesVersion = hashPayload(
    markers.map((marker) => ({
      sourceId: marker.sourceId,
      sourceType: marker.sourceType,
      path: marker.path,
      status: marker.status,
      reason: marker.reason,
      reasonCode: marker.reasonCode,
      conflict: marker.conflict,
      marker: marker.marker,
      stale: marker.stale,
      ingestedCount: marker.ingestedCount,
      updatedAt: marker.updatedAt,
    })),
  );

  return {
    sources: markers,
    staleMarkers: markerCollections.staleMarkers,
    conflictMarkers: markerCollections.conflictMarkers,
    reasonCodes: markerCollections.reasonCodes,
    records,
    versionVector: {
      implementedOutcomesVersion,
    },
  };
}

function buildCompareCandidates(records, query) {
  return records.map((record) => ({
    candidateId: String(record.recordId || ''),
    recordId: String(record.recordId || ''),
    sourceId: normalizeString(record.sourceId),
    sourceType: normalizeString(record.sourceType),
    sourceKind: record.implemented ? 'implemented' : 'planning',
    scope: planState.normalizePlanningScope(record.scope) || 'global',
    status: normalizeState(record.state),
    semanticScore: semanticScoreFromRecord(record),
    lexicalScore: lexicalScore(query, `${record.title || ''} ${record.summary || ''} ${record.recordId || ''}`),
    title: normalizeString(record.title || record.recordId),
    updatedAt: normalizeIso(record.updatedAt),
    createdAt: normalizeIso(record.createdAt),
  }));
}

function comparePlanningRecordsOperation(state, input = {}) {
  const context = isPlainObject(input.context) ? input.context : {};
  const request = isPlainObject(input.request) ? input.request : {};
  const nowMs = normalizeNowMs(input.nowMs);
  const userId = normalizeIdentity(context.userId);

  if (!userId) {
    return {
      ok: false,
      statusCode: 403,
      body: buildErrorBody('planning.compare', 'scope_visibility_denied', 'missing_user_context'),
    };
  }

  const requestedScopes = normalizeScopeList(request.scopes, []);
  if (!requestedScopes.length) {
    return {
      ok: false,
      statusCode: 400,
      body: buildErrorBody('planning.compare', 'invalid_scope_filter', 'compare_requires_explicit_scopes'),
    };
  }

  const repoId = normalizeIdentity(context.repoId);
  const query = normalizeString(request.query);
  const limit = normalizeLimit(request.limit, DEFAULT_COMPARE_LIMIT);
  const scopeKey = ['planning.compare', userId, repoId || '-', requestedScopes.join(',')].join('|');
  const ttlMs = Number.isFinite(input.idempotencyTtlMs)
    ? Number(input.idempotencyTtlMs)
    : DEFAULT_COMPARE_IDEMPOTENCY_TTL_MS;

  const idempotent = runIdempotentOperation(state, {
    operation: 'compare',
    scopeKey,
    idempotencyKey: request.idempotencyKey,
    ttlMs,
    nowMs,
    payload: {
      query,
      requestedScopes,
      implementedOutcomeSources: normalizeImplementedOutcomeSources({
        sources: request.implementedOutcomeSources,
        sessionId: request.sessionId,
      }),
      staleAfterMs: Number.isFinite(request.staleAfterMs) ? Number(request.staleAfterMs) : null,
      limit,
    },
    execute: () => {
      const selected = selectRecordsByScope(state, context, requestedScopes);
      const planningSnapshot = selected.records.slice().sort(planState.comparePlanningRecords);

      const implementedStart = ingestImplementedOutcomeSources(input.implementedOutcomesRootAbs || process.cwd(), {
        sources: request.implementedOutcomeSources,
        sessionId: request.sessionId,
        staleAfterMs: request.staleAfterMs,
        nowMs,
      });

      const pinnedVersionVector = {
        planningRecordsVersion: state.recordsVersion,
        implementedOutcomesVersion: implementedStart.versionVector.implementedOutcomesVersion,
      };

      const comparePool = [
        ...planningSnapshot,
        ...implementedStart.records,
      ];

      const candidates = buildCompareCandidates(comparePool, query);
      const candidateMeta = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
      const sorted = sortPlanningCandidates(candidates).slice(0, limit);

      if (typeof input.beforeFinalize === 'function') {
        input.beforeFinalize();
      }

      const implementedCurrent = ingestImplementedOutcomeSources(input.implementedOutcomesRootAbs || process.cwd(), {
        sources: request.implementedOutcomeSources,
        sessionId: request.sessionId,
        staleAfterMs: request.staleAfterMs,
        nowMs,
      });

      const currentVersionVector = {
        planningRecordsVersion: state.recordsVersion,
        implementedOutcomesVersion: implementedCurrent.versionVector.implementedOutcomesVersion,
      };

      const newerDataAvailable = pinnedVersionVector.planningRecordsVersion !== currentVersionVector.planningRecordsVersion
        || pinnedVersionVector.implementedOutcomesVersion !== currentVersionVector.implementedOutcomesVersion;

      const matches = sorted.map((entry, index) => {
        const meta = candidateMeta.get(entry.candidateId) || {};
        return {
          rank: index + 1,
          recordId: entry.candidateId,
          sourceKind: meta.sourceKind || 'planning',
          sourceId: meta.sourceId || null,
          sourceType: meta.sourceType || null,
          scope: entry.scope,
          status: entry.status,
          score: entry.score,
          semanticScore: entry.semanticScore,
          lexicalScore: entry.lexicalScore,
          updatedAt: entry.updatedAtMs > 0 ? new Date(entry.updatedAtMs).toISOString() : null,
          createdAt: entry.createdAtMs > 0 ? new Date(entry.createdAtMs).toISOString() : null,
        };
      });

      return {
        contractVersion: PLANNING_API_CONTRACT_VERSION,
        kind: 'planning.compare',
        deterministic: true,
        precedence: buildPlanningPrecedenceMetadata(),
        query,
        requestedScopes: selected.requestedScopes,
        deniedScopes: selected.deniedScopes,
        planningRecords: planningSnapshot,
        implementedOutcomes: {
          sources: implementedStart.sources,
          staleMarkers: implementedStart.staleMarkers,
          conflictMarkers: implementedStart.conflictMarkers,
          reasonCodes: implementedStart.reasonCodes,
        },
        matches,
        versionVector: {
          pinned: pinnedVersionVector,
          current: currentVersionVector,
        },
        newerDataAvailable,
      };
    },
  });

  if (!idempotent.ok) {
    return {
      ok: false,
      statusCode: idempotent.statusCode,
      body: idempotent.error,
    };
  }

  const body = attachIdempotency(idempotent.response, {
    idempotencyKey: idempotent.idempotencyKey,
    scopeKey,
    replay: idempotent.replay,
    ttlMs,
    expiresAtMs: idempotent.expiresAtMs,
    outcome: idempotent.outcome,
  });

  return {
    ok: true,
    statusCode: 200,
    body,
  };
}

module.exports = {
  PLANNING_API_CONTRACT_VERSION,
  PLANNING_PERSISTENCE_HEALTH_KIND,
  PROVIDER_LIFECYCLE_CAPABILITY_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_SUPPORTED_PROVIDERS,
  FINISH_COMPATIBILITY_RECEIPT_REQUIRED_FIELDS,
  FINISH_COMPATIBILITY_RECEIPT_OPTIONAL_FIELDS,
  SHARED_PROVIDER_LIFECYCLE_CAPABILITIES,
  PROVIDER_LIFECYCLE_CAPABILITY_MATRIX,
  DEFAULT_CREATE_IDEMPOTENCY_TTL_MS,
  DEFAULT_COMPARE_IDEMPOTENCY_TTL_MS,
  DEFAULT_ROUTE_LOCK_TTL_MS,
  DEFAULT_IMPLEMENTED_OUTCOMES_STALE_MS,
  IMPLEMENTED_OUTCOME_SOURCE_TYPES,
  buildPlanningPersistenceHealthEnvelope,
  buildFinishCompatibilityHookContract,
  evaluateProviderLifecycleCapability,
  buildLifecycleUnsupportedCapabilityMarker,
  createPlanningApiState,
  buildPlanningRouteLockKey,
  acquirePlanningRouteLock,
  releasePlanningRouteLock,
  replacePlanningProjectionFromPersistedRecords,
  createPlanningRecordOperation,
  listPlanningRecordsOperation,
  searchPlanningRecordsOperation,
  comparePlanningRecordsOperation,
  evictPlanningIdempotencyEntry,
  normalizeImplementedOutcomeSources,
  ingestImplementedOutcomeSources,
};
