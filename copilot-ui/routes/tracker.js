'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const {
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE,
  isKnownMissingTokenIndicator: defaultIsKnownMissingTokenIndicator,
  toCanonicalMissingTokenError: defaultToCanonicalMissingTokenError,
} = require('../lib/sandboxLifecycleTokenContract');

function hasTrackerToken(trackerToken) {
  return typeof trackerToken === 'string' && trackerToken.trim().length > 0;
}

function buildTrackerTokenMissingPayload(deps, includeSetupHint) {
  const canonical = deps.toCanonicalMissingTokenError({
    status: SANDBOX_TOKEN_CANONICAL_STATE,
  }) || {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message: 'Tracker token not configured',
  };

  const baseMessage = canonical && typeof canonical.message === 'string' && canonical.message.trim()
    ? canonical.message.trim()
    : 'Tracker token not configured';

  const message = includeSetupHint
    ? `${baseMessage}. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.`
    : baseMessage;

  return { ...canonical, message };
}

function ensureTrackerTokenConfigured(res, deps, includeSetupHint) {
  if (hasTrackerToken(deps.trackerToken)) {
    return true;
  }

  const indicatorPayload = {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
  };

  if (!deps.isKnownMissingTokenIndicator(indicatorPayload)) {
    return true;
  }

  deps.sendJson(res, 502, buildTrackerTokenMissingPayload(deps, includeSetupHint));
  return false;
}

function handleTrackerStatus(ctx, deps) {
  const { req, res } = ctx;
  const { proxyToTracker, trackerUrl, trackerToken } = deps;
  if (!ensureTrackerTokenConfigured(res, deps, true)) {
    return;
  }
  proxyToTracker(trackerUrl, trackerToken, '/api/status', 'GET', req, res);
}

function handleTrackerSessions(ctx, deps) {
  const { req, res } = ctx;
  const { proxyToTracker, trackerUrl, trackerToken } = deps;
  if (!ensureTrackerTokenConfigured(res, deps, true)) {
    return;
  }
  proxyToTracker(trackerUrl, trackerToken, '/api/sessions/live', 'GET', req, res);
}

function handleTrackerPermissions(ctx, deps) {
  const { req, res } = ctx;
  const { proxyToTracker, trackerUrl, trackerToken } = deps;
  if (!ensureTrackerTokenConfigured(res, deps, true)) {
    return;
  }
  proxyToTracker(trackerUrl, trackerToken, '/api/permissions/pending', 'GET', req, res);
}

function handleTrackerPermissionAction(ctx, deps) {
  const { req, res, match } = ctx;
  const { sendJson, proxyToTracker, trackerUrl, trackerToken } = deps;

  const callbackId = decodeURIComponent(match[1]);
  const action = match[2];

  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(callbackId)) {
    sendJson(res, 400, { error: 'Invalid callbackId format' });
    return;
  }

  if (!ensureTrackerTokenConfigured(res, deps, true)) {
    return;
  }

  proxyToTracker(
    trackerUrl,
    trackerToken,
    `/api/permissions/${encodeURIComponent(callbackId)}/${action}`,
    'POST',
    req,
    res,
  );
}

function handleTrackerLifecycleAction(ctx, deps) {
  const { req, res, match, providerState } = ctx;
  const {
    sendJson,
    readJsonBody,
    proxyToTracker,
    postJsonToTracker,
    postJsonToTrackerWithFinishInvariant,
    resolveLifecycleCapabilityGate,
    validateOpenTerminalLifecyclePayload,
    validateFinishLifecyclePayload,
    sendLifecyclePayloadError,
    trackerUrl,
    trackerToken,
  } = deps;

  const action = decodeURIComponent(match[1]);
  const targetPath = `/api/lifecycle/${encodeURIComponent(action)}`;

  if (!ensureTrackerTokenConfigured(res, deps, true)) {
    return;
  }

  const capabilityGate = resolveLifecycleCapabilityGate(action, providerState);
  if (!capabilityGate.allowed) {
    sendJson(res, capabilityGate.statusCode, capabilityGate.body);
    return;
  }

  if (action === 'open-terminal') {
    readJsonBody(req)
      .then((payload) => {
        const validation = validateOpenTerminalLifecyclePayload(payload);
        if (!validation.ok) {
          sendLifecyclePayloadError(res, action, validation.error);
          return;
        }
        postJsonToTracker(trackerUrl, trackerToken, targetPath, validation.value, res, action);
      })
      .catch((e) => {
        sendJson(res, e.statusCode || 400, {
          error: String(e.message || e),
          code: 'invalid_json',
          action,
        });
      });
    return;
  }

  if (action === 'finish') {
    readJsonBody(req)
      .then((payload) => {
        const validation = validateFinishLifecyclePayload(payload);
        if (!validation.ok) {
          sendLifecyclePayloadError(res, action, validation.error);
          return;
        }
        postJsonToTrackerWithFinishInvariant(
          trackerUrl,
          trackerToken,
          targetPath,
          validation.value,
          res,
          providerState,
          action,
        );
      })
      .catch((e) => {
        sendJson(res, e.statusCode || 400, {
          error: String(e.message || e),
          code: 'invalid_json',
          action,
        });
      });
    return;
  }

  proxyToTracker(trackerUrl, trackerToken, targetPath, 'POST', req, res, action);
}

function handleTrackerEvents(ctx, deps) {
  const { req, res } = ctx;
  const { relayTrackerSSE, trackerUrl, trackerToken } = deps;
  if (!ensureTrackerTokenConfigured(res, deps, false)) {
    return;
  }
  relayTrackerSSE(trackerUrl, trackerToken, req, res);
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    proxyToTracker: deps.proxyToTracker,
    postJsonToTracker: deps.postJsonToTracker,
    postJsonToTrackerWithFinishInvariant: deps.postJsonToTrackerWithFinishInvariant,
    relayTrackerSSE: deps.relayTrackerSSE,
    resolveLifecycleCapabilityGate: deps.resolveLifecycleCapabilityGate,
    validateOpenTerminalLifecyclePayload: deps.validateOpenTerminalLifecyclePayload,
    validateFinishLifecyclePayload: deps.validateFinishLifecyclePayload,
    sendLifecyclePayloadError: deps.sendLifecyclePayloadError,
    isKnownMissingTokenIndicator: deps.isKnownMissingTokenIndicator || defaultIsKnownMissingTokenIndicator,
    toCanonicalMissingTokenError: deps.toCanonicalMissingTokenError || defaultToCanonicalMissingTokenError,
    trackerUrl: deps.trackerUrl,
    trackerToken: deps.trackerToken,
  };

  return [
    {
      method: 'GET',
      path: '/api/tracker/status',
      handler: (ctx) => handleTrackerStatus(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/tracker/sessions',
      handler: (ctx) => handleTrackerSessions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/tracker/permissions',
      handler: (ctx) => handleTrackerPermissions(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/tracker/events',
      handler: (ctx) => handleTrackerEvents(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/tracker\/permissions\/([^/]+)\/(approve|deny)$/,
      pathDescription: '/api/tracker/permissions/:id/(approve|deny)',
      handler: (ctx) => handleTrackerPermissionAction(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/tracker\/lifecycle\/([^/]+)$/,
      pathDescription: '/api/tracker/lifecycle/:action',
      handler: (ctx) => handleTrackerLifecycleAction(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };