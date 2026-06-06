'use strict';

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const configModule = require('./config');
const { register } = configModule;

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
    getBootstrapState: overrides.getBootstrapState || (() => null),
    saveBootstrapState: overrides.saveBootstrapState || (() => null),
  };
  const moonBridgeBootstrap = {
    getBootstrapStatus: overrides.getBootstrapStatus || (() => ({
      installRoot: '/managed-cli/moon-bridge',
      sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
      binaryPath: '/managed-cli/moon-bridge/bin/moon-bridge.exe',
      configPath: '/managed-cli/moon-bridge/config.yml',
      gitAvailable: true,
      goAvailable: true,
      installed: false,
      built: false,
      lastBootstrapAt: null,
      lastError: null,
    })),
    bootstrapMoonBridge: overrides.bootstrapMoonBridge || (() => ({
      success: true,
      status: { installed: true, built: true, gitAvailable: true, goAvailable: true },
      error: null,
    })),
    resolveManagedMoonBridgeRoot: overrides.resolveManagedMoonBridgeRoot || ((copilotHome) => '/managed-cli/moon-bridge'),
    resolveBinaryPath: overrides.resolveBinaryPath || ((root) => '/managed-cli/moon-bridge/bin/moon-bridge.exe'),
    resolveConfigPath: overrides.resolveConfigPath || ((root) => '/managed-cli/moon-bridge/config.yaml'),
  };
  return {
    sendJson,
    readJsonBody,
    copilotConfig,
    codexConfig,
    moonBridgeBootstrap,
    sent,
    env: overrides.env || {},
  };
}

