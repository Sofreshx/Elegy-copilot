'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const planState = require('./planState');
const { sortPlanningCandidates } = require('./planningSemantic');

const PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';
const DEFAULT_CREATE_IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const DEFAULT_COMPARE_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_IMPLEMENTED_OUTCOMES_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_COMPARE_LIMIT = 20;
const MAX_IMPLEMENTED_SOURCE_BYTES = 2 * 1024 * 1024;
const IMPLEMENTED_OUTCOME_SOURCE_TYPES = Object.freeze([
  'plan-md',
  'final-md',
  'plans-index',
]);

const IMPLEMENTED_OUTCOME_SOURCE_SET = new Set(IMPLEMENTED_OUTCOME_SOURCE_TYPES);

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
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
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

function normalizeNowMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.now();
}

function normalizeIso(value) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
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

function createPlanningApiState() {
  return {
    recordsById: new Map(),
    nextRecordNumber: 1,
    recordsVersion: 0,
    idempotency: {
      create: new Map(),
      compare: new Map(),
    },
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

  records.sort((a, b) => String(a.recordId).localeCompare(String(b.recordId)));

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
    markers.push(ingested.marker);
    records.push(...ingested.records);
  }

  markers.sort((a, b) => String(a.sourceId || '').localeCompare(String(b.sourceId || '')));
  records.sort((a, b) => String(a.recordId || '').localeCompare(String(b.recordId || '')));

  const implementedOutcomesVersion = hashPayload(
    markers.map((marker) => ({
      sourceId: marker.sourceId,
      sourceType: marker.sourceType,
      path: marker.path,
      status: marker.status,
      reason: marker.reason,
      stale: marker.stale,
      ingestedCount: marker.ingestedCount,
      updatedAt: marker.updatedAt,
    })),
  );

  return {
    sources: markers,
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
        query,
        requestedScopes: selected.requestedScopes,
        deniedScopes: selected.deniedScopes,
        planningRecords: planningSnapshot,
        implementedOutcomes: {
          sources: implementedStart.sources,
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
  DEFAULT_CREATE_IDEMPOTENCY_TTL_MS,
  DEFAULT_COMPARE_IDEMPOTENCY_TTL_MS,
  DEFAULT_IMPLEMENTED_OUTCOMES_STALE_MS,
  IMPLEMENTED_OUTCOME_SOURCE_TYPES,
  createPlanningApiState,
  createPlanningRecordOperation,
  listPlanningRecordsOperation,
  searchPlanningRecordsOperation,
  comparePlanningRecordsOperation,
  normalizeImplementedOutcomeSources,
  ingestImplementedOutcomeSources,
};
