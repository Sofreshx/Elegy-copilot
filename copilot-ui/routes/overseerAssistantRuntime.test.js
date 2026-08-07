'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerAssistantRuntime');

function response() { const state = { statusCode: null, body: null }; return { writeHead(code) { state.statusCode = code; }, end(text) { state.body = text ? JSON.parse(String(text)) : null; }, get statusCode() { return state.statusCode; }, get body() { return state.body; } }; }
function find(routes, method, path) { return routes.find((route) => route.method === method && (route.path === path || route.path instanceof RegExp && route.path.test(path))); }

test('allowlists Runs and Assistants routes without exposing session credentials', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => { calls.push({ url, options }); if (url.endsWith('/api/session')) return { ok: true, status: 200, json: async () => ({ token: 'assistant-secret' }) }; return { ok: true, status: 200, json: async () => ({ format: 'overseer.runs/v1', token: 'redact-me' }) }; },
    readJsonBody: async () => ({ confirmation: 'update-assistant-settings', settings: { primaryModel: 'opencode-go/deepseek-v4-flash' } }),
  });
  const route = find(routes, 'GET', '/api/overseer/runs/v1/items');
  const res = response();
  await route.handler({ req: { method: 'GET', headers: {} }, res, pathname: '/api/overseer/runs/v1/items', u: { pathname: '/api/overseer/runs/v1/items', search: '?bucket=active' } });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.stringify(res.body).includes('redact-me'), false);
  assert.equal(calls.at(-1).url, `${OVERSEER_ORIGIN}/api/runs/v1/items?bucket=active`);
  assert.equal(calls.at(-1).options.headers['x-overseer-session'], 'assistant-secret');
  assert.ok(find(routes, 'GET', '/api/overseer/assistants/v1/models'));
});
