'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const childProcess = require('node:child_process');

const managerPath = require.resolve('./localRepoMcpManager');
const originalSpawn = childProcess.spawn;
const originalExecFileSync = childProcess.execFileSync;
const originalFetch = global.fetch;

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };
  return child;
}

function writeConfig(elegyHome, config) {
  const configPath = path.join(elegyHome, 'local-repo-mcp', 'config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
}

function makeContext(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-repo-mcp-manager-'));
  const engineRoot = path.join(root, 'engine');
  const elegyHomeAbs = path.join(root, '.elegy');
  const dist = path.join(engineRoot, 'local-repo-mcp', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'server.js'), 'console.log("server");\n', 'utf8');
  writeConfig(elegyHomeAbs, config);
  return { root, engineRoot, elegyHomeAbs };
}

function makeCloudflared(ctx) {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const executablePath = path.join(ctx.root, `cloudflared${extension}`);
  fs.writeFileSync(executablePath, '', 'utf8');
  return executablePath;
}

function loadManager(spawnCalls, onSpawn = null, execFileSyncImpl = () => '') {
  delete require.cache[managerPath];
  childProcess.execFileSync = execFileSyncImpl;
  childProcess.spawn = (...args) => {
    const child = makeChild();
    child.pid = 1234 + spawnCalls.length;
    spawnCalls.push({ args, child });
    onSpawn?.(args, child, spawnCalls.length - 1);
    return child;
  };
  return require('./localRepoMcpManager');
}

function mockFetchOk(options = {}) {
  const oauthMetadataOk = options.oauthMetadataOk === true;
  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'POST' && requestUrl.endsWith('/mcp')) {
      const body = String(init.body || '');
      const payload = body.includes('tools/list')
        ? { result: { tools: [{ name: 'repo_roots' }] }, jsonrpc: '2.0', id: 2 }
        : { result: { protocolVersion: '2025-06-18' }, jsonrpc: '2.0', id: 1 };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        json: async () => payload,
      };
    }
    if (requestUrl.endsWith('/.well-known/oauth-protected-resource')) {
      return {
        ok: oauthMetadataOk,
        status: oauthMetadataOk ? 200 : 404,
        headers: { get: () => null },
        text: async () => (oauthMetadataOk ? '{"authorization_servers":["https://mcp.example.com"]}' : '{"error":"not_found"}'),
        json: async () => (oauthMetadataOk ? { authorization_servers: ['https://mcp.example.com'] } : { error: 'not_found' }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{"pending":[]}',
      json: async () => ({ pending: [] }),
    };
  };
}

async function withMissingCloudflaredEnv(fn) {
  const original = {
    PATH: process.env.PATH,
    ProgramFiles: process.env.ProgramFiles,
    ProgramFilesX86: process.env['ProgramFiles(x86)'],
  };
  process.env.PATH = '';
  process.env.ProgramFiles = path.join(os.tmpdir(), 'missing-program-files');
  process.env['ProgramFiles(x86)'] = path.join(os.tmpdir(), 'missing-program-files-x86');
  try {
    return await fn();
  } finally {
    if (original.PATH == null) delete process.env.PATH;
    else process.env.PATH = original.PATH;
    if (original.ProgramFiles == null) delete process.env.ProgramFiles;
    else process.env.ProgramFiles = original.ProgramFiles;
    if (original.ProgramFilesX86 == null) delete process.env['ProgramFiles(x86)'];
    else process.env['ProgramFiles(x86)'] = original.ProgramFilesX86;
  }
}

test.afterEach(() => {
  childProcess.spawn = originalSpawn;
  childProcess.execFileSync = originalExecFileSync;
  global.fetch = originalFetch;
  delete require.cache[managerPath];
});

test('startServer starts local-only with blank OAuth config', () => {
  const ctx = makeContext();
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  const status = manager.startServer(ctx);

  assert.equal(status.server.running, true);
  assert.equal(status.securityState, 'Local only');
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
});

test('startServer disables OAuth when stale tunnel config exists without a running tunnel', () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, {
    publicBaseUrl: 'https://old.trycloudflare.com',
    authIssuer: 'https://old.trycloudflare.com',
    authAudience: 'https://old.trycloudflare.com',
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  const status = manager.startServer(ctx);

  assert.equal(status.server.running, true);
  assert.equal(status.securityState, 'Local only');
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_PUBLIC_BASE_URL, 'https://old.trycloudflare.com');
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
});

