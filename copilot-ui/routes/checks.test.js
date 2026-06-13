'use strict';

const assert = require('node:assert/strict');
const path = require('path');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
    process.exitCode = 1;
  }
}

function createResponse() {
  const state = { statusCode: null, headers: null, chunks: [] };
  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode, headers) { state.statusCode = statusCode; state.headers = headers; },
    write(chunk) { if (chunk != null) state.chunks.push(String(chunk)); return true; },
    end(chunk) { if (chunk != null) state.chunks.push(String(chunk)); },
  };
}

function parseBody(response) {
  return JSON.parse(response.bodyText || '{}');
}

function createSendJson() {
  return (res, code, payload) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(payload, null, 2));
  };
}

function createReadJsonBody(bodyObj) {
  return async () => bodyObj;
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) return { route, match: null };
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) return { route, match };
    }
  }
  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname, body) {
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);
  const { route, match } = findRoute(routes, method, u.pathname);
  const req = { method };
  await route.handler({ req, res, u, match, pathname: u.pathname });
  return { res, body: parseBody(res) };
}

function registerWithMocks({ body = {} } = {}) {
  const { register } = require('./checks');
  return register({
    sendJson: createSendJson(),
    readJsonBody: createReadJsonBody(body),
  });
}

async function run() {
  console.log('\nChecks Route Tests\n');

  await test('register returns 4 route descriptors', async () => {
    const routes = registerWithMocks();
    assert.equal(routes.length, 4);
  });

  await test('GET /api/git/checks/discover requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/git/checks/discover');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/git/checks/discover returns checks for valid repo', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/discover?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(typeof body.checksAvailable, 'number');
    assert.ok(Array.isArray(body.checks));
  });

  await test('POST /api/git/checks/run requires repoPath', async () => {
    const routes = registerWithMocks({ body: {} });
    const { res, body } = await invoke(routes, 'POST', '/api/git/checks/run');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('POST /api/git/checks/run returns structured results', async () => {
    const routes = registerWithMocks({ body: { repoPath: path.resolve(__dirname, '..') } });
    const { res, body } = await invoke(routes, 'POST', '/api/git/checks/run');
    assert.equal(res.statusCode, 200);
    assert.equal(typeof body.allPassed, 'boolean');
    assert.equal(typeof body.checksRun, 'number');
    assert.ok(Array.isArray(body.results));
  });

  await test('GET /api/git/checks/state returns persisted state envelope', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/state?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.repoPath, testRepo);
    assert.equal(typeof body.hasState, 'boolean');
    assert.equal(typeof body.freshness.reason, 'string');
  });

  await test('GET /api/git/checks/ci-sync returns CI mapping summary', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/ci-sync?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.repoRoot, testRepo);
    assert.ok(body.syncResult);
    assert.equal(typeof body.syncResult.summary.gaps, 'number');
    assert.ok(Array.isArray(body.syncResult.mappings));
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
