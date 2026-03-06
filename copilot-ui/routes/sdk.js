'use strict';

const fs = require('fs');
const path = require('path');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const SANDBOX_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidSessionId(value) {
  if (!isNonEmptyString(value)) return false;
  const id = value.trim();
  if (id.length > 256) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function resolveSandboxSessionCwd(sandboxesHome, sandboxId) {
  const sandboxRoot = typeof sandboxesHome === 'string' && sandboxesHome.trim()
    ? path.resolve(sandboxesHome.trim())
    : '';
  if (!sandboxRoot) {
    throw Object.assign(new Error('Sandbox root is unavailable on the server.'), { statusCode: 503 });
  }

  const sandboxCwd = path.resolve(path.join(sandboxRoot, sandboxId));
  if (!isPathInside(sandboxRoot, sandboxCwd)) {
    throw Object.assign(new Error('Sandbox path escapes configured sandbox root.'), { statusCode: 400 });
  }

  let stat;
  try {
    stat = fs.statSync(sandboxCwd);
  } catch {
    throw Object.assign(new Error(`Sandbox ${sandboxId} is not available. Run create/start first.`), { statusCode: 409 });
  }

  if (!stat.isDirectory()) {
    throw Object.assign(new Error(`Sandbox ${sandboxId} is not available. Run create/start first.`), { statusCode: 409 });
  }

  return sandboxCwd;
}

function toBridgeErrorPayload(error, fallbackStatusCode = 500) {
  if (!error || typeof error !== 'object') {
    return {
      statusCode: fallbackStatusCode,
      body: { error: String(error || 'Unknown error') },
    };
  }

  if (typeof error.statusCode === 'number') {
    return {
      statusCode: error.statusCode,
      body: { error: String(error.message || error) },
    };
  }

  if (error.code === 'SDK_SESSION_NOT_FOUND') {
    return {
      statusCode: 404,
      body: { error: String(error.message || 'SDK session not found') },
    };
  }

  if (error.code === 'SDK_INVALID_PAYLOAD') {
    return {
      statusCode: 400,
      body: { error: String(error.message || 'Invalid SDK payload') },
    };
  }

  return {
    statusCode: fallbackStatusCode,
    body: { error: String(error.message || error) },
  };
}

function buildSdkBridgeDisabledHealth() {
  return {
    connected: false,
    enabled: false,
    state: 'disabled',
    mode: 'disabled',
    sessionCount: 0,
    reason: 'sdk_bridge_disabled',
    error: 'SDK bridge is disabled. Set COPILOT_SDK_BRIDGE=1 to enable SDK sessions.',
  };
}

function buildSdkBridgeDisabledError() {
  return {
    error: 'SDK bridge is disabled. Set COPILOT_SDK_BRIDGE=1 to enable SDK sessions.',
    code: 'sdk_bridge_disabled',
    reason: 'sdk_bridge_disabled',
  };
}

function requireSdkBridge(res, deps) {
  if (deps.sdkBridge) {
    return deps.sdkBridge;
  }

  deps.sendJson(res, 503, buildSdkBridgeDisabledError());
  return null;
}

function handleSdkHealth(ctx, deps) {
  const { res } = ctx;
  const { sendJson, sdkBridge } = deps;

  if (!sdkBridge) {
    sendJson(res, 200, buildSdkBridgeDisabledHealth());
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.getHealth())
    .then((health) => sendJson(res, 200, health))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleCreateSession(ctx, deps) {
  const { req, res, sandboxesHome } = ctx;
  const { sendJson, readJsonBody } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = payload.sessionId == null ? null : String(payload.sessionId).trim();
      const model = payload.model == null ? null : String(payload.model).trim();
      const contextType = payload.contextType == null ? null : String(payload.contextType).trim().toLowerCase();
      const sandboxId = payload.sandboxId == null ? null : String(payload.sandboxId).trim();
      let cwd;

      if (sessionId != null && sessionId !== '' && !isValidSessionId(sessionId)) {
        throw Object.assign(new Error('Invalid sessionId'), { statusCode: 400 });
      }

      if (payload.model != null && !isNonEmptyString(model)) {
        throw Object.assign(new Error('model must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (payload.contextType != null && !isNonEmptyString(contextType)) {
        throw Object.assign(new Error('contextType must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (payload.sandboxId != null && !isNonEmptyString(sandboxId)) {
        throw Object.assign(new Error('sandboxId must be a non-empty string when provided'), { statusCode: 400 });
      }

      if (sandboxId && !SANDBOX_ID_PATTERN.test(sandboxId)) {
        throw Object.assign(new Error('sandboxId must use only alphanumeric and hyphen characters'), { statusCode: 400 });
      }

      if (sandboxId && contextType && contextType !== 'sandbox') {
        throw Object.assign(new Error('sandboxId requires contextType=sandbox (or omit contextType)'), { statusCode: 400 });
      }

      if (sandboxId) {
        cwd = resolveSandboxSessionCwd(sandboxesHome, sandboxId);
      }

      return sdkBridge.createSdkSession({
        sessionId: sessionId || undefined,
        model: model || undefined,
        contextType: sandboxId ? 'sandbox' : (contextType || 'regular'),
        sandboxId: sandboxId || undefined,
        cwd,
      });
    })
    .then((result) => sendJson(res, 201, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleListSessions(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.listSdkSessions())
    .then((sessions) => sendJson(res, 200, { sessions }))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleDeleteSession(ctx, deps) {
  const { res, match } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  const sessionId = decodeURIComponent(match[1] || '').trim();
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  Promise.resolve()
    .then(() => sdkBridge.destroySdkSession(sessionId))
    .then((removed) => {
      if (!removed) {
        sendJson(res, 404, { error: 'SDK session not found', sessionId });
        return;
      }
      sendJson(res, 200, { ok: true, sessionId });
    })
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleSend(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = payload.sessionId == null ? '' : String(payload.sessionId).trim();
      const prompt = payload.prompt == null ? '' : String(payload.prompt).trim();

      if (!isValidSessionId(sessionId)) {
        throw Object.assign(new Error('Invalid sessionId'), { statusCode: 400 });
      }

      if (!prompt) {
        throw Object.assign(new Error('prompt is required'), { statusCode: 400 });
      }

      return sdkBridge.sendToSession(sessionId, {
        prompt,
        attachments: Array.isArray(payload.attachments) ? payload.attachments : undefined,
        mode: payload.mode,
      });
    })
    .then((result) => sendJson(res, 202, result))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleStream(ctx, deps) {
  const { req, res, match } = ctx;
  const { sendJson } = deps;
  const sdkBridge = requireSdkBridge(res, deps);
  if (!sdkBridge) {
    return;
  }

  const sessionId = decodeURIComponent(match[1] || '').trim();
  if (!isValidSessionId(sessionId)) {
    sendJson(res, 400, { error: 'Invalid session id' });
    return;
  }

  const attachResult = sdkBridge.attachSseClient(sessionId, req, res);
  if (!attachResult || attachResult.ok !== true) {
    sendJson(
      res,
      attachResult && typeof attachResult.statusCode === 'number' ? attachResult.statusCode : 500,
      {
        error: (attachResult && attachResult.error) || 'Failed to attach SSE client',
        sessionId,
      }
    );
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    sdkBridge: deps.sdkBridge || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/sdk/health',
      handler: (ctx) => handleSdkHealth(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sdk/session',
      handler: (ctx) => handleCreateSession(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/sdk/sessions',
      handler: (ctx) => handleListSessions(ctx, resolvedDeps),
    },
    {
      method: 'DELETE',
      path: /^\/api\/sdk\/session\/([^/]+)$/,
      handler: (ctx) => handleDeleteSession(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/sdk/send',
      handler: (ctx) => handleSend(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/sdk\/stream\/([^/]+)$/,
      handler: (ctx) => handleStream(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
