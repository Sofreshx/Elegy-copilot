const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

function $(id) {
  if (!hasDom) return null;
  return document.getElementById(id);
}

let sessionSource = 'all';
let selectedSession = null;
let trackerEventSource = null;
let trackerPendingCount = 0;
let policyGateBlocked = false;
let policyGateReason = '';
let sandboxSessions = [];
const ACTION_LOG_MAX_ENTRIES = 200;
let actionLogSequence = 0;
const actionLogEntries = [];

const PLANNING_GATE_STATES = Object.freeze({
  PASS: 'pass',
  DEGRADED: 'degraded',
  INSUFFICIENT_DATA: 'insufficient-data',
  POLICY_BLOCKED: 'policy-blocked',
  AUTH_DENIED: 'auth-denied',
});

const PLANNING_SCOPE_PRECEDENCE = Object.freeze({
  user: 3,
  repo: 2,
  global: 1,
});

const PLANNING_INTENT_MAX_TTL_MS = 15 * 60 * 1000;
const PLANNING_INTENT_DEFAULT_TTL_MS = 5 * 60 * 1000;
const PLANNING_CONTEXT_RESTORE_CONTRACT_VERSION = '1';
const PLANNING_CONTEXT_STORAGE_KEY = 'copilot-ui:planning-context:v1';
const PLANNING_CONTEXT_SCOPE_ORDER = Object.freeze(['user', 'repo', 'global']);
const PLANNING_CONTEXT_FIELD_MAX_LENGTH = 512;
const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

let planningViewState = {
  records: [],
  searchResults: [],
  compareResponse: null,
  gateState: PLANNING_GATE_STATES.INSUFFICIENT_DATA,
  gateReason: 'Run compare to evaluate merge gate state.',
  conflicts: [],
  reviewedConflictKeys: new Set(),
  intentToken: null,
};

function isMutatingMethod(method) {
  const m = String(method || 'GET').toUpperCase();
  return !(m === 'GET' || m === 'HEAD' || m === 'OPTIONS');
}

function applyPolicyGateUi() {
  const ids = [
    'btn-sync-all',
    'btn-fresh-all',
    'btn-patch-vscode-settings',
    'btn-copilot-authorize',
    'btn-install-lsp',
    'btn-gateway-save',
    'btn-gateway-connect',
    'btn-planning-persistence-init',
    'btn-planning-create',
    'btn-planning-merge',
    'btn-sandbox-create',
    'btn-sandbox-start',
    'btn-sandbox-stop',
    'btn-sandbox-open-terminal',
    'btn-sandbox-pr-open',
  ];

  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.disabled = policyGateBlocked;
  }

  if (policyGateBlocked) {
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    setStatus(`Policy gate active: ${policyGateReason || 'mutating actions are blocked'}`);
  }

  if (hasDom) {
    refreshPlanningCreateControls();
    refreshPlanningMergeControls();
  }
}

async function refreshPolicyPreflight(forceRefresh) {
  const suffix = forceRefresh ? '?refresh=1' : '';
  const data = await api(`/api/policy/preflight${suffix}`);
  policyGateBlocked = !Boolean(data && data.ok);
  policyGateReason = String((data && (data.message || data.reason)) || '').trim();
  applyPolicyGateUi();
  return data;
}

async function api(url, opts) {
  const method = String((opts && opts.method) || 'GET').toUpperCase();
  if (isMutatingMethod(method) && policyGateBlocked) {
    throw new Error(`Policy gate blocked mutating request: ${policyGateReason || 'policy preflight failed'}`);
  }

  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const msg = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function setStatus(msg) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
}

function parseActionFailureDetails(error) {
  const message = String((error && error.message) || error || 'Unknown error');
  const details = {
    deterministic: false,
    statusCode: null,
    statusText: '',
    error: null,
    code: null,
    reason: null,
    message,
  };

  const match = message.match(/^(\d{3})\s+([^:]+):\s*(.*)$/);
  if (match) {
    details.statusCode = Number(match[1]);
    details.statusText = String(match[2] || '').trim();

    const payload = String(match[3] || '').trim();
    if (payload.startsWith('{')) {
      try {
        const parsed = JSON.parse(payload);
        const nested = parsed && typeof parsed.error === 'object' ? parsed.error : null;
        details.deterministic = Boolean(parsed && (parsed.deterministic === true || (nested && nested.deterministic === true)));
        details.error = typeof parsed.error === 'string'
          ? parsed.error
          : (nested && typeof nested.message === 'string' ? nested.message : null);
        details.code = String((parsed && (parsed.code || (nested && nested.code))) || '').trim() || null;
        details.reason = String((parsed && (parsed.reason || (nested && nested.reason))) || '').trim() || null;
        details.message = details.error || details.reason || details.message;
      } catch {
        details.error = payload || null;
      }
    } else {
      details.error = payload || null;
    }
  }

  return details;
}

function formatActionFailureSummary(details) {
  const source = details && typeof details === 'object' ? details : parseActionFailureDetails(details);
  const parts = [];
  if (source.statusCode) parts.push(`status=${source.statusCode}`);
  if (source.code) parts.push(`code=${source.code}`);
  if (source.reason) parts.push(`reason=${source.reason}`);
  if (source.error) parts.push(`error=${source.error}`);
  if (!parts.length) parts.push(String(source.message || 'action_failed'));
  return parts.join(', ');
}

function appendActionLog(action, stage, details = {}) {
  const entry = {
    sequence: actionLogSequence += 1,
    at: new Date().toISOString(),
    action: String(action || '').trim() || 'unknown',
    stage: String(stage || '').trim() || 'info',
    details,
  };

  actionLogEntries.push(entry);
  if (actionLogEntries.length > ACTION_LOG_MAX_ENTRIES) {
    actionLogEntries.splice(0, actionLogEntries.length - ACTION_LOG_MAX_ENTRIES);
  }

  if (typeof console !== 'undefined' && console) {
    const logger = stage === 'failure' ? console.error : console.log;
    if (typeof logger === 'function') {
      logger(`[action:${entry.action}] ${entry.stage}`, entry.details || {});
    }
  }

  return entry;
}

function getActionLogEntries() {
  return actionLogEntries.slice();
}

function resetActionLogEntries() {
  actionLogSequence = 0;
  actionLogEntries.splice(0, actionLogEntries.length);
}

async function runActionWithLog(actionName, operation, options = {}) {
  const action = String(actionName || '').trim() || 'unknown.action';
  const startMessage = typeof options.startMessage === 'string' ? options.startMessage : null;
  const successMessage = typeof options.successMessage === 'string' ? options.successMessage : null;
  const failurePrefix = String(options.failurePrefix || `${action} failed`).trim();

  appendActionLog(action, 'start', {
    deterministic: true,
    started: true,
  });

  if (startMessage) {
    setStatus(startMessage);
  }

  try {
    const result = await operation();
    appendActionLog(action, 'success', {
      deterministic: true,
      succeeded: true,
    });
    if (successMessage) {
      setStatus(successMessage);
    }
    return result;
  } catch (error) {
    const failure = parseActionFailureDetails(error);
    appendActionLog(action, 'failure', failure);
    setStatus(`${failurePrefix}: ${formatActionFailureSummary(failure)}`);

    if (error && typeof error === 'object') {
      error.actionFailure = failure;
      throw error;
    }

    const wrapped = new Error(failure.message || String(error || 'action_failed'));
    wrapped.actionFailure = failure;
    throw wrapped;
  }
}

async function viewRel(relPath, label) {
  const txt = await api(`/api/assets/view?path=${encodeURIComponent(relPath)}`).catch((e) => `Error: ${e.message}`);
  $('viewer-meta').textContent = label || relPath;
  $('viewer').textContent = txt;
}

async function deleteRel(relPath, label) {
  const ok = window.confirm(`Delete ${relPath}?\n\nThis is destructive and cannot be undone.`);
  if (!ok) return;

  setStatus(`Deleting ${relPath}…`);
  const r = await api('/api/assets/delete', { method: 'POST', body: JSON.stringify({ path: relPath, force: true }) }).catch((e) => ({
    error: e.message,
  }));
  $('viewer-meta').textContent = label || `Delete ${relPath}`;
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus(`Delete attempted for ${relPath}.`);
}

function fmtTime(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return ch;
    }
  });
}

function evType(ev) {
  return (ev && (ev.type || ev.event || ev.name || ev.kind)) || '(unknown)';
}

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function evTime(ev) {
  const v = ev && (ev.time || ev.timestamp || ev.ts || ev.createdAt || (ev.meta && (ev.meta.time || ev.meta.timestamp || ev.meta.ts)));
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isFinite(n)) return n;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}

function normalizePlanningGateState(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === PLANNING_GATE_STATES.PASS) return PLANNING_GATE_STATES.PASS;
  if (normalized === PLANNING_GATE_STATES.DEGRADED) return PLANNING_GATE_STATES.DEGRADED;
  if (normalized === PLANNING_GATE_STATES.INSUFFICIENT_DATA) return PLANNING_GATE_STATES.INSUFFICIENT_DATA;
  if (normalized === PLANNING_GATE_STATES.POLICY_BLOCKED) return PLANNING_GATE_STATES.POLICY_BLOCKED;
  if (normalized === PLANNING_GATE_STATES.AUTH_DENIED) return PLANNING_GATE_STATES.AUTH_DENIED;
  return PLANNING_GATE_STATES.INSUFFICIENT_DATA;
}

function planningGateBadgeClass(gateState) {
  const state = normalizePlanningGateState(gateState);
  if (state === PLANNING_GATE_STATES.PASS) return 'status-done';
  if (state === PLANNING_GATE_STATES.DEGRADED) return 'status-in-progress';
  if (state === PLANNING_GATE_STATES.POLICY_BLOCKED || state === PLANNING_GATE_STATES.AUTH_DENIED) return 'status-failed';
  return 'status-pending';
}

function isMergeEnabled(gateState) {
  return normalizePlanningGateState(gateState) === PLANNING_GATE_STATES.PASS;
}

function planningScopeRank(scope) {
  return PLANNING_SCOPE_PRECEDENCE[String(scope || '').trim().toLowerCase()] || 0;
}

function parseIsoMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value !== 'string' || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function comparePlanningConflictEntries(a, b) {
  const scopeDiff = planningScopeRank(b.scope) - planningScopeRank(a.scope);
  if (scopeDiff !== 0) return scopeDiff;

  const updatedDiff = parseIsoMs(b.updatedAt) - parseIsoMs(a.updatedAt);
  if (updatedDiff !== 0) return updatedDiff;

  const createdDiff = parseIsoMs(b.createdAt) - parseIsoMs(a.createdAt);
  if (createdDiff !== 0) return createdDiff;

  return deterministicStringCompare(String(a.recordId || ''), String(b.recordId || ''));
}

function resolveConflictWinner(entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const sorted = entries.slice().sort(comparePlanningConflictEntries);
  return sorted[0] || null;
}

function pickTopRecordByScope(records) {
  const topByScope = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const scope = String(record && record.scope ? record.scope : '').trim().toLowerCase();
    if (!planningScopeRank(scope)) continue;

    const nextEntry = {
      scope,
      recordId: String((record && record.recordId) || ''),
      updatedAt: record && record.updatedAt,
      createdAt: record && record.createdAt,
      raw: record,
    };

    const existing = topByScope.get(scope);
    if (!existing || comparePlanningConflictEntries(nextEntry, existing) < 0) {
      topByScope.set(scope, nextEntry);
    }
  }
  return topByScope;
}

function buildPlanningConflictRows(records) {
  const fields = ['title', 'summary', 'state'];
  const topByScope = pickTopRecordByScope(records);
  const scopes = ['user', 'repo', 'global'];
  const rows = [];

  for (const field of fields) {
    const entries = [];
    for (const scope of scopes) {
      const top = topByScope.get(scope);
      if (!top || !top.raw) continue;
      const value = String(top.raw[field] || '').trim();
      if (!value) continue;
      entries.push({
        scope,
        field,
        value,
        recordId: String(top.raw.recordId || ''),
        updatedAt: top.raw.updatedAt,
        createdAt: top.raw.createdAt,
      });
    }

    if (entries.length < 2) continue;
    const distinctValues = [...new Set(entries.map((entry) => entry.value))];
    if (distinctValues.length < 2) continue;

    const winner = resolveConflictWinner(entries);
    if (!winner) continue;

    const byScope = {
      user: entries.find((entry) => entry.scope === 'user') || null,
      repo: entries.find((entry) => entry.scope === 'repo') || null,
      global: entries.find((entry) => entry.scope === 'global') || null,
    };

    rows.push({
      conflictKey: field,
      field,
      valuesByScope: byScope,
      winnerScope: winner.scope,
      winnerRecordId: winner.recordId,
      winnerValue: winner.value,
    });
  }

  rows.sort((a, b) => deterministicStringCompare(String(a.field), String(b.field)));
  return rows;
}

function hasReviewedAllConflicts(conflicts, reviewedConflictKeys) {
  const rows = Array.isArray(conflicts) ? conflicts : [];
  if (!rows.length) return true;
  const reviewed = reviewedConflictKeys instanceof Set
    ? reviewedConflictKeys
    : new Set(Array.isArray(reviewedConflictKeys) ? reviewedConflictKeys : []);
  return rows.every((row) => reviewed.has(row.conflictKey));
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableNormalize(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).sort(deterministicStringCompare);
    for (const key of keys) {
      out[key] = stableNormalize(value[key]);
    }
    return out;
  }
  return value;
}

