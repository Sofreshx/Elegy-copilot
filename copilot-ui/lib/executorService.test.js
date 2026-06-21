'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createExecutorService } = require('./executorService');

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

function createSessionEmitter() {
  const listeners = new Set();
  return {
    on(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    emit(event) {
      for (const handler of Array.from(listeners)) {
        handler(event);
      }
    },
    async destroy() {
      listeners.clear();
    },
  };
}

function createMockSdkBridge() {
  const sessions = new Map();
  const createSessionCalls = [];
  let sequence = 0;
  let sendBehavior = { mode: 'success' };

  return {
    createSessionCalls,
    sessions,
    setSendBehavior(nextBehavior) {
      sendBehavior = nextBehavior;
    },
    async createSdkSession(options = {}) {
      createSessionCalls.push({ ...options });
      sequence += 1;
      const sessionId = options.sessionId || `sdk-${sequence}`;
      const session = createSessionEmitter();
      const record = {
        sessionId,
        session,
        contextType: options.contextType || 'regular',
        sandboxId: options.sandboxId || null,
        cwd: options.cwd || null,
      };
      sessions.set(sessionId, record);
      return { sessionId };
    },
    getSdkSession(sessionId) {
      const record = sessions.get(sessionId);
      return record ? { ...record } : null;
    },
    async sendToSession(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) {
        const error = new Error('SDK session not found');
        error.statusCode = 404;
        throw error;
      }

      if (sendBehavior.mode === 'rate-limit') {
        const error = new Error('Rate limit exceeded. Retry after 5 seconds');
        error.statusCode = 429;
        throw error;
      }

      return { messageId: `msg-${sessionId}` };
    },
    async destroySdkSession(sessionId) {
      return sessions.delete(sessionId);
    },
  };
}

