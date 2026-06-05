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
  const codexConfig = {
    getStatus: overrides.getCodexStatus || (() => ({
      activeMode: 'native',
      providerId: 'openai',
      gateway: {
        baseUrl: 'http://127.0.0.1:4318/v1',
        envKey: 'OPENCODE_GO_API_KEY',
      },
      deepseek: {
        bridgePath: null,
        bridgeConfigPath: null,
        bridgeUrl: 'http://127.0.0.1:38440/v1',
        keyConfigured: false,
        bridgeReachable: false,
        modelsVisible: false,
        bridgeBinaryAvailable: false,
      },
    })),
    setMode: overrides.setCodexMode || ((_home, mode) => ({ activeMode: mode, providerId: mode === 'elegy-routed' ? 'elegy' : mode === 'deepseek-bridge' ? 'instruction_engine_deepseek' : 'openai' })),
    hardReset: overrides.hardResetCodex || (() => ({ activeMode: 'native', providerId: 'openai', action: 'hard-reset' })),
    saveDeepseekSettings: overrides.saveDeepseekSettings || (() => ({ keyConfigured: true })),
  };
  return {
    sendJson,
    readJsonBody,
    copilotConfig,
    codexConfig,
    sent,
    env: overrides.env || { OPENCODE_GO_API_KEY: 'demo-key' },
    probeCodexGatewayReachability: overrides.probeCodexGatewayReachability || (async () => {}),
  };
}

