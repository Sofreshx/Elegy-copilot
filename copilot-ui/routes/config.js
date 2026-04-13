'use strict';

const copilotConfigDefault = require('../lib/copilotConfig');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

/**
 * Copilot config API routes.
 * GET  /api/config/remote-sessions  — read remoteSessions preference
 * PUT  /api/config/remote-sessions  — set remoteSessions preference
 */
function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    copilotConfig: deps.copilotConfig || copilotConfigDefault,
  };

  return [
    {
      method: 'GET',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleGetRemoteSessions(ctx, resolvedDeps),
    },
    {
      method: 'PUT',
      path: '/api/config/remote-sessions',
      handler: (ctx) => handleSetRemoteSessions(ctx, resolvedDeps),
    },
  ];
}

function handleGetRemoteSessions(ctx, deps) {
  const { copilotHome } = ctx;
  try {
    const enabled = deps.copilotConfig.getRemoteSessions(copilotHome);
    deps.sendJson(ctx.res, 200, { enabled });
  } catch (err) {
    deps.sendJson(ctx.res, 500, { error: 'Failed to read config', details: err.message });
  }
}

async function handleSetRemoteSessions(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    if (typeof body.enabled !== 'boolean') {
      deps.sendJson(ctx.res, 400, { error: '`enabled` must be a boolean' });
      return;
    }

    deps.copilotConfig.setRemoteSessions(ctx.copilotHome, body.enabled);

    // Restart SDK bridge base client if available, so the running CLI process
    // picks up the new remote mode.
    if (ctx.sdkBridge && typeof ctx.sdkBridge.restartBaseClient === 'function') {
      try {
        await ctx.sdkBridge.restartBaseClient();
      } catch (restartErr) {
        // Non-fatal: preference was saved, but client restart failed.
        deps.sendJson(ctx.res, 200, {
          enabled: body.enabled,
          warning: `Config saved but base client restart failed: ${restartErr.message}`,
        });
        return;
      }
    }

    deps.sendJson(ctx.res, 200, { enabled: body.enabled });
  } catch (err) {
    if (err.statusCode === 413) {
      deps.sendJson(ctx.res, 413, { error: 'Request body too large' });
      return;
    }
    deps.sendJson(ctx.res, 500, { error: 'Failed to update config', details: err.message });
  }
}

module.exports = { register };
