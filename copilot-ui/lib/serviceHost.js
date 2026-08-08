'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');

const execFile = promisify(childProcess.execFile);

const SERVICE_IDS = Object.freeze(['overseer', 'opportunity-world-model']);
const SERVICE_SCHEMA = 'elegy.intelligence-surface.v1';
const COMMAND_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 15_000;
const HEALTH_TIMEOUT_MS = 3_000;
const START_POLL_INTERVAL_MS = 250;

function normalizeId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return SERVICE_IDS.includes(id) ? id : null;
}

function createDescriptors(engineRoot, repositoryPaths) {
  const root = path.resolve(engineRoot);
  const resolveRepo = (id, directory) => {
    const canonical = id === 'overseer'
      ? path.resolve(root, '..', '..', 'overseer')
      : path.resolve(root, '..', directory);
    const requested = repositoryPaths && repositoryPaths[id] ? path.resolve(repositoryPaths[id]) : canonical;
    return { path: requested, canonical };
  };
  const overseerRepo = resolveRepo('overseer', 'Overseer');
  const worldModelRepo = resolveRepo('opportunity-world-model', 'opportunity-world-model');

  return {
    overseer: {
      id: 'overseer',
      name: 'Overseer',
      description: 'Portfolio context, decisions, and work-brain intelligence.',
      repositoryPath: overseerRepo.path,
      canonicalRepositoryPath: overseerRepo.canonical,
      identity: { type: 'package_json_name', file: 'package.json', value: 'overseer-knowledge-base' },
      requiredFiles: ['package.json', 'scripts/start-overseer.ps1', 'scripts/status-overseer.ps1', 'scripts/stop-overseer.ps1'],
      statusScript: 'scripts/status-overseer.ps1',
      startScript: 'scripts/start-overseer.ps1',
      stopScript: 'scripts/stop-overseer.ps1',
      startArgs: ['-NoBrowser', '-Port', '4173'],
      statusArgs: ['-Port', '4173'],
      stopArgs: [],
      consoleUrl: 'http://127.0.0.1:4173/dashboard/?embed=elegy#/work-brain',
      healthUrl: 'http://127.0.0.1:4173/api/health',
      healthKind: 'overseer',
    },
    'opportunity-world-model': {
      id: 'opportunity-world-model',
      name: 'Opportunity Intelligence Engine',
      description: 'Generic read-only research of economic opportunities: mandates, frontier questions, runs, and evidence.',
      repositoryPath: worldModelRepo.path,
      canonicalRepositoryPath: worldModelRepo.canonical,
      identity: { type: 'cargo_workspace', file: 'Cargo.toml', value: '[workspace]' },
      requiredFiles: ['Cargo.toml', 'scripts/start-local.ps1', 'scripts/status-local.ps1', 'scripts/stop-local.ps1'],
      statusScript: 'scripts/status-local.ps1',
      startScript: 'scripts/start-local.ps1',
      stopScript: 'scripts/stop-local.ps1',
      startArgs: [],
      statusArgs: ['-Json'],
      stopArgs: [],
      consoleUrl: 'http://127.0.0.1:7400/?embed=elegy&view=oie',
      healthUrl: 'http://127.0.0.1:7400/healthz',
      healthKind: 'owm',
    },
  };
}

function safeStatus(rawStatus) {
  const value = String(rawStatus || '').trim().toLowerCase();
  if (value === 'ready' || value === 'already_ready' || value === 'started') return 'ready';
  if (value === 'degraded' || value === 'starting' || value === 'starting_or_unhealthy') return 'degraded';
  if (value === 'stopped' || value === 'missing') return 'stopped';
  return 'unavailable';
}

function safeReason(rawReason, fallback) {
  const value = String(rawReason || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value) ? value : fallback;
}

function isHealthyResponse(descriptor, response, payload) {
  if (!response || response.status !== 200 || !payload || typeof payload !== 'object') return false;
  if (descriptor.healthKind === 'overseer') return payload.format === 'overseer.health/v1';
  return payload.status === 'ok';
}

function safeHealthStatus(descriptor, payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (descriptor.healthKind === 'overseer') {
    return {
      format: payload.format === 'overseer.health/v1' ? payload.format : null,
      snapshotStatus: safeReason(payload.snapshot_status, 'unknown'),
    };
  }
  return { status: safeReason(payload.status, 'unknown') };
}

