'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { register } = require('./config');

function makeMocks(overrides = {}) {
  const sent = [];
  const sendJson = (res, code, obj) => sent.push({ code, obj });
  const readJsonBody = async () => overrides.body || {};
  const copilotConfig = {
    getRemoteSessions: overrides.getRemoteSessions || (() => false),
    setRemoteSessions: overrides.setRemoteSessions || (() => {}),
  };
  return { sendJson, readJsonBody, copilotConfig, sent };
}

describe('config routes', () => {
  it('register returns GET and PUT routes', () => {
    const routes = register();
    assert.equal(routes.length, 2);
    assert.equal(routes[0].method, 'GET');
    assert.equal(routes[0].path, '/api/config/remote-sessions');
    assert.equal(routes[1].method, 'PUT');
    assert.equal(routes[1].path, '/api/config/remote-sessions');
  });

  it('GET returns current remote preference', () => {
    const mocks = makeMocks({ getRemoteSessions: () => true });
    const routes = register(mocks);
    routes[0].handler({ copilotHome: '/tmp/test', res: {} });
    assert.equal(mocks.sent[0].code, 200);
    assert.deepEqual(mocks.sent[0].obj, { enabled: true });
  });

  it('PUT sets remote preference', async () => {
    let savedValue;
    const mocks = makeMocks({
      body: { enabled: true },
      setRemoteSessions: (_home, val) => { savedValue = val; },
    });
    const routes = register(mocks);
    await routes[1].handler({ copilotHome: '/tmp/test', req: {}, res: {} });
    assert.equal(savedValue, true);
    assert.equal(mocks.sent[0].code, 200);
    assert.deepEqual(mocks.sent[0].obj, { enabled: true });
  });

  it('PUT rejects non-boolean enabled', async () => {
    const mocks = makeMocks({ body: { enabled: 'yes' } });
    const routes = register(mocks);
    await routes[1].handler({ copilotHome: '/tmp/test', req: {}, res: {} });
    assert.equal(mocks.sent[0].code, 400);
  });

  it('PUT triggers base client restart when available', async () => {
    let restarted = false;
    const mocks = makeMocks({ body: { enabled: true } });
    const routes = register(mocks);
    await routes[1].handler({
      copilotHome: '/tmp/test',
      req: {},
      res: {},
      sdkBridge: { restartBaseClient: async () => { restarted = true; } },
    });
    assert.equal(restarted, true);
    assert.equal(mocks.sent[0].code, 200);
  });

  it('PUT returns warning when client restart fails', async () => {
    const mocks = makeMocks({ body: { enabled: false } });
    const routes = register(mocks);
    await routes[1].handler({
      copilotHome: '/tmp/test',
      req: {},
      res: {},
      sdkBridge: { restartBaseClient: async () => { throw new Error('oops'); } },
    });
    assert.equal(mocks.sent[0].code, 200);
    assert.equal(mocks.sent[0].obj.enabled, false);
    assert.ok(mocks.sent[0].obj.warning.includes('oops'));
  });
});