test('status reports missing cloudflared prerequisite', async () => withMissingCloudflaredEnv(async () => {
  const ctx = makeContext();
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  const status = manager.getStatus(ctx);

  assert.equal(status.prerequisites.cloudflared.available, false);
  assert.equal(status.prerequisites.cloudflared.path, 'cloudflared');
  assert.equal(status.prerequisites.oauth.issuerConfigured, false);
  assert.equal(status.prerequisites.chatGptAccessReady, false);
}));

test('loadConfig migrates v1 stable fields into v3 profiles with a one-time backup', () => {
  const ctx = makeContext({
    schemaVersion: 1,
    publicBaseUrl: 'https://mcp.example.com/',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath: 'C:\\cloudflared\\config.yml',
    authProvider: 'builtin',
    requiredScopes: ['repo:read'],
    customField: 'preserved',
  });
  const manager = loadManager([]);

  const config = manager.loadConfig(ctx);
  const backupPath = path.join(ctx.elegyHomeAbs, 'local-repo-mcp', 'config.v1.backup.json');

  assert.equal(config.schemaVersion, 3);
  assert.equal(config.activeExposureMode, 'quick');
  assert.equal(config.quickTunnel.enabled, true);
  assert.equal(config.stableTunnel.configured, true);
  assert.equal(config.stableTunnel.publicOrigin, 'https://mcp.example.com');
  assert.equal(config.stableTunnel.canonicalResource, 'https://mcp.example.com/mcp');
  assert.equal(config.stableTunnel.managementMode, 'existing');
  assert.equal(config.stableTunnel.setupVersion, 0);
  assert.equal(config.oauth.audience, 'https://mcp.example.com/mcp');
  assert.equal(config.customField, 'preserved');
  assert.equal(fs.existsSync(backupPath), true);
  assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).schemaVersion, 1);
});

test('loadConfig migrates v2 profiles into v3 without changing OAuth state', () => {
  const ctx = makeContext({
    schemaVersion: 2,
    activeExposureMode: 'stable',
    stableTunnel: {
      configured: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath: 'C:\\cloudflared\\config.yml',
      cloudflareCredentialsPath: 'C:\\cloudflared\\tunnel-id.json',
      autoStart: true,
    },
    oauth: {
      provider: 'builtin',
      issuer: 'https://mcp.example.com',
      audience: 'https://mcp.example.com/mcp',
      requiredScopes: ['repo:read'],
      accessTokenTtlSeconds: 120,
      refreshTokenTtlSeconds: 2592000,
    },
  });
  const manager = loadManager([]);

  const config = manager.loadConfig(ctx);
  const backupPath = path.join(ctx.elegyHomeAbs, 'local-repo-mcp', 'config.v2.backup.json');

  assert.equal(config.schemaVersion, 3);
  assert.equal(config.stableTunnel.managementMode, 'existing');
  assert.equal(config.stableTunnel.setupVersion, 0);
  assert.equal(config.oauth.accessTokenTtlSeconds, 120);
  assert.equal(config.oauth.audience, 'https://mcp.example.com/mcp');
  assert.equal(fs.existsSync(backupPath), true);
});

