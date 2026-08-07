'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerSystem');

function createResponse() {
  const state = { statusCode: null, body: null };
  return {
    writeHead(statusCode) { state.statusCode = statusCode; },
    end(text) { state.body = text ? JSON.parse(String(text)) : null; },
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
  };
}

test('registers only the fixed System summary route', () => {
  const routes = register({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ token: 'x' }) }) });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), ['GET /api/overseer/system/v1/summary']);
});

test('keeps System session credentials server-side and redacts technical response fields', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === `${OVERSEER_ORIGIN}/api/session`) return { ok: true, status: 200, json: async () => ({ token: 'system-secret' }) };
      return { ok: true, status: 200, json: async () => ({ format: 'overseer.system/v1', session_token: 'should-not-cross', overview: { status: 'ready' } }) };
    },
  });
  const res = createResponse();
  await routes[0].handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/system/v1/summary', u: { pathname: '/api/overseer/system/v1/summary', search: '' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.overview.status, 'ready');
  assert.equal(JSON.stringify(res.body).includes('system-secret'), false);
  assert.equal(calls[1].url, `${OVERSEER_ORIGIN}/api/system/v1/summary`);
  assert.equal(calls[1].options.headers['x-overseer-session'], 'system-secret');
});
