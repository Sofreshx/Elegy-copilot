'use strict';

const telemetryServiceDefault = require('../lib/telemetryService');
const { sendJson: defaultSendJson } = require('./_helpers');

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function register(deps = {}) {
  const telemetryService = deps.telemetryService || telemetryServiceDefault;
  const sendJson = deps.sendJson || defaultSendJson;

  return [
    {
      method: 'GET',
      path: '/api/telemetry/harnesses',
      handler: async (ctx) => {
        try {
          const limit = asNumber(ctx.u.searchParams.get('limit') || undefined, undefined);
          const result = telemetryService.buildHarnessTelemetry({
            limit,
            opencodeHome: ctx.opencodeHome,
            codexHome: ctx.codexHome,
          });
          sendJson(ctx.res, 200, result);
        } catch (error) {
          sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  ];
}

module.exports = {
  register,
};
