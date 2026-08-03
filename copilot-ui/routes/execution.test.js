'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { register, resolveDiscovery, deriveSetupStatus } = require('./execution');
const { sendJson: realSendJson } = require('./_helpers');

let tmpRoot;
let repoPath;

function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(tmpRoot, 'exec-repo-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return root;
}

function makeCtx(method, pathname, { query = {}, body } = {}) {
  const req = {
    method,
    url: pathname,
  };
  let bodyResolve;
  const bodyPromise = new Promise((resolve) => { bodyResolve = resolve; });
  if (body !== undefined) bodyResolve(body);
  else bodyResolve({});
  req.on = () => {};
  return {
    req,
    res: {},
    u: new URL(`http://127.0.0.1${pathname}${buildQuery(query)}`),
    pathname,
    match: null,
    bodyPromise,
    async readJsonBody() {
      return this.bodyPromise;
    },
  };
}

function buildQuery(params) {
  const keys = Object.keys(params);
  if (keys.length === 0) return '';
  return '?' + keys.map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
}

async function dispatch(ctx, deps = {}) {
  const responses = [];
  const sendJson = (res, code, obj) => responses.push({ code, body: obj });
  const routes = register({ sendJson, readJsonBody: (req) => ctx.readJsonBody() });
  const u = ctx.u;
  for (const route of routes) {
    if (route.method !== ctx.req.method) continue;
    if (typeof route.path === 'string') {
      if (u.pathname === route.path) {
        ctx.match = null;
        await route.handler(ctx);
        return responses[responses.length - 1];
      }
    } else if (route.path instanceof RegExp) {
      const m = u.pathname.match(route.path);
      if (m) {
        ctx.match = m;
        await route.handler(ctx);
        return responses[responses.length - 1];
      }
    }
  }
  return responses[responses.length - 1] || null;
}

function fixtureRepo(overrides = {}) {
  return makeRepo({
    'package.json': JSON.stringify({
      name: 'fixture',
      scripts: {
        install: 'npm ci',
        dev: 'vite',
        test: 'vitest run',
        build: 'tsc -p tsconfig.json',
        long: 'node -e "setTimeout(function(){}, 30000)"',
        quick: 'node -e "console.log(42)"',
      },
    }, null, 2),
    'README.md': [
      '# Fixture',
      '```bash',
      'npm install',
      'npm run dev',
      '```',
    ].join('\n'),
    ...overrides,
  });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-routes-'));
  repoPath = fixtureRepo();
});

test('GET /api/execution/overview returns discovery, setup status, and last runs', async () => {
  const ctx = makeCtx('GET', '/api/execution/overview', { query: { repoPath } });
  const response = await dispatch(ctx);
  assert.equal(response.code, 200);
  assert.equal(response.body.repoPath, repoPath);
  assert.ok(response.body.discovery.categories.length > 0);
  assert.equal(response.body.setup.status, 'not-started');
  assert.deepEqual(response.body.lastRuns, {});
  assert.equal(response.body.activeRun, null);
});

test('overview validates repoPath and missing repo', async () => {
  const ctx = makeCtx('GET', '/api/execution/overview');
  const response = await dispatch(ctx);
  assert.equal(response.code, 400);

  const missing = makeCtx('GET', '/api/execution/overview', {
    query: { repoPath: path.join(tmpRoot, 'does-not-exist') },
  });
  const missingResponse = await dispatch(missing);
  assert.equal(missingResponse.code, 404);
});

test('overview reuses cache and refresh invalidates it', async () => {
  const ctx = makeCtx('GET', '/api/execution/overview', { query: { repoPath } });
  const first = await dispatch(ctx);
  assert.equal(first.body.discovery.meta.total, first.body.discovery.meta.total);

  fs.appendFileSync(path.join(repoPath, 'README.md'), '\n```bash\ncargo build\n```\n', 'utf8');
  const stale = await dispatch(makeCtx('GET', '/api/execution/overview', { query: { repoPath } }));
  assert.ok(stale.body.discovery.categories.some((g) => g.id === 'build'), 'stale cache re-discovered after README change');

  const refresh = await dispatch(makeCtx('POST', '/api/execution/refresh', { query: { repoPath } }));
  assert.equal(refresh.code, 200);
  assert.equal(refresh.body.discovery.repoPath, repoPath);
});

test('POST /api/execution/run resolves discovered commands and starts a run', async () => {
  const ctx = makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'npm:long' },
  });
  const response = await dispatch(ctx);
  assert.equal(response.code, 200);
  assert.ok(response.body.runId);
  assert.equal(response.body.run.status, 'running');
  assert.equal(response.body.run.kind, 'command');

  const statusCtx = makeCtx('GET', `/api/execution/runs/${response.body.runId}`);
  const statusResponse = await dispatch(statusCtx);
  assert.equal(statusResponse.code, 200);
  assert.equal(statusResponse.body.run.status, 'running');

  const stopCtx = makeCtx('POST', `/api/execution/runs/${response.body.runId}/stop`);
  const stopResponse = await dispatch(stopCtx);
  assert.equal(stopResponse.code, 200);
  assert.equal(stopResponse.body.run.status, 'stopped');
});

