'use strict';

const assert = require('node:assert/strict');
const { createDashboardHarnessSessionSnapshotStore } = require('../lib/dashboardHarnessSessionSnapshot');
const { register } = require('./dashboard');

function makeInventory(count, generation = 1) {
  const sessions = Array.from({ length: count }, (_, index) => ({
    harnessId: 'codex',
    sessionId: `session-${generation}-${String(index).padStart(4, '0')}`,
    title: `Session ${index}`,
    status: 'unknown',
    updatedAtMs: 2_000_000 - index,
    canOpen: false,
  }));
  return {
    totalSessionCount: count,
    harnesses: [{
      harnessId: 'codex',
      title: 'Codex',
      inventoryAvailable: true,
      inventoryReason: null,
      sessionCount: count,
      latestUpdatedAtMs: sessions[0]?.updatedAtMs || null,
      sessions,
    }],
    inventorySummary: { availableHarnessCount: 1, unavailableHarnessCount: 0 },
  };
}

function callRoute(route, pathname) {
  const response = {};
  const u = new URL(`http://127.0.0.1${pathname}`);
  const match = route.path instanceof RegExp ? u.pathname.match(route.path) : null;
  return Promise.resolve(route.handler({ res: response, u, pathname: u.pathname, match })).then(() => response);
}

async function run() {
  let now = 1_000;
  let builds = 0;
  let releaseBuild;
  const firstBuildGate = new Promise((resolve) => { releaseBuild = resolve; });
  const ids = ['snapshot-1', 'snapshot-2'];
  const store = createDashboardHarnessSessionSnapshotStore({
    ttlMs: 30_000,
    now: () => now,
    createId: () => ids.shift(),
    async buildSnapshot() {
      builds += 1;
      if (builds === 1) await firstBuildGate;
      return makeInventory(3_000, builds);
    },
  });
  const routes = register({
    snapshotStore: store,
    sendJson(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
    },
  });
  const legacy = routes.find((route) => route.path === '/api/dashboard/harness-sessions');
  const summary = routes.find((route) => route.path === '/api/dashboard/harness-sessions/summary');
  const page = routes.find((route) => route.path === '/api/dashboard/harness-sessions/page');
  const harnessPage = routes.find((route) => route.path instanceof RegExp);

  const summaryPromise = callRoute(summary, '/api/dashboard/harness-sessions/summary');
  const pagePromise = callRoute(page, '/api/dashboard/harness-sessions/page?harnessId=codex');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 1, 'concurrent cold requests must share one snapshot build');
  releaseBuild();

  const [summaryResponse, pageResponse] = await Promise.all([summaryPromise, pagePromise]);
  assert.equal(summaryResponse.statusCode, 200);
  assert.equal(summaryResponse.body.totalSessionCount, 3_000);
  assert.equal('sessions' in summaryResponse.body.harnesses[0], false);
  assert.equal(pageResponse.statusCode, 200);
  assert.equal(pageResponse.body.sessions.length, 100);
  assert.equal(pageResponse.body.page.limit, 100);
  assert.equal(pageResponse.body.page.hasMore, true);
  assert.ok(Buffer.byteLength(JSON.stringify(pageResponse.body), 'utf8') < 100_000);

  const warmStartedAt = performance.now();
  const pathPageResponse = await callRoute(harnessPage, '/api/dashboard/harness-sessions/codex?limit=100');
  const warmDurationMs = performance.now() - warmStartedAt;
  assert.equal(pathPageResponse.statusCode, 200);
  assert.equal(pathPageResponse.body.harnessId, 'codex');
  assert.equal(pathPageResponse.body.sessions.length, 100);
  assert.ok(warmDurationMs < 300, `warm Runtime page took ${warmDurationMs.toFixed(1)}ms`);

  const cappedResponse = await callRoute(page, '/api/dashboard/harness-sessions/page?harnessId=codex&limit=999');
  assert.equal(cappedResponse.body.sessions.length, 200);
  assert.equal(cappedResponse.body.page.limit, 200);
  assert.equal(builds, 1, 'warm requests must reuse the 30 second snapshot');

  const legacyResponse = await callRoute(legacy, '/api/dashboard/harness-sessions');
  assert.equal(legacyResponse.statusCode, 200);
  assert.equal(legacyResponse.body.harnesses[0].sessions.length, 3_000);

  const oldCursor = pageResponse.body.page.nextCursor;
  now += 30_001;
  const staleResponse = await callRoute(
    page,
    `/api/dashboard/harness-sessions/page?harnessId=codex&cursor=${encodeURIComponent(oldCursor)}`,
  );
  assert.equal(staleResponse.statusCode, 409);
  assert.equal(staleResponse.body.error, 'stale_cursor');
  assert.equal(builds, 2);

  console.log('dashboard route pagination tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
