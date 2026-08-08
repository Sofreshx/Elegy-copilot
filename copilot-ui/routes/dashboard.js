'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');
const dashboardHarnessSessionsLib = require('../lib/dashboardHarnessSessions');
const {
  buildHarnessSessionsInWorker,
  createDashboardHarnessSessionSnapshotStore,
  scheduleSnapshotBuild,
} = require('../lib/dashboardHarnessSessionSnapshot');

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
    elegyHome: ctx.elegyHomeAbs || ctx.elegyHome,
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

function getSnapshotStore(ctx, deps) {
  if (deps.snapshotStore) {
    return deps.snapshotStore;
  }
  const useInjectedBuilder = deps.dashboardHarnessSessions !== dashboardHarnessSessionsLib
    || deps._sessionAggregationOverride !== undefined;
  const inventoryContext = {
    elegyHome: ctx.elegyHomeAbs || ctx.elegyHome,
    sandboxesHome: ctx.sandboxesHome,
    codexHome: ctx.codexHome,
    opencodeHome: ctx.opencodeHome,
    opencodeDataHome: ctx.opencodeDataHome,
    antigravityHome: ctx.antigravityHome,
    geminiHome: ctx.geminiHome,
  };
  deps.snapshotStore = createDashboardHarnessSessionSnapshotStore({
    buildSnapshot: useInjectedBuilder
      ? () => scheduleSnapshotBuild(() => loadHarnessSessionsInventory(inventoryContext, deps))
      : () => buildHarnessSessionsInWorker(inventoryContext),
  });
  return deps.snapshotStore;
}

async function handleDashboardHarnessSessions(ctx, deps) {
  try {
    const inventory = await getSnapshotStore(ctx, deps).getLegacyInventory();
    deps.sendJson(ctx.res, 200, inventory);
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'dashboard_harness_sessions_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

async function handleDashboardHarnessSessionsSummary(ctx, deps) {
  try {
    deps.sendJson(ctx.res, 200, await getSnapshotStore(ctx, deps).getSummary());
  } catch (error) {
    deps.sendJson(ctx.res, 500, {
      error: 'dashboard_harness_sessions_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

async function handleDashboardHarnessSessionsPage(ctx, deps) {
  try {
    const searchParams = ctx.u && ctx.u.searchParams ? ctx.u.searchParams : new URLSearchParams();
    const page = await getSnapshotStore(ctx, deps).getPage({
      harnessId: (ctx.match && ctx.match[1] ? decodeURIComponent(ctx.match[1]) : null)
        || searchParams.get('harnessId') || searchParams.get('harness'),
      cursor: searchParams.get('cursor'),
      limit: searchParams.get('limit'),
    });
    deps.sendJson(ctx.res, 200, page);
  } catch (error) {
    deps.sendJson(ctx.res, error && error.statusCode ? error.statusCode : 500, {
      error: error && error.code ? error.code : 'dashboard_harness_sessions_failed',
      message: error && error.message ? error.message : 'Unknown error',
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    dashboardHarnessSessions: deps.dashboardHarnessSessions || dashboardHarnessSessionsLib,
    snapshotStore: deps.snapshotStore || null,
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
    {
      method: 'GET',
      path: '/api/dashboard/harness-sessions/summary',
      handler: (ctx) => handleDashboardHarnessSessionsSummary(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/dashboard/harness-sessions/page',
      handler: (ctx) => handleDashboardHarnessSessionsPage(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/dashboard\/harness-sessions\/([^/]+)$/,
      handler: (ctx) => handleDashboardHarnessSessionsPage(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
