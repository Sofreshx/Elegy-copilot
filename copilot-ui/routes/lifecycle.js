'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const { sendJson: defaultSendJson } = require('./_helpers');

function handlePolicyPreflight(ctx, deps) {
  const { res, u, engineRoot } = ctx;
  const { sendJson, getPolicyPreflight } = deps;
  try {
    const refresh = (u.searchParams.get('refresh') || '').trim() === '1';
    const policy = getPolicyPreflight(engineRoot, { refresh });
    sendJson(res, 200, policy);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err), code: 'internal_error' });
  }
}

function handleHealth(ctx, deps) {
  const {
    res,
    engineRoot,
    sandboxesHome,
    providerState,
    changeTracker,
    elegyHome,
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
    elegyHome,
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
  const { res, elegyHomeAbs } = ctx;
  const { sendJson, path: pathImpl, readJsonFileSafe } = deps;
  const lspConfigPath = pathImpl.join(elegyHomeAbs, 'lsp-config.json');
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

function handleFactoryReset(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  const results = {
    opencode: { status: 'skipped', message: '' },
    codex: { status: 'skipped', message: '' },
  };

  return Promise.resolve()
    .then(async () => {
      const ctx_opencodeHome = ctx.opencodeHome || require('path').join(require('os').homedir(), '.config', 'opencode');

      // Reset OpenCode config
      try {
        const opencodeConfig = require('../lib/opencodeConfig');
        opencodeConfig.resetConfig(ctx_opencodeHome);
        results.opencode = { status: 'ok', message: 'OpenCode config reset to defaults.' };
      } catch (err) {
        results.opencode = { status: 'error', message: `Failed: ${err.message}` };
      }

      // Reset Codex provider config
      try {
        const codexHome = require('path').join(require('os').homedir(), '.codex');
        const fs = require('fs');
        const path = require('path');

        // Remove Elegy-managed Codex files
        const codexConfigPath = path.join(codexHome, 'settings.json');
        const backupPath = path.join(codexHome, 'settings.json.elegy-backup');

        if (fs.existsSync(codexConfigPath)) {
          // Restore from backup if it exists, otherwise remove
          if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, codexConfigPath);
            fs.unlinkSync(backupPath);
            results.codex = { status: 'ok', message: 'Codex provider restored from backup.' };
          } else {
            // Remove Elegy-specific keys from settings
            try {
              const settings = JSON.parse(fs.readFileSync(codexConfigPath, 'utf8'));
              if (settings.enableExperimental) {
                delete settings.enableExperimental;
                fs.writeFileSync(codexConfigPath, JSON.stringify(settings, null, 2));
              }
              results.codex = { status: 'ok', message: 'Codex experimental settings removed.' };
            } catch {
              results.codex = { status: 'ok', message: 'No Codex settings to reset.' };
            }
          }
        } else {
          results.codex = { status: 'skipped', message: 'No Codex config found.' };
        }
      } catch (err) {
        results.codex = { status: 'error', message: `Failed: ${err.message}` };
      }

      const allOk = Object.values(results).every((r) => r.status === 'ok' || r.status === 'skipped');

      sendJson(res, 200, {
        ok: allOk,
        results,
      });
    })
    .catch((error) => {
      sendJson(res, 500, {
        ok: false,
        error: String(error.message || error),
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
      method: 'POST',
      path: '/api/system/factory-reset',
      handler: (ctx) => handleFactoryReset(ctx, resolvedDeps),
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
