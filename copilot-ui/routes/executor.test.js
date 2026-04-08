'use strict';

const assert = require('node:assert/strict');

const { register } = require('./executor');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRequest(body) {
  const listeners = new Map();
  return {
    __body: body,
    on(eventName, handler) {
      if (!listeners.has(eventName)) {
        listeners.set(eventName, new Set());
      }
      listeners.get(eventName).add(handler);
    },
  };
}

function createResponse() {
  const state = {
    statusCode: null,
    bodyText: '',
  };

  return {
    writeHead(statusCode) {
      state.statusCode = statusCode;
    },
    end(text) {
      state.bodyText = String(text || '');
    },
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.bodyText.trim() ? JSON.parse(state.bodyText) : null;
    },
  };
}

async function invoke(routes, method, pathname, body) {
  const req = createRequest(body);
  const res = createResponse();

  for (const route of routes) {
    if (route.method !== method) continue;
    if (typeof route.path === 'string' && route.path === pathname) {
      route.handler({ req, res, match: null, pathname });
      await sleep(0);
      return { req, res };
    }
    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        route.handler({ req, res, match, pathname });
        await sleep(0);
        return { req, res };
      }
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function run() {
  const calls = [];
  const executorService = {
    getHealth() {
      calls.push('health');
      return { enabled: true, state: 'ready', jobCount: 1, runCount: 1, activeRunCount: 0, scheduledJobCount: 0, openedSessionCount: 1 };
    },
    listJobs() {
      calls.push('jobs');
      return [{ id: 'job-1', title: 'job-1', prompt: 'test', retryPolicy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, jitterRatio: 0 }, status: 'idle', createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z' }];
    },
    listRuns() {
      calls.push('runs');
      return [{ id: 'run-1', jobId: 'job-1', status: 'succeeded', attemptCount: 1, maxAttempts: 3, createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z', events: [] }];
    },
    listWorktrees() {
      calls.push('worktrees');
      return [{
        worktreeId: 'wt-1',
        repoId: 'repo-1',
        repoPath: '/repo-1',
        mode: 'dedicated',
        status: 'ready',
        launch: { blocked: false, reason: null },
      }];
    },
    resolveWorktree(payload) {
      calls.push(`resolve-worktree:${payload.repoId || 'none'}`);
      return {
        repo: {
          repoId: payload.repoId || 'repo-1',
          repoPath: payload.repoPath || '/repo-1',
        },
        cwd: payload.repoPath || '/repo-1',
        worktree: {
          worktreeId: 'wt-1',
          repoId: payload.repoId || 'repo-1',
          repoPath: payload.repoPath || '/repo-1',
          mode: payload.mode || 'shared',
          status: payload.mode === 'dedicated' ? 'pending_preparation' : 'shared',
          launch: {
            blocked: payload.mode === 'dedicated',
            reason: payload.mode === 'dedicated' ? 'Prepare the dedicated worktree first.' : null,
          },
        },
      };
    },
    getRun(runId) {
      calls.push(`run:${runId}`);
      return { id: runId, jobId: 'job-1', status: 'succeeded', attemptCount: 1, maxAttempts: 3, createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z', events: [] };
    },
    async createJob(payload) {
      calls.push(`create:${payload.prompt}`);
      return { job: { id: 'job-2', title: 'job-2', prompt: payload.prompt, retryPolicy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, jitterRatio: 0 }, status: 'idle', createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z' }, run: null };
    },
    async triggerJob(jobId) {
      calls.push(`trigger:${jobId}`);
      return { id: 'run-2', jobId, status: 'running', attemptCount: 1, maxAttempts: 3, createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z', events: [] };
    },
    async cancelJob(jobId) {
      calls.push(`cancel:${jobId}`);
      return { job: { id: jobId, title: jobId, prompt: 'test', retryPolicy: { enabled: true, maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1, jitterRatio: 0 }, status: 'idle', createdAt: '2026-03-20T00:00:00.000Z', updatedAt: '2026-03-20T00:00:00.000Z' }, run: null };
    },
  };

  const routes = register({
    executorService,
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    readJsonBody: async (req) => req.__body || {},
  });

  await test('GET executor routes return health, jobs, worktrees, runs, and run detail', async () => {
    const health = await invoke(routes, 'GET', '/api/executor/health');
    const jobs = await invoke(routes, 'GET', '/api/executor/jobs');
    const worktrees = await invoke(routes, 'GET', '/api/executor/worktrees');
    const runs = await invoke(routes, 'GET', '/api/executor/runs');
    const run = await invoke(routes, 'GET', '/api/executor/runs/run-1');

    assert.equal(health.res.statusCode, 200);
    assert.equal(health.res.body.orchestrationContractVersion, '1');
    assert.equal(jobs.res.statusCode, 200);
    assert.equal(worktrees.res.statusCode, 200);
    assert.equal(worktrees.res.body.worktrees[0].worktreeId, 'wt-1');
    assert.equal(runs.res.statusCode, 200);
    assert.equal(run.res.statusCode, 200);
    assert.equal(run.res.body.id, 'run-1');
  });

  await test('POST executor routes create, resolve worktrees, trigger, and cancel jobs', async () => {
    const created = await invoke(routes, 'POST', '/api/executor/jobs', { prompt: 'ship it' });
    const resolved = await invoke(routes, 'POST', '/api/executor/worktrees/resolve', { repoId: 'repo-1', mode: 'dedicated' });
    const triggered = await invoke(routes, 'POST', '/api/executor/jobs/job-1/trigger', {});
    const cancelled = await invoke(routes, 'POST', '/api/executor/jobs/job-1/cancel', {});

    assert.equal(created.res.statusCode, 201);
    assert.equal(resolved.res.statusCode, 200);
    assert.equal(resolved.res.body.worktree.worktreeId, 'wt-1');
    assert.equal(resolved.res.body.worktree.launch.blocked, true);
    assert.equal(triggered.res.statusCode, 200);
    assert.equal(cancelled.res.statusCode, 200);
    assert.equal(created.res.body.job.prompt, 'ship it');
    assert.equal(triggered.res.body.run.jobId, 'job-1');
    assert.equal(cancelled.res.body.job.id, 'job-1');
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
