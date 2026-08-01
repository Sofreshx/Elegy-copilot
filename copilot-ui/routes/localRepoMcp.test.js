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
      validateStableConfiguration: () => ({ ...status(), validation: { ok: true, mode: 'stable' } }),
      previewManagedTunnelProvisioning: (_ctx) => ({
        previewId: 'preview-1',
        hostname: 'mcp-reader.example.com',
        operations: [{ kind: 'command', command: 'cloudflared', args: ['tunnel', 'create', 'elegy-local-repo-mcp'] }],
      }),
      confirmManagedTunnelProvisioning: (_ctx) => ({
        provisioning: { status: 'completed' },
        config: state.config,
      }),
      cancelManagedTunnelProvisioning: (_ctx) => ({ cancelled: true, previewId: 'preview-1' }),
      getCloudflareLoginStatus: () => ({ cloudflareLogin: { available: true, running: false, loggedIn: false } }),
      startCloudflareLogin: () => ({ cloudflareLogin: { available: true, running: true, loggedIn: false, pid: 42 } }),
      runDiagnostics: async () => ({
        schemaVersion: 1,
        overall: 'blocked',
        checks: [{ id: 'dns', layer: 'dns', status: 'blocked', code: 'dns_lookup_failed' }],
        repairs: [{ id: 'repair_dns_route', requiresConfirmation: true }],
      }),
      exportDiagnostics: async () => ({
        schemaVersion: 1,
        overall: 'blocked',
        checks: [{ id: 'dns', layer: 'dns', status: 'blocked', code: 'dns_lookup_failed' }],
        repairs: [{ id: 'repair_dns_route', requiresConfirmation: true }],
      }),
      previewDiagnosticRepair: (_ctx) => ({
        previewId: 'repair-preview-1',
        repairId: 'repair_dns_route',
        operations: [{ kind: 'command', command: 'cloudflared', args: ['tunnel', 'route', 'dns'] }],
      }),
      confirmDiagnosticRepair: async (_ctx) => ({
        repair: { id: 'repair_dns_route', status: 'completed' },
      }),
      cancelDiagnosticRepair: (_ctx) => ({
        cancelled: true,
        previewId: 'repair-preview-1',
        repairId: 'repair_dns_route',
      }),
      startQuickTunnel: async () => { state.started = true; state.tunnelStarted = true; return status(); },
      stopTunnel: async () => { state.tunnelStarted = false; return status(); },
      probe: async () => ({ ...status(), probe: { ok: true } }),
      getPendingAuthorizations: async () => ({ ...status(), pending: [{ id: 'auth-1', userCode: '123456' }] }),
      approveAuthorization: async (_ctx) => ({ ...status(), approval: { status: 'approved' } }),
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
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/validate'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/provision/preview'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/provision/confirm'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/provision/cancel'));
  assert.ok(routes.some((route) => route.method === 'GET' && route.path === '/api/local-repo-mcp/tunnel/stable/cloudflare-login'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/cloudflare-login'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/diagnostics/run'));
  assert.ok(routes.some((route) => route.method === 'GET' && route.path === '/api/local-repo-mcp/tunnel/stable/diagnostics/export'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/repair/preview'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/repair/confirm'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/stable/repair/cancel'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/tunnel/quick/start'));
  assert.ok(routes.some((route) => route.method === 'GET' && route.path === '/api/local-repo-mcp/oauth/pending'));
  assert.ok(routes.some((route) => route.method === 'POST' && route.path === '/api/local-repo-mcp/oauth/approve'));
});

test('Cloudflare login routes expose status separately from the user-triggered login action', async () => {
  const routes = register(makeDeps());
  const status = await invoke(routes, 'GET', '/api/local-repo-mcp/tunnel/stable/cloudflare-login');
  const started = await invoke(routes, 'POST', '/api/local-repo-mcp/tunnel/stable/cloudflare-login');

  assert.equal(status.body.cloudflareLogin.running, false);
  assert.equal(started.body.cloudflareLogin.running, true);
});

test('diagnostic and safe-repair routes keep inspection, preview, and confirmation separate', async () => {
  const diagnostics = await invoke(
    register(makeDeps()),
    'POST',
    '/api/local-repo-mcp/tunnel/stable/diagnostics/run',
  );
  assert.equal(diagnostics.statusCode, 200);
  assert.equal(diagnostics.body.checks[0].code, 'dns_lookup_failed');

  const exported = await invoke(
    register(makeDeps()),
    'GET',
    '/api/local-repo-mcp/tunnel/stable/diagnostics/export',
  );
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.body.schemaVersion, 1);

  const preview = await invoke(
    register(makeDeps({ repairId: 'repair_dns_route' })),
    'POST',
    '/api/local-repo-mcp/tunnel/stable/repair/preview',
  );
  assert.equal(preview.body.previewId, 'repair-preview-1');

  const confirmed = await invoke(
    register(makeDeps({ previewId: 'repair-preview-1' })),
    'POST',
    '/api/local-repo-mcp/tunnel/stable/repair/confirm',
  );
  assert.equal(confirmed.body.repair.status, 'completed');

  const cancelled = await invoke(
    register(makeDeps({ previewId: 'repair-preview-1' })),
    'POST',
    '/api/local-repo-mcp/tunnel/stable/repair/cancel',
  );
  assert.equal(cancelled.body.cancelled, true);
});

test('managed provisioning routes keep preview and confirmation separate', async () => {
  const previewRoutes = register(makeDeps({ zone: 'example.com' }));
  const preview = await invoke(previewRoutes, 'POST', '/api/local-repo-mcp/tunnel/stable/provision/preview');
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.previewId, 'preview-1');
  assert.equal(preview.body.hostname, 'mcp-reader.example.com');

  const confirmRoutes = register(makeDeps({ previewId: 'preview-1' }));
  const confirmed = await invoke(confirmRoutes, 'POST', '/api/local-repo-mcp/tunnel/stable/provision/confirm');
  assert.equal(confirmed.statusCode, 200);
  assert.equal(confirmed.body.provisioning.status, 'completed');

  const cancelRoutes = register(makeDeps({ previewId: 'preview-1' }));
  const cancelled = await invoke(cancelRoutes, 'POST', '/api/local-repo-mcp/tunnel/stable/provision/cancel');
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.body.cancelled, true);
});

test('managed provisioning errors expose stable blocker codes', async () => {
  const deps = makeDeps({ zone: 'bad zone' });
  deps.manager.previewManagedTunnelProvisioning = () => {
    throw Object.assign(new Error('Cloudflare zone is invalid.'), {
      statusCode: 400,
      code: 'cloudflare_zone_invalid',
      partial: { tunnelCreated: false },
    });
  };
  const routes = register(deps);

  const result = await invoke(routes, 'POST', '/api/local-repo-mcp/tunnel/stable/provision/preview');

  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'cloudflare_zone_invalid');
  assert.equal(result.body.error, 'Cloudflare zone is invalid.');
  assert.deepEqual(result.body.partial, { tunnelCreated: false });
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

test('OAuth pending and approval routes proxy manager state', async () => {
  const routes = register(makeDeps({ id: 'auth-1' }));
  const pending = await invoke(routes, 'GET', '/api/local-repo-mcp/oauth/pending');
  assert.equal(pending.statusCode, 200);
  assert.equal(pending.body.pending[0].userCode, '123456');

  const approval = await invoke(routes, 'POST', '/api/local-repo-mcp/oauth/approve');
  assert.equal(approval.statusCode, 200);
  assert.equal(approval.body.approval.status, 'approved');
});
