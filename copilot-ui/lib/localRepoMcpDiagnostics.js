'use strict';

const dns = require('node:dns');

const REPAIR_DEFINITIONS = {
  repair_dns_route: {
    id: 'repair_dns_route',
    label: 'Repair Cloudflare DNS route',
    description: 'Recreates the managed hostname route for the existing tunnel.',
    requiresConfirmation: true,
  },
  repair_managed_config: {
    id: 'repair_managed_config',
    label: 'Repair managed ingress config',
    description: 'Rewrites only the dedicated Elegy cloudflared config with the persisted tunnel identity.',
    requiresConfirmation: true,
  },
  repair_credentials_path: {
    id: 'repair_credentials_path',
    label: 'Recover credentials path',
    description: 'Attaches the existing tunnel credentials file when it can be identified unambiguously.',
    requiresConfirmation: true,
  },
  repair_approval_secret: {
    id: 'repair_approval_secret',
    label: 'Rotate approval channel secret',
    description: 'Rotates the local approval secret and restarts the owned OAuth server.',
    requiresConfirmation: true,
  },
  repair_restart_and_probe: {
    id: 'repair_restart_and_probe',
    label: 'Restart and retest OAuth',
    description: 'Restarts the owned persistent processes and reruns the public OAuth flow.',
    requiresConfirmation: true,
  },
};

const REPAIR_CODES = new Map([
  ['dns_lookup_failed', 'repair_dns_route'],
  ['cloudflare_dns_route_failed', 'repair_dns_route'],
  ['cloudflare_config_missing', 'repair_managed_config'],
  ['cloudflare_config_invalid', 'repair_managed_config'],
  ['cloudflare_ingress_missing', 'repair_managed_config'],
  ['cloudflare_hostname_mismatch', 'repair_managed_config'],
  ['cloudflare_service_mismatch', 'repair_managed_config'],
  ['cloudflare_catch_all_missing', 'repair_managed_config'],
  ['cloudflare_tunnel_id_missing', 'repair_managed_config'],
  ['cloudflare_tunnel_mismatch', 'repair_managed_config'],
  ['cloudflare_credentials_missing', 'repair_credentials_path'],
  ['approval_secret_mismatch', 'repair_approval_secret'],
  ['tls_connection_failed', 'repair_restart_and_probe'],
  ['cloudflare_edge_unreachable', 'repair_restart_and_probe'],
  ['oauth_metadata_unreachable', 'repair_restart_and_probe'],
  ['protected_resource_metadata_invalid', 'repair_restart_and_probe'],
  ['authorization_server_missing', 'repair_restart_and_probe'],
  ['authorization_server_metadata_invalid', 'repair_restart_and_probe'],
  ['oauth_challenge_missing', 'repair_restart_and_probe'],
  ['client_registration_failed', 'repair_restart_and_probe'],
  ['authorization_request_failed', 'repair_restart_and_probe'],
  ['authorization_pending_missing', 'repair_restart_and_probe'],
  ['authorization_approval_failed', 'repair_restart_and_probe'],
  ['token_exchange_failed', 'repair_restart_and_probe'],
  ['refresh_exchange_failed', 'repair_restart_and_probe'],
  ['authenticated_mcp_failed', 'repair_restart_and_probe'],
  ['oauth_flow_error', 'repair_restart_and_probe'],
]);

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function diagnosticCheck(id, layer, status, code, message, details) {
  return {
    id,
    layer,
    status,
    code,
    message,
    ...(details && typeof details === 'object' ? { details } : {}),
  };
}

