'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { sendJson: defaultSendJson } = require('./_helpers');

function handleLspConfig(ctx, deps) {
  const { res, copilotHomeAbs } = ctx;
  const { sendJson, path: pathImpl, readJsonFileSafe } = deps;
  const lspConfigPath = pathImpl.join(copilotHomeAbs, 'lsp-config.json');
  const config = readJsonFileSafe(lspConfigPath);
  sendJson(res, 200, { config: config || {} });
}

function handleLspInstall(ctx, deps) {
  const { res, engineRoot } = ctx;
  const { sendJson, fs: fsImpl, path: pathImpl, process: processImpl, childProcess: childProcessImpl } = deps;
  const isWin = processImpl.platform === 'win32';
  const scriptName = isWin ? 'install-lsp.ps1' : 'install-lsp.sh';
  const scriptPath = pathImpl.join(engineRoot, 'scripts', scriptName);

  if (!fsImpl.existsSync(scriptPath)) {
    sendJson(res, 404, { error: `Install script not found: ${scriptPath}` });
    return;
  }

  let cmd;
  let args;
  if (isWin) {
    cmd = 'powershell.exe';
    args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
  } else {
    cmd = 'bash';
    args = [scriptPath];
  }

  childProcessImpl.execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    sendJson(res, 200, {
      ok: !error,
      stdout,
      stderr,
      error: error ? error.message : null,
    });
  });
}

function register(deps = {}) {
  const resolvedDeps = {
    fs: deps.fs || fs,
    path: deps.path || path,
    process: deps.process || process,
    childProcess: deps.childProcess || childProcess,
    sendJson: deps.sendJson || defaultSendJson,
    readJsonFileSafe: deps.readJsonFileSafe,
  };

  return [
    {
      method: 'GET',
      path: '/api/lsp/config',
      handler: (ctx) => handleLspConfig(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/lsp/install',
      handler: (ctx) => handleLspInstall(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
