'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { register } = require('./sdk');

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

function createEmitter() {
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

function createRequest(body) {
  const emitter = createEmitter();
  return {
    ...emitter,
    __body: body,
  };
}

function createResponse() {
  const emitter = createEmitter();
  const state = {
    statusCode: null,
    headers: null,
    chunks: [],
    ended: false,
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
    get bodyText() {
      return state.chunks.join('');
    },
    get writableEnded() {
      return state.ended;
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
      state.ended = true;
    },
    flushHeaders() {
      // no-op
    },
  };
}

function parseJsonBody(response) {
  const text = response.bodyText.trim();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

function findRoute(routes, method, pathname) {
  for (const route of routes) {
    if (route.method !== method) continue;

    if (typeof route.path === 'string' && route.path === pathname) {
      return { route, match: null };
    }

    if (route.path instanceof RegExp) {
      const match = pathname.match(route.path);
      if (match) {
        return { route, match };
      }
    }
  }

  throw new Error(`Route not found for ${method} ${pathname}`);
}

async function invoke(routes, method, pathname, body, extraContext = {}) {
  const { route, match } = findRoute(routes, method, pathname);
  const req = createRequest(body);
  const res = createResponse();
  const u = new URL(`http://127.0.0.1${pathname}`);

  route.handler({ req, res, u, match, pathname, ...extraContext });
  await sleep(0);

  return { req, res };
}

function createMockSdkBridge() {
  const sessions = new Map();
  let sequence = 0;

  return {
    sessions,
    async getHealth() {
      return {
        connected: true,
        state: 'connected',
      };
    },
    async createSdkSession(payload) {
      sequence += 1;
      const sessionId = payload && payload.sessionId ? payload.sessionId : `session-${sequence}`;
      const created = {
        sessionId,
        model: payload && payload.model ? payload.model : null,
        createdAt: '2026-03-01T00:00:00.000Z',
        orchestration: payload && payload.orchestration ? payload.orchestration : null,
      };
      sessions.set(sessionId, created);
      return created;
    },
    listSdkSessions() {
      return Array.from(sessions.values());
    },
    async destroySdkSession(sessionId) {
      return sessions.delete(sessionId);
    },
    async sendToSession(sessionId, payload) {
      if (!sessions.has(sessionId)) {
        const error = new Error('SDK session not found');
        error.code = 'SDK_SESSION_NOT_FOUND';
        throw error;
      }
      if (!payload || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
        const error = new Error('prompt is required');
        error.code = 'SDK_INVALID_PAYLOAD';
        throw error;
      }
      return { messageId: `msg-${sessionId}` };
    },
    attachSseClient(sessionId, req, res) {
      if (!sessions.has(sessionId)) {
        return {
          ok: false,
          statusCode: 404,
          error: 'SDK session not found',
        };
      }
      if (sessionId === 'sse-limit') {
        return {
          ok: false,
          statusCode: 429,
          error: 'SSE client limit reached (10)',
        };
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
      });
      res.write('event: connected\n');
      res.write('data: {"ok":true}\n\n');

      return {
        ok: true,
        statusCode: 200,
      };
    },
  };
}

async function run() {
  await test('register() keeps SDK routes available when sdkBridge is missing', async () => {
    const routes = register({
      sendJson: () => {
        throw new Error('sendJson should not be called during route registration');
      },
      readJsonBody: async () => ({}),
    });

    assert.ok(Array.isArray(routes));
    assert.ok(routes.length > 0);
  });

  await test('disabled bridge returns deterministic health and propagates blocked reason/message for SDK actions', async () => {
    process.env.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON = JSON.stringify({
      channel: 'stable',
      cliChannel: 'stable',
      sdkChannel: 'stable',
      status: 'blocked',
      approved: false,
      reason: 'managed_cli_missing',
      message: 'Managed Copilot CLI for the stable lane is required, but no bundled or seeded payload is available.',
      source: 'none',
    });
    process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON = 'managed_cli_missing';
    process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE =
      'Managed Copilot CLI for the stable lane is required, but no bundled or seeded payload is available.';

    try {
      const routes = register({
        sendJson(res, code, payload) {
          const text = JSON.stringify(payload, null, 2);
          res.writeHead(code, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(text);
        },
        readJsonBody: async (req) => req.__body || {},
      });

      const health = await invoke(routes, 'GET', '/api/sdk/health');
      assert.equal(health.res.statusCode, 200);
      assert.deepEqual(parseJsonBody(health.res), {
        connected: false,
        enabled: false,
        state: 'disabled',
        mode: 'disabled',
        sessionCount: 0,
        reason: 'managed_cli_missing',
        error: 'Managed Copilot CLI for the stable lane is required, but no bundled or seeded payload is available.',
        cliManager: {
          channel: 'stable',
          cliChannel: 'stable',
          sdkChannel: 'stable',
          status: 'blocked',
          approved: false,
          reason: 'managed_cli_missing',
          message: 'Managed Copilot CLI for the stable lane is required, but no bundled or seeded payload is available.',
          source: 'none',
        },
      });

      const expectedBlockedPayload = {
        error: 'Managed Copilot CLI for the stable lane is required, but no bundled or seeded payload is available.',
        code: 'managed_cli_missing',
        reason: 'managed_cli_missing',
      };

      const blockedRequests = [
        ['GET', '/api/sdk/sessions'],
        ['POST', '/api/sdk/session', {}],
        ['POST', '/api/sdk/send', { sessionId: 'sdk-session-1', prompt: 'hello' }],
      ];

      for (const [method, requestPath, body] of blockedRequests) {
        const blocked = await invoke(routes, method, requestPath, body);
        assert.equal(blocked.res.statusCode, 503);
        assert.deepEqual(parseJsonBody(blocked.res), expectedBlockedPayload);
      }
    } finally {
      delete process.env.INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON;
      delete process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_REASON;
      delete process.env.INSTRUCTION_ENGINE_SDK_BRIDGE_DISABLED_MESSAGE;
    }
  });

  await test('GET /api/sdk/models parses the installed Copilot CLI model list', async () => {
    const executedCommands = [];
    const managedCliPath = 'C:/managed/copilot.exe';
    const env = {
      INSTRUCTION_ENGINE_COPILOT_CLI_STATE_JSON: JSON.stringify({
        approved: true,
        cliPath: managedCliPath,
        cliVersion: '0.0.420-0',
      }),
    };

    const routes = register({
      process: { env },
      childProcess: {
        execFile(command, args, options, callback) {
          executedCommands.push({ command, args, options });
          callback(
            null,
            `Configuration Settings:\n\n  \`model\`: AI model to use for Copilot CLI; can be changed with /model command or --model flag option.\n    - "claude-sonnet-4.6"\n    - "gpt-5.4"\n    - "gpt-5.3-codex"\n\n  \`mouse\`: whether to enable mouse support in alt screen mode; defaults to \`true\`.\n`,
            ''
          );
        },
      },
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const { res } = await invoke(routes, 'GET', '/api/sdk/models');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseJsonBody(res), {
      models: ['claude-sonnet-4.6', 'gpt-5.4', 'gpt-5.3-codex'],
    });
    assert.deepEqual(executedCommands, [
      {
        command: managedCliPath,
        args: ['help', 'config'],
        options: {
          timeout: 15000,
          windowsHide: true,
          env,
        },
      },
    ]);
  });

  const sdkBridge = createMockSdkBridge();
  const routes = register({
    sdkBridge,
    sendJson(res, code, payload) {
      const text = JSON.stringify(payload, null, 2);
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(text);
    },
    readJsonBody: async (req) => req.__body || {},
  });

  await test('GET /api/sdk/health returns bridge health', async () => {
    const { res } = await invoke(routes, 'GET', '/api/sdk/health');

    assert.equal(res.statusCode, 200);
    assert.deepEqual(parseJsonBody(res), {
      connected: true,
      state: 'connected',
    });
  });

  await test('GET /api/sdk/models returns 503 when the Copilot CLI command is unavailable', async () => {
    const routes = register({
      childProcess: {
        execFile(command, args, options, callback) {
          const error = new Error('spawn copilot ENOENT');
          error.code = 'ENOENT';
          callback(error, '', '');
        },
      },
      sendJson(res, code, payload) {
        const text = JSON.stringify(payload, null, 2);
        res.writeHead(code, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(text);
      },
      readJsonBody: async (req) => req.__body || {},
    });

    const { res } = await invoke(routes, 'GET', '/api/sdk/models');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(parseJsonBody(res), {
      error: 'spawn copilot ENOENT',
    });
  });

  await test('POST /api/sdk/session validates input and creates sessions', async () => {
    const invalid = await invoke(routes, 'POST', '/api/sdk/session', {
      model: '',
    });
    assert.equal(invalid.res.statusCode, 400);

    const created = await invoke(routes, 'POST', '/api/sdk/session', {
      sessionId: 'sdk-session-1',
      model: 'gpt-5.3-codex',
      orchestration: {
        objective: 'Ship backend contract',
        repo: {
          repoId: 'instruction-engine',
        },
      },
    });

    assert.equal(created.res.statusCode, 201);
    assert.deepEqual(parseJsonBody(created.res), {
      sessionId: 'sdk-session-1',
      model: 'gpt-5.3-codex',
      createdAt: '2026-03-01T00:00:00.000Z',
      orchestration: {
        objective: 'Ship backend contract',
        repo: {
          repoId: 'instruction-engine',
        },
      },
    });
  });

  await test('POST /api/sdk/session supports sandbox context with isolated cwd', async () => {
    const sandboxId = 'sb-sdk-route-1';
    const sandboxesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-sdk-route-'));
    const sandboxRoot = path.join(sandboxesHome, sandboxId);
    fs.mkdirSync(sandboxRoot, { recursive: true });

    try {
      let capturedPayload = null;
      const sandboxBridge = {
        ...createMockSdkBridge(),
        async createSdkSession(payload) {
          capturedPayload = payload;
          return {
            sessionId: 'sandbox-session-1',
            model: null,
            createdAt: '2026-03-01T00:00:00.000Z',
            contextType: payload.contextType,
            sandboxId: payload.sandboxId,
            cwd: payload.cwd,
          };
        },
      };

      const sandboxRoutes = register({
        sdkBridge: sandboxBridge,
        sendJson(res, code, payload) {
          const text = JSON.stringify(payload, null, 2);
          res.writeHead(code, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(text);
        },
        readJsonBody: async (req) => req.__body || {},
      });

      const created = await invoke(
        sandboxRoutes,
        'POST',
        '/api/sdk/session',
        {
          sandboxId,
        },
        {
          sandboxesHome,
        }
      );

      assert.equal(created.res.statusCode, 201);
      assert.equal(capturedPayload.contextType, 'sandbox');
      assert.equal(capturedPayload.sandboxId, sandboxId);
      assert.equal(path.resolve(capturedPayload.cwd), path.resolve(sandboxRoot));

      const missingSandbox = await invoke(
        sandboxRoutes,
        'POST',
        '/api/sdk/session',
        {
          sandboxId: 'sb-sdk-missing',
        },
        {
          sandboxesHome,
        }
      );
      assert.equal(missingSandbox.res.statusCode, 409);
    } finally {
      fs.rmSync(sandboxesHome, { recursive: true, force: true });
    }
  });

  await test('GET /api/sdk/sessions lists sessions', async () => {
    const { res } = await invoke(routes, 'GET', '/api/sdk/sessions');

    assert.equal(res.statusCode, 200);
    const body = parseJsonBody(res);
    assert.ok(Array.isArray(body.sessions));
    assert.equal(body.sessions.length, 1);
    assert.equal(body.sessions[0].sessionId, 'sdk-session-1');
    assert.equal(body.sessions[0].orchestration.objective, 'Ship backend contract');
  });

  await test('DELETE /api/sdk/session/:id returns 200 and 404 paths', async () => {
    const removed = await invoke(routes, 'DELETE', '/api/sdk/session/sdk-session-1');
    assert.equal(removed.res.statusCode, 200);
    assert.deepEqual(parseJsonBody(removed.res), {
      ok: true,
      sessionId: 'sdk-session-1',
    });

    const missing = await invoke(routes, 'DELETE', '/api/sdk/session/sdk-session-1');
    assert.equal(missing.res.statusCode, 404);
    assert.deepEqual(parseJsonBody(missing.res), {
      error: 'SDK session not found',
      sessionId: 'sdk-session-1',
    });
  });

  await test('POST /api/sdk/send enforces validation and returns 202 when accepted', async () => {
    await invoke(routes, 'POST', '/api/sdk/session', {
      sessionId: 'send-target',
    });

    const invalid = await invoke(routes, 'POST', '/api/sdk/send', {
      sessionId: 'send-target',
      prompt: '   ',
    });
    assert.equal(invalid.res.statusCode, 400);

    const missing = await invoke(routes, 'POST', '/api/sdk/send', {
      sessionId: 'missing',
      prompt: 'hello',
    });
    assert.equal(missing.res.statusCode, 404);

    const accepted = await invoke(routes, 'POST', '/api/sdk/send', {
      sessionId: 'send-target',
      prompt: 'hello from route test',
    });

    assert.equal(accepted.res.statusCode, 202);
    assert.deepEqual(parseJsonBody(accepted.res), {
      messageId: 'msg-send-target',
    });
  });

  await test('GET /api/sdk/stream/:id supports success, missing session, and 429 limit paths', async () => {
    await invoke(routes, 'POST', '/api/sdk/session', {
      sessionId: 'sse-target',
    });
    await invoke(routes, 'POST', '/api/sdk/session', {
      sessionId: 'sse-limit',
    });

    const ok = await invoke(routes, 'GET', '/api/sdk/stream/sse-target');
    assert.equal(ok.res.statusCode, 200);
    assert.match(ok.res.bodyText, /event: connected/);

    const missing = await invoke(routes, 'GET', '/api/sdk/stream/nope');
    assert.equal(missing.res.statusCode, 404);
    assert.deepEqual(parseJsonBody(missing.res), {
      error: 'SDK session not found',
      sessionId: 'nope',
    });

    const limited = await invoke(routes, 'GET', '/api/sdk/stream/sse-limit');
    assert.equal(limited.res.statusCode, 429);
    assert.deepEqual(parseJsonBody(limited.res), {
      error: 'SSE client limit reached (10)',
      sessionId: 'sse-limit',
    });
  });

  if (!process.exitCode) {
    console.log(`sdk route tests passed (${passed})`);
  }
}

run().catch((error) => {
  console.error('sdk route tests failed');
  console.error(error);
  process.exitCode = 1;
});
