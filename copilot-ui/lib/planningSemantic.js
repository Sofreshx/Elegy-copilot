'use strict';

const SEMANTIC_SCORING_CONTRACT_VERSION = 'semantic_scoring_v1';
const SEMANTIC_GATE_OVERRIDE_CONTRACT_VERSION = 'semantic_gate_override_v1';

const SEMANTIC_SCOPES = Object.freeze(['user', 'repo', 'global']);
const SEMANTIC_SCOPE_RANK = Object.freeze({
  user: 3,
  repo: 2,
  global: 1,
});

const SEMANTIC_STATUS_RANK = Object.freeze({
  merged: 6,
  implemented: 5,
  queued: 4,
  'pre-plan': 3,
  research: 2,
  thought: 1,
  superseded: 0,
  poisoned: 0,
  unknown: 0,
});

const SEMANTIC_DEGRADED_MODE = Object.freeze({
  SEMANTIC_PRIMARY: 'semantic_primary',
  LEXICAL_FALLBACK: 'lexical_fallback',
});

const EMBEDDING_LIFECYCLE_STATE = Object.freeze({
  READY: 'ready',
  NEEDS_BACKFILL: 'needsBackfill',
  NEEDS_REEMBED: 'needsReembed',
  POISONED: 'poisoned',
});

const SEMANTIC_GATE_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  INSUFFICIENT_DATA: 'insufficient-data',
});

const DEFAULT_SEMANTIC_GATE_THRESHOLDS = Object.freeze({
  maxLatencyMs: 2500,
  maxErrorRate: 0.08,
  minQualityScore: 0.55,
  minSampleSize: 3,
  mergeEnabled: true,
});

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function normalizeFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRatio(value, fallback = 0) {
  return clamp(value, 0, 1) || fallback;
}

function normalizeBoolean(value) {
  return value === true;
}

function uniqueSorted(list) {
  return [...new Set(Array.isArray(list) ? list : [])].sort((a, b) => String(a).localeCompare(String(b)));
}

function normalizeSemanticText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSemanticScope(valueOrRecord) {
  let raw = valueOrRecord;
  if (isPlainObject(valueOrRecord)) {
    raw = valueOrRecord.scope != null ? valueOrRecord.scope : valueOrRecord.source;
  }

  if (typeof raw !== 'string') return '';
  const normalized = raw.trim().toLowerCase();
  return SEMANTIC_SCOPES.includes(normalized) ? normalized : '';
}

function normalizeSemanticStatus(valueOrRecord) {
  let raw = valueOrRecord;
  if (isPlainObject(valueOrRecord)) {
    raw = valueOrRecord.status != null ? valueOrRecord.status : valueOrRecord.state;
  }

  if (typeof raw !== 'string') return 'unknown';
  const normalized = raw.trim().toLowerCase().replace(/[_\s]+/g, '-');
  return normalized || 'unknown';
}

