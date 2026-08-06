'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { register } = require('./intelligenceSurfaces');

function routeFor(routes, method, path) {
  return routes.find((route) => route.method === method && String(route.path) === path);
}

test('registers the intelligence surface API', () => {
  const routes = register({});
  assert.deepEqual(routes.map((route) => `${route.method} ${route.path}`), [
    'GET /api/intelligence-surfaces',
    'GET /^\\/api\\/intelligence-surfaces\\/([^/]+)$/',
    'POST /^\\/api\\/intelligence-surfaces\\/([^/]+)\\/(start|stop)$/',
  ]);
});

test('lists surface descriptors without leaking repository paths', () => {
  const responses = [];
  const routes = register({
    sendJson: (_res, status, body) => responses.push({ status, body }),
    serviceHost: {
      listStatuses: async () => [{ id: 'overseer', status: 'stopped', consoleUrl: 'http://127.0.0.1:4173/dashboard/?embed=elegy' }],
    },
  });
  routeFor(routes, 'GET', '/api/intelligence-surfaces').handler({ res: {} });
  return new Promise((resolve) => setImmediate(() => {
    assert.equal(responses[0].status, 200);
    assert.equal(responses[0].body.schema, 'elegy.intelligence-surfaces.v1');
    assert.equal('repositoryPath' in responses[0].body.services[0], false);
    resolve();
  }));
});

test('requires explicit confirmation before starting or stopping a service', async () => {
  const responses = [];
  const routes = register({
    sendJson: (_res, status, body) => responses.push({ status, body }),
    readJsonBody: async () => ({}),
    serviceHost: { start: async () => ({ status: 'ready' }), stop: async () => ({ status: 'stopped' }) },
  });
  const route = routes.find((candidate) => candidate.method === 'POST');
  await route.handler({ res: {}, match: [null, 'overseer', 'start'] });
  assert.equal(responses[0].status, 400);
  assert.equal(responses[0].body.code, 'confirmation_required');
});

test('passes only the fixed confirmation to the service host', async () => {
  const responses = [];
  const calls = [];
  const routes = register({
    sendJson: (_res, status, body) => responses.push({ status, body }),
    readJsonBody: async () => ({ confirmation: 'start:overseer', observedAt: 'fresh' }),
    serviceHost: { assertFreshConfirmation: () => true, start: async (id) => { calls.push(id); return { id, status: 'ready' }; } },
  });
  const route = routes.find((candidate) => candidate.method === 'POST');
  await route.handler({ res: {}, match: [null, 'overseer', 'start'] });
  assert.deepEqual(calls, ['overseer']);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.status, 'ready');
});

test('rejects a stale status confirmation before invoking the operator', async () => {
  const responses = [];
  const routes = register({
    sendJson: (_res, status, body) => responses.push({ status, body }),
    readJsonBody: async () => ({ confirmation: 'start:overseer', observedAt: 'stale' }),
    serviceHost: {
      assertFreshConfirmation: () => { const error = new Error('confirmation_stale'); error.code = 'confirmation_stale'; throw error; },
      start: async () => ({ status: 'ready' }),
    },
  });
  const route = routes.find((candidate) => candidate.method === 'POST');
  await route.handler({ res: {}, match: [null, 'overseer', 'start'] });
  assert.equal(responses[0].status, 409);
  assert.equal(responses[0].body.code, 'confirmation_stale');
});
