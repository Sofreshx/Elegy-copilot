'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const {
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE,
  toCanonicalMissingTokenError,
} = require('../sandboxLifecycleTokenContract');
const { buildPlanningPersistenceHealthEnvelope } = require('../planningApiContracts');

const LOCAL_TRACKER_SECRETS_MODULE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'local-tracker',
  'dist',
  'messagingGateway',
  'secrets.js'
);
const GATEWAY_HTTP_SECRET_KIND = 'gatewayHttpToken';
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION = '1';
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY = 'mixed-version-lifecycle-v1';
const LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION = 'x-instruction-engine-lifecycle-contract-version';
const LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY = 'x-instruction-engine-lifecycle-capability';
const TRACKER_PROXY_RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'content-type',
  'www-authenticate',
  'retry-after',
  'x-instruction-engine-lifecycle-contract-version',
  'x-instruction-engine-lifecycle-capability',
]);
const TRACKER_PROXY_RESPONSE_HEADER_MAP = Object.freeze({
  'content-type': 'Content-Type',
  'www-authenticate': 'WWW-Authenticate',
  'retry-after': 'Retry-After',
  'x-instruction-engine-lifecycle-contract-version': 'X-Instruction-Engine-Lifecycle-Contract-Version',
  'x-instruction-engine-lifecycle-capability': 'X-Instruction-Engine-Lifecycle-Capability',
});

function resolveTrackerUrl(args, env = process.env) {
  if (args && typeof args.trackerUrl === 'string' && args.trackerUrl.trim()) return args.trackerUrl.trim();
  if (typeof env.INSTRUCTION_ENGINE_TRACKER_URL === 'string' && env.INSTRUCTION_ENGINE_TRACKER_URL.trim()) {
    return env.INSTRUCTION_ENGINE_TRACKER_URL.trim();
  }
  return 'http://127.0.0.1:4100';
}

async function resolveTrackerTokenFromGatewaySecrets(options = {}) {
  const fsModule = options.fsModule || fs;
  const requireFn = options.requireFn || require;
  const modulePath = options.gatewaySecretsModulePath || LOCAL_TRACKER_SECRETS_MODULE_PATH;

  try {
    if (!fsModule.existsSync(modulePath)) {
      return null;
    }
  } catch {
    return null;
  }

  let secretsModule;
  try {
    secretsModule = requireFn(modulePath);
  } catch {
    return null;
  }

  if (!secretsModule || typeof secretsModule.getGatewaySecret !== 'function') {
    return null;
  }

  try {
    const secretResult = await secretsModule.getGatewaySecret(GATEWAY_HTTP_SECRET_KIND);
    const token = secretResult && typeof secretResult.value === 'string'
      ? secretResult.value.trim()
      : '';
    if (!token) {
      return null;
    }

    const source = secretResult && typeof secretResult.source === 'string'
      ? secretResult.source
      : 'keychain';

    return {
      value: token,
      source: source === 'env' ? 'env' : 'keychain',
    };
  } catch {
    return null;
  }
}

async function resolveTrackerToken(args, options = {}) {
  if (args && typeof args.trackerToken === 'string' && args.trackerToken.trim()) {
    return {
      value: args.trackerToken.trim(),
      source: 'arg',
    };
  }

  const env = options.env && typeof options.env === 'object' ? options.env : process.env;
  if (Object.prototype.hasOwnProperty.call(env, 'INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN')) {
    const envToken = typeof env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN === 'string'
      ? env.INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.trim()
      : '';
    if (!envToken) {
      return {
        value: null,
        source: 'missing',
      };
    }

    return {
      value: envToken,
      source: 'env',
    };
  }

  const fromGatewaySecrets = await resolveTrackerTokenFromGatewaySecrets({
    ...options,
    env,
  });
  if (fromGatewaySecrets) {
    return fromGatewaySecrets;
  }

  return {
    value: null,
    source: 'missing',
  };
}

