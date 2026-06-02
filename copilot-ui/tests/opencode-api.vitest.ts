import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const { register } = await vi.importActual<{ register: Function }>('../routes/opencode');

function createMockSendJson() {
  return vi.fn();
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    opencodeHome: '/tmp/.config/opencode',
    copilotHomeAbs: '/tmp/.config/elegy-copilot',
    engineRoot: '/tmp/instruction-engine',
    env: { HOME: '/tmp' },
    req: { method: 'GET' },
    res: { writeHead: vi.fn(), end: vi.fn() },
    u: { pathname: '/api/opencode/status' },
    ...overrides,
  };
}

function createMockOpenCodeConfig(statusOverrides: Record<string, unknown> = {}) {
  return {
    resolveOpenCodeHome: (home: string) => home || '/tmp/.config/opencode',
    resolveConfigPath: (home: string) => `${home}/opencode.jsonc`,
    readConfig: () => ({ provider: { route: 'opencode-go' } }),
    writeConfig: vi.fn(),
    getStatus: () => ({
      opencodeHome: '/tmp/.config/opencode',
      configPath: '/tmp/.config/opencode/opencode.jsonc',
      exploreModel: 'DeepSeek V4 Flash Max',
      scoutModel: 'DeepSeek V4 Pro Max',
      isCustom: false,
      availableModels: ['DeepSeek V4 Flash Max', 'DeepSeek V4 Pro Max'],
      lastAppliedAt: null,
      ...statusOverrides,
    }),
    setAgentModels: vi.fn(),
    resetConfig: vi.fn(),
    getActiveProfileRoute: vi.fn(() => 'opencode-go'),
    setActiveProfileRoute: vi.fn(),
    removeActiveProfileRoute: vi.fn(),
    updateStateProfileRoute: vi.fn(),
  };
}

function createMockAssets(assetList: Array<Record<string, unknown>> = []) {
  return {
    getManagedAssetStatuses: () => assetList,
    syncAll: vi.fn().mockReturnValue({ synced: true, assetCount: assetList.length }),
  };
}

function createReadJsonBody(body: Record<string, unknown> = {}) {
  return async () => body;
}

