'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { logInfo, logError } = require('./installLog');

const VALID_INSTALL_SURFACE_TARGETS = ['codex', 'antigravity', 'opencode', 'claude', 'all'];

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
  return target === 'all' ? ['codex', 'antigravity', 'opencode', 'claude'] : [target];
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

async function installClaudeSurface(options) {
  const installerModule = await loadInstallerModule(options.engineRoot, 'claude-install.mjs');
  return installerModule.runInstall({
    dryRun: options.dryRun,
    force: options.force,
    claudeHome: options.claudeHome,
    skillsHome: options.claudeSkillsHome,
  });
}

async function installSurfaces(options = {}) {
  const target = normalizeTarget(options.target);
  if (!options.engineRoot) {
    throw new Error('engineRoot is required');
  }

  const force = Boolean(options.force);
  logInfo('install-surfaces', `Starting surface install: target=${target}, force=${force}`);

  const summaries = [];
  for (const surface of buildTargetList(target)) {
    try {
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
        continue;
      }
      if (surface === 'claude') {
        summaries.push(await installClaudeSurface(options));
      }
    } catch (error) {
      logError('install-surfaces', `Failed to install ${surface}: ${error.message}`);
      throw error;
    }
  }

  const summaryParts = summaries.map((s) => {
    const counts = s.counts || {};
    return `${s.surface || 'unknown'}: ${counts.total || 0} total, ${counts.created || 0} created, ${counts.updated || 0} updated`;
  });
  logInfo('install-surfaces', `Surface install completed: ${summaryParts.join('; ')}`);

  return {
    target,
    dryRun: Boolean(options.dryRun),
    force,
    surfaces: summaries,
  };
}

module.exports = {
  VALID_INSTALL_SURFACE_TARGETS,
  installSurfaces,
};
