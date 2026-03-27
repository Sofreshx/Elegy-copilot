'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RETRY_POLICY = Object.freeze({
  enabled: true,
  maxAttempts: 3,
  baseDelayMs: 30_000,
  maxDelayMs: 300_000,
  backoffMultiplier: 2,
  jitterRatio: 0.15,
});

const STATE_VERSION = 1;
const MAX_EVENT_ENTRIES = 200;
const MAX_RUN_ENTRIES = 200;
const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function toErrorMessage(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return String(error || 'Unknown error');
}

function nowIso(nowFn) {
  return new Date(typeof nowFn === 'function' ? nowFn() : Date.now()).toISOString();
}

function asTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asNullableIsoString(value) {
  const normalized = asTrimmedString(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function asPositiveInteger(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.floor(num);
  return rounded > 0 ? rounded : fallback;
}

function asPositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function asNonNegativeNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function normalizeContextType(value) {
  return asTrimmedString(value).toLowerCase() || 'regular';
}

function assertValidSandboxJobConfig(contextType, sandboxId) {
  const normalizedContextType = normalizeContextType(contextType);
  const normalizedSandboxId = asTrimmedString(sandboxId);

  if (normalizedSandboxId && !SANDBOX_ID_PATTERN.test(normalizedSandboxId)) {
    throw Object.assign(new Error('sandboxId must use only alphanumeric and hyphen characters'), { statusCode: 400 });
  }

  if (normalizedSandboxId && normalizedContextType !== 'sandbox') {
    throw Object.assign(new Error('sandboxId requires contextType=sandbox (or omit contextType)'), { statusCode: 400 });
  }

  if (normalizedContextType === 'sandbox' && !normalizedSandboxId) {
    throw Object.assign(new Error('sandboxId is required when contextType=sandbox'), { statusCode: 400 });
  }

  return {
    contextType: normalizedContextType,
    sandboxId: normalizedSandboxId || null,
  };
}

function normalizeRetryPolicy(value) {
  const input = isObject(value) ? value : {};
  return {
    enabled: input.enabled !== false,
    maxAttempts: Math.min(asPositiveInteger(input.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts), 10),
    baseDelayMs: Math.min(asPositiveNumber(input.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs), 3_600_000),
    maxDelayMs: Math.min(asPositiveNumber(input.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs), 7_200_000),
    backoffMultiplier: Math.min(asPositiveNumber(input.backoffMultiplier, DEFAULT_RETRY_POLICY.backoffMultiplier), 8),
    jitterRatio: Math.min(asNonNegativeNumber(input.jitterRatio, DEFAULT_RETRY_POLICY.jitterRatio), 1),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeJobRecord(value) {
  if (!isObject(value)) return null;

  const id = asTrimmedString(value.id);
  const prompt = typeof value.prompt === 'string' ? value.prompt : '';
  if (!id || !prompt.trim()) {
    return null;
  }

  const targetType = asTrimmedString(value.targetType) === 'existing-session'
    ? 'existing-session'
    : 'create-session';

  return {
    id,
    title: asTrimmedString(value.title) || id,
    prompt,
    repoId: asTrimmedString(value.repoId) || null,
    targetType,
    existingSessionId: targetType === 'existing-session' ? (asTrimmedString(value.existingSessionId) || null) : null,
    model: asTrimmedString(value.model) || null,
    contextType: normalizeContextType(value.contextType),
    sandboxId: asTrimmedString(value.sandboxId) || null,
    scheduleAt: asNullableIsoString(value.scheduleAt),
    retryPolicy: normalizeRetryPolicy(value.retryPolicy),
    createdAt: asNullableIsoString(value.createdAt) || new Date(0).toISOString(),
    updatedAt: asNullableIsoString(value.updatedAt) || new Date(0).toISOString(),
    lastRunId: asTrimmedString(value.lastRunId) || null,
    activeRunId: asTrimmedString(value.activeRunId) || null,
    status: asTrimmedString(value.status) || 'idle',
  };
}

function normalizeRunRecord(value) {
  if (!isObject(value)) return null;

  const id = asTrimmedString(value.id);
  const jobId = asTrimmedString(value.jobId);
  if (!id || !jobId) {
    return null;
  }

  const events = Array.isArray(value.events)
    ? value.events
      .filter((entry) => isObject(entry) && asTrimmedString(entry.at) && asTrimmedString(entry.type))
      .slice(-MAX_EVENT_ENTRIES)
      .map((entry) => ({
        at: asTrimmedString(entry.at),
        type: asTrimmedString(entry.type),
        level: asTrimmedString(entry.level) || 'info',
        message: asTrimmedString(entry.message) || asTrimmedString(entry.type),
        data: isObject(entry.data) ? clone(entry.data) : null,
      }))
    : [];

  return {
    id,
    jobId,
    repoId: asTrimmedString(value.repoId) || null,
    status: asTrimmedString(value.status) || 'queued',
    attemptCount: asNonNegativeNumber(value.attemptCount, 0),
    maxAttempts: asPositiveInteger(value.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts),
    createdAt: asNullableIsoString(value.createdAt) || new Date(0).toISOString(),
    updatedAt: asNullableIsoString(value.updatedAt) || new Date(0).toISOString(),
    startedAt: asNullableIsoString(value.startedAt),
    finishedAt: asNullableIsoString(value.finishedAt),
    nextRetryAt: asNullableIsoString(value.nextRetryAt),
    sessionId: asTrimmedString(value.sessionId) || null,
    messageId: asTrimmedString(value.messageId) || null,
    error: asTrimmedString(value.error) || null,
    summary: asTrimmedString(value.summary) || null,
    createdSession: value.createdSession === true,
    events,
  };
}

function sanitizeSessionId(value) {
  const sessionId = asTrimmedString(value);
  if (!sessionId) return '';
  if (sessionId.length > 256) return '';
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) return '';
  return sessionId;
}

function classifyError(error) {
  const message = toErrorMessage(error);
  const lower = message.toLowerCase();
  const statusCode = Number(error && error.statusCode);
  const explicitRetryAfterMs = Number(
    error && (error.retryAfterMs || error.retryAfter || (error.headers && (error.headers['retry-after'] || error.headers['Retry-After'])))
  );

  let retryAfterMs = Number.isFinite(explicitRetryAfterMs)
    ? explicitRetryAfterMs > 1000 ? explicitRetryAfterMs : explicitRetryAfterMs * 1000
    : null;

  if (retryAfterMs == null) {
    const secondsMatch = message.match(/retry(?:[- ]after)?[^\d]{0,8}(\d+)\s*(ms|millisecond|milliseconds|s|sec|secs|second|seconds)?/i);
    if (secondsMatch) {
      const amount = Number(secondsMatch[1]);
      const unit = String(secondsMatch[2] || 's').toLowerCase();
      if (Number.isFinite(amount) && amount > 0) {
        retryAfterMs = unit.startsWith('ms') ? amount : amount * 1000;
      }
    }
  }

  const isRateLimited = statusCode === 429
    || lower.includes('rate limit')
    || lower.includes('rate-limit')
    || lower.includes('too many requests')
    || lower.includes('retry after')
    || /\b429\b/.test(lower);

  return {
    message,
    isRateLimited,
    retryAfterMs,
  };
}

class ExecutorService {
  constructor(config = {}, deps = {}) {
    this._config = isObject(config) ? config : {};
    this._fs = deps.fs || fs;
    this._path = deps.path || path;
    this._sdkBridge = this._config.sdkBridge || null;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._setTimeout = typeof deps.setTimeout === 'function' ? deps.setTimeout : setTimeout;
    this._clearTimeout = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : clearTimeout;
    this._jobs = new Map();
    this._runs = new Map();
    this._timers = new Map();
    this._runSubscriptions = new Map();
    this._activeRunsBySession = new Map();
    this._lastError = null;
    this._initialized = false;
    this._statePath = this._path.join(this._path.resolve(String(this._config.copilotHome || '.')), 'executor', 'state.json');
  }

  async init() {
    if (this._initialized) {
      return this;
    }

    this._ensureStateDir();
    this._loadState();
    this._restoreTimers();
    this._initialized = true;
    return this;
  }

  async shutdown() {
    for (const timer of this._timers.values()) {
      this._clearTimeout(timer);
    }
    this._timers.clear();

    for (const subscription of this._runSubscriptions.values()) {
      if (typeof subscription.unsubscribe === 'function') {
        try {
          subscription.unsubscribe();
        } catch {
          // Ignore listener cleanup failures.
        }
      }
    }
    this._runSubscriptions.clear();
    this._activeRunsBySession.clear();
  }

  getHealth() {
    const runs = Array.from(this._runs.values());
    const jobs = Array.from(this._jobs.values());
    return {
      enabled: Boolean(this._sdkBridge),
      state: this._sdkBridge ? 'ready' : 'disabled',
      jobCount: jobs.length,
      runCount: runs.length,
      activeRunCount: runs.filter((run) => ['starting', 'running', 'retrying'].includes(run.status)).length,
      scheduledJobCount: jobs.filter((job) => job.scheduleAt && ['scheduled', 'retrying'].includes(job.status)).length,
      openedSessionCount: runs.filter((run) => run.sessionId).length,
      lastError: this._lastError,
      statePath: this._statePath,
    };
  }

  listJobs() {
    return Array.from(this._jobs.values())
      .map((job) => this._serializeJob(job))
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
  }

  listRuns() {
    return Array.from(this._runs.values())
      .map((run) => this._serializeRun(run))
      .sort((left, right) => Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || ''));
  }

  getRun(runId) {
    const run = this._runs.get(asTrimmedString(runId));
    return run ? this._serializeRun(run) : null;
  }

  async createJob(input = {}) {
    if (!this._sdkBridge) {
      throw Object.assign(new Error('Executor is disabled because the SDK bridge is unavailable.'), { statusCode: 503 });
    }

    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!prompt.trim()) {
      throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
    }

    const targetType = asTrimmedString(input.targetType) === 'existing-session'
      ? 'existing-session'
      : 'create-session';

    const existingSessionId = targetType === 'existing-session'
      ? sanitizeSessionId(input.existingSessionId)
      : '';
    const sandboxConfig = targetType === 'existing-session'
      ? {
        contextType: normalizeContextType(input.contextType),
        sandboxId: asTrimmedString(input.sandboxId) || null,
      }
      : assertValidSandboxJobConfig(input.contextType, input.sandboxId);

    if (targetType === 'existing-session' && !existingSessionId) {
      throw Object.assign(new Error('existingSessionId is required for existing-session jobs'), { statusCode: 400 });
    }

    const scheduleAt = asNullableIsoString(input.scheduleAt);
    const id = crypto.randomUUID();
    const timestamp = nowIso(this._now);
    const job = {
      id,
      title: asTrimmedString(input.title) || `executor-${id.slice(0, 8)}`,
      prompt,
      repoId: asTrimmedString(input.repoId) || null,
      targetType,
      existingSessionId: existingSessionId || null,
      model: asTrimmedString(input.model) || null,
      contextType: sandboxConfig.contextType,
      sandboxId: sandboxConfig.sandboxId,
      scheduleAt,
      retryPolicy: normalizeRetryPolicy(input.retryPolicy),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastRunId: null,
      activeRunId: null,
      status: scheduleAt ? 'scheduled' : 'idle',
    };

    this._jobs.set(job.id, job);
    this._persistState();

    let run = null;
    if (scheduleAt) {
      this._scheduleJob(job.id, Date.parse(scheduleAt));
    } else {
      run = await this.triggerJob(job.id, { source: 'create' });
    }

    return {
      job: this._serializeJob(this._jobs.get(job.id)),
      run,
    };
  }

  async triggerJob(jobId, options = {}) {
    if (!this._sdkBridge) {
      throw Object.assign(new Error('Executor is disabled because the SDK bridge is unavailable.'), { statusCode: 503 });
    }

    const normalizedJobId = asTrimmedString(jobId);
    const job = this._jobs.get(normalizedJobId);
    if (!job) {
      throw Object.assign(new Error('Executor job not found'), { statusCode: 404 });
    }

    if (job.activeRunId) {
      const activeRun = this._runs.get(job.activeRunId);
      if (activeRun && ['starting', 'running', 'retrying'].includes(activeRun.status)) {
        throw Object.assign(new Error('Executor job already has an active run'), { statusCode: 409 });
      }
    }

    this._clearTimer(`job:${job.id}`);
    job.scheduleAt = null;
    job.updatedAt = nowIso(this._now);
    job.status = 'starting';

    const timestamp = nowIso(this._now);
    const run = {
      id: crypto.randomUUID(),
      jobId: job.id,
      repoId: job.repoId,
      status: 'queued',
      attemptCount: 0,
      maxAttempts: job.retryPolicy.maxAttempts,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      nextRetryAt: null,
      sessionId: null,
      messageId: null,
      error: null,
      summary: null,
      createdSession: false,
      events: [],
    };

    job.lastRunId = run.id;
    job.activeRunId = run.id;
    this._runs.set(run.id, run);
    this._trimRuns();
    this._appendRunEvent(run, 'run.queued', 'Run queued for execution.', { source: asTrimmedString(options.source) || 'manual' }, 'info');
    this._persistState();

    await this._startAttempt(run.id, { source: asTrimmedString(options.source) || 'manual' });
    return this._serializeRun(this._runs.get(run.id));
  }

  async cancelJob(jobId) {
    const job = this._jobs.get(asTrimmedString(jobId));
    if (!job) {
      throw Object.assign(new Error('Executor job not found'), { statusCode: 404 });
    }

    this._clearTimer(`job:${job.id}`);
    if (job.activeRunId) {
      const run = this._runs.get(job.activeRunId);
      if (run) {
        await this.cancelRun(run.id);
      }
    }

    job.scheduleAt = null;
    job.status = 'idle';
    job.updatedAt = nowIso(this._now);
    this._persistState();

    return {
      job: this._serializeJob(job),
      run: job.lastRunId ? this.getRun(job.lastRunId) : null,
    };
  }

  async cancelRun(runId) {
    const run = this._runs.get(asTrimmedString(runId));
    if (!run) {
      throw Object.assign(new Error('Executor run not found'), { statusCode: 404 });
    }

    if (run.status === 'retrying') {
      this._clearTimer(`run:${run.id}`);
      return this._finalizeRunCancellation(run, 'Retry cancelled by operator.');
    }

    if (run.status === 'queued' || run.status === 'starting') {
      return this._finalizeRunCancellation(run, 'Queued run cancelled by operator.');
    }

    if (run.status === 'running') {
      if (!run.createdSession || !run.sessionId) {
        throw Object.assign(new Error('Active runs against existing sessions cannot be force-stopped in v1.'), { statusCode: 409 });
      }

      await this._detachRunSubscription(run.id);
      this._activeRunsBySession.delete(run.sessionId);
      await this._sdkBridge.destroySdkSession(run.sessionId, { reason: 'executor-cancel' });
      return this._finalizeRunCancellation(run, 'Active run cancelled by operator.');
    }

    return this._serializeRun(run);
  }

  _finalizeRunCancellation(run, message) {
    run.status = 'cancelled';
    run.finishedAt = nowIso(this._now);
    run.updatedAt = run.finishedAt;
    run.nextRetryAt = null;
    run.error = message;
    this._appendRunEvent(run, 'run.cancelled', message, null, 'warn');
    this._releaseJobFromRun(run, 'idle');
    this._persistState();
    return this._serializeRun(run);
  }

  _restoreTimers() {
    for (const job of this._jobs.values()) {
      if (job.scheduleAt && Date.parse(job.scheduleAt) > Date.now()) {
        job.status = 'scheduled';
        this._scheduleJob(job.id, Date.parse(job.scheduleAt));
      } else if (job.scheduleAt && Date.parse(job.scheduleAt) <= Date.now()) {
        job.status = 'scheduled';
        this._scheduleJob(job.id, Date.now());
      }
    }

    for (const run of this._runs.values()) {
      if (run.status === 'running' || run.status === 'starting') {
        run.status = 'interrupted';
        run.finishedAt = run.finishedAt || nowIso(this._now);
        run.updatedAt = nowIso(this._now);
        run.error = run.error || 'Run interrupted by server restart.';
        this._appendRunEvent(run, 'run.interrupted', run.error, null, 'warn');
        this._releaseJobFromRun(run, 'idle');
        continue;
      }

      if (run.status === 'retrying' && run.nextRetryAt) {
        this._scheduleRunRetry(run.id, Date.parse(run.nextRetryAt));
      }
    }

    this._persistState();
  }

  _ensureStateDir() {
    const dir = this._path.dirname(this._statePath);
    this._fs.mkdirSync(dir, { recursive: true });
  }

  _loadState() {
    this._jobs.clear();
    this._runs.clear();

    if (!this._fs.existsSync(this._statePath)) {
      return;
    }

    try {
      const raw = this._fs.readFileSync(this._statePath, 'utf8');
      const parsed = JSON.parse(raw);
      const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      const runs = Array.isArray(parsed.runs) ? parsed.runs : [];

      for (const entry of jobs) {
        const normalized = normalizeJobRecord(entry);
        if (normalized) {
          this._jobs.set(normalized.id, normalized);
        }
      }

      for (const entry of runs) {
        const normalized = normalizeRunRecord(entry);
        if (normalized) {
          this._runs.set(normalized.id, normalized);
        }
      }
    } catch (error) {
      this._lastError = `Failed to load executor state: ${toErrorMessage(error)}`;
    }
  }

  _persistState() {
    this._ensureStateDir();
    const document = {
      version: STATE_VERSION,
      jobs: Array.from(this._jobs.values()).map((job) => this._serializeJob(job)),
      runs: Array.from(this._runs.values())
        .sort((left, right) => Date.parse(left.createdAt || '') - Date.parse(right.createdAt || ''))
        .slice(-MAX_RUN_ENTRIES)
        .map((run) => this._serializeRun(run)),
    };

    this._fs.writeFileSync(this._statePath, JSON.stringify(document, null, 2));
  }

  _trimRuns() {
    const allRuns = Array.from(this._runs.values())
      .sort((left, right) => Date.parse(left.createdAt || '') - Date.parse(right.createdAt || ''));
    while (allRuns.length > MAX_RUN_ENTRIES) {
      const oldest = allRuns.shift();
      if (!oldest) break;
      if (['starting', 'running', 'retrying'].includes(oldest.status)) {
        allRuns.push(oldest);
        break;
      }
      this._runs.delete(oldest.id);
    }
  }

  _serializeJob(job) {
    return clone(job);
  }

  _serializeRun(run) {
    return clone(run);
  }

  _appendRunEvent(run, type, message, data, level = 'info') {
    run.events.push({
      at: nowIso(this._now),
      type,
      level,
      message,
      data: isObject(data) ? clone(data) : null,
    });
    if (run.events.length > MAX_EVENT_ENTRIES) {
      run.events.splice(0, run.events.length - MAX_EVENT_ENTRIES);
    }
    run.updatedAt = nowIso(this._now);
  }

  _releaseJobFromRun(run, nextJobStatus) {
    const job = this._jobs.get(run.jobId);
    if (!job) return;
    if (job.activeRunId === run.id) {
      job.activeRunId = null;
    }
    job.status = nextJobStatus;
    job.updatedAt = nowIso(this._now);
  }

  _scheduleJob(jobId, whenMs) {
    const key = `job:${jobId}`;
    this._clearTimer(key);
    const delayMs = Math.max(0, whenMs - Date.now());
    const timer = this._setTimeout(() => {
      this._timers.delete(key);
      this.triggerJob(jobId, { source: 'schedule' }).catch((error) => {
        this._lastError = `Scheduled job failed: ${toErrorMessage(error)}`;
      });
    }, delayMs);
    this._timers.set(key, timer);
  }

  _scheduleRunRetry(runId, whenMs) {
    const key = `run:${runId}`;
    this._clearTimer(key);
    const delayMs = Math.max(0, whenMs - Date.now());
    const timer = this._setTimeout(() => {
      this._timers.delete(key);
      this._startAttempt(runId, { source: 'retry' }).catch((error) => {
        this._lastError = `Retry attempt failed: ${toErrorMessage(error)}`;
      });
    }, delayMs);
    this._timers.set(key, timer);
  }

  _clearTimer(key) {
    const timer = this._timers.get(key);
    if (!timer) return;
    this._clearTimeout(timer);
    this._timers.delete(key);
  }

  async _startAttempt(runId, options = {}) {
    const run = this._runs.get(asTrimmedString(runId));
    if (!run) {
      throw new Error('Executor run not found');
    }

    const job = this._jobs.get(run.jobId);
    if (!job) {
      throw new Error('Executor job not found');
    }

    run.attemptCount += 1;
    run.startedAt = run.startedAt || nowIso(this._now);
    run.finishedAt = null;
    run.nextRetryAt = null;
    run.error = null;
    run.status = 'starting';
    job.status = 'starting';
    job.activeRunId = run.id;
    job.updatedAt = nowIso(this._now);

    this._appendRunEvent(
      run,
      'attempt.started',
      `Attempt ${run.attemptCount} started.`,
      { source: asTrimmedString(options.source) || 'manual' },
      'info'
    );
    this._persistState();

    let sessionId = run.sessionId;
    let createdSession = false;

    try {
      if (job.targetType === 'existing-session') {
        sessionId = sanitizeSessionId(job.existingSessionId);
        const existingSession = sessionId ? this._sdkBridge.getSdkSession(sessionId) : null;
        if (!sessionId || !existingSession) {
          throw Object.assign(new Error('Target SDK session is not available. Existing-session jobs require a live session.'), { statusCode: 409 });
        }
      } else {
        const sandboxConfig = assertValidSandboxJobConfig(job.contextType, job.sandboxId);
        const existingRecord = sessionId ? this._sdkBridge.getSdkSession(sessionId) : null;
        if (!existingRecord) {
          const created = await this._sdkBridge.createSdkSession({
            model: job.model || undefined,
            contextType: sandboxConfig.contextType,
            sandboxId: sandboxConfig.sandboxId || undefined,
          });
          sessionId = sanitizeSessionId(created && created.sessionId);
          createdSession = true;
        }
      }

      if (!sessionId) {
        throw new Error('Executor run did not resolve a valid SDK session.');
      }

      const activeRunId = this._activeRunsBySession.get(sessionId);
      if (activeRunId && activeRunId !== run.id) {
        throw Object.assign(new Error('Target SDK session already has an active executor run.'), { statusCode: 409 });
      }

      run.sessionId = sessionId;
      run.createdSession = run.createdSession || createdSession;

      const sdkSession = this._sdkBridge.getSdkSession(sessionId);
      if (!sdkSession || !sdkSession.session || typeof sdkSession.session.on !== 'function') {
        throw new Error('Unable to subscribe to SDK session events.');
      }

      await this._detachRunSubscription(run.id);

      const unsubscribe = sdkSession.session.on((event) => {
        this._handleSessionEvent(run.id, event);
      });

      this._runSubscriptions.set(run.id, { sessionId, unsubscribe: typeof unsubscribe === 'function' ? unsubscribe : null });
      this._activeRunsBySession.set(sessionId, run.id);

      const sendResult = await this._sdkBridge.sendToSession(sessionId, {
        prompt: job.prompt,
        mode: 'enqueue',
      });

      run.messageId = asTrimmedString(sendResult && sendResult.messageId) || null;
      run.status = 'running';
      job.status = 'running';
      this._appendRunEvent(run, 'attempt.enqueued', `Prompt sent to session ${sessionId}.`, {
        sessionId,
        messageId: run.messageId,
      }, 'info');
      this._persistState();
    } catch (error) {
      await this._detachRunSubscription(run.id);
      if (sessionId) {
        this._activeRunsBySession.delete(sessionId);
      }
      await this._failRun(run.id, error);
    }
  }

  async _detachRunSubscription(runId) {
    const record = this._runSubscriptions.get(runId);
    if (!record) {
      return;
    }
    if (typeof record.unsubscribe === 'function') {
      try {
        await record.unsubscribe();
      } catch {
        // Ignore listener cleanup failures.
      }
    }
    this._runSubscriptions.delete(runId);
  }

  _handleSessionEvent(runId, event) {
    const run = this._runs.get(runId);
    if (!run || !['running', 'starting'].includes(run.status)) {
      return;
    }

    const eventType = isObject(event) ? asTrimmedString(event.type) : '';
    const data = isObject(event) && isObject(event.data) ? event.data : {};
    const message = asTrimmedString(data.message)
      || asTrimmedString(data.text)
      || (eventType ? `${eventType} received.` : 'Session event received.');

    let level = 'info';
    if (eventType === 'session.error') {
      level = 'error';
    } else if (eventType === 'tool.executing' || eventType === 'tool.execution_start') {
      level = 'info';
    } else if (eventType === 'tool.completed' || eventType === 'tool.execution_complete') {
      level = 'success';
    }

    this._appendRunEvent(run, eventType || 'session.event', message, data, level);

    if (eventType === 'assistant.message' && asTrimmedString(data.text)) {
      run.summary = asTrimmedString(data.text);
    }

    this._persistState();

    if (eventType === 'session.error') {
      void this._failRun(runId, Object.assign(new Error(message), { eventData: data }));
      return;
    }

    if (eventType === 'session.idle') {
      void this._completeRun(runId);
    }
  }

  async _completeRun(runId) {
    const run = this._runs.get(runId);
    if (!run || !['running', 'starting'].includes(run.status)) {
      return;
    }

    await this._detachRunSubscription(run.id);
    if (run.sessionId) {
      this._activeRunsBySession.delete(run.sessionId);
    }

    run.status = 'succeeded';
    run.finishedAt = nowIso(this._now);
    run.updatedAt = run.finishedAt;
    this._appendRunEvent(run, 'run.completed', 'Run completed successfully.', {
      sessionId: run.sessionId,
    }, 'success');
    this._releaseJobFromRun(run, 'idle');
    this._persistState();
  }

  async _failRun(runId, error) {
    const run = this._runs.get(runId);
    if (!run || ['failed', 'succeeded', 'cancelled'].includes(run.status)) {
      return;
    }

    const job = this._jobs.get(run.jobId);
    if (!job) {
      return;
    }

    await this._detachRunSubscription(run.id);
    if (run.sessionId) {
      this._activeRunsBySession.delete(run.sessionId);
    }

    const classification = classifyError(error);
    run.error = classification.message;
    this._appendRunEvent(run, 'run.failed', classification.message, null, 'error');

    if (classification.isRateLimited && job.retryPolicy.enabled && run.attemptCount < job.retryPolicy.maxAttempts) {
      const delayMs = this._computeRetryDelay(run, job.retryPolicy, classification.retryAfterMs);
      const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

      run.status = 'retrying';
      run.nextRetryAt = nextRetryAt;
      run.updatedAt = nowIso(this._now);
      job.status = 'retrying';
      job.activeRunId = run.id;
      job.updatedAt = nowIso(this._now);

      if (run.createdSession && run.sessionId) {
        try {
          await this._sdkBridge.destroySdkSession(run.sessionId, { reason: 'executor-retry' });
        } catch {
          // Best-effort cleanup before retry.
        }
        run.sessionId = null;
      }

      this._appendRunEvent(run, 'retry.scheduled', `Retry ${run.attemptCount + 1} scheduled.`, {
        nextRetryAt,
        delayMs,
      }, 'warn');
      this._persistState();
      this._scheduleRunRetry(run.id, Date.parse(nextRetryAt));
      return;
    }

    run.status = 'failed';
    run.finishedAt = nowIso(this._now);
    run.updatedAt = run.finishedAt;
    this._releaseJobFromRun(run, 'idle');
    this._persistState();
  }

  _computeRetryDelay(run, retryPolicy, retryAfterMs) {
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(retryAfterMs, retryPolicy.maxDelayMs);
    }

    const exponent = Math.max(0, run.attemptCount - 1);
    const rawDelay = retryPolicy.baseDelayMs * Math.pow(retryPolicy.backoffMultiplier, exponent);
    const boundedDelay = Math.min(rawDelay, retryPolicy.maxDelayMs);
    const jitterWindow = boundedDelay * retryPolicy.jitterRatio;
    const jitterOffset = jitterWindow > 0 ? (Math.random() * jitterWindow * 2) - jitterWindow : 0;
    return Math.max(1000, Math.round(boundedDelay + jitterOffset));
  }
}

function createExecutorService(config = {}, deps = {}) {
  return new ExecutorService(config, deps);
}

module.exports = {
  DEFAULT_RETRY_POLICY,
  ExecutorService,
  createExecutorService,
};