function normalizeSemanticTimestamp(value) {
  if (value == null) return 0;

  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeCandidateId(candidate, index = 0) {
  if (!isPlainObject(candidate)) {
    return `candidate-${index}`;
  }

  const value = candidate.candidateId != null
    ? candidate.candidateId
    : candidate.recordId != null
      ? candidate.recordId
      : candidate.id;

  if (value == null) {
    return `candidate-${index}`;
  }

  const normalized = String(value).trim();
  return normalized || `candidate-${index}`;
}

function getSemanticScopeRank(scope) {
  const normalized = normalizeSemanticScope(scope);
  return SEMANTIC_SCOPE_RANK[normalized] || 0;
}

function getSemanticStatusRank(status) {
  const normalized = normalizeSemanticStatus(status);
  return SEMANTIC_STATUS_RANK[normalized] != null
    ? SEMANTIC_STATUS_RANK[normalized]
    : SEMANTIC_STATUS_RANK.unknown;
}

function scorePlanningCandidate(input, index = 0) {
  const candidate = isPlainObject(input) ? input : {};

  const semanticScore = normalizeRatio(
    candidate.semanticScore != null ? candidate.semanticScore : candidate.embeddingScore,
    0,
  );
  const lexicalScore = normalizeRatio(
    candidate.lexicalScore != null ? candidate.lexicalScore : candidate.keywordScore,
    0,
  );
  const scope = normalizeSemanticScope(candidate);
  const status = normalizeSemanticStatus(candidate);
  const scopeRank = getSemanticScopeRank(scope);
  const statusRank = getSemanticStatusRank(status);
  const updatedAtMs = normalizeSemanticTimestamp(candidate.updatedAt);
  const createdAtMs = normalizeSemanticTimestamp(candidate.createdAt);
  const normalizedText = normalizeSemanticText(
    candidate.normalizedText != null
      ? candidate.normalizedText
      : candidate.text != null
        ? candidate.text
        : candidate.title,
  );
  const candidateId = normalizeCandidateId(candidate, index);

  const score = Math.round(semanticScore * 1_000_000)
    + Math.round(lexicalScore * 100_000)
    + scopeRank * 1_000
    + statusRank * 100;

  return {
    contractVersion: SEMANTIC_SCORING_CONTRACT_VERSION,
    candidateId,
    score,
    semanticScore,
    lexicalScore,
    scope,
    status,
    scopeRank,
    statusRank,
    updatedAtMs,
    createdAtMs,
    normalizedText,
    inputIndex: Number.isFinite(index) ? index : 0,
  };
}

function compareScoredCandidates(a, b) {
  const scoreDiff = normalizeFiniteNumber(b.score) - normalizeFiniteNumber(a.score);
  if (scoreDiff !== 0) return scoreDiff;

  const semanticDiff = normalizeFiniteNumber(b.semanticScore) - normalizeFiniteNumber(a.semanticScore);
  if (semanticDiff !== 0) return semanticDiff;

  const lexicalDiff = normalizeFiniteNumber(b.lexicalScore) - normalizeFiniteNumber(a.lexicalScore);
  if (lexicalDiff !== 0) return lexicalDiff;

  const scopeDiff = normalizeFiniteNumber(b.scopeRank) - normalizeFiniteNumber(a.scopeRank);
  if (scopeDiff !== 0) return scopeDiff;

  const statusDiff = normalizeFiniteNumber(b.statusRank) - normalizeFiniteNumber(a.statusRank);
  if (statusDiff !== 0) return statusDiff;

  const updatedAtDiff = normalizeFiniteNumber(b.updatedAtMs) - normalizeFiniteNumber(a.updatedAtMs);
  if (updatedAtDiff !== 0) return updatedAtDiff;

  const createdAtDiff = normalizeFiniteNumber(b.createdAtMs) - normalizeFiniteNumber(a.createdAtMs);
  if (createdAtDiff !== 0) return createdAtDiff;

  const textDiff = String(a.normalizedText || '').localeCompare(String(b.normalizedText || ''));
  if (textDiff !== 0) return textDiff;

  const idDiff = String(a.candidateId || '').localeCompare(String(b.candidateId || ''));
  if (idDiff !== 0) return idDiff;

  return normalizeFiniteNumber(a.inputIndex) - normalizeFiniteNumber(b.inputIndex);
}

function sortPlanningCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  return candidates
    .map((candidate, index) => scorePlanningCandidate(candidate, index))
    .sort(compareScoredCandidates);
}