function readJsonResponse(response) {
  return response.text()
    .then((text) => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

async function runPersistentDiagnostics(options = {}) {
  const config = options.config || {};
  const stable = config.stableTunnel || {};
  const publicOrigin = normalize(stable.publicOrigin || config.publicBaseUrl).replace(/\/+$/, '');
  const hostname = normalize(stable.hostname) || (() => {
    try { return new URL(publicOrigin).hostname; } catch { return ''; }
  })();
  const canonicalResource = normalize(stable.canonicalResource) || (publicOrigin ? `${publicOrigin}/mcp` : '');
  const status = options.status || {};
  const resolveDns = options.resolveDns || ((host) => dns.promises.lookup(host, { all: true }));
  const fetchImpl = options.fetch || global.fetch;
  const checks = [];

  try {
    const validation = await options.validateConfiguration();
    const processesReady = Boolean(status.server?.running && status.tunnel?.running && status.tunnel?.mode === 'named');
    checks.push(diagnosticCheck(
      'local_configuration',
      'local',
      processesReady ? 'pass' : 'blocked',
      processesReady ? 'local_ready' : 'local_processes_offline',
      processesReady
        ? 'Managed configuration and owned persistent processes are ready.'
        : 'Managed configuration is valid, but the persistent server or tunnel is offline.',
      { cloudflaredVersion: validation?.version || '' },
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'local_configuration',
      'local',
      'blocked',
      normalize(error?.code) || 'local_configuration_invalid',
      error instanceof Error ? error.message : String(error),
    ));
  }

  try {
    const addresses = hostname ? await resolveDns(hostname) : [];
    if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('No DNS addresses returned.');
    checks.push(diagnosticCheck(
      'dns_resolution',
      'dns',
      'pass',
      'dns_resolved',
      'The persistent hostname resolves publicly.',
      { addressFamilies: [...new Set(addresses.map((entry) => entry.family).filter(Boolean))] },
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'dns_resolution',
      'dns',
      'blocked',
      'dns_lookup_failed',
      error instanceof Error ? error.message : String(error),
    ));
  }

  try {
    if (!publicOrigin) throw new Error('Persistent public origin is missing.');
    const tlsResponse = await fetchImpl(publicOrigin, { method: 'HEAD', redirect: 'manual' });
    checks.push(diagnosticCheck(
      'tls_connection',
      'tls',
      'pass',
      'tls_connection_ok',
      `Public TLS negotiation completed with HTTP ${tlsResponse.status}.`,
      { status: tlsResponse.status },
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'tls_connection',
      'tls',
      'blocked',
      'tls_connection_failed',
      error instanceof Error ? error.message : String(error),
    ));
  }

  let protectedMetadata = null;
  let protectedResponse = null;
  try {
    if (!publicOrigin) throw new Error('Persistent public origin is missing.');
    protectedResponse = await fetchImpl(`${publicOrigin}/.well-known/oauth-protected-resource`);
    protectedMetadata = await readJsonResponse(protectedResponse);
    if (!protectedResponse.ok) throw new Error(`Cloudflare edge returned HTTP ${protectedResponse.status}.`);
    checks.push(diagnosticCheck(
      'cloudflare_edge',
      'cloudflare_edge',
      'pass',
      'cloudflare_edge_reachable',
      'Cloudflare edge reaches the persistent OAuth endpoint.',
      { status: protectedResponse.status },
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'cloudflare_edge',
      'cloudflare_edge',
      'blocked',
      'cloudflare_edge_unreachable',
      error instanceof Error ? error.message : String(error),
    ));
  }

  try {
    if (!protectedResponse?.ok || protectedMetadata?.resource !== canonicalResource) {
      throw Object.assign(
        new Error('Protected Resource Metadata does not advertise the canonical MCP resource.'),
        { code: protectedResponse ? 'protected_resource_metadata_invalid' : 'oauth_metadata_unreachable' },
      );
    }
    const authorizationServer = protectedMetadata?.authorization_servers?.[0];
    if (!authorizationServer) {
      throw Object.assign(new Error('Protected Resource Metadata has no authorization server.'), {
        code: 'authorization_server_missing',
      });
    }
    const metadataResponse = await fetchImpl(
      `${normalize(authorizationServer).replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
    );
    const metadata = await readJsonResponse(metadataResponse);
    if (
      !metadataResponse.ok
      || !metadata?.authorization_endpoint
      || !metadata?.token_endpoint
      || !metadata?.registration_endpoint
      || !metadata?.revocation_endpoint
    ) {
      throw Object.assign(new Error('Authorization Server Metadata is incomplete.'), {
        code: 'authorization_server_metadata_invalid',
      });
    }
    checks.push(diagnosticCheck(
      'oauth_metadata',
      'oauth_metadata',
      'pass',
      'oauth_metadata_valid',
      'Protected Resource and Authorization Server metadata are valid.',
      { status: metadataResponse.status },
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'oauth_metadata',
      'oauth_metadata',
      'blocked',
      normalize(error?.code) || 'oauth_metadata_unreachable',
      error instanceof Error ? error.message : String(error),
    ));
  }

  try {
    const flow = await options.probeOAuthFlow();
    checks.push(diagnosticCheck(
      'oauth_full_flow',
      'oauth_full_flow',
      flow?.ok ? 'pass' : 'blocked',
      normalize(flow?.code) || (flow?.ok ? 'oauth_flow_ok' : 'oauth_flow_error'),
      normalize(flow?.message) || (flow?.ok
        ? 'OAuth authorization, refresh rotation, revocation, and authenticated MCP access succeeded.'
        : 'The full OAuth flow failed.'),
      flow?.tools ? { tools: flow.tools } : undefined,
    ));
  } catch (error) {
    checks.push(diagnosticCheck(
      'oauth_full_flow',
      'oauth_full_flow',
      'blocked',
      normalize(error?.code) || 'oauth_flow_error',
      error instanceof Error ? error.message : String(error),
    ));
  }

  const repairs = buildRepairOptions(checks);
  return {
    schemaVersion: 1,
    generatedAt: (options.now ? options.now() : new Date()).toISOString(),
    overall: checks.every((check) => check.status === 'pass') ? 'pass' : 'blocked',
    checks,
    repairs,
  };
}

function buildRepairOptions(checks = []) {
  const ids = [];
  for (const check of checks) {
    const repairId = REPAIR_CODES.get(normalize(check?.code));
    if (repairId && !ids.includes(repairId)) ids.push(repairId);
  }
  return ids.map((id) => ({ ...REPAIR_DEFINITIONS[id] }));
}

function redactText(value, config = {}) {
  const stable = config.stableTunnel || {};
  let text = String(value || '');
  const exactSecrets = [
    stable.publicOrigin,
    stable.canonicalResource,
    stable.hostname,
    stable.cloudflareTunnelId,
    stable.cloudflareConfigPath,
    stable.cloudflareCredentialsPath,
    config.publicBaseUrl,
    config.authIssuer,
    config.authAudience,
  ].map(normalize).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of exactSecrets) {
    text = text.split(secret).join('[redacted-config]');
  }
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-token]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-uuid]')
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)+[^\\\s]+/g, '[redacted-path]');
}

function createRedactedDiagnosticExport(report = {}, config = {}) {
  return {
    schemaVersion: 1,
    generatedAt: normalize(report.generatedAt),
    overall: normalize(report.overall),
    checks: Array.isArray(report.checks)
      ? report.checks.map((check) => ({
        id: normalize(check?.id),
        layer: normalize(check?.layer),
        status: normalize(check?.status),
        code: normalize(check?.code),
        message: redactText(check?.message, config),
      }))
      : [],
    repairs: Array.isArray(report.repairs)
      ? report.repairs.map((repair) => ({
        id: normalize(repair?.id),
        label: normalize(repair?.label),
        requiresConfirmation: repair?.requiresConfirmation === true,
      }))
      : [],
  };
}

module.exports = {
  buildRepairOptions,
  createRedactedDiagnosticExport,
  runPersistentDiagnostics,
};
