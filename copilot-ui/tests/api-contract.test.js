'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
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

function httpRequest(baseUrl, method, routePath) {
  return new Promise((resolve, reject) => {
    const url = new URL(routePath, baseUrl);
    const expectsJsonBody = method === 'POST' || method === 'PATCH';
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {},
      timeout: 30000,
    };

    if (expectsJsonBody) {
      options.headers['Content-Type'] = 'application/json; charset=utf-8';
    }

    const req = http.request(options, (res) => {
      const chunks = [];
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
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
      };

      res.on('data', (chunk) => {
        chunks.push(chunk);
        const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
        if (contentType === 'text/event-stream' && chunks.length > 0) {
          req.destroy();
          finish();
        }
      });
      res.on('end', finish);
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

    if (expectsJsonBody) {
      req.write(JSON.stringify({}));
    }
    req.end();
  });
}

function routeDescriptorMatchesSample(route, sample) {
  if (!route || !sample || route.method !== sample.method) {
    return false;
  }

  if (typeof route.path === 'string') {
    return route.path === sample.path;
  }

  if (route.path instanceof RegExp) {
    return route.path.test(sample.path);
  }

  return false;
}

function describeRouteDescriptor(route) {
  return `${route.method} ${typeof route.path === 'string' ? route.path : String(route.path)}`;
}

function isRetiredRepoFilePlanningRoute(sample) {
  const key = `${sample.method} ${sample.path}`;
  return [
  ].includes(key);
}

function isRetiredStandaloneWorkflowRoute(sample) {
  const key = `${sample.method} ${sample.path}`;
  return [
  ].includes(key);
}

