'use strict';

const { spawnSync } = require('node:child_process');
const path = require('path');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { createDocsRepairService } = require('../lib/docsRepairService');

function getElegyDocsCheckScript() {
  // Resolve relative to this repo's scripts/ directory
  return path.resolve(__dirname, '..', '..', 'scripts', 'elegy-docs-check.js');
}

async function handleRepoContextCheck(ctx, deps) {
  const repoPath = ctx.u.searchParams.get('repo');
  const check = ctx.u.searchParams.get('check') || 'all';
  if (!repoPath) {
    deps.sendJson(ctx.res, 400, { ok: false, error: 'Missing ?repo=<path> query parameter.' });
    return;
  }

  const scriptPath = getElegyDocsCheckScript();
  const fs = deps.fs || require('node:fs');

  if (!fs.existsSync(scriptPath)) {
    deps.sendJson(ctx.res, 500, { ok: false, error: `Drift check script not found at ${scriptPath}` });
    return;
  }

  try {
    const args = [scriptPath, '--json', '--target', repoPath];
    if (check !== 'all') {
      args.push('--check', check);
    }
    const result = spawnSync('node', args, {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error) {
      deps.sendJson(ctx.res, 500, { ok: false, error: `Failed to run drift check: ${result.error.message}` });
      return;
    }

    let report;
    try {
      report = JSON.parse(result.stdout || '{}');
    } catch (parseError) {
      deps.sendJson(ctx.res, 500, { ok: false, error: `Failed to parse drift check output: ${parseError.message}`, raw: result.stdout });
      return;
    }

    deps.sendJson(ctx.res, 200, {
      ok: true,
      report,
      exitCode: result.status,
      stderr: result.stderr || null,
    });
  } catch (error) {
    deps.sendJson(ctx.res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleListRepairs(ctx, deps) {
  const repoPath = (ctx.u.searchParams.get('repoPath') || ctx.u.searchParams.get('repo') || '').trim();
  const repoId = (ctx.u.searchParams.get('repoId') || '').trim() || null;
  if (!repoPath) {
    deps.sendJson(ctx.res, 400, { ok: false, error: 'Missing ?repoPath=<path> query parameter.' });
    return;
  }
  try {
    deps.sendJson(ctx.res, 200, deps.docsRepairService.getStatus(repoPath, repoId));
  } catch (error) {
    deps.sendJson(ctx.res, error.statusCode || 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleCreateRepair(ctx, deps) {
  try {
    const body = await deps.readJsonBody(ctx.req);
    const result = await deps.docsRepairService.startRepair(body || {});
    deps.sendJson(ctx.res, 202, result);
  } catch (error) {
    deps.sendJson(ctx.res, error.statusCode || 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleGetRepair(ctx, deps) {
  const runId = decodeURIComponent(ctx.match[1] || '').trim();
  const repoPath = (ctx.u.searchParams.get('repoPath') || ctx.u.searchParams.get('repo') || '').trim() || null;
  const repoId = (ctx.u.searchParams.get('repoId') || '').trim() || null;
  try {
    const run = deps.docsRepairService.getRun(runId, repoPath, repoId);
    if (!run) {
      deps.sendJson(ctx.res, 404, { ok: false, error: 'Docs repair run not found.' });
      return;
    }
    deps.sendJson(ctx.res, 200, { run });
  } catch (error) {
    deps.sendJson(ctx.res, error.statusCode || 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    fs: deps.fs || require('node:fs'),
    docsRepairService: deps.docsRepairService || createDocsRepairService({
      elegyHome: deps.elegyHome,
      engineRoot: deps.engineRoot,
    }),
  };

  return [
    {
      method: 'GET',
      path: '/api/repo-context/check',
      handler: (ctx) => handleRepoContextCheck(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/repo-context/repairs',
      handler: (ctx) => handleListRepairs(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/repo-context/repairs',
      handler: (ctx) => handleCreateRepair(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/repo-context\/repairs\/([^/]+)$/,
      handler: (ctx) => handleGetRepair(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register, handleListRepairs, handleCreateRepair, handleGetRepair };