describe('opencode route - register', () => {
  it('registers GET /api/opencode/status handler', () => {
    const routes = register({});
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    expect(statusRoute).toBeDefined();
    expect(typeof statusRoute!.handler).toBe('function');
  });

  it('registers POST /api/opencode/config handler', () => {
    const routes = register({});
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );
    expect(configRoute).toBeDefined();
  });

  it('registers POST /api/opencode/config/reset handler', () => {
    const routes = register({});
    const resetRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config/reset',
    );
    expect(resetRoute).toBeDefined();
  });

  it('registers POST /api/opencode/assets/install handler', () => {
    const routes = register({});
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/assets/install',
    );
    expect(installRoute).toBeDefined();
  });

  it('reports ready when all dependencies are satisfied', async () => {
    const sendJson = createMockSendJson();

    const opencodeConfig = createMockOpenCodeConfig();
    const assets = createMockAssets([
      { id: 'catalog-assets/shared-skills/elegy-planning', upToDate: true, installed: true, source: 's', destination: 'd' },
      { id: 'opencode-skill-discovery-skill', upToDate: true, installed: true, source: 's', destination: 'd' },
      { id: 'opencode-worktree-plugin', upToDate: true, installed: true, source: 's', destination: 'd' },
      { id: 'opencode-global-instructions', upToDate: true, installed: true, source: 's', destination: 'd' },
    ]);

    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const routes = register({
      sendJson,
      assets,
      opencodeConfig,
      childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) },
    });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );

    const ctx = createMockCtx({
      roadmapWorkflowPlanningBridge: { getState: () => ({ ready: true }) },
    });
    await statusRoute.handler(ctx);

    const statusCode = sendJson.mock.calls[0][1];
    const body = sendJson.mock.calls[0][2];
    expect(statusCode).toBe(200);
    if (body.overallStatus !== 'ready') {
      const nonOk = body.setupChecks.filter((c: { status: string }) => c.status !== 'ok').map((c: { id: string; status: string }) => `${c.id}: ${c.status}`);
      console.error('Non-ok checks:', JSON.stringify(nonOk));
    }
    expect(body.overallStatus).toBe('ready');
    expect(Array.isArray(body.setupChecks)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(Array.isArray(body.lanes)).toBe(true);
    expect(Array.isArray(body.profiles)).toBe(true);
  });

  it('reports degraded when setup checks have warnings', async () => {
    const sendJson = createMockSendJson();
    const assets = createMockAssets([]);
    const opencodeConfig = createMockOpenCodeConfig();

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const routes = register({
      sendJson,
      assets,
      opencodeConfig,
      childProcess: { spawnSync: () => ({ stdout: '', stderr: 'not found' }) },
    });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );

    const ctx = createMockCtx();
    await statusRoute.handler(ctx);

    const statusCode = sendJson.mock.calls[0][1];
    const body = sendJson.mock.calls[0][2];
    expect(statusCode).toBe(200);
    if (body.overallStatus !== 'degraded') {
      const nonOk = body.setupChecks.filter((c: { status: string }) => c.status !== 'ok').map((c: { id: string; status: string }) => `${c.id}: ${c.status}`);
      console.error('Non-ok checks:', JSON.stringify(nonOk));
    }
    expect(body.overallStatus).toBe('degraded');
    expect(body.warnings.length).toBeGreaterThan(0);
  });

  it('returns all four lane definitions', async () => {
    const sendJson = createMockSendJson();
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig: createMockOpenCodeConfig(), childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );

    const ctx = createMockCtx();
    await statusRoute.handler(ctx);

    const body = sendJson.mock.calls[0][2] as { lanes: Array<{ id: string }> };
    const laneIds = body.lanes.map((l) => l.id);
    expect(laneIds).toContain('quick');
    expect(laneIds).toContain('standard');
    expect(laneIds).toContain('spec');
    expect(laneIds).toContain('project');
  });

  it('returns profiles with opencode-go and deepseek-direct', async () => {
    const sendJson = createMockSendJson();
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig: createMockOpenCodeConfig(), childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );

    const ctx = createMockCtx();
    await statusRoute.handler(ctx);

    const body = sendJson.mock.calls[0][2] as { profiles: Array<{ id: string }> };
    const profileIds = body.profiles.map((p) => p.id);
    expect(profileIds).toContain('opencode-go');
    expect(profileIds).toContain('deepseek-direct');
  });

  it('handles errors gracefully', async () => {
    const sendJson = createMockSendJson();

    const routes = register({
      sendJson,
      assets: createMockAssets(),
      opencodeConfig: {
        ...createMockOpenCodeConfig(),
        getStatus: () => { throw new Error('config error'); },
      },
    });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );

    const ctx = createMockCtx();
    await statusRoute.handler(ctx);

    expect(sendJson).toHaveBeenCalled();
    const [, errorCode, errorBody] = sendJson.mock.calls[0];
    expect(errorCode).toBe(500);
    expect(errorBody.error).toContain('config error');
  });

  it('POST /api/opencode/config persists model selection', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ smallModel: 'DeepSeek V4 Flash Max', bigModel: 'DeepSeek V4 Pro Max' }),
      assets: createMockAssets(),
      opencodeConfig,
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );

    const ctx = createMockCtx();
    await configRoute.handler(ctx);

    expect(opencodeConfig.setAgentModels).toHaveBeenCalledWith(
      ctx.opencodeHome,
      'DeepSeek V4 Flash Max',
      'DeepSeek V4 Pro Max',
    );
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });

  it('POST /api/opencode/config writes profileRoute to state when provided', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ profileRoute: 'deepseek-direct' }),
      assets: createMockAssets(),
      opencodeConfig,
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );

    const ctx = createMockCtx();
    await configRoute.handler(ctx);

    expect(opencodeConfig.updateStateProfileRoute).toHaveBeenCalledWith(
      ctx.opencodeHome,
      'deepseek-direct',
    );
  });

  it('POST /api/opencode/config/reset calls resetConfig and returns status', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody(),
      assets: createMockAssets(),
      opencodeConfig,
    });
    const resetRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config/reset',
    );

    const ctx = createMockCtx();
    await resetRoute.handler(ctx);

    expect(opencodeConfig.resetConfig).toHaveBeenCalledWith(ctx.opencodeHome);
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });

  it('POST /api/opencode/assets/install returns 400 when engineRoot missing', async () => {
    const sendJson = createMockSendJson();
    const assets = createMockAssets();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ force: true }),
      assets,
      opencodeConfig: createMockOpenCodeConfig(),
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/assets/install',
    );

    const ctx = createMockCtx({ engineRoot: '' });
    await installRoute.handler(ctx);

    expect(sendJson).toHaveBeenCalledWith(ctx.res, 400, expect.objectContaining({ ok: false }));
    expect(assets.syncAll).not.toHaveBeenCalled();
  });

  it('POST /api/opencode/assets/install forwards force flag to assets.syncAll', async () => {
    const sendJson = createMockSendJson();
    const assets = createMockAssets();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ force: true }),
      assets,
      opencodeConfig: createMockOpenCodeConfig(),
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/assets/install',
    );

    const ctx = createMockCtx();
    await installRoute.handler(ctx);

    expect(assets.syncAll).toHaveBeenCalledWith(
      ctx.engineRoot,
      ctx.opencodeHome,
      expect.objectContaining({ force: true, dryRun: false, pointerMode: true }),
    );
  });

  it('POST /api/opencode/tooling/install returns 400 for unknown kind', async () => {
    const sendJson = createMockSendJson();
    const assets = createMockAssets();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ kind: 'made-up-tool' }),
      assets,
      opencodeConfig: createMockOpenCodeConfig(),
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/tooling/install',
    );

    const ctx = createMockCtx();
    await installRoute.handler(ctx);

    expect(sendJson).toHaveBeenCalledWith(
      ctx.res,
      400,
      expect.objectContaining({ ok: false, error: expect.stringContaining('Unknown tooling install kind') }),
    );
  });

  it('POST /api/opencode/tooling/install returns 400 when copilotHome missing', async () => {
    const sendJson = createMockSendJson();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ kind: 'elegy-planning-cli' }),
      assets: createMockAssets(),
      opencodeConfig: createMockOpenCodeConfig(),
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/tooling/install',
    );

    const ctx = createMockCtx({ copilotHomeAbs: '' });
    await installRoute.handler(ctx);

    expect(sendJson).toHaveBeenCalledWith(ctx.res, 400, expect.objectContaining({ ok: false }));
  });

  it('POST /api/opencode/tooling/install with elegy-skills filters to elegy assets and passes engineRoot', async () => {
    const sendJson = createMockSendJson();
    const assets = createMockAssets();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ kind: 'elegy-skills', force: true }),
      assets,
      opencodeConfig: createMockOpenCodeConfig(),
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/tooling/install',
    );

    const ctx = createMockCtx();
    await installRoute.handler(ctx);

    expect(assets.syncAll).toHaveBeenCalledWith(
      ctx.engineRoot,
      ctx.opencodeHome,
      expect.objectContaining({ force: true, pointerMode: true, assetFilter: expect.any(Function) }),
    );
    const filterFn = assets.syncAll.mock.calls[0][2].assetFilter;
    expect(filterFn({ id: 'elegy-planning-cli', source: 'github' })).toBe(true);
    expect(filterFn({ id: 'opencode-plugin', source: 'github' })).toBe(false);
    expect(sendJson).toHaveBeenCalledWith(
      ctx.res,
      200,
      expect.objectContaining({ ok: true, kind: 'elegy-skills', syncResult: expect.any(Object) }),
    );
  });
});