function stableHash(value) {
  const normalized = JSON.stringify(stableNormalize(value));
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `h${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildCompareSnapshotHash(compareResponse) {
  const response = compareResponse && typeof compareResponse === 'object' ? compareResponse : {};
  return stableHash({
    requestedScopes: Array.isArray(response.requestedScopes) ? response.requestedScopes : [],
    deniedScopes: Array.isArray(response.deniedScopes) ? response.deniedScopes : [],
    pinnedVersion: response.versionVector && response.versionVector.pinned ? response.versionVector.pinned : null,
    matchIds: Array.isArray(response.matches) ? response.matches.map((entry) => String((entry && entry.recordId) || '')) : [],
  });
}

function buildSourceIdsHash(sourceIds) {
  const normalized = [...new Set((Array.isArray(sourceIds) ? sourceIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))]
    .sort(deterministicStringCompare);
  return stableHash(normalized);
}

function createPlanningIntentToken(input = {}, options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const rawTtlMs = Number.isFinite(options.ttlMs) ? Number(options.ttlMs) : PLANNING_INTENT_DEFAULT_TTL_MS;
  const ttlMs = Math.max(1_000, Math.min(rawTtlMs, PLANNING_INTENT_MAX_TTL_MS));

  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + ttlMs).toISOString();
  const tokenId = String(input.tokenId || `intent-${nowMs}-${Math.random().toString(36).slice(2, 8)}`);

  return {
    tokenId,
    actorId: String(input.actorId || ''),
    sourceIdsHash: String(input.sourceIdsHash || ''),
    targetId: String(input.targetId || ''),
    compareHash: String(input.compareHash || ''),
    issuedAt,
    expiresAt,
    versionVector: input.versionVector || null,
    consumedAt: null,
  };
}

function validatePlanningIntentToken(token, context = {}) {
  if (!token || typeof token !== 'object') {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_not_object' } };
  }

  const requiredFields = ['tokenId', 'actorId', 'sourceIdsHash', 'targetId', 'compareHash', 'issuedAt', 'expiresAt'];
  for (const field of requiredFields) {
    if (typeof token[field] !== 'string' || !token[field].trim()) {
      return { ok: false, error: { code: 'invalid_confirmation_token', reason: `missing_or_invalid_${field}` } };
    }
  }

  const issuedAtMs = parseIsoMs(token.issuedAt);
  const expiresAtMs = parseIsoMs(token.expiresAt);
  if (!issuedAtMs || !expiresAtMs || expiresAtMs <= issuedAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'invalid_token_time_window' } };
  }
  if (expiresAtMs - issuedAtMs > PLANNING_INTENT_MAX_TTL_MS) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_ttl_exceeds_max' } };
  }

  const nowMs = Number.isFinite(context.nowMs) ? Number(context.nowMs) : Date.now();
  if (nowMs > expiresAtMs) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_expired' } };
  }

  if (token.consumedAt != null) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'token_consumed' } };
  }

  if (context.actorId && String(context.actorId) !== token.actorId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'actor_mismatch' } };
  }
  if (context.targetId && String(context.targetId) !== token.targetId) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'target_mismatch' } };
  }
  if (context.compareHash && String(context.compareHash) !== token.compareHash) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'compare_hash_mismatch' } };
  }
  if (context.sourceIdsHash && String(context.sourceIdsHash) !== token.sourceIdsHash) {
    return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'source_ids_hash_mismatch' } };
  }

  if (context.expectedVersionVector != null) {
    const expected = stableHash(context.expectedVersionVector);
    const actual = stableHash(token.versionVector || null);
    if (expected !== actual) {
      return { ok: false, error: { code: 'invalid_confirmation_token', reason: 'snapshot_version_mismatch' } };
    }
  }

  return {
    ok: true,
    value: {
      tokenId: token.tokenId,
      actorId: token.actorId,
      sourceIdsHash: token.sourceIdsHash,
      targetId: token.targetId,
      compareHash: token.compareHash,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      versionVector: token.versionVector || null,
    },
  };
}

function normalizePlanningGateReasonCodes(values) {
  const list = Array.isArray(values) ? values : [];
  const normalized = [];
  for (const value of list) {
    const reason = String(value || '').trim();
    if (!reason) continue;
    normalized.push(reason);
  }
  return [...new Set(normalized)].sort(deterministicStringCompare);
}

function normalizePlanningDowngradeMarker(marker, fallbackMarker) {
  const input = marker && typeof marker === 'object' ? marker : {};
  const markerType = String(input.marker || fallbackMarker || '').trim().toLowerCase();
  const normalizedMarker = markerType === 'stale'
    ? 'stale'
    : markerType === 'conflict'
      ? 'conflict'
      : fallbackMarker;

  return {
    sourceId: String(input.sourceId || '').trim() || null,
    sourceType: String(input.sourceType || '').trim() || null,
    path: String(input.path || '').trim() || null,
    status: String(input.status || (normalizedMarker === 'stale' ? 'stale' : 'invalid')).trim().toLowerCase(),
    reason: String(
      input.reason
      || input.reasonCode
      || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict')
    ).trim() || (normalizedMarker === 'stale' ? 'source_stale' : 'source_conflict'),
    marker: normalizedMarker,
  };
}

function buildPlanningDowngradeMetadata(input = {}) {
  const sourceMarkers = Array.isArray(input.sourceMarkers) ? input.sourceMarkers : [];
  const explicit = input.downgrade && typeof input.downgrade === 'object' ? input.downgrade : {};

  let staleMarkers = Array.isArray(explicit.staleMarkers)
    ? explicit.staleMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'stale'))
    : [];
  let conflictMarkers = Array.isArray(explicit.conflictMarkers)
    ? explicit.conflictMarkers.map((marker) => normalizePlanningDowngradeMarker(marker, 'conflict'))
    : [];

  const deriveStaleFromSources = staleMarkers.length === 0;
  const deriveConflictFromSources = conflictMarkers.length === 0;

  if (deriveStaleFromSources || deriveConflictFromSources) {
    for (const marker of sourceMarkers) {
      const status = String(marker && marker.status || '').trim().toLowerCase();
      const reason = String(marker && (marker.reasonCode || marker.reason) || '').trim();
      if (deriveStaleFromSources && status === 'stale') {
        staleMarkers.push(normalizePlanningDowngradeMarker({ ...marker, reason }, 'stale'));
      }
      if (deriveConflictFromSources && (status === 'invalid' || status === 'unavailable')) {
        conflictMarkers.push(normalizePlanningDowngradeMarker({ ...marker, reason }, 'conflict'));
      }
    }
  }

  if (input.newerDataAvailable === true) {
    staleMarkers.push(normalizePlanningDowngradeMarker({
      sourceId: 'version-vector',
      sourceType: 'version-vector',
      status: 'stale',
      reason: 'newer_data_available',
      marker: 'stale',
    }, 'stale'));
  }

  staleMarkers.sort((a, b) => deterministicStringCompare(String(a.sourceId || ''), String(b.sourceId || '')));
  conflictMarkers.sort((a, b) => deterministicStringCompare(String(a.sourceId || ''), String(b.sourceId || '')));

  return {
    staleMarkers,
    conflictMarkers,
    reasonCodes: normalizePlanningGateReasonCodes([
      ...(Array.isArray(explicit.reasonCodes) ? explicit.reasonCodes : []),
      ...staleMarkers.map((marker) => marker.reason),
      ...conflictMarkers.map((marker) => marker.reason),
    ]),
    primaryReason: String(explicit.primaryReason || '').trim(),
  };
}

function mapPlanningGateState(input = {}) {
  const downgrade = buildPlanningDowngradeMetadata(input);
  const explicit = normalizePlanningGateState(input.gateState);
  if (input.gateState) {
    return {
      state: explicit,
      reason: String(input.reason || downgrade.primaryReason || '').trim() || explicit,
    };
  }

  if (input.policyGateBlocked) {
    return {
      state: PLANNING_GATE_STATES.POLICY_BLOCKED,
      reason: String(input.reason || policyGateReason || 'Policy gate blocked mutating actions').trim(),
    };
  }

  const httpStatus = Number(input.httpStatus || 0);
  const errorCode = String(input.errorCode || '').trim();
  const requestedScopes = Array.isArray(input.requestedScopes) ? input.requestedScopes : [];
  const deniedScopes = Array.isArray(input.deniedScopes) ? input.deniedScopes : [];

  if (
    httpStatus === 401
    || httpStatus === 403
    || errorCode === 'scope_visibility_denied'
    || errorCode === 'missing_user_context'
    || (requestedScopes.length > 0 && deniedScopes.length >= requestedScopes.length)
  ) {
    return {
      state: PLANNING_GATE_STATES.AUTH_DENIED,
      reason: String(input.reason || 'Default-deny scope visibility blocked request').trim(),
    };
  }

  const matches = Array.isArray(input.matches) ? input.matches : [];
  const hasDegradedSources = downgrade.staleMarkers.length > 0 || downgrade.conflictMarkers.length > 0;

  if (!matches.length) {
    return {
      state: PLANNING_GATE_STATES.INSUFFICIENT_DATA,
      reason: String(input.reason || 'no_compare_matches').trim(),
    };
  }

  if (hasDegradedSources || deniedScopes.length > 0 || input.newerDataAvailable === true) {
    const fallbackReason = input.newerDataAvailable === true
      ? 'newer_data_available'
      : downgrade.conflictMarkers[0] && downgrade.conflictMarkers[0].reason
        ? downgrade.conflictMarkers[0].reason
        : downgrade.staleMarkers[0] && downgrade.staleMarkers[0].reason
          ? downgrade.staleMarkers[0].reason
          : downgrade.primaryReason || downgrade.reasonCodes[0] || 'compare_downgraded';
    return {
      state: PLANNING_GATE_STATES.DEGRADED,
      reason: String(input.reason || fallbackReason).trim(),
    };
  }

  return {
    state: PLANNING_GATE_STATES.PASS,
    reason: String(input.reason || 'Compare satisfied gate checks').trim(),
  };
}

function parsePlanningApiError(error) {
  const message = String((error && error.message) || error || 'Unknown error');
  const statusMatch = message.match(/^(\d{3})\s/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : 0;

  const firstBrace = message.indexOf('{');
  let errorCode = '';
  let reason = message;
  let body = null;

  if (firstBrace >= 0) {
    try {
      body = JSON.parse(message.slice(firstBrace));
      const nestedError = body && typeof body.error === 'object' ? body.error : null;
      errorCode = String(body.code || (nestedError && nestedError.code) || '').trim();
      reason = String(body.reason || (nestedError && nestedError.reason) || body.error || reason).trim();
    } catch {
      // best-effort parse only
    }
  }

  return { message, httpStatus, errorCode, reason, body };
}

function getSandboxDraftEntropy() {
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 14);
}

function createSandboxDraftId(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const timePart = Math.max(0, Math.floor(nowMs)).toString(36);
  const providedEntropy = typeof options.entropy === 'string' ? options.entropy : '';

  let entropyPart = String(providedEntropy || getSandboxDraftEntropy())
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+/, '')
    .slice(0, 24);

  if (!entropyPart) entropyPart = 'draft';

  let sandboxId = `sb-${timePart}-${entropyPart}`.slice(0, 64);
  if (!SANDBOX_ID_PATTERN.test(sandboxId)) {
    sandboxId = `sb-${Math.random().toString(36).slice(2, 14)}`;
  }

  return SANDBOX_ID_PATTERN.test(sandboxId) ? sandboxId : 'sb-draft-1';
}

function ensureSandboxDraftId() {
  const input = $('sandbox-id');
  if (!input) return '';

  const currentValue = String(input.value || '').trim();
  if (currentValue) return currentValue;

  const draftSandboxId = createSandboxDraftId();
  input.value = draftSandboxId;
  return draftSandboxId;
}

function buildCreateSandboxPayload(value) {
  const sandboxId = String(value || '').trim();
  return sandboxId ? { sandboxId } : {};
}

function resolveCanonicalSandboxId(response, fallbackSandboxId, payload) {
  const result = response && typeof response === 'object' && response.result && typeof response.result === 'object'
    ? response.result
    : null;

  return String(
    (result && result.sandboxId)
      || (response && response.sandboxId)
      || fallbackSandboxId
      || (payload && payload.sandboxId)
      || ''
  ).trim();
}

function switchTab(tab) {
  const sessions = tab === 'sessions';
  const sandboxes = tab === 'sandboxes';
  const assets = tab === 'assets';
  const lsp = tab === 'lsp';
  const tracker = tab === 'tracker';
  const planning = tab === 'planning';
  const gateway = tab === 'gateway';
  const skillsPreview = tab === 'skills-preview';
  $('tab-sessions').classList.toggle('active', sessions);
  $('tab-sandboxes').classList.toggle('active', sandboxes);
  $('tab-assets').classList.toggle('active', assets);
  $('tab-lsp').classList.toggle('active', lsp);
  $('tab-tracker').classList.toggle('active', tracker);
  $('tab-planning').classList.toggle('active', planning);
  $('tab-gateway').classList.toggle('active', gateway);
  $('tab-skills-preview').classList.toggle('active', skillsPreview);
  $('view-sessions').classList.toggle('hidden', !sessions);
  $('view-sandboxes').classList.toggle('hidden', !sandboxes);
  $('view-assets').classList.toggle('hidden', !assets);
  $('view-lsp').classList.toggle('hidden', !lsp);
  $('view-tracker').classList.toggle('hidden', !tracker);
  $('view-planning').classList.toggle('hidden', !planning);
  $('view-gateway').classList.toggle('hidden', !gateway);
  $('view-skills-preview').classList.toggle('hidden', !skillsPreview);
  
  if (lsp) {
    loadLspConfig();
  }
  
  // SSE lifecycle: start when viewing tracker, stop otherwise
  if (tracker) {
    loadTracker();
    startTrackerSSE();
  } else {
    stopTrackerSSE();
  }

  if (planning) {
    renderPlanningView();
  }

  if (gateway) {
    loadGatewayConfig();
    refreshGatewayState({ setStatusMessage: false }).catch(() => {
      setStatus('Gateway state unavailable.');
    });
  }

  if (skillsPreview) {
    loadSkillsPreview();
  }

  if (sandboxes) {
    ensureSandboxDraftId();
    loadSandboxes().catch((e) => setStatus(e.message));
  }
}

async function loadSkillsPreview() {
  const tbody = $('skills-preview-body');
  const empty = $('skills-preview-empty');
  const detail = $('skills-preview-detail');
  tbody.innerHTML = '';
  detail.textContent = '(loading...)';
  try {
    const res = await fetch('/api/skills/preview');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const skills = data.skills || [];
    if (!skills.length) {
      empty.style.display = '';
      detail.textContent = '(no skills)';
      return;
    }
    empty.style.display = 'none';
    for (const s of skills) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = s.name;
      const tdKind = document.createElement('td');
      tdKind.innerHTML = s.kind === 'pointer'
        ? '<span class="badge badge-ok">pointer</span>'
        : '<span class="badge badge-missing">full</span>';
      const tdTriggers = document.createElement('td');
      tdTriggers.textContent = s.triggers || '';
      tdTriggers.style.maxWidth = '300px';
      tdTriggers.style.overflow = 'hidden';
      tdTriggers.style.textOverflow = 'ellipsis';
      const tdActions = document.createElement('td');
      const viewBtn = document.createElement('button');
      viewBtn.className = 'btn btn-sm';
      viewBtn.textContent = 'View';
      viewBtn.onclick = () => viewSkillDetail(s.name, s.vaultPath || s.absPath);
      tdActions.appendChild(viewBtn);
      tr.appendChild(tdName);
      tr.appendChild(tdKind);
      tr.appendChild(tdTriggers);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    detail.textContent = '(select a skill above)';
  } catch (e) {
    detail.textContent = 'Error: ' + e.message;
  }
}

async function viewSkillDetail(name, absPath) {
  const detail = $('skills-preview-detail');
  detail.textContent = '(loading ' + name + '...)';
  try {
    const rel = absPath ? 'skills/' + name + '/SKILL.md' : '';
    const res = await fetch('/api/assets/view?path=' + encodeURIComponent(rel));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    detail.textContent = text;
  } catch (e) {
    detail.textContent = 'Error loading ' + name + ': ' + e.message;
  }
}

function setSessionsSource(next, options = {}) {
  const reload = options.reload !== false;
  sessionSource = next;
  $('tab-sessions-all').classList.toggle('active', next === 'all');
  $('tab-sessions-cli').classList.toggle('active', next === 'cli');
  $('tab-sessions-vscode').classList.toggle('active', next === 'vscode');
  $('tab-sessions-sandbox').classList.toggle('active', next === 'sandbox');
  selectedSession = null;
  $('btn-archive-session').disabled = true;
  $('btn-delete-session').disabled = true;
  $('session-detail').textContent = 'Select a session.';
  $('session-detail').classList.add('muted');
  $('session-plans').textContent = '';
  $('session-plan').textContent = '';
  $('session-final').textContent = '';
  $('session-agent-usage').textContent = '';
  $('session-progress').textContent = '';
  $('session-progress').classList.add('muted');
  $('session-proposition').textContent = '';
  $('session-proposition').classList.add('muted');
  $('session-verification-guide').textContent = '';
  $('session-verification-guide').classList.add('muted');
  $('session-events').textContent = '';
  if (reload) {
    loadSessions().catch((e) => setStatus(e.message));
  }
}

function mergeSessionsWithTracker(fsSessions, acpSessions) {
  function normalizeSourceSet(values) {
    const set = new Set();
    for (const value of values || []) {
      const source = String(value || '').trim().toLowerCase();
      if (!source) continue;
      set.add(source);
    }
    return Array.from(set).sort(deterministicStringCompare);
  }

  function getSessionCanonicalAuthority(session) {
    const reconciliation = session && session.reconciliation && typeof session.reconciliation === 'object'
      ? session.reconciliation
      : null;
    return String(
      (reconciliation && reconciliation.authority)
      || session.authority
      || 'fs'
    ).trim().toLowerCase() || 'fs';
  }

  function getSessionCanonicalStatus(session) {
    const reconciliation = session && session.reconciliation && typeof session.reconciliation === 'object'
      ? session.reconciliation
      : null;
    return String(
      (reconciliation && reconciliation.resolvedStatus)
      || session.resolvedStatus
      || session.status
      || 'missing'
    ).trim().toLowerCase() || 'missing';
  }

  function getSessionCanonicalReason(session) {
    const reconciliation = session && session.reconciliation && typeof session.reconciliation === 'object'
      ? session.reconciliation
      : null;
    return String(
      (reconciliation && reconciliation.reason)
      || session.reconciliationReason
      || ''
    ).trim().toLowerCase();
  }

  function getSessionCanonicalSourceSet(session) {
    const reconciliation = session && session.reconciliation && typeof session.reconciliation === 'object'
      ? session.reconciliation
      : null;
    const sourceSet = Array.isArray(reconciliation && reconciliation.sourceSet)
      ? reconciliation.sourceSet
      : (Array.isArray(session.resolvedSourceSet)
        ? session.resolvedSourceSet
        : (Array.isArray(session.sources) ? session.sources : [session.canonicalSource || session.source]));
    return normalizeSourceSet(sourceSet);
  }

  function normalizeSessionStatusToken(value) {
    return String(value || '').trim().toLowerCase();
  }

  function buildSessionReconciliationMarkers(input = {}) {
    const authority = String(input.authority || '').trim().toLowerCase();
    const runtimeStatus = normalizeSessionStatusToken(input.runtimeStatus);
    const artifactStatus = normalizeSessionStatusToken(input.artifactStatus);
    const staleMarkers = [];
    const conflictMarkers = [];

    if (authority === 'acp-only') {
      staleMarkers.push({
        marker: 'stale',
        reason: 'artifact_state_missing',
        runtimeStatus: runtimeStatus || null,
        artifactStatus: null,
      });
    }

    if (authority === 'acp' && runtimeStatus && artifactStatus && runtimeStatus !== artifactStatus) {
      conflictMarkers.push({
        marker: 'conflict',
        reason: 'runtime_artifact_status_mismatch',
        runtimeStatus,
        artifactStatus,
      });
    }

    staleMarkers.sort((a, b) => deterministicStringCompare(String(a.reason || ''), String(b.reason || '')));
    conflictMarkers.sort((a, b) => deterministicStringCompare(String(a.reason || ''), String(b.reason || '')));

    const reasonCodes = [...new Set([
      ...staleMarkers.map((marker) => marker.reason),
      ...conflictMarkers.map((marker) => marker.reason),
    ])].sort(deterministicStringCompare);

    return {
      staleMarkers,
      conflictMarkers,
      reasonCodes,
    };
  }

  function normalizeSessionForDisplay(session, overrides = {}) {
    const authority = String(overrides.authority || getSessionCanonicalAuthority(session)).trim().toLowerCase() || 'fs';
    const resolvedStatus = String(overrides.resolvedStatus || getSessionCanonicalStatus(session)).trim().toLowerCase() || 'missing';
    const sourceSet = normalizeSourceSet(Array.isArray(overrides.sourceSet)
      ? overrides.sourceSet
      : getSessionCanonicalSourceSet(session));
    const reason = String(
      overrides.reason
      || getSessionCanonicalReason(session)
      || (authority === 'acp' ? 'runtime_and_artifact' : authority === 'acp-only' ? 'runtime_only' : 'artifact_only')
    ).trim().toLowerCase();
    const reconciliationMarkers = buildSessionReconciliationMarkers({
      authority,
      runtimeStatus: overrides.runtimeStatus || (session && session.acpData && session.acpData.status) || resolvedStatus,
      artifactStatus: overrides.artifactStatus || (session && session.resolvedStatus) || (session && session.status),
    });

    const existing = session && session.reconciliation && typeof session.reconciliation === 'object'
      ? session.reconciliation
      : {};
    const reconciliation = {
      contractVersion: String(existing.contractVersion || '1'),
      deterministic: true,
      authority,
      reason,
      resolvedStatus,
      sourceSet,
      sourceOfTruth: existing.sourceOfTruth || (authority === 'fs' ? 'artifact' : 'runtime'),
      sourcePrecedence: Array.isArray(existing.sourcePrecedence) && existing.sourcePrecedence.length
        ? existing.sourcePrecedence
        : (authority === 'acp' ? ['runtime', 'artifact'] : authority === 'acp-only' ? ['runtime'] : ['artifact']),
      hasRuntimeState: typeof existing.hasRuntimeState === 'boolean' ? existing.hasRuntimeState : authority !== 'fs',
      hasArtifactState: typeof existing.hasArtifactState === 'boolean' ? existing.hasArtifactState : authority !== 'acp-only',
      staleMarkers: reconciliationMarkers.staleMarkers,
      conflictMarkers: reconciliationMarkers.conflictMarkers,
      downgradeReasonCodes: reconciliationMarkers.reasonCodes,
      downgraded: reconciliationMarkers.reasonCodes.length > 0,
    };

    return {
      ...session,
      authority,
      status: resolvedStatus,
      reconciliation,
      reconciliationReason: reason,
      resolvedStatus,
      resolvedSourceSet: sourceSet,
    };
  }

  const acpMap = new Map();
  for (const s of acpSessions) {
    const id = s.id || s.sessionId;
    if (id) acpMap.set(id, s);
  }

  const merged = [];
  const seen = new Set();

  for (const fs of fsSessions) {
    seen.add(fs.id);
    const acp = acpMap.get(fs.id);
    if (acp) {
      merged.push(normalizeSessionForDisplay({
        ...fs,
        status: acp.status || fs.status,
        authority: 'acp',
        acpData: acp,
      }, {
        authority: 'acp',
        reason: 'runtime_and_artifact',
        resolvedStatus: acp.status || fs.resolvedStatus || fs.status,
        sourceSet: [...getSessionCanonicalSourceSet(fs), 'acp'],
        runtimeStatus: acp.status,
        artifactStatus: fs.resolvedStatus || fs.status,
      }));
    } else {
      merged.push(normalizeSessionForDisplay({
        ...fs,
        authority: 'fs',
      }, {
        authority: getSessionCanonicalAuthority(fs),
        reason: getSessionCanonicalReason(fs) || 'artifact_only',
        artifactStatus: fs.resolvedStatus || fs.status,
      }));
    }
  }

  for (const [id, acp] of acpMap) {
    if (seen.has(id)) continue;
    merged.push(normalizeSessionForDisplay({
      id,
      status: acp.status || 'active',
      source: 'acp',
      authority: 'acp-only',
      acpData: acp,
      repo: null,
      branch: null,
      cwd: null,
      mode: null,
      startTime: null,
      lastEventTime: null,
    }, {
      authority: 'acp-only',
      reason: 'runtime_only',
      resolvedStatus: acp.status || 'active',
      sourceSet: ['acp'],
      runtimeStatus: acp.status,
    }));
  }

  return merged;
}

async function loadSessions() {
  setStatus('Loading sessions…');
  const [fsData, acpData] = await Promise.all([
    api(`/api/sessions?activeWindowMinutes=30&source=${encodeURIComponent(sessionSource)}`),
    api('/api/tracker/sessions').catch(() => []),
  ]);
  const fsSessions = fsData.sessions || [];
  const acpSessions = Array.isArray(acpData) ? acpData : (acpData.sessions || []);
  const merged = mergeSessionsWithTracker(fsSessions, acpSessions);

  // WU-203: Duplicate guard — dedupe by canonicalKey on client side
  const seenKeys = new Map();
  const sessions = [];
  for (const s of merged) {
    const key = s.canonicalKey || null;
    if (key) {
      if (seenKeys.has(key)) {
        console.warn('[session-dedupe] Duplicate canonicalKey detected, keeping first:', key);
        continue;
      }
      seenKeys.set(key, true);
    }
    sessions.push(s);
  }

  const active = sessions.filter((s) => {
    const reconciliation = s && s.reconciliation && typeof s.reconciliation === 'object'
      ? s.reconciliation
      : null;
    const resolvedStatus = String(
      (reconciliation && reconciliation.resolvedStatus)
      || s.resolvedStatus
      || s.status
      || 'missing'
    ).trim().toLowerCase();
    return resolvedStatus === 'active';
  });
  const past = sessions.filter((s) => {
    const reconciliation = s && s.reconciliation && typeof s.reconciliation === 'object'
      ? s.reconciliation
      : null;
    const resolvedStatus = String(
      (reconciliation && reconciliation.resolvedStatus)
      || s.resolvedStatus
      || s.status
      || 'missing'
    ).trim().toLowerCase();
    return resolvedStatus !== 'active';
  });
  $('sessions-summary').textContent = `${active.length} active, ${past.length} past`;

  function renderList(target, list) {
    target.textContent = '';
    for (const s of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      const sourceLabel = getSessionDisplayLabel(s, sessionSource);
      const reconciliation = s && s.reconciliation && typeof s.reconciliation === 'object'
        ? s.reconciliation
        : null;
      const authority = String((reconciliation && reconciliation.authority) || s.authority || '').trim().toLowerCase();
      const resolvedStatus = String((reconciliation && reconciliation.resolvedStatus) || s.resolvedStatus || s.status || 'missing').trim().toLowerCase();
      const authorityBadge = authority === 'acp' ? '[ACP] ' : authority === 'acp-only' ? '[ACP-ONLY] ' : authority === 'fs' ? '[FS] ' : '';
      const prefix = authorityBadge + sourceLabel;
      if (authority === 'acp-only') btn.classList.add('acp-only-muted');
      const title = prefix + (s.repo ? `${s.repo}` : s.cwd || s.id);
      const sub = `${s.id} • ${resolvedStatus} • ${fmtTime(s.lastEventTime || s.startTime)}`;
      btn.innerHTML = `<div class="item-title"></div><div class="item-sub muted"></div>`;
      btn.querySelector('.item-title').textContent = title;
      btn.querySelector('.item-sub').textContent = sub;
      btn.addEventListener('click', () => selectSession(s));
      target.appendChild(btn);
    }
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(none)';
      target.appendChild(d);
    }
  }

  renderList($('sessions-active'), active);
  renderList($('sessions-past'), past);
  setStatus('Sessions loaded.');
  return sessions;
}

function requireSandboxId(actionLabel) {
  const sandboxId = String(($('sandbox-id') && $('sandbox-id').value) || '').trim();
  if (sandboxId) return sandboxId;
  setStatus(`Sandbox ${actionLabel} requires sandboxId.`);
  return null;
}

function findSandboxSessionMatch(list, sandboxId) {
  const target = String(sandboxId || '').trim().toLowerCase();
  if (!target) return null;
  const bySandbox = list.find((s) => String((s && s.sandbox) || '').trim().toLowerCase() === target);
  if (bySandbox) return bySandbox;
  return list.find((s) => String((s && s.id) || '').trim().toLowerCase() === target) || null;
}

async function followSandboxSession(sandboxId, options = {}) {
  const target = String(sandboxId || '').trim();
  if (!target) {
    setStatus('Follow requires sandboxId.');
    return;
  }

  const followCore = async () => {
    switchTab('sessions');
    setSessionsSource('sandbox', { reload: false });
    const sessions = await loadSessions();
    const match = findSandboxSessionMatch(sessions, target);
    if (!match) {
      throw new Error(`Sandbox ${target} not found in Sessions.`);
    }

    await selectSession(match);
    return match;
  };

  if (options && options.skipActionLog) {
    const result = await followCore();
    if (!options.skipStatus) {
      setStatus(`Following sandbox ${target}.`);
    }
    return result;
  }

  return runActionWithLog('sandbox.follow', followCore, {
    startMessage: `Following sandbox ${target}…`,
    successMessage: `Following sandbox ${target}.`,
    failurePrefix: 'Sandbox follow failed',
  });
}

async function runSandboxLifecycleAction(action, payload, sandboxId) {
  return runActionWithLog(`sandbox.${action}`, async () => {
    const response = await api(`/api/tracker/lifecycle/${encodeURIComponent(action)}`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });

    const canonicalSandboxId = resolveCanonicalSandboxId(response, sandboxId, payload);

    if (canonicalSandboxId && $('sandbox-id')) {
      $('sandbox-id').value = canonicalSandboxId;
    }

    if (canonicalSandboxId) {
      await followSandboxSession(canonicalSandboxId, { skipActionLog: true, skipStatus: true });
    }

    return response;
  }, {
    startMessage: `Running sandbox ${action}…`,
    successMessage: `Sandbox ${action} completed.`,
    failurePrefix: `Sandbox ${action} failed`,
  });
}

async function loadSandboxes() {
  setStatus('Loading sandboxes…');
  const data = await api('/api/sessions?activeWindowMinutes=30&source=sandbox');
  sandboxSessions = (data && data.sessions) || [];
  $('sandboxes-summary').textContent = `${sandboxSessions.length} discovered`;

  const container = $('sandboxes-list');
  container.textContent = '';

  for (const s of sandboxSessions) {
    const sandboxId = String((s && s.sandbox) || (s && s.id) || '').trim();
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<div class="item-title"></div><div class="item-sub muted"></div><div class="actions" style="margin-top: 6px;"></div>';
    const title = sandboxId || '(unknown sandbox)';
    const detail = [s.id, s.status, fmtTime(s.lastEventTime || s.startTime)].filter(Boolean).join(' • ');
    row.querySelector('.item-title').textContent = title;
    row.querySelector('.item-sub').textContent = detail;

    row.addEventListener('click', () => {
      if ($('sandbox-id')) $('sandbox-id').value = sandboxId;
    });

    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'btn small';
    followBtn.textContent = 'Follow';
    followBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await followSandboxSession(sandboxId);
      } catch (err) {
        const failure = (err && err.actionFailure) || parseActionFailureDetails(err);
        setStatus(`Follow failed: ${formatActionFailureSummary(failure)}`);
      }
    });
    row.querySelector('.actions').appendChild(followBtn);
    container.appendChild(row);
  }

  if (!sandboxSessions.length) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = '(none)';
    container.appendChild(d);
  }

  setStatus('Sandboxes loaded.');
}

async function selectSession(s) {
  selectedSession = s;
  $('btn-archive-session').disabled = policyGateBlocked;
  $('btn-delete-session').disabled = policyGateBlocked;

  $('session-detail').classList.remove('muted');
  $('session-detail').textContent = '';
  $('session-plans').textContent = '';
  $('session-plan').textContent = '';
  $('session-final').textContent = '';
  $('session-agent-usage').textContent = '';
  $('session-agent-usage').classList.add('muted');
  $('session-progress').textContent = '';
  $('session-progress').classList.add('muted');
  $('session-proposition').textContent = '';
  $('session-proposition').classList.add('muted');
  $('session-verification-guide').textContent = '';
  $('session-verification-guide').classList.add('muted');
  $('session-events').textContent = '';
  const reconciliation = s && s.reconciliation && typeof s.reconciliation === 'object'
    ? s.reconciliation
    : null;
  const authority = String((reconciliation && reconciliation.authority) || s.authority || 'fs').trim().toLowerCase();
  const resolvedStatus = String((reconciliation && reconciliation.resolvedStatus) || s.resolvedStatus || s.status || 'missing').trim().toLowerCase();
  const reconciliationReason = String((reconciliation && reconciliation.reason) || s.reconciliationReason || '').trim();

  $('session-detail').innerHTML = `
    <div><b>ID:</b> ${escapeHtml(s.id)}</div>
    <div><b>Source:</b> ${escapeHtml(s.source || sessionSource)}</div>
    <div><b>Authority:</b> ${authority === 'acp' ? 'ACP (live)' : authority === 'acp-only' ? 'ACP-only' : 'Filesystem'}</div>
    <div><b>Status:</b> ${escapeHtml(resolvedStatus)}</div>
    <div><b>Reconciliation:</b> ${escapeHtml(reconciliationReason || 'n/a')}</div>
    <div><b>Repo:</b> ${escapeHtml(s.repo || '')}</div>
    <div><b>Branch:</b> ${escapeHtml(s.branch || '')}</div>
    <div><b>CWD:</b> ${escapeHtml(s.cwd || '')}</div>
    <div><b>Mode:</b> ${escapeHtml(s.mode || '')}</div>
    <div><b>Last event:</b> ${fmtTime(s.lastEventTime)}</div>
  `;

  setStatus(`Loading plan/events for ${s.id}…`);
  const source = encodeURIComponent(String(resolveSessionSource(s)));
  const [plansIndex, finalOut, agentUsage, evs, structuredState, proposition, verificationGuide] = await Promise.all([
    api(`/api/sessions/${encodeURIComponent(s.id)}/plans?source=${source}`).catch(() => ({ plans: [] })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/final?source=${source}`).catch(() => ''),
    api(`/api/sessions/${encodeURIComponent(s.id)}/agent-usage?limit=500&source=${source}`).catch(() => ({ usage: {} })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/events?limit=20&source=${source}`).catch(() => ({ events: [] })),
    api(`/api/sessions/${encodeURIComponent(s.id)}/structured-state?source=${source}`).catch(() => null),
    api(`/api/sessions/${encodeURIComponent(s.id)}/proposition?source=${source}`).catch((e) => {
      const msg = String((e && e.message) || '');
      if (msg.startsWith('404')) return null;
      return { error: msg };
    }),
    api(`/api/sessions/${encodeURIComponent(s.id)}/verification-guide?source=${source}`).catch((e) => {
      const msg = String((e && e.message) || '');
      if (msg.startsWith('404')) return null;
      return { error: msg };
    }),
  ]);

  const plans = (plansIndex && plansIndex.plans) || [];
  function planLabel(p) {
    const status = p && p.status ? String(p.status) : '';
    const verdict = p && p.verdict ? String(p.verdict) : '';
    const parts = [p.id];
    if (status) parts.push(status);
    if (verdict && verdict !== status) parts.push(verdict);
    return parts.join(' • ');
  }

  async function loadPlan(planId) {
    const txt = await api(`/api/sessions/${encodeURIComponent(s.id)}/plans/${encodeURIComponent(planId)}?source=${source}`).catch(() => '');
    $('session-plan').textContent = String(txt || '');
  }

  $('session-plans').textContent = '';
  for (const p of plans) {
    if (!p || !p.id) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.innerHTML = `<div class="item-title"></div><div class="item-sub muted"></div>`;
    btn.querySelector('.item-title').textContent = planLabel(p);
    const meta = [p.kind, p.source, p.bytes ? `${p.bytes} bytes` : null].filter(Boolean).join(' • ');
    btn.querySelector('.item-sub').textContent = meta;
    btn.addEventListener('click', () => loadPlan(p.id));
    $('session-plans').appendChild(btn);
  }
  if (!plans.length) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = '(no plan artifacts found)';
    $('session-plans').appendChild(d);
  } else {
    // Auto-load the best default: latest > first.
    const preferred = plans.find((p) => p.id === 'latest') || plans[0];
    if (preferred && preferred.id) await loadPlan(preferred.id);
  }

  $('session-final').textContent = String(finalOut || '').slice(0, 8000);

  // Render progress (WU-008)
  if (structuredState && structuredState.groups) {
    $('session-progress').classList.remove('muted');
    let progressHtml = '';
    
    // Groups overview
     if (Array.isArray(structuredState.groups) && structuredState.groups.length > 0) {
       progressHtml += '<div class="progress-section"><b>Work Unit Groups:</b></div>';
       for (const g of structuredState.groups) {
         const status = g.status || 'unknown';
         const done = g.wusDone || 0;
         const total = g.wusTotal || 0;
         const statusClass = status === 'done' ? 'status-done' : status === 'in-progress' ? 'status-in-progress' : 'status-pending';
         progressHtml += `<div class="progress-item"><span class="badge ${statusClass}">${escapeHtml(status)}</span> ${escapeHtml(g.group || '?')}: ${escapeHtml(g.title || '(untitled)')} (${escapeHtml(done)}/${escapeHtml(total)})</div>`;
       }
     }
     
     // Next unit
     if (structuredState.nextUnit && typeof structuredState.nextUnit === 'object' && structuredState.nextUnit.workUnitId) {
       const nu = structuredState.nextUnit;
       const rationale = nu.rationale ? ` — ${escapeHtml(nu.rationale)}` : '';
       progressHtml += `<div class="progress-section"><b>Next Unit:</b> ${escapeHtml(nu.workUnitId)}${rationale}</div>`;
     }
     
     // Checkpoints
     if (Array.isArray(structuredState.checkpoints) && structuredState.checkpoints.length > 0) {
       progressHtml += '<div class="progress-section"><b>Checkpoints:</b></div>';
       for (const cp of structuredState.checkpoints) {
         const cpStatus = String(cp.status || 'pending').toLowerCase();
         const statusClass = cpStatus === 'passed' ? 'status-done' : cpStatus === 'failed' ? 'status-failed' : cpStatus === 'skipped' ? 'status-skipped' : 'status-pending';
         progressHtml += `<div class="progress-item"><span class="badge ${statusClass}">${escapeHtml(cpStatus)}</span> ${escapeHtml(cp.checkpoint || '?')} (${escapeHtml(cp.trigger || 'manual')})</div>`;
       }
     }
    
    $('session-progress').innerHTML = progressHtml || '(no progress data)';
  } else {
    $('session-progress').textContent = '(no progress data)';
  }

  // Render proposition (WU-009)
  if (proposition && proposition.error) {
    $('session-proposition').textContent = `Error: ${proposition.error}`;
  } else if (proposition && proposition.content) {
    $('session-proposition').classList.remove('muted');
    $('session-proposition').innerHTML = '<pre class="proposition-content"></pre>';
    $('session-proposition').querySelector('.proposition-content').textContent = String(proposition.content).slice(0, 8000);
  } else {
    $('session-proposition').textContent = '(none)';
  }

  // Render verification guide
  if (verificationGuide && verificationGuide.error) {
    $('session-verification-guide').textContent = `Error: ${verificationGuide.error}`;
  } else if (verificationGuide && verificationGuide.content) {
    $('session-verification-guide').classList.remove('muted');
    $('session-verification-guide').innerHTML = '<pre class="proposition-content"></pre>';
    $('session-verification-guide').querySelector('.proposition-content').textContent = String(verificationGuide.content).slice(0, 8000);
  } else {
    $('session-verification-guide').textContent = '(none)';
  }

  const usage = (agentUsage && agentUsage.usage) || {};
  const entries = Object.entries(usage).filter(([, v]) => typeof v === 'number' && v > 0);
  entries.sort((a, b) => b[1] - a[1] || deterministicStringCompare(String(a[0]), String(b[0])));
  if (!entries.length) {
    $('session-agent-usage').textContent = '(none detected)';
  } else {
    $('session-agent-usage').classList.remove('muted');
    $('session-agent-usage').textContent = entries.map(([k, v]) => `${k}: ${v}`).join('\n').slice(0, 4000);
  }

  const events = (evs && evs.events) || [];
  events.sort((a, b) => (evTime(b) || 0) - (evTime(a) || 0));
  for (const ev of events) {
    const row = document.createElement('div');
    row.className = 'event';
    const when = fmtTime(evTime(ev));
    row.innerHTML = `<div class="event-top"><span class="badge"></span><span class="muted"></span></div><pre class="event-body"></pre>`;
    row.querySelector('.badge').textContent = evType(ev);
    row.querySelector('.event-top .muted').textContent = when;
    row.querySelector('.event-body').textContent = JSON.stringify(ev, null, 2).slice(0, 4000);
    $('session-events').appendChild(row);
  }
  if (!events.length) $('session-events').textContent = '(no events found)';
  setStatus(`Loaded ${s.id}.`);
}

async function loadTrackerPermissions() {
  try {
    const data = await api('/api/tracker/permissions');
    const perms = data.permissions || [];
    trackerPendingCount = perms.length;
    updateTrackerBadge();
    const container = $('tracker-permissions');
    container.textContent = '';
    if (!perms.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(no pending permissions)';
      container.appendChild(d);
      return;
    }
    for (const p of perms) {
      const row = document.createElement('div');
      row.className = 'item';
      const callbackId = escapeHtml(p.callbackId || p.id || '');
      const summary = escapeHtml(p.summary || p.description || p.title || '(no summary)');
      const sessionId = escapeHtml(p.sessionId || '');
      const sandboxId = p.sandboxId ? escapeHtml(p.sandboxId) : '';
      
      row.innerHTML = `
        <div class="item-title">${summary}</div>
        <div class="item-sub muted">ID: ${callbackId}${sessionId ? ' \u2022 Session: ' + sessionId : ''}${sandboxId ? ' \u2022 Sandbox: ' + sandboxId : ''}</div>
        <div class="actions" style="margin-top: 4px;">
          <button class="btn small approve-btn" type="button" data-id="${callbackId}">Approve</button>
          <button class="btn small danger deny-btn" type="button" data-id="${callbackId}">Deny</button>
        </div>
      `;
      
      row.querySelector('.approve-btn').addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        setStatus('Approving\u2026');
        try {
          await api('/api/tracker/permissions/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: '{}' });
          setStatus('Approved.');
          await loadTrackerPermissions();
        } catch (err) {
          setStatus('Approve failed: ' + err.message);
        }
      });
      
      row.querySelector('.deny-btn').addEventListener('click', async (e) => {
        const id = e.target.dataset.id;
        setStatus('Denying\u2026');
        try {
          await api('/api/tracker/permissions/' + encodeURIComponent(id) + '/deny', { method: 'POST', body: '{}' });
          setStatus('Denied.');
          await loadTrackerPermissions();
        } catch (err) {
          setStatus('Deny failed: ' + err.message);
        }
      });
      
      container.appendChild(row);
    }
  } catch (e) {
    $('tracker-permissions').textContent = 'Error: ' + e.message;
    trackerPendingCount = 0;
    updateTrackerBadge();
  }
}

async function loadTrackerSessions() {
  try {
    const data = await api('/api/tracker/sessions');
    const sessions = Array.isArray(data) ? data : (data.sessions || []);
    const container = $('tracker-sessions');
    container.textContent = '';
    if (!sessions.length) {
      const d = document.createElement('div');
      d.className = 'muted';
      d.textContent = '(no live sessions)';
      container.appendChild(d);
      return;
    }
    for (const s of sessions) {
      const row = document.createElement('div');
      row.className = 'item';
      const title = escapeHtml(s.id || s.sessionId || '(unknown)');
      const status = escapeHtml(s.status || '');
      row.innerHTML = `<div class="item-title">${title}</div><div class="item-sub muted">Status: ${status}</div>`;
      container.appendChild(row);
    }
  } catch (e) {
    $('tracker-sessions').textContent = 'Error: ' + e.message;
  }
}

async function loadTracker() {
  setStatus('Loading tracker data\u2026');
  await Promise.all([loadTrackerPermissions(), loadTrackerSessions()]);
  setStatus('Tracker loaded.');
}

function updateTrackerBadge() {
  const badge = $('tracker-badge');
  if (!badge) return;
  if (trackerPendingCount > 0) {
    badge.textContent = String(trackerPendingCount);
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function startTrackerSSE() {
  if (trackerEventSource) return; // already running
  
  const statusEl = $('tracker-status');
  const eventsEl = $('tracker-events');
  
  try {
    trackerEventSource = new EventSource('/api/tracker/events');
  } catch (e) {
    if (statusEl) statusEl.textContent = 'SSE error: ' + e.message;
    return;
  }
  
  trackerEventSource.addEventListener('connected', () => {
    if (statusEl) statusEl.textContent = 'Connected (live)';
    if (statusEl) statusEl.classList.remove('muted');
  });
  
  trackerEventSource.addEventListener('live', (e) => {
    // Real-time event — refresh permissions and add to event log
    loadTrackerPermissions().catch(() => {});
    
    if (eventsEl) {
      const row = document.createElement('div');
      row.className = 'event';
      let parsed;
      try { parsed = JSON.parse(e.data); } catch { parsed = { raw: e.data }; }
      const type = (parsed && parsed.type) || 'live';
      const now = new Date().toLocaleTimeString();
      row.innerHTML = '<div class="event-top"><span class="badge"></span><span class="muted"></span></div><pre class="event-body"></pre>';
      row.querySelector('.badge').textContent = type;
      row.querySelector('.event-top .muted').textContent = now;
      row.querySelector('.event-body').textContent = JSON.stringify(parsed, null, 2).slice(0, 2000);
      eventsEl.prepend(row);
      // Keep max 50 events visible
      while (eventsEl.children.length > 50) {
        eventsEl.removeChild(eventsEl.lastChild);
      }
    }
  });
  
  trackerEventSource.onerror = () => {
    if (statusEl) statusEl.textContent = 'Disconnected (reconnecting\u2026)';
    if (statusEl) statusEl.classList.add('muted');
  };
}

function stopTrackerSSE() {
  if (trackerEventSource) {
    trackerEventSource.close();
    trackerEventSource = null;
  }
  const statusEl = $('tracker-status');
  if (statusEl) statusEl.textContent = 'Disconnected';
  if (statusEl) statusEl.classList.add('muted');
}

async function loadManaged() {
  setStatus('Loading managed assets…');
  const data = await api('/api/assets/managed');
  const managed = data.managed || [];
  $('assets-summary').textContent = `${managed.length} managed`;

  const body = $('managed-table');
  body.textContent = '';
  for (const a of managed) {
    const tr = document.createElement('tr');
    const installed = a.installed ? 'yes' : 'no';
    const uptodate = a.upToDate ? 'yes' : 'no';
    tr.innerHTML = `
      <td class="mono"></td>
      <td></td>
      <td>${installed}</td>
      <td>${uptodate}</td>
      <td class="actions"></td>
    `;
    tr.children[0].textContent = a.id;
    tr.children[1].textContent = a.type;

    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', async () => {
      const viewPath = a.type === 'skill' && !String(a.destination || '').toLowerCase().endsWith('/skill.md')
        ? `${String(a.destination || '').replace(/\\/g, '/').replace(/\/+$/, '')}/SKILL.md`
        : a.destination;
      const txt = await api(`/api/assets/view?path=${encodeURIComponent(viewPath)}`).catch((e) => `Error: ${e.message}`);
      $('viewer-meta').textContent = viewPath;
      $('viewer').textContent = txt;    
    });

    const btnSync = document.createElement('button');
    btnSync.type = 'button';
    btnSync.className = 'btn small';
    btnSync.textContent = 'Sync';
    btnSync.addEventListener('click', async () => {
      setStatus(`Syncing ${a.id}…`);
      await api('/api/assets/sync', { method: 'POST', body: JSON.stringify({ assetId: a.id }) });
      await loadManaged();
      await loadInstalled();
      setStatus(`Synced ${a.id}.`);
    });

    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn small danger';
    btnRemove.textContent = 'Remove';
    btnRemove.addEventListener('click', async () => {
      setStatus(`Removing ${a.id}…`);
      const r = await api('/api/assets/remove', { method: 'POST', body: JSON.stringify({ assetId: a.id }) }).catch((e) => ({ error: e.message }));
      $('viewer-meta').textContent = `Remove ${a.id}`;
      $('viewer').textContent = JSON.stringify(r, null, 2);
      await loadManaged();
      await loadInstalled();
      setStatus(`Remove attempted for ${a.id}.`);
    });

    actions.appendChild(btnView);
    actions.appendChild(btnSync);
    actions.appendChild(btnRemove);
    body.appendChild(tr);
  }
  setStatus('Managed assets loaded.');
}

async function loadInstalled() {
  setStatus('Loading installed agents/skills…');
  const data = await api('/api/assets/installed');
  const agents = data.agents || [];
  const skills = data.skills || [];
  const prompts = data.prompts || [];
  const instructions = data.instructions || null;

  const at = $('agents-table');
  at.textContent = '';
  for (const a of agents) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
    tr.children[0].textContent = a.name;
    tr.children[1].textContent = a.fileName;

    const rel = `agents/${a.fileName}`;
    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', () => viewRel(rel, rel));

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn small danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => deleteRel(rel, rel));

    actions.appendChild(btnView);
    actions.appendChild(btnDelete);
    at.appendChild(tr);
  }

  const st = $('skills-table');
  st.textContent = '';
  for (const s of skills) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
    tr.children[0].textContent = s.name;
    tr.children[1].textContent = s.absPath;

    const relFile = `skills/${s.name}/SKILL.md`;
    const relDir = `skills/${s.name}`;
    const actions = tr.querySelector('.actions');
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.addEventListener('click', () => viewRel(relFile, relFile));

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn small danger';
    btnDelete.textContent = 'Delete';
    btnDelete.addEventListener('click', () => deleteRel(relDir, relDir));

    actions.appendChild(btnView);
    actions.appendChild(btnDelete);
    st.appendChild(tr);
  }

  setStatus('Installed inventory loaded.');

  const pt = $('prompts-table');
  const ip = $('instructions-panel');

  if (pt) {
    pt.textContent = '';
    for (const p of prompts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td class="mono"></td><td class="actions"></td>`;
      tr.children[0].textContent = p.name;
      tr.children[1].textContent = p.fileName;

      const rel = `prompts/${p.fileName}`;
      const actions = tr.querySelector('.actions');
      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn small';
      btnView.textContent = 'View';
      btnView.addEventListener('click', () => viewRel(rel, rel));
      actions.appendChild(btnView);
      pt.appendChild(tr);
    }
    if (!prompts.length) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="muted" colspan="3">(none)</td>';
      pt.appendChild(tr);
    }
  }

  if (ip) {
    ip.classList.remove('muted');
    const installed = instructions && instructions.installed === true;
    const rel = 'copilot-instructions.md';
    ip.innerHTML = '';

    const line = document.createElement('div');
    line.className = installed ? '' : 'muted';
    line.textContent = installed ? `Installed: ${rel}` : 'Not installed.';

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnView = document.createElement('button');
    btnView.type = 'button';
    btnView.className = 'btn small';
    btnView.textContent = 'View';
    btnView.disabled = !installed;
    btnView.addEventListener('click', () => viewRel(rel, rel));

    actions.appendChild(btnView);
    ip.appendChild(line);
    ip.appendChild(actions);
  }
}

