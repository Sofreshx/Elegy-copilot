'use strict';

const assert = require('node:assert/strict');

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

function createSignalEmitter() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      if (!listeners.has(eventName)) {
        listeners.set(eventName, new Set());
      }
      listeners.get(eventName).add(handler);
      return this;
    },
    off(eventName, handler) {
      const handlers = listeners.get(eventName);
      if (handlers) {
        handlers.delete(handler);
      }
      return this;
    },
    emit(eventName, payload) {
      const handlers = listeners.get(eventName);
      if (!handlers) return;
      for (const handler of Array.from(handlers)) {
        handler(payload);
      }
    },
  };
}

function createFakeReq() {
  return createSignalEmitter();
}

function createFakeRes() {
  const emitter = createSignalEmitter();
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
    writableEnded: false,
    destroyed: false,
  };

  return {
    ...emitter,
    get statusCode() {
      return state.statusCode;
    },
    get headers() {
      return state.headers;
    },
    get writableEnded() {
      return state.writableEnded;
    },
    get destroyed() {
      return state.destroyed;
    },
    writeHead(statusCode, headers) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    write(chunk) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk) {
      if (chunk != null) {
        state.chunks.push(String(chunk));
      }
      state.writableEnded = true;
    },
    flushHeaders() {
      // no-op in tests
    },
    toString() {
      return state.chunks.join('');
    },
  };
}

