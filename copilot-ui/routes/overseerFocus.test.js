'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerFocus');

function createResponse() {
  const state = { statusCode: null, body: null };
  return {
    writeHead(statusCode) { state.statusCode = statusCode; },
    end(text) { state.body = text ? JSON.parse(String(text)) : null; },
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
  };
}

function findRoute(routes, method, path) {
  return routes.find((route) => route.method === method && (route.path === path || route.path instanceof RegExp && route.path.test(path)));
}

test('registers only the versioned Focus read routes', () => {
  const routes = register({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ token: 'x' }) }) });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/overseer/focus/v1/summary',
    'GET /^\\/api\\/overseer\\/focus\\/v1\\/ideas\\/([^/]+)$/',
  ]);
});

test('keeps Focus session credentials server-side and redacts token-shaped fields', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === `${OVERSEER_ORIGIN}/api/session`) return { ok: true, status: 200, json: async () => ({ token: 'focus-secret' }) };
      return { ok: true, status: 200, json: async () => ({ format: 'overseer.focus/v1', recommendation: { title: 'Safe' }, session_token: 'should-not-cross' }) };
    },
  });
  const route = findRoute(routes, 'GET', '/api/overseer/focus/v1/summary');
  const res = createResponse();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/focus/v1/summary', u: { pathname: '/api/overseer/focus/v1/summary', search: '' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.recommendation.title, 'Safe');
  assert.equal(JSON.stringify(res.body).includes('focus-secret'), false);
  assert.equal(calls[1].url, `${OVERSEER_ORIGIN}/api/focus/v1/summary`);
  assert.equal(calls[1].options.headers['x-overseer-session'], 'focus-secret');
});
