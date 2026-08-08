'use strict';

const path = require('node:path');
const defaultChildProcess = require('node:child_process');

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_CACHE_MAX_ENTRIES = 200;
const SAFE_COMMAND_LABELS = new Set(['git', 'gh', 'npm', 'npx', 'node', 'clangd', 'where', 'where.exe', 'which']);

function asText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value || '');
}

function commandLabel(command) {
  const basename = path.basename(String(command || '')).toLowerCase().replace(/\.exe$/i, '');
  return SAFE_COMMAND_LABELS.has(basename) ? basename : 'other';
}

function normalizeResult(error, stdout, stderr, startedAt) {
  const status = error
    ? (typeof error.code === 'number' ? error.code : typeof error.status === 'number' ? error.status : 1)
    : 0;
  return {
    status,
    stdout: asText(stdout),
    stderr: asText(stderr),
    timedOut: Boolean(error && error.code === 'ETIMEDOUT'),
    aborted: Boolean(error && error.code === 'ABORT_ERR'),
    outputLimited: Boolean(error && (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(error.message || ''))),
    error: error ? String(error.message || error) : null,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function defaultTerminateProcessTree(child, runOptions = {}) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      defaultChildProcess.execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        timeout: 1_000,
      }, () => {
        try { child.kill('SIGKILL'); } catch { /* already exited */ }
        resolve();
      });
    });
  }

  return new Promise((resolve) => {
    let finished = false;
    let escalation = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (escalation) clearTimeout(escalation);
      resolve();
    };
    if (typeof child.once === 'function') child.once('close', finish);
    try {
      if (runOptions.detached !== false) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      try { child.kill('SIGTERM'); } catch { finish(); return; }
    }
    escalation = setTimeout(() => {
      try {
        if (runOptions.detached !== false) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* already exited */ }
      setTimeout(finish, 50);
    }, 250);
  });
}

