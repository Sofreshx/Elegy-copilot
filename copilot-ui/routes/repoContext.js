'use strict';

const { spawnSync } = require('node:child_process');
const path = require('path');
const { sendJson: defaultSendJson } = require('./_helpers');

function getElegyDocsCheckScript() {
  // Resolve relative to this repo's scripts/ directory
  return path.resolve(__dirname, '..', '..', 'scripts', 'elegy-docs-check.js');
}

async function handleRepoContextCheck(ctx, deps) {
  const repoPath = ctx.u.searchParams.get('repo');
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
    const result = spawnSync('node', [scriptPath, '--json', '--target', repoPath], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
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

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    fs: deps.fs || require('node:fs'),
  };

  return [
    {
      method: 'GET',
      path: '/api/repo-context/check',
      handler: (ctx) => handleRepoContextCheck(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
