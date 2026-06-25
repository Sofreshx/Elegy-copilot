'use strict';

const { sendJson: defaultSendJson } = require('./_helpers');

function register(deps = {}) {
  const sendJson = deps.sendJson || defaultSendJson;

  return [
    {
      method: 'GET',
      path: '/api/orchestrator/health',
      handler: (ctx) => {
        sendJson(ctx.res, 200, {
          schemaVersion: 'orchestrator-health/v1',
          ok: false,
          planning: { compatible: false, negotiated: false, cliPath: null },
          adapters: [],
          journal: { ready: false, journalCount: 0 },
          orphanRecovery: { ready: false, recoverableJournalCount: 0 },
          pilot: {
            enabled: false,
            allowedAdapters: ['native', 'codex-exec', 'opencode-acp'],
            oneActiveRunPerRepository: true,
            approvedOperation: 'commit',
            mergeRequested: false,
            mergeEnabled: false,
            telemetryPath: '',
            telemetryReady: false,
            telemetryError: null,
            telemetryEventCount: 0,
          },
        });
      },
    },
    {
      method: 'GET',
      path: '/api/orchestrator/sessions',
      handler: (ctx) => {
        sendJson(ctx.res, 200, { sessions: [] });
      },
    },
    {
      method: 'POST',
      path: '/api/orchestrator/sessions',
      handler: (ctx) => {
        sendJson(ctx.res, 503, {
          code: 'not_available',
          message: 'Orchestrator is not available. Set ELEGY_ORCHESTRATOR_EXPERIMENTAL=1 to enable.',
        });
      },
    },
    {
      method: 'GET',
      path: /^\/api\/orchestrator\/sessions\/([^/]+)$/,
      handler: (ctx) => {
        sendJson(ctx.res, 404, { error: 'Session not found' });
      },
    },
    {
      method: 'POST',
      path: /^\/api\/orchestrator\/sessions\/[^/]+\/(retry|resume|cancel|approvals|input|work-points)$/,
      handler: (ctx) => {
        sendJson(ctx.res, 404, { error: 'Session not found' });
      },
    },
    {
      method: 'GET',
      path: /^\/api\/orchestrator\/sessions\/[^/]+\/events$/,
      handler: (ctx) => {
        sendJson(ctx.res, 404, { error: 'Session event stream not available' });
      },
    },
  ];
}

module.exports = { register };