test('managed provisioning preview freezes safe Cloudflare commands and a dedicated config target', () => {
  const ctx = makeContext({ cloudflaredPath: makeCloudflared({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-preview-')) }) });
  const cloudflareConfigDir = path.join(ctx.root, '.cloudflared');
  const manager = loadManager([], null, (_command, args) => {
    if (args[0] === 'tunnel' && args[1] === 'list') return '[]';
    return '';
  });

  const preview = manager.previewManagedTunnelProvisioning({
    ...ctx,
    zone: 'Example.COM',
    cloudflareConfigDir,
    previewId: 'preview-1',
    nowMs: Date.parse('2026-07-25T12:00:00.000Z'),
  });

  assert.equal(preview.previewId, 'preview-1');
  assert.equal(preview.expiresAt, '2026-07-25T12:10:00.000Z');
  assert.equal(preview.tunnelName, 'elegy-local-repo-mcp');
  assert.equal(preview.hostname, 'mcp-reader.example.com');
  assert.equal(preview.configPath, path.join(cloudflareConfigDir, 'elegy-local-repo-mcp.yml'));
  assert.deepEqual(
    preview.operations.filter((operation) => operation.kind === 'command').map((operation) => operation.args),
    [
      ['tunnel', 'create', 'elegy-local-repo-mcp'],
      ['tunnel', 'route', 'dns', 'elegy-local-repo-mcp', 'mcp-reader.example.com'],
    ],
  );
  assert.equal(preview.operations.some((operation) => operation.kind === 'write-config'), true);
});

test('managed provisioning confirm executes the frozen preview once and persists managed stable configuration', () => {
  const ctx = makeContext();
  const cloudflaredPath = makeCloudflared(ctx);
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath });
  const cloudflareConfigDir = path.join(ctx.root, '.cloudflared');
  const execCalls = [];
  const manager = loadManager([], null, (_command, args) => {
    execCalls.push(args);
    if (args[0] === 'tunnel' && args[1] === 'list') {
      return execCalls.length === 1
        ? '[]'
        : JSON.stringify([{ id: 'tunnel-id', name: 'elegy-local-repo-mcp' }]);
    }
    if (args[0] === 'tunnel' && args[1] === 'create') {
      fs.mkdirSync(cloudflareConfigDir, { recursive: true });
      fs.writeFileSync(path.join(cloudflareConfigDir, 'tunnel-id.json'), '{}', 'utf8');
    }
    return '';
  });
  const baseOptions = {
    ...ctx,
    cloudflareConfigDir,
    previewId: 'preview-1',
    nowMs: Date.parse('2026-07-25T12:00:00.000Z'),
  };
  manager.previewManagedTunnelProvisioning({ ...baseOptions, zone: 'example.com' });

  const result = manager.confirmManagedTunnelProvisioning(baseOptions);
  const config = manager.loadConfig(ctx);

  assert.equal(result.provisioning.status, 'completed');
  assert.equal(config.stableTunnel.managementMode, 'managed');
  assert.equal(config.stableTunnel.setupVersion, 1);
  assert.equal(config.stableTunnel.publicOrigin, 'https://mcp-reader.example.com');
  assert.equal(config.stableTunnel.cloudflareTunnelId, 'tunnel-id');
  assert.equal(fs.existsSync(config.stableTunnel.cloudflareConfigPath), true);
  assert.match(fs.readFileSync(config.stableTunnel.cloudflareConfigPath, 'utf8'), /http:\/\/127\.0\.0\.1:3333/);
  assert.throws(
    () => manager.confirmManagedTunnelProvisioning(baseOptions),
    (error) => error.code === 'cloudflare_preview_not_found',
  );
});

test('managed provisioning refuses unsafe zones and expired confirmations', () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const manager = loadManager([], null, (_command, args) =>
    args[0] === 'tunnel' && args[1] === 'list' ? '[]' : ''
  );

  assert.throws(
    () => manager.previewManagedTunnelProvisioning({ ...ctx, zone: 'example.com --token secret' }),
    (error) => error.code === 'cloudflare_zone_invalid',
  );

  manager.previewManagedTunnelProvisioning({
    ...ctx,
    zone: 'example.com',
    previewId: 'expired-preview',
    nowMs: Date.parse('2026-07-25T12:00:00.000Z'),
    cloudflareConfigDir: path.join(ctx.root, '.cloudflared'),
  });

  assert.throws(
    () => manager.confirmManagedTunnelProvisioning({
      ...ctx,
      previewId: 'expired-preview',
      nowMs: Date.parse('2026-07-25T12:10:00.001Z'),
    }),
    (error) => error.code === 'cloudflare_preview_expired',
  );
});

test('managed provisioning cancellation invalidates the frozen preview without executing commands', () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const execCalls = [];
  const manager = loadManager([], null, (_command, args) => {
    execCalls.push(args);
    return args[0] === 'tunnel' && args[1] === 'list' ? '[]' : '';
  });
  const options = {
    ...ctx,
    zone: 'example.com',
    previewId: 'cancel-preview',
    cloudflareConfigDir: path.join(ctx.root, '.cloudflared'),
  };
  manager.previewManagedTunnelProvisioning(options);

  const result = manager.cancelManagedTunnelProvisioning(options);

  assert.deepEqual(result, { cancelled: true, previewId: 'cancel-preview' });
  assert.equal(execCalls.length, 1);
  assert.throws(
    () => manager.confirmManagedTunnelProvisioning(options),
    (error) => error.code === 'cloudflare_preview_not_found',
  );
});

test('status preserves configured stable endpoint while offline without claiming readiness', () => {
  const ctx = makeContext({
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
  });
  const manager = loadManager([]);

  const status = manager.getStatus(ctx);

  assert.equal(status.chatGptAccess.mode, 'stable');
  assert.equal(status.chatGptAccess.configured, true);
  assert.equal(status.chatGptAccess.online, false);
  assert.equal(status.chatGptAccess.ready, false);
  assert.equal(status.chatGptAccess.url, 'https://mcp.example.com/mcp');
  assert.equal(status.chatGptAccess.auth, 'oauth');
  assert.equal(status.chatGptAccess.urlStable, true);
  assert.equal(status.chatGptAccess.lifecycleState, 'configured_offline');
});

test('startQuickTunnel with blank OAuth config generates no-auth ChatGPT URL', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('Your quick Tunnel has been created! https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN, '');
  assert.equal(status.securityState, 'ChatGPT ready');
  assert.equal(status.chatGptAccess.ready, true);
  assert.equal(status.chatGptAccess.url, 'https://sample.trycloudflare.com/mcp');
  assert.equal(status.chatGptAccess.auth, 'none');
  assert.equal(status.chatGptAccess.urlStable, false);
  assert.equal(status.probe.ok, true);
});

test('startQuickTunnel restarts ready MCP server without replacing tunnel URL', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await manager.startQuickTunnel(ctx);
  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].child.killed, false);
  assert.equal(status.connectorUrl, manager.getStatus(ctx).chatGptAccess.url);
  assert.equal(status.connectorUrl, 'https://sample.trycloudflare.com/mcp');
  assert.equal(status.securityState, 'ChatGPT ready');
});

test('startQuickTunnel rejects missing cloudflared before spawning', async () => withMissingCloudflaredEnv(async () => {
  const ctx = makeContext({
    authIssuer: 'https://tenant.example.com/',
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  await assert.rejects(
    () => manager.startQuickTunnel(ctx),
    /cloudflared is required before exposing Local Repo Reader to ChatGPT\./,
  );
  assert.equal(spawnCalls.length, 0);
}));

test('startQuickTunnel parses generated URL and starts no-auth MCP server', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, {
    authIssuer: 'https://tenant.example.com/',
    cloudflaredPath: makeCloudflared(ctx),
  });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('Your quick Tunnel has been created! https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[1].args[1].join(' '), 'tunnel --url http://127.0.0.1:3333');
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_PUBLIC_BASE_URL, '');
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
  assert.equal(spawnCalls[0].args[2].env.LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN, '');
  assert.equal(status.tunnel.mode, 'quick');
  assert.equal(status.tunnel.publicUrl, 'https://sample.trycloudflare.com/mcp');
  assert.equal(status.connectorUrl, status.chatGptAccess.url);
  assert.equal(status.securityState, 'ChatGPT ready');
});

test('status marks tunnel without MCP server as misconfigured', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await manager.startQuickTunnel(ctx);
  spawnCalls[0].child.exitCode = 1;
  spawnCalls[0].child.emit('exit', 1, null);

  const status = manager.getStatus(ctx);

  assert.equal(status.tunnel.running, true);
  assert.equal(status.server.running, false);
  assert.equal(status.securityState, 'Misconfigured');
  assert.equal(status.prerequisites.chatGptAccessReady, false);
});

test('startQuickTunnel restarts stale quick tunnel when MCP server stopped', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1 || index === 3) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from(`https://sample-${index}.trycloudflare.com`));
      });
    }
  });

  await manager.startQuickTunnel(ctx);
  spawnCalls[0].child.exitCode = 1;
  spawnCalls[0].child.emit('exit', 1, null);
  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 4);
  assert.equal(spawnCalls[1].child.killed, true);
  assert.equal(status.securityState, 'ChatGPT ready');
  assert.equal(status.connectorUrl, 'https://sample-3.trycloudflare.com/mcp');
});

