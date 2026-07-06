'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { register } = require('./localRepoMcp');

function createResponse() {
  const state = { statusCode: null, chunks: [] };
  return {
    get statusCode() { return state.statusCode; },
    get bodyText() { return state.chunks.join(''); },
    writeHead(statusCode) { state.statusCode = statusCode; },
    end(chunk) { if (chunk != null) state.chunks.push(String(chunk)); },
  };
}

function findRoute(routes, method, pathname) {
  const route = routes.find((candidate) => candidate.method === method && candidate.path === pathname);
  if (!route) throw new Error(`Route not found: ${method} ${pathname}`);
  return route;
}

async function invoke(routes, method, pathname, body = null) {
  const route = findRoute(routes, method, pathname);
  const res = createResponse();
  await route.handler({
    req: {},
    res,
    u: new URL(`http://127.0.0.1${pathname}`),
    elegyHomeAbs: 'C:\\Users\\test\\.elegy',
    engineRoot: 'C:\\repo\\instruction-engine',
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.bodyText || '{}'), requestBody: body };
}

function makeDeps(body) {
  const state = {
    started: false,
    tunnelStarted: false,
    config: {
      publicBaseUrl: 'https://mcp.example.com',
      authIssuer: 'https://auth.example.com/',
      authAudience: 'https://mcp.example.com',
      requiredScopes: ['repo:read'],
      cloudflareTunnelName: 'local-mcp',
    },
    access: { repos: [] },
  };
  const status = () => ({
    config: state.config,
    connectorUrl: state.tunnelStarted ? 'https://mcp.example.com/mcp' : '',
    server: { running: state.started, pid: state.started ? 1 : null, url: 'http://127.0.0.1:3333/mcp' },
    tunnel: { running: state.tunnelStarted, pid: state.tunnelStarted ? 2 : null, mode: state.tunnelStarted ? 'quick' : 'none', publicUrl: state.tunnelStarted ? 'https://mcp.example.com/mcp' : '' },
    securityState: state.started && state.tunnelStarted ? 'OAuth protected' : 'Stopped',
  });
  return {
    readJsonBody: async () => body || {},
    manager: {
      getStatus: status,
      loadConfig: () => state.config,
      saveConfig: (_ctx) => state.config,
      startServer: () => { state.started = true; return status(); },
      stopServer: async () => { state.started = false; return status(); },
      startTunnel: () => { state.tunnelStarted = true; return status(); },
      startQuickTunnel: async () => { state.started = true; state.tunnelStarted = true; return status(); },
      stopTunnel: async () => { state.tunnelStarted = false; return status(); },
      probe: async () => ({ ...status(), probe: { ok: true } }),
    },
    access: {
      listAccess: () => state.access,
      enableRepo: (request) => {
        state.access.repos.push({ repoId: request.repoId, root: request.repoPath });
        return { enabled: true, access: state.access };
      },
      disableRepo: () => ({ disabled: true, access: state.access }),
    },
    repoInventory: {
      listKnownRepos: () => ({
        repos: [{
          repoId: 'instruction-engine',
          repoPath: 'C:\\repo\\instruction-engine',
          repoLabel: 'instruction-engine',
          registered: true,
        }],
      }),
      resolveRepoEntry: (inventory, selector) => inventory.repos.find((repo) =>
        repo.repoId === selector.repoId || repo.repoPath === selector.repoPath
      ) || null,
    },
  };
}

test('register exposes local repo MCP routes', () => {
  const routes = register(makeDeps());
  assert.ok(routes.some((route) => route.method === 'GET' && route.path === '/api/local-repo-mcp/status'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/roots/add'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/start'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/quick/start'));
});

test('start and stop are idempotent through manager state', async () => {
  const routes = register(makeDeps());
  const start = await invoke(routes, 'POST', '/api/local-repo-mcp/start');
  assert.equal(start.statusCode, 200);
  assert.equal(start.body.server.running, true);
  const stop = await invoke(routes, 'POST', '/api/local-repo-mcp/stop');
  assert.equal(stop.statusCode, 200);
  assert.equal(stop.body.server.running, false);
});

test('roots/add accepts registered repos', async () => {
  const routes = register(makeDeps({ repoId: 'instruction-engine' }));
  const result = await invoke(routes, 'POST', '/api/local-repo-mcp/roots/add');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.enabled, true);
});

test('roots/add rejects unregistered repos', async () => {
  const deps = makeDeps({ repoId: 'missing' });
  deps.repoInventory.resolveRepoEntry = () => null;
  const routes = register(deps);
  const result = await invoke(routes, 'POST', '/api/local-repo-mcp/roots/add');
  assert.equal(result.statusCode, 404);
});

test('quick tunnel route starts ChatGPT access', async () => {
  const routes = register(makeDeps());
  const result = await invoke(routes, 'POST', '/api/local-repo-mcp/tunnel/quick/start');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.server.running, true);
  assert.equal(result.body.tunnel.running, true);
  assert.equal(result.body.tunnel.mode, 'quick');
  assert.equal(result.body.connectorUrl, 'https://mcp.example.com/mcp');
});

test('quick tunnel route propagates OAuth config errors', async () => {
  const deps = makeDeps();
  deps.manager.startQuickTunnel = async () => {
    throw Object.assign(new Error('OAuth issuer is required before exposing Local Repo Reader to ChatGPT.'), { statusCode: 400 });
  };
  const routes = register(deps);
  const result = await invoke(routes, 'POST', '/api/local-repo-mcp/tunnel/quick/start');
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.error, 'OAuth issuer is required before exposing Local Repo Reader to ChatGPT.');
});
