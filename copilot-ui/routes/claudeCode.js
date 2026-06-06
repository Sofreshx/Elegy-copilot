'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const toolCliInstallersDefault = require('../lib/toolCliInstallers');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallersDefault,
    fs: deps.fs || fs,
    path: deps.path || path,
    os: deps.os || os,
  };

  return [
    {
      method: 'GET',
      path: '/api/claude-code/status',
      handler: async (ctx) => {
        try {
          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');
          const claudeConfigPath = resolvedDeps.path.join(claudeHome, 'config.json');
          const configExists = resolvedDeps.fs.existsSync(claudeConfigPath);
          const cliStatus = resolvedDeps.toolCliInstallers.getCliToolStatus('claude-code-cli');

          const overallStatus = cliStatus.installed
            ? 'ready'
            : (cliStatus.lastError ? 'blocked' : 'degraded');

          resolvedDeps.sendJson(ctx.res, 200, {
            overallStatus,
            claudeHome,
            claudeConfigPath: configExists ? claudeConfigPath : null,
            cli: {
              installed: cliStatus.installed,
              version: cliStatus.version,
              installCommand: cliStatus.installCommand,
              lastError: cliStatus.lastError,
            },
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
      path: '/api/claude-code/cli/install',
      handler: async (ctx) => {
        try {
          const result = await resolvedDeps.toolCliInstallers.installCliTool('claude-code-cli');

          // Re-fetch status to include updated info
          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');
          const claudeConfigPath = resolvedDeps.path.join(claudeHome, 'config.json');
          const configExists = resolvedDeps.fs.existsSync(claudeConfigPath);
          const cliStatus = resolvedDeps.toolCliInstallers.getCliToolStatus('claude-code-cli');

          const overallStatus = cliStatus.installed
            ? 'ready'
            : (cliStatus.lastError ? 'blocked' : 'degraded');

          resolvedDeps.sendJson(ctx.res, 200, {
            ok: result.ok,
            version: result.version,
            error: result.error,
            status: {
              overallStatus,
              claudeHome,
              claudeConfigPath: configExists ? claudeConfigPath : null,
              cli: {
                installed: cliStatus.installed,
                version: cliStatus.version,
                installCommand: cliStatus.installCommand,
                lastError: cliStatus.lastError,
              },
            },
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