function createServiceHost(options = {}) {
  const engineRoot = path.resolve(options.engineRoot || path.resolve(__dirname, '..', '..'));
  const descriptors = createDescriptors(engineRoot, options.repositoryPaths);
  const fileExists = options.fileExists || fs.existsSync;
  const readFile = options.readFile || ((candidate, encoding) => fs.readFileSync(candidate, encoding));
  const directoryExists = options.directoryExists || ((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
  const execImpl = options.execFile || execFile;
  const spawnImpl = options.spawn || childProcess.spawn;
  const requestImpl = options.request || (typeof fetch === 'function' ? fetch : null);
  const now = options.now || (() => new Date());
  const operations = new Map();
  const snapshots = new Map();

  function remember(result) {
    snapshots.set(result.id, result);
    return result;
  }

  function descriptorFor(id) {
    const normalized = normalizeId(id);
    if (!normalized) {
      const error = new Error('unknown_service');
      error.code = 'unknown_service';
      throw error;
    }
    return descriptors[normalized];
  }

  function preflight(descriptor) {
    if (descriptor.repositoryPath !== descriptor.canonicalRepositoryPath) {
      return { ok: false, reasonCode: 'repository_path_unapproved', prerequisites: ['repository_path_unapproved'] };
    }
    if (!directoryExists(descriptor.repositoryPath)) {
      return { ok: false, reasonCode: 'repository_missing', prerequisites: ['repository_missing'] };
    }
    const missing = descriptor.requiredFiles.filter((relative) => !fileExists(path.join(descriptor.repositoryPath, relative)));
    if (missing.length > 0) {
      return { ok: false, reasonCode: 'operator_script_missing', prerequisites: missing.map(() => 'operator_script_missing') };
    }
    try {
      const identityPath = path.join(descriptor.repositoryPath, descriptor.identity.file);
      const contents = String(readFile(identityPath, 'utf8'));
      const identityMatches = descriptor.identity.type === 'package_json_name'
        ? JSON.parse(contents).name === descriptor.identity.value
        : contents.includes(descriptor.identity.value);
      if (!identityMatches) return { ok: false, reasonCode: 'repository_identity_mismatch', prerequisites: ['repository_identity_mismatch'] };
    } catch {
      return { ok: false, reasonCode: 'repository_identity_mismatch', prerequisites: ['repository_identity_mismatch'] };
    }
    return { ok: true, reasonCode: null, prerequisites: [] };
  }

  function commandFor(descriptor, operation) {
    const relative = operation === 'start'
      ? descriptor.startScript
      : operation === 'stop' ? descriptor.stopScript : descriptor.statusScript;
    const args = operation === 'start'
      ? descriptor.startArgs
      : operation === 'stop' ? descriptor.stopArgs : descriptor.statusArgs;
    const scriptPath = path.resolve(descriptor.repositoryPath, relative);
    const commandArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      scriptPath,
      ...args,
    ];
    return { commandArgs, scriptPath };
  }

  async function runDetachedStart(descriptor) {
    const { commandArgs } = commandFor(descriptor, 'start');
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnImpl('pwsh', commandArgs, {
          cwd: descriptor.repositoryPath,
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch (error) {
        reject(error);
        return;
      }
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      if (child && typeof child.once === 'function') {
        child.once('error', (error) => settle(reject, error));
      }
      if (child && typeof child.unref === 'function') child.unref();
      setImmediate(() => settle(resolve));
    });
  }

  async function runFixedScript(descriptor, operation) {
    if (operation === 'start') {
      await runDetachedStart(descriptor);
      return { stdout: '', stderr: '' };
    }
    const { commandArgs } = commandFor(descriptor, operation);
    return execImpl('pwsh', commandArgs, {
      cwd: descriptor.repositoryPath,
      windowsHide: true,
      timeout: operation === 'status' ? STATUS_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
      maxBuffer: 128 * 1024,
    });
  }

  async function waitForReady(id) {
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;
    let latest = null;
    do {
      latest = await inspect(id, { ignoreOperation: true });
      if (latest.status === 'ready') return latest;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
    } while (Date.now() < deadline);
    const error = new Error('service_start_failed');
    error.code = 'service_start_failed';
    error.cause = latest;
    throw error;
  }

  async function readHealth(descriptor) {
    if (typeof requestImpl !== 'function') return { ok: false, payload: null, reasonCode: 'health_probe_unavailable' };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS) : null;
    try {
      const response = await requestImpl(descriptor.healthUrl, controller ? { signal: controller.signal } : undefined);
      let payload = null;
      try {
        payload = typeof response.json === 'function' ? await response.json() : null;
      } catch {
        payload = null;
      }
      return {
        ok: isHealthyResponse(descriptor, response, payload),
        payload,
        statusCode: Number.isInteger(response && response.status) ? response.status : null,
      };
    } catch {
      return { ok: false, payload: null, reasonCode: 'health_unavailable', statusCode: null };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function baseResult(descriptor, extra = {}) {
    return {
      schema: SERVICE_SCHEMA,
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
      consoleUrl: descriptor.consoleUrl,
      healthUrl: descriptor.healthUrl,
      checkedAt: now().toISOString(),
      ...extra,
    };
  }

  async function inspect(id, options = {}) {
    const descriptor = descriptorFor(id);
    if (!options.ignoreOperation && operations.has(descriptor.id)) {
      return remember(baseResult(descriptor, {
        status: 'starting',
        reasonCode: 'operation_in_progress',
        prerequisites: [],
      }));
    }
    const ready = preflight(descriptor);
    if (!ready.ok) {
      return remember(baseResult(descriptor, {
        status: 'prerequisite_missing',
        reasonCode: ready.reasonCode,
        prerequisites: ready.prerequisites,
      }));
    }

    let parsed;
    try {
      const result = await runFixedScript(descriptor, 'status');
      parsed = JSON.parse(String(result && result.stdout || '').trim());
    } catch {
      return remember(baseResult(descriptor, {
        status: 'unavailable',
        reasonCode: 'status_command_failed',
        prerequisites: [],
      }));
    }

    const observed = safeStatus(parsed.status);
    if (observed === 'stopped') {
      return remember(baseResult(descriptor, {
        status: 'stopped',
        reasonCode: safeReason(parsed.reason_code, 'stopped'),
        prerequisites: [],
      }));
    }

    const health = await readHealth(descriptor);
    if (health.ok) {
      return remember(baseResult(descriptor, {
        status: observed === 'ready' ? 'ready' : 'degraded',
        reasonCode: observed === 'ready' ? 'health_ready' : safeReason(parsed.reason_code, 'service_degraded'),
        prerequisites: [],
        health: safeHealthStatus(descriptor, health.payload),
      }));
    }

    return remember(baseResult(descriptor, {
      status: observed === 'ready' ? 'degraded' : 'unavailable',
      reasonCode: health.reasonCode || 'health_unavailable',
      prerequisites: [],
      health: { statusCode: health.statusCode || null },
    }));
  }

  async function withOperation(id, operation, action) {
    const descriptor = descriptorFor(id);
    if (operations.has(descriptor.id)) {
      const error = new Error('service_operation_in_progress');
      error.code = 'service_operation_in_progress';
      throw error;
    }
    const ready = preflight(descriptor);
    if (!ready.ok) {
      const error = new Error(ready.reasonCode);
      error.code = ready.reasonCode;
      throw error;
    }
    const promise = Promise.resolve().then(action).finally(() => operations.delete(descriptor.id));
    operations.set(descriptor.id, promise);
    return promise;
  }

  return {
    listDescriptors() {
      return SERVICE_IDS.map((id) => ({ ...descriptors[id] }));
    },
    getDescriptor(id) {
      return { ...descriptorFor(id) };
    },
    async listStatuses() {
      return Promise.all(SERVICE_IDS.map((id) => inspect(id)));
    },
    inspect,
    async assertFreshConfirmation(id, action, observedAt) {
      const descriptor = descriptorFor(id);
      const snapshot = snapshots.get(descriptor.id);
      const allowed = action === 'start'
        ? ['stopped', 'unavailable', 'degraded']
        : ['ready', 'degraded'];
      if (!snapshot || typeof observedAt !== 'string' || snapshot.checkedAt !== observedAt || !allowed.includes(snapshot.status)) {
        const error = new Error('confirmation_stale');
        error.code = 'confirmation_stale';
        throw error;
      }
      const latest = await inspect(id, { ignoreOperation: true });
      if (latest.status !== snapshot.status) {
        const error = new Error('confirmation_stale');
        error.code = 'confirmation_stale';
        throw error;
      }
      return true;
    },
    start(id) {
      return withOperation(id, 'start', async () => {
        const descriptor = descriptorFor(id);
        try {
          await runFixedScript(descriptor, 'start');
        } catch (error) {
          const wrapped = new Error('service_start_failed');
          wrapped.code = 'service_start_failed';
          wrapped.cause = error;
          throw wrapped;
        }
        return waitForReady(id);
      });
    },
    stop(id) {
      return withOperation(id, 'stop', async () => {
        const descriptor = descriptorFor(id);
        try {
          await runFixedScript(descriptor, 'stop');
        } catch (error) {
          const wrapped = new Error('service_stop_failed');
          wrapped.code = 'service_stop_failed';
          wrapped.cause = error;
          throw wrapped;
        }
        return inspect(id, { ignoreOperation: true });
      });
    },
  };
}

module.exports = {
  SERVICE_IDS,
  SERVICE_SCHEMA,
  createServiceHost,
};
