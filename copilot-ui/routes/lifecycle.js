'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { sendJson: defaultSendJson } = require('./_helpers');

function handlePolicyPreflight(ctx, deps) {
  const { res, u, engineRoot } = ctx;
  const { sendJson, getPolicyPreflight } = deps;

  const refresh = (u.searchParams.get('refresh') || '').trim() === '1';
  const policy = getPolicyPreflight(engineRoot, { refresh });
  sendJson(res, 200, policy);
}

function handleHealth(ctx, deps) {
  const {
    res,
    engineRoot,
    sandboxesHome,
    providerState,
    changeTracker,
    copilotHome,
    vscodeHome,
    planningPersistenceConfig,
    planningPersistenceState,
    planningDurabilityDependencyGate,
    activePlanningDurabilityDependencyGate,
    startupManagedAssetSync,
    autonomousDecisionLog,
  } = ctx;
  const {
    sendJson,
    getRuntimeHealth,
    getPolicyPreflight,
    getPlanningPersistenceHealth,
    buildPlanningPersistenceHealthEnvelope,
  } = deps;

  const changes = changeTracker ? changeTracker.get() : null;
  const runtime = getRuntimeHealth({ engineRoot, sandboxesHome, providerState });
  const policy = getPolicyPreflight(engineRoot);
  const planningPersistenceRaw = getPlanningPersistenceHealth(planningPersistenceConfig, planningPersistenceState);
  const planningPersistence = buildPlanningPersistenceHealthEnvelope(planningPersistenceRaw);
  const autonomousDecisionLogSummary = autonomousDecisionLog && typeof autonomousDecisionLog.getSummary === 'function'
    ? autonomousDecisionLog.getSummary()
    : null;

  sendJson(res, 200, {
    ok: true,
    now: Date.now(),
    engineRoot,
    copilotHome,
    vscodeHome,
    changes,
    runtime,
    policy,
    planningPersistence,
    planningDurabilityDependencyGate: activePlanningDurabilityDependencyGate || planningDurabilityDependencyGate,
    startupManagedAssetSync,
    autonomousDecisionLog: autonomousDecisionLogSummary,
  });
}

function handleVersion(ctx, deps) {
  const { res, changeTracker } = ctx;
  const { sendJson } = deps;
  const changes = changeTracker ? changeTracker.get() : { version: 0, lastChangedMs: null };
  sendJson(res, 200, changes);
}

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
    getPolicyPreflight: deps.getPolicyPreflight,
    getRuntimeHealth: deps.getRuntimeHealth,
    getPlanningPersistenceHealth: deps.getPlanningPersistenceHealth,
    buildPlanningPersistenceHealthEnvelope: deps.buildPlanningPersistenceHealthEnvelope,
    readJsonFileSafe: deps.readJsonFileSafe,
  };

  return [
    {
      method: 'GET',
      path: '/api/policy/preflight',
      handler: (ctx) => handlePolicyPreflight(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/health',
      handler: (ctx) => handleHealth(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/version',
      handler: (ctx) => handleVersion(ctx, resolvedDeps),
    },
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
