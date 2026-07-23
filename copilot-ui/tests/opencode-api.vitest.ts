import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
const { register } = await vi.importActual<{ register: Function }>('../routes/opencode');
afterEach(() => {
  vi.restoreAllMocks();
});
function createMockSendJson() {
  return vi.fn();
}
function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    opencodeHome: '/tmp/.config/opencode',
    elegyHomeAbs: '/tmp/.config/elegy-copilot',
    engineRoot: '/tmp/elegy-copilot',
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
    getWorktreePermissionProfileStatus: () => ({
      applied: true,
      worktreeBase: '/tmp/.local/share/opencode/worktree',
      missingPermissionKeys: [],
    }),
    applyWorktreePermissionProfile: vi.fn(() => ({
      changed: false,
      dryRun: false,
      configPath: '/tmp/.config/opencode/opencode.jsonc',
      opencodeHome: '/tmp/.config/opencode',
      profile: {
        permission: { external_directory: 'allow', bash: 'allow' },
        marker: { version: 1, marker: 'elegy-copilot-worktree-permission-profile', worktreeBase: '/tmp/.local/share/opencode/worktree' },
      },
    })),
    setAgentModels: vi.fn(),
    setAgentRoleModels: vi.fn(),
    resetConfig: vi.fn(),
    getActiveProfileRoute: vi.fn(() => 'opencode-go'),
    getActiveProfileId: vi.fn(() => 'opencode-go'),
    setActiveProfileId: vi.fn(),
    setActiveProfileRoute: vi.fn(),
    removeActiveProfileRoute: vi.fn(),
    updateStateProfileRoute: vi.fn(),
    readCustomPrompts: vi.fn(() => ({})),
    readState: vi.fn(() => ({ _managedPrompts: {} })),
    readProfileCatalog: vi.fn(() => ({
      activeProfile: 'opencode-go',
      profiles: {
        'opencode-go': {
          label: 'OpenCode Go',
          description: 'Default provider route',
          small: 'deepseek-v4-flash',
          big: 'deepseek-v4-pro',
          review: 'deepseek-v4-pro',
          roleModels: { planning: 'deepseek-v4-pro', implementation: 'deepseek-v4-flash', exploration: 'deepseek-v4-flash', review: 'deepseek-v4-pro', research: 'deepseek-v4-pro' },
          smallLabel: 'DeepSeek V4 Flash',
          bigLabel: 'DeepSeek V4 Pro',
          reviewLabel: 'DeepSeek V4 Pro',
        },
        'deepseek-direct': {
          label: 'Direct DeepSeek',
          description: 'Direct DeepSeek API fallback route',
          small: 'deepseek/deepseek-v4-flash',
          big: 'deepseek/deepseek-v4-pro',
          review: 'deepseek/deepseek-v4-pro',
          roleModels: { planning: 'deepseek/deepseek-v4-pro', implementation: 'deepseek/deepseek-v4-flash', exploration: 'deepseek/deepseek-v4-flash', review: 'deepseek/deepseek-v4-pro', research: 'deepseek/deepseek-v4-pro' },
          smallLabel: 'DeepSeek V4 Flash Max',
          bigLabel: 'DeepSeek V4 Pro Max',
          reviewLabel: 'DeepSeek V4 Pro High',
        },
      },
    })),
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
  it('reports degraded when optional governed integrations still need attention', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const assets = createMockAssets([
      { id: 'elegy-planning', upToDate: true, installed: true, source: 'github:src/Elegy-planning/skills/elegy-planning', destination: 'skills/elegy-planning' },
      { id: 'opencode-skill-discovery-skill', upToDate: true, installed: true, source: 's', destination: 'd' },
      { id: 'opencode-worktree-plugin', upToDate: true, installed: true, source: 's', destination: 'd' },
      { id: 'opencode-global-instructions', upToDate: true, installed: true, source: 's', destination: 'd' },
    ]);
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-opencode-ready-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const opencodeHome = path.join(tmpRoot, '.opencode');
    const sourceRepoRoot = path.join(elegyHome, 'managed-cli', 'planning', 'source', 'Elegy');
    fs.mkdirSync(path.join(elegyHome, 'managed-cli', 'planning'), { recursive: true });
    fs.mkdirSync(opencodeHome, { recursive: true });
    fs.writeFileSync(path.join(elegyHome, 'managed-cli', 'planning', 'elegy-planning.install.json'), JSON.stringify({
      source: 'github-source',
      sourceRepoRoot,
      sourceGitHead: '1.0.0',
      sourceRemote: 'https://github.com/Sofreshx/Elegy.git',
    }), 'utf8');
    fs.writeFileSync(path.join(opencodeHome, 'elegy-assets.install.json'), JSON.stringify({
      source: 'github-source',
      sourceRepoRoot,
      sourceGitHead: '1.0.0',
      sourceRemote: 'https://github.com/Sofreshx/Elegy.git',
      assets: [
        { id: 'elegy-planning', destination: 'skills/elegy-planning' },
        { id: 'elegy-skills', destination: 'skills/elegy-skills' },
        { id: 'elegy-obsidian', destination: 'skills/elegy-obsidian' },
      ],
    }), 'utf8');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const toolCliInstallers = {
      getCliToolStatus: () => ({
        id: 'opencode-cli',
        label: 'OpenCode CLI',
        command: 'opencode',
        packageName: 'opencode-ai',
        installed: true,
        version: '1.0.0',
        installCommand: 'npm install -g opencode-ai',
        lastError: null,
      }),
      installCliTool: () => ({ ok: true, toolId: 'opencode-cli', version: '1.0.0', error: null }),
    };
    opencodeConfig.ensureWorktreePermissions = () => ({ patched: true, rulesAdded: 4 });
    const mockBridge = { getStatus: () => ({ ready: true }) };
    const routes = register({
      sendJson,
      assets,
      opencodeConfig,
      childProcess: { spawnSync: () => ({ status: 0, stdout: '1.0.0', stderr: '' }) },
      roadmapWorkflowPlanningBridge: mockBridge,
      toolCliInstallers,
    });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    const ctx = createMockCtx({ elegyHomeAbs: elegyHome, opencodeHome });
    await statusRoute.handler(ctx);
    const statusCode = sendJson.mock.calls[0][1];
    const body = sendJson.mock.calls[0][2];
    expect(statusCode).toBe(200);
    if (body.overallStatus !== 'ready') {
      const nonOk = body.setupChecks.filter((c: { status: string }) => c.status !== 'ok').map((c: { id: string; status: string }) => `${c.id}: ${c.status}`);
      console.error('Non-ok checks:', JSON.stringify(nonOk));
    }
    expect(body.overallStatus).toBe('degraded');
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
  it('returns the current governed lane definitions', async () => {
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
    expect(laneIds).toContain('project');
    expect(laneIds).toContain('runner');
    expect(laneIds).toContain('runner-flash');
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
      undefined,
    );
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });
  it('POST /api/opencode/config writes profileRoute to state when provided', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const mockExecFile = vi.fn((_file, _args, _options, callback) => {
      callback(null, 'stdout', '');
      return { on: vi.fn() };
    });
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ profileRoute: 'deepseek-direct' }),
      assets: createMockAssets(),
      opencodeConfig,
      fs: { existsSync: vi.fn(() => true) },
      childProcess: { execFile: mockExecFile },
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );
    const ctx = createMockCtx();
    await configRoute.handler(ctx);
    expect(opencodeConfig.setActiveProfileId).toHaveBeenCalledWith(
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
  it('POST /api/opencode/tooling/install returns 400 when elegyHome missing', async () => {
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
    const ctx = createMockCtx({ elegyHomeAbs: '' });
    await installRoute.handler(ctx);
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 400, expect.objectContaining({ ok: false }));
  });
  it('POST /api/opencode/tooling/install with elegy-skills installs from managed GitHub source', async () => {
    const sendJson = createMockSendJson();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-opencode-github-skills-'));
    const elegyHome = path.join(tmpRoot, '.elegy');
    const opencodeHome = path.join(tmpRoot, '.opencode');
    const assets = createMockAssets();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ kind: 'elegy-skills', force: true }),
      assets,
      opencodeConfig: createMockOpenCodeConfig(),
      childProcess: {
        execFile(command: string, args: string[], _options: unknown, callback: Function) {
          expect(command).toBe('git');
          expect(args[0]).toBe('clone');
          const destination = args[args.length - 1];
          fs.mkdirSync(path.join(destination, 'rust', 'crates', 'elegy-planning'), { recursive: true });
          fs.writeFileSync(path.join(destination, 'rust', 'Cargo.toml'), '[workspace]', 'utf8');
          fs.writeFileSync(path.join(destination, 'rust', 'crates', 'elegy-planning', 'Cargo.toml'), '[package]', 'utf8');
          for (const rel of [
            path.join('src', 'Elegy-planning', 'skills', 'elegy-planning'),
            path.join('src', 'Elegy-skills', 'skills', 'elegy-skills'),
            path.join('skills', 'elegy-obsidian'),
          ]) {
            fs.mkdirSync(path.join(destination, rel), { recursive: true });
            fs.writeFileSync(path.join(destination, rel, 'SKILL.md'), `# ${rel}`, 'utf8');
          }
          callback(null, '', '');
        },
        spawnSync() {
          return { status: 0, stdout: 'asset-head\n', stderr: '' };
        },
      },
    });
    const installRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/tooling/install',
    );
    const ctx = createMockCtx({ elegyHomeAbs: elegyHome, opencodeHome });
    await installRoute.handler(ctx);
    expect(assets.syncAll).not.toHaveBeenCalled();
    expect(sendJson).toHaveBeenCalledWith(
      ctx.res,
      200,
      expect.objectContaining({
        ok: true,
        kind: 'elegy-skills',
        syncResult: expect.objectContaining({
          source: 'github-source',
          installed: expect.arrayContaining([
            expect.objectContaining({ id: 'elegy-planning' }),
            expect.objectContaining({ id: 'elegy-skills' }),
            expect.objectContaining({ id: 'elegy-obsidian' }),
          ]),
        }),
      }),
    );
  });
  it('GET /api/opencode/status returns profiles with roleModels field', async () => {
    const sendJson = createMockSendJson();
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig: createMockOpenCodeConfig(), childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    const ctx = createMockCtx();
    await statusRoute.handler(ctx);
    const body = sendJson.mock.calls[0][2] as { profiles: Array<Record<string, unknown>> };
    expect(Array.isArray(body.profiles)).toBe(true);
    for (const profile of body.profiles) {
      expect(profile).toHaveProperty('roleModels');
      expect(profile).toHaveProperty('tags');
      expect(typeof profile.roleModels).toBe('object' as string);
      expect(Array.isArray(profile.tags)).toBe(true);
    }
  });
  it('POST /api/opencode/config accepts { profileId } payload', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const mockExecFile = vi.fn((_file, _args, _options, callback) => {
      callback(null, 'stdout', '');
      return { on: vi.fn() };
    });
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ profileId: 'deepseek-direct' }),
      assets: createMockAssets(),
      opencodeConfig,
      fs: { existsSync: vi.fn(() => true) },
      childProcess: { execFile: mockExecFile },
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );
    const ctx = createMockCtx();
    await configRoute.handler(ctx);
    expect(opencodeConfig.setActiveProfileId).toHaveBeenCalledWith(
      ctx.opencodeHome,
      'deepseek-direct',
    );
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });
  it('POST /api/opencode/config accepts { roleModels } payload', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const roleModels = { planning: 'new/planning-model', implementation: 'new/impl-model' };
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ roleModels }),
      assets: createMockAssets(),
      opencodeConfig,
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );
    const ctx = createMockCtx();
    await configRoute.handler(ctx);
    expect(opencodeConfig.setAgentRoleModels).toHaveBeenCalledWith(
      ctx.opencodeHome,
      roleModels,
    );
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });
  it('POST /api/opencode/config still accepts legacy { smallModel, bigModel } payload', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ smallModel: 'flash', bigModel: 'pro' }),
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
      'flash',
      'pro',
      undefined,
    );
    expect(sendJson).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ ok: true }));
  });
  it('POST /api/opencode/config rejects unknown profileId', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    const routes = register({
      sendJson,
      readJsonBody: createReadJsonBody({ profileId: 'nonexistent-profile' }),
      assets: createMockAssets(),
      opencodeConfig,
      fs: { existsSync: vi.fn(() => true) },
    });
    const configRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'POST' && r.path === '/api/opencode/config',
    );
    const ctx = createMockCtx();
    await configRoute.handler(ctx);
    expect(sendJson).toHaveBeenCalledWith(
      ctx.res,
      400,
      expect.objectContaining({ ok: false, error: expect.stringContaining('Unknown profile') }),
    );
  });
  it('GET /api/opencode/status returns effectiveProfileId and selectedProfileId fields', async () => {
    const sendJson = createMockSendJson();
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig: createMockOpenCodeConfig(), childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    const ctx = createMockCtx();
    await statusRoute.handler(ctx);
    const body = sendJson.mock.calls[0][2] as Record<string, unknown>;
    expect(body).toHaveProperty('effectiveProfileId');
    expect(body).toHaveProperty('selectedProfileId');
    // When no custom models are set, effective should match selected
    expect(body.effectiveProfileId).toBe(body.selectedProfileId);
  });
  it('GET /api/opencode/status detects mismatch when effective role models differ from selected profile', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    // Set role models that differ from the selected profile (opencode-go has specific roleModels)
    (opencodeConfig as any).readState = vi.fn(() => ({
      _managedPrompts: {},
      activeProfileId: 'opencode-go',
      roleModels: {
        planning: 'custom/planning-model',
        implementation: 'custom/impl-model',
        exploration: 'custom/explore-model',
        review: 'custom/review-model',
        research: 'custom/research-model',
      },
    }));
    // Ensure readConfig returns custom agent models too
    (opencodeConfig as any).readConfig = vi.fn(() => ({
      provider: { route: 'opencode-go' },
      agent: {
        plan: { model: 'custom/planning-model' },
        build: { model: 'custom/impl-model' },
      },
    }));
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig, childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    const ctx = createMockCtx();
    await statusRoute.handler(ctx);
    const body = sendJson.mock.calls[0][2] as Record<string, unknown>;
    // When role models are completely different from any profile, effectiveProfileId may be null
    // and there should be at minimum selectedProfileId set
    expect(body).toHaveProperty('selectedProfileId');
    expect(body).toHaveProperty('effectiveProfileId');
    // selectedProfileId should reflect the active profile from buildProfiles
    expect(typeof body.selectedProfileId).toBe('string');
    // effectiveProfileId should be null when no profile matches the custom models
    expect(body.effectiveProfileId).toBeNull();
  });
  it('GET /api/opencode/status does not mark profile active when models are custom/unknown', async () => {
    const sendJson = createMockSendJson();
    const opencodeConfig = createMockOpenCodeConfig();
    (opencodeConfig as any).readState = vi.fn(() => ({
      _managedPrompts: {},
      activeProfileId: 'opencode-go',
      roleModels: {
        planning: 'completely-unknown/model-x',
        implementation: 'completely-unknown/model-y',
      },
    }));
    (opencodeConfig as any).readConfig = vi.fn(() => ({
      provider: { route: 'opencode-go' },
      agent: {
        plan: { model: 'completely-unknown/model-x' },
      },
    }));
    const routes = register({ sendJson, assets: createMockAssets(), opencodeConfig, childProcess: { spawnSync: () => ({ stdout: '1.0.0', stderr: '' }) } });
    const statusRoute = routes.find(
      (r: { method: string; path: string }) => r.method === 'GET' && r.path === '/api/opencode/status',
    );
    const ctx = createMockCtx();
    await statusRoute.handler(ctx);
    const body = sendJson.mock.calls[0][2] as Record<string, unknown>;
    // effectiveProfileId should be null since models don't match any profile
    // but selectedProfileId should still reflect the active profile from buildProfiles
    expect(typeof body.selectedProfileId).toBe('string');
    expect(body.effectiveProfileId).toBeNull();
  });
});
