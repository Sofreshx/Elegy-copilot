'use strict';

const assert = require('node:assert/strict');

const { register } = require('./uiRuntimeOverlay');

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
  return {
    __body: body,
    on() {
      return undefined;
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
  const sessions = [
    {
      id: 'overlay-1',
      status: 'attached',
      runtimeUrl: 'http://127.0.0.1:4173/',
      runtimeOrigin: 'http://127.0.0.1:4173',
      repoId: 'repo-1',
      repoPath: '/repo-1',
      repoLabel: 'Repo 1',
      packageRoot: '/repo-1',
      createdAt: '2026-03-28T10:00:00.000Z',
      updatedAt: '2026-03-28T10:00:00.000Z',
      closedAt: null,
      phase: 'attached',
      evidence: { source: 'copilot-ui', kind: 'runtime-url-registration' },
    },
  ];
  const calls = [];
  const uiRuntimeOverlayService = {
    listSessions() {
      calls.push('list');
      return sessions;
    },
    async createSession(payload) {
      calls.push(`create:${payload.runtimeUrl}`);
      if (payload.runtimeUrl === 'http://missing-repo.test') {
        throw Object.assign(new Error('A Catalog repo must be selected before attaching a runtime.'), { statusCode: 409 });
      }
      return {
        ...sessions[0],
        id: 'overlay-2',
        runtimeUrl: payload.runtimeUrl,
        runtimeOrigin: 'http://127.0.0.1:4173',
      };
    },
    async closeSession(sessionId) {
      calls.push(`close:${sessionId}`);
      if (sessionId === 'missing') {
        throw Object.assign(new Error('UI Runtime Overlay session not found'), { statusCode: 404 });
      }
      return {
        ...sessions[0],
        id: sessionId,
        status: 'closed',
        phase: 'closed',
        closedAt: '2026-03-28T10:05:00.000Z',
        updatedAt: '2026-03-28T10:05:00.000Z',
      };
    },
  };

  const routes = register({
    uiRuntimeOverlayService,
    sendJson(res, code, payload) {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    },
    readJsonBody: async (req) => req.__body || {},
  });

  await test('GET route returns overlay sessions', async () => {
    const response = await invoke(routes, 'GET', '/api/ui-runtime-overlay/sessions');
    assert.equal(response.res.statusCode, 200);
    assert.equal(response.res.body.sessions.length, 1);
    assert.equal(response.res.body.sessions[0].id, 'overlay-1');
  });

  await test('POST create route returns 201 on success and 409 when no repo is selected', async () => {
    const created = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions', {
      runtimeUrl: 'http://127.0.0.1:4173',
    });
    const failed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions', {
      runtimeUrl: 'http://missing-repo.test',
    });

    assert.equal(created.res.statusCode, 201);
    assert.equal(created.res.body.session.id, 'overlay-2');
    assert.equal(failed.res.statusCode, 409);
    assert.match(failed.res.body.error, /Catalog repo must be selected/i);
  });

  await test('POST close route returns 200 for existing sessions and 404 for missing sessions', async () => {
    const closed = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/overlay-1/close');
    const missing = await invoke(routes, 'POST', '/api/ui-runtime-overlay/sessions/missing/close');

    assert.equal(closed.res.statusCode, 200);
    assert.equal(closed.res.body.session.status, 'closed');
    assert.equal(missing.res.statusCode, 404);
    assert.match(missing.res.body.error, /not found/i);
  });

  assert.ok(calls.includes('list'));
  assert.ok(calls.includes('create:http://127.0.0.1:4173'));
  assert.ok(calls.includes('close:overlay-1'));

  console.log(`\n  ${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});