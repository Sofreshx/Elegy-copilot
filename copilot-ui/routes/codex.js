'use strict';

const toolCliInstallers = require('../lib/toolCliInstallers');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const path = require('path');
const os = require('os');

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallers,
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
  ];
}

module.exports = { register };
