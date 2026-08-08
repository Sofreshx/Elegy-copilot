'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const { discoverCheckPlan } = require('../lib/checkPlanService');

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

function registerWithMocks({ body = {}, qualityService, launchRepoQualityTask } = {}) {
  const { register } = require('./checks');
  return register({
    sendJson: createSendJson(),
    readJsonBody: createReadJsonBody(body),
    qualityService,
    launchRepoQualityTask,
  });
}

async function run() {
  console.log('\nChecks Route Tests\n');

  await test('register returns check route descriptors', async () => {
    const routes = registerWithMocks();
    assert.equal(routes.length, 19);
  });

  await test('GET /api/git/quality/status requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/git/quality/status');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/git/quality/status reports readiness for the selected repository', async () => {
    const testRepo = path.resolve(__dirname, '..');
    const qualityService = {
      buildRepoQualityStatus: async (repoPath) => ({
        schemaVersion: 1,
        repoPath,
        readiness: 'setup-required',
        nextAction: { id: 'setup-quality' },
      }),
    };
    const routes = registerWithMocks({ qualityService });
    const { res, body } = await invoke(routes, 'GET', `/api/git/quality/status?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.repoPath, testRepo);
    assert.equal(body.readiness, 'setup-required');
    assert.equal(body.nextAction.id, 'setup-quality');
  });

  await test('GET /api/git/quality/local-status defers GitHub work', async () => {
    const testRepo = path.resolve(__dirname, '..');
    let receivedDependencies = null;
    const qualityService = {
      buildRepoQualityStatus: async (repoPath, dependencies) => {
        receivedDependencies = dependencies;
        return {
          schemaVersion: 'repo-quality-status/v1',
          repoPath,
          readiness: 'ready',
          remote: await dependencies.github(),
        };
      },
    };
    const routes = registerWithMocks({ qualityService });
    const { res, body } = await invoke(routes, 'GET', `/api/git/quality/local-status?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.repoPath, testRepo);
    assert.equal(body.remote.deferred, true);
    assert.equal(typeof receivedDependencies.processService.run, 'function');
  });

  await test('POST /api/git/quality/setup-task requires repoPath', async () => {
    const routes = registerWithMocks({ body: {} });
    const { res, body } = await invoke(routes, 'POST', '/api/git/quality/setup-task');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('POST /api/git/quality/setup-task scopes the task to the selected repository', async () => {
    const testRepo = path.resolve(__dirname, '..');
    const qualityService = {
      createRepoQualitySetupTask: async (repoPath, options) => ({
        launched: false,
        repoPath,
        skill: 'repo-quality-setup',
        prompt: `Set up ${repoPath}`,
        launcherAvailable: Boolean(options.launchTask),
      }),
    };
    const routes = registerWithMocks({ body: { repoPath: testRepo }, qualityService });
    const { res, body } = await invoke(routes, 'POST', '/api/git/quality/setup-task');
    assert.equal(res.statusCode, 200);
    assert.equal(body.repoPath, testRepo);
    assert.equal(body.skill, 'repo-quality-setup');
    assert.equal(body.launched, false);
  });

  await test('GET /api/git/hooks/state requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/git/hooks/state');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('POST /api/git/hooks/setup requires repoPath in the request body', async () => {
    const routes = registerWithMocks({ body: {} });
    const { res, body } = await invoke(routes, 'POST', '/api/git/hooks/setup');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('POST /api/git/hooks/setup uses the selected repository', async () => {
    const testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-hooks-route-'));
    const scriptsDir = path.join(testRepo, 'scripts');
    fs.mkdirSync(scriptsDir);
    fs.writeFileSync(
      path.join(scriptsDir, 'setup-git-hooks.mjs'),
      "console.log(JSON.stringify({ repoPath: process.argv[3] }));\n",
      'utf8',
    );
    try {
      const routes = registerWithMocks({ body: { repoPath: testRepo } });
      const { res, body } = await invoke(routes, 'POST', '/api/git/hooks/setup');
      assert.equal(res.statusCode, 200);
      assert.equal(body.repoPath, testRepo);
    } finally {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
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

  await test('GET /api/git/checks/plan requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/git/checks/plan');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/git/checks/plan returns a read-only action plan', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/plan?repoPath=${encodeURIComponent(testRepo)}&action=push`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.schemaVersion, 'check-plan/v1');
    assert.equal(body.action, 'push');
    assert.equal(body.readOnly, true);
    assert.ok(Array.isArray(body.recommendedChecks));
    assert.ok(Array.isArray(body.omittedChecks));
  });

  await test('GET /api/git/checks/github-history requires repoPath', async () => {
    const routes = registerWithMocks();
    const { res, body } = await invoke(routes, 'GET', '/api/git/checks/github-history');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  await test('GET /api/git/checks/github-history keeps remote evidence in its own envelope', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/github-history?repoPath=${encodeURIComponent(testRepo)}&branch=main`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.source, 'github');
    assert.equal(typeof body.available, 'boolean');
    assert.ok(Array.isArray(body.runs));
    assert.equal(body.mergedIntoLocalEvidence, false);
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

  await test('POST /api/git/checks/run accepts a hash created for explicitly selected lanes', async () => {
    const testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-selected-plan-'));
    try {
      fs.writeFileSync(path.join(testRepo, 'package.json'), JSON.stringify({
        scripts: { test: 'node -e "process.exit(0)"' },
      }), 'utf8');
      const plan = discoverCheckPlan(testRepo, {
        action: 'commit',
        selectionMode: 'ai-selected',
        selectedIds: ['package.test'],
      });
      const routes = registerWithMocks({ body: {
        repoPath: testRepo,
        selectedLanes: ['package.test'],
        planHash: plan.planHash,
        action: 'commit',
        selectionMode: 'ai-selected',
      } });
      const { res, body } = await invoke(routes, 'POST', '/api/git/checks/run');
      assert.equal(res.statusCode, 200);
      assert.equal(typeof body.allPassed, 'boolean');
    } finally {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
  });

  await test('POST /api/git/checks/run can return a background job and a later complete result', async () => {
    const testRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'elegy-check-job-'));
    try {
      const routes = registerWithMocks({ body: { repoPath: testRepo, background: true } });
      const started = await invoke(routes, 'POST', '/api/git/checks/run', {});
      assert.equal(started.res.statusCode, 200);
      assert.equal(started.body.status, 'running');
      assert.ok(started.body.runId);

      let completed = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const polled = await invoke(routes, 'GET', `/api/git/checks/runs/${encodeURIComponent(started.body.runId)}`);
        if (polled.body.status === 'complete') {
          completed = polled;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(completed);
      assert.equal(completed.res.statusCode, 200);
      assert.equal(completed.body.result.source, 'none');
    } finally {
      fs.rmSync(testRepo, { recursive: true, force: true });
    }
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

  await test('GET /api/git/checks/ci-sync accepts explicit scope', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/ci-sync?repoPath=${encodeURIComponent(testRepo)}&scope=pr`);
    assert.equal(res.statusCode, 200);
    assert.equal(body.syncResult.summary.scope, 'pr');
  });

  await test('GET /api/git/checks/audit returns check proposals', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/audit?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body.proposals));
    assert.ok(body.summary);
  });

  await test('GET /api/git/checks/history returns paged run history', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/history?repoPath=${encodeURIComponent(testRepo)}&limit=1`);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body.runs));
    assert.equal(body.limit, 1);
    assert.ok(Object.prototype.hasOwnProperty.call(body, 'branch'));
  });

  await test('GET /api/git/checks/doctor returns diagnostic envelope', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/doctor?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.ok(body.config);
    assert.equal(typeof body.overall, 'string');
  });

  await test('GET /api/git/checks/packs returns bundled packs', async () => {
    const routes = registerWithMocks();
    const testRepo = path.resolve(__dirname, '..', '..');
    const { res, body } = await invoke(routes, 'GET', `/api/git/checks/packs?repoPath=${encodeURIComponent(testRepo)}`);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(body.packs));
    assert.ok(body.packs.some((pack) => pack.id === 'rust'));
  });

  await test('POST /api/git/checks/apply requires repoPath', async () => {
    const routes = registerWithMocks({ body: {} });
    const { res, body } = await invoke(routes, 'POST', '/api/git/checks/apply');
    assert.equal(res.statusCode, 400);
    assert.match(body.error, /repoPath/i);
  });

  console.log(`\n  ${passed} tests passed\n`);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exitCode = 1;
});
