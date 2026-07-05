'use strict';

const toolCliInstallers = require('../lib/toolCliInstallers');
const codexSubagentsDefault = require('../lib/codexSubagents');
const telemetryServiceDefault = require('../lib/telemetryService');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const path = require('path');
const os = require('os');

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallers,
    codexSubagents: deps.codexSubagents || codexSubagentsDefault,
    telemetryService: deps.telemetryService || telemetryServiceDefault,
    fs: deps.fs || require('fs'),
    path: deps.path || path,
  };

  return [
    {
      method: 'GET',
      path: '/api/codex/cli/status',
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const cliStatus = resolvedDeps.toolCliInstallers.getCliToolStatus('codex-cli');
          resolvedDeps.sendJson(ctx.res, 200, {
            codexHome,
            cli: cliStatus,
          });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/codex/cli/install',
      handler: async (ctx) => {
        try {
          const result = await resolvedDeps.toolCliInstallers.installCliTool('codex-cli');
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const cliStatus = resolvedDeps.toolCliInstallers.getCliToolStatus('codex-cli');
          resolvedDeps.sendJson(ctx.res, result.ok ? 200 : 500, {
            ok: result.ok,
            version: result.version,
            error: result.error,
            codexHome,
            cli: cliStatus,
          });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/codex/subagents',
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const repoPath = ctx.u.searchParams.get('repoPath') || '';
          const usage = resolvedDeps.telemetryService.buildCodexSubagentUsage({
            codexHome,
            limit: 200,
          });
          const result = resolvedDeps.codexSubagents.listCodexSubagents({
            codexHome,
            repoPath,
            engineRoot: ctx.engineRoot,
            usageByAgent: usage.byAgent,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'PUT',
      path: '/api/codex/subagents/settings',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const result = resolvedDeps.codexSubagents.saveSettings(codexHome, body || {});
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, ...result });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/codex\/subagents\/([^/]+)$/,
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const result = resolvedDeps.codexSubagents.updateCodexSubagent(decodeURIComponent(ctx.match[1]), body || {}, {
            codexHome,
            engineRoot: ctx.engineRoot,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/codex\/subagents\/([^/]+)\/reset$/,
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const result = resolvedDeps.codexSubagents.resetCodexSubagent(decodeURIComponent(ctx.match[1]), {
            codexHome,
            engineRoot: ctx.engineRoot,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'DELETE',
      path: /^\/api\/codex\/subagents\/([^/]+)$/,
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const force = ctx.u.searchParams.get('force') === 'true';
          const result = resolvedDeps.codexSubagents.uninstallCodexSubagent(decodeURIComponent(ctx.match[1]), {
            codexHome,
            engineRoot: ctx.engineRoot,
            force,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/codex/subagents/usage',
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(os.homedir(), '.codex');
          const limit = Number(ctx.u.searchParams.get('limit') || 100);
          const result = resolvedDeps.telemetryService.buildCodexSubagentUsage({
            codexHome,
            limit,
          });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, error.statusCode || 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  ];
}

module.exports = { register };
