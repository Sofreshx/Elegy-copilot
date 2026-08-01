'use strict';

const fs = require('fs');
const os = require('os');
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

const MANAGED_TUNNEL_NAME = 'elegy-local-repo-mcp';
const MANAGED_CONFIG_FILENAME = 'elegy-local-repo-mcp.yml';

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveConfiguredPath(value) {
  const input = normalize(value);
  if (!input) return '';
  return path.resolve(input);
}

function normalizeZone(value) {
  const zone = normalize(value).toLowerCase().replace(/\.$/, '');
  if (
    zone.length > 253
    || !zone.includes('.')
    || zone.split('.').some((label) =>
      !label
      || label.length > 63
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    throw new CloudflareConfigError(
      'cloudflare_zone_invalid',
      'Cloudflare zone must be a valid DNS name such as example.com.',
    );
  }
  return zone;
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

function createManagedTunnelProvisioningPreview(options = {}) {
  const zone = normalizeZone(options.zone);
  const hostname = `mcp-reader.${zone}`;
  const tunnelName = MANAGED_TUNNEL_NAME;
  const cloudflaredPath = normalize(options.cloudflaredPath) || 'cloudflared';
  const configDir = path.resolve(options.configDir || path.join(os.homedir(), '.cloudflared'));
  const configPath = path.join(configDir, MANAGED_CONFIG_FILENAME);
  const previewId = normalize(options.previewId);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const port = Number.isInteger(options.port) && options.port > 0 ? options.port : 3333;
  if (!previewId) {
    throw new CloudflareConfigError('cloudflare_preview_id_missing', 'Provisioning preview identifier is required.');
  }
  const tunnels = listNamedTunnels(cloudflaredPath, options.exec);
  if (findNamedTunnel(tunnels, tunnelName)) {
    throw new CloudflareConfigError(
      'cloudflare_tunnel_name_conflict',
      `Cloudflare tunnel "${tunnelName}" already exists. Attach it as an existing tunnel or choose repair.`,
    );
  }
  if (fs.existsSync(configPath)) {
    throw new CloudflareConfigError(
      'cloudflare_config_conflict',
      `Managed Cloudflare config already exists at ${configPath}. Attach or repair it instead of overwriting it.`,
    );
  }
  return {
    previewId,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 10 * 60 * 1000).toISOString(),
    tunnelName,
    zone,
    hostname,
    publicOrigin: `https://${hostname}`,
    canonicalResource: `https://${hostname}/mcp`,
    cloudflaredPath,
    configDir,
    configPath,
    port,
    operations: [
      {
        kind: 'command',
        command: cloudflaredPath,
        args: ['tunnel', 'create', tunnelName],
        effect: 'Creates one locally managed Cloudflare tunnel and its tunnel-specific credentials file.',
      },
      {
        kind: 'command',
        command: cloudflaredPath,
        args: ['tunnel', 'route', 'dns', tunnelName, hostname],
        effect: `Creates the DNS route for ${hostname}.`,
      },
      {
        kind: 'write-config',
        path: configPath,
        effect: `Writes dedicated ingress configuration for http://127.0.0.1:${port}.`,
      },
    ],
  };
}

function writeManagedConfigAtomic(preview, tunnelId, credentialsPath) {
  const config = {
    tunnel: tunnelId,
    'credentials-file': credentialsPath,
    ingress: [
      {
        hostname: preview.hostname,
        service: `http://127.0.0.1:${preview.port}`,
      },
      { service: 'http_status:404' },
    ],
  };
  fs.mkdirSync(preview.configDir, { recursive: true });
  const tempPath = path.join(
    preview.configDir,
    `.${MANAGED_CONFIG_FILENAME}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(tempPath, yaml.dump(config, { noRefs: true, lineWidth: -1 }), {
    encoding: 'utf8',
    flag: 'wx',
  });
  try {
    if (fs.existsSync(preview.configPath)) {
      throw new CloudflareConfigError(
        'cloudflare_config_conflict',
        `Managed Cloudflare config appeared at ${preview.configPath}; it was not overwritten.`,
      );
    }
    fs.renameSync(tempPath, preview.configPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function executeManagedTunnelProvisioning(preview, options = {}) {
  const exec = options.exec || execFileSync;
  try {
    exec(preview.cloudflaredPath, ['tunnel', 'create', preview.tunnelName], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
  } catch {
    throw new CloudflareConfigError(
      'cloudflare_tunnel_create_failed',
      `Cloudflare could not create tunnel "${preview.tunnelName}". No DNS or config changes were attempted.`,
    );
  }
  const tunnels = listNamedTunnels(preview.cloudflaredPath, exec);
  const tunnel = findNamedTunnel(tunnels, preview.tunnelName);
  if (!tunnel) {
    throw new CloudflareConfigError(
      'cloudflare_tunnel_create_unverified',
      `Cloudflare reported tunnel creation, but "${preview.tunnelName}" could not be resolved. The resource was preserved for repair.`,
    );
  }
  const tunnelId = normalize(tunnel.id);
  const credentialsPath = path.join(preview.configDir, `${tunnelId}.json`);
  if (!fs.existsSync(credentialsPath)) {
    throw new CloudflareConfigError(
      'cloudflare_credentials_missing',
      `Tunnel "${preview.tunnelName}" was created but its credentials file is missing. The tunnel was preserved for repair.`,
    );
  }
  try {
    exec(preview.cloudflaredPath, ['tunnel', 'route', 'dns', preview.tunnelName, preview.hostname], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
  } catch {
    const error = new CloudflareConfigError(
      'cloudflare_dns_route_failed',
      `Tunnel "${preview.tunnelName}" was created, but DNS routing for ${preview.hostname} failed. The tunnel and credentials were preserved for repair.`,
    );
    error.partial = { tunnelCreated: true, tunnelId, credentialsPath };
    throw error;
  }
  try {
    writeManagedConfigAtomic(preview, tunnelId, credentialsPath);
  } catch (cause) {
    const error = cause instanceof CloudflareConfigError
      ? cause
      : new CloudflareConfigError(
        'cloudflare_config_write_failed',
        `Tunnel and DNS routing were created, but the managed config could not be written. Cloudflare resources were preserved for repair.`,
      );
    error.partial = {
      tunnelCreated: true,
      tunnelId,
      credentialsPath,
      dnsRouted: true,
      hostname: preview.hostname,
    };
    throw error;
  }
  return {
    status: 'completed',
    tunnel: { id: tunnelId, name: normalize(tunnel.name) || preview.tunnelName },
    hostname: preview.hostname,
    publicOrigin: preview.publicOrigin,
    canonicalResource: preview.canonicalResource,
    configPath: preview.configPath,
    credentialsPath,
  };
}

function repairManagedTunnelConfig(config) {
  const stable = config?.stableTunnel || {};
  if (stable.managementMode !== 'managed') {
    throw new CloudflareConfigError(
      'cloudflare_config_repair_unavailable',
      'Elegy can rewrite only its dedicated managed cloudflared config.',
    );
  }
  const configPath = resolveConfiguredPath(stable.cloudflareConfigPath);
  const credentialsPath = resolveConfiguredPath(stable.cloudflareCredentialsPath);
  const tunnelId = normalize(stable.cloudflareTunnelId);
  const hostname = normalize(stable.hostname);
  if (!configPath || !credentialsPath || !tunnelId || !hostname) {
    throw new CloudflareConfigError(
      'cloudflare_config_repair_incomplete',
      'Managed tunnel identity, hostname, config path, and credentials path are required for config repair.',
    );
  }
  if (!fs.existsSync(credentialsPath)) {
    throw new CloudflareConfigError(
      'cloudflare_credentials_missing',
      'The managed tunnel credentials file is missing; the config was not rewritten.',
    );
  }
  const preview = {
    configDir: path.dirname(configPath),
    configPath,
    hostname,
    port: config.port,
  };
  const backupBase = `${configPath}.repair-backup-${Date.now()}`;
  let backupPath = backupBase;
  let backupIndex = 1;
  while (fs.existsSync(backupPath)) {
    backupPath = `${backupBase}-${backupIndex}`;
    backupIndex += 1;
  }
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  }
  if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
  try {
    writeManagedConfigAtomic(preview, tunnelId, credentialsPath);
  } catch (error) {
    if (!fs.existsSync(configPath) && fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, configPath, fs.constants.COPYFILE_EXCL);
    }
    throw error;
  }
  return { configPath, backupPath: fs.existsSync(backupPath) ? backupPath : '' };
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
  createManagedTunnelProvisioningPreview,
  executeManagedTunnelProvisioning,
  findNamedTunnel,
  inspectCloudflaredVersion,
  inspectNamedTunnelConfiguration,
  listNamedTunnels,
  repairManagedTunnelConfig,
  validateIngress,
};
