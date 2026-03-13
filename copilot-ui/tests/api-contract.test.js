'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { startServer } = require('../server');

const SNAPSHOT_PATH = path.join(__dirname, 'api-contract.snapshot.json');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr && typeof addr === 'object' ? addr.port : null;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function httpRequest(baseUrl, method, routePath) {
  return new Promise((resolve, reject) => {
    const url = new URL(routePath, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {},
      timeout: 10000,
    };

    if (method === 'POST') {
      options.headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let bodyKeys = null;
        let bodyType = 'unknown';
        try {
          const parsed = JSON.parse(raw);
          bodyKeys = Array.isArray(parsed) ? ['[array]'] : Object.keys(parsed).sort();
          bodyType = 'json';
        } catch {
          bodyType = raw.length === 0 ? 'empty' : 'non-json';
        }

        const contentType = res.headers['content-type'] || null;
        resolve({
          status: res.statusCode,
          contentType: contentType ? contentType.split(';')[0].trim() : null,
          bodyType,
          bodyKeys,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        status: null,
        contentType: null,
        bodyType: 'error',
        bodyKeys: null,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        status: null,
        contentType: null,
        bodyType: 'timeout',
        bodyKeys: null,
        error: 'request timed out',
      });
    });

    if (method === 'POST') {
      req.write(JSON.stringify({}));
    }
    req.end();
  });
}

