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

async function run() {
  await test('scheduled jobs persist without creating an immediate run', async () => {
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const timers = createFakeTimers();
    const service = await createExecutorService(
      { copilotHome, sdkBridge },
      { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }
    ).init();

    const scheduledAt = new Date(Date.now() + 60_000).toISOString();
    const result = await service.createJob({ prompt: 'schedule me', scheduleAt: scheduledAt });

    assert.equal(result.run, null);
    assert.equal(service.listJobs()[0].status, 'scheduled');
    assert.equal(timers.entries.size, 1);
    assert.equal(service.listRuns().length, 0);

    await service.shutdown();
  });

  await test('immediate runs complete after linked session becomes idle', async () => {
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ copilotHome, sdkBridge }).init();

    const result = await service.createJob({ prompt: 'implement this now' });
    assert.ok(result.run);
    assert.equal(result.run.status, 'running');

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
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const timers = createFakeTimers();
    sdkBridge.setSendBehavior({ mode: 'rate-limit' });

    const service = await createExecutorService(
      { copilotHome, sdkBridge },
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

  await test('sandbox create-session jobs require a valid sandbox id', async () => {
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const sdkBridge = createMockSdkBridge();
    const service = await createExecutorService({ copilotHome, sdkBridge }).init();

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
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-executor-service-'));
    const stateDir = path.join(copilotHome, 'executor');
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
    const service = await createExecutorService({ copilotHome, sdkBridge }).init();

    const run = await service.triggerJob('job-malformed-sandbox', { source: 'manual' });

    assert.equal(run.status, 'failed');
    assert.equal(run.error, 'sandboxId is required when contextType=sandbox');
    assert.equal(sdkBridge.createSessionCalls.length, 0);

    await service.shutdown();
  });

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