function createAsyncProcessService(options = {}) {
  const childProcess = options.childProcess || defaultChildProcess;
  const terminateTree = options.terminateTree || defaultTerminateProcessTree;
  const cacheMaxEntries = Number.isFinite(options.cacheMaxEntries)
    ? Math.max(1, Number(options.cacheMaxEntries))
    : DEFAULT_CACHE_MAX_ENTRIES;
  const inFlight = new Map();
  const cache = new Map();
  const stats = {
    started: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    outputLimited: 0,
    cacheHits: 0,
    dedupeHits: 0,
    totalDurationMs: 0,
    byCommand: Object.create(null),
  };

  function pruneCache(now = Date.now()) {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size > cacheMaxEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  function buildKey(command, args, runOptions) {
    if (runOptions.dedupe === false) return null;
    if (typeof runOptions.dedupeKey === 'string' && runOptions.dedupeKey) return runOptions.dedupeKey;
    return JSON.stringify([
      String(command),
      Array.isArray(args) ? args.map(String) : [],
      runOptions.cwd ? path.resolve(runOptions.cwd) : '',
      runOptions.envKey || '',
      runOptions.shell === true,
    ]);
  }

  function abortedResult(startedAt = Date.now()) {
    return normalizeResult(Object.assign(new Error('Process aborted'), { code: 'ABORT_ERR' }), '', '', startedAt);
  }

  function subscribeToFlight(entry, signal, decorate = {}) {
    entry.subscribers += 1;
    return new Promise((resolve) => {
      let finished = false;
      const finish = (result) => {
        if (finished) return;
        finished = true;
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
        entry.subscribers = Math.max(0, entry.subscribers - 1);
        resolve({ ...result, ...decorate });
      };
      const onAbort = () => {
        finish(abortedResult());
        if (entry.subscribers === 0 && !entry.settled) entry.controller.abort();
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(finish);
    });
  }

  function execute(command, args, runOptions) {
    const startedAt = Date.now();
    const timeout = Number.isFinite(runOptions.timeoutMs)
      ? Math.max(1, Number(runOptions.timeoutMs))
      : DEFAULT_TIMEOUT_MS;
    const maxBuffer = Number.isFinite(runOptions.maxOutputBytes)
      ? Math.max(1024, Number(runOptions.maxOutputBytes))
      : DEFAULT_MAX_OUTPUT_BYTES;
    stats.started += 1;

    return new Promise((resolve) => {
      let settled = false;
      let timeoutHandle = null;
      let child = null;
      let terminating = null;
      const signal = runOptions.signal;

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const done = (error, stdout, stderr) => {
        if (settled) return;
        settled = true;
        cleanup();
        const result = normalizeResult(error, stdout, stderr, startedAt);
        const label = commandLabel(command);
        stats.completed += 1;
        stats.totalDurationMs += result.durationMs;
        stats.byCommand[label] = (stats.byCommand[label] || 0) + 1;
        if (result.status !== 0) stats.failed += 1;
        if (result.timedOut) stats.timedOut += 1;
        if (result.outputLimited) stats.outputLimited += 1;
        resolve(result);
      };

      const onAbort = () => {
        const error = Object.assign(new Error('Process aborted'), { code: 'ABORT_ERR', killed: true });
        beginTermination(error);
      };

      const beginTermination = (error) => {
        if (settled || terminating) return;
        terminating = Promise.resolve(terminateTree(child, runOptions))
          .catch(() => undefined)
          .finally(() => done(error, '', ''));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      if (typeof childProcess.execFile === 'function') {
        try {
          child = childProcess.execFile(command, args, {
            cwd: runOptions.cwd,
            env: runOptions.env,
            encoding: 'utf8',
            windowsHide: true,
            shell: runOptions.shell === true,
            detached: process.platform !== 'win32' && runOptions.detached !== false,
            maxBuffer,
          }, (error, stdout, stderr) => {
            if (terminating) return;
            if (error && (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxbuffer/i.test(error.message || ''))) {
              beginTermination(error);
              return;
            }
            done(error, stdout, stderr);
          });
          timeoutHandle = setTimeout(() => {
            const error = Object.assign(new Error(`Process timed out after ${timeout}ms`), {
              code: 'ETIMEDOUT',
              killed: true,
            });
            beginTermination(error);
          }, timeout);
          if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();
          if (signal && typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        } catch (error) {
          done(error, '', '');
        }
        return;
      }

      // Compatibility for existing injected test doubles. Production always
      // uses execFile so request handling remains non-blocking.
      if (typeof childProcess.spawnSync === 'function') {
        queueMicrotask(() => {
          try {
            const result = childProcess.spawnSync(command, args, {
              cwd: runOptions.cwd,
              env: runOptions.env,
              encoding: 'utf8',
              windowsHide: true,
              shell: runOptions.shell === true,
              timeout,
              maxBuffer,
            }) || {};
            const error = result.error || (result.status && Object.assign(new Error(asText(result.stderr) || `Process exited with status ${result.status}`), { code: result.status }));
            done(error, result.stdout, result.stderr);
          } catch (error) {
            done(error, '', '');
          }
        });
        return;
      }

      done(new Error('No child process execution implementation is available'), '', '');
    });
  }

  function run(command, args = [], runOptions = {}) {
    if (typeof command !== 'string' || !command.trim()) {
      return Promise.resolve(normalizeResult(new Error('command is required'), '', '', Date.now()));
    }
    if (!Array.isArray(args)) {
      return Promise.resolve(normalizeResult(new Error('args must be an array'), '', '', Date.now()));
    }
    if (runOptions.signal?.aborted) return Promise.resolve(abortedResult());

    const key = buildKey(command, args, runOptions);
    const now = Date.now();
    pruneCache(now);
    if (key) {
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now) {
        stats.cacheHits += 1;
        return Promise.resolve({ ...cached.result, cached: true });
      }
      const existing = inFlight.get(key);
      if (existing) {
        stats.dedupeHits += 1;
        return subscribeToFlight(existing, runOptions.signal, { deduped: true });
      }
    }

    const controller = new AbortController();
    const entry = { promise: null, controller, subscribers: 0, settled: false };
    const executionOptions = key ? { ...runOptions, signal: controller.signal } : runOptions;
    const promise = execute(command, args.map(String), executionOptions)
      .then((result) => {
        const cacheTtlMs = Number(runOptions.cacheTtlMs);
        if (key && result.status === 0 && !result.aborted && !result.timedOut
          && !result.outputLimited && Number.isFinite(cacheTtlMs) && cacheTtlMs > 0) {
          cache.set(key, { result: { ...result }, expiresAt: Date.now() + cacheTtlMs });
          pruneCache();
        }
        return result;
      })
      .finally(() => {
        entry.settled = true;
        if (key && inFlight.get(key) === entry) inFlight.delete(key);
      });
    entry.promise = promise;
    if (key) {
      inFlight.set(key, entry);
      return subscribeToFlight(entry, runOptions.signal);
    }
    return promise;
  }

  function getDiagnostics() {
    pruneCache();
    return {
      schemaVersion: 'async-process-performance/v1',
      inFlight: inFlight.size,
      cacheEntries: cache.size,
      started: stats.started,
      completed: stats.completed,
      failed: stats.failed,
      timedOut: stats.timedOut,
      outputLimited: stats.outputLimited,
      cacheHits: stats.cacheHits,
      dedupeHits: stats.dedupeHits,
      averageDurationMs: stats.completed > 0
        ? Number((stats.totalDurationMs / stats.completed).toFixed(1))
        : 0,
      byCommand: { ...stats.byCommand },
    };
  }

  return { run, getDiagnostics };
}

let defaultService = null;

function getDefaultAsyncProcessService() {
  if (!defaultService) defaultService = createAsyncProcessService();
  return defaultService;
}

module.exports = {
  createAsyncProcessService,
  getDefaultAsyncProcessService,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
};
