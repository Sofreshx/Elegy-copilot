'use strict';
const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const assets = require('./lib/assets');
const {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_PROVIDER_CONTRACT_VERSION,
  RUNTIME_PROVIDERS,
  RUNTIME_PROVIDER_SELECTION_SOURCES,
} = require('./lib/runtimeContracts');
const {
  FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION,
  FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION,
  PLANNING_API_CONTRACT_VERSION,
  PLANNING_PERSISTENCE_HEALTH_KIND,
  createPlanningApiState,
} = require('./lib/planningApiContracts');
const { acquirePlanningMutationRouteLock, startServer } = require('./server');
const serverPath = path.join(__dirname, 'server.js');
const TEST_SUITE_TIMEOUT_MS = 180_000; // 180 seconds for entire suite on Windows
// Track all spawned server processes for cleanup on unexpected exit
const trackedProcesses = new Set();
function trackProcess(proc) {
  trackedProcesses.add(proc);
  proc.on('exit', () => trackedProcesses.delete(proc));
  return proc;
}
function killTracked() {
  for (const proc of trackedProcesses) {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }
  trackedProcesses.clear();
}
process.on('exit', killTracked);
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function stopTrackedProcess(proc, timeoutMs = 5_000) {
  if (!proc || proc.exitCode != null || proc.killed) {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      proc.removeListener('exit', finish);
      proc.removeListener('close', finish);
      resolve();
    };
    proc.once('exit', finish);
    proc.once('close', finish);
    try {
      proc.kill();
    } catch {
      finish();
      return;
    }
    setTimeout(finish, timeoutMs);
  });
}
function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${e.message}; body=${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}
function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const requestUrl = new URL(url);
    const req = http.request({
      method: 'POST',
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: `${requestUrl.pathname}${requestUrl.search}`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(responseBody) });
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${e.message}; body=${responseBody}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function startMockTrackerStatusServer(expectedToken = 'ws2-tracker-token') {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/api/status') {
        const auth = String(req.headers.authorization || '');
        if (auth !== `Bearer ${expectedToken}`) {
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          schemaVersion: 1,
          contractVersion: 'messaging_gateway_readiness_v1',
          compatibility: {
            normalizedFrom: 'v1',
            deterministic: true,
          },
          readiness: {
            state: 'ready',
            reasonCode: 'gateway_ready',
            deterministic: true,
          },
          lastUpdatedUtc: new Date().toISOString(),
          config: {
            configPath: 'C:\\mock\\gateway-config.json',
            mode: 'connected',
            allowlists: {
              discordUsersCount: 1,
              workspaceRootsCount: 1,
            },
            workspaces: {
              activeRoot: 'C:\\mock',
            },
          },
          secrets: {
            discordBotToken: { present: false, fromKeychain: false, fromEnv: false },
            gatewayHttpToken: { present: true, fromKeychain: true, fromEnv: false },
            telegramBotToken: { present: false, fromKeychain: false, fromEnv: false },
          },
          runtime: {
            discord: { connected: true, ready: true },
            discoveryTelemetry: {
              contractVersion: 'skill_discovery_telemetry_v1',
              sample: { capacity: 12, size: 0, dropped: 0, deterministic: true },
              countersByReason: {
                keyword_miss: 0,
                ambiguity: 0,
                stale_map: 0,
                no_route: 0,
              },
              recent: [],
            },
          },
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'not_found' }));
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      resolve({
        server,
        port,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}
async function waitForHealth(baseUrl, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetchJson(`${baseUrl}/api/health`);
      if (response.statusCode === 200) return response;
    } catch {
      // retry
    }
    await sleep(100);
  }
  throw new Error('Timed out waiting for server health endpoint');
}
function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-runtime-health-'));
  return Promise.resolve()
    .then(() => fn(dir))
    .finally(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });
}
async function withPatchedEnv(overrides, fn) {
  const updates = overrides && typeof overrides === 'object' ? overrides : {};
  const previous = {};
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
async function run() {
  await test('planning mutation route lock rejects overlapping same-idempotency requests with deterministic conflict', async () => {
    const planningApiState = createPlanningApiState();
    const context = { userId: 'user-1', repoId: 'repo-1' };
    const first = acquirePlanningMutationRouteLock({
      planningApiState,
      pathname: '/api/planning/records',
      method: 'POST',
      context,
      idempotencyKey: 'same-key-overlap',
      requestId: null,
      nowMs: 1000,
    });
    assert.strictEqual(first.ok, true);
    assert.ok(first.lock);
    assert.ok(first.lock.lock);
    assert.strictEqual(typeof first.lock.lock.ownerId, 'string');
    assert.ok(first.lock.lock.ownerId.length > 0);
    const second = acquirePlanningMutationRouteLock({
      planningApiState,
      pathname: '/api/planning/records',
      method: 'POST',
      context,
      idempotencyKey: 'same-key-overlap',
      requestId: null,
      nowMs: 1001,
    });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.statusCode, 409);
    assert.strictEqual(second.body.code, 'planning_route_lock_conflict');
    assert.strictEqual(second.body.reason, 'lock_already_held');
  });
  await test('health payload includes deterministic runtime compatibility contract', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_RUNTIME_MODE: 'packaged',
          INSTRUCTION_ENGINE_FORCE_DOCKER_STATE: 'unavailable',
          INSTRUCTION_ENGINE_FORCE_WSL2_STATE: 'unavailable',
          INSTRUCTION_ENGINE_FORCE_SANDBOX_STATE: 'unavailable',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER: 'docker',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'non-docker',
          INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        const response = await waitForHealth(baseUrl);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.body.ok, true);
        assert.ok(response.body.runtime);
        assert.strictEqual(response.body.runtime.mode, 'packaged');
        assert.strictEqual(response.body.runtime.contractVersion, RUNTIME_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.capabilities.docker, 'unavailable');
        assert.strictEqual(response.body.runtime.capabilities.wsl2, 'unavailable');
        assert.strictEqual(response.body.runtime.capabilities.sandbox, 'unavailable');
        assert.ok(response.body.runtime.provider);
        assert.strictEqual(response.body.runtime.provider.contractVersion, RUNTIME_PROVIDER_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.provider.selectedProvider, RUNTIME_PROVIDERS.DOCKER);
        assert.strictEqual(response.body.runtime.provider.defaultProvider, RUNTIME_PROVIDERS.NON_DOCKER);
        assert.strictEqual(response.body.runtime.provider.selectionSource, RUNTIME_PROVIDER_SELECTION_SOURCES.EXPLICIT);
        assert.ok(response.body.runtime.finishCompatibilityHook);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.kind, 'lifecycle.finish.compatibility-hook');
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.providerAgnostic, true);
        assert.ok(response.body.runtime.finishCompatibilityHook.receipt);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.receipt.contractVersion, FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION);
        assert.ok(response.body.planningPersistence);
        assert.strictEqual(response.body.planningPersistence.contractVersion, '1');
        assert.strictEqual(response.body.planningPersistence.kind, PLANNING_PERSISTENCE_HEALTH_KIND);
        assert.strictEqual(response.body.planningPersistence.deterministic, true);
        assert.strictEqual(response.body.planningPersistence.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
        assert.strictEqual(response.body.planningPersistence.status, 'disabled');
        assert.strictEqual(response.body.planningPersistence.required, false);
        assert.strictEqual(response.body.planningPersistence.configured, false);
        assert.strictEqual(response.body.planningPersistence.usable, false);
        assert.deepStrictEqual(response.body.planningPersistence.errors, []);
        assert.strictEqual(response.body.planningPersistence.lastError, null);
        assert.ok(response.body.planningPersistence.governance);
        assert.strictEqual(response.body.planningPersistence.governance.deterministic, true);
        assert.strictEqual(response.body.planningPersistence.governance.failClosed, true);
        assert.strictEqual(response.body.planningPersistence.governance.ready, false);
        assert.strictEqual(response.body.planningPersistence.governance.code, 'planning_persistence_disabled');
        assert.strictEqual(response.body.planningPersistence.governance.reason, 'planning_persistence_disabled');
        assert.ok(Array.isArray(response.body.planningPersistence.governance.reasonCodes));
        assert.ok(response.body.planningPersistence.migrations);
        assert.strictEqual(response.body.planningPersistence.migrations.schemaTable, 'ie_schema_versions');
        assert.ok(response.body.planningPersistence.migrations.manifestCount >= 1);
        assert.strictEqual(typeof response.body.planningPersistence.migrations.checksumBaseline, 'string');
        assert.strictEqual(response.body.planningPersistence.migrations.baselineEnforced, true);
        assert.strictEqual(response.body.planningPersistence.migrations.baselineMismatch, false);
        assert.strictEqual(response.body.planningPersistence.migrations.appliedCount, 0);
        assert.deepStrictEqual(response.body.planningPersistence.migrations.appliedVersions, []);
        assert.strictEqual(response.body.planningPersistence.migrations.driftDetected, false);
        assert.ok(response.body.planningPersistence.migrations.checksumValidation);
        assert.strictEqual(response.body.planningPersistence.migrations.checksumValidation.outcome, 'pass');
        assert.strictEqual(response.body.planningPersistence.migrations.checksumValidation.reason, 'all_manifest_checksums_match');
        assert.strictEqual(response.body.planningPersistence.migrations.checksumValidation.baselineMismatch, false);
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('health payload defaults provider to non-docker when explicit selection is absent or invalid', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_RUNTIME_MODE: 'repo',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'not-a-provider',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER: '',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'also-invalid',
          INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        const response = await waitForHealth(baseUrl);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.body.ok, true);
        assert.ok(response.body.runtime);
        assert.ok(response.body.runtime.provider);
        assert.strictEqual(response.body.runtime.provider.contractVersion, RUNTIME_PROVIDER_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.provider.selectedProvider, RUNTIME_PROVIDERS.NON_DOCKER);
        assert.strictEqual(response.body.runtime.provider.defaultProvider, RUNTIME_PROVIDERS.NON_DOCKER);
        assert.strictEqual(response.body.runtime.provider.selectionSource, RUNTIME_PROVIDER_SELECTION_SOURCES.DEFAULT);
        assert.ok(response.body.runtime.finishCompatibilityHook);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
        assert.strictEqual(response.body.runtime.finishCompatibilityHook.providerAgnostic, true);
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('sessions API exposes deterministic artifact-authority reconciliation metadata in merged all-source view', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(path.join(elegyHome, 'session-state', 'reconcile-1'), { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_DISABLE_STARTUP_ASSET_SYNC: '1',
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        await waitForHealth(baseUrl);
        const sessionsResponse = await fetchJson(`${baseUrl}/api/sessions?source=all&dedupe=on`);
        assert.strictEqual(sessionsResponse.statusCode, 200);
        assert.ok(Array.isArray(sessionsResponse.body.sessions));
        const merged = sessionsResponse.body.sessions.find((entry) => entry.canonicalKey === 'reconcile-1');
        assert.ok(merged);
        assert.strictEqual(merged.mergedCount, 1);
        assert.strictEqual(merged.authority, 'fs');
        assert.ok(merged.reconciliation);
        assert.strictEqual(merged.reconciliation.deterministic, true);
        assert.strictEqual(merged.reconciliation.reason, 'artifact_only');
        assert.strictEqual(merged.reconciliation.sourceOfTruth, 'artifact');
        assert.deepStrictEqual(merged.reconciliation.sourcePrecedence, ['artifact']);
        assert.strictEqual(merged.reconciliation.hasRuntimeState, false);
        assert.strictEqual(merged.reconciliation.hasArtifactState, true);
        assert.deepStrictEqual(merged.reconciliation.sourceSet, ['cli']);
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('planning durability routes fail closed with explicit dependency marker when WS3 authority gate is not ready', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
          INSTRUCTION_ENGINE_FORCE_WS3_AUTHORITY_GATE_BLOCKED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        const health = await waitForHealth(baseUrl);
        assert.strictEqual(health.statusCode, 200);
        assert.ok(health.body.planningDurabilityDependencyGate);
        assert.strictEqual(health.body.planningDurabilityDependencyGate.ready, false);
        assert.strictEqual(health.body.planningDurabilityDependencyGate.marker, 'dependency-blocked');
        assert.strictEqual(health.body.planningDurabilityDependencyGate.reason, 'ws3_authority_gate_forced_blocked');
        const sessionsResponse = await fetchJson(`${baseUrl}/api/sessions?source=cli`);
        assert.strictEqual(sessionsResponse.statusCode, 200);
        assert.ok(Array.isArray(sessionsResponse.body.sessions));
        const planningBlocked = await postJson(`${baseUrl}/api/planning/records`, {
          idempotencyKey: 'ws3-gate-blocked-1',
          scope: 'user',
          title: 'WS3 gate blocked',
          summary: 'planning durability should fail closed',
          state: 'thought',
        });
        assert.strictEqual(planningBlocked.statusCode, 503);
        assert.strictEqual(planningBlocked.body.error, 'Planning durability dependency gate blocked');
        assert.strictEqual(planningBlocked.body.code, 'planning_durability_dependency_gate_blocked');
        assert.strictEqual(planningBlocked.body.reason, 'ws3_authority_gate_forced_blocked');
        assert.strictEqual(planningBlocked.body.deterministic, true);
        assert.strictEqual(planningBlocked.body.kind, 'planning.create');
        assert.ok(planningBlocked.body.dependencyGate);
        assert.strictEqual(planningBlocked.body.dependencyGate.marker, 'dependency-blocked');
        assert.strictEqual(planningBlocked.body.dependencyGate.ready, false);
        assert.deepStrictEqual(planningBlocked.body.dependencyGate.reasonCodes, ['ws3_authority_gate_forced_blocked']);
        const retentionBlocked = await postJson(`${baseUrl}/api/planning/persistence/retention`, {
          mode: 'dry-run',
        });
        assert.strictEqual(retentionBlocked.statusCode, 503);
        assert.strictEqual(retentionBlocked.body.error, 'Planning durability dependency gate blocked');
        assert.strictEqual(retentionBlocked.body.code, 'planning_durability_dependency_gate_blocked');
        assert.strictEqual(retentionBlocked.body.reason, 'ws3_authority_gate_forced_blocked');
        assert.strictEqual(retentionBlocked.body.kind, 'planning.persistence.retention');
        assert.strictEqual(retentionBlocked.body.deterministic, true);
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('planning routes fail closed with explicit persistence error when env-configured DB startup cannot connect', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: 'postgres://127.0.0.1:1/planning',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        const health = await waitForHealth(baseUrl);
        assert.strictEqual(health.statusCode, 200);
        assert.strictEqual(health.body.planningPersistence.status, 'migration_error');
        const create = await postJson(`${baseUrl}/api/planning/records`, {
          idempotencyKey: 'persistence-authority-no-client-1',
          scope: 'user',
          title: 'db authority route gate',
          summary: 'must fail closed',
          state: 'thought',
        });
        assert.strictEqual(create.statusCode, 503);
        assert.strictEqual(create.body.error, 'Planning persistence unavailable');
        assert.strictEqual(create.body.code, 'planning_persistence_unavailable');
        assert.strictEqual(create.body.reason, 'planning_persistence_migration_error');
        assert.strictEqual(create.body.kind, 'planning.create');
        assert.strictEqual(create.body.deterministic, true);
        assert.ok(create.body.planningPersistence);
        assert.strictEqual(create.body.planningPersistence.authority, 'db');
        assert.strictEqual(create.body.planningPersistence.configured, true);
        assert.strictEqual(create.body.planningPersistence.usable, true);
        assert.strictEqual(create.body.planningPersistence.ready, false);
        assert.ok(create.body.planningPersistence.governance);
        assert.strictEqual(create.body.planningPersistence.governance.deterministic, true);
        assert.strictEqual(create.body.planningPersistence.governance.failClosed, true);
        const retention = await postJson(`${baseUrl}/api/planning/persistence/retention`, {
          mode: 'dry-run',
        });
        assert.strictEqual(retention.statusCode, 503);
        assert.strictEqual(retention.body.code, 'planning_persistence_unavailable');
        assert.strictEqual(retention.body.reason, 'planning_persistence_migration_error');
        assert.strictEqual(retention.body.kind, 'planning.persistence.retention');
        const exported = await postJson(`${baseUrl}/api/planning/persistence/export`, {});
        assert.strictEqual(exported.statusCode, 503);
        assert.strictEqual(exported.body.code, 'planning_persistence_unavailable');
        assert.strictEqual(exported.body.reason, 'planning_persistence_migration_error');
        assert.strictEqual(exported.body.kind, 'planning.persistence.export');
        const imported = await postJson(`${baseUrl}/api/planning/persistence/import`, { records: [] });
        assert.strictEqual(imported.statusCode, 503);
        assert.strictEqual(imported.body.code, 'planning_persistence_unavailable');
        assert.strictEqual(imported.body.reason, 'planning_persistence_migration_error');
        assert.strictEqual(imported.body.kind, 'planning.persistence.import');
        const corruptionScan = await postJson(`${baseUrl}/api/planning/persistence/corruption/scan`, {});
        assert.strictEqual(corruptionScan.statusCode, 503);
        assert.strictEqual(corruptionScan.body.code, 'planning_persistence_unavailable');
        assert.strictEqual(corruptionScan.body.reason, 'planning_persistence_migration_error');
        assert.strictEqual(corruptionScan.body.kind, 'planning.persistence.corruption.scan');
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('WS5A durability-critical routes keep canonical reason code when persistence diagnostics are noisy', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const noisyDiagnostic = `ws5a-m1-noisy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let runningServer = null;
      try {
        await withPatchedEnv({
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: 'postgres://localhost:5432/planning',
        }, async () => {
          runningServer = await startServer({
            host: '127.0.0.1',
            port,
            elegyHome,
            sandboxesHome,
            planningPersistenceClient: {
              query: async () => {
                throw new Error(noisyDiagnostic);
              },
            },
            quiet: true,
          });
          const health = await fetchJson(`${baseUrl}/api/health`);
          assert.strictEqual(health.statusCode, 200);
          assert.strictEqual(health.body.planningPersistence.status, 'migration_error');
          const compareBlocked = await postJson(`${baseUrl}/api/planning/compare`, {
            scopes: ['user'],
            query: 'durability gate canonical reasons',
          });
          assert.strictEqual(compareBlocked.statusCode, 503);
          assert.strictEqual(compareBlocked.body.code, 'planning_durability_route_gate_blocked');
          assert.strictEqual(compareBlocked.body.reason, 'planning_persistence_migration_error');
          assert.notStrictEqual(compareBlocked.body.reason, noisyDiagnostic);
          assert.strictEqual(compareBlocked.body.kind, 'planning.compare');
          assert.ok(compareBlocked.body.durabilityRouteGate);
          assert.deepStrictEqual(compareBlocked.body.durabilityRouteGate.reasonCodes, ['planning_persistence_migration_error']);
          assert.ok(compareBlocked.body.durabilityRouteGate.debug);
          assert.strictEqual(compareBlocked.body.durabilityRouteGate.debug.persistenceAuthorityStatus, 'migration_error');
          assert.strictEqual(compareBlocked.body.durabilityRouteGate.debug.persistenceAuthorityLastError, noisyDiagnostic);
          assert.ok(compareBlocked.body.durabilityRouteGate.persistenceAuthority);
          assert.strictEqual(compareBlocked.body.durabilityRouteGate.persistenceAuthority.lastError, noisyDiagnostic);
          const suggestionBlocked = await postJson(`${baseUrl}/api/planning/suggestions`, {
            suggestionId: 'suggestion-noisy-1',
            state: {
              recommendation: 'defer-merge',
            },
          });
          assert.strictEqual(suggestionBlocked.statusCode, 503);
          assert.strictEqual(suggestionBlocked.body.code, 'planning_durability_route_gate_blocked');
          assert.strictEqual(suggestionBlocked.body.reason, 'planning_persistence_migration_error');
          assert.strictEqual(suggestionBlocked.body.kind, 'planning.suggestion.persist');
          const recapBlocked = await postJson(`${baseUrl}/api/planning/recaps`, {
            recapId: 'recap-noisy-1',
            state: {
              summary: 'merge skipped',
            },
          });
          assert.strictEqual(recapBlocked.statusCode, 503);
          assert.strictEqual(recapBlocked.body.code, 'planning_durability_route_gate_blocked');
          assert.strictEqual(recapBlocked.body.reason, 'planning_persistence_migration_error');
          assert.strictEqual(recapBlocked.body.kind, 'planning.recap.persist');
        });
      } finally {
        if (runningServer) {
          await runningServer.close();
        }
      }
    });
  });
  await test('WS5A durability-critical routes fail closed when persistence authority is not configured', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(root, '.elegy', 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const server = trackProcess(childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--elegy-home',
        elegyHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      try {
        const health = await waitForHealth(baseUrl);
        assert.strictEqual(health.statusCode, 200);
        assert.strictEqual(health.body.planningDurabilityDependencyGate.ready, true);
        const compareBlocked = await postJson(`${baseUrl}/api/planning/compare`, {
          scopes: ['user'],
          query: 'durability gate',
        });
        assert.strictEqual(compareBlocked.statusCode, 503);
        assert.strictEqual(compareBlocked.body.error, 'Planning durability route gate blocked');
        assert.strictEqual(compareBlocked.body.code, 'planning_durability_route_gate_blocked');
        assert.strictEqual(compareBlocked.body.reason, 'planning_persistence_not_configured');
        assert.strictEqual(compareBlocked.body.kind, 'planning.compare');
        assert.strictEqual(compareBlocked.body.deterministic, true);
        assert.ok(compareBlocked.body.durabilityRouteGate);
        assert.strictEqual(compareBlocked.body.durabilityRouteGate.marker, 'dependency-blocked');
        assert.strictEqual(compareBlocked.body.durabilityRouteGate.ready, false);
        assert.ok(Array.isArray(compareBlocked.body.durabilityRouteGate.reasonCodes));
        assert.deepStrictEqual(compareBlocked.body.durabilityRouteGate.reasonCodes, ['planning_persistence_not_configured']);
        const intentBlocked = await postJson(`${baseUrl}/api/planning/merge-intent`, {
          compareReceiptId: 'compare-123',
          targetId: 'planning-001',
          sourceIds: ['planning-010'],
        });
        assert.strictEqual(intentBlocked.statusCode, 503);
        assert.strictEqual(intentBlocked.body.error, 'Planning durability route gate blocked');
        assert.strictEqual(intentBlocked.body.code, 'planning_durability_route_gate_blocked');
        assert.strictEqual(intentBlocked.body.reason, 'planning_persistence_not_configured');
        assert.strictEqual(intentBlocked.body.kind, 'planning.merge-intent');
        const mergeBlocked = await postJson(`${baseUrl}/api/planning/merge`, {
          tokenId: 'intent-123',
          compareReceiptId: 'compare-123',
          targetId: 'planning-001',
          sourceIdsHash: 'abc123',
          compareHash: 'def456',
          idempotencyKey: 'merge-gate-blocked-1',
        });
        assert.strictEqual(mergeBlocked.statusCode, 503);
        assert.strictEqual(mergeBlocked.body.error, 'Planning durability route gate blocked');
        assert.strictEqual(mergeBlocked.body.code, 'planning_durability_route_gate_blocked');
        assert.strictEqual(mergeBlocked.body.reason, 'planning_persistence_not_configured');
        assert.strictEqual(mergeBlocked.body.kind, 'planning.merge');
        const suggestionBlocked = await postJson(`${baseUrl}/api/planning/suggestions`, {
          suggestionId: 'suggestion-blocked-1',
          state: {
            recommendation: 'blocked',
          },
        });
        assert.strictEqual(suggestionBlocked.statusCode, 503);
        assert.strictEqual(suggestionBlocked.body.error, 'Planning durability route gate blocked');
        assert.strictEqual(suggestionBlocked.body.code, 'planning_durability_route_gate_blocked');
        assert.strictEqual(suggestionBlocked.body.reason, 'planning_persistence_not_configured');
        assert.strictEqual(suggestionBlocked.body.kind, 'planning.suggestion.persist');
        const recapBlocked = await postJson(`${baseUrl}/api/planning/recaps`, {
          recapId: 'recap-blocked-1',
          state: {
            summary: 'blocked',
          },
        });
        assert.strictEqual(recapBlocked.statusCode, 503);
        assert.strictEqual(recapBlocked.body.error, 'Planning durability route gate blocked');
        assert.strictEqual(recapBlocked.body.code, 'planning_durability_route_gate_blocked');
        assert.strictEqual(recapBlocked.body.reason, 'planning_persistence_not_configured');
        assert.strictEqual(recapBlocked.body.kind, 'planning.recap.persist');
        const sessionsResponse = await fetchJson(`${baseUrl}/api/sessions?source=cli`);
        assert.strictEqual(sessionsResponse.statusCode, 200);
      } finally {
        await stopTrackedProcess(server);
      }
      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });
  await test('runtime health surfaces startup sync outcomes and the autonomous decision log summary', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(elegyHome, 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const server = await startServer({
        host: '127.0.0.1',
        port: await getFreePort(),
        engineRoot: root,
        elegyHome,
        sandboxesHome,
        quiet: true,
      });
      try {
        const address = server.server.address();
        const port = address && typeof address === 'object' ? address.port : null;
        const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
        assert.strictEqual(health.statusCode, 200);
        assert.ok(health.body.startupManagedAssetSync);
        assert.strictEqual(health.body.startupManagedAssetSync.ran, true);
        assert.strictEqual(health.body.startupManagedAssetSync.decisionLogged, true);
        assert.ok(Array.isArray(health.body.startupManagedAssetSync.homes));
        assert.ok(health.body.autonomousDecisionLog);
        assert.strictEqual(health.body.autonomousDecisionLog.lastEventKind, 'startup.managed_asset_sync');
        assert.strictEqual(health.body.autonomousDecisionLog.lastEventOutcome, health.body.startupManagedAssetSync.outcome);
        assert.ok(typeof health.body.autonomousDecisionLog.path === 'string' && health.body.autonomousDecisionLog.path.length > 0);
        assert.ok(fs.existsSync(health.body.autonomousDecisionLog.path));
        const entries = fs.readFileSync(health.body.autonomousDecisionLog.path, 'utf8')
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        assert.ok(entries.length >= 1, 'expected at least one autonomous decision log entry');
        const lastEntry = entries[entries.length - 1];
        assert.strictEqual(lastEntry.kind, 'startup.managed_asset_sync');
        assert.strictEqual(lastEntry.summary, health.body.startupManagedAssetSync.message);
      } finally {
        await server.close();
      }
    });
  });
  await test('startup managed-asset sync uses non-forcing sync options during normal startup', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(elegyHome, 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const syncCalls = [];
      const originalSyncManagedInstall = assets.syncManagedInstall;
      assets.syncManagedInstall = (engineRoot, home, options = {}) => {
        syncCalls.push({ engineRoot, home, options: { ...options } });
        return {
          synced: [],
          prunedPaths: [],
          installState: {},
        };
      };
      try {
        const server = await startServer({
          host: '127.0.0.1',
          port: await getFreePort(),
          engineRoot: root,
          elegyHome,
          sandboxesHome,
          quiet: true,
        });
        try {
          const address = server.server.address();
          const port = address && typeof address === 'object' ? address.port : null;
          const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
          assert.strictEqual(health.statusCode, 200);
          assert.strictEqual(health.body.startupManagedAssetSync.ran, true);
        } finally {
          await server.close();
        }
        assert.ok(syncCalls.length >= 1, 'expected startup sync to invoke managed-asset sync');
        for (const syncCall of syncCalls) {
          assert.strictEqual(syncCall.options.force, false);
          assert.strictEqual(syncCall.options.pointerMode, true);
        }
      } finally {
        assets.syncManagedInstall = originalSyncManagedInstall;
      }
    });
  });
  await test('runtime health records skipped startup sync as an autonomous decision when startup sync is disabled', async () => {
    await withTempDir(async (root) => {
      const elegyHome = path.join(root, '.elegy');
      const sandboxesHome = path.join(elegyHome, 'sandboxes');
      fs.mkdirSync(elegyHome, { recursive: true });
      const server = await startServer({
        host: '127.0.0.1',
        port: await getFreePort(),
        engineRoot: root,
        elegyHome,
        sandboxesHome,
        managedAssetSyncOnStart: false,
        quiet: true,
      });
      try {
        const address = server.server.address();
        const port = address && typeof address === 'object' ? address.port : null;
        const health = await fetchJson(`http://127.0.0.1:${port}/api/health`);
        assert.strictEqual(health.statusCode, 200);
        assert.strictEqual(health.body.startupManagedAssetSync.ran, false);
        assert.strictEqual(health.body.startupManagedAssetSync.outcome, 'skipped');
        assert.strictEqual(health.body.startupManagedAssetSync.decisionLogged, true);
        assert.strictEqual(health.body.autonomousDecisionLog.lastEventKind, 'startup.managed_asset_sync');
        assert.strictEqual(health.body.autonomousDecisionLog.lastEventOutcome, 'skipped');
      } finally {
        await server.close();
      }
    });
  });
  console.log(`\n${passed} tests passed`);
  if (process.exitCode) {
    console.error('Some tests FAILED');
  } else {
    console.log('All tests passed');
  }
}
const suiteTimer = setTimeout(() => {
  console.error(`Test suite timed out after ${TEST_SUITE_TIMEOUT_MS}ms — killing tracked processes and exiting.`);
  killTracked();
  process.exit(2);
}, TEST_SUITE_TIMEOUT_MS);
suiteTimer.unref();
run().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
}).finally(() => {
  clearTimeout(suiteTimer);
  killTracked();
});