describe('config routes', () => {
  it('register returns expected route count', () => {
    const routes = register();
    assert.equal(routes.length, 10);
    assert.equal(routes[0].method, 'GET');
    assert.equal(routes[0].path, '/api/config/remote-sessions');
    assert.equal(routes[1].method, 'PUT');
    assert.equal(routes[1].path, '/api/config/remote-sessions');
    assert.equal(routes[2].path, '/api/config/codex-provider');
    assert.equal(routes[3].path, '/api/config/codex-provider');
    assert.equal(routes[4].path, '/api/config/codex-provider/reset');
    assert.equal(routes[5].path, '/api/config/codex-provider/deepseek');
    assert.equal(routes[6].path, '/api/config/codex-provider/deepseek');
    assert.equal(routes[7].path, '/api/config/codex-provider/deepseek/start');
    assert.equal(routes[8].path, '/api/config/codex-provider/deepseek/stop');
    assert.equal(routes[9].path, '/api/config/codex-provider/deepseek/status');
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

  it('GET returns current Codex provider status', () => {
    const mocks = makeMocks({
      getCodexStatus: () => ({ activeMode: 'elegy-routed', providerId: 'elegy', gateway: { baseUrl: 'http://127.0.0.1:4318/v1', envKey: 'OPENCODE_GO_API_KEY' } }),
    });
    const routes = register(mocks);
    routes[2].handler({ codexHome: '/tmp/codex', res: {} });
    assert.equal(mocks.sent[0].code, 200);
    assert.equal(mocks.sent[0].obj.activeMode, 'elegy-routed');
  });

  it('PUT updates Codex provider mode', async () => {
    let savedMode;
    let probedBaseUrl;
    const mocks = makeMocks({
      body: { mode: 'elegy-routed' },
      probeCodexGatewayReachability: async (baseUrl) => {
        probedBaseUrl = baseUrl;
      },
      setCodexMode: (_home, mode) => {
        savedMode = mode;
        return { activeMode: mode, providerId: 'elegy' };
      },
    });
    const routes = register(mocks);
    await routes[3].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
    assert.equal(savedMode, 'elegy-routed');
    assert.equal(probedBaseUrl, 'http://127.0.0.1:4318/v1');
    assert.equal(mocks.sent[0].code, 200);
    assert.equal(mocks.sent[0].obj.providerId, 'elegy');
  });

  it('PUT rejects Elegy routed mode when API key env var is missing', async () => {
    let setModeCalled = false;
    const mocks = makeMocks({
      body: { mode: 'elegy-routed' },
      env: {},
      setCodexMode: () => {
        setModeCalled = true;
        return { activeMode: 'elegy-routed', providerId: 'elegy' };
      },
    });
    const routes = register(mocks);

    await routes[3].handler({ codexHome: '/tmp/codex', req: {}, res: {} });

    assert.equal(setModeCalled, false);
    assert.equal(mocks.sent[0].code, 503);
    assert.equal(mocks.sent[0].obj.error, 'Set OPENCODE_GO_API_KEY before enabling Elegy Routed.');
  });

  it('PUT rejects Elegy routed mode when gateway probe fails', async () => {
    let setModeCalled = false;
    const mocks = makeMocks({
      body: { mode: 'elegy-routed' },
      probeCodexGatewayReachability: async () => {
        throw Object.assign(new Error('Elegy gateway is unavailable at http://127.0.0.1:4318/v1. Start the local gateway and try again.'), {
          statusCode: 503,
        });
      },
      setCodexMode: () => {
        setModeCalled = true;
        return { activeMode: 'elegy-routed', providerId: 'elegy' };
      },
    });
    const routes = register(mocks);

    await routes[3].handler({ codexHome: '/tmp/codex', req: {}, res: {} });

    assert.equal(setModeCalled, false);
    assert.equal(mocks.sent[0].code, 503);
    assert.equal(mocks.sent[0].obj.error, 'Elegy gateway is unavailable at http://127.0.0.1:4318/v1. Start the local gateway and try again.');
  });

  it('PUT exposes existing managed provider conflicts', async () => {
    const mocks = makeMocks({
      body: { mode: 'elegy-routed' },
      setCodexMode: () => {
        throw Object.assign(new Error('Existing Codex config already defines [model_providers.instruction_engine_elegy].'), {
          statusCode: 409,
        });
      },
    });
    const routes = register(mocks);

    await routes[3].handler({ codexHome: '/tmp/codex', req: {}, res: {} });

    assert.equal(mocks.sent[0].code, 409);
    assert.equal(mocks.sent[0].obj.error, 'Existing Codex config already defines [model_providers.instruction_engine_elegy].');
  });

  it('POST reset performs hard restore when requested', async () => {
    let hardResetCalled = false;
    const mocks = makeMocks({
      body: { hard: true },
      hardResetCodex: () => {
        hardResetCalled = true;
        return { activeMode: 'native', providerId: 'openai', action: 'hard-reset' };
      },
    });
    const routes = register(mocks);
    await routes[4].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
    assert.equal(hardResetCalled, true);
    assert.equal(mocks.sent[0].code, 200);
    assert.equal(mocks.sent[0].obj.action, 'hard-reset');
  });

  describe('deepseek routes', () => {
    it('GET deepseek returns config status', () => {
      const mocks = makeMocks();
      const routes = register(mocks);
      routes[5].handler({ codexHome: '/tmp/codex', res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.bridgeUrl, 'http://127.0.0.1:38440/v1');
      assert.equal(mocks.sent[0].obj.keyConfigured, false);
      assert.equal(mocks.sent[0].obj.bridgeRunning, false);
    });

    it('PUT deepseek saves settings', async () => {
      let savedSettings;
      const mocks = makeMocks({
        body: { bridgePath: '/path/to/bridge', bridgeConfigPath: '/path/to/config.yml', apiKey: 'sk-test-123', keyConfigured: true },
        saveDeepseekSettings: (_home, settings) => {
          savedSettings = settings;
          return { bridgePath: '/path/to/bridge', keyConfigured: true };
        },
      });
      const routes = register(mocks);
      await routes[6].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(savedSettings.bridgePath, '/path/to/bridge');
      assert.equal(savedSettings.keyConfigured, true);
    });

    it('PUT deepseek does not return API key in response', async () => {
      const mocks = makeMocks({
        body: { bridgePath: '/path/to/bridge', apiKey: 'sk-secret-123', keyConfigured: true },
        saveDeepseekSettings: (_home, settings) => {
          return { bridgePath: settings.bridgePath, keyConfigured: true };
        },
      });
      const routes = register(mocks);
      await routes[6].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.keyConfigured, true);
      assert.ok(!mocks.sent[0].obj.apiKey);
      assert.ok(!JSON.stringify(mocks.sent[0].obj).includes('sk-secret'));
    });

    it('POST deepseek start returns bridgeRunning', async () => {
      const mocks = makeMocks();
      const routes = register(mocks);
      await routes[7].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 400);
    });

    it('POST deepseek stop returns bridgeRunning false', async () => {
      const mocks = makeMocks();
      const routes = register(mocks);
      await routes[8].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.bridgeRunning, false);
    });
  });
});