async function syncAll() {
  setStatus('Syncing all assets…');
  const r = await api('/api/assets/sync-all', { method: 'POST', body: JSON.stringify({ dryRun: false, force: false }) });
  $('viewer-meta').textContent = 'Sync all';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus('Sync all complete.');
}

async function freshAll() {
  const ok = window.confirm('Force-overwrite ALL managed assets into ~/.copilot?\n\nThis replaces any local modifications.');
  if (!ok) return;
  setStatus('Force-syncing all assets…');
  const r = await api('/api/assets/sync-all', { method: 'POST', body: JSON.stringify({ dryRun: false, force: true }) });
  $('viewer-meta').textContent = 'Fresh all (force)';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  await loadManaged();
  await loadInstalled();
  setStatus('Fresh all complete.');
}

async function patchVscodeSettings() {
  const ok = window.confirm(
    'Patch VS Code user settings to use ~/.copilot (chat.*Locations) and install safe terminal auto-approvals (chat.tools.terminal.autoApprove)?\n\nThis edits settings.json and creates a backup.'
  );
  if (!ok) return;
  setStatus('Patching VS Code settings…');
  const r = await api('/api/vscode/patch-settings', { method: 'POST', body: JSON.stringify({ dryRun: false }) }).catch((e) => ({ error: e.message }));
  $('viewer-meta').textContent = 'Patch VS Code settings';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  setStatus('VS Code settings patch attempted.');
}

