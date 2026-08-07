'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerWork');

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

test('registers only the allowlisted native Work proxy routes', () => {
  const routes = register({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ token: 'x' }) }) });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/overseer/work/v1/items',
    'GET /^\\/api\\/overseer\\/work\\/v1\\/items\\/([^/]+)$/',
    'POST /api/overseer/work/v1/items',
    'POST /^\\/api\\/overseer\\/work\\/v1\\/items\\/([^/]+)\\/(cancel|retry|answer|review|preview|confirm)$/',
    'POST /api/overseer/work/v1/intake-file',
  ]);
});

test('holds the session token server-side and retries one stale session after a 403', async () => {
  const calls = [];
  let sessionCount = 0;
  const fetch = async (url, options) => {
    calls.push({ url, headers: options?.headers });
    if (url === `${OVERSEER_ORIGIN}/api/session`) {
      sessionCount += 1;
      return { ok: true, status: 200, json: async () => ({ token: `secret-${sessionCount}` }) };
    }
    if (sessionCount === 1) return { ok: false, status: 403, json: async () => ({ error: 'Session token required' }) };
    return { ok: true, status: 200, json: async () => ({ items: [{ title: 'Safe work' }], token: 'should-not-cross' }) };
  };
  const routes = register({ fetch });
  const route = findRoute(routes, 'GET', '/api/overseer/work/v1/items');
  const res = createResponse();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/work/v1/items', u: { pathname: '/api/overseer/work/v1/items', search: '' } });

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.items, [{ title: 'Safe work' }]);
  assert.equal(JSON.stringify(res.body).includes('secret-'), false);
  assert.equal(calls.filter((call) => call.url === `${OVERSEER_ORIGIN}/api/session`).length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith('/api/work/v1/items')).every((call) => call.headers['x-overseer-session']), true);
});

test('proxies JSON mutations without exposing the browser to session credentials', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/session')) return { ok: true, status: 200, json: async () => ({ token: 'server-only' }) };
      return { ok: true, status: 201, json: async () => ({ item: { title: 'Created' } }) };
    },
    readJsonBody: async () => ({ kind: 'task', title: 'Create a task' }),
  });
  const route = findRoute(routes, 'POST', '/api/overseer/work/v1/items');
  const res = createResponse();
  await route.handler({ req: { method: 'POST', headers: {} }, res, pathname: '/api/overseer/work/v1/items', u: { pathname: '/api/overseer/work/v1/items', search: '' } });

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.item, { title: 'Created' });
  assert.equal(calls[1].url, `${OVERSEER_ORIGIN}/api/work/v1/items`);
  assert.equal(calls[1].options.headers['x-overseer-session'], 'server-only');
  assert.equal(calls[1].options.body, JSON.stringify({ kind: 'task', title: 'Create a task' }));
});

test('returns structured recovery state when Overseer is unavailable', async () => {
  const routes = register({ fetch: async () => { throw new Error('connection refused'); } });
  const route = findRoute(routes, 'GET', '/api/overseer/work/v1/items');
  const res = createResponse();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/work/v1/items', u: { pathname: '/api/overseer/work/v1/items', search: '' } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'overseer_unavailable');
  assert.equal(JSON.stringify(res.body).includes('connection refused'), false);
});
