import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { register } = await vi.importActual<{ register: Function }>('../routes/opencode');
const { createOpenCodeGoWorkspaces } = await vi.importActual<typeof import('../lib/opencodeGoWorkspaces')>(
  '../lib/opencodeGoWorkspaces',
);

interface MockOpenCodeConfig {
  resolveOpenCodeHome: (h: string) => string;
  resolveConfigPath: (h: string) => string;
  readConfig: () => unknown;
  writeConfig: ReturnType<typeof vi.fn>;
  getStatus: () => unknown;
  setAgentModels: ReturnType<typeof vi.fn>;
  resetConfig: ReturnType<typeof vi.fn>;
  getActiveProfileRoute: ReturnType<typeof vi.fn>;
  setActiveProfileRoute: ReturnType<typeof vi.fn>;
  removeActiveProfileRoute: ReturnType<typeof vi.fn>;
  updateStateProfileRoute: ReturnType<typeof vi.fn>;
}

function makeOpenCodeConfigStub(home: string): MockOpenCodeConfig {
  return {
    resolveOpenCodeHome: (h: string) => h || home,
    resolveConfigPath: (h: string) => `${h}/opencode.jsonc`,
    readConfig: () => ({}),
    writeConfig: vi.fn(),
    getStatus: () => ({
      opencodeHome: home,
      configPath: `${home}/opencode.jsonc`,
      exploreModel: 'DeepSeek V4 Flash Max',
      scoutModel: 'DeepSeek V4 Pro Max',
      isCustom: false,
      availableModels: [],
      lastAppliedAt: null,
    }),
    setAgentModels: vi.fn(),
    resetConfig: vi.fn(),
    getActiveProfileRoute: vi.fn(() => 'opencode-go'),
    setActiveProfileRoute: vi.fn(),
    removeActiveProfileRoute: vi.fn(),
    updateStateProfileRoute: vi.fn(),
  };
}

function makeAssetsStub() {
  return {
    getManagedAssetStatuses: () => [],
    syncAll: vi.fn().mockReturnValue({ synced: true }),
  };
}

function makeKeyringStub() {
  const store = new Map<string, string>();
  return {
    module: {
      getPassword: async (service: string, account: string) => {
        const k = `${service}::${account}`;
        return store.has(k) ? store.get(k)! : null;
      },
      setPassword: async (service: string, account: string, password: string) => {
        store.set(`${service}::${account}`, password);
      },
      deletePassword: async (service: string, account: string) => {
        return store.delete(`${service}::${account}`);
      },
    },
    store,
  };
}

function makeRoutes({
  home,
  store,
  env,
  readBody,
}: {
  home: string;
  store: ReturnType<typeof createOpenCodeGoWorkspaces>;
  env: Record<string, string | undefined>;
  readBody: Record<string, unknown>;
}) {
  return register({
    sendJson: vi.fn(),
    readJsonBody: async () => readBody,
    assets: makeAssetsStub(),
    opencodeConfig: makeOpenCodeConfigStub(home),
    opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
    opencodeGoWorkspaces: store,
    env,
    childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
  });
}

function findRoute(routes: Array<{ method: string; path: string | RegExp }>, method: string, matcher: (pathSource: string) => boolean) {
  return routes.find((r) => r.method === method && matcher(String(r.path)));
}