async function authorizeCopilotFolders() {
  const ok = window.confirm(
    'Authorize Copilot tool access for:\n\n- ~/.copilot\n- default subfolders\n- discovered first-level subfolders\n\nThis updates ~/.copilot/permissions-config.json (read/write/memory) and creates a backup if needed.'
  );
  if (!ok) return;
  setStatus('Authorizing Copilot folders…');
  const r = await api('/api/copilot/authorize', { method: 'POST', body: JSON.stringify({ dryRun: false }) }).catch((e) => ({ error: e.message }));
  $('viewer-meta').textContent = 'Authorize Copilot folders';
  $('viewer').textContent = JSON.stringify(r, null, 2);
  setStatus('Authorization setup attempted.');
}

async function loadLspConfig() {
  setStatus('Loading LSP config…');
  try {
    const data = await api('/api/lsp/config');
    $('lsp-config-viewer').textContent = JSON.stringify(data.config, null, 2);
    $('lsp-config-meta').textContent = 'Loaded successfully.';
    setStatus('LSP config loaded.');
  } catch (e) {
    $('lsp-config-viewer').textContent = String(e);
    $('lsp-config-meta').textContent = 'Error loading config.';
    setStatus('Error loading LSP config.');
  }
}

async function installLsp() {
  const ok = window.confirm('This will run the installation script for C#, Rust, and TypeScript language servers. Continue?');
  if (!ok) return;
  
  setStatus('Installing LSPs (this may take a minute)…');
  $('lsp-install-logs').textContent = 'Installing...';
  $('lsp-install-logs').classList.remove('muted');
  
  try {
    const res = await api('/api/lsp/install', { method: 'POST', body: JSON.stringify({}) });
    let logs = '';
    if (res.stdout) logs += res.stdout + '\n';
    if (res.stderr) logs += res.stderr + '\n';
    if (res.error) logs += 'ERROR: ' + res.error + '\n';
    
    $('lsp-install-logs').textContent = logs || 'Done.';
    setStatus('LSP installation finished.');
    await loadLspConfig();
  } catch (e) {
    $('lsp-install-logs').textContent = String(e);
    setStatus('Error installing LSPs.');
  }
}

