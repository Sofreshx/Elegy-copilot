'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
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
} = require('./lib/planningApiContracts');

const serverPath = path.join(__dirname, 'server.js');

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

async function run() {
  await test('health payload includes deterministic runtime compatibility contract', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
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
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

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
        assert.ok(response.body.planningPersistence.migrations);
        assert.strictEqual(response.body.planningPersistence.migrations.schemaTable, 'ie_schema_versions');
        assert.strictEqual(response.body.planningPersistence.migrations.appliedCount, 0);
        assert.deepStrictEqual(response.body.planningPersistence.migrations.appliedVersions, []);
        assert.strictEqual(response.body.planningPersistence.migrations.driftDetected, false);
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  await test('health payload defaults provider to non-docker when explicit selection is absent or invalid', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_RUNTIME_MODE: 'repo',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'not-a-provider',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER: '',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'also-invalid',
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

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
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  await test('non-docker provider returns deterministic unsupported marker for capability-gated lifecycle actions', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_SELECTED: 'non-docker',
          INSTRUCTION_ENGINE_RUNTIME_PROVIDER_DEFAULT: 'non-docker',
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      try {
        await waitForHealth(baseUrl);

        const response = await postJson(`${baseUrl}/api/tracker/lifecycle/pr-open`, {
          sandboxId: 'ws2-guardrail-sandbox',
        });

        assert.strictEqual(response.statusCode, 501);
        assert.strictEqual(response.body.error, 'Lifecycle capability unsupported');
        assert.strictEqual(response.body.code, 'lifecycle_capability_unsupported');
        assert.strictEqual(response.body.action, 'pr-open');
        assert.strictEqual(response.body.reason, 'provider_capability_unsupported');
        assert.strictEqual(response.body.deterministic, true);
        assert.ok(response.body.unsupported);
        assert.strictEqual(response.body.unsupported.marker, 'unsupported');
        assert.strictEqual(response.body.unsupported.provider, RUNTIME_PROVIDERS.NON_DOCKER);
        assert.ok(response.body.capability);
        assert.strictEqual(response.body.capability.supported, false);
        assert.strictEqual(response.body.capability.shared, false);
        assert.strictEqual(response.body.capability.marker, 'unsupported');
        assert.ok(response.body.finishCompatibilityHook);
        assert.strictEqual(response.body.finishCompatibilityHook.contractVersion, FINISH_COMPATIBILITY_HOOK_CONTRACT_VERSION);
        assert.strictEqual(response.body.finishCompatibilityHook.apiContractVersion, PLANNING_API_CONTRACT_VERSION);
        assert.strictEqual(response.body.finishCompatibilityHook.providerAgnostic, true);
        assert.strictEqual(response.body.finishCompatibilityHook.scopeBoundary, 'ws2_contract_hook_only');
        assert.strictEqual(response.body.finishCompatibilityHook.ws4Ownership, 'finish_behavior_and_ux');
        assert.ok(response.body.finishCompatibilityHook.receipt);
        assert.strictEqual(response.body.finishCompatibilityHook.receipt.contractVersion, FINISH_COMPATIBILITY_RECEIPT_CONTRACT_VERSION);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(response.body, 'prPrompt'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(response.body, 'closeAllowed'), false);
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  await test('sessions API exposes deterministic artifact-authority reconciliation metadata in merged all-source view', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(path.join(copilotHome, 'session-state', 'reconcile-1'), { recursive: true });
      fs.mkdirSync(path.join(vscodeHome, 'session-state', 'reconcile-1'), { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
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
      });

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
        assert.strictEqual(merged.mergedCount, 2);
        assert.strictEqual(merged.authority, 'fs');
        assert.ok(merged.reconciliation);
        assert.strictEqual(merged.reconciliation.deterministic, true);
        assert.strictEqual(merged.reconciliation.reason, 'artifact_only');
        assert.strictEqual(merged.reconciliation.sourceOfTruth, 'artifact');
        assert.deepStrictEqual(merged.reconciliation.sourcePrecedence, ['artifact']);
        assert.strictEqual(merged.reconciliation.hasRuntimeState, false);
        assert.strictEqual(merged.reconciliation.hasArtifactState, true);
        assert.deepStrictEqual(merged.reconciliation.sourceSet, ['cli', 'vscode']);
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  await test('planning durability routes fail closed with explicit dependency marker when WS3 authority gate is not ready', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
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
      });

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
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
      }
    });
  });

  await test('planning routes fail closed with explicit persistence error when DB authority is configured without a client', async () => {
    await withTempDir(async (root) => {
      const copilotHome = path.join(root, '.copilot');
      const vscodeHome = path.join(root, '.copilot-vscode');
      const sandboxesHome = path.join(root, '.copilot', 'sandboxes');
      fs.mkdirSync(copilotHome, { recursive: true });
      fs.mkdirSync(vscodeHome, { recursive: true });

      const port = await getFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;

      const server = childProcess.spawn(process.execPath, [
        serverPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--copilot-home',
        copilotHome,
        '--vscode-home',
        vscodeHome,
        '--sandboxes-home',
        sandboxesHome,
      ], {
        env: {
          ...process.env,
          INSTRUCTION_ENGINE_PLANNING_DB_REQUIRED: '0',
          INSTRUCTION_ENGINE_PLANNING_DB_URL: 'postgres://localhost:5432/planning',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      server.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      try {
        const health = await waitForHealth(baseUrl);
        assert.strictEqual(health.statusCode, 200);
        assert.strictEqual(health.body.planningPersistence.status, 'configured_no_client');

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
        assert.strictEqual(create.body.reason, 'planning_persistence_client_unavailable');
        assert.strictEqual(create.body.kind, 'planning.create');
        assert.strictEqual(create.body.deterministic, true);
        assert.ok(create.body.planningPersistence);
        assert.strictEqual(create.body.planningPersistence.authority, 'db');
        assert.strictEqual(create.body.planningPersistence.configured, true);
        assert.strictEqual(create.body.planningPersistence.usable, true);
        assert.strictEqual(create.body.planningPersistence.ready, false);
      } finally {
        server.kill();
        await sleep(150);
      }

      if (stderr.trim()) {
        assert.ok(!/Error:/i.test(stderr), `Server stderr contained error output: ${stderr}`);
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

run().catch((e) => {
  console.error(e.stack || e.message || String(e));
  process.exit(1);
});
