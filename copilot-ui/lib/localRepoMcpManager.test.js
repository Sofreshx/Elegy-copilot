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

function loadManager(spawnCalls, onSpawn = null) {
  delete require.cache[managerPath];
  childProcess.spawn = (...args) => {
    const child = makeChild();
    spawnCalls.push({ args, child });
    onSpawn?.(args, child, spawnCalls.length - 1);
    return child;
  };
  return require('./localRepoMcpManager');
}

function mockFetchOk() {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ pending: [] }),
  });
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

test('startQuickTunnel with blank OAuth config generates tokenized no-auth ChatGPT URL', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 0) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('Your quick Tunnel has been created! https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
  assert.match(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN, /^[A-Za-z0-9_-]+$/);
  assert.equal(status.securityState, 'ChatGPT ready');
  assert.equal(status.chatGptAccess.ready, true);
  assert.match(status.chatGptAccess.url, /^https:\/\/sample\.trycloudflare\.com\/mcp\/[A-Za-z0-9_-]+$/);
  assert.equal(status.chatGptAccess.auth, 'none');
  assert.equal(status.chatGptAccess.urlStable, false);
});

test('startQuickTunnel restarts ready MCP server without replacing tunnel URL', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 0) {
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
  assert.match(status.connectorUrl, /^https:\/\/sample\.trycloudflare\.com\/mcp\/[A-Za-z0-9_-]+$/);
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
    if (index === 0) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('Your quick Tunnel has been created! https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].args[1].join(' '), 'tunnel --url http://127.0.0.1:3333');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_PUBLIC_BASE_URL, 'https://sample.trycloudflare.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'disabled');
  assert.match(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_PUBLIC_ACCESS_TOKEN, /^[A-Za-z0-9_-]+$/);
  assert.equal(status.tunnel.mode, 'quick');
  assert.match(status.tunnel.publicUrl, /^https:\/\/sample\.trycloudflare\.com\/mcp\/[A-Za-z0-9_-]+$/);
  assert.equal(status.connectorUrl, status.chatGptAccess.url);
  assert.equal(status.securityState, 'ChatGPT ready');
});

test('status marks tunnel without MCP server as misconfigured', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  mockFetchOk();
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 0) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await manager.startQuickTunnel(ctx);
  spawnCalls[1].child.exitCode = 1;
  spawnCalls[1].child.emit('exit', 1, null);

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
    if (index === 0 || index === 2) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from(`https://sample-${index}.trycloudflare.com`));
      });
    }
  });

  await manager.startQuickTunnel(ctx);
  spawnCalls[1].child.exitCode = 1;
  spawnCalls[1].child.emit('exit', 1, null);
  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 4);
  assert.equal(spawnCalls[0].child.killed, true);
  assert.equal(status.securityState, 'ChatGPT ready');
  assert.match(status.connectorUrl, /^https:\/\/sample-2\.trycloudflare\.com\/mcp\/[A-Za-z0-9_-]+$/);
});

test('startQuickTunnel stops quick tunnel when MCP readiness fails', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, { cloudflaredPath: makeCloudflared(ctx) });
  const spawnCalls = [];
  global.fetch = async () => {
    throw new Error('connection refused');
  };
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 0) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('https://sample.trycloudflare.com'));
      });
    }
  });

  await assert.rejects(
    () => manager.startQuickTunnel({ ...ctx, timeoutMs: 10 }),
    /Timed out waiting for Local Repo MCP to become ready/,
  );

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[0].child.killed, true);
  assert.equal(spawnCalls[1].child.killed, true);
  assert.equal(manager.getStatus(ctx).tunnel.running, false);
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
  mockFetchOk();
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
