'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { CLI_TOOLING_CATALOG, runCliInstall, detectCliToolAsync, probeAftClangdAsync } = require('../lib/cliTooling');
const { createAsyncProcessService, getDefaultAsyncProcessService } = require('../lib/asyncProcessService');

function requestAbortSignal(req, res) {
  if (!req || typeof req.once !== 'function') return undefined;
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  if (res && typeof res.once === 'function') {
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
  }
  return controller.signal;
}

async function buildCliToolingStatus(deps, signal) {
  const processService = deps.processService || getDefaultAsyncProcessService();
  const tools = await Promise.all(CLI_TOOLING_CATALOG.map((tool) =>
    detectCliToolAsync(tool.id, { processService, signal }),
  ));

  // RTK version probe
  let rtkStatus = { installed: false, lastError: 'Not checked' };
  try {
    const rtkProbe = await processService.run('rtk', ['--version'], {
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
      cacheTtlMs: 30_000,
      dedupeKey: 'cli-status:rtk:version',
      signal,
    });
    const match = rtkProbe.stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
    rtkStatus = {
      installed: rtkProbe.status === 0,
      version: match ? match[1] : null,
      error: rtkProbe.status === 0 ? null : rtkProbe.error || rtkProbe.stderr.trim() || 'rtk not found',
      remediation: rtkProbe.status === 0 ? null : ['Install RTK and ensure it is available on PATH.'],
    };
  } catch { /* best effort */ }

  // AFT clangd probe
  let aftStatus = { clangd: { installed: false, warnings: [] } };
  try {
    const clangdProbe = await probeAftClangdAsync({ processService, signal });
    aftStatus = {
      clangd: clangdProbe,
      warnings: clangdProbe.installed ? [] : ['clangd install failed or not found. Use /aft-status in agent, check plugin log, or set lsp.auto_install: false.'],
    };
  } catch { /* best effort */ }

  return {
    ok: true,
    npmAvailable: (await processService.run('npm', ['--version'], {
      timeoutMs: 5_000,
      maxOutputBytes: 64 * 1024,
      cacheTtlMs: 30_000,
      dedupeKey: 'cli-status:npm:version',
      shell: process.platform === 'win32',
      signal,
    })).status === 0,
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
    processService: deps.processService || (deps.childProcess
      ? createAsyncProcessService({ childProcess: deps.childProcess })
      : getDefaultAsyncProcessService()),
  };

  return [
    {
      method: 'GET',
      path: '/api/tooling/cli/status',
      handler: async (ctx) => {
        try {
          const status = await buildCliToolingStatus(resolvedDeps, requestAbortSignal(ctx.req, ctx.res));
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
