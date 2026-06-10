'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const repoInventoryService = require('./repoInventoryService');
const { validateDedicatedWorktreePath } = require('./worktreeService');

const STATE_VERSION = 1;
const OBSERVATION_KINDS = new Set(['snapshot', 'interaction', 'state', 'locator', 'note']);
const ANNOTATION_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const CHANGE_REQUEST_STATUSES = new Set(['draft', 'reserved', 'queued', 'completed', 'dismissed']);
const DEFAULT_STATE_LOCK_TIMEOUT_MS = 500;
const DEFAULT_STATE_LOCK_RETRY_DELAY_MS = 10;
const DEFAULT_STATE_LOCK_STALE_MS = 30_000;
const LOCK_WAIT_BUFFER = typeof SharedArrayBuffer === 'function' ? new SharedArrayBuffer(4) : null;
const LOCK_WAIT_VIEW = LOCK_WAIT_BUFFER ? new Int32Array(LOCK_WAIT_BUFFER) : null;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value) {
  const normalized = asTrimmedString(value);
  return normalized || null;
}

function asNonNegativeInteger(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }
  return Math.round(normalized);
}

function asNullableIsoString(value) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return null;
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nowIso(nowFn) {
  return new Date(typeof nowFn === 'function' ? nowFn() : Date.now()).toISOString();
}

function resolveUiRuntimeOverlayStatePath(elegyHome, pathImpl = path) {
  return pathImpl.join(pathImpl.resolve(String(elegyHome || '.')), 'ui-runtime-overlay', 'state.json');
}

