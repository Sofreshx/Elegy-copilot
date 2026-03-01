'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

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

function handleSdkHealth(ctx, deps) {
  const { res } = ctx;
  const { sendJson, sdkBridge } = deps;

  Promise.resolve()
    .then(() => sdkBridge.getHealth())
    .then((health) => sendJson(res, 200, health))
    .catch((error) => {
      const failure = toBridgeErrorPayload(error, 500);
      sendJson(res, failure.statusCode, failure.body);
    });
}

function handleCreateSession(ctx, deps) {
  const { req, res } = ctx;
  const { sendJson, readJsonBody, sdkBridge } = deps;

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object' ? body : {};
      const sessionId = payload.sessionId == null ? null : String(payload.sessionId).trim();
      const model = payload.model == null ? null : String(payload.model).trim();

      if (sessionId != null && sessionId !== '' && !isValidSessionId(sessionId)) {
        throw Object.assign(new Error('Invalid sessionId'), { statusCode: 400 });
      }

      if (payload.model != null && !isNonEmptyString(model)) {
        throw Object.assign(new Error('model must be a non-empty string when provided'), { statusCode: 400 });
      }

      return sdkBridge.createSdkSession({
        sessionId: sessionId || undefined,
        model: model || undefined,
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
  const { sendJson, sdkBridge } = deps;

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
  const { sendJson, sdkBridge } = deps;

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
  const { sendJson, readJsonBody, sdkBridge } = deps;

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
  const { sendJson, sdkBridge } = deps;

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
  const sdkBridge = deps.sdkBridge || null;
  if (!sdkBridge) {
    return [];
  }

  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    sdkBridge,
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
