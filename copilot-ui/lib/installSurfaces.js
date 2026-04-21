'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const VALID_INSTALL_SURFACE_TARGETS = ['copilot', 'codex', 'antigravity', 'all'];

function createStatusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeTarget(target) {
  const normalized = String(target || '').trim().toLowerCase();
  if (!normalized) {
    throw createStatusError(400, 'target is required');
  }
  if (!VALID_INSTALL_SURFACE_TARGETS.includes(normalized)) {
    throw createStatusError(
      400,
      `target must be one of: ${VALID_INSTALL_SURFACE_TARGETS.join(', ')}`,
    );
  }
  return normalized;
}

function buildTargetList(target) {
  return target === 'all' ? ['copilot', 'codex', 'antigravity'] : [target];
}

function uniqueHomes(copilotHomeAbs, vscodeHomeAbs) {
  const seen = new Set();
  const homes = [];

  for (const item of [
    { kind: 'copilot', home: copilotHomeAbs },
    { kind: 'vscode', home: vscodeHomeAbs },
  ]) {
    if (!item.home) {
      continue;
    }
    const resolved = path.resolve(item.home);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    homes.push({ kind: item.kind, home: resolved });
  }

  return homes;
}

async function loadInstallerModule(engineRoot, fileName) {
  const moduleUrl = pathToFileURL(path.join(path.resolve(engineRoot), 'scripts', fileName)).href;
  const installerModule = await import(moduleUrl);
  if (!installerModule || typeof installerModule.runInstall !== 'function') {
    throw new Error(`Installer module is missing runInstall(): ${fileName}`);
  }
  return installerModule;
}

function installCopilotSurface(options) {
  const homes = uniqueHomes(options.copilotHomeAbs, options.vscodeHomeAbs);
  const syncRuns = homes.map((home) => ({
    homeKind: home.kind,
    home: home.home,
    result: options.assets.syncAll(options.engineRoot, home.home, {
      dryRun: options.dryRun,
      force: options.force,
      pointerMode: options.pointerMode !== false,
    }),
  }));

  let settingsPatch = null;
  if (typeof options.runVscodeSettingsPatcher === 'function' && options.vscodeHomeAbs) {
    settingsPatch = options.runVscodeSettingsPatcher({
      engineRoot: options.engineRoot,
      vscodeHome: options.vscodeHomeAbs,
      dryRun: options.dryRun,
    });
    if (settingsPatch && settingsPatch.ok === false) {
      throw new Error(
        `VS Code settings patch failed: ${String(settingsPatch.stderr || settingsPatch.stdout || settingsPatch.exitCode || 'unknown error')}`,
      );
    }
  }

  return {
    surface: 'copilot',
    ok: true,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    pointerMode: options.pointerMode !== false,
    homes: {
      copilotHome: options.copilotHomeAbs ? path.resolve(options.copilotHomeAbs) : null,
      vscodeHome: options.vscodeHomeAbs ? path.resolve(options.vscodeHomeAbs) : null,
    },
    runs: syncRuns,
    settingsPatch,
  };
}

async function installCodexSurface(options) {
  const installerModule = await loadInstallerModule(options.engineRoot, 'codex-install.mjs');
  return installerModule.runInstall({
    dryRun: options.dryRun,
    force: options.force,
    codexHome: options.codexHome,
    skillsHome: options.codexSkillsHome,
  });
}

async function installAntigravitySurface(options) {
  const installerModule = await loadInstallerModule(options.engineRoot, 'antigravity-install.mjs');
  return installerModule.runInstall({
    dryRun: options.dryRun,
    force: options.force,
    geminiHome: options.geminiHome,
    antigravityHome: options.antigravityHome,
    skillsHome: options.antigravitySkillsHome,
  });
}

async function installSurfaces(options = {}) {
  const target = normalizeTarget(options.target);
  if (!options.engineRoot) {
    throw new Error('engineRoot is required');
  }
  if (!options.assets || typeof options.assets.syncAll !== 'function') {
    throw new Error('assets.syncAll is required');
  }

  const summaries = [];
  for (const surface of buildTargetList(target)) {
    if (surface === 'copilot') {
      summaries.push(installCopilotSurface(options));
      continue;
    }
    if (surface === 'codex') {
      summaries.push(await installCodexSurface(options));
      continue;
    }
    if (surface === 'antigravity') {
      summaries.push(await installAntigravitySurface(options));
      continue;
    }
  }

  return {
    target,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    surfaces: summaries,
  };
}

module.exports = {
  VALID_INSTALL_SURFACE_TARGETS,
  installSurfaces,
};