// --- Gateway config ---
let gatewayAllowedRoots = new Set();
let gatewayActiveRoot = '';
let gatewayScanResults = null;
let gatewayStateEnvelope = null;

function formatGatewayStateSummary(segment, options = {}) {
  const source = segment && typeof segment === 'object' ? segment : {};
  const readyToken = source.ready === true ? 'ready' : 'not_ready';
  const statusToken = String(source.status || options.fallbackStatus || 'unknown').trim() || 'unknown';
  const parts = [statusToken, readyToken];

  if (source.statusCode != null) {
    parts.push(`statusCode=${source.statusCode}`);
  }

  if (source.error && typeof source.error === 'object') {
    const code = String(source.error.code || '').trim();
    const reason = String(source.error.reason || '').trim();
    if (code) parts.push(`code=${code}`);
    if (reason) parts.push(`reason=${reason}`);
  }

  return parts.join(' • ');
}

function formatGatewayErrorList(errors) {
  const list = Array.isArray(errors) ? errors : [];
  if (!list.length) return '(none)';

  return list
    .map((entry) => {
      const source = entry && typeof entry === 'object' ? entry : { message: String(entry || '') };
      const code = String(source.code || '').trim();
      const reason = String(source.reason || '').trim();
      const message = String(source.message || '').trim() || 'unknown_error';
      const statusCode = Number.isFinite(source.statusCode) ? ` statusCode=${source.statusCode}` : '';
      return `${code || 'error'}${reason ? ` (${reason})` : ''}: ${message}${statusCode}`;
    })
    .join('\n');
}

function renderGatewayState(state) {
  const source = state && typeof state === 'object' ? state : {};
  gatewayStateEnvelope = source;

  if ($('gateway-state-gateway')) {
    $('gateway-state-gateway').textContent = formatGatewayStateSummary(source.gateway, {
      fallbackStatus: source.ready === true ? 'ready' : 'not_ready',
    });
  }

  if ($('gateway-state-tracker')) {
    $('gateway-state-tracker').textContent = formatGatewayStateSummary(source.tracker, {
      fallbackStatus: 'unavailable',
    });
  }

  if ($('gateway-state-db')) {
    const planningPersistence = source.planningPersistence && typeof source.planningPersistence === 'object'
      ? source.planningPersistence
      : {};
    $('gateway-state-db').textContent = formatGatewayStateSummary(planningPersistence, {
      fallbackStatus: planningPersistence.required ? 'required_not_ready' : 'optional',
    });
  }

  if ($('gateway-state-errors')) {
    $('gateway-state-errors').textContent = formatGatewayErrorList(source.errors);
    $('gateway-state-errors').className = Array.isArray(source.errors) && source.errors.length ? 'pre' : 'pre muted';
  }
}

async function refreshGatewayState(options = {}) {
  const setStatusMessage = options.setStatusMessage !== false;

  if (setStatusMessage) {
    setStatus('Loading gateway state…');
  }

  const state = await api('/api/gateway/state');
  renderGatewayState(state);

  if (setStatusMessage) {
    setStatus('Gateway state loaded.');
  }

  return state;
}

async function connectGateway() {
  try {
    const response = await runActionWithLog('gateway.connect', async () => {
      const data = await api('/api/gateway/connect', { method: 'POST', body: JSON.stringify({}) });
      renderGatewayState(data);
      return data;
    }, {
      startMessage: 'Connecting gateway…',
      successMessage: 'Gateway connect completed.',
      failurePrefix: 'Gateway connect failed',
    });

    if (response && response.ready === true) {
      setStatus('Gateway connect completed and ready.');
    }

    return response;
  } catch (error) {
    await refreshGatewayState({ setStatusMessage: false }).catch(() => {});
    throw error;
  }
}

async function initPlanningPersistence() {
  try {
    const response = await runActionWithLog('planning.persistence.init', async () => {
      const data = await api('/api/planning/persistence/init', { method: 'POST', body: JSON.stringify({}) });
      return data;
    }, {
      startMessage: 'Initializing planning persistence…',
      successMessage: 'Planning persistence init completed.',
      failurePrefix: 'Planning persistence init failed',
    });

    await refreshGatewayState({ setStatusMessage: false }).catch(() => {});
    return response;
  } catch (error) {
    await refreshGatewayState({ setStatusMessage: false }).catch(() => {});
    throw error;
  }
}

async function loadGatewayConfig() {
  setStatus('Loading gateway config\u2026');
  try {
    const data = await api('/api/gateway/config');
    $('gateway-config-path').textContent = data.configPath || '';
    const badge = $('gateway-config-badge');
    if (data.exists) {
      badge.textContent = 'exists';
      badge.className = 'badge badge-exists';
    } else {
      badge.textContent = 'not found';
      badge.className = 'badge badge-missing';
    }
    const cfg = data.config || {};
    const acp = cfg.acp || {};
    const discord = cfg.discord || {};
    const telegram = cfg.telegram || {};
    const ws = cfg.workspaces || {};
    $('gateway-mode').value = cfg.mode || 'auto';
    $('gateway-acp-host').value = acp.host || '127.0.0.1';
    $('gateway-acp-port').value = String(acp.port || 3000);
    $('gateway-discord-guild').value = discord.guildId || '';
    $('gateway-discord-channel').value = discord.channelId || '';
    $('gateway-discord-users').value = (discord.allowlistedUserIds || []).join(', ');
    $('gateway-discord-perms-channel').value = discord.permissionsChannelId || '';
    $('gateway-telegram-users').value = (telegram.allowlistedUserIds || []).join(', ');
    // Restore checked roots from saved config
    gatewayAllowedRoots = new Set(ws.allowedRoots || []);
    gatewayActiveRoot = ws.activeRoot || '';
    if (gatewayAllowedRoots.size > 0) renderGatewayRepoList(null);
    setStatus('Gateway config loaded.');
  } catch (e) {
    setStatus('Error loading gateway config: ' + e.message);
  }
}

function renderGatewayRepoList(scanData) {
  if (scanData !== null) gatewayScanResults = scanData;
  const container = $('gateway-repo-list');
  container.textContent = '';
  const displayedPaths = new Set();

  if (gatewayScanResults && gatewayScanResults.roots && gatewayScanResults.roots.length) {
    for (const root of gatewayScanResults.roots) {
      const heading = document.createElement('div');
      heading.className = 'gateway-scan-root muted';
      heading.textContent = root.scanRoot;
      container.appendChild(heading);
      for (const repo of root.repos) {
        displayedPaths.add(repo.absPath);
        appendRepoCheckbox(container, repo.absPath, repo.name, gatewayAllowedRoots.has(repo.absPath));
      }
    }
  }

  const orphans = [...gatewayAllowedRoots].filter((p) => !displayedPaths.has(p));
  if (orphans.length) {
    const heading = document.createElement('div');
    heading.className = 'gateway-scan-root muted';
    heading.textContent = '\u2014 Previously saved (not in scan) \u2014';
    container.appendChild(heading);
    for (const p of orphans) appendRepoCheckbox(container, p, p, true);
  }

  if (!container.children.length) {
    const d = document.createElement('div');
    d.className = 'muted';
    d.textContent = '(no repos found \u2014 click Scan repos above)';
    container.appendChild(d);
  }
  refreshActiveRootSelect();
}

