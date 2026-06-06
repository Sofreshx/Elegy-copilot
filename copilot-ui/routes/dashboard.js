'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const dashboardHarnessSessionsLib = require('../lib/dashboardHarnessSessions');

/**
 * Lazy require for sessionAggregation — handles concurrent development
 * where the module may not exist yet (WU-0.2).
 */
function getSessionAggregation() {
  try { return require('../lib/sessionAggregation'); }
  catch { return null; }
}

function loadHarnessSessionsInventory(ctx, deps) {
  return deps.dashboardHarnessSessions.listHarnessSessions({
    copilotHome: ctx.copilotHomeAbs || ctx.copilotHome,
    sandboxesHome: ctx.sandboxesHome,
    codexHome: ctx.codexHome,
    opencodeHome: ctx.opencodeHome,
    opencodeDataHome: ctx.opencodeDataHome,
    antigravityHome: ctx.antigravityHome,
    geminiHome: ctx.geminiHome,
    sessionAggregation: deps._sessionAggregationOverride !== undefined
      ? deps._sessionAggregationOverride
      : getSessionAggregation(),
  });
}

function handleDashboardHarnessSessions(ctx, deps) {
  try {
    const inventory = loadHarnessSessionsInventory(ctx, deps);
    deps.sendJson(ctx.res, 200, inventory);
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'dashboard_harness_sessions_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    dashboardHarnessSessions: deps.dashboardHarnessSessions || dashboardHarnessSessionsLib,
  };

  // Allow tests to override or disable sessionAggregation.
  if ('sessionAggregation' in deps) {
    resolvedDeps._sessionAggregationOverride = deps.sessionAggregation;
  }

  return [
    {
      method: 'GET',
      path: '/api/dashboard/harness-sessions',
      handler: (ctx) => handleDashboardHarnessSessions(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
