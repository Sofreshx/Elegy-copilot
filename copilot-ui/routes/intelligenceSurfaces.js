'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const SURFACE_SCHEMA = 'elegy.intelligence-surfaces.v1';

function publicStatus(value) {
  if (!value || typeof value !== 'object') return value;
  const {
    schema,
    id,
    name,
    description,
    status,
    reasonCode,
    consoleUrl,
    healthUrl,
    checkedAt,
    prerequisites,
    health,
  } = value;
  return {
    ...(schema ? { schema } : {}),
    id,
    name,
    description,
    status,
    reasonCode,
    consoleUrl,
    healthUrl,
    checkedAt,
    prerequisites: Array.isArray(prerequisites) ? prerequisites : [],
    ...(health ? { health } : {}),
  };
}

function errorStatus(error) {
  switch (error && error.code) {
    case 'unknown_service': return 404;
    case 'repository_missing':
    case 'operator_script_missing':
    case 'repository_path_unapproved':
    case 'repository_identity_mismatch':
    case 'confirmation_stale':
    case 'service_operation_in_progress':
    case 'confirmation_required': return 409;
    case 'service_start_failed':
    case 'service_stop_failed': return 502;
    default: return 500;
  }
}

function errorBody(error, fallback = 'Intelligence surface operation failed.') {
  const code = String(error && error.code || 'service_host_failed');
  return { error: code, code, message: fallback };
}

async function handleList(ctx, deps) {
  try {
    const statuses = await deps.serviceHost.listStatuses();
    deps.sendJson(ctx.res, 200, {
      schema: SURFACE_SCHEMA,
      services: statuses.map(publicStatus),
    });
  } catch (error) {
    deps.sendJson(ctx.res, 500, errorBody(error, 'Unable to inspect intelligence surfaces.'));
  }
}

async function handleGet(ctx, deps) {
  const id = ctx.match && ctx.match[1];
  try {
    deps.sendJson(ctx.res, 200, publicStatus(await deps.serviceHost.inspect(id)));
  } catch (error) {
    deps.sendJson(ctx.res, errorStatus(error), errorBody(error, 'Unable to inspect the requested intelligence surface.'));
  }
}

async function handleAction(ctx, deps) {
  const id = ctx.match && ctx.match[1];
  const action = ctx.match && ctx.match[2];
  let body;
  try {
    body = await deps.readJsonBody(ctx.req);
  } catch {
    deps.sendJson(ctx.res, 400, { error: 'invalid_json', code: 'invalid_json', message: 'A JSON confirmation body is required.' });
    return;
  }

  if (!body || body.confirmation !== `${action}:${id}`) {
    deps.sendJson(ctx.res, 400, {
      error: 'confirmation_required',
      code: 'confirmation_required',
      message: `Confirm this action with confirmation=${action}:${id}.`,
    });
    return;
  }
  if (typeof body.observedAt !== 'string' || body.observedAt.length < 1 || body.observedAt.length > 80) {
    deps.sendJson(ctx.res, 409, {
      error: 'confirmation_stale',
      code: 'confirmation_stale',
      message: 'Refresh the service status before confirming this action.',
    });
    return;
  }

  try {
    if (typeof deps.serviceHost.assertFreshConfirmation === 'function') {
      await deps.serviceHost.assertFreshConfirmation(id, action, body.observedAt);
    }
    const result = action === 'start'
      ? await deps.serviceHost.start(id)
      : await deps.serviceHost.stop(id);
    deps.sendJson(ctx.res, 200, publicStatus(result));
  } catch (error) {
    deps.sendJson(ctx.res, errorStatus(error), errorBody(error));
  }
}

function register(deps = {}) {
  const resolved = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    serviceHost: deps.serviceHost,
  };

  return [
    {
      method: 'GET',
      path: '/api/intelligence-surfaces',
      handler: (ctx) => handleList(ctx, resolved),
    },
    {
      method: 'GET',
      path: /^\/api\/intelligence-surfaces\/([^/]+)$/,
      handler: (ctx) => handleGet(ctx, resolved),
    },
    {
      method: 'POST',
      path: /^\/api\/intelligence-surfaces\/([^/]+)\/(start|stop)$/,
      handler: (ctx) => handleAction(ctx, resolved),
    },
  ];
}

module.exports = { register, publicStatus, SURFACE_SCHEMA };
