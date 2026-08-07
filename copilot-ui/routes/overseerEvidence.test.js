'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerEvidence');

function createResponse() {
  const state = { statusCode: null, body: null };
  return {
    writeHead(statusCode) { state.statusCode = statusCode; },
    end(text) { state.body = text ? JSON.parse(String(text)) : null; },
    get statusCode() { return state.statusCode; },
    get body() { return state.body; },
  };
}

test('registers only the fixed Evidence summary route', () => {
  const routes = register({ fetch: async () => ({ ok: true, status: 200, json: async () => ({ token: 'x' }) }) });
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), ['GET /api/overseer/evidence/v1/summary']);
});
test('keeps Evidence session credentials server-side and forwards only the query string', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url === `${OVERSEER_ORIGIN}/api/session`) return { ok: true, status: 200, json: async () => ({ token: 'evidence-secret' }) };
      return { ok: true, status: 200, json: async () => ({ format: 'overseer.evidence/v1', query: 'ReplyGuard', session_token: 'should-not-cross' }) };
    },
  });
  const route = routes[0];
  const res = createResponse();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/evidence/v1/summary', u: { pathname: '/api/overseer/evidence/v1/summary', search: '?q=ReplyGuard&mode=lexical' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.query, 'ReplyGuard');
  assert.equal(JSON.stringify(res.body).includes('evidence-secret'), false);
  assert.equal(calls[1].url, `${OVERSEER_ORIGIN}/api/evidence/v1/summary?q=ReplyGuard&mode=lexical`);
  assert.equal(calls[1].options.headers['x-overseer-session'], 'evidence-secret');
});
