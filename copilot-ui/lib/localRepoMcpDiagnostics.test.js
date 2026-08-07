'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildRepairOptions,
  createRedactedDiagnosticExport,
  runPersistentDiagnostics,
} = require('./localRepoMcpDiagnostics');

const config = {
  port: 3333,
  stableTunnel: {
    configured: true,
    publicOrigin: 'https://mcp-reader.example.com',
    canonicalResource: 'https://mcp-reader.example.com/mcp',
    hostname: 'mcp-reader.example.com',
    cloudflareTunnelName: 'elegy-local-repo-mcp',
    cloudflareTunnelId: '11111111-2222-3333-4444-555555555555',
    cloudflareConfigPath: 'C:\\Users\\test\\.cloudflared\\elegy-local-repo-mcp.yml',
    cloudflareCredentialsPath: 'C:\\Users\\test\\.cloudflared\\11111111-2222-3333-4444-555555555555.json',
    managementMode: 'managed',
    setupVersion: 1,
    autoStart: true,
  },
};

test('persistent diagnostics report local, DNS, TLS, edge, OAuth metadata, and full-flow layers', async () => {
  const report = await runPersistentDiagnostics({
    config,
    status: {
      server: { running: true },
      tunnel: { running: true, mode: 'named' },
      lifecycle: { code: 'running', blocked: false, recovering: false },
    },
    validateConfiguration: () => ({ version: '2026.6.1' }),
    resolveDns: async () => [{ address: '203.0.113.10', family: 4 }],
    fetch: async (url, init = {}) => {
      const target = String(url);
      if (target.endsWith('/.well-known/oauth-protected-resource')) {
        return response(200, {
          resource: config.stableTunnel.canonicalResource,
          authorization_servers: [config.stableTunnel.publicOrigin],
        });
      }
      if (target.endsWith('/.well-known/oauth-authorization-server')) {
        return response(200, {
          authorization_endpoint: `${config.stableTunnel.publicOrigin}/authorize`,
          token_endpoint: `${config.stableTunnel.publicOrigin}/token`,
          registration_endpoint: `${config.stableTunnel.publicOrigin}/register`,
          revocation_endpoint: `${config.stableTunnel.publicOrigin}/revoke`,
        });
      }
      if (target.endsWith('/mcp') && init.method === 'POST') {
        return response(401, {}, { 'www-authenticate': 'Bearer resource_metadata="metadata"' });
      }
      return response(404, {});
    },
    probeOAuthFlow: async () => ({ ok: true, code: 'oauth_flow_ok', tools: ['repo_roots'] }),
    now: () => new Date('2026-07-25T12:00:00.000Z'),
  });

  assert.equal(report.overall, 'pass');
  assert.equal(report.checks.length, 6);
  assert.deepEqual(report.checks.map((check) => check.layer), [
    'local',
    'dns',
    'tls',
    'cloudflare_edge',
    'oauth_metadata',
    'oauth_full_flow',
  ]);
  assert.equal(report.checks.every((check) => check.status === 'pass'), true);
  assert.equal(report.repairs.length, 0);
});

test('persistent diagnostics return stable blocker codes and safe repair options', async () => {
  const report = await runPersistentDiagnostics({
    config,
    status: {
      server: { running: true },
      tunnel: { running: true, mode: 'named' },
      lifecycle: { code: 'running', blocked: false, recovering: false },
    },
    validateConfiguration: () => {
      throw Object.assign(new Error(`Missing ${config.stableTunnel.cloudflareCredentialsPath}`), {
        code: 'cloudflare_credentials_missing',
      });
    },
    resolveDns: async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND mcp-reader.example.com'), { code: 'ENOTFOUND' });
    },
    fetch: async () => {
      throw new Error('fetch failed for https://mcp-reader.example.com');
    },
    probeOAuthFlow: async () => ({ ok: false, code: 'authorization_server_metadata_invalid' }),
  });

  assert.equal(report.overall, 'blocked');
  assert.equal(report.checks[0].code, 'cloudflare_credentials_missing');
  assert.equal(report.checks[1].code, 'dns_lookup_failed');
  assert.equal(report.checks[2].code, 'tls_connection_failed');
  assert.equal(report.checks[3].code, 'cloudflare_edge_unreachable');
  assert.equal(report.checks[4].code, 'oauth_metadata_unreachable');
  assert.equal(report.checks[5].code, 'authorization_server_metadata_invalid');
  assert.deepEqual(
    report.repairs.map((repair) => repair.id),
    ['repair_credentials_path', 'repair_dns_route', 'repair_restart_and_probe'],
  );
  assert.equal(report.repairs.every((repair) => repair.requiresConfirmation), true);
});

test('diagnostic export allowlists fields and redacts hostnames, UUIDs, paths, JWTs, and bearer tokens', () => {
  const report = {
    schemaVersion: 1,
    generatedAt: '2026-07-25T12:00:00.000Z',
    overall: 'blocked',
    checks: [{
      id: 'oauth',
      layer: 'oauth_full_flow',
      status: 'blocked',
      code: 'token_exchange_failed',
      message: `Bearer secret-token at ${config.stableTunnel.publicOrigin} ${config.stableTunnel.cloudflareTunnelId} C:\\Users\\test\\.cloudflared\\secret.json eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature`,
      details: { accessToken: 'must-not-export' },
    }],
    repairs: [{ id: 'repair_restart_and_probe', label: 'Restart', command: 'must-not-export' }],
  };

  const exported = createRedactedDiagnosticExport(report, config);
  const serialized = JSON.stringify(exported);

  assert.equal(exported.checks[0].details, undefined);
  assert.equal(exported.repairs[0].command, undefined);
  assert.doesNotMatch(serialized, /mcp-reader\.example\.com/);
  assert.doesNotMatch(serialized, /11111111-2222-3333-4444-555555555555/);
  assert.doesNotMatch(serialized, /secret-token/);
  assert.doesNotMatch(serialized, /eyJhbGci/);
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\test/);
  assert.match(serialized, /\[redacted/);
});

test('repair option mapping covers every supported persistent blocker without destructive actions', () => {
  const repairs = buildRepairOptions([
    { code: 'dns_lookup_failed' },
    { code: 'cloudflare_service_mismatch' },
    { code: 'cloudflare_credentials_missing' },
    { code: 'approval_secret_mismatch' },
    { code: 'oauth_metadata_unreachable' },
  ]);

  assert.deepEqual(repairs.map((repair) => repair.id), [
    'repair_dns_route',
    'repair_managed_config',
    'repair_credentials_path',
    'repair_approval_secret',
    'repair_restart_and_probe',
  ]);
  assert.equal(repairs.some((repair) => /delete|remove/i.test(`${repair.id} ${repair.label}`)), false);
});

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name).toLowerCase()] || null;
      },
    },
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  };
}