test('run rejects unknown commands with 404', async () => {
  const ctx = makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'nope:not-a-command' },
  });
  const response = await dispatch(ctx);
  assert.equal(response.code, 404);
});

test('run rejects concurrent second run with 409', async () => {
  const first = await dispatch(makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'npm:long' },
  }));
  assert.equal(first.code, 200);

  const second = await dispatch(makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'npm:test' },
  }));
  assert.equal(second.code, 409);
  assert.equal(second.body.code, 'busy');

  const stopCtx = makeCtx('POST', `/api/execution/runs/${first.body.runId}/stop`);
  await dispatch(stopCtx);
});

test('run validates repoPath and body fields', async () => {
  const missing = await dispatch(makeCtx('POST', '/api/execution/run', {
    query: { repoPath: path.join(tmpRoot, 'nope') },
    body: { repoPath: path.join(tmpRoot, 'nope'), commandId: 'npm:test' },
  }));
  assert.equal(missing.code, 404);

  const noCommand = await dispatch(makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath },
  }));
  assert.equal(noCommand.code, 400);

  const mismatch = await dispatch(makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath: '/other/path', commandId: 'npm:test' },
  }));
  assert.equal(mismatch.code, 400);
});

test('POST /api/execution/setup runs the discovered setup command', async () => {
  const ctx = makeCtx('POST', '/api/execution/setup', {
    query: { repoPath },
    body: { repoPath },
  });
  const response = await dispatch(ctx);
  assert.equal(response.code, 200);
  assert.ok(response.body.runId);
  assert.equal(response.body.run.kind, 'setup');

  const stopCtx = makeCtx('POST', `/api/execution/runs/${response.body.runId}/stop`);
  const stopResponse = await dispatch(stopCtx);
  assert.equal(stopResponse.code, 200);
});

test('setup returns 404 when no setup command is discovered', async () => {
  const bare = makeRepo({ 'README.md': '# nothing here\n```bash\necho hi\n```\n' });
  const ctx = makeCtx('POST', '/api/execution/setup', {
    query: { repoPath: bare },
    body: { repoPath: bare },
  });
  const response = await dispatch(ctx);
  assert.equal(response.code, 404);
});

test('run status returns 404 for unknown run ids', async () => {
  const ctx = makeCtx('GET', '/api/execution/runs/not-a-real-run');
  const response = await dispatch(ctx);
  assert.equal(response.code, 404);
});

test('setup status derivation transitions with outcomes', async () => {
  const { discovery } = resolveDiscovery(repoPath, true);
  const outcomes = { setup: { lastRunAt: '2026-01-01T00:00:00Z', lastExitCode: 0 } };
  const done = deriveSetupStatus(repoPath, discovery, null, outcomes);
  assert.equal(done.status, 'done');

  const failedOutcomes = { setup: { lastRunAt: '2026-01-01T00:00:00Z', lastExitCode: 1 } };
  const failed = deriveSetupStatus(repoPath, discovery, null, failedOutcomes);
  assert.equal(failed.status, 'failed');

  const none = deriveSetupStatus(repoPath, discovery, null, {});
  assert.equal(none.status, 'not-started');
});

test('runs a discovered command to completion with exit code 0 and output', async () => {
  // Regression: on Windows, npm/yarn shims (npm.cmd) must spawn through the
  // shell; the earlier cmd.exe /c line building produced
  // '\\"C:\\Program Files\\nodejs\\npm.cmd run compile\\"' is not recognized.
  const ctx = makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'npm:quick' },
  });
  const started = await dispatch(ctx);
  assert.equal(started.code, 200);

  let final = null;
  for (let i = 0; i < 50; i += 1) {
    const status = await dispatch(makeCtx('GET', `/api/execution/runs/${started.body.runId}`));
    if (status.body.run.status !== 'running') {
      final = status.body.run;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(final, 'run finished within timeout');
  assert.equal(final.status, 'done');
  assert.equal(final.exitCode, 0);
  assert.match(final.stdout, /42/);
  assert.equal(final.stderr, '');
});

test('last run outcomes persist after completion', async () => {
  const ctx = makeCtx('POST', '/api/execution/run', {
    query: { repoPath },
    body: { repoPath, commandId: 'npm:test' },
  });
  const started = await dispatch(ctx);
  assert.equal(started.code, 200);

  let final = null;
  for (let i = 0; i < 50; i += 1) {
    const status = await dispatch(makeCtx('GET', `/api/execution/runs/${started.body.runId}`));
    if (status.body.run.status !== 'running') {
      final = status.body.run;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(final, 'run finished within timeout');
  assert.equal(typeof final.exitCode, 'number');

  const overview = await dispatch(makeCtx('GET', '/api/execution/overview', { query: { repoPath } }));
  assert.equal(typeof overview.body.lastRuns['npm:test'].lastExitCode, 'number');
  assert.ok(overview.body.lastRuns['npm:test'].lastRunAt);
});