function appendRepoCheckbox(container, absPath, label, checked) {
  const row = document.createElement('label');
  row.className = 'repo-row';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = absPath;
  cb.checked = checked;
  cb.addEventListener('change', () => {
    if (cb.checked) {
      gatewayAllowedRoots.add(absPath);
    } else {
      gatewayAllowedRoots.delete(absPath);
      if (gatewayActiveRoot === absPath) gatewayActiveRoot = '';
    }
    refreshActiveRootSelect();
  });
  const span = document.createElement('span');
  span.textContent = label;
  row.appendChild(cb);
  row.appendChild(span);
  container.appendChild(row);
}

function refreshActiveRootSelect() {
  const sel = $('gateway-active-root');
  const prev = sel.value || gatewayActiveRoot;
  sel.textContent = '';
  const roots = [...gatewayAllowedRoots];
  if (!roots.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(check repos above first)';
    sel.appendChild(opt);
    gatewayActiveRoot = '';
    return;
  }
  for (const r of roots) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  }
  if (roots.includes(prev)) {
    sel.value = prev;
    gatewayActiveRoot = prev;
  } else {
    sel.value = roots[0];
    gatewayActiveRoot = roots[0];
  }
}

async function scanGatewayRepos(extraPath) {
  setStatus('Scanning repos\u2026');
  try {
    const url = extraPath ? `/api/gateway/scan-repos?extra=${encodeURIComponent(extraPath)}` : '/api/gateway/scan-repos';
    const data = await api(url);
    const total = (data.roots || []).reduce((acc, r) => acc + (r.repos || []).length, 0);
    renderGatewayRepoList(data);
    setStatus(`Found ${total} repo(s) across ${(data.roots || []).length} scan root(s).`);
  } catch (e) {
    setStatus('Scan error: ' + e.message);
  }
}

async function saveGatewayConfig() {
  const mode = $('gateway-mode').value || 'auto';
  const acpHost = $('gateway-acp-host').value.trim() || '127.0.0.1';
  const acpPort = parseInt($('gateway-acp-port').value, 10) || 3000;
  const guildId = $('gateway-discord-guild').value.trim();
  const channelId = $('gateway-discord-channel').value.trim();
  const usersRaw = $('gateway-discord-users').value.trim();
  const permsChannel = $('gateway-discord-perms-channel').value.trim();
  const telegramUsersRaw = $('gateway-telegram-users').value.trim();
  const activeRoot = $('gateway-active-root').value || gatewayActiveRoot;
  const allowlistedUserIds = usersRaw ? usersRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const telegramAllowlistedUserIds = telegramUsersRaw ? telegramUsersRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const allowedRoots = [...gatewayAllowedRoots];
  const statusEl = $('gateway-status');

  const hasAnyDiscordInput = Boolean(guildId || channelId || usersRaw || permsChannel);
  const includeDiscord = hasAnyDiscordInput && guildId && channelId && allowlistedUserIds.length > 0;
  const includeTelegram = telegramAllowlistedUserIds.length > 0;

  if (hasAnyDiscordInput && (!guildId || !channelId)) {
    statusEl.textContent = 'Validation error: Discord Guild ID and Channel ID are required when Discord is configured.';
    statusEl.className = 'pre';
    return;
  }
  if (hasAnyDiscordInput && !allowlistedUserIds.length) {
    statusEl.textContent = 'Validation error: At least one Discord User ID is required when Discord is configured.';
    statusEl.className = 'pre';
    return;
  }
  if (!includeDiscord && !includeTelegram) {
    statusEl.textContent = 'Validation error: Configure at least one platform (Discord or Telegram).';
    statusEl.className = 'pre';
    return;
  }
  if (!allowedRoots.length) {
    statusEl.textContent = 'Validation error: Select at least one workspace root.';
    statusEl.className = 'pre';
    return;
  }
  if (!activeRoot) {
    statusEl.textContent = 'Validation error: Select an active workspace root.';
    statusEl.className = 'pre';
    return;
  }

  const body = {
    mode,
    acp: { host: acpHost, port: acpPort },
    ...(includeDiscord
      ? {
        discord: {
          allowlistedUserIds,
          guildId,
          channelId,
          ...(permsChannel ? { permissionsChannelId: permsChannel } : {}),
        },
      }
      : {}),
    ...(includeTelegram
      ? {
        telegram: {
          allowlistedUserIds: telegramAllowlistedUserIds,
        },
      }
      : {}),
    workspaces: { allowedRoots, activeRoot },
  };

  setStatus('Saving gateway config\u2026');
  try {
    const r = await api('/api/gateway/config', { method: 'POST', body: JSON.stringify(body) });
    statusEl.textContent = `Saved \u2192 ${r.configPath}`;
    statusEl.className = 'pre status-saved';
    await loadGatewayConfig();
    await refreshGatewayState({ setStatusMessage: false }).catch(() => {});
    setStatus('Gateway config saved.');
  } catch (e) {
    statusEl.textContent = 'Save error: ' + e.message;
    statusEl.className = 'pre';
    setStatus('Failed to save gateway config.');
  }
}

function getPlanningSelectedScopes() {
  const scopes = [];
  if ($('planning-scope-user') && $('planning-scope-user').checked) scopes.push('user');
  if ($('planning-scope-repo') && $('planning-scope-repo').checked) scopes.push('repo');
  if ($('planning-scope-global') && $('planning-scope-global').checked) scopes.push('global');
  return scopes;
}

function normalizePlanningScopeList(values) {
  const list = Array.isArray(values) ? values : [];
  const accepted = new Set();
  for (const value of list) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!PLANNING_CONTEXT_SCOPE_ORDER.includes(normalized)) continue;
    accepted.add(normalized);
  }
  return PLANNING_CONTEXT_SCOPE_ORDER.filter((scope) => accepted.has(scope));
}

function normalizePlanningContextField(value) {
  const normalized = String(value == null ? '' : value).trim();
  if (!normalized) return '';
  return normalized.slice(0, PLANNING_CONTEXT_FIELD_MAX_LENGTH);
}

function normalizePlanningContextSnapshot(input = {}, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const scopeSpecified = typeof options.scopeSpecified === 'boolean'
    ? options.scopeSpecified
    : Object.prototype.hasOwnProperty.call(source, 'scopes');

  return {
    userId: normalizePlanningContextField(source.userId),
    repoId: normalizePlanningContextField(source.repoId),
    query: normalizePlanningContextField(source.query),
    sessionId: normalizePlanningContextField(source.sessionId),
    scopes: normalizePlanningScopeList(source.scopes),
    scopeSpecified,
  };
}

function stripPlanningContextMeta(context = {}) {
  return {
    userId: normalizePlanningContextField(context.userId),
    repoId: normalizePlanningContextField(context.repoId),
    query: normalizePlanningContextField(context.query),
    sessionId: normalizePlanningContextField(context.sessionId),
    scopes: normalizePlanningScopeList(context.scopes),
  };
}

function mergePlanningContextSnapshots(sources, options = {}) {
  const normalizedSources = Array.isArray(sources)
    ? sources.map((entry) => {
      const explicitScopeSpecified = entry && typeof entry === 'object' && typeof entry.scopeSpecified === 'boolean'
        ? entry.scopeSpecified
        : undefined;
      return normalizePlanningContextSnapshot(entry, { scopeSpecified: explicitScopeSpecified });
    })
    : [];
  const merged = {
    userId: '',
    repoId: '',
    query: '',
    sessionId: '',
    scopes: [],
    scopeSpecified: false,
  };

  for (const field of ['userId', 'repoId', 'query', 'sessionId']) {
    for (const source of normalizedSources) {
      const value = normalizePlanningContextField(source[field]);
      if (!value) continue;
      merged[field] = value;
      break;
    }
  }

  for (const source of normalizedSources) {
    if (!source.scopeSpecified) continue;
    merged.scopes = normalizePlanningScopeList(source.scopes);
    merged.scopeSpecified = true;
    break;
  }

  if (!merged.scopeSpecified) {
    merged.scopes = normalizePlanningScopeList(options.defaultScopes);
  }

  return merged;
}

function readPlanningContextFromUrlSearch(search) {
  const queryString = typeof search === 'string'
    ? search
    : (hasDom && window && window.location ? window.location.search : '');
  const params = new URLSearchParams(queryString || '');
  return normalizePlanningContextSnapshot({
    userId: params.get('userId') || '',
    repoId: params.get('repoId') || '',
    query: params.get('q') || params.get('query') || '',
    sessionId: params.get('sessionId') || '',
    scopes: params.getAll('scope'),
  }, {
    scopeSpecified: params.has('scope'),
  });
}

function getPlanningContextStorage(storage) {
  if (storage) return storage;
  if (!hasDom) return null;
  try {
    return window && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readPlanningContextFromStorage(options = {}) {
  const storage = getPlanningContextStorage(options.storage);
  if (!storage || typeof storage.getItem !== 'function') return null;

  try {
    const raw = storage.getItem(PLANNING_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const context = parsed.context && typeof parsed.context === 'object' ? parsed.context : parsed;
    return normalizePlanningContextSnapshot(context, {
      scopeSpecified: Object.prototype.hasOwnProperty.call(context, 'scopes'),
    });
  } catch {
    return null;
  }
}

function persistPlanningContextSnapshot(context, options = {}) {
  const storage = getPlanningContextStorage(options.storage);
  if (!storage || typeof storage.setItem !== 'function') return false;

  try {
    const snapshot = stripPlanningContextMeta(context);
    storage.setItem(PLANNING_CONTEXT_STORAGE_KEY, JSON.stringify({
      contractVersion: PLANNING_CONTEXT_RESTORE_CONTRACT_VERSION,
      deterministic: true,
      context: snapshot,
    }));
    return true;
  } catch {
    return false;
  }
}

function resolvePlanningContextRestore(input = {}) {
  const uiContext = normalizePlanningContextSnapshot(input.uiContext || {}, { scopeSpecified: true });
  const urlScopeSpecified = input.urlContext && typeof input.urlContext.scopeSpecified === 'boolean'
    ? input.urlContext.scopeSpecified
    : undefined;
  const storedScopeSpecified = input.storedContext && typeof input.storedContext.scopeSpecified === 'boolean'
    ? input.storedContext.scopeSpecified
    : undefined;
  const urlContext = normalizePlanningContextSnapshot(input.urlContext || {}, {
    scopeSpecified: urlScopeSpecified,
  });
  const storedContext = normalizePlanningContextSnapshot(input.storedContext || {}, {
    scopeSpecified: storedScopeSpecified,
  });

  const merged = mergePlanningContextSnapshots([
    urlContext,
    storedContext,
    uiContext,
  ], {
    defaultScopes: uiContext.scopes,
  });

  return {
    contractVersion: PLANNING_CONTEXT_RESTORE_CONTRACT_VERSION,
    deterministic: true,
    precedence: ['url', 'storage', 'ui'],
    context: stripPlanningContextMeta(merged),
  };
}

function applyPlanningContextToUi(context) {
  if (!hasDom) return;
  const normalized = stripPlanningContextMeta(context);

  if ($('planning-user-id')) $('planning-user-id').value = normalized.userId;
  if ($('planning-repo-id')) $('planning-repo-id').value = normalized.repoId;
  if ($('planning-query')) $('planning-query').value = normalized.query;
  if ($('planning-session-id')) $('planning-session-id').value = normalized.sessionId;

  const scopeSet = new Set(normalized.scopes);
  if ($('planning-scope-user')) $('planning-scope-user').checked = scopeSet.has('user');
  if ($('planning-scope-repo')) $('planning-scope-repo').checked = scopeSet.has('repo');
  if ($('planning-scope-global')) $('planning-scope-global').checked = scopeSet.has('global');
}

function restorePlanningContextAfterReload(options = {}) {
  if (!hasDom) {
    return resolvePlanningContextRestore({
      uiContext: { scopes: [] },
      urlContext: null,
      storedContext: null,
    });
  }

  const storage = getPlanningContextStorage(options.storage);
  const restore = resolvePlanningContextRestore({
    uiContext: readPlanningContextFromUi(),
    urlContext: readPlanningContextFromUrlSearch(options.search),
    storedContext: readPlanningContextFromStorage({ storage }),
  });

  applyPlanningContextToUi(restore.context);
  persistPlanningContextSnapshot(restore.context, { storage });
  return restore;
}

function bindPlanningContextPersistence() {
  if (!hasDom) return;
  const ids = [
    'planning-user-id',
    'planning-repo-id',
    'planning-query',
    'planning-session-id',
    'planning-scope-user',
    'planning-scope-repo',
    'planning-scope-global',
  ];

  const persist = () => {
    persistPlanningContextSnapshot(readPlanningContextFromUi());
  };

  for (const id of ids) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('input', persist);
    el.addEventListener('change', persist);
  }
}

function readPlanningContextFromUi() {
  return stripPlanningContextMeta({
    userId: String(($('planning-user-id') && $('planning-user-id').value) || '').trim(),
    repoId: String(($('planning-repo-id') && $('planning-repo-id').value) || '').trim(),
    query: String(($('planning-query') && $('planning-query').value) || '').trim(),
    sessionId: String(($('planning-session-id') && $('planning-session-id').value) || '').trim(),
    scopes: getPlanningSelectedScopes(),
  });
}

function normalizePlanningRecordSummary(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .trim();
}

function planningCreateHasTitle() {
  const titleEl = $('planning-create-title');
  return Boolean(titleEl && String(titleEl.value || '').trim());
}

function refreshPlanningCreateControls() {
  const createButton = $('btn-planning-create');
  if (!createButton) return;
  createButton.disabled = policyGateBlocked || !planningCreateHasTitle();
}

function nextPlanningIdempotencyKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPlanningQueryString(context, options = {}) {
  const params = new URLSearchParams();
  if (context.userId) params.set('userId', context.userId);
  if (context.repoId) params.set('repoId', context.repoId);
  for (const scope of context.scopes || []) params.append('scope', scope);
  if (options.query) params.set('q', options.query);
  if (Number.isFinite(options.limit)) params.set('limit', String(options.limit));
  return params.toString();
}

function setPlanningOutput(value, muted = false) {
  const out = $('planning-output');
  if (!out) return;
  out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  out.classList.toggle('muted', Boolean(muted));
}

function renderPlanningGate() {
  const badge = $('planning-gate-badge');
  const detail = $('planning-gate-detail');
  if (!badge || !detail) return;

  const state = normalizePlanningGateState(planningViewState.gateState);
  badge.textContent = state;
  badge.className = `badge ${planningGateBadgeClass(state)}`;
  detail.textContent = planningViewState.gateReason || state;
}

function renderPlanningRecords() {
  const container = $('planning-records');
  if (!container) return;
  container.textContent = '';
  container.classList.remove('muted');

  const records = Array.isArray(planningViewState.records) ? planningViewState.records : [];
  for (const record of records) {
    const row = document.createElement('div');
    row.className = 'item';
    const title = String(record.title || record.recordId || '(untitled)');
    const sub = [record.recordId, record.scope, record.state, fmtTime(parseIsoMs(record.updatedAt || record.createdAt))]
      .filter(Boolean)
      .join(' • ');
    row.innerHTML = '<div class="item-title"></div><div class="item-sub muted"></div>';
    row.querySelector('.item-title').textContent = title;
    row.querySelector('.item-sub').textContent = sub;
    container.appendChild(row);
  }

  if (!records.length) {
    container.classList.add('muted');
    container.textContent = '(none)';
  }
}

function renderPlanningSearchResults() {
  const container = $('planning-search-results');
  if (!container) return;
  container.textContent = '';
  container.classList.remove('muted');

  const results = Array.isArray(planningViewState.searchResults) ? planningViewState.searchResults : [];
  for (const entry of results) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<div class="item-title"></div><div class="item-sub muted"></div>';
    row.querySelector('.item-title').textContent = `${entry.rank || '?'} • ${entry.recordId || '(unknown)'}`;
    row.querySelector('.item-sub').textContent = [entry.scope, entry.status, `score=${entry.score}`].filter(Boolean).join(' • ');
    container.appendChild(row);
  }

  if (!results.length) {
    container.classList.add('muted');
    container.textContent = '(none)';
  }
}

function renderPlanningCompare() {
  const compareContainer = $('planning-compare-matches');
  const sourceContainer = $('planning-source-markers');
  const deniedScopes = $('planning-denied-scopes');
  const mergeTarget = $('planning-merge-target');
  const compare = planningViewState.compareResponse;

  if (!compareContainer || !sourceContainer || !deniedScopes || !mergeTarget) return;

  compareContainer.textContent = '';
  sourceContainer.textContent = '';
  mergeTarget.textContent = '';

  if (!compare) {
    compareContainer.classList.add('muted');
    compareContainer.textContent = '(none)';
    sourceContainer.classList.add('muted');
    sourceContainer.textContent = '(none)';
    deniedScopes.textContent = '(none)';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(compare first)';
    mergeTarget.appendChild(opt);
    return;
  }

  const matches = Array.isArray(compare.matches) ? compare.matches : [];
  compareContainer.classList.remove('muted');
  for (const entry of matches) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<div class="item-title"></div><div class="item-sub muted"></div>';
    row.querySelector('.item-title').textContent = `${entry.rank || '?'} • ${entry.recordId || '(unknown)'}`;
    row.querySelector('.item-sub').textContent = [entry.scope, entry.status, `score=${entry.score}`].filter(Boolean).join(' • ');
    compareContainer.appendChild(row);
  }
  if (!matches.length) {
    compareContainer.classList.add('muted');
    compareContainer.textContent = '(none)';
  }

  const markers = compare.implementedOutcomes && Array.isArray(compare.implementedOutcomes.sources)
    ? compare.implementedOutcomes.sources
    : [];
  sourceContainer.classList.remove('muted');
  for (const marker of markers) {
    const row = document.createElement('div');
    row.className = 'item';
    row.innerHTML = '<div class="item-title"></div><div class="item-sub muted"></div>';
    row.querySelector('.item-title').textContent = `${marker.sourceId || '(unknown)'} • ${marker.status || 'unavailable'}`;
    row.querySelector('.item-sub').textContent = [marker.sourceType, marker.reason, marker.path].filter(Boolean).join(' • ');
    sourceContainer.appendChild(row);
  }
  if (!markers.length) {
    sourceContainer.classList.add('muted');
    sourceContainer.textContent = '(none)';
  }

  const denied = Array.isArray(compare.deniedScopes) ? compare.deniedScopes : [];
  deniedScopes.textContent = denied.length ? denied.join(', ') : '(none)';

  const previousTarget = mergeTarget.value;
  const candidateTargets = [...new Set(matches.map((entry) => String(entry.recordId || '').trim()).filter(Boolean))];
  if (!candidateTargets.length && Array.isArray(compare.planningRecords)) {
    candidateTargets.push(...compare.planningRecords.map((record) => String(record && record.recordId || '').trim()).filter(Boolean));
  }

  if (!candidateTargets.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no target available)';
    mergeTarget.appendChild(opt);
  } else {
    for (const targetId of candidateTargets) {
      const opt = document.createElement('option');
      opt.value = targetId;
      opt.textContent = targetId;
      mergeTarget.appendChild(opt);
    }
    if (candidateTargets.includes(previousTarget)) {
      mergeTarget.value = previousTarget;
    }
  }
}

