'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function toErrorPayload(error, fallbackStatusCode = 500) {
  if (!error || typeof error !== 'object') {
    return {
      statusCode: fallbackStatusCode,
      body: { error: String(error || 'Unknown error') },
    };
  }

  return {
    statusCode: typeof error.statusCode === 'number' ? error.statusCode : fallbackStatusCode,
    body: {
      error: String(error.message || error),
    },
  };
}

function requireService(res, deps) {
  if (deps.uiRuntimeOverlayService) {
    return deps.uiRuntimeOverlayService;
  }

  deps.sendJson(res, 503, {
    error: 'UI Runtime Overlay service is unavailable.',
  });
  return null;
}

function handleListSessions(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;
  deps.sendJson(ctx.res, 200, { sessions: service.listSessions() });
}

function handleCreateSession(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  deps.readJsonBody(ctx.req)
    .then((body) => service.createSession(body && typeof body === 'object' ? body : {}))
    .then((session) => deps.sendJson(ctx.res, 201, { session }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function handleCloseSession(ctx, deps) {
  const service = requireService(ctx.res, deps);
  if (!service) return;

  const sessionId = decodeURIComponent(ctx.match[1] || '').trim();
  Promise.resolve()
    .then(() => service.closeSession(sessionId))
    .then((session) => deps.sendJson(ctx.res, 200, { session }))
    .catch((error) => {
      const failure = toErrorPayload(error);
      deps.sendJson(ctx.res, failure.statusCode, failure.body);
    });
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    uiRuntimeOverlayService: deps.uiRuntimeOverlayService || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/ui-runtime-overlay/sessions',
      handler: (ctx) => handleListSessions(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/ui-runtime-overlay/sessions',
      handler: (ctx) => handleCreateSession(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/ui-runtime-overlay\/sessions\/([^/]+)\/close$/,
      handler: (ctx) => handleCloseSession(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };