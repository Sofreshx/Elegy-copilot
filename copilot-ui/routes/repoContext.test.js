'use strict';

const assert = require('node:assert/strict');

const { register } = require('./repoContext');

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
  const state = { statusCode: null, bodyText: '' };
  return {
    writeHead(statusCode) { state.statusCode = statusCode; },
    end(text) { state.bodyText = String(text || ''); },
    get statusCode() { return state.statusCode; },
    get body() { return state.bodyText ? JSON.parse(state.bodyText) : null; },
  };
}

async function invoke(routes, method, fullPath, body = null) {
  const queryIndex = fullPath.indexOf('?');
  const pathname = queryIndex === -1 ? fullPath : fullPath.slice(0, queryIndex);
  const u = new URL(`http://127.0.0.1${fullPath}`);
  const req = { method, __body: body };
  const res = createResponse();

  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      await route.handler({ req, res, u, match: null, pathname });
      return { res };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        await route.handler({ req, res, u, match, pathname });
        return { res };
      }
    }
  }
  throw new Error(`Route not found for ${method} ${fullPath}`);
}

function registerWith(service, body = null) {
  return register({
    docsRepairService: service,
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    readJsonBody: async () => body || {},
    fs: { existsSync: () => false },
  });
}

async function run() {
  console.log('\nRepo Context Route Tests\n');

  await test('GET repairs requires repoPath', async () => {
    const routes = registerWith({ getStatus: () => ({ runs: [] }) });
    const { res } = await invoke(routes, 'GET', '/api/repo-context/repairs');
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /repoPath/i);
  });

  await test('GET repairs returns service status', async () => {
    const routes = registerWith({
      getStatus(repoPath, repoId) {
        return { repoPath, repoId, runs: [], activeCount: 0, concurrencyLimit: 3, openCodeAvailable: true };
      },
    });
    const { res } = await invoke(routes, 'GET', '/api/repo-context/repairs?repoPath=/repo&repoId=repo-1');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.repoPath, '/repo');
    assert.equal(res.body.repoId, 'repo-1');
  });

  await test('POST repairs maps service validation errors to route status', async () => {
    const routes = registerWith({
      async startRepair() {
        throw Object.assign(new Error('No eligible docs repair issues match the request'), { statusCode: 422 });
      },
    }, { repoPath: '/repo', batchSize: 20 });
    const { res } = await invoke(routes, 'POST', '/api/repo-context/repairs', { repoPath: '/repo', batchSize: 20 });
    assert.equal(res.statusCode, 422);
    assert.match(res.body.error, /No eligible/i);
  });

  await test('POST repairs maps invalid batch size and over-concurrency errors', async () => {
    const invalidBatchRoutes = registerWith({
      async startRepair() {
        throw Object.assign(new Error('batchSize must be 20 or 50'), { statusCode: 400 });
      },
    }, { repoPath: '/repo', batchSize: 100 });
    const invalid = await invoke(invalidBatchRoutes, 'POST', '/api/repo-context/repairs', { repoPath: '/repo', batchSize: 100 });
    assert.equal(invalid.res.statusCode, 400);
    assert.match(invalid.res.body.error, /batchSize/i);

    const overLimitRoutes = registerWith({
      async startRepair() {
        throw Object.assign(new Error('Docs repair concurrency limit reached'), { statusCode: 409 });
      },
    }, { repoPath: '/repo', batchSize: 20 });
    const overLimit = await invoke(overLimitRoutes, 'POST', '/api/repo-context/repairs', { repoPath: '/repo', batchSize: 20 });
    assert.equal(overLimit.res.statusCode, 409);
    assert.match(overLimit.res.body.error, /concurrency limit/i);
  });

  await test('POST repairs returns accepted repair run envelope', async () => {
    const routes = registerWith({
      async startRepair(body) {
        return { run: { id: 'run-1', batchSize: body.batchSize }, status: { runs: [{ id: 'run-1' }] } };
      },
    }, { repoPath: '/repo', batchSize: 20 });
    const { res } = await invoke(routes, 'POST', '/api/repo-context/repairs', { repoPath: '/repo', batchSize: 20 });
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.run.id, 'run-1');
  });

  await test('GET repair detail returns 404 for missing run', async () => {
    const routes = registerWith({ getRun: () => null });
    const { res } = await invoke(routes, 'GET', '/api/repo-context/repairs/run-404?repoPath=/repo');
    assert.equal(res.statusCode, 404);
  });

  await test('GET repair detail returns run', async () => {
    const routes = registerWith({ getRun: (runId) => ({ id: runId, status: 'succeeded' }) });
    const { res } = await invoke(routes, 'GET', '/api/repo-context/repairs/run-1?repoPath=/repo');
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.run.id, 'run-1');
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
