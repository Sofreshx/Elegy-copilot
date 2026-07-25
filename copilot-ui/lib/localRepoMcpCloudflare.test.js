'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  CloudflareConfigError,
  inspectNamedTunnelConfiguration,
  validateIngress,
} = require('./localRepoMcpCloudflare');

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-repo-mcp-cloudflare-'));
  const credentialsPath = path.join(root, 'tunnel.json');
  const configPath = path.join(root, 'config.yml');
  fs.writeFileSync(credentialsPath, '{}', 'utf8');
  fs.writeFileSync(configPath, [
    'tunnel: tunnel-id',
    `credentials-file: ${JSON.stringify(credentialsPath)}`,
    'ingress:',
    '  - hostname: repo-mcp.example.com',
    '    service: http://127.0.0.1:3333',
    '  - service: http_status:404',
    '',
  ].join('\n'), 'utf8');
  return {
    config: {
      port: 3333,
      publicBaseUrl: 'https://repo-mcp.example.com',
      cloudflareTunnelName: 'local-repo-mcp',
      cloudflareConfigPath: configPath,
      stableTunnel: {
        publicOrigin: 'https://repo-mcp.example.com',
        cloudflareTunnelName: 'local-repo-mcp',
        cloudflareConfigPath: configPath,
        cloudflareCredentialsPath: credentialsPath,
      },
      ...overrides,
    },
    exec: (_command, args) => args[0] === '--version'
      ? 'cloudflared version 2026.7.0'
      : JSON.stringify([{ id: 'tunnel-id', name: 'local-repo-mcp' }]),
  };
}

test('validates a matching named tunnel, credentials, and ingress configuration', () => {
  const ctx = fixture();
  const result = inspectNamedTunnelConfiguration(ctx.config, 'cloudflared', { exec: ctx.exec });
  assert.equal(result.ok, true);
  assert.equal(result.tunnel.id, 'tunnel-id');
  assert.equal(result.hostname, 'repo-mcp.example.com');
  assert.equal(result.canonicalResource, 'https://repo-mcp.example.com/mcp');
});

test('rejects a named tunnel config routed to the wrong local port', () => {
  assert.throws(
    () => validateIngress({
      ingress: [
        { hostname: 'repo-mcp.example.com', service: 'http://127.0.0.1:9999' },
        { service: 'http_status:404' },
      ],
    }, 'repo-mcp.example.com', 'http://127.0.0.1:3333'),
    (error) => error instanceof CloudflareConfigError && error.code === 'cloudflare_service_mismatch',
  );
});

test('rejects a config without a final catch-all rule', () => {
  assert.throws(
    () => validateIngress({
      ingress: [
        { hostname: 'repo-mcp.example.com', service: 'http://127.0.0.1:3333' },
        { hostname: 'other.example.com', service: 'http://127.0.0.1:4444' },
      ],
    }, 'repo-mcp.example.com', 'http://127.0.0.1:3333'),
    (error) => error instanceof CloudflareConfigError && error.code === 'cloudflare_catch_all_missing',
  );
});