// Route inventory snapshot for public backend endpoints.
const ROUTE_INVENTORY = [
  // Lifecycle/Misc (5)
  { method: 'GET', path: '/api/policy/preflight' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/version' },
  { method: 'GET', path: '/api/lsp/config' },
  { method: 'POST', path: '/api/lsp/install' },

  // Planning (51)
  { method: 'GET', path: '/api/planning/task-board' },
  { method: 'GET', path: '/api/planning/live/roadmaps' },
  { method: 'GET', path: '/api/planning/live/roadmaps/RM-demo' },
  { method: 'GET', path: '/api/planning/live/goals/GOAL-demo' },
  { method: 'GET', path: '/api/planning/live/plans' },
  { method: 'GET', path: '/api/planning/live/plans/PLAN-demo' },
  { method: 'GET', path: '/api/planning/live/todos' },
  { method: 'POST', path: '/api/planning/persistence/init' },
  { method: 'POST', path: '/api/planning/persistence/corruption/scan' },
  { method: 'POST', path: '/api/planning/persistence/retention' },
  { method: 'POST', path: '/api/planning/persistence/export' },
  { method: 'POST', path: '/api/planning/persistence/import' },
  { method: 'POST', path: '/api/planning/records' },
  { method: 'GET', path: '/api/planning/records' },
  { method: 'PATCH', path: '/api/planning/records/planning-000001' },
  { method: 'GET', path: '/api/planning/search' },
  { method: 'POST', path: '/api/planning/compare' },
  { method: 'POST', path: '/api/planning/merge-intent' },
  { method: 'POST', path: '/api/planning/merge' },
  { method: 'POST', path: '/api/planning/suggestions' },
  { method: 'GET', path: '/api/planning/suggestions' },
  { method: 'POST', path: '/api/planning/recaps' },
  { method: 'GET', path: '/api/planning/recaps' },
  { method: 'POST', path: '/api/planning/workflow-artifacts' },
  { method: 'GET', path: '/api/planning/workflow-artifacts' },
  { method: 'GET', path: '/api/planning/workflow-artifacts/continuation-package' },
  { method: 'GET', path: '/api/planning/obsidian/status' },
  { method: 'GET', path: '/api/planning/obsidian/notes' },
  { method: 'GET', path: '/api/planning/obsidian/notes/obsnote-0001' },
  { method: 'POST', path: '/api/planning/obsidian/sync' },
  { method: 'POST', path: '/api/planning/obsidian/source-selection' },
  { method: 'GET', path: '/api/planning/obsidian/representations/status' },
  { method: 'GET', path: '/api/planning/obsidian/representations' },
  { method: 'POST', path: '/api/planning/obsidian/representations/refresh' },

  // Sessions (18: 4 exact + 14 regex)
  { method: 'GET', path: '/api/sessions/workspace' },
  { method: 'GET', path: '/api/sessions/unified' },
  { method: 'GET', path: '/api/sessions' },
  { method: 'GET', path: '/api/sessions/test-session-id/events' },
  { method: 'GET', path: '/api/sessions/test-session-id/agent-usage' },
  { method: 'GET', path: '/api/sessions/test-session-id/plan' },
  { method: 'POST', path: '/api/sessions/plan' },
  { method: 'GET', path: '/api/sessions/test-session-id/plans' },
  { method: 'GET', path: '/api/sessions/test-session-id/plans/test-plan-id' },
  { method: 'GET', path: '/api/sessions/test-session-id/final' },
  { method: 'GET', path: '/api/sessions/test-session-id/structured-state' },
  { method: 'GET', path: '/api/sessions/test-session-id/proposition' },
  { method: 'GET', path: '/api/sessions/test-session-id/handoff' },
  { method: 'GET', path: '/api/sessions/test-session-id/verification-guide' },
  { method: 'GET', path: '/api/sessions/test-session-id/continuation-package' },
  { method: 'POST', path: '/api/sessions/test-session-id/roadmap-sync' },
  { method: 'POST', path: '/api/sessions/test-session-id/archive' },
  { method: 'POST', path: '/api/sessions/test-session-id/delete' },

  // Assets + Skills (9)
  { method: 'GET', path: '/api/assets/managed' },
  { method: 'GET', path: '/api/assets/installed' },
  { method: 'POST', path: '/api/assets/sync-all' },
  { method: 'POST', path: '/api/assets/install-surfaces' },
  { method: 'POST', path: '/api/assets/sync' },
  { method: 'GET', path: '/api/skills/preview' },
  { method: 'POST', path: '/api/assets/remove' },
  { method: 'GET', path: '/api/assets/view' },
  { method: 'POST', path: '/api/assets/delete' },

  // Catalog/Search/Audit/Runtime (33)
  { method: 'GET', path: '/api/dashboard/harness-sessions' },
  { method: 'GET', path: '/api/catalog/repos' },
  { method: 'POST', path: '/api/catalog/repos/register' },
  { method: 'POST', path: '/api/catalog/repos/scan-roots' },
  { method: 'POST', path: '/api/catalog/repos/unregister' },
  { method: 'POST', path: '/api/catalog/repos/select' },
  { method: 'POST', path: '/api/catalog/repos/refresh' },
  { method: 'GET', path: '/api/catalog/summary' },
  { method: 'GET', path: '/api/catalog/sources' },
  { method: 'GET', path: '/api/catalog/content' },
  { method: 'GET', path: '/api/catalog/sources/demo-source' },
  { method: 'GET', path: '/api/catalog/assets' },
  { method: 'GET', path: '/api/catalog/bundles' },
  { method: 'GET', path: '/api/catalog/entries' },
  { method: 'GET', path: '/api/catalog/assets/test-asset-id' },
  { method: 'POST', path: '/api/catalog/refresh' },
  { method: 'POST', path: '/api/catalog/sources/add' },
  { method: 'POST', path: '/api/catalog/sources/remove' },
  { method: 'POST', path: '/api/catalog/sources/refresh' },
  { method: 'POST', path: '/api/catalog/sources/activate' },
  { method: 'POST', path: '/api/catalog/sources/deactivate' },
  { method: 'POST', path: '/api/catalog/assets/create' },
  { method: 'POST', path: '/api/catalog/assets/update' },
  { method: 'POST', path: '/api/catalog/assets/delete' },
  { method: 'POST', path: '/api/catalog/assets/install' },
  { method: 'POST', path: '/api/catalog/bundles/uninstall' },
  { method: 'POST', path: '/api/catalog/providers/install' },
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

  // Sandbox lifecycle (1)
  { method: 'POST', path: '/api/sandboxes/lifecycle/start' },

  // UI Runtime Overlay (8)
  { method: 'GET', path: '/api/ui-runtime-overlay/sessions' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/close' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/observations' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/annotations' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/change-requests' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/change-requests/test-change-request-id/release' },
  { method: 'POST', path: '/api/ui-runtime-overlay/sessions/test-session-id/change-requests/test-change-request-id/executor-job' },

  // Desktop + Dashboard + Config (6)
  { method: 'GET', path: '/api/desktop-updater' },
  { method: 'POST', path: '/api/desktop-updater/check' },
  { method: 'POST', path: '/api/desktop-updater/download' },
  { method: 'POST', path: '/api/desktop-updater/restart' },
  { method: 'GET', path: '/api/config/remote-sessions' },
  { method: 'PUT', path: '/api/config/remote-sessions' },
  { method: 'GET', path: '/api/config/codex-provider' },
  { method: 'PUT', path: '/api/config/codex-provider' },
  { method: 'POST', path: '/api/config/codex-provider/reset' },

  // SDK bridge (9)
  { method: 'GET', path: '/api/sdk/health' },
  { method: 'GET', path: '/api/sdk/models' },
  { method: 'POST', path: '/api/sdk/session' },
  { method: 'GET', path: '/api/sdk/sessions' },
  { method: 'DELETE', path: '/api/sdk/session/test-session-id' },
  { method: 'POST', path: '/api/sdk/session/test-session-id/enable-remote' },
  { method: 'POST', path: '/api/sdk/send' },
  { method: 'POST', path: '/api/sdk/answer' },
  { method: 'GET', path: '/api/sdk/stream/test-session-id' },

  // Executor (12)
  { method: 'GET', path: '/api/executor/health' },
  { method: 'GET', path: '/api/executor/jobs' },
  { method: 'GET', path: '/api/executor/worktrees' },
  { method: 'GET', path: '/api/executor/runs' },
  { method: 'GET', path: '/api/executor/runs/test-run-id' },
  { method: 'POST', path: '/api/executor/jobs' },
  { method: 'POST', path: '/api/executor/worktrees/resolve' },
  { method: 'POST', path: '/api/executor/jobs/test-job-id/trigger' },
  { method: 'POST', path: '/api/executor/jobs/test-job-id/cancel' },

  // Workflows (16)

  // Hooks + Git (9)
  { method: 'GET', path: '/api/hooks/rules' },
  { method: 'PATCH', path: '/api/hooks/rules/sample-rule' },
  { method: 'POST', path: '/api/hooks/rules/batch' },
  { method: 'GET', path: '/api/git/status' },
  { method: 'GET', path: '/api/git/diff' },
  { method: 'GET', path: '/api/git/log' },
  { method: 'GET', path: '/api/git/branches' },
  { method: 'GET', path: '/api/git/summary' },
  { method: 'GET', path: '/api/git/pull-request' },
  { method: 'POST', path: '/api/git/stage' },
  { method: 'POST', path: '/api/git/unstage' },
  { method: 'POST', path: '/api/git/commit' },
  { method: 'POST', path: '/api/git/checkout' },
  { method: 'POST', path: '/api/git/pull' },
  { method: 'POST', path: '/api/git/push' },
  { method: 'POST', path: '/api/git/pull-request' },
];

async function run() {
  console.log(`\nAPI Contract Tests — ${ROUTE_INVENTORY.length} routes\n`);
  const allowSnapshotUpdate = process.env.UPDATE_API_SNAPSHOT === '1';
  const testEnv = {
    COPILOT_SDK_BRIDGE: '0',
    NODE_ENV: 'test',
  };

  // Setup temp directories
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-api-contract-'));
  const copilotHome = path.join(tmpRoot, '.copilot');
  const vscodeHome = path.join(tmpRoot, '.copilot-vscode');
  const sandboxesHome = path.join(tmpRoot, '.copilot', 'sandboxes');
  fs.mkdirSync(copilotHome, { recursive: true });
  fs.mkdirSync(vscodeHome, { recursive: true });
  fs.mkdirSync(sandboxesHome, { recursive: true });

  let runningServer = null;
  try {
    runningServer = await startServer({
      host: '127.0.0.1',
      port: 0,
      copilotHome,
      vscodeHome,
      sandboxesHome,
      quiet: true,
      env: testEnv,
    });
    const baseUrl = `http://127.0.0.1:${runningServer.port}`;

    // Verify server is up
    const healthCheck = await httpRequest(baseUrl, 'GET', '/api/health');
    assert.strictEqual(healthCheck.status, 200, `Health check failed with status ${healthCheck.status}`);
    console.log('  Server started successfully\n');

    const registeredRoutes = runningServer && runningServer.routeRegistry && Array.isArray(runningServer.routeRegistry._routes)
      ? runningServer.routeRegistry._routes
      : [];

    await test('route inventory matches registered route count after excluding retired planning and workflow handlers', async () => {
      const activeInventoryCount = ROUTE_INVENTORY.filter((sample) => (
        !isRetiredRepoFilePlanningRoute(sample)
        && !isRetiredStandaloneWorkflowRoute(sample)
      )).length;
      assert.strictEqual(
        activeInventoryCount,
        registeredRoutes.length,
        `Active inventory count ${activeInventoryCount} does not match registered route count ${registeredRoutes.length}`
      );
    });

     await test('every registered route has an inventory sample', async () => {
       const uncoveredRoutes = registeredRoutes
         .filter((route) => !ROUTE_INVENTORY.some((sample) => routeDescriptorMatchesSample(route, sample)))
         .map(describeRouteDescriptor);
       assert.deepStrictEqual(
         uncoveredRoutes,
         [],
         `Registered routes missing inventory coverage: ${uncoveredRoutes.join(', ')}`
       );
     });

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

      if (allowSnapshotUpdate) {
        fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(currentSnapshot, null, 2) + '\n');
        console.log('\n  Snapshot refreshed from current route inventory.');
      } else {
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
              assert.fail(
                `New route missing from baseline snapshot: ${key}. Re-run with UPDATE_API_SNAPSHOT=1 after review to update the snapshot.`
              );
            }

            assert.ok(currentShape, `No response captured for ${key}`);

            assert.strictEqual(
              currentShape.status,
              baselineShape.status,
              `Status changed: expected ${baselineShape.status}, got ${currentShape.status}`
            );

            assert.strictEqual(
              currentShape.contentType,
              baselineShape.contentType,
              `Content-Type changed: expected ${baselineShape.contentType}, got ${currentShape.contentType}`
            );

            assert.strictEqual(
              currentShape.bodyType,
              baselineShape.bodyType,
              `Body type changed: expected ${baselineShape.bodyType}, got ${currentShape.bodyType}`
            );

            if (baselineShape.bodyKeys && currentShape.bodyKeys) {
              assert.deepStrictEqual(
                currentShape.bodyKeys,
                baselineShape.bodyKeys,
                `Body keys changed: expected [${baselineShape.bodyKeys.join(', ')}], got [${currentShape.bodyKeys.join(', ')}]`
              );
            }
          });
        }
      }
    }

  // Summary: route count
  await test(`route inventory count is ${ROUTE_INVENTORY.length}`, async () => {
    assert.strictEqual(ROUTE_INVENTORY.length, 158, `Expected 158 routes, got ${ROUTE_INVENTORY.length}`);
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