function classifyEmbeddingLifecycle(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const reasonCodes = [];

  const poisoned = normalizeBoolean(source.poisoned)
    || normalizeSemanticStatus(source.embeddingStatus) === 'poisoned'
    || normalizeSemanticStatus(source.status) === 'poisoned';

  const vector = Array.isArray(source.embedding)
    ? source.embedding
    : Array.isArray(source.vector)
      ? source.vector
      : null;
  const hasVector = Array.isArray(vector) && vector.length > 0;

  const expectedModelVersion = typeof source.expectedModelVersion === 'string'
    ? source.expectedModelVersion.trim()
    : '';
  const modelVersion = typeof source.modelVersion === 'string'
    ? source.modelVersion.trim()
    : '';

  const expectedContentHash = typeof source.expectedContentHash === 'string'
    ? source.expectedContentHash.trim()
    : '';
  const contentHash = typeof source.contentHash === 'string'
    ? source.contentHash.trim()
    : '';

  const generatedAtMs = normalizeSemanticTimestamp(source.generatedAt || source.embeddingGeneratedAt);
  const nowMs = normalizeSemanticTimestamp(source.nowMs || Date.now());
  const maxEmbeddingAgeMs = normalizeFiniteNumber(source.maxEmbeddingAgeMs, 0);

  let state = EMBEDDING_LIFECYCLE_STATE.READY;

  if (poisoned) {
    state = EMBEDDING_LIFECYCLE_STATE.POISONED;
    reasonCodes.push(typeof source.poisonReason === 'string' && source.poisonReason.trim()
      ? source.poisonReason.trim()
      : 'poison_flagged');
  } else if (!hasVector) {
    state = EMBEDDING_LIFECYCLE_STATE.NEEDS_BACKFILL;
    reasonCodes.push('embedding_missing');
  } else {
    if (expectedModelVersion && modelVersion && expectedModelVersion !== modelVersion) {
      state = EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED;
      reasonCodes.push('model_version_mismatch');
    }

    if (expectedContentHash && contentHash && expectedContentHash !== contentHash) {
      state = EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED;
      reasonCodes.push('content_hash_mismatch');
    }

    if (maxEmbeddingAgeMs > 0 && generatedAtMs > 0 && nowMs > generatedAtMs && (nowMs - generatedAtMs) > maxEmbeddingAgeMs) {
      state = EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED;
      reasonCodes.push('embedding_stale');
    }
  }

  const retryCount = normalizeFiniteNumber(source.retryCount, 0);
  const queueDepth = normalizeFiniteNumber(source.queueDepth, 0);
  const retryBackpressureThreshold = normalizeFiniteNumber(source.retryBackpressureThreshold, 3);
  const queueBackpressureThreshold = normalizeFiniteNumber(source.queueBackpressureThreshold, 100);

  const retryMarker = state === EMBEDDING_LIFECYCLE_STATE.NEEDS_BACKFILL
    || state === EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED;
  const backpressureMarker = normalizeBoolean(source.forceBackpressure)
    || retryCount >= retryBackpressureThreshold
    || queueDepth >= queueBackpressureThreshold;

  const finalizedReasonCodes = uniqueSorted(reasonCodes);
  if (!finalizedReasonCodes.length && state === EMBEDDING_LIFECYCLE_STATE.READY) {
    finalizedReasonCodes.push('embedding_ready');
  }

  return {
    state,
    reasonCodes: finalizedReasonCodes,
    ready: state === EMBEDDING_LIFECYCLE_STATE.READY,
    needsBackfill: state === EMBEDDING_LIFECYCLE_STATE.NEEDS_BACKFILL,
    needsReembed: state === EMBEDDING_LIFECYCLE_STATE.NEEDS_REEMBED,
    poisoned: state === EMBEDDING_LIFECYCLE_STATE.POISONED,
    retryMarker,
    backpressureMarker,
    semanticUsable: state === EMBEDDING_LIFECYCLE_STATE.READY,
  };
}

function normalizeSemanticGateStatus(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase();
  if (normalized === SEMANTIC_GATE_STATUS.PASS) return SEMANTIC_GATE_STATUS.PASS;
  if (normalized === SEMANTIC_GATE_STATUS.FAIL) return SEMANTIC_GATE_STATUS.FAIL;
  if (normalized === SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA) return SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA;
  return null;
}

function determineSemanticDegradedMode(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const degradedReasons = [];

  if (source.semanticEnabled === false) {
    degradedReasons.push('semantic_disabled');
  }

  if (normalizeBoolean(source.forceLexicalOnly)) {
    degradedReasons.push('forced_lexical_only');
  }

  if (source.embeddingsAvailable === false) {
    degradedReasons.push('embedding_unavailable');
  }

  if (normalizeBoolean(source.semanticTimeout)) {
    degradedReasons.push('semantic_timeout');
  }

  if (source.semanticError) {
    degradedReasons.push('semantic_error');
  }

  const lifecycle = classifyEmbeddingLifecycle(source.embeddingLifecycle || source.embeddingRecord || source);
  if (lifecycle.needsBackfill) degradedReasons.push('embedding_backfill_required');
  if (lifecycle.needsReembed) degradedReasons.push('embedding_reembed_required');
  if (lifecycle.poisoned) degradedReasons.push('embedding_poisoned');

  const gate = isPlainObject(source.semanticGate)
    ? source.semanticGate
    : isPlainObject(source.gate)
      ? source.gate
      : null;
  const gateStatus = normalizeSemanticGateStatus(gate && (gate.gateStatus || gate.status));
  if (gateStatus === SEMANTIC_GATE_STATUS.FAIL) {
    degradedReasons.push('semantic_gate_failed');
  }
  if (gateStatus === SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA || normalizeBoolean(source.insufficientData)) {
    degradedReasons.push('insufficient_data');
  }

  const finalizedReasons = uniqueSorted(degradedReasons);
  const degraded = finalizedReasons.length > 0;

  return {
    degraded,
    degradedMode: degraded
      ? SEMANTIC_DEGRADED_MODE.LEXICAL_FALLBACK
      : SEMANTIC_DEGRADED_MODE.SEMANTIC_PRIMARY,
    degradedReasons: finalizedReasons,
    semanticUsed: !degraded,
  };
}

