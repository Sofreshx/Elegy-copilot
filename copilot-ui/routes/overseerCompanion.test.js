'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register, OVERSEER_ORIGIN } = require('./overseerCompanion');

function response() { const state = { statusCode: null, body: null }; return { writeHead(code) { state.statusCode = code; }, end(text) { state.body = text ? JSON.parse(String(text)) : null; }, get statusCode() { return state.statusCode; }, get body() { return state.body; } }; }
function find(routes, method, path) { return routes.find((route) => route.method === method && (route.path === path || route.path instanceof RegExp && route.path.test(path))); }

test('companion proxy keeps context and chat routes fixed and server-authenticated', async () => {
  const calls = [];
  const routes = register({
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/session')) return { ok: true, status: 200, json: async () => ({ token: 'companion-secret' }) };
      return { ok: true, status: 201, json: async () => ({ format: 'overseer.chat-turn-result/v1', token: 'must-not-reach-browser', context: { path: 'C:/private' } }) };
    },
    readJsonBody: async () => ({ message: 'What changed?', topic: 'projects' }),
  });
  const route = find(routes, 'POST', '/api/overseer/chat/v1/conversations/companion%3Aone/turns');
  const res = response();
  await route.handler({ req: { method: 'POST', headers: {} }, res, pathname: '/api/overseer/chat/v1/conversations/companion%3Aone/turns', u: { pathname: '/api/overseer/chat/v1/conversations/companion%3Aone/turns', search: '' } });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.stringify(res.body).includes('must-not-reach-browser'), false);
  assert.equal(JSON.stringify(res.body).includes('C:/private'), false);
  assert.equal(calls.at(-1).url, `${OVERSEER_ORIGIN}/api/chat/v1/conversations/companion%3Aone/turns`);
  assert.equal(calls.at(-1).options.headers['x-overseer-session'], 'companion-secret');
});