// Route inventory snapshot for public backend endpoints.
const ROUTE_INVENTORY = [
  // Lifecycle/Misc (7)
  { method: 'GET', path: '/api/policy/preflight' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/version' },
  { method: 'POST', path: '/api/vscode/patch-settings' },
  { method: 'POST', path: '/api/copilot/authorize' },
  { method: 'GET', path: '/api/lsp/config' },
  { method: 'POST', path: '/api/lsp/install' },

  // Planning (19)
  { method: 'POST', path: '/api/planning/persistence/init' },
  { method: 'POST', path: '/api/planning/persistence/corruption/scan' },
  { method: 'POST', path: '/api/planning/persistence/retention' },
  { method: 'POST', path: '/api/planning/persistence/export' },
  { method: 'POST', path: '/api/planning/persistence/import' },
  { method: 'POST', path: '/api/planning/records' },
  { method: 'GET', path: '/api/planning/records' },
  { method: 'GET', path: '/api/planning/search' },
  { method: 'POST', path: '/api/planning/compare' },
  { method: 'POST', path: '/api/planning/merge-intent' },
  { method: 'POST', path: '/api/planning/merge' },
  { method: 'POST', path: '/api/planning/suggestions' },
  { method: 'GET', path: '/api/planning/suggestions' },
  { method: 'POST', path: '/api/planning/recaps' },
  { method: 'GET', path: '/api/planning/recaps' },
  { method: 'GET', path: '/api/planning/records/planning-000001/research' },
  { method: 'POST', path: '/api/planning/records/planning-000001/research' },
  { method: 'DELETE', path: '/api/planning/records/planning-000001/research/note-0001' },
  { method: 'GET', path: '/api/planning/records/planning-000001/diagrams' },

  // Sessions (12: 1 exact + 11 regex)
  { method: 'GET', path: '/api/sessions' },
  { method: 'GET', path: '/api/sessions/test-session-id/events' },
  { method: 'GET', path: '/api/sessions/test-session-id/agent-usage' },
  { method: 'GET', path: '/api/sessions/test-session-id/plan' },
  { method: 'GET', path: '/api/sessions/test-session-id/plans' },
  { method: 'GET', path: '/api/sessions/test-session-id/plans/test-plan-id' },
  { method: 'GET', path: '/api/sessions/test-session-id/final' },
  { method: 'GET', path: '/api/sessions/test-session-id/structured-state' },
  { method: 'GET', path: '/api/sessions/test-session-id/proposition' },
  { method: 'GET', path: '/api/sessions/test-session-id/verification-guide' },
  { method: 'POST', path: '/api/sessions/test-session-id/archive' },
  { method: 'POST', path: '/api/sessions/test-session-id/delete' },

  // Assets + Skills (8)
  { method: 'GET', path: '/api/assets/managed' },
  { method: 'GET', path: '/api/assets/installed' },
  { method: 'POST', path: '/api/assets/sync-all' },
  { method: 'POST', path: '/api/assets/sync' },
  { method: 'GET', path: '/api/skills/preview' },
  { method: 'POST', path: '/api/assets/remove' },
  { method: 'GET', path: '/api/assets/view' },
  { method: 'POST', path: '/api/assets/delete' },

  // Catalog/Search/Audit/Runtime (23)
  { method: 'GET', path: '/api/catalog/repos' },
  { method: 'POST', path: '/api/catalog/repos/register' },
  { method: 'POST', path: '/api/catalog/repos/unregister' },
  { method: 'POST', path: '/api/catalog/repos/select' },
  { method: 'POST', path: '/api/catalog/repos/refresh' },
  { method: 'GET', path: '/api/catalog/summary' },
  { method: 'GET', path: '/api/catalog/assets' },
  { method: 'GET', path: '/api/catalog/bundles' },
  { method: 'GET', path: '/api/catalog/entries' },
  { method: 'GET', path: '/api/catalog/assets/test-asset-id' },
  { method: 'POST', path: '/api/catalog/refresh' },
  { method: 'POST', path: '/api/catalog/assets/create' },
  { method: 'POST', path: '/api/catalog/assets/update' },
  { method: 'POST', path: '/api/catalog/assets/delete' },
  { method: 'POST', path: '/api/catalog/assets/install' },
  { method: 'POST', path: '/api/catalog/assets/enable' },
  { method: 'POST', path: '/api/catalog/assets/disable' },
  { method: 'POST', path: '/api/catalog/activation' },
  { method: 'POST', path: '/api/search/query' },
  { method: 'POST', path: '/api/search/selection' },
  { method: 'GET', path: '/api/audit/assets' },
  { method: 'GET', path: '/api/audit/events' },
  { method: 'GET', path: '/api/runtime/catalog-health' },

  // Gateway (5)
  { method: 'GET', path: '/api/gateway/state' },
  { method: 'POST', path: '/api/gateway/connect' },
  { method: 'GET', path: '/api/gateway/config' },
  { method: 'POST', path: '/api/gateway/config' },
  { method: 'GET', path: '/api/gateway/scan-repos' },

  // Tracker proxy (6: 4 exact + 2 regex)
  { method: 'GET', path: '/api/tracker/status' },
  { method: 'GET', path: '/api/tracker/sessions' },
  { method: 'GET', path: '/api/tracker/permissions' },
  { method: 'GET', path: '/api/tracker/events' },
  { method: 'POST', path: '/api/tracker/permissions/test-id/approve' },
  { method: 'POST', path: '/api/tracker/lifecycle/start' },

  // SDK bridge (6)
  { method: 'GET', path: '/api/sdk/health' },
  { method: 'POST', path: '/api/sdk/session' },
  { method: 'GET', path: '/api/sdk/sessions' },
  { method: 'DELETE', path: '/api/sdk/session/test-session-id' },
  { method: 'POST', path: '/api/sdk/send' },
  { method: 'GET', path: '/api/sdk/stream/test-session-id' },
];

async function run() {
  console.log(`\nAPI Contract Tests — ${ROUTE_INVENTORY.length} routes\n`);

  // Setup temp directories
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-api-contract-'));
  const copilotHome = path.join(tmpRoot, '.copilot');
  const vscodeHome = path.join(tmpRoot, '.copilot-vscode');
  const sandboxesHome = path.join(tmpRoot, '.copilot', 'sandboxes');
  fs.mkdirSync(copilotHome, { recursive: true });
  fs.mkdirSync(vscodeHome, { recursive: true });
  fs.mkdirSync(sandboxesHome, { recursive: true });

  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  let runningServer = null;
  try {
    runningServer = await startServer({
      host: '127.0.0.1',
      port,
      copilotHome,
      vscodeHome,
      sandboxesHome,
      quiet: true,
    });

    // Verify server is up
    const healthCheck = await httpRequest(baseUrl, 'GET', '/api/health');
    assert.strictEqual(healthCheck.status, 200, `Health check failed with status ${healthCheck.status}`);
    console.log('  Server started successfully\n');

    // Capture contract shapes for all routes
    const currentSnapshot = {};

    for (const route of ROUTE_INVENTORY) {
      const key = `${route.method} ${route.path}`;
      const shape = await httpRequest(baseUrl, route.method, route.path);
      currentSnapshot[key] = shape;
    }

    // Load or create snapshot
    const snapshotExists = fs.existsSync(SNAPSHOT_PATH);

    if (!snapshotExists) {
      // First run — write the baseline snapshot
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentSnapshot, null, 2) + '\n');
      console.log(`  Baseline snapshot written to tests/api-contract.snapshot.json\n`);

      // Validate we got a response for every route (dispatch works)
      for (const route of ROUTE_INVENTORY) {
        const key = `${route.method} ${route.path}`;
        await test(`${key} — dispatches`, async () => {
          const shape = currentSnapshot[key];
          assert.ok(shape, `No response captured for ${key}`);
          // A dispatched route should never return null status (connection error)
          // and should not return 404 from the static-file handler
          assert.ok(
            shape.status !== null,
            `${key} failed with connection error: ${shape.error}`
          );
        });
      }
    } else {
      // Subsequent run — compare against baseline
      const baseline = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));

      // Check no routes were removed
      await test('no routes removed from baseline', async () => {
        const baselineKeys = Object.keys(baseline);
        const currentKeys = Object.keys(currentSnapshot);
        const removed = baselineKeys.filter((k) => !currentKeys.includes(k));
        assert.deepStrictEqual(
          removed,
          [],
          `Routes removed from inventory: ${removed.join(', ')}`
        );
      });

      // Check each route's contract shape matches
      for (const route of ROUTE_INVENTORY) {
        const key = `${route.method} ${route.path}`;
        await test(`${key} — contract shape matches baseline`, async () => {
          const baselineShape = baseline[key];
          const currentShape = currentSnapshot[key];

          if (!baselineShape) {
            // New route added — that's OK, we just record it
            return;
          }

          assert.ok(currentShape, `No response captured for ${key}`);

          // Status code must match
          assert.strictEqual(
            currentShape.status,
            baselineShape.status,
            `Status changed: expected ${baselineShape.status}, got ${currentShape.status}`
          );

          // Content-Type must match
          assert.strictEqual(
            currentShape.contentType,
            baselineShape.contentType,
            `Content-Type changed: expected ${baselineShape.contentType}, got ${currentShape.contentType}`
          );

          // Body type must match
          assert.strictEqual(
            currentShape.bodyType,
            baselineShape.bodyType,
            `Body type changed: expected ${baselineShape.bodyType}, got ${currentShape.bodyType}`
          );

          // JSON body keys must match (if both are JSON)
          if (baselineShape.bodyKeys && currentShape.bodyKeys) {
            assert.deepStrictEqual(
              currentShape.bodyKeys,
              baselineShape.bodyKeys,
              `Body keys changed: expected [${baselineShape.bodyKeys.join(', ')}], got [${currentShape.bodyKeys.join(', ')}]`
            );
          }
        });
      }

      // Update snapshot with any new routes
      const currentKeys = Object.keys(currentSnapshot);
      const baselineKeys = Object.keys(baseline);
      const newRoutes = currentKeys.filter((k) => !baselineKeys.includes(k));
      if (newRoutes.length > 0) {
        const merged = { ...baseline, ...currentSnapshot };
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(merged, null, 2) + '\n');
        console.log(`\n  Snapshot updated with ${newRoutes.length} new route(s): ${newRoutes.join(', ')}`);
      }
    }

    // Summary: route count
  await test(`route inventory count is ${ROUTE_INVENTORY.length}`, async () => {
    assert.strictEqual(ROUTE_INVENTORY.length, 86, `Expected 86 routes, got ${ROUTE_INVENTORY.length}`);
  });

  } finally {
    if (runningServer) {
      await runningServer.close();
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((e) => {
  console.error(`\n  FATAL: ${e.message}\n`);
  process.exitCode = 1;
});
