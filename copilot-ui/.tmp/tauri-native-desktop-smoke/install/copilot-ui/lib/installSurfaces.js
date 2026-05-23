'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const VALID_INSTALL_SURFACE_TARGETS = ['codex', 'antigravity', 'opencode', 'all'];

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
  return target === 'all' ? ['codex', 'antigravity', 'opencode'] : [target];
}

async function loadInstallerModule(engineRoot, fileName) {
  const moduleUrl = pathToFileURL(path.join(path.resolve(engineRoot), 'scripts', fileName)).href;
  const installerModule = await import(moduleUrl);
  if (!installerModule || typeof installerModule.runInstall !== 'function') {
    throw new Error(`Installer module is missing runInstall(): ${fileName}`);
  }
  return installerModule;
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

async function installOpenCodeSurface(options) {
  const installerModule = await loadInstallerModule(options.engineRoot, 'opencode-install.mjs');
  return installerModule.runInstall({
    dryRun: options.dryRun,
    force: options.force,
    opencodeHome: options.opencodeHome,
    skillsHome: options.opencodeSkillsHome,
  });
}

async function installSurfaces(options = {}) {
  const target = normalizeTarget(options.target);
  if (!options.engineRoot) {
    throw new Error('engineRoot is required');
  }

  const summaries = [];
  for (const surface of buildTargetList(target)) {
    if (surface === 'codex') {
      summaries.push(await installCodexSurface(options));
      continue;
    }
    if (surface === 'antigravity') {
      summaries.push(await installAntigravitySurface(options));
      continue;
    }
    if (surface === 'opencode') {
      summaries.push(await installOpenCodeSurface(options));
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