function normalizeSemanticGateThresholds(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const maxLatencyMs = Math.max(0, normalizeFiniteNumber(source.maxLatencyMs, DEFAULT_SEMANTIC_GATE_THRESHOLDS.maxLatencyMs));
  const maxErrorRate = source.maxErrorRate == null
    ? DEFAULT_SEMANTIC_GATE_THRESHOLDS.maxErrorRate
    : clamp(source.maxErrorRate, 0, 1);
  const minQualityScore = source.minQualityScore == null
    ? DEFAULT_SEMANTIC_GATE_THRESHOLDS.minQualityScore
    : clamp(source.minQualityScore, 0, 1);
  const minSampleSize = Math.max(1, Math.floor(normalizeFiniteNumber(source.minSampleSize, DEFAULT_SEMANTIC_GATE_THRESHOLDS.minSampleSize)));
  const mergeEnabled = source.mergeEnabled !== false;

  return {
    maxLatencyMs,
    maxErrorRate,
    minQualityScore,
    minSampleSize,
    mergeEnabled,
  };
}

function normalizeMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function evaluateSemanticGate(metrics, thresholds) {
  const sourceMetrics = isPlainObject(metrics) ? metrics : {};
  const normalizedThresholds = normalizeSemanticGateThresholds(thresholds || {});

  const latencyMs = normalizeMetric(sourceMetrics.latencyMs);
  const errorRate = normalizeMetric(sourceMetrics.errorRate);
  const qualityScore = normalizeMetric(sourceMetrics.qualityScore);
  const sampleSizeRaw = normalizeMetric(sourceMetrics.sampleSize);
  const sampleSize = sampleSizeRaw == null ? null : Math.max(0, Math.floor(sampleSizeRaw));

  const reasons = [];
  let insufficientData = normalizeBoolean(sourceMetrics.insufficientData);

  if (latencyMs == null || errorRate == null || qualityScore == null || sampleSize == null) {
    insufficientData = true;
  }

  if (!insufficientData && sampleSize < normalizedThresholds.minSampleSize) {
    insufficientData = true;
  }

  let gateStatus;
  if (insufficientData) {
    gateStatus = SEMANTIC_GATE_STATUS.INSUFFICIENT_DATA;
    reasons.push('insufficient_data');
  } else {
    if (latencyMs > normalizedThresholds.maxLatencyMs) {
      reasons.push('latency_exceeded');
    }
    if (errorRate > normalizedThresholds.maxErrorRate) {
      reasons.push('error_rate_exceeded');
    }
    if (qualityScore < normalizedThresholds.minQualityScore) {
      reasons.push('quality_below_minimum');
    }
    gateStatus = reasons.length ? SEMANTIC_GATE_STATUS.FAIL : SEMANTIC_GATE_STATUS.PASS;
  }

  const normalizedReasons = uniqueSorted(reasons);
  const mergeEnabled = gateStatus === SEMANTIC_GATE_STATUS.PASS && normalizedThresholds.mergeEnabled;

  const overrideEnvelope = {
    contractVersion: SEMANTIC_GATE_OVERRIDE_CONTRACT_VERSION,
    gateStatus,
    mergeEnabled,
    overrideRequired: gateStatus !== SEMANTIC_GATE_STATUS.PASS,
    overrideEligible: gateStatus !== SEMANTIC_GATE_STATUS.PASS,
    requested: normalizeBoolean(sourceMetrics.overrideRequested)
      || normalizeBoolean(sourceMetrics.override && sourceMetrics.override.requested),
    approved: false,
    insufficientData,
    reasons: normalizedReasons,
  };

  return {
    contractVersion: SEMANTIC_SCORING_CONTRACT_VERSION,
    gateStatus,
    mergeEnabled,
    insufficientData,
    reasons: normalizedReasons,
    metrics: {
      latencyMs,
      errorRate,
      qualityScore,
      sampleSize,
    },
    thresholds: normalizedThresholds,
    overrideEnvelope,
  };
}

module.exports = {
  SEMANTIC_SCORING_CONTRACT_VERSION,
  SEMANTIC_GATE_OVERRIDE_CONTRACT_VERSION,
  SEMANTIC_DEGRADED_MODE,
  EMBEDDING_LIFECYCLE_STATE,
  SEMANTIC_GATE_STATUS,
  DEFAULT_SEMANTIC_GATE_THRESHOLDS,
  normalizeSemanticText,
  normalizeSemanticScope,
  normalizeSemanticStatus,
  normalizeSemanticTimestamp,
  scorePlanningCandidate,
  sortPlanningCandidates,
  determineSemanticDegradedMode,
  classifyEmbeddingLifecycle,
  evaluateSemanticGate,
  normalizeSemanticGateThresholds,
};