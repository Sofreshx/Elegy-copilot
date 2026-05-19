'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const {
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE,
  toCanonicalMissingTokenError: defaultToCanonicalMissingTokenError,
} = require('../lib/sandboxLifecycleTokenContract');

function hasLifecycleToken(trackerToken) {
  return typeof trackerToken === 'string' && trackerToken.trim().length > 0;
}

function buildLifecycleTokenMissingPayload(deps, includeSetupHint) {
  const canonical = deps.toCanonicalMissingTokenError({
    status: SANDBOX_TOKEN_CANONICAL_STATE,
  }) || {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message: 'Sandbox lifecycle auth not configured',
    legacyCode: 'tracker_token_missing',
    legacyReason: 'tracker_token_missing',
  };

  const baseMessage = 'Sandbox lifecycle auth not configured';
  const message = includeSetupHint
    ? `${baseMessage}. Set --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.`
    : baseMessage;

  return { ...canonical, message };
}

function ensureLifecycleTokenConfigured(res, deps, includeSetupHint) {
  if (hasLifecycleToken(deps.trackerToken)) {
    return true;
  }

  deps.sendJson(res, 502, buildLifecycleTokenMissingPayload(deps, includeSetupHint));
  return false;
}

function handleSandboxLifecycleAction(ctx, deps) {
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

  if (!ensureLifecycleTokenConfigured(res, deps, true)) {
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
      .catch((error) => {
        sendJson(res, error.statusCode || 400, {
          error: String(error.message || error),
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
      .catch((error) => {
        sendJson(res, error.statusCode || 400, {
          error: String(error.message || error),
          code: 'invalid_json',
          action,
        });
      });
    return;
  }

  proxyToTracker(trackerUrl, trackerToken, targetPath, 'POST', req, res, action);
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    proxyToTracker: deps.proxyToTracker,
    postJsonToTracker: deps.postJsonToTracker,
    postJsonToTrackerWithFinishInvariant: deps.postJsonToTrackerWithFinishInvariant,
    resolveLifecycleCapabilityGate: deps.resolveLifecycleCapabilityGate,
    validateOpenTerminalLifecyclePayload: deps.validateOpenTerminalLifecyclePayload,
    validateFinishLifecyclePayload: deps.validateFinishLifecyclePayload,
    sendLifecyclePayloadError: deps.sendLifecyclePayloadError,
    toCanonicalMissingTokenError: deps.toCanonicalMissingTokenError || defaultToCanonicalMissingTokenError,
    trackerUrl: deps.trackerUrl,
    trackerToken: deps.trackerToken,
  };

  return [
    {
      method: 'POST',
      path: /^\/api\/sandboxes\/lifecycle\/([^/]+)$/,
      pathDescription: '/api/sandboxes/lifecycle/:action',
      handler: (ctx) => handleSandboxLifecycleAction(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