test('startQuickTunnel does not start quick tunnel when local MCP readiness fails', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  global.fetch = async () => {
    throw new Error('connection refused');
  };
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await assert.rejects(
    () => manager.startQuickTunnel({ ...ctx, timeoutMs: 10 }),
    /Timed out waiting for Local Repo MCP to become ready/,
  );

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].child.killed, true);
  assert.equal(manager.getStatus(ctx).tunnel.running, false);
});

test('startQuickTunnel stops stale untracked local repo MCP processes before starting', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  const execCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  }, (...args) => {
    execCalls.push(args);
    return '9999\n';
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(execCalls.length, process.platform === 'win32' ? 1 : 0);
  if (process.platform === 'win32') {
    assert.match(String(execCalls[0][1].join(' ')), /Get-NetTCPConnection/);
    assert.match(String(execCalls[0][1].join(' ')), /LocalPort/);
  }
  assert.equal(status.securityState, 'ChatGPT ready');
  assert.equal(Boolean(status.server.notice?.includes('Stopped stale Local Repo MCP process')), process.platform === 'win32');
});

test('startQuickTunnel rejects OAuth challenge in no-auth readiness probe', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'POST' && requestUrl.endsWith('/mcp')) {
      return {
        ok: false,
        status: 401,
        headers: { get: (name) => (String(name).toLowerCase() === 'www-authenticate' ? 'Bearer resource_metadata="https://sample.trycloudflare.com/.well-known/oauth-protected-resource"' : null) },
        text: async () => '{"error":"unauthorized"}',
        json: async () => ({ error: 'unauthorized' }),
      };
    }
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => '{"error":"not_found"}',
      json: async () => ({ error: 'not_found' }),
    };
  };
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await assert.rejects(
    () => manager.startQuickTunnel({ ...ctx, timeoutMs: 10 }),
    /MCP endpoint requires OAuth or bearer auth/,
  );

  assert.equal(spawnCalls[0].child.killed, true);
  assert.equal(spawnCalls.length, 1);
  assert.equal(manager.getStatus(ctx).securityState, 'Stopped');
});

test('startQuickTunnel keeps local server and tunnel when only public probe fails', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    const method = String(init.method || 'GET').toUpperCase();
    if (method === 'POST' && requestUrl === 'http://127.0.0.1:3333/mcp') {
      const body = String(init.body || '');
      const payload = body.includes('tools/list')
        ? { result: { tools: [{ name: 'repo_roots' }] }, jsonrpc: '2.0', id: 2 }
        : { result: { protocolVersion: '2025-06-18' }, jsonrpc: '2.0', id: 1 };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => `data: ${JSON.stringify(payload)}\n\n`,
        json: async () => payload,
      };
    }
    if (requestUrl.endsWith('/.well-known/oauth-protected-resource')) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => '{"error":"not_found"}',
        json: async () => ({ error: 'not_found' }),
      };
    }
    throw new Error('local machine cannot reach quick tunnel');
  };
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 1) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(status.securityState, 'ChatGPT ready');
  assert.equal(status.chatGptAccess.url, 'https://sample.trycloudflare.com/mcp');
  assert.match(status.server.notice, /Public ChatGPT URL probe failed/);
});

test('getPendingAuthorizations skips OAuth polling for no-auth sessions', async () => {
  const ctx = makeContext();
  const spawnCalls = [];
  global.fetch = async () => {
    throw new Error('should not be called');
  };
  const manager = loadManager(spawnCalls);
  manager.startServer(ctx);

  const status = await manager.getPendingAuthorizations(ctx);

  assert.deepEqual(status.pending, []);
  assert.equal(status.pendingError, undefined);
});