function renderPlanningConflictRows() {
  const body = $('planning-conflict-rows');
  if (!body) return;
  body.textContent = '';

  const rows = Array.isArray(planningViewState.conflicts) ? planningViewState.conflicts : [];
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'muted';
    td.textContent = '(no precedence conflicts)';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    const userValue = row.valuesByScope && row.valuesByScope.user ? row.valuesByScope.user.value : '—';
    const repoValue = row.valuesByScope && row.valuesByScope.repo ? row.valuesByScope.repo.value : '—';
    const globalValue = row.valuesByScope && row.valuesByScope.global ? row.valuesByScope.global.value : '—';
    const winnerText = `${row.winnerScope} (${row.winnerRecordId})`;

    const cells = [
      row.field,
      userValue,
      repoValue,
      globalValue,
      winnerText,
    ];

    for (const cellValue of cells) {
      const td = document.createElement('td');
      td.textContent = cellValue;
      tr.appendChild(td);
    }

    const reviewedTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = planningViewState.reviewedConflictKeys.has(row.conflictKey);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        planningViewState.reviewedConflictKeys.add(row.conflictKey);
      } else {
        planningViewState.reviewedConflictKeys.delete(row.conflictKey);
      }
      refreshPlanningMergeControls();
    });
    reviewedTd.appendChild(checkbox);
    tr.appendChild(reviewedTd);

    body.appendChild(tr);
  }
}

function renderPlanningIntent() {
  const pre = $('planning-intent');
  if (!pre) return;

  if (!planningViewState.intentToken) {
    pre.classList.add('muted');
    pre.textContent = '(no intent token)';
    return;
  }

  pre.classList.remove('muted');
  pre.textContent = JSON.stringify(planningViewState.intentToken, null, 2);
}

function refreshPlanningMergeControls() {
  const mergeButton = $('btn-planning-merge');
  const requirements = $('planning-merge-requirements');
  if (!mergeButton || !requirements) return;

  const gateAllowsMerge = isMergeEnabled(planningViewState.gateState);
  const hasIntent = Boolean(planningViewState.intentToken);
  const reviewedConflicts = hasReviewedAllConflicts(planningViewState.conflicts, planningViewState.reviewedConflictKeys);
  const canMerge = gateAllowsMerge && hasIntent && reviewedConflicts && !policyGateBlocked;

  mergeButton.disabled = !canMerge;

  if (!gateAllowsMerge) {
    requirements.textContent = `Merge disabled: gate state is ${planningViewState.gateState}.`;
    return;
  }
  if (!reviewedConflicts) {
    requirements.textContent = 'Merge disabled: review every conflict row before confirmation.';
    return;
  }
  if (!hasIntent) {
    requirements.textContent = 'Merge disabled: prepare an intent token first.';
    return;
  }
  if (policyGateBlocked) {
    requirements.textContent = `Merge disabled: policy gate active (${policyGateReason || 'blocked'}).`;
    return;
  }

  requirements.textContent = 'Merge ready: pass gate, reviewed conflicts, and valid intent token.';
}

function renderPlanningView() {
  if (!hasDom) return;
  renderPlanningGate();
  renderPlanningRecords();
  renderPlanningSearchResults();
  renderPlanningCompare();
  renderPlanningConflictRows();
  renderPlanningIntent();
  refreshPlanningMergeControls();
}

async function listPlanningRecords() {
  const context = readPlanningContextFromUi();
  setStatus('Loading planning records…');

  try {
    const query = buildPlanningQueryString(context);
    const data = await api(`/api/planning/records${query ? `?${query}` : ''}`);
    planningViewState.records = Array.isArray(data.records) ? data.records : [];

    const deniedScopes = Array.isArray(data.deniedScopes) ? data.deniedScopes : [];
    const deniedEl = $('planning-denied-scopes');
    if (deniedEl) deniedEl.textContent = deniedScopes.length ? deniedScopes.join(', ') : '(none)';

    setPlanningOutput(data, false);
    renderPlanningView();
    setStatus('Planning records loaded.');
  } catch (error) {
    const parsed = parsePlanningApiError(error);
    const gate = mapPlanningGateState({
      policyGateBlocked,
      httpStatus: parsed.httpStatus,
      errorCode: parsed.errorCode,
      reason: parsed.reason,
      requestedScopes: context.scopes,
      deniedScopes: parsed.body && Array.isArray(parsed.body.deniedScopes) ? parsed.body.deniedScopes : [],
    });
    planningViewState.gateState = gate.state;
    planningViewState.gateReason = gate.reason;
    setPlanningOutput({ error: parsed }, false);
    renderPlanningView();
    setStatus(`Planning records failed: ${parsed.reason}`);
  }
}

async function searchPlanningRecords() {
  const context = readPlanningContextFromUi();
  setStatus('Searching planning records…');

  try {
    const query = buildPlanningQueryString(context, {
      query: context.query,
      limit: 20,
    });
    const data = await api(`/api/planning/search${query ? `?${query}` : ''}`);
    planningViewState.searchResults = Array.isArray(data.results) ? data.results : [];
    setPlanningOutput(data, false);
    renderPlanningView();
    setStatus('Planning search completed.');
  } catch (error) {
    const parsed = parsePlanningApiError(error);
    setPlanningOutput({ error: parsed }, false);
    setStatus(`Planning search failed: ${parsed.reason}`);
  }
}

async function comparePlanningRecords() {
  const context = readPlanningContextFromUi();
  setStatus('Comparing planning records…');

  planningViewState.intentToken = null;
  planningViewState.reviewedConflictKeys = new Set();

  try {
    const data = await api('/api/planning/compare', {
      method: 'POST',
      body: JSON.stringify({
        userId: context.userId,
        repoId: context.repoId,
        scopes: context.scopes,
        query: context.query,
        sessionId: context.sessionId || undefined,
        idempotencyKey: nextPlanningIdempotencyKey('planning-compare'),
      }),
    });

    planningViewState.compareResponse = data;
    planningViewState.conflicts = buildPlanningConflictRows(Array.isArray(data.planningRecords) ? data.planningRecords : []);
    planningViewState.reviewedConflictKeys = new Set();

    const compareReceipt = data && typeof data.compareReceipt === 'object'
      ? data.compareReceipt
      : null;

    const gate = mapPlanningGateState({
      gateState: data.gateState || (compareReceipt && compareReceipt.gateState),
      reason: data.reason || (compareReceipt && compareReceipt.reason),
      downgrade: data.downgrade || (compareReceipt && compareReceipt.downgrade),
      policyGateBlocked,
      requestedScopes: Array.isArray(data.requestedScopes) ? data.requestedScopes : context.scopes,
      deniedScopes: Array.isArray(data.deniedScopes) ? data.deniedScopes : [],
      matches: Array.isArray(data.matches) ? data.matches : [],
      sourceMarkers: data.implementedOutcomes && Array.isArray(data.implementedOutcomes.sources)
        ? data.implementedOutcomes.sources
        : [],
      newerDataAvailable: data.newerDataAvailable === true,
    });

    planningViewState.gateState = gate.state;
    planningViewState.gateReason = gate.reason;

    setPlanningOutput(data, false);
    renderPlanningView();
    setStatus(`Planning compare completed (${gate.state}).`);
  } catch (error) {
    const parsed = parsePlanningApiError(error);
    planningViewState.compareResponse = null;
    planningViewState.conflicts = [];
    planningViewState.reviewedConflictKeys = new Set();
    planningViewState.intentToken = null;

    const gate = mapPlanningGateState({
      policyGateBlocked,
      httpStatus: parsed.httpStatus,
      errorCode: parsed.errorCode,
      reason: parsed.reason,
      requestedScopes: context.scopes,
      deniedScopes: parsed.body && Array.isArray(parsed.body.deniedScopes) ? parsed.body.deniedScopes : [],
    });
    planningViewState.gateState = gate.state;
    planningViewState.gateReason = gate.reason;

    setPlanningOutput({ error: parsed }, false);
    renderPlanningView();
    setStatus(`Planning compare failed: ${parsed.reason}`);
  }
}

async function createPlanningRecord() {
  const context = readPlanningContextFromUi();
  const scope = String(($('planning-create-scope') && $('planning-create-scope').value) || 'user').trim();
  const state = String(($('planning-create-state') && $('planning-create-state').value) || 'thought').trim();
  const title = String(($('planning-create-title') && $('planning-create-title').value) || '').trim();
  const summary = normalizePlanningRecordSummary(($('planning-create-summary') && $('planning-create-summary').value) || '');

  if (!title) {
    setStatus('Create record requires a title.');
    return;
  }

  setStatus('Creating planning record…');
  try {
    const data = await api('/api/planning/records', {
      method: 'POST',
      body: JSON.stringify({
        userId: context.userId,
        repoId: context.repoId,
        idempotencyKey: nextPlanningIdempotencyKey('planning-create'),
        scope,
        title,
        summary,
        state,
      }),
    });

    setPlanningOutput(data, false);
    await listPlanningRecords();
    setStatus('Planning record created.');
  } catch (error) {
    const parsed = parsePlanningApiError(error);
    setPlanningOutput({ error: parsed }, false);
    setStatus(`Planning create failed: ${parsed.reason}`);
  }
}

async function preparePlanningMergeIntent() {
  const context = readPlanningContextFromUi();
  if (!planningViewState.compareResponse) {
    setStatus('Prepare intent requires a compare response.');
    return;
  }
  if (!context.userId) {
    setStatus('Prepare intent requires userId.');
    return;
  }

  const targetId = String(($('planning-merge-target') && $('planning-merge-target').value) || '').trim();
  if (!targetId) {
    setStatus('Prepare intent requires a merge target.');
    return;
  }

  const compareReceipt = planningViewState.compareResponse && planningViewState.compareResponse.compareReceipt
    ? planningViewState.compareResponse.compareReceipt
    : null;
  if (!compareReceipt || !compareReceipt.receiptId) {
    setStatus('Prepare intent requires a server compare receipt. Run compare again.');
    return;
  }

  const sourceIds = (Array.isArray(planningViewState.compareResponse.planningRecords)
    ? planningViewState.compareResponse.planningRecords
    : [])
    .map((entry) => String(entry && entry.recordId || '').trim())
    .filter(Boolean);

  setStatus('Preparing planning merge intent…');
  try {
    const response = await api('/api/planning/merge-intent', {
      method: 'POST',
      body: JSON.stringify({
        userId: context.userId,
        repoId: context.repoId,
        compareReceiptId: compareReceipt.receiptId,
        targetId,
        sourceIds,
        ttlMs: PLANNING_INTENT_DEFAULT_TTL_MS,
      }),
    });

    const token = response && response.intentToken ? response.intentToken : null;
    if (!token) {
      throw new Error('merge_intent_token_missing');
    }

    planningViewState.intentToken = token;
    renderPlanningIntent();
    refreshPlanningMergeControls();
    setPlanningOutput({ mergeIntent: response }, false);
    setStatus('Planning merge intent prepared.');
  } catch (error) {
    const parsed = parsePlanningApiError(error);
    setPlanningOutput({ error: parsed }, false);
    setStatus(`Planning intent failed: ${parsed.reason}`);
  }
}

