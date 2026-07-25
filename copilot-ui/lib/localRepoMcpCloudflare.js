'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

class CloudflareConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CloudflareConfigError';
    this.code = code;
    this.statusCode = 400;
  }
}

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConfiguredPath(value) {
  const input = normalize(value);
  if (!input) return '';
  return path.resolve(input);
}

function inspectCloudflaredVersion(cloudflaredPath, exec = execFileSync) {
  try {
    const output = exec(cloudflaredPath, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    const match = String(output).match(/cloudflared version\s+([^\s]+)/i);
    return { ok: true, version: match?.[1] || String(output).trim() };
  } catch (error) {
    throw new CloudflareConfigError(
      'cloudflared_version_failed',
      `Unable to execute cloudflared: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function listNamedTunnels(cloudflaredPath, exec = execFileSync) {
  try {
    const output = exec(cloudflaredPath, ['tunnel', 'list', '--output', 'json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const parsed = JSON.parse(String(output || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new CloudflareConfigError(
      'cloudflare_tunnel_list_failed',
      `Unable to list Cloudflare tunnels. Confirm cloudflared is logged in: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function findNamedTunnel(tunnels, nameOrId) {
  const expected = normalize(nameOrId).toLowerCase();
  return tunnels.find((entry) =>
    normalize(entry?.name).toLowerCase() === expected
    || normalize(entry?.id).toLowerCase() === expected
  ) || null;
}

function validateIngress(config, expectedHostname, expectedService) {
  const ingress = Array.isArray(config?.ingress) ? config.ingress : [];
  if (ingress.length < 2) {
    throw new CloudflareConfigError('cloudflare_ingress_missing', 'Cloudflare config must include a hostname ingress rule and a final catch-all rule.');
  }
  const hostnameRule = ingress.find((rule) => normalize(rule?.hostname).toLowerCase() === expectedHostname.toLowerCase());
  if (!hostnameRule) {
    throw new CloudflareConfigError('cloudflare_hostname_mismatch', `Cloudflare config does not contain an ingress rule for ${expectedHostname}.`);
  }
  if (normalize(hostnameRule.service).replace(/\/+$/, '') !== expectedService) {
    throw new CloudflareConfigError('cloudflare_service_mismatch', `Cloudflare ingress for ${expectedHostname} must route to ${expectedService}.`);
  }
  const catchAll = ingress[ingress.length - 1];
  if (normalize(catchAll?.hostname) || !/^http_status:\d{3}$/i.test(normalize(catchAll?.service))) {
    throw new CloudflareConfigError('cloudflare_catch_all_missing', 'Cloudflare config must end with a catch-all http_status rule.');
  }
  return { hostnameRule, catchAll };
}

function inspectNamedTunnelConfiguration(config, cloudflaredPath, options = {}) {
  const stable = config.stableTunnel || {};
  const publicOrigin = normalize(stable.publicOrigin || config.publicBaseUrl).replace(/\/+$/, '');
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new CloudflareConfigError('stable_origin_invalid', 'Persistent access requires a valid HTTPS public origin.');
  }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new CloudflareConfigError('stable_origin_invalid', 'Persistent access public origin must be HTTPS without a path, query, or fragment.');
  }

  const tunnelName = normalize(stable.cloudflareTunnelName || config.cloudflareTunnelName);
  if (!tunnelName) throw new CloudflareConfigError('cloudflare_tunnel_missing', 'Cloudflare tunnel name or UUID is required.');
  const configPath = resolveConfiguredPath(stable.cloudflareConfigPath || config.cloudflareConfigPath);
  if (!configPath || !fs.existsSync(configPath)) {
    throw new CloudflareConfigError('cloudflare_config_missing', 'An existing Cloudflare config.yml is required for persistent access.');
  }

  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new CloudflareConfigError('cloudflare_config_invalid', `Unable to parse Cloudflare config: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new CloudflareConfigError('cloudflare_config_invalid', 'Cloudflare config must contain a YAML object.');
  }

  const configuredTunnel = normalize(parsed.tunnel);
  if (!configuredTunnel) throw new CloudflareConfigError('cloudflare_tunnel_id_missing', 'Cloudflare config must declare its tunnel UUID or name.');
  const expectedService = `http://127.0.0.1:${config.port}`;
  validateIngress(parsed, origin.hostname, expectedService);

  const credentialsPath = resolveConfiguredPath(stable.cloudflareCredentialsPath || parsed['credentials-file']);
  if (!credentialsPath || !fs.existsSync(credentialsPath)) {
    throw new CloudflareConfigError('cloudflare_credentials_missing', 'Cloudflare tunnel credentials file is missing.');
  }

  const version = inspectCloudflaredVersion(cloudflaredPath, options.exec);
  const tunnels = listNamedTunnels(cloudflaredPath, options.exec);
  const tunnel = findNamedTunnel(tunnels, tunnelName) || findNamedTunnel(tunnels, configuredTunnel);
  if (!tunnel) {
    throw new CloudflareConfigError('cloudflare_tunnel_not_found', `Cloudflare tunnel "${tunnelName}" was not found in the logged-in account.`);
  }
  if (configuredTunnel.toLowerCase() !== normalize(tunnel.id).toLowerCase()
      && configuredTunnel.toLowerCase() !== normalize(tunnel.name).toLowerCase()) {
    throw new CloudflareConfigError('cloudflare_tunnel_mismatch', 'Cloudflare config tunnel identity does not match the selected tunnel.');
  }

  return {
    ok: true,
    version: version.version,
    tunnel: { id: normalize(tunnel.id), name: normalize(tunnel.name) },
    hostname: origin.hostname,
    publicOrigin: origin.origin,
    canonicalResource: `${origin.origin}/mcp`,
    configPath,
    credentialsPath,
    service: expectedService,
  };
}

module.exports = {
  CloudflareConfigError,
  findNamedTunnel,
  inspectCloudflaredVersion,
  inspectNamedTunnelConfiguration,
  listNamedTunnels,
  validateIngress,
};