function createFakeTimers() {
  const entries = new Map();
  let sequence = 0;

  return {
    entries,
    setTimeout(fn, delay) {
      const id = `timer-${++sequence}`;
      entries.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      entries.delete(id);
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

function createGitRepoRoot(repoPath) {
  fs.mkdirSync(path.join(repoPath, '.git', 'worktrees'), { recursive: true });
}

function createGitWorktree(repoPath, worktreePath, worktreeName = path.basename(worktreePath)) {
  const gitDir = path.join(repoPath, '.git', 'worktrees', worktreeName);
  fs.mkdirSync(worktreePath, { recursive: true });
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'commondir'), path.join('..', '..'));
  fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${gitDir}\n`);
}

async function run() {
  await test('scheduled jobs persist without creating an immediate run', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const timers = createFakeTimers();
    const service = await createExecutorService(
      { elegyHome, sdkBridge },
      { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }
    ).init();

    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const result = await service.createJob({
      prompt: 'schedule me',
      scheduleAt: scheduledAt,
      repoId: 'elegy-copilot',
      orchestration: {
        objective: 'Queue backend contract workflow',
        repo: {
          repoId: 'elegy-copilot',
        },
      },
    });

    assert.equal(result.run, null);
    assert.equal(service.listJobs()[0].status, 'scheduled');
    assert.equal(service.listJobs()[0].orchestration.objective, 'Queue backend contract workflow');
    assert.equal(service.listJobs()[0].worktree, null);
    assert.equal(timers.entries.size, 1);
    assert.equal(service.listRuns().length, 0);

    await service.shutdown();
  });

  await test('immediate runs complete after linked session becomes idle', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    const result = await service.createJob({
      prompt: 'implement this now',
      repoId: 'elegy-copilot',
      orchestration: {
        objective: 'Execute TASK-1',
        repo: {
          repoId: 'elegy-copilot',
        },
        taskRefs: [{ taskId: 'TASK-1' }],
      },
    });
    assert.ok(result.run);
    assert.equal(result.run.status, 'running');
    assert.equal(result.job.worktree, null);
    assert.equal(result.run.worktree, null);
    assert.equal(sdkBridge.createSessionCalls[0].orchestration.taskRefs[0].taskId, 'TASK-1');

    const session = sdkBridge.getSdkSession(result.run.sessionId);
    session.session.emit({ type: 'assistant.message', data: { text: 'Done.' } });
    session.session.emit({ type: 'session.idle', data: {} });
    await flushMicrotasks();

    const completedRun = service.getRun(result.run.id);
    assert.ok(completedRun);
    assert.equal(completedRun.status, 'succeeded');
    assert.equal(completedRun.summary, 'Done.');

    await service.shutdown();
  });

  await test('rate-limited runs schedule retry and succeed on a later attempt', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const timers = createFakeTimers();
    sdkBridge.setSendBehavior({ mode: 'rate-limit' });

    const service = await createExecutorService(
      { elegyHome, sdkBridge },
      { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }
    ).init();

    const result = await service.createJob({
      prompt: 'retry after rate limit',
      retryPolicy: {
        enabled: true,
        maxAttempts: 2,
        baseDelayMs: 1000,
        maxDelayMs: 1000,
        backoffMultiplier: 1,
      },
    });

    const retryingRun = service.getRun(result.run.id);
    assert.ok(retryingRun);
    assert.equal(retryingRun.status, 'retrying');
    assert.equal(retryingRun.worktree, null);
    assert.equal(timers.entries.size, 1);

    sdkBridge.setSendBehavior({ mode: 'success' });
    const retryTimer = Array.from(timers.entries.values())[0];
    retryTimer.fn();
    await flushMicrotasks();

    const activeRun = service.getRun(result.run.id);
    assert.equal(activeRun.status, 'running');
    const session = sdkBridge.getSdkSession(activeRun.sessionId);
    session.session.emit({ type: 'session.idle', data: {} });
    await flushMicrotasks();

    const completedRun = service.getRun(result.run.id);
    assert.equal(completedRun.status, 'succeeded');
    assert.equal(completedRun.attemptCount, 2);

    await service.shutdown();
  });

  await test('explicit worktree launches still fail closed without repo context', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    await assert.rejects(
      service.createJob({
        prompt: 'launch in dedicated worktree',
        worktree: {
          mode: 'dedicated',
        },
      }),
      (error) => error && error.statusCode === 400 && error.message === 'repoId/repoPath are required to resolve worktree launch state.'
    );

    await service.shutdown();
  });

  await test('sandbox create-session jobs require a valid sandbox id', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    await assert.rejects(
      service.createJob({ prompt: 'run in sandbox', contextType: 'sandbox' }),
      (error) => error && error.statusCode === 400 && error.message === 'sandboxId is required when contextType=sandbox'
    );

    await assert.rejects(
      service.createJob({ prompt: 'run in sandbox', contextType: 'sandbox', sandboxId: 'bad/id' }),
      (error) => error && error.statusCode === 400 && error.message === 'sandboxId must use only alphanumeric and hyphen characters'
    );

    assert.equal(sdkBridge.createSessionCalls.length, 0);
    await service.shutdown();
  });

  await test('sandbox session creation is revalidated before start when persisted executor state is malformed', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const stateDir = path.join(elegyHome, 'executor');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
      version: 1,
      jobs: [
        {
          id: 'job-malformed-sandbox',
          title: 'job-malformed-sandbox',
          prompt: 'resume malformed sandbox run',
          repoId: null,
          targetType: 'create-session',
          existingSessionId: null,
          model: null,
          contextType: 'sandbox',
          sandboxId: null,
          scheduleAt: null,
          retryPolicy: {
            enabled: true,
            maxAttempts: 3,
            baseDelayMs: 1000,
            maxDelayMs: 1000,
            backoffMultiplier: 1,
            jitterRatio: 0,
          },
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          lastRunId: null,
          activeRunId: null,
          status: 'idle',
        },
      ],
      runs: [],
    }, null, 2));

    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    const run = await service.triggerJob('job-malformed-sandbox', { source: 'manual' });

    assert.equal(run.status, 'failed');
    assert.equal(run.error, 'sandboxId is required when contextType=sandbox');
    assert.equal(sdkBridge.createSessionCalls.length, 0);

    await service.shutdown();
  });

  await test('same-repo create-session runs stay shared for the first writer and carry repo cwd metadata', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const repoPath = path.join(elegyHome, 'repo');
    createGitRepoRoot(repoPath);

    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    const result = await service.createJob({
      prompt: 'run in primary checkout',
      repoId: 'elegy-copilot',
      orchestration: {
        repo: {
          repoId: 'elegy-copilot',
          repoPath,
        },
      },
    });

    assert.ok(result.run);
    assert.equal(result.job.worktree.mode, 'shared');
    assert.equal(result.run.worktree.mode, 'shared');
    assert.equal(sdkBridge.createSessionCalls[0].cwd, path.resolve(repoPath));
    assert.equal(sdkBridge.createSessionCalls[0].orchestration.isolation.mode, 'shared');

    await service.shutdown();
  });

  await test('parallel same-repo create-session runs reserve a dedicated worktree and fail closed until it exists', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const repoPath = path.join(elegyHome, 'repo');
    createGitRepoRoot(repoPath);

    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    const first = await service.createJob({
      prompt: 'first writer',
      repoId: 'elegy-copilot',
      orchestration: {
        repo: {
          repoId: 'elegy-copilot',
          repoPath,
        },
      },
    });
    assert.equal(first.run.status, 'running');

    const second = await service.createJob({
      prompt: 'second writer',
      repoId: 'elegy-copilot',
      orchestration: {
        repo: {
          repoId: 'elegy-copilot',
          repoPath,
        },
      },
    });

    assert.equal(second.run.status, 'failed');
    assert.match(second.run.error, /worktree path is not prepared yet/i);
    assert.equal(second.job.worktree.mode, 'dedicated');
    assert.equal(second.job.worktree.launch.blocked, true);
    assert.equal(service.listWorktrees({ repoId: 'elegy-copilot' }).length, 1);

    await service.shutdown();
  });

  await test('prepared dedicated worktree metadata flows through executor launches and becomes active', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const repoPath = path.join(elegyHome, 'repo');
    const worktreePath = path.join(elegyHome, 'repo-worktrees', 'wt-1');
    createGitRepoRoot(repoPath);
    createGitWorktree(repoPath, worktreePath, 'wt-1');

    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();

    const first = await service.createJob({
      prompt: 'first writer',
      repoId: 'elegy-copilot',
      orchestration: {
        repo: {
          repoId: 'elegy-copilot',
          repoPath,
        },
      },
    });
    assert.equal(first.run.status, 'running');

    const second = await service.createJob({
      prompt: 'second writer',
      repoId: 'elegy-copilot',
      orchestration: {
        repo: {
          repoId: 'elegy-copilot',
          repoPath,
        },
      },
      worktree: {
        mode: 'dedicated',
        worktreeId: 'wt-1',
        worktreePath,
      },
    });

    assert.equal(second.run.status, 'running');
    assert.equal(sdkBridge.createSessionCalls[1].cwd, path.resolve(worktreePath));
    assert.equal(sdkBridge.createSessionCalls[1].orchestration.isolation.worktreeId, 'wt-1');

    const activeWorktree = service.listWorktrees({ repoId: 'elegy-copilot' })
      .find((entry) => entry.worktreeId === 'wt-1');
    assert.ok(activeWorktree);
    assert.equal(activeWorktree.status, 'active');

    await service.shutdown();
  });

  await test('existing-session workflow-layer events carry workflowId and sessionId before dispatch', async () => {
    const elegyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const seenEvents = [];
    await sdkBridge.createSdkSession({ sessionId: 'existing-session-1' });
    const service = await createExecutorService({ elegyHome, sdkBridge }).init();
    service.on('workflow-layer:event', (event) => {
      seenEvents.push(event);
    });

    const result = await service.createJob({
      prompt: 'continue the active session',
      targetType: 'existing-session',
      existingSessionId: 'existing-session-1',
      orchestration: {
        workflow: {
          workflowKind: 'task-execution',
        },
      },
    });

    const queuedEvent = seenEvents.find((event) => event.type === 'executor.run.queued');
    const startedEvent = seenEvents.find((event) => event.type === 'executor.attempt.started');

    assert.ok(result.run);
    assert.ok(queuedEvent);
    assert.ok(startedEvent);
    assert.equal(queuedEvent.sessionId, 'existing-session-1');
    assert.equal(startedEvent.sessionId, 'existing-session-1');
    assert.equal(queuedEvent.workflowId, result.job.id);
    assert.equal(startedEvent.workflowId, result.job.id);
    assert.equal(queuedEvent.run.orchestration.workflow.workflowId, result.job.id);
    assert.equal(startedEvent.run.orchestration.workflow.sessionId, 'existing-session-1');

    await service.shutdown();
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