async function confirmPlanningMerge() {
  if (!isMergeEnabled(planningViewState.gateState)) {
    setStatus(`Merge blocked by gate state: ${planningViewState.gateState}`);
    return;
  }

  if (!hasReviewedAllConflicts(planningViewState.conflicts, planningViewState.reviewedConflictKeys)) {
    setStatus('Merge blocked: review all precedence conflicts first.');
    return;
  }

  if (!planningViewState.intentToken) {
    setStatus('Merge blocked: no intent token prepared.');
    return;
  }

  const context = readPlanningContextFromUi();
  const targetId = String(($('planning-merge-target') && $('planning-merge-target').value) || '').trim();
  const compare = planningViewState.compareResponse;
  const compareReceipt = compare && compare.compareReceipt ? compare.compareReceipt : null;
  if (!compareReceipt || !compareReceipt.receiptId) {
    setStatus('Merge blocked: missing compare receipt. Run compare again.');
    return;
  }
  const expectedCompareHash = compareReceipt && compareReceipt.compareHash
    ? String(compareReceipt.compareHash)
    : buildCompareSnapshotHash(compare);
  const sourceIds = (Array.isArray(compare && compare.planningRecords) ? compare.planningRecords : [])
    .map((entry) => String(entry && entry.recordId || '').trim())
    .filter(Boolean);
  const expectedSourceIdsHash = compareReceipt && compareReceipt.sourceIdsHash
    ? String(compareReceipt.sourceIdsHash)
    : buildSourceIdsHash(sourceIds);

  const validation = validatePlanningIntentToken(planningViewState.intentToken, {
    nowMs: Date.now(),
    actorId: context.userId,
    targetId,
    compareHash: expectedCompareHash,
    sourceIdsHash: expectedSourceIdsHash,
    expectedVersionVector: compare && compare.versionVector ? compare.versionVector.pinned || null : null,
  });

  if (!validation.ok) {
    setPlanningOutput({ mergeRejected: validation.error }, false);
    setStatus(`Merge rejected: ${validation.error.reason}`);
    return;
  }

  const winnerSummary = planningViewState.conflicts.length
    ? planningViewState.conflicts
      .map((row) => `${row.field}=${row.winnerScope}`)
      .join(', ')
    : 'no precedence conflicts';

  setStatus('Confirming planning merge…');
  const response = await api('/api/planning/merge', {
    method: 'POST',
    body: JSON.stringify({
      userId: context.userId,
      repoId: context.repoId,
      idempotencyKey: `merge-${validation.value.tokenId}`,
      compareReceiptId: compareReceipt && compareReceipt.receiptId ? compareReceipt.receiptId : '',
      tokenId: validation.value.tokenId,
      targetId: validation.value.targetId,
      compareHash: validation.value.compareHash,
      sourceIdsHash: validation.value.sourceIdsHash,
      sourceIds,
      versionVector: compare && compare.versionVector ? compare.versionVector.pinned || null : null,
      conflictSummary: winnerSummary,
    }),
  });

  planningViewState.intentToken = {
    ...planningViewState.intentToken,
    consumedAt: response && response.mergeEvent && response.mergeEvent.consumedAt
      ? response.mergeEvent.consumedAt
      : new Date().toISOString(),
  };
  renderPlanningIntent();
  refreshPlanningMergeControls();

  setPlanningOutput({ mergeAccepted: response }, false);
  await listPlanningRecords();
  setStatus('Planning merge confirmed and recorded.');
}

function bindUi() {
  $('tab-sessions').addEventListener('click', () => switchTab('sessions'));
  $('tab-sandboxes').addEventListener('click', () => switchTab('sandboxes'));
  $('tab-assets').addEventListener('click', () => switchTab('assets'));
  $('tab-lsp').addEventListener('click', () => switchTab('lsp'));
  $('btn-reload').addEventListener('click', () => window.location.reload());

  $('btn-refresh-sessions').addEventListener('click', () => loadSessions().catch((e) => setStatus(e.message)));

  $('tab-sessions-all').addEventListener('click', () => setSessionsSource('all'));
  $('tab-sessions-cli').addEventListener('click', () => setSessionsSource('cli'));
  $('tab-sessions-vscode').addEventListener('click', () => setSessionsSource('vscode'));
  $('tab-sessions-sandbox').addEventListener('click', () => setSessionsSource('sandbox'));

  $('btn-refresh-sandboxes').addEventListener('click', () => loadSandboxes().catch((e) => setStatus(e.message)));
  $('btn-sandbox-create').addEventListener('click', async () => {
    const sandboxInput = $('sandbox-id');
    const payload = buildCreateSandboxPayload(sandboxInput && sandboxInput.value);
    const sandboxId = payload && payload.sandboxId ? payload.sandboxId : null;
    try {
      await runSandboxLifecycleAction('create', payload, sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Sandbox create failed: ${formatActionFailureSummary(failure)}`);
    }
  });
  $('btn-sandbox-start').addEventListener('click', async () => {
    const sandboxId = requireSandboxId('start');
    if (!sandboxId) return;
    try {
      await runSandboxLifecycleAction('start', { sandboxId }, sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Sandbox start failed: ${formatActionFailureSummary(failure)}`);
    }
  });
  $('btn-sandbox-stop').addEventListener('click', async () => {
    const sandboxId = requireSandboxId('stop');
    if (!sandboxId) return;
    try {
      await runSandboxLifecycleAction('stop', { sandboxId }, sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Sandbox stop failed: ${formatActionFailureSummary(failure)}`);
    }
  });
  $('btn-sandbox-open-terminal').addEventListener('click', async () => {
    const sandboxId = requireSandboxId('open-terminal');
    if (!sandboxId) return;
    try {
      await runSandboxLifecycleAction('open-terminal', { sandboxId }, sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Sandbox open-terminal failed: ${formatActionFailureSummary(failure)}`);
    }
  });
  $('btn-sandbox-follow').addEventListener('click', async () => {
    const sandboxId = requireSandboxId('follow');
    if (!sandboxId) return;
    try {
      await followSandboxSession(sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Follow failed: ${formatActionFailureSummary(failure)}`);
    }
  });
  $('btn-sandbox-pr-open').addEventListener('click', async () => {
    const sandboxId = requireSandboxId('pr-open');
    if (!sandboxId) return;

    const baseBranch = String(($('sandbox-base-branch') && $('sandbox-base-branch').value) || '').trim();
    const headBranch = String(($('sandbox-head-branch') && $('sandbox-head-branch').value) || '').trim();
    if (!baseBranch || !headBranch) {
      setStatus('Sandbox pr-open requires baseBranch and headBranch.');
      return;
    }

    try {
      await runSandboxLifecycleAction('pr-open', { sandboxId, baseBranch, headBranch }, sandboxId);
    } catch (e) {
      const failure = (e && e.actionFailure) || parseActionFailureDetails(e);
      setStatus(`Sandbox pr-open failed: ${formatActionFailureSummary(failure)}`);
    }
  });

  $('btn-archive-session').addEventListener('click', async () => {
    if (!selectedSession || !selectedSession.id) return;
    const id = encodeURIComponent(selectedSession.id);
    const src = encodeURIComponent(String(resolveSessionSource(selectedSession)));
    const ok = window.confirm(`Archive session ${selectedSession.id} (${src})?`);
    if (!ok) return;
    setStatus(`Archiving ${selectedSession.id}…`);
    await api(`/api/sessions/${id}/archive?source=${src}`, { method: 'POST', body: JSON.stringify({}) });
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    await loadSessions();
    setStatus('Session archived.');
  });

  $('btn-delete-session').addEventListener('click', async () => {
    if (!selectedSession || !selectedSession.id) return;
    const id = encodeURIComponent(selectedSession.id);
    const src = encodeURIComponent(String(resolveSessionSource(selectedSession)));
    const ok = window.confirm(
      `Delete session ${selectedSession.id} (${src}) permanently?\n\nThis cannot be undone.`
    );
    if (!ok) return;
    setStatus(`Deleting ${selectedSession.id}…`);
    await api(`/api/sessions/${id}/delete?source=${src}`, { method: 'POST', body: JSON.stringify({ force: true }) });
    selectedSession = null;
    $('btn-archive-session').disabled = true;
    $('btn-delete-session').disabled = true;
    await loadSessions();
    setStatus('Session deleted.');
  });

  $('btn-refresh-managed').addEventListener('click', () => loadManaged().catch((e) => setStatus(e.message)));
  $('btn-refresh-installed').addEventListener('click', () => loadInstalled().catch((e) => setStatus(e.message)));
  $('btn-refresh-all').addEventListener('click', async () => {
    try {
      await Promise.all([loadManaged(), loadInstalled(), loadSessions()]);
    } catch (e) {
      setStatus(e.message);
    }
  });
  $('btn-sync-all').addEventListener('click', () => syncAll().catch((e) => setStatus(e.message)));
  $('btn-fresh-all').addEventListener('click', () => freshAll().catch((e) => setStatus(e.message)));
  $('btn-patch-vscode-settings').addEventListener('click', () => patchVscodeSettings().catch((e) => setStatus(e.message)));
  $('btn-copilot-authorize').addEventListener('click', () => authorizeCopilotFolders().catch((e) => setStatus(e.message)));

  $('btn-refresh-lsp').addEventListener('click', () => loadLspConfig().catch((e) => setStatus(e.message)));
  $('btn-install-lsp').addEventListener('click', () => installLsp().catch((e) => setStatus(e.message)));

  $('tab-tracker').addEventListener('click', () => switchTab('tracker'));
  $('btn-refresh-tracker').addEventListener('click', () => loadTracker().catch((e) => setStatus(e.message)));

  $('tab-planning').addEventListener('click', () => switchTab('planning'));
  $('btn-planning-list').addEventListener('click', () => listPlanningRecords().catch((e) => setStatus(e.message)));
  $('btn-planning-search').addEventListener('click', () => searchPlanningRecords().catch((e) => setStatus(e.message)));
  $('btn-planning-compare').addEventListener('click', () => comparePlanningRecords().catch((e) => setStatus(e.message)));
  $('btn-planning-create').addEventListener('click', () => createPlanningRecord().catch((e) => setStatus(e.message)));
  if ($('planning-create-title')) {
    $('planning-create-title').addEventListener('input', refreshPlanningCreateControls);
    $('planning-create-title').addEventListener('change', refreshPlanningCreateControls);
  }
  refreshPlanningCreateControls();
  $('btn-planning-prepare-intent').addEventListener('click', () => preparePlanningMergeIntent().catch((e) => {
    const parsed = parsePlanningApiError(e);
    setPlanningOutput({ error: parsed }, false);
    setStatus(`Planning intent failed: ${parsed.reason}`);
  }));
  $('btn-planning-merge').addEventListener('click', () => confirmPlanningMerge().catch((e) => {
    const parsed = parsePlanningApiError(e);
    setPlanningOutput({ error: parsed }, false);
    setStatus(`Planning merge failed: ${parsed.reason}`);
  }));
  bindPlanningContextPersistence();

  $('tab-gateway').addEventListener('click', () => switchTab('gateway'));
  $('tab-skills-preview').addEventListener('click', () => switchTab('skills-preview'));
  $('btn-refresh-skills-preview').addEventListener('click', () => loadSkillsPreview());
  $('skills-preview-search').addEventListener('input', function() {
    const q = this.value.toLowerCase().trim();
    const rows = $('skills-preview-body').querySelectorAll('tr');
    for (const row of rows) {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    }
  });
  $('btn-gateway-scan').addEventListener('click', () => scanGatewayRepos(null).catch((e) => setStatus(e.message)));
  $('btn-gateway-scan-custom').addEventListener('click', () => {
    const extra = $('gateway-custom-path').value.trim();
    scanGatewayRepos(extra || null).catch((e) => setStatus(e.message));
  });
  $('btn-gateway-refresh-state').addEventListener('click', () => {
    refreshGatewayState().catch((e) => setStatus('Failed to load gateway state: ' + e.message));
  });
  $('btn-gateway-connect').addEventListener('click', () => {
    connectGateway().catch(() => {});
  });
  $('btn-planning-persistence-init').addEventListener('click', () => {
    initPlanningPersistence().catch(() => {});
  });
  $('gateway-active-root').addEventListener('change', () => {
    gatewayActiveRoot = $('gateway-active-root').value;
  });
  $('btn-gateway-save').addEventListener('click', () => saveGatewayConfig().catch((e) => {
    $('gateway-status').textContent = 'Error: ' + e.message;
    $('gateway-status').className = 'pre';
    setStatus('Failed to save gateway config.');
  }));
}

async function boot() {
  bindUi();
  restorePlanningContextAfterReload();
  try {
    await api('/api/health');
  } catch {
    setStatus('Server not healthy.');
  }

  await refreshPolicyPreflight(true).catch((e) => {
    policyGateBlocked = true;
    policyGateReason = e.message;
    applyPolicyGateUi();
  });

  await loadSessions().catch((e) => setStatus(e.message));
  await loadManaged().catch((e) => setStatus(e.message));
  await loadInstalled().catch((e) => setStatus(e.message));
  renderPlanningView();

  // Tracker: 3s permission poll fallback when SSE not connected
  setInterval(async () => {
    try {
      if (trackerEventSource && trackerEventSource.readyState === EventSource.OPEN) return; // SSE is delivering, no need to poll
      await loadTrackerPermissions();
    } catch {
      // ignore polling failures
    }
  }, 3000);

  // Best-effort "watch": poll a version counter the server bumps on fs.watch events.
  let lastVersion = null;
  setInterval(async () => {
    try {
      const v = await api('/api/version');
      if (typeof v.version !== 'number') return;
      if (lastVersion == null) {
        lastVersion = v.version;
        return;
      }
      if (v.version === lastVersion) return;
      lastVersion = v.version;
      await Promise.all([loadSessions(), loadManaged(), loadInstalled()]);
    } catch {
      // ignore polling failures (UI stays manual-refreshable)
    }
  }, 2000);

  setInterval(() => {
    refreshPolicyPreflight(false).catch(() => {
      policyGateBlocked = true;
      policyGateReason = 'policy preflight unavailable';
      applyPolicyGateUi();
    });
  }, 5000);
}

const planningTestExports = {
  PLANNING_GATE_STATES,
  normalizePlanningGateState,
  planningGateBadgeClass,
  mapPlanningGateState,
  isMergeEnabled,
  comparePlanningConflictEntries,
  resolveConflictWinner,
  buildPlanningConflictRows,
  hasReviewedAllConflicts,
  normalizePlanningContextSnapshot,
  mergePlanningContextSnapshots,
  resolvePlanningContextRestore,
  restorePlanningContextAfterReload,
  buildCompareSnapshotHash,
  buildSourceIdsHash,
  createPlanningIntentToken,
  validatePlanningIntentToken,
  parseActionFailureDetails,
  formatActionFailureSummary,
  appendActionLog,
  getActionLogEntries,
  resetActionLogEntries,
  runActionWithLog,
  SANDBOX_ID_PATTERN,
  createSandboxDraftId,
  buildCreateSandboxPayload,
  resolveCanonicalSandboxId,
  normalizePlanningRecordSummary,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = planningTestExports;
}

if (hasDom) {
  window.__planningUi = planningTestExports;
  boot();
}