function isDirectory(fsImpl, absPath) {
  try {
    return fsImpl.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function writeJsonAtomic(fsImpl, pathImpl, absPath, value) {
  const dirPath = pathImpl.dirname(absPath);
  const tempPath = pathImpl.join(
    dirPath,
    `.${pathImpl.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fsImpl.mkdirSync(dirPath, { recursive: true });
  fsImpl.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fsImpl.renameSync(tempPath, absPath);
}

function sleepSync(delayMs) {
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return;
  }

  if (LOCK_WAIT_VIEW && typeof Atomics.wait === 'function') {
    Atomics.wait(LOCK_WAIT_VIEW, 0, 0, delayMs);
    return;
  }

  const endTime = Date.now() + delayMs;
  while (Date.now() < endTime) {
    // Busy wait only as a last-resort fallback when Atomics.wait is unavailable.
  }
}

function removeDirectorySync(fsImpl, absPath) {
  if (typeof fsImpl.rmSync === 'function') {
    fsImpl.rmSync(absPath, { recursive: true, force: true });
    return;
  }

  try {
    fsImpl.rmdirSync(absPath, { recursive: true });
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function isLockStale(fsImpl, lockPath, staleMs) {
  if (!Number.isFinite(staleMs) || staleMs <= 0) {
    return false;
  }

  try {
    const stat = fsImpl.statSync(lockPath);
    return Date.now() - stat.mtimeMs >= staleMs;
  } catch {
    return false;
  }
}

function acquireDirectoryLock(fsImpl, pathImpl, lockPath, options = {}) {
  const timeoutMs = asNonNegativeInteger(options.timeoutMs) ?? DEFAULT_STATE_LOCK_TIMEOUT_MS;
  const retryDelayMs = asNonNegativeInteger(options.retryDelayMs) ?? DEFAULT_STATE_LOCK_RETRY_DELAY_MS;
  const staleMs = asNonNegativeInteger(options.staleMs) ?? DEFAULT_STATE_LOCK_STALE_MS;
  const startedAt = Date.now();

  fsImpl.mkdirSync(pathImpl.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      fsImpl.mkdirSync(lockPath);
      return () => removeDirectorySync(fsImpl, lockPath);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        throw error;
      }

      if (isLockStale(fsImpl, lockPath, staleMs)) {
        removeDirectorySync(fsImpl, lockPath);
        continue;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw Object.assign(new Error('UI Runtime Overlay state is busy. Try again.'), {
          statusCode: 503,
        });
      }

      sleepSync(retryDelayMs);
    }
  }
}

function createStateShape() {
  return {
    version: STATE_VERSION,
    sessions: [],
  };
}

function createStateLoadError(message, cause) {
  return Object.assign(new Error(message), {
    statusCode: 500,
    cause,
  });
}

function createEntityId(prefix, cryptoImpl = crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    return `${prefix}-${cryptoImpl.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSessionId(cryptoImpl = crypto) {
  return createEntityId('uiro', cryptoImpl);
}

function parseRuntimeUrl(value) {
  const runtimeUrl = asTrimmedString(value);
  if (!runtimeUrl) {
    throw Object.assign(new Error('runtimeUrl is required'), { statusCode: 400 });
  }

  let parsed;
  try {
    parsed = new URL(runtimeUrl);
  } catch {
    throw Object.assign(new Error('runtimeUrl must be a valid http or https URL'), { statusCode: 400 });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('runtimeUrl must use http or https'), { statusCode: 400 });
  }

  return {
    runtimeUrl: parsed.toString(),
    runtimeOrigin: parsed.origin,
  };
}

function isPathInside(parentPath, candidatePath, pathImpl = path) {
  const relativePath = pathImpl.relative(pathImpl.resolve(parentPath), pathImpl.resolve(candidatePath));
  return relativePath === '' || (!relativePath.startsWith('..') && !pathImpl.isAbsolute(relativePath));
}

function normalizeComparablePath(pathImpl, value) {
  const normalized = asTrimmedString(value);
  if (!normalized) {
    return '';
  }
  return pathImpl.resolve(normalized).replace(/\\/g, '/').toLowerCase();
}

function normalizeStatus(value) {
  return asTrimmedString(value) === 'closed' ? 'closed' : 'attached';
}

function normalizePhase(value, status) {
  const normalized = asTrimmedString(value);
  if (normalized) {
    return normalized;
  }
  return status === 'closed' ? 'closed' : 'attached';
}

function normalizeEvidence(value) {
  if (!isObject(value)) {
    return null;
  }
  return clone(value);
}

function normalizeObservationKind(value, fallback = 'note') {
  const normalized = asTrimmedString(value).toLowerCase();
  if (OBSERVATION_KINDS.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeAnnotationStatus(value) {
  const normalized = asTrimmedString(value).toLowerCase();
  return ANNOTATION_STATUSES.has(normalized) ? normalized : 'open';
}

function normalizeChangeRequestStatus(value) {
  const normalized = asTrimmedString(value).toLowerCase();
  return CHANGE_REQUEST_STATUSES.has(normalized) ? normalized : 'draft';
}

function normalizeLocator(value) {
  if (!isObject(value)) {
    return null;
  }

  const locator = {
    selector: asOptionalString(value.selector),
    role: asOptionalString(value.role),
    label: asOptionalString(value.label),
    text: asOptionalString(value.text),
    testId: asOptionalString(value.testId),
    componentName: asOptionalString(value.componentName),
  };

  return Object.values(locator).some(Boolean) ? locator : null;
}

function normalizeInteraction(value) {
  if (!isObject(value)) {
    return null;
  }

  const interaction = {
    action: asOptionalString(value.action),
    outcome: asOptionalString(value.outcome),
    latencyMs: asNonNegativeInteger(value.latencyMs),
  };

  return interaction.action || interaction.outcome || interaction.latencyMs !== null ? interaction : null;
}

function normalizeObservationState(value) {
  if (!isObject(value)) {
    return null;
  }

  const state = {
    kind: asOptionalString(value.kind),
    detail: asOptionalString(value.detail),
  };

  return state.kind || state.detail ? state : null;
}

function normalizeWorktreeRecord(value) {
  if (!isObject(value)) {
    return null;
  }

  const worktreeId = asOptionalString(value.worktreeId || value.id);
  const mode = asOptionalString(value.mode);
  const worktreePath = asOptionalString(value.worktreePath || value.path);
  const status = asOptionalString(value.status);
  const branch = asOptionalString(value.branch);
  const launchBlocked = value.launchBlocked === true
    || (value.launch && value.launch.blocked === true);
  const launchBlockedReason = asOptionalString(
    value.launchBlockedReason
    || (value.launch && value.launch.reason)
  );

  if (!worktreeId && !mode && !worktreePath && !status) {
    return null;
  }

  return {
    worktreeId,
    mode,
    worktreePath: worktreePath ? path.resolve(worktreePath) : null,
    status,
    branch,
    launchBlocked,
    launchBlockedReason,
  };
}

function normalizeObservationRecord(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const summary = asTrimmedString(value.summary);
  const createdAt = asNullableIsoString(value.createdAt);
  const updatedAt = asNullableIsoString(value.updatedAt);

  if (!id || !summary || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    kind: normalizeObservationKind(value.kind),
    summary,
    locator: normalizeLocator(value.locator),
    snapshotSummary: asOptionalString(value.snapshotSummary),
    interaction: normalizeInteraction(value.interaction),
    state: normalizeObservationState(value.state),
    createdAt,
    updatedAt,
  };
}

function normalizeAnnotationRecord(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const message = asTrimmedString(value.message);
  const createdAt = asNullableIsoString(value.createdAt);
  const updatedAt = asNullableIsoString(value.updatedAt);

  if (!id || !message || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    observationId: asOptionalString(value.observationId),
    title: asOptionalString(value.title) || message,
    message,
    status: normalizeAnnotationStatus(value.status),
    createdAt,
    updatedAt,
  };
}

function normalizeChangeRequestRecord(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const request = asTrimmedString(value.request);
  const createdAt = asNullableIsoString(value.createdAt);
  const updatedAt = asNullableIsoString(value.updatedAt);

  if (!id || !request || !createdAt || !updatedAt) {
    return null;
  }

  const status = normalizeChangeRequestStatus(value.status);

  return {
    id,
    observationId: asOptionalString(value.observationId),
    annotationId: asOptionalString(value.annotationId),
    title: asOptionalString(value.title) || request,
    request,
    prompt: asOptionalString(value.prompt),
    status,
    reservationId: status === 'reserved' ? asOptionalString(value.reservationId) : null,
    executorJobId: asOptionalString(value.executorJobId),
    executorRunId: asOptionalString(value.executorRunId),
    createdAt,
    updatedAt,
    queuedAt: asNullableIsoString(value.queuedAt),
  };
}

function normalizeQualitySignalRecord(value) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const observationId = asTrimmedString(value.observationId);
  const kind = asTrimmedString(value.kind);
  const severity = asTrimmedString(value.severity);
  const summary = asTrimmedString(value.summary);
  const createdAt = asNullableIsoString(value.createdAt);

  if (!id || !observationId || !kind || !severity || !summary || !createdAt) {
    return null;
  }

  return {
    id,
    observationId,
    kind,
    severity,
    summary,
    createdAt,
  };
}

function hasAnyTerm(text, terms) {
  return terms.some((term) => text.includes(term));
}

function buildObservationText(observation) {
  if (!isObject(observation)) {
    return '';
  }

  const parts = [
    observation.summary,
    observation.snapshotSummary,
    observation.interaction && observation.interaction.action,
    observation.interaction && observation.interaction.outcome,
    observation.state && observation.state.kind,
    observation.state && observation.state.detail,
  ];

  if (observation.locator) {
    parts.push(
      observation.locator.selector,
      observation.locator.role,
      observation.locator.label,
      observation.locator.text,
      observation.locator.testId,
      observation.locator.componentName,
    );
  }

  return parts.filter(Boolean).join(' ').toLowerCase();
}

function deriveSignalsForObservation(observation) {
  const interaction = observation && observation.interaction ? observation.interaction : null;
  const state = observation && observation.state ? observation.state : null;
  const stateKind = asTrimmedString(state && state.kind).toLowerCase();
  const text = buildObservationText(observation);
  const derived = [];

  if (interaction && interaction.latencyMs !== null && interaction.latencyMs >= 1500) {
    derived.push({
      kind: 'slow-interaction',
      severity: 'warning',
      summary: `Interaction latency reached ${interaction.latencyMs}ms.`,
    });
  }

  if (hasAnyTerm(text, ['no-op', 'noop', 'no op', 'no change', 'unchanged', 'did not change', 'inert'])) {
    derived.push({
      kind: 'inert-control',
      severity: 'warning',
      summary: 'Observed interaction appears inert or produced no visible change.',
    });
  }

  if (stateKind === 'blocked' || stateKind === 'disabled' || hasAnyTerm(text, ['blocked', 'disabled', 'not enabled', 'read only', 'read-only'])) {
    derived.push({
      kind: 'blocked-control',
      severity: 'warning',
      summary: 'Observed control appears blocked or disabled.',
    });
  }

  if (stateKind === 'error' || hasAnyTerm(text, ['error', 'failed', 'exception', 'crash'])) {
    derived.push({
      kind: 'error-state',
      severity: 'error',
      summary: 'Observation indicates an error state.',
    });
  }

  if (stateKind === 'empty' || hasAnyTerm(text, ['empty state', 'no results', 'no items', 'nothing here', '0 results'])) {
    derived.push({
      kind: 'empty-state',
      severity: 'info',
      summary: 'Observation indicates an empty state.',
    });
  }

  if (
    (stateKind === 'loading' && hasAnyTerm(text, ['stuck', 'still loading', 'spinner', 'never finished', 'timed out', 'timeout'])) ||
    (stateKind === 'loading' && interaction && interaction.latencyMs !== null && interaction.latencyMs >= 3000)
  ) {
    derived.push({
      kind: 'stuck-loading',
      severity: 'warning',
      summary: 'Observation indicates loading that did not complete.',
    });
  }

  const seen = new Set();
  return derived
    .filter((entry) => {
      if (seen.has(entry.kind)) {
        return false;
      }
      seen.add(entry.kind);
      return true;
    })
    .map((entry) => ({
      id: `quality-signal-${observation.id}-${entry.kind}`,
      observationId: observation.id,
      kind: entry.kind,
      severity: entry.severity,
      summary: entry.summary,
      createdAt: observation.updatedAt,
    }));
}

function deriveQualitySignals(observations) {
  return Array.isArray(observations)
    ? observations.flatMap((observation) => deriveSignalsForObservation(observation))
    : [];
}

function latestIsoString(values) {
  let latest = null;
  for (const value of values) {
    const normalized = asNullableIsoString(value);
    if (!normalized) {
      continue;
    }
    if (!latest || Date.parse(normalized) > Date.parse(latest)) {
      latest = normalized;
    }
  }
  return latest;
}

function truncateText(value, maxLength = 120) {
  const normalized = asTrimmedString(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function buildAnnotationTitle(inputTitle, message, observation) {
  const explicitTitle = asTrimmedString(inputTitle);
  if (explicitTitle) {
    return explicitTitle;
  }
  if (observation && asTrimmedString(observation.summary)) {
    return truncateText(observation.summary, 80);
  }
  return truncateText(message, 80);
}

function buildChangeRequestTitle(inputTitle, request, annotation, observation) {
  const explicitTitle = asTrimmedString(inputTitle);
  if (explicitTitle) {
    return explicitTitle;
  }
  if (annotation && asTrimmedString(annotation.title)) {
    return annotation.title;
  }
  if (observation && asTrimmedString(observation.summary)) {
    return truncateText(observation.summary, 80);
  }
  return truncateText(request, 80);
}

function buildDefaultChangeRequestPrompt(session, observation, annotation, request, title) {
  const lines = [
    `Repo: ${session.repoLabel} (${session.repoId})`,
    `Repo path: ${session.repoPath}`,
    `Package root: ${session.packageRoot}`,
    `Runtime URL: ${session.runtimeUrl}`,
    `Change request title: ${title}`,
  ];

  if (observation) {
    lines.push(`Observation kind: ${observation.kind}`);
    lines.push(`Observation summary: ${observation.summary}`);
    if (observation.snapshotSummary) {
      lines.push(`Snapshot summary: ${observation.snapshotSummary}`);
    }
    if (observation.locator) {
      const locatorParts = Object.entries(observation.locator)
        .filter((entry) => entry[1])
        .map(([key, value]) => `${key}=${value}`);
      if (locatorParts.length > 0) {
        lines.push(`Locator: ${locatorParts.join(', ')}`);
      }
    }
    if (observation.interaction) {
      const interactionParts = [
        observation.interaction.action,
        observation.interaction.outcome,
        observation.interaction.latencyMs !== null ? `${observation.interaction.latencyMs}ms` : null,
      ].filter(Boolean);
      if (interactionParts.length > 0) {
        lines.push(`Interaction: ${interactionParts.join(' | ')}`);
      }
    }
    if (observation.state) {
      lines.push(`State: ${[observation.state.kind, observation.state.detail].filter(Boolean).join(' | ')}`);
    }
  }

  if (annotation) {
    lines.push(`Annotation: ${annotation.title}`);
    lines.push(`Annotation message: ${annotation.message}`);
    lines.push(`Annotation status: ${annotation.status}`);
  }

  lines.push(`Requested change: ${request}`);
  lines.push('Implement the smallest targeted code change that addresses the observed UI issue without expanding scope.');

  return lines.join('\n');
}

function assertSessionAllowsMutation(session) {
  if (session && session.status === 'closed') {
    throw Object.assign(new Error('UI Runtime Overlay session is closed and does not allow further mutations.'), {
      statusCode: 409,
    });
  }
}

function hasReservedQueueChangeRequest(session) {
  return Boolean(
    session
    && Array.isArray(session.changeRequests)
    && session.changeRequests.some((entry) => entry && entry.status === 'reserved')
  );
}

function assertSessionCanClose(session) {
  if (hasReservedQueueChangeRequest(session)) {
    throw Object.assign(new Error('UI Runtime Overlay session cannot be closed while a change request reservation is in progress.'), {
      statusCode: 409,
    });
  }
}

function assertChangeRequestIsReservable(changeRequest) {
  if (!changeRequest) {
    return;
  }

  if (changeRequest.status === 'queued') {
    throw Object.assign(new Error('UI Runtime Overlay change request is already queued.'), {
      statusCode: 409,
    });
  }

  if (changeRequest.status === 'reserved') {
    throw Object.assign(new Error('UI Runtime Overlay change request is already reserved for queueing.'), {
      statusCode: 409,
    });
  }

  if (changeRequest.status !== 'draft') {
    throw Object.assign(new Error(`UI Runtime Overlay change request cannot be queued from status "${changeRequest.status}".`), {
      statusCode: 409,
    });
  }
}

function assertChangeRequestIsQueueable(changeRequest) {
  if (!changeRequest) {
    return;
  }

  if (changeRequest.status === 'queued') {
    throw Object.assign(new Error('UI Runtime Overlay change request is already queued.'), {
      statusCode: 409,
    });
  }

  if (changeRequest.status !== 'reserved' || !asTrimmedString(changeRequest.reservationId)) {
    throw Object.assign(new Error('UI Runtime Overlay change request reservation is no longer active.'), {
      statusCode: 409,
    });
  }
}

function assertReservationIdMatches(changeRequest, reservationId) {
  const normalizedReservationId = asTrimmedString(reservationId);
  if (!normalizedReservationId) {
    throw Object.assign(new Error('reservationId is required'), { statusCode: 400 });
  }

  if (asTrimmedString(changeRequest.reservationId) !== normalizedReservationId) {
    throw Object.assign(new Error('UI Runtime Overlay change request reservation is no longer active.'), {
      statusCode: 409,
    });
  }
}

function normalizeSessionRecord(value, pathImpl = path) {
  if (!isObject(value)) {
    return null;
  }

  const id = asTrimmedString(value.id);
  const repoId = asTrimmedString(value.repoId);
  const repoPath = asTrimmedString(value.repoPath) ? pathImpl.resolve(String(value.repoPath)) : '';
  const repoLabel = asTrimmedString(value.repoLabel);
  const packageRoot = asTrimmedString(value.packageRoot) ? pathImpl.resolve(String(value.packageRoot)) : '';
  const createdAt = asNullableIsoString(value.createdAt);
  const updatedAt = asNullableIsoString(value.updatedAt);

  if (!id || !repoId || !repoPath || !repoLabel || !packageRoot || !createdAt || !updatedAt) {
    return null;
  }

  let runtime;
  try {
    runtime = parseRuntimeUrl(value.runtimeUrl);
  } catch {
    return null;
  }

  const status = normalizeStatus(value.status);
  const observations = Array.isArray(value.observations)
    ? value.observations.map((entry) => normalizeObservationRecord(entry)).filter(Boolean)
    : [];
  const annotations = Array.isArray(value.annotations)
    ? value.annotations.map((entry) => normalizeAnnotationRecord(entry)).filter(Boolean)
    : [];
  const changeRequests = Array.isArray(value.changeRequests)
    ? value.changeRequests.map((entry) => normalizeChangeRequestRecord(entry)).filter(Boolean)
    : [];
  const derivedQualitySignals = deriveQualitySignals(observations);
  const qualitySignals = Array.isArray(value.qualitySignals)
    ? value.qualitySignals.map((entry) => normalizeQualitySignalRecord(entry)).filter(Boolean)
    : derivedQualitySignals;

  return {
    id,
    status,
    runtimeUrl: runtime.runtimeUrl,
    runtimeOrigin: runtime.runtimeOrigin,
    repoId,
    repoPath,
    repoLabel,
    packageRoot,
    linkedSessionId: asOptionalString(value.linkedSessionId),
    worktree: normalizeWorktreeRecord(value.worktree),
    phase: normalizePhase(value.phase, status),
    evidence: normalizeEvidence(value.evidence),
    observations,
    annotations,
    changeRequests,
    qualitySignals: qualitySignals.length > 0 ? qualitySignals : derivedQualitySignals,
    lastAnalyzedAt: asNullableIsoString(value.lastAnalyzedAt) || latestIsoString(observations.map((entry) => entry.updatedAt)),
    createdAt,
    updatedAt,
    closedAt: status === 'closed' ? asNullableIsoString(value.closedAt) : null,
  };
}

function sortSessions(sessions) {
  return sessions
    .slice()
    .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
}

class UiRuntimeOverlayService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._fs = deps.fs || fs;
    this._path = deps.path || path;
    this._crypto = deps.crypto || crypto;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._repoInventory = deps.repoInventory || repoInventoryService;
    this._statePath = resolveUiRuntimeOverlayStatePath(this._config.elegyHome || this._config.copilotHome || '.', this._path);
    this._stateLockPath = `${this._statePath}.lock`;
    this._stateLockTimeoutMs = asNonNegativeInteger(deps.stateLockTimeoutMs) ?? DEFAULT_STATE_LOCK_TIMEOUT_MS;
    this._stateLockRetryDelayMs = asNonNegativeInteger(deps.stateLockRetryDelayMs) ?? DEFAULT_STATE_LOCK_RETRY_DELAY_MS;
    this._stateLockStaleMs = asNonNegativeInteger(deps.stateLockStaleMs) ?? DEFAULT_STATE_LOCK_STALE_MS;
  }

  get statePath() {
    return this._statePath;
  }

  listSessions() {
    return sortSessions(this._loadState().sessions).map((session) => clone(session));
  }

  createSession(input = {}) {
    const repo = this._resolveSelectedRepo();
    const runtime = parseRuntimeUrl(input.runtimeUrl);
    const worktree = this._resolveWorktree(repo, input.worktree);
    const packageRoot = this._resolvePackageRoot(repo, input.packageRoot, {
      worktreeRoot: worktree && worktree.worktreePath ? worktree.worktreePath : null,
    });
    const timestamp = nowIso(this._now);
    const session = {
      id: createSessionId(this._crypto),
      status: 'attached',
      runtimeUrl: runtime.runtimeUrl,
      runtimeOrigin: runtime.runtimeOrigin,
      repoId: repo.repoId,
      repoPath: repo.repoPath,
      repoLabel: repo.repoLabel,
      packageRoot,
      linkedSessionId: asOptionalString(input.linkedSessionId),
      worktree,
      phase: 'attached',
      evidence: {
        source: 'copilot-ui',
        kind: 'runtime-url-registration',
      },
      observations: [],
      annotations: [],
      changeRequests: [],
      qualitySignals: [],
      lastAnalyzedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: null,
    };

    return this._withStateMutation(() => {
      const state = this._loadState();
      state.sessions = sortSessions([session, ...state.sessions]);
      this._saveState(state);
      return clone(session);
    });
  }

  closeSession(sessionId) {
    const normalizedId = asTrimmedString(sessionId);
    if (!normalizedId) {
      throw Object.assign(new Error('session id is required'), { statusCode: 400 });
    }

    return this._withStateMutation(() => {
      const state = this._loadState();
      const sessionIndex = state.sessions.findIndex((entry) => entry.id === normalizedId);
      if (sessionIndex < 0) {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }

      const existing = state.sessions[sessionIndex];
      if (existing.status === 'closed') {
        return clone(existing);
      }

      assertSessionCanClose(existing);

      const timestamp = nowIso(this._now);
      const closedSession = {
        ...existing,
        status: 'closed',
        phase: 'closed',
        updatedAt: timestamp,
        closedAt: timestamp,
      };

      state.sessions[sessionIndex] = closedSession;
      state.sessions = sortSessions(state.sessions);
      this._saveState(state);
      return clone(closedSession);
    });
  }

  getSession(sessionId) {
    const state = this._loadState();
    const { session } = this._findSessionOrThrow(state, sessionId);
    return clone(session);
  }

  getChangeRequest(sessionId, changeRequestId) {
    const state = this._loadState();
    const { session } = this._findSessionOrThrow(state, sessionId);
    const changeRequest = this._findChangeRequestOrThrow(session, changeRequestId);
    return clone(changeRequest);
  }

  addObservation(sessionId, input = {}) {
    const summary = asTrimmedString(input.summary);
    if (!summary) {
      throw Object.assign(new Error('summary is required'), { statusCode: 400 });
    }

    const kind = normalizeObservationKind(input.kind, '');
    if (!kind) {
      throw Object.assign(new Error('kind must be one of snapshot, interaction, state, locator, or note'), { statusCode: 400 });
    }

    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      assertSessionAllowsMutation(session);
      const timestamp = nowIso(this._now);
      const observation = {
        id: createEntityId('uiro-observation', this._crypto),
        kind,
        summary,
        locator: normalizeLocator(input.locator),
        snapshotSummary: asOptionalString(input.snapshotSummary),
        interaction: normalizeInteraction(input.interaction),
        state: normalizeObservationState(input.state),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const nextSession = {
        ...session,
        observations: [...session.observations, observation],
        qualitySignals: deriveQualitySignals([...session.observations, observation]),
        lastAnalyzedAt: timestamp,
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      return {
        session: clone(savedSession),
        observation: clone(observation),
        qualitySignals: savedSession.qualitySignals
          .filter((entry) => entry.observationId === observation.id)
          .map((entry) => clone(entry)),
      };
    });
  }

  addAnnotation(sessionId, input = {}) {
    const message = asTrimmedString(input.message);
    if (!message) {
      throw Object.assign(new Error('message is required'), { statusCode: 400 });
    }

    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      assertSessionAllowsMutation(session);
      const observation = this._findObservationOrThrow(session, input.observationId, { allowBlank: true });
      const timestamp = nowIso(this._now);
      const annotation = {
        id: createEntityId('uiro-annotation', this._crypto),
        observationId: observation ? observation.id : null,
        title: buildAnnotationTitle(input.title, message, observation),
        message,
        status: normalizeAnnotationStatus(input.status),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const nextSession = {
        ...session,
        annotations: [...session.annotations, annotation],
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      return {
        session: clone(savedSession),
        annotation: clone(annotation),
      };
    });
  }

  addChangeRequest(sessionId, input = {}) {
    const request = asTrimmedString(input.request);
    if (!request) {
      throw Object.assign(new Error('request is required'), { statusCode: 400 });
    }

    const requestedStatus = asTrimmedString(input.status).toLowerCase();
    if (requestedStatus && requestedStatus !== 'draft') {
      throw Object.assign(new Error('change request status must be draft when creating a change request.'), { statusCode: 400 });
    }

    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      assertSessionAllowsMutation(session);
      let observation = this._findObservationOrThrow(session, input.observationId, { allowBlank: true });
      const annotation = this._findAnnotationOrThrow(session, input.annotationId, { allowBlank: true });

      if (annotation && annotation.observationId) {
        if (observation && observation.id !== annotation.observationId) {
          throw Object.assign(new Error('annotationId does not belong to the provided observationId'), { statusCode: 400 });
        }
        observation = this._findObservationOrThrow(session, annotation.observationId, { allowBlank: false });
      }

      const timestamp = nowIso(this._now);
      const title = buildChangeRequestTitle(input.title, request, annotation, observation);
      const prompt = asTrimmedString(input.prompt)
        || buildDefaultChangeRequestPrompt(session, observation, annotation, request, title);
      const changeRequest = {
        id: createEntityId('uiro-change-request', this._crypto),
        observationId: observation ? observation.id : null,
        annotationId: annotation ? annotation.id : null,
        title,
        request,
        prompt,
        status: 'draft',
        reservationId: null,
        executorJobId: null,
        executorRunId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        queuedAt: null,
      };

      const nextSession = {
        ...session,
        changeRequests: [...session.changeRequests, changeRequest],
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      return {
        session: clone(savedSession),
        changeRequest: clone(changeRequest),
      };
    });
  }

  reserveQueueChangeRequest(sessionId, changeRequestId) {
    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      assertSessionAllowsMutation(session);
      const changeRequest = this._findChangeRequestOrThrow(session, changeRequestId);
      assertChangeRequestIsReservable(changeRequest);
      const timestamp = nowIso(this._now);
      const reservedChangeRequest = {
        ...changeRequest,
        status: 'reserved',
        reservationId: createEntityId('uiro-reservation', this._crypto),
        updatedAt: timestamp,
      };

      const nextSession = {
        ...session,
        changeRequests: session.changeRequests.map((entry) => (
          entry.id === reservedChangeRequest.id ? reservedChangeRequest : entry
        )),
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      const savedChangeRequest = savedSession.changeRequests.find((entry) => entry.id === reservedChangeRequest.id) || reservedChangeRequest;
      return {
        session: clone(savedSession),
        changeRequest: clone(savedChangeRequest),
      };
    });
  }

  releaseQueueChangeRequest(sessionId, changeRequestId) {
    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      const changeRequest = this._findChangeRequestOrThrow(session, changeRequestId);

      if (changeRequest.status !== 'reserved') {
        return {
          session: clone(session),
          changeRequest: clone(changeRequest),
        };
      }

      const timestamp = nowIso(this._now);
      const releasedChangeRequest = {
        ...changeRequest,
        status: 'draft',
        reservationId: null,
        executorJobId: null,
        executorRunId: null,
        queuedAt: null,
        updatedAt: timestamp,
      };

      const nextSession = {
        ...session,
        changeRequests: session.changeRequests.map((entry) => (
          entry.id === releasedChangeRequest.id ? releasedChangeRequest : entry
        )),
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      const savedChangeRequest = savedSession.changeRequests.find((entry) => entry.id === releasedChangeRequest.id) || releasedChangeRequest;
      return {
        session: clone(savedSession),
        changeRequest: clone(savedChangeRequest),
      };
    });
  }

  queueChangeRequest(sessionId, changeRequestId, queueResultMeta = {}) {
    const executorJobId = asTrimmedString(queueResultMeta.executorJobId);
    if (!executorJobId) {
      throw Object.assign(new Error('executorJobId is required'), { statusCode: 400 });
    }

    const reservationId = asTrimmedString(queueResultMeta.reservationId);

    return this._withStateMutation(() => {
      const state = this._loadState();
      const { session, sessionIndex } = this._findSessionOrThrow(state, sessionId);
      assertSessionAllowsMutation(session);
      const changeRequest = this._findChangeRequestOrThrow(session, changeRequestId);
      assertChangeRequestIsQueueable(changeRequest);
      assertReservationIdMatches(changeRequest, reservationId);
      const timestamp = asNullableIsoString(queueResultMeta.queuedAt) || nowIso(this._now);
      const updatedChangeRequest = {
        ...changeRequest,
        status: 'queued',
        reservationId: null,
        executorJobId,
        executorRunId: asOptionalString(queueResultMeta.executorRunId),
        queuedAt: timestamp,
        updatedAt: timestamp,
      };

      const nextSession = {
        ...session,
        changeRequests: session.changeRequests.map((entry) => (
          entry.id === updatedChangeRequest.id ? updatedChangeRequest : entry
        )),
        updatedAt: timestamp,
      };

      state.sessions[sessionIndex] = nextSession;
      state.sessions = sortSessions(state.sessions);
      const savedState = this._saveState(state);
      const savedSession = savedState.sessions.find((entry) => entry.id === session.id) || nextSession;
      const savedChangeRequest = savedSession.changeRequests.find((entry) => entry.id === updatedChangeRequest.id) || updatedChangeRequest;
      return {
        session: clone(savedSession),
        changeRequest: clone(savedChangeRequest),
      };
    });
  }

  _withStateMutation(work) {
    const releaseLock = acquireDirectoryLock(this._fs, this._path, this._stateLockPath, {
      timeoutMs: this._stateLockTimeoutMs,
      retryDelayMs: this._stateLockRetryDelayMs,
      staleMs: this._stateLockStaleMs,
    });

    try {
      return work();
    } finally {
      releaseLock();
    }
  }

  _loadState() {
    let rawText = null;
    try {
      rawText = this._fs.readFileSync(this._statePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return createStateShape();
      }
      throw createStateLoadError('UI Runtime Overlay persisted state could not be read.', error);
    }

    let raw = null;
    try {
      raw = JSON.parse(rawText);
    } catch (error) {
      throw createStateLoadError('UI Runtime Overlay persisted state contains malformed JSON.', error);
    }

    if (!isObject(raw) || !Array.isArray(raw.sessions)) {
      throw createStateLoadError('UI Runtime Overlay persisted state has an invalid top-level shape.');
    }

    const sessions = raw.sessions
      .map((entry) => normalizeSessionRecord(entry, this._path))
      .filter(Boolean);

    return {
      version: STATE_VERSION,
      sessions: sortSessions(sessions),
    };
  }

  _saveState(state) {
    const normalized = createStateShape();
    normalized.sessions = sortSessions(Array.isArray(state?.sessions)
      ? state.sessions
        .map((entry) => normalizeSessionRecord(entry, this._path))
        .filter(Boolean)
      : []);
    writeJsonAtomic(this._fs, this._path, this._statePath, normalized);
    return normalized;
  }

  _resolveSelectedRepo() {
    const inventory = this._repoInventory.listKnownRepos({
      elegyHome: this._config.elegyHome || this._config.copilotHome,
      engineRoot: this._config.engineRoot,
    });
    const repo = inventory && isObject(inventory.selectedRepo) ? inventory.selectedRepo : null;
    const repoId = asTrimmedString(repo?.repoId);
    const repoPath = asTrimmedString(repo?.repoPath) ? this._path.resolve(String(repo.repoPath)) : '';
    const repoLabel = asTrimmedString(repo?.repoLabel) || (repoPath ? this._path.basename(repoPath) : '');

    if (!repo || !repoId || !repoPath || !repoLabel) {
      throw Object.assign(new Error('A Catalog repo must be selected before attaching a runtime.'), { statusCode: 409 });
    }

    if (!isDirectory(this._fs, repoPath)) {
      throw Object.assign(new Error('The selected Catalog repo is no longer available on disk.'), { statusCode: 409 });
    }

    return {
      repoId,
      repoPath,
      repoLabel,
    };
  }

  _resolveWorktree(repo, worktreeInput) {
    const worktree = normalizeWorktreeRecord(worktreeInput);
    if (!worktree || !worktree.worktreePath) {
      return worktree;
    }

    if (normalizeComparablePath(this._path, worktree.worktreePath) === normalizeComparablePath(this._path, repo.repoPath)) {
      return {
        ...worktree,
        worktreePath: this._path.resolve(String(worktree.worktreePath)),
      };
    }

    const validation = validateDedicatedWorktreePath(
      this._fs,
      this._path,
      repo.repoPath,
      worktree.worktreePath,
      repo.repoId,
    );
    if (!validation.ready) {
      throw Object.assign(new Error(validation.reason || 'worktree.worktreePath must resolve to an attached worktree for the selected repo.'), {
        statusCode: 400,
      });
    }

    return {
      ...worktree,
      worktreePath: this._path.resolve(String(worktree.worktreePath)),
    };
  }

  _resolvePackageRoot(repo, packageRootInput, options = {}) {
    const worktreeRoot = asTrimmedString(options.worktreeRoot)
      ? this._path.resolve(String(options.worktreeRoot))
      : '';
    const containmentRoot = worktreeRoot || repo.repoPath;
    const containmentLabel = worktreeRoot
      ? 'selected worktree'
      : 'selected repo';
    const rawPackageRoot = asTrimmedString(packageRootInput);
    if (!rawPackageRoot) {
      return containmentRoot;
    }

    const resolvedPackageRoot = this._path.isAbsolute(rawPackageRoot)
      ? this._path.resolve(rawPackageRoot)
      : this._path.resolve(containmentRoot, rawPackageRoot);

    if (!isPathInside(containmentRoot, resolvedPackageRoot, this._path)) {
      throw Object.assign(new Error(`packageRoot must resolve to a directory under the ${containmentLabel}.`), { statusCode: 400 });
    }

    if (!isDirectory(this._fs, resolvedPackageRoot)) {
      throw Object.assign(new Error(`packageRoot must resolve to an existing directory under the ${containmentLabel}.`), { statusCode: 400 });
    }

    return resolvedPackageRoot;
  }

  _findSessionOrThrow(state, sessionId) {
    const normalizedId = asTrimmedString(sessionId);
    if (!normalizedId) {
      throw Object.assign(new Error('session id is required'), { statusCode: 400 });
    }

    const sessionIndex = state.sessions.findIndex((entry) => entry.id === normalizedId);
    if (sessionIndex < 0) {
      throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
    }

    return {
      sessionIndex,
      session: state.sessions[sessionIndex],
    };
  }

  _findObservationOrThrow(session, observationId, options = {}) {
    const normalizedId = asTrimmedString(observationId);
    if (!normalizedId) {
      if (options.allowBlank) {
        return null;
      }
      throw Object.assign(new Error('observationId is required'), { statusCode: 400 });
    }

    const observation = Array.isArray(session.observations)
      ? session.observations.find((entry) => entry.id === normalizedId)
      : null;
    if (!observation) {
      throw Object.assign(new Error('UI Runtime Overlay observation not found'), { statusCode: 404 });
    }
    return observation;
  }

  _findAnnotationOrThrow(session, annotationId, options = {}) {
    const normalizedId = asTrimmedString(annotationId);
    if (!normalizedId) {
      if (options.allowBlank) {
        return null;
      }
      throw Object.assign(new Error('annotationId is required'), { statusCode: 400 });
    }

    const annotation = Array.isArray(session.annotations)
      ? session.annotations.find((entry) => entry.id === normalizedId)
      : null;
    if (!annotation) {
      throw Object.assign(new Error('UI Runtime Overlay annotation not found'), { statusCode: 404 });
    }
    return annotation;
  }

  _findChangeRequestOrThrow(session, changeRequestId) {
    const normalizedId = asTrimmedString(changeRequestId);
    if (!normalizedId) {
      throw Object.assign(new Error('changeRequestId is required'), { statusCode: 400 });
    }

    const changeRequest = Array.isArray(session.changeRequests)
      ? session.changeRequests.find((entry) => entry.id === normalizedId)
      : null;
    if (!changeRequest) {
      throw Object.assign(new Error('UI Runtime Overlay change request not found'), { statusCode: 404 });
    }
    return changeRequest;
  }
}

function createUiRuntimeOverlayService(config = {}, deps = {}) {
  return new UiRuntimeOverlayService(config, deps);
}

module.exports = {
  STATE_VERSION,
  UiRuntimeOverlayService,
  resolveUiRuntimeOverlayStatePath,
  createUiRuntimeOverlayService,
};
