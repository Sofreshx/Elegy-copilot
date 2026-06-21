'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const { buildPlanningPersistenceHealthEnvelope } = require('../planningApiContracts');

const SANDBOX_TOKEN_CANONICAL_STATE = 'token_missing';
const SANDBOX_TOKEN_CANONICAL_CODE = 'MISSING_SANDBOX_TOKEN';

function toCanonicalMissingTokenError(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message: 'Tracker token not configured',
    legacyCode: 'tracker_token_missing',
    legacyReason: 'tracker_token_missing',
  };
}

const LOCAL_TRACKER_SECRETS_MODULE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'local-tracker',
  'dist',
  'secrets.js'
);
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION = '1';
const LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY = 'mixed-version-lifecycle-v1';
const LIFECYCLE_COMPATIBILITY_HEADER_CONTRACT_VERSION = 'x-elegy-copilot-lifecycle-contract-version';
const LIFECYCLE_COMPATIBILITY_HEADER_CAPABILITY = 'x-elegy-copilot-lifecycle-capability';
const TRACKER_PROXY_RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  'content-type',
  'www-authenticate',
  'retry-after',
  'x-elegy-copilot-lifecycle-contract-version',
  'x-elegy-copilot-lifecycle-capability',
]);
const TRACKER_PROXY_RESPONSE_HEADER_MAP = Object.freeze({
  'content-type': 'Content-Type',
  'www-authenticate': 'WWW-Authenticate',
  'retry-after': 'Retry-After',
  'x-elegy-copilot-lifecycle-contract-version': 'X-elegy-copilot-Lifecycle-Contract-Version',
  'x-elegy-copilot-lifecycle-capability': 'X-elegy-copilot-Lifecycle-Capability',
});
const LEGACY_TRACKER_TOKEN_MISSING_STATUS = `${'missing'}_token`;
const LEGACY_TRACKER_TOKEN_MISSING_CODE = ['tracker', 'token', 'missing'].join('_');
const LEGACY_TRACKER_TOKEN_MISSING_MESSAGE_PREFIX = ['Tracker', 'token', 'not', 'configured'].join(' ');

function resolveTrackerUrl(args, env = process.env) {
  if (args && typeof args.trackerUrl === 'string' && args.trackerUrl.trim()) return args.trackerUrl.trim();
  if (typeof env.INSTRUCTION_ENGINE_TRACKER_URL === 'string' && env.INSTRUCTION_ENGINE_TRACKER_URL.trim()) {
    return env.INSTRUCTION_ENGINE_TRACKER_URL.trim();
  }
  return 'http://127.0.0.1:4100';
}

async function resolveTrackerToken(args) {
  if (args && typeof args.trackerToken === 'string' && args.trackerToken.trim()) {
    return {
      value: args.trackerToken.trim(),
      source: 'arg',
    };
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
    'X-elegy-copilot-Lifecycle-Contract-Version': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CONTRACT_VERSION,
    'X-elegy-copilot-Lifecycle-Capability': LIFECYCLE_MIXED_VERSION_COMPATIBILITY_CAPABILITY,
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

function parseCanonicalTrackerStatus(payload) {
  const source = payload && typeof payload === 'object' ? payload : null;
  const readiness = source && source.readiness && typeof source.readiness === 'object'
    ? source.readiness
    : null;

  if (!source || source.schemaVersion !== 1 || typeof source.lastUpdatedUtc !== 'string' || !readiness) {
    return null;
  }

  const state = typeof readiness.state === 'string' ? readiness.state.trim() : '';
  const reasonCode = typeof readiness.reasonCode === 'string' ? readiness.reasonCode.trim() : '';
  if (!state || !reasonCode) {
    return null;
  }

  return source;
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
      error: {
        deterministic: true,
        code: String(missingTokenError && typeof missingTokenError.legacyCode === 'string'
          ? missingTokenError.legacyCode
          : 'tracker_missing_token'),
        reason: String(missingTokenError && typeof missingTokenError.legacyReason === 'string'
          ? missingTokenError.legacyReason
          : SANDBOX_TOKEN_CANONICAL_STATE),
        message: String(missingTokenError && typeof missingTokenError.message === 'string'
          ? missingTokenError.message
          : 'Sandbox token missing'),
        statusCode: null,
      },
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
      error: {
        deterministic: true,
        code: 'tracker_url_invalid',
        reason: 'tracker_url_invalid',
        message: 'Tracker URL is invalid',
        statusCode: null,
      },
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
        const canonicalStatus = parseCanonicalTrackerStatus(body);

        if (canonicalStatus) {
          const ready = canonicalStatus.readiness.state === 'ready';
          resolve({
            deterministic: true,
            checkedAt,
            ready,
            status: ready ? 'ready' : canonicalStatus.readiness.state,
            statusCode,
            body,
            canonicalStatus,
            error: ready
              ? null
              : {
                deterministic: true,
                code: 'tracker_status_unhealthy',
                reason: String(canonicalStatus.readiness.reasonCode || 'tracker_status_unhealthy'),
                message: `Tracker readiness is ${canonicalStatus.readiness.state}`,
                statusCode: Number.isFinite(statusCode) ? Number(statusCode) : null,
              },
          });
          return;
        }

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
          error: {
            deterministic: true,
            code: String(errorCode || 'tracker_probe_failed'),
            reason: String(reason || 'tracker_probe_failed'),
            message: String(message || reason || errorCode || 'tracker_probe_failed'),
            statusCode: Number.isFinite(statusCode) ? Number(statusCode) : null,
          },
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
        error: {
          deterministic: true,
          code: 'tracker_timeout',
          reason: 'tracker_request_timeout',
          message: 'Tracker request timed out',
          statusCode: null,
        },
      });
    });

    request.on('error', (error) => {
      resolve({
        deterministic: true,
        checkedAt,
        ready: false,
        status: 'unreachable',
        statusCode: null,
        error: {
          deterministic: true,
          code: 'tracker_unreachable',
          reason: 'tracker_request_failed',
          message: String(error && error.message ? error.message : error),
          statusCode: null,
        },
      });
    });
    request.end();
  });
}

function shouldRemapTrackerMissingTokenPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const hasMissingStatus = payload.status === LEGACY_TRACKER_TOKEN_MISSING_STATUS;
  const hasLegacyErrorCode = payload.error
    && typeof payload.error === 'object'
    && payload.error.code === LEGACY_TRACKER_TOKEN_MISSING_CODE;
  const hasLegacyErrorString = typeof payload.error === 'string'
    && payload.error.startsWith(LEGACY_TRACKER_TOKEN_MISSING_MESSAGE_PREFIX);
  const hasLegacyErrorMessage = payload.error
    && typeof payload.error === 'object'
    && typeof payload.error.message === 'string'
    && payload.error.message.startsWith(LEGACY_TRACKER_TOKEN_MISSING_MESSAGE_PREFIX);

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
      : LEGACY_TRACKER_TOKEN_MISSING_MESSAGE_PREFIX;

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
  probeTrackerReadiness,
  shouldRemapTrackerMissingTokenPayload,
  buildTrackerProxyPassThroughHeaders,
  buildTrackerProxyResponsePlan,
};
