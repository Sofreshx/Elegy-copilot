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
  writeConfig(ctx.elegyHomeAbs, {
    publicBaseUrl: 'https://mcp.example.com',
    authIssuer: 'https://old-quick.trycloudflare.com',
    authAudience: 'https://old-quick.trycloudflare.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflaredPath: makeCloudflared(ctx),
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  const status = await manager.startTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.deepEqual(spawnCalls[0].args[1], ['tunnel', 'run', 'local-mcp']);
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_PUBLIC_BASE_URL, 'https://mcp.example.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_ISSUER, 'https://mcp.example.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_AUDIENCE, 'https://mcp.example.com');
  assert.equal(status.tunnel.running, true);
  assert.equal(status.tunnel.mode, 'named');
  assert.equal(status.tunnel.publicUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.connectorUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.securityState, 'OAuth protected');
});