function createMockSession(sessionId) {
  const handlers = new Set();
  const sends = [];
  let destroyCalls = 0;

  return {
    sessionId,
    sends,
    get destroyCalls() {
      return destroyCalls;
    },
    on(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    emit(event) {
      for (const handler of Array.from(handlers)) {
        handler(event);
      }
    },
    async send(payload) {
      sends.push(payload);
      return `msg-${sends.length}`;
    },
    async destroy() {
      destroyCalls += 1;
    },
  };
}

function createMockClient() {
  const sessions = [];
  let started = false;
  let stopped = false;
  let state = 'disconnected';
  let stopCalls = 0;
  let createCalls = 0;
  let lastCreateConfig = null;

  return {
    get started() {
      return started;
    },
    get stopped() {
      return stopped;
    },
    get stopCalls() {
      return stopCalls;
    },
    get createCalls() {
      return createCalls;
    },
    get lastCreateConfig() {
      return lastCreateConfig;
    },
    get sessions() {
      return sessions;
    },
    async start() {
      started = true;
      state = 'connected';
    },
    async stop() {
      stopped = true;
      state = 'disconnected';
      stopCalls += 1;
      return [];
    },
    getState() {
      return state;
    },
    async createSession(config) {
      createCalls += 1;
      lastCreateConfig = config;
      const session = createMockSession(config && config.sessionId ? config.sessionId : `session-${createCalls}`);
      sessions.push(session);
      return session;
    },
  };
}

async function run() {
  const bridgeModule = await import('./index.mjs');
  const { SdkBridgeService } = bridgeModule;

  await test('init() starts CopilotClient and shutdown() clears state', async () => {
    const mockClient = createMockClient();
    const service = new SdkBridgeService(
      { mode: 'spawn', clientOptions: { autoStart: false } },
      { createClient: () => mockClient }
    );

    await service.init();
    assert.equal(mockClient.started, true);
    assert.equal(service.initialized, true);

    const created = await service.createSdkSession({ sessionId: 'session-lifecycle' });
    assert.equal(created.sessionId, 'session-lifecycle');
    assert.equal(service.listSdkSessions().length, 1);

    const shutdown = await service.shutdown();
    assert.equal(shutdown.stopped, true);
    assert.equal(mockClient.stopCalls, 1);
    assert.equal(service.listSdkSessions().length, 0);
    assert.equal(service.initialized, false);
  });

  await test('createSdkSession wires hooks including permission handler', async () => {
    const policyCalls = [];
    const invocationCalls = [];
    const mockClient = createMockClient();
    const service = new SdkBridgeService(
      {
        copilotHome: '/tmp/copilot-home',
        policyPreflightFn: async (payload) => {
          policyCalls.push(payload);
          return { allow: true, reason: 'ok' };
        },
      },
      {
        createClient: () => mockClient,
        recordAssetInvocation: async (payload) => {
          invocationCalls.push(payload);
          return { logged: true };
        },
      }
    );

    await service.init();
    await service.createSdkSession({
      sessionId: 'session-hooks',
      cwd: '/workspace/repo',
      availableTools: [
        {
          toolName: 'edit_file',
          metadata: {
            assetId: 'skill-edit-file',
            assetKey: 'edit-file',
            assetKind: 'skill',
          },
        },
      ],
    });

    assert.equal(typeof mockClient.lastCreateConfig.onPreToolUse, 'function');
    assert.equal(typeof mockClient.lastCreateConfig.onSessionEnd, 'function');
    assert.equal(typeof mockClient.lastCreateConfig.onPermissionRequest, 'function');
    assert.equal(typeof mockClient.lastCreateConfig.hooks.onPreToolUse, 'function');

    const session = mockClient.sessions[0];
    session.emit({
      type: 'tool.user_requested',
      data: {
        toolCallId: 'call-1',
        toolName: 'edit_file',
        arguments: { path: 'a.txt' },
      },
    });

    await sleep(0);

    assert.equal(policyCalls.length, 2);
    assert.equal(invocationCalls.length, 1);
    assert.equal(invocationCalls[0].copilotHome, '/tmp/copilot-home');
    assert.equal(invocationCalls[0].repoPath, '/workspace/repo');
    assert.equal(invocationCalls[0].toolName, 'edit_file');
    assert.equal(invocationCalls[0].toolCallId, 'call-1');
    assert.equal(invocationCalls[0].availableTools[0].metadata.assetId, 'skill-edit-file');
    assert.equal(policyCalls[0].stage, 'pre-tool-use');
    assert.equal(policyCalls[1].stage, 'permission-request');
    assert.equal(policyCalls[1].kind, 'tool_execution');

    await service.shutdown();
  });

  await test('attachSseClient sets headers, emits connected, and relays key events', async () => {
    const mockClient = createMockClient();
    const service = new SdkBridgeService(
      { maxSseClientsPerSession: 10 },
      { createClient: () => mockClient }
    );

    await service.init();
    await service.createSdkSession({ sessionId: 'session-sse' });

    const req = createFakeReq();
    const res = createFakeRes();

    const attachResult = service.attachSseClient('session-sse', req, res);
    assert.equal(attachResult.ok, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.match(res.toString(), /event: connected/);

    const session = mockClient.sessions[0];
    session.emit({ type: 'assistant.message', data: { content: 'hello' } });

    assert.match(res.toString(), /event: assistant.message/);
    assert.match(res.toString(), /"type":"assistant.message"/);

    const detached = service.detachSseClient('session-sse', res);
    assert.equal(detached, true);
    assert.equal(res.writableEnded, true);

    await service.shutdown();
  });

  await test('attachSseClient enforces max clients per session', async () => {
    const mockClient = createMockClient();
    const service = new SdkBridgeService(
      { maxSseClientsPerSession: 1 },
      { createClient: () => mockClient }
    );

    await service.init();
    await service.createSdkSession({ sessionId: 'session-max-sse' });

    const req1 = createFakeReq();
    const res1 = createFakeRes();
    const req2 = createFakeReq();
    const res2 = createFakeRes();

    const first = service.attachSseClient('session-max-sse', req1, res1);
    const second = service.attachSseClient('session-max-sse', req2, res2);

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.statusCode, 429);

    await service.shutdown();
  });

  await test('session map methods and send path work with expected errors', async () => {
    const mockClient = createMockClient();
    const service = new SdkBridgeService({}, { createClient: () => mockClient });

    await service.init();

    const created = await service.createSdkSession({
      sessionId: 'session-send',
      model: 'gpt-5.3-codex',
      orchestration: {
        objective: 'Ship backend contract',
        repo: {
          repoId: 'instruction-engine',
        },
      },
    });
    assert.equal(created.sessionId, 'session-send');
    assert.equal(created.orchestration.objective, 'Ship backend contract');

    const listed = service.listSdkSessions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].model, 'gpt-5.3-codex');
    assert.equal(listed[0].orchestration.repo.repoId, 'instruction-engine');

    const found = service.getSdkSession('session-send');
    assert.equal(found.sessionId, 'session-send');
    assert.equal(found.orchestration.objective, 'Ship backend contract');

    const sent = await service.sendToSession('session-send', { prompt: 'hello world' });
    assert.equal(sent.messageId, 'msg-1');

    await assert.rejects(
      () => service.sendToSession('session-send', { prompt: '   ' }),
      (error) => error && error.code === 'SDK_INVALID_PAYLOAD'
    );

    await assert.rejects(
      () => service.sendToSession('missing-session', { prompt: 'hello' }),
      (error) => error && error.code === 'SDK_SESSION_NOT_FOUND'
    );

    const removed = await service.destroySdkSession('session-send');
    assert.equal(removed, true);
    assert.equal(service.getSdkSession('session-send'), null);

    await service.shutdown();
  });

  await test('sandbox session context spins dedicated client and preserves cwd metadata', async () => {
    const defaultClient = createMockClient();
    const dedicatedClient = createMockClient();
    const clientOptionsLog = [];

    const service = new SdkBridgeService(
      {
        clientOptions: {
          autoStart: true,
          cwd: '/workspace/default',
        },
      },
      {
        createClient: (options) => {
          clientOptionsLog.push(options);
          return clientOptionsLog.length === 1 ? defaultClient : dedicatedClient;
        },
      }
    );

    await service.init();

    const created = await service.createSdkSession({
      sessionId: 'session-sandbox',
      contextType: 'sandbox',
      sandboxId: 'sb-1',
      cwd: '/workspace/sandboxes/sb-1',
    });

    assert.equal(created.sessionId, 'session-sandbox');
    assert.equal(created.contextType, 'sandbox');
    assert.equal(created.sandboxId, 'sb-1');
    assert.equal(created.cwd, '/workspace/sandboxes/sb-1');
    assert.equal(dedicatedClient.started, true);

    const listed = service.listSdkSessions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].contextType, 'sandbox');
    assert.equal(listed[0].sandboxId, 'sb-1');
    assert.equal(listed[0].cwd, '/workspace/sandboxes/sb-1');

    await service.destroySdkSession('session-sandbox');
    assert.equal(dedicatedClient.stopCalls, 1);

    await service.shutdown();
  });

  await test('getHealth reflects session errors relayed from SDK events', async () => {
    const mockClient = createMockClient();
    const service = new SdkBridgeService({}, { createClient: () => mockClient });

    await service.init();
    await service.createSdkSession({ sessionId: 'session-health' });

    const session = mockClient.sessions[0];
    session.emit({
      type: 'session.error',
      data: {
        message: 'simulated session failure',
      },
    });

    const health = await service.getHealth();
    assert.equal(health.connected, true);
    assert.equal(health.state, 'connected');
    assert.equal(health.error, 'simulated session failure');

    await service.shutdown();
  });

  if (!process.exitCode) {
    console.log(`sdk bridge tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('sdk bridge tests failed');
  console.error(error);
  process.exitCode = 1;
});
