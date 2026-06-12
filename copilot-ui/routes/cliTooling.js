'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { CLI_TOOLING_CATALOG, runCliInstall, detectCliTool, probeAftClangd } = require('../lib/cliTooling');
const { isNpmAvailable } = require('../lib/toolCliInstallers');

function buildCliToolingStatus(deps) {
  const childProcess = deps.childProcess || require('node:child_process');
  const tools = CLI_TOOLING_CATALOG.map((tool) =>
    detectCliTool(tool.id, { childProcess }),
  );

  // RTK version probe
  let rtkStatus = { installed: false, lastError: 'Not checked' };
  try {
    const { probeRtkVersion } = require('../lib/externalSources');
    const rtkProbe = probeRtkVersion(childProcess || require('node:child_process'));
    rtkStatus = { installed: rtkProbe.ok, version: rtkProbe.version || null, error: rtkProbe.error || null, remediation: rtkProbe.remediation || null };
  } catch { /* best effort */ }

  // AFT clangd probe
  let aftStatus = { clangd: { installed: false, warnings: [] } };
  try {
    const clangdProbe = probeAftClangd(childProcess);
    aftStatus = {
      clangd: clangdProbe,
      warnings: clangdProbe.installed ? [] : ['clangd install failed or not found. Use /aft-status in agent, check plugin log, or set lsp.auto_install: false.'],
    };
  } catch { /* best effort */ }

  return {
    ok: true,
    npmAvailable: isNpmAvailable(),
    tools,
    rtk: rtkStatus,
    aft: aftStatus,
    checkedAt: new Date().toISOString(),
  };
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    childProcess: deps.childProcess || require('node:child_process'),
  };

  return [
    {
      method: 'GET',
      path: '/api/tooling/cli/status',
      handler: (ctx) => {
        try {
          const status = buildCliToolingStatus(resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, status);
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
      path: '/api/tooling/cli/install',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const { toolId, dryRun } = body || {};

          if (!toolId || typeof toolId !== 'string') {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: 'toolId is required',
            });
            return;
          }

          const tool = CLI_TOOLING_CATALOG.find((entry) => entry.id === toolId);
          if (!tool) {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: `Unknown CLI tool: ${toolId}`,
            });
            return;
          }

          const result = runCliInstall(toolId, {
            dryRun: Boolean(dryRun),
            childProcess: resolvedDeps.childProcess,
          });

          if (!result.ok) {
            resolvedDeps.sendJson(ctx.res, 500, result);
            return;
          }

          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            toolId: tool.id,
            title: tool.title,
            npmPackage: tool.npmPackage,
            ...result,
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

module.exports = {
  register,
  buildCliToolingStatus,
};