describe('opencode go workspaces routes', () => {
  let tmpDir: string;
  let opencodeHome: string;
  let keyring: ReturnType<typeof makeKeyringStub>;
  let workspaceStore: ReturnType<typeof createOpenCodeGoWorkspaces>;
  let xdgData: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-opencode-go-routes-'));
    opencodeHome = path.join(tmpDir, '.config', 'opencode');
    fs.mkdirSync(opencodeHome, { recursive: true });
    xdgData = path.join(tmpDir, 'xdg-data');
    keyring = makeKeyringStub();
    workspaceStore = createOpenCodeGoWorkspaces({
      keyringLoader: async () => keyring.module,
      env: { XDG_DATA_HOME: xdgData },
      nativeAuthPath: path.join(xdgData, 'opencode', 'auth.json'),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/opencode/go-workspaces returns current detected subscription when only OPENCODE_GO_API_KEY is present', async () => {
    const envWithKey = { XDG_DATA_HOME: xdgData, OPENCODE_GO_API_KEY: 'env-only-key' };
    const envStore = createOpenCodeGoWorkspaces({
      keyringLoader: async () => keyring.module,
      env: envWithKey,
      nativeAuthPath: path.join(xdgData, 'opencode', 'auth.json'),
    });
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({}),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: envStore,
      env: envWithKey,
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'GET', (s) => s === '/^\\/api\\/opencode\\/go-workspaces\\/?$/');
    expect(route).toBeDefined();
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: envWithKey,
      req: { method: 'GET' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces' },
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    const body = call[2];
    expect(body.detected.length).toBe(1);
    expect(body.detected[0].label).toBe('Environment OpenCode Go');
    expect(body.detected[0].keySource).toBe('env');
    expect(body.activeId).toBe('detected:env:opencode-go');
    expect(JSON.stringify(body).includes('env-only-key')).toBe(false);
  });

  it('GET /api/opencode/go-workspaces detects native auth.json', async () => {
    const authDir = path.join(xdgData, 'opencode');
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, 'auth.json'), JSON.stringify({
      'opencode-go': { key: 'native-secret', workspaceId: 'wrk_native_only' },
    }));
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({}),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'GET', (s) => s === '/^\\/api\\/opencode\\/go-workspaces\\/?$/');
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'GET' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces' },
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    const body = call[2];
    expect(body.detected.length).toBe(1);
    expect(body.detected[0].label).toBe('OpenCode native Go');
    expect(body.detected[0].keySource).toBe('opencode-auth');
    expect(body.activeId).toBe('detected:native:opencode-go');
    expect(JSON.stringify(body).includes('native-secret')).toBe(false);
  });

  it('POST /api/opencode/go-workspaces stores key in keychain and returns redacted metadata', async () => {
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({
        label: 'Primary',
        workspaceId: 'wrk_primary',
        apiKey: 'super-secret-1234567890',
      }),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'POST', (s) => s === '/^\\/api\\/opencode\\/go-workspaces\\/?$/');
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'POST' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces' },
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    const body = call[2];
    expect(body.ok).toBe(true);
    expect(body.registered.length).toBe(1);
    expect(body.registered[0].label).toBe('Primary');
    expect(body.registered[0].workspaceId).toBe('wrk_primary');
    expect(body.registered[0].keySource).toBe('keychain');
    expect(body.registered[0].active).toBe(true);
    expect(JSON.stringify(body).includes('super-secret-1234567890')).toBe(false);
    const stored = await keyring.module.getPassword('instruction-engine.elegy-copilot.opencode-go', 'keychain:wrk_primary');
    expect(stored).toBe('super-secret-1234567890');
  });

  it('POST /api/opencode/go-workspaces returns 400 when apiKey is missing', async () => {
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({ label: 'NoKey' }),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'POST', (s) => s === '/^\\/api\\/opencode\\/go-workspaces\\/?$/');
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'POST' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces' },
    };
    await route!.handler(ctx);
    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(400);
    expect(call[2].ok).toBe(false);
  });

  it('POST /api/opencode/go-workspaces/:id/activate marks exactly one active', async () => {
    await workspaceStore.registerWorkspace(opencodeHome, { label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a', activate: true });
    await workspaceStore.registerWorkspace(opencodeHome, { label: 'B', workspaceId: 'wrk_b', apiKey: 'k-b', activate: false });

    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({}),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'POST', (s) => s.includes('activate'));
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'POST' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces/wrk_b/activate' },
      match: ['/api/opencode/go-workspaces/wrk_b/activate', 'wrk_b'],
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    const body = call[2];
    expect(body.activeId).toBe('wrk_b');
    const active = body.registered.filter((p: { active: boolean }) => p.active);
    expect(active.length).toBe(1);
    expect(active[0].workspaceId).toBe('wrk_b');
  });

  it('POST /api/opencode/go-workspaces/:id/validate records status', async () => {
    await workspaceStore.registerWorkspace(opencodeHome, { label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a' });
    const fetchImpl = async () => ({ status: 200 });
    const storeWithFetch = createOpenCodeGoWorkspaces({
      keyringLoader: async () => keyring.module,
      env: { XDG_DATA_HOME: xdgData },
      nativeAuthPath: path.join(xdgData, 'opencode', 'auth.json'),
      fetchImpl,
    });
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({}),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: storeWithFetch,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'POST', (s) => s.includes('validate'));
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'POST' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces/wrk_a/validate' },
      match: ['/api/opencode/go-workspaces/wrk_a/validate', 'wrk_a'],
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    expect(call[2].status).toBe('ok');
  });

  it('DELETE /api/opencode/go-workspaces/:id removes profile and keychain entry', async () => {
    await workspaceStore.registerWorkspace(opencodeHome, { label: 'A', workspaceId: 'wrk_a', apiKey: 'k-a' });
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({}),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'DELETE', (s) => s.includes('go-workspaces'));
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'DELETE' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces/wrk_a' },
      match: ['/api/opencode/go-workspaces/wrk_a', 'wrk_a'],
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    expect(call[2].ok).toBe(true);
    expect(call[2].registered.length).toBe(0);
    const stored = await keyring.module.getPassword('instruction-engine.elegy-copilot.opencode-go', 'keychain:wrk_a');
    expect(stored).toBe(null);
  });

  it('POST /api/opencode/go-workspaces/create-flow returns a draft profile', async () => {
    const sendJson = vi.fn();
    const routes = register({
      sendJson,
      readJsonBody: async () => ({ label: 'New WS', workspaceId: 'wrk_new' }),
      assets: makeAssetsStub(),
      opencodeConfig: makeOpenCodeConfigStub(opencodeHome),
      opencodeLogReader: { readRequestLogs: () => ({ requests: [], total: 0, logFiles: 0 }), DEFAULT_LIMIT: 100 },
      opencodeGoWorkspaces: workspaceStore,
      env: { XDG_DATA_HOME: xdgData },
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
    });
    const route = findRoute(routes, 'POST', (s) => s.includes('create-flow'));
    const ctx = {
      opencodeHome,
      elegyHomeAbs: '',
      engineRoot: '',
      env: { XDG_DATA_HOME: xdgData },
      req: { method: 'POST' },
      res: { writeHead: vi.fn(), end: vi.fn() },
      u: { pathname: '/api/opencode/go-workspaces/create-flow' },
      match: ['/api/opencode/go-workspaces/create-flow', 'create-flow'],
    };
    await route!.handler(ctx);

    const call = sendJson.mock.calls[0];
    expect(call[1]).toBe(200);
    expect(call[2].ok).toBe(true);
    expect(call[2].draft.id).toBe('wrk_new');
    expect(call[2].draft.consoleUrl).toBe('https://opencode.ai/workspace/wrk_new/go');
    expect(call[2].consoleUrl).toBe('https://opencode.ai/workspace/wrk_new/go');
    expect(call[2].authUrl).toBe('https://opencode.ai/connect');
  });
});