describe('config routes', () => {
  it('register returns expected route count', () => {
    const routes = register();
    assert.equal(routes.length, 12);
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
    assert.equal(routes[10].path, '/api/config/codex-provider/deepseek/bootstrap');
    assert.equal(routes[11].path, '/api/config/codex-provider/deepseek/bootstrap');
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

  it('PUT activates deepseek-bridge mode', async () => {
    let savedMode;
    const mocks = makeMocks({
      body: { mode: 'deepseek-bridge' },
      getCodexStatus: () => ({
        activeMode: 'native',
        providerId: 'openai',
        gateway: { baseUrl: '', model: '' },
        deepseek: {
          bridgePath: '/path/to/bridge.exe',
          keyConfigured: true,
          bridgeBinaryAvailable: true,
          bridgeReachable: true,
          bridgeUrl: 'http://127.0.0.1:38440/v1',
        },
      }),
      setCodexMode: (_home, mode) => {
        savedMode = mode;
        return { activeMode: mode, providerId: 'instruction_engine_deepseek' };
      },
    });

    // Satisfy assertCodexProviderActivationPreflight checks
    mock.method(fs, 'existsSync', () => true);
    configModule._testBridgeProcess = { exitCode: null, signalCode: null, on: () => {}, once: () => {} };
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-v4-flash' }] }),
    }));

    try {
      const routes = register(mocks);
      await routes[3].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(savedMode, 'deepseek-bridge');
      assert.equal(mocks.sent[0].code, 200);
    } finally {
      configModule._testBridgeProcess = null;
    }
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

    it('GET bootstrap returns computed status with prerequisite checks', () => {
      const mocks = makeMocks({
        getBootstrapState: () => ({ lastBootstrapAt: '2025-01-01T00:00:00.000Z' }),
        getBootstrapStatus: () => ({
          installRoot: '/.copilot/managed-cli/moon-bridge',
          sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
          binaryPath: '/.copilot/managed-cli/moon-bridge/bin/moon-bridge.exe',
          configPath: '/.copilot/managed-cli/moon-bridge/config.yml',
          gitAvailable: true,
          goAvailable: false,
          installed: false,
          built: false,
          lastBootstrapAt: null,
          lastError: null,
        }),
      });
      const routes = register(mocks);
      routes[10].handler({ codexHome: '/tmp/codex', res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.gitAvailable, true);
      assert.equal(mocks.sent[0].obj.goAvailable, false);
      assert.equal(mocks.sent[0].obj.installed, false);
    });

    it('POST bootstrap performs install and returns success', async () => {
      let savedState;
      const mocks = makeMocks({
        readJsonBody: async () => ({}),
        saveBootstrapState: (_home, state) => { savedState = state; },
        bootstrapMoonBridge: () => ({
          success: true,
          status: {
            installRoot: '/root',
            sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
            binaryPath: '/root/bin/moon-bridge.exe',
            configPath: '/root/config.yml',
            gitAvailable: true,
            goAvailable: true,
            installed: true,
            built: true,
            lastBootstrapAt: '2025-06-05T00:00:00.000Z',
            lastError: null,
          },
        }),
      });
      const routes = register(mocks);
      await routes[11].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.success, true);
      assert.equal(mocks.sent[0].obj.status.installed, true);
      assert.equal(mocks.sent[0].obj.status.built, true);
      assert.ok(savedState, 'expected saveBootstrapState to be called');
    });

    it('POST bootstrap returns success=false when prerequisites missing', async () => {
      let savedState;
      const mocks = makeMocks({
        readJsonBody: async () => ({}),
        saveBootstrapState: (_home, state) => { savedState = state; },
        bootstrapMoonBridge: () => ({
          success: false,
          status: {
            installRoot: '/root',
            sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
            gitAvailable: false,
            goAvailable: true,
            installed: false,
            built: false,
            lastBootstrapAt: null,
            lastError: 'git is not available on this system.',
          },
          error: 'git is not available on this system.',
        }),
      });
      const routes = register(mocks);
      await routes[11].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.success, false);
      assert.ok(mocks.sent[0].obj.error.includes('git is not available'));
      assert.ok(savedState, 'expected saveBootstrapState to be called even on failure');
    });

    it('POST bootstrap persists bridgeConfigPath on success', async () => {
      let savedDeepseekSettings;
      let savedBootstrapState;
      const mocks = makeMocks({
        readJsonBody: async () => ({}),
        saveDeepseekSettings: (_home, settings) => {
          savedDeepseekSettings = settings;
          return { bridgeConfigPath: settings.bridgeConfigPath };
        },
        saveBootstrapState: (_home, state) => { savedBootstrapState = state; },
        bootstrapMoonBridge: () => ({
          success: true,
          status: {
            installRoot: '/root',
            sourceUrl: 'https://github.com/ZhiYi-R/moon-bridge.git',
            binaryPath: '/root/bin/moon-bridge.exe',
            configPath: '/root/config.yaml',
            gitAvailable: true,
            goAvailable: true,
            installed: true,
            built: true,
            lastBootstrapAt: '2025-06-05T00:00:00.000Z',
            lastError: null,
          },
        }),
      });
      const routes = register(mocks);
      await routes[11].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      assert.equal(mocks.sent[0].obj.success, true);
      assert.ok(savedBootstrapState, 'expected saveBootstrapState to be called');
      assert.ok(savedDeepseekSettings, 'expected saveDeepseekSettings to be called');
      assert.equal(savedDeepseekSettings.bridgeConfigPath, '/root/config.yaml');
    });

    it('POST check status preserves probeError on failure', async () => {
      let probeCallCount = 0;
      const mocks = makeMocks({
        getCodexStatus: () => ({
          activeMode: 'deepseek-bridge',
          deepseek: {
            bridgePath: '/path/to/bridge',
            bridgeUrl: 'http://127.0.0.1:38440/v1',
            keyConfigured: true,
          },
        }),
        probeCodexGatewayReachability: async () => {
          probeCallCount += 1;
        },
      });
      const routes = register(mocks);
      // The check-status handler calls probeDeepseekBridgeReachability, 
      // which will naturally fail since there's no real server.
      // We just need to verify it doesn't crash and probeError is set.
      await routes[9].handler({ codexHome: '/tmp/codex', req: {}, res: {} });
      assert.equal(mocks.sent[0].code, 200);
      // probeError should be a string (error message) not null
      assert.ok(typeof mocks.sent[0].obj.probeError === 'string', 'probeError should be a string error message, got: ' + JSON.stringify(mocks.sent[0].obj.probeError));
      assert.ok(mocks.sent[0].obj.probeError.length > 0, 'probeError should not be empty');
      assert.equal(mocks.sent[0].obj.bridgeReachable, false);
    });
  });
});