function normalizeLifecycleCompatibilityToken(value) {
  if (Array.isArray(value)) {
    return normalizeLifecycleCompatibilityToken(value.length > 0 ? value[0] : '');
  }
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function readLifecycleCompatibilityHeaderToken(headers, headerName) {
  const source = headers && typeof headers === 'object' ? headers : {};
  const token = source[String(headerName || '').toLowerCase()];
  return normalizeLifecycleCompatibilityToken(token);
}

function createLifecycleCompatibilityRequestHeaders() {
  return {
    'X-Instruction-Engine-Lifecycle-Contract-Version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
    'X-Instruction-Engine-Lifecycle-Capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  };
}

function buildLifecycleMixedVersionUnsupportedMarker(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const directionToken = String(source.direction || '').trim().toLowerCase();
  const direction = directionToken === 'old_client_new_tracker'
    ? 'old_client_new_tracker'
    : 'new_client_old_tracker';

  return {
    error: 'Lifecycle compatibility unsupported',
    code: 'lifecycle_compatibility_unsupported',
    action: String(source.action || '').trim() || null,
    reason: String(source.reason || '').trim() || 'compatibility_check_failed',
    deterministic: true,
    unsupported: {
      marker: 'unsupported',
      direction,
      expected: {
        contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
        capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
      },
      received: {
        contractVersion: String(source.receivedContractVersion || '').trim() || null,
        capability: String(source.receivedCapability || '').trim() || null,
      },
    },
    compatibility: {
      contractVersion: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
      capability: LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
      direction,
    },
  };
}

function evaluateLifecycleMixedVersionCompatibility(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const directionToken = String(source.direction || '').trim().toLowerCase();
  const direction = directionToken === 'old_client_new_tracker'
    ? 'old_client_new_tracker'
    : 'new_client_old_tracker';
  const reasonPrefix = direction === 'old_client_new_tracker' ? 'client' : 'tracker';

  const receivedContractVersion = readLifecycleCompatibilityHeaderToken(
    source.headers,
    LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION
  );
  const receivedCapability = readLifecycleCompatibilityHeaderToken(
    source.headers,
    LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY
  );

  const expectedContractVersion = normalizeLifecycleCompatibilityToken(
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION
  );
  const expectedCapability = normalizeLifecycleCompatibilityToken(
    LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY
  );

  let reason = '';
  if (!receivedContractVersion) {
    reason = `${reasonPrefix}_contract_version_missing`;
  } else if (receivedContractVersion !== expectedContractVersion) {
    reason = `${reasonPrefix}_contract_version_unsupported`;
  } else if (!receivedCapability) {
    reason = `${reasonPrefix}_capability_missing`;
  } else if (receivedCapability !== expectedCapability) {
    reason = `${reasonPrefix}_capability_unsupported`;
  }

  if (!reason) {
    return {
      compatible: true,
      direction,
      reason: 'compatibility_supported',
      receivedContractVersion: receivedContractVersion || null,
      receivedCapability: receivedCapability || null,
    };
  }

  return {
    compatible: false,
    statusCode: 501,
    direction,
    reason,
    receivedContractVersion: receivedContractVersion || null,
    receivedCapability: receivedCapability || null,
    body: buildLifecycleMixedVersionUnsupportedMarker({
      action: source.action,
      direction,
      reason,
      receivedContractVersion,
      receivedCapability,
    }),
  };
}

function parseJsonBodySafe(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildGatewayProbeFailure(code, reason, message, statusCode = null) {
  return {
    deterministic: true,
    code: String(code || 'gateway_probe_failed'),
    reason: String(reason || 'gateway_probe_failed'),
    message: String(message || reason || code || 'gateway_probe_failed'),
    statusCode: Number.isFinite(statusCode) ? Number(statusCode) : null,
  };
}

async function probeTrackerReadiness(trackerUrl, trackerToken, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 5000;
  const httpModule = options.httpModule || http;
  const checkedAt = new Date().toISOString();

  if (!trackerToken) {
    const missingTokenError = toCanonicalMissingTokenError({
      status: SANDBOX_TOKEN_CANONICAL_STATE,
    });
    return {
      deterministic: true,
      checkedAt,
      ready: false,
      status: SANDBOX_TOKEN_CANONICAL_STATE,
      statusCode: null,
      error: buildGatewayProbeFailure(
        missingTokenError && typeof missingTokenError.legacyCode === 'string'
          ? missingTokenError.legacyCode
          : 'tracker_missing_token',
        missingTokenError && typeof missingTokenError.legacyReason === 'string'
          ? missingTokenError.legacyReason
          : SANDBOX_TOKEN_CANONICAL_STATE,
        missingTokenError && typeof missingTokenError.message === 'string'
          ? missingTokenError.message
          : 'Sandbox token missing',
      ),
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL('/api/status', trackerUrl);
  } catch {
    return {
      deterministic: true,
      checkedAt,
      ready: false,
      status: 'invalid_url',
      statusCode: null,
      error: buildGatewayProbeFailure(
        'tracker_url_invalid',
        'tracker_url_invalid',
        'Tracker URL is invalid',
      ),
    };
  }

  return new Promise((resolve) => {
    const request = httpModule.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${trackerToken}`,
        Accept: 'application/json',
      },
      timeout: timeoutMs,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = parseJsonBodySafe(raw);
        const statusCode = response.statusCode || null;

        if (statusCode && statusCode >= 200 && statusCode < 300) {
          resolve({
            deterministic: true,
            checkedAt,
            ready: true,
            status: 'ready',
            statusCode,
            body,
            error: null,
          });
          return;
        }

        const isAuthFailure = statusCode === 401 || statusCode === 403;
        const errorCode = isAuthFailure ? 'tracker_auth_failed' : 'tracker_status_unhealthy';
        const reason = isAuthFailure ? 'tracker_auth_failed' : 'tracker_status_unhealthy';
        const message = (body && typeof body.error === 'string' && body.error.trim())
          || raw.trim()
          || `Tracker returned status ${statusCode || 'unknown'}`;

        resolve({
          deterministic: true,
          checkedAt,
          ready: false,
          status: isAuthFailure ? 'auth_failed' : 'status_unhealthy',
          statusCode,
          body,
          error: buildGatewayProbeFailure(errorCode, reason, message, statusCode),
        });
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolve({
        deterministic: true,
        checkedAt,
        ready: false,
        status: 'timeout',
        statusCode: null,
        error: buildGatewayProbeFailure('tracker_timeout', 'tracker_request_timeout', 'Tracker request timed out'),
      });
    });

    request.on('error', (error) => {
      resolve({
        deterministic: true,
        checkedAt,
        ready: false,
        status: 'unreachable',
        statusCode: null,
        error: buildGatewayProbeFailure(
          'tracker_unreachable',
          'tracker_request_failed',
          String(error && error.message ? error.message : error),
        ),
      });
    });

    request.end();
  });
}

function buildGatewayStateEnvelope(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const configPath = String(source.configPath || '');
  const gatewayConfig = source.gatewayConfig && typeof source.gatewayConfig === 'object'
    ? source.gatewayConfig
    : null;
  const tracker = source.trackerProbe && typeof source.trackerProbe === 'object'
    ? source.trackerProbe
    : null;
  const planningPersistence = source.planningPersistence && typeof source.planningPersistence === 'object'
    ? source.planningPersistence
    : buildPlanningPersistenceHealthEnvelope({});

  const trackerReady = Boolean(tracker && tracker.ready === true);
  const trackerStatus = String(tracker && tracker.status || (trackerReady ? 'ready' : 'unavailable')).trim() || 'unavailable';
  const planningReady = String(planningPersistence.status || '') === 'ready';
  const planningRequired = Boolean(planningPersistence.required);
  const gatewayConfigured = Boolean(gatewayConfig);
  const gatewayReady = gatewayConfigured && trackerReady && (planningReady || !planningRequired);

  const normalizedConfig = gatewayConfig && typeof gatewayConfig === 'object' ? gatewayConfig : {};
  const workspaceConfig = normalizedConfig.workspaces && typeof normalizedConfig.workspaces === 'object'
    ? normalizedConfig.workspaces
    : {};

  const errors = [];
  if (!gatewayConfigured) {
    errors.push(buildGatewayProbeFailure(
      'gateway_config_missing',
      'gateway_config_missing',
      'Messaging gateway config is not initialized',
    ));
  }
  if (tracker && tracker.error) {
    errors.push(tracker.error);
  }
  if (planningRequired && !planningReady) {
    errors.push(buildGatewayProbeFailure(
      'planning_persistence_not_ready',
      'planning_persistence_not_ready',
      String(planningPersistence.lastError || planningPersistence.status || 'planning_persistence_not_ready'),
    ));
  }

  return {
    contractVersion: '1',
    kind: 'gateway.state',
    deterministic: true,
    checkedAt: new Date().toISOString(),
    ready: gatewayReady,
    error: errors.length ? errors[0] : null,
    gateway: {
      ready: gatewayReady,
      status: gatewayReady ? 'ready' : gatewayConfigured ? 'degraded' : 'not_configured',
      config: {
        exists: gatewayConfigured,
        path: configPath,
        mode: String(normalizedConfig.mode || '').trim() || null,
        activeRoot: String(workspaceConfig.activeRoot || '').trim() || null,
        allowedRootCount: Array.isArray(workspaceConfig.allowedRoots) ? workspaceConfig.allowedRoots.length : 0,
      },
    },
    tracker: {
      ready: trackerReady,
      status: trackerStatus,
      statusCode: tracker && Number.isFinite(tracker.statusCode) ? Number(tracker.statusCode) : null,
      url: String(source.trackerUrl || '').trim() || null,
      checkedAt: tracker && tracker.checkedAt ? tracker.checkedAt : null,
      error: tracker && tracker.error ? tracker.error : null,
    },
    planningPersistence: {
      ...planningPersistence,
      ready: planningReady,
      initSupported: Boolean(source.planningAuthority && source.planningAuthority.persistedAuthority),
      initRequired: Boolean(source.planningAuthority && source.planningAuthority.persistedAuthority) && !planningReady,
    },
    errors,
  };
}

function shouldRemapTrackerMissingTokenPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const hasMissingStatus = payload.status === 'missing_token';
  const hasLegacyErrorCode = payload.error
    && typeof payload.error === 'object'
    && payload.error.code === 'tracker_token_missing';
  const hasLegacyErrorString = typeof payload.error === 'string'
    && payload.error.startsWith('Tracker token not configured');
  const hasLegacyErrorMessage = payload.error
    && typeof payload.error === 'object'
    && typeof payload.error.message === 'string'
    && payload.error.message.startsWith('Tracker token not configured');

  return Boolean(hasMissingStatus || hasLegacyErrorCode || hasLegacyErrorString || hasLegacyErrorMessage);
}

function buildCanonicalTrackerMissingTokenEnvelope(payload) {
  if (!shouldRemapTrackerMissingTokenPayload(payload)) {
    return null;
  }

  const legacyMessage = typeof payload.error === 'string'
    ? payload.error
    : payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string'
      ? payload.error.message
      : 'Tracker token not configured';

  return toCanonicalMissingTokenError(payload) || {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message: legacyMessage,
  };
}

function buildTrackerProxyPassThroughHeaders(headers) {
  const source = headers && typeof headers === 'object' ? headers : {};
  const outbound = { 'Cache-Control': 'no-store' };

  for (const headerName of TRACKER_PROXY_RESPONSE_HEADER_ALLOWLIST) {
    const value = source[headerName];
    if (value == null) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      outbound[TRACKER_PROXY_RESPONSE_HEADER_MAP[headerName]] = value.join(', ');
      continue;
    }

    outbound[TRACKER_PROXY_RESPONSE_HEADER_MAP[headerName]] = String(value);
  }

  return outbound;
}

function buildTrackerProxyResponsePlan({ statusCode, headers, bodyText }) {
  const resolvedStatusCode = Number.isFinite(statusCode) ? Number(statusCode) : 502;
  const responseBodyText = typeof bodyText === 'string' ? bodyText : '';
  const parsedPayload = parseJsonBodySafe(responseBodyText);

  if (resolvedStatusCode >= 400 && parsedPayload) {
    const canonicalMissingToken = buildCanonicalTrackerMissingTokenEnvelope(parsedPayload);
    if (canonicalMissingToken) {
      const remapHeaders = buildTrackerProxyPassThroughHeaders({
        ...(headers && typeof headers === 'object' ? headers : {}),
        'content-type': 'application/json; charset=utf-8',
      });
      return {
        statusCode: 502,
        headers: remapHeaders,
        bodyText: JSON.stringify(canonicalMissingToken, null, 2),
        remapped: true,
      };
    }
  }

  return {
    statusCode: resolvedStatusCode,
    headers: buildTrackerProxyPassThroughHeaders(headers),
    bodyText: responseBodyText,
    remapped: false,
  };
}

module.exports = {
  resolveTrackerUrl,
  resolveTrackerToken,
  createLifecycleCompatibilityRequestHeaders,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
  LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
  buildLifecycleMixedVersionUnsupportedMarker,
  evaluateLifecycleMixedVersionCompatibility,
  buildGatewayProbeFailure,
  probeTrackerReadiness,
  buildGatewayStateEnvelope,
  shouldRemapTrackerMissingTokenPayload,
  buildTrackerProxyPassThroughHeaders,
  buildTrackerProxyResponsePlan,
};
