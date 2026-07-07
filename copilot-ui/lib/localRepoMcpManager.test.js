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

test('startQuickTunnel with blank OAuth config generates built-in OAuth settings', async () => {
  const ctx = makeContext();
  const spawnCalls = [];
  const manager = loadManager(spawnCalls, (_args, child, index) => {
    if (index === 0) {
      process.nextTick(() => {
        child.stderr.emit('data', Buffer.from('Your quick Tunnel has been created! https://sample.trycloudflare.com'));
      });
    }
  });

  const status = await manager.startQuickTunnel(ctx);

  assert.equal(spawnCalls.length, 2);
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_PROVIDER, 'builtin');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_ISSUER, 'https://sample.trycloudflare.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_AUDIENCE, 'https://sample.trycloudflare.com');
  assert.equal(status.securityState, 'OAuth protected');
  assert.equal(status.prerequisites.oauth.provider, 'builtin');
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

test('startQuickTunnel parses generated URL and starts OAuth MCP server', async () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, {
    authIssuer: 'https://tenant.example.com/',
    cloudflaredPath: makeCloudflared(ctx),
  });
  const spawnCalls = [];
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
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_AUDIENCE, 'https://sample.trycloudflare.com');
  assert.equal(spawnCalls[1].args[2].env.LOCAL_REPO_MCP_AUTH_MODE, 'oauth');
  assert.equal(status.tunnel.mode, 'quick');
  assert.equal(status.tunnel.publicUrl, 'https://sample.trycloudflare.com/mcp');
  assert.equal(status.connectorUrl, 'https://sample.trycloudflare.com/mcp');
  assert.equal(status.securityState, 'OAuth protected');
});

test('startTunnel keeps named tunnel status behavior', () => {
  const ctx = makeContext();
  writeConfig(ctx.elegyHomeAbs, {
    publicBaseUrl: 'https://mcp.example.com',
    authIssuer: 'https://tenant.example.com/',
    authAudience: 'https://mcp.example.com',
    cloudflareTunnelName: 'local-mcp',
    cloudflaredPath: makeCloudflared(ctx),
  });
  const spawnCalls = [];
  const manager = loadManager(spawnCalls);

  const status = manager.startTunnel(ctx);

  assert.equal(status.tunnel.running, true);
  assert.equal(status.tunnel.mode, 'named');
  assert.equal(status.tunnel.publicUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.connectorUrl, 'https://mcp.example.com/mcp');
  assert.equal(status.securityState, 'Local only');
});
