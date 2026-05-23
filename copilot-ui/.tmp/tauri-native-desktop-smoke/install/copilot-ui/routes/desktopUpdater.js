'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');

function resolveController(deps) {
  return deps.desktopUpdaterController || null;
}

function withController(resolvedDeps, handler) {
  return (ctx) => {
    const controller = resolveController(resolvedDeps);
    if (!controller) {
      resolvedDeps.sendJson(ctx.res, 503, {
        error: 'Desktop updater controller unavailable.',
      });
      return;
    }

    Promise.resolve(handler(ctx, controller, resolvedDeps))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        resolvedDeps.sendJson(ctx.res, 500, { error: message });
      });
  };
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    desktopUpdaterController: deps.desktopUpdaterController || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/desktop-updater',
      handler: withController(resolvedDeps, async (ctx, controller) => {
        resolvedDeps.sendJson(ctx.res, 200, controller.getState());
      }),
    },
    {
      method: 'POST',
      path: '/api/desktop-updater/check',
      handler: withController(resolvedDeps, async (ctx, controller) => {
        const state = await controller.checkForUpdates();
        resolvedDeps.sendJson(ctx.res, 200, state);
      }),
    },
    {
      method: 'POST',
      path: '/api/desktop-updater/download',
      handler: withController(resolvedDeps, async (ctx, controller) => {
        const state = await controller.downloadUpdate();
        resolvedDeps.sendJson(ctx.res, 200, state);
      }),
    },
    {
      method: 'POST',
      path: '/api/desktop-updater/restart',
      handler: withController(resolvedDeps, async (ctx, controller) => {
        const ok = await controller.restartToUpdate();
        resolvedDeps.sendJson(ctx.res, ok ? 200 : 409, { ok });
      }),
    },
  ];
}

module.exports = {
  register,
};