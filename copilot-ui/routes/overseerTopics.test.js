'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerTopics');

function createResponse() {
  const state = { statusCode: null, body: null };
  return { writeHead(code) { state.statusCode = code; }, end(text) { state.body = text ? JSON.parse(String(text)) : null; }, get statusCode() { return state.statusCode; }, get body() { return state.body; } };
}

function findRoute(routes, method, path) { return routes.find((route) => route.method === method && (route.path === path || route.path instanceof RegExp && route.path.test(path))); }

test('registers only fixed topic routes', () => {
  const routes = register({ fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/overseer/briefing/v1/summary',
    'GET /api/overseer/projects/v1/summary',
    'GET /^\\/api\\/overseer\\/projects\\/v1\\/([^/]+)$/',
    'GET /api/overseer/knowledge/v1/summary',
    'GET /api/overseer/tasks/v1/summary',
  ]);
});
test('keeps topic session token server-side and retries one stale token', async () => {
  const calls = [];
  let sessionCount = 0;
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === `${OVERSEER_ORIGIN}/api/session`) { sessionCount += 1; return { ok: true, status: 200, json: async () => ({ token: `topic-${sessionCount}` }) }; }
      if (sessionCount === 1) return { ok: false, status: 403, json: async () => ({ error: 'stale' }) };
      return { ok: true, status: 200, json: async () => ({ topic: 'briefing', projection: { kind: 'interpretation' }, session_token: 'do-not-cross' }) };
    },
  });
  const route = findRoute(routes, 'GET', '/api/overseer/briefing/v1/summary');
  const res = createResponse();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/briefing/v1/summary', u: { pathname: '/api/overseer/briefing/v1/summary', search: '' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.topic, 'briefing');
  assert.equal(JSON.stringify(res.body).includes('do-not-cross'), false);
  assert.equal(calls.filter((call) => call.url === `${OVERSEER_ORIGIN}/api/session`).length, 2);
  assert.equal(calls.at(-1).url, `${OVERSEER_ORIGIN}/api/briefing/v1/summary`);
});
