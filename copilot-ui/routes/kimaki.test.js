'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./kimaki');

test('registers the supported Remote API without legacy destructive routes', () => {
  const routes = register({});
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.path}`),
    [
      'GET /api/remote/status',
      'POST /api/remote/restart',
      'GET /api/remote/projects',
      'GET /api/remote/sessions',
      'POST /api/remote/send',
      'POST /api/remote/projects/add',
      'GET /api/remote/logs',
    ],
  );
});

function createContext(overrides = {}) {
  const responses = [];
  return {
    responses,
    context: {
      sendJson: (_res, status, body) => responses.push({ status, body }),
      ...overrides,
    },
  };
}

test('status explains when the Kimaki runtime is unavailable', () => {
  const { context, responses } = createContext();
  const route = register(context).find((candidate) => candidate.path === '/api/remote/status');
  route.handler({ res: {} });

  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.available, false);
  assert.equal(responses[0].body.reason, 'kimaki_entrypoint_missing');
});

test('operational routes return a stable onboarding conflict before Discord is ready', async () => {
  const service = {
    getReady: () => false,
  };
  const { context, responses } = createContext({
    kimakiRuntimeService: service,
    kimakiCli: {},
    sqliteReader: {},
  });
  const route = register(context).find((candidate) => candidate.path === '/api/remote/projects');
  await route.handler({ res: {} });

  assert.equal(responses[0].status, 409);
  assert.deepEqual(responses[0].body, {
    error: 'remote_not_ready',
    code: 'remote_not_ready',
    message: 'Complete Discord setup before using remote sessions.',
  });
});

test('logs remain readable as an empty collection when the runtime is unavailable', () => {
  const { context, responses } = createContext();
  const route = register(context).find((candidate) => candidate.path === '/api/remote/logs');
  route.handler({ res: {}, u: new URL('http://localhost/api/remote/logs') });

  assert.deepEqual(responses[0], { status: 200, body: { lines: [] } });
});