test('startTunnel starts named tunnel and OAuth MCP server with stable URL', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    publicBaseUrl: 'https://mcp.example.com',
    authIssuer: 'https://old-quick.trycloudflare.com',
    authAudience: 'https://old-quick.trycloudflare.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );

  const status = await manager.startTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.deepEqual(spawnCalls[0].args[1], ['tunnel', '--config', cloudflareConfigPath, 'run', 'local-mcp']);
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_PUBLIC_BASE_URL, 'https://mcp.example.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_ISSUER, 'https://mcp.example.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_AUDIENCE, 'https://mcp.example.com/mcp');
  assert.equal(status.tunnel.running, true);
  assert.equal(status.tunnel.mode, 'named');
  assert.equal(status.tunnel.publicUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.connectorUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.securityState, 'OAuth protected');
  assert.equal(status.chatGptAccess.mode, 'stable');
  assert.equal(status.chatGptAccess.auth, 'oauth');
  assert.equal(status.chatGptAccess.urlStable, true);
  assert.equal(status.chatGptAccess.ready, false);
  assert.equal(status.chatGptAccess.lifecycleState, 'online_unverified');
});

test('startTunnel persists strong ownership metadata for both managed processes', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    schemaVersion: 3,
    activeExposureMode: 'stable',
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath,
      cloudflareCredentialsPath: credentialsPath,
    },
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );

  await manager.startTunnel(ctx);

  const runtimePath = path.join(ctx.elegyHomeAbs, 'local-repo-mcp', 'runtime-state.json');
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  assert.equal(runtime.version, 1);
  assert.equal(runtime.mode, 'stable');
  assert.equal(runtime.processes.tunnel.pid, 1234);
  assert.equal(runtime.processes.mcp.pid, 1235);
  assert.match(runtime.processes.tunnel.argsHash, /^[a-f0-9]{64}$/);
  assert.match(runtime.processes.mcp.configHash, /^[a-f0-9]{64}$/);
  assert.notEqual(runtime.processes.tunnel.argsHash, runtime.processes.mcp.argsHash);
});

test('initializeManagedLifecycle autostarts only completed managed setup', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    schemaVersion: 3,
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath,
      cloudflareCredentialsPath: credentialsPath,
    },
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );

  const result = await manager.initializeManagedLifecycle({ ...ctx, monitor: false });

  assert.equal(result.lifecycle.code, 'autostart_started');
  assert.equal(spawnCalls.length, 2);
  assert.equal(result.tunnel.mode, 'named');
});

test('initializeManagedLifecycle refuses ambiguous surviving process ownership', async () => {
  const ctx = makeContext({
    schemaVersion: 3,
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
    },
  });
  const runtimePath = path.join(ctx.elegyHomeAbs, 'local-repo-mcp', 'runtime-state.json');
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
  fs.writeFileSync(runtimePath, JSON.stringify({
    version: 1,
    mode: 'stable',
    instanceId: 'old-instance',
    processes: {
      tunnel: {
        pid: 999,
        startedAt: '2026-07-25T12:00:00.000Z',
        executablePath: 'cloudflared.exe',
        args: ['tunnel', 'run', 'local-mcp'],
        argsHash: 'expected-hash',
        configHash: 'config-hash',
      },
    },
  }), 'utf8');
  const manager = loadManager([]);

  const result = await manager.initializeManagedLifecycle({
    ...ctx,
    monitor: false,
    inspectProcess: () => ({
      alive: true,
      startedAt: '2026-07-25T12:00:00.000Z',
      executablePath: 'unrelated.exe',
      args: ['--other'],
    }),
  });

  assert.equal(result.lifecycle.code, 'foreign_process');
  assert.equal(result.lifecycle.blocked, true);
  assert.equal(fs.existsSync(runtimePath), true);
});

test('initializeManagedLifecycle adopts only fully matching surviving process records', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    schemaVersion: 3,
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath,
      cloudflareCredentialsPath: credentialsPath,
    },
  });
  const firstSpawnCalls = [];
  const firstManager = loadManager(firstSpawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );
  await firstManager.startTunnel(ctx);
  const runtimePath = path.join(ctx.elegyHomeAbs, 'local-repo-mcp', 'runtime-state.json');
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));

  const secondSpawnCalls = [];
  const secondManager = loadManager(secondSpawnCalls);
  const result = await secondManager.initializeManagedLifecycle({
    ...ctx,
    monitor: false,
    inspectProcess: (record) => ({
      alive: true,
      startedAt: record.startedAt,
      executablePath: record.executablePath,
      args: record.args,
    }),
  });

  assert.equal(result.lifecycle.code, 'owned_processes_adopted');
  assert.equal(result.tunnel.running, true);
  assert.equal(result.server.running, true);
  assert.equal(secondSpawnCalls.length, 0);
  assert.equal(runtime.processes.tunnel.pid, result.tunnel.pid);
  assert.equal(runtime.processes.mcp.pid, result.server.pid);
});

