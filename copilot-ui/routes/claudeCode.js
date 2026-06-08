'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const toolCliInstallersDefault = require('../lib/toolCliInstallers');
const claudeCodeConfigDefault = require('../lib/claudeCodeConfig');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallersDefault,
    claudeCodeConfig: deps.claudeCodeConfig || claudeCodeConfigDefault,
    resolveOpencodeGoApiKey: deps.resolveOpencodeGoApiKey || null,
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

    // ── Provider switching endpoints ──

    {
      method: 'GET',
      path: '/api/claude-code/provider',
      handler: async (ctx) => {
        try {
          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');
          const status = resolvedDeps.claudeCodeConfig.getStatus(claudeHome, resolvedDeps.resolveOpencodeGoApiKey);
          resolvedDeps.sendJson(ctx.res, 200, status);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'PUT',
      path: '/api/claude-code/provider',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const mode = typeof body.mode === 'string' ? body.mode.trim() : '';
          const validModes = ['vanilla', 'opencode-go', 'deepseek-direct'];
          if (!validModes.includes(mode)) {
            resolvedDeps.sendJson(ctx.res, 400, {
              error: `Invalid mode. Must be one of: ${validModes.join(', ')}`,
            });
            return;
          }

          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');
          const status = resolvedDeps.claudeCodeConfig.setMode(claudeHome, mode, {
            apiKey: body.apiKey || undefined,
            resolveOpenCodeGoApiKey: resolvedDeps.resolveOpencodeGoApiKey,
          });

          resolvedDeps.sendJson(ctx.res, 200, { ok: true, mode, status });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/claude-code/provider/reset',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const restore = body.restore === true;
          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');

          let status;
          if (restore) {
            status = resolvedDeps.claudeCodeConfig.restoreFromBackup(claudeHome, resolvedDeps.resolveOpencodeGoApiKey);
          } else {
            status = resolvedDeps.claudeCodeConfig.resetToVanilla(claudeHome);
          }

          resolvedDeps.sendJson(ctx.res, 200, { ok: true, status });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'PUT',
      path: '/api/claude-code/provider/deepseek-key',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const apiKey = typeof body.apiKey === 'string' ? body.apiKey : '';
          const claudeHome = resolvedDeps.path.join(resolvedDeps.os.homedir(), '.claude');

          const result = resolvedDeps.claudeCodeConfig.saveDeepseekApiKey(claudeHome, apiKey);
          resolvedDeps.sendJson(ctx.res, 200, result);
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