test('computeRecoveryDelay applies bounded backoff and stops after five failures in ten minutes', () => {
  const manager = loadManager([]);
  const now = Date.parse('2026-07-25T12:10:00.000Z');

  assert.equal(manager.computeRecoveryDelay([], now), 1000);
  assert.equal(manager.computeRecoveryDelay([now - 1000], now), 2000);
  assert.equal(manager.computeRecoveryDelay([now - 2000, now - 1000], now), 5000);
  assert.equal(manager.computeRecoveryDelay([now - 3000, now - 2000, now - 1000], now), 10000);
  assert.equal(manager.computeRecoveryDelay([now - 4000, now - 3000, now - 2000, now - 1000], now), 30000);
  assert.equal(manager.computeRecoveryDelay([now - 5000, now - 4000, now - 3000, now - 2000, now - 1000], now), null);
  assert.equal(manager.computeRecoveryDelay([now - 700000], now), 1000);
});

test('managed lifecycle retries crashes but stops on configuration and ownership blockers', () => {
  const manager = loadManager([]);

  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'process_exited' }), true);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'probe_error' }), true);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'cloudflare_credentials_missing' }), false);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'cloudflare_config_invalid' }), false);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'cloudflare_tunnel_list_failed' }), false);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'stable_origin_invalid' }), false);
  assert.equal(manager.shouldRetryManagedLifecycleError({ code: 'foreign_process' }), false);
});

test('managed lifecycle schedules first MCP crash recovery after one second', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    schemaVersion: 3,
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath,
      cloudflareCredentialsPath: credentialsPath,
    },
  });
  const spawnCalls = [];
  const scheduled = [];
  const manager = loadManager(spawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );
  await manager.initializeManagedLifecycle({
    ...ctx,
    monitor: false,
    now: () => Date.parse('2026-07-25T12:00:00.000Z'),
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
  });

  spawnCalls[1].child.exitCode = 1;
  spawnCalls[1].child.emit('exit', 1, null);
  const status = manager.getStatus(ctx);

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1000);
  assert.equal(status.lifecycle.code, 'recovery_scheduled');
  assert.equal(status.lifecycle.reason, 'mcp_process_exited');
});

test('intentional stable server restart does not schedule crash recovery', async () => {
  const ctx = makeContext();
  mockFetchOk({ oauthMetadataOk: true });
  const credentialsPath = path.join(ctx.root, 'tunnel-id.json');
  const cloudflareConfigPath = path.join(ctx.root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(cloudflareConfigPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
  ].join('\n'), 'utf8');
  writeConfig(ctx.elegyHomeAbs, {
    schemaVersion: 3,
    publicBaseUrl: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflareConfigPath,
    cloudflaredPath: makeCloudflared(ctx),
    stableTunnel: {
      configured: true,
      managementMode: 'managed',
      setupVersion: 1,
      autoStart: true,
      publicOrigin: 'https://mcp.example.com',
      canonicalResource: 'https://mcp.example.com/mcp',
      hostname: 'mcp.example.com',
      cloudflareTunnelName: 'local-mcp',
      cloudflareTunnelId: 'tunnel-id',
      cloudflareConfigPath,
      cloudflareCredentialsPath: credentialsPath,
    },
  });
  const spawnCalls = [];
  const scheduled = [];
  const manager = loadManager(spawnCalls, null, (_command, args) =>
    args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-mcp' }])
  );
  const lifecycleOptions = {
    ...ctx,
    monitor: false,
    setTimeout: (callback, delay) => {
      scheduled.push({ callback, delay });
      return { unref() {} };
    },
  };
  await manager.initializeManagedLifecycle(lifecycleOptions);

  await manager.startTunnel({ ...ctx, lifecycleInternal: true });

  assert.equal(spawnCalls.length, 3);
  assert.equal(spawnCalls[0].child.killed, false);
  assert.equal(spawnCalls[1].child.killed, true);
  assert.equal(scheduled.length, 0);
});
