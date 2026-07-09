'use strict';

const {
  resolveElegyPlanningCliPath,
  installLatestElegyPlanningCli,
  fetchLatestReleaseInfo,
  buildManagedSourceDir,
  readInstallMetadata,
  readElegyAssetsMetadata,
  resolveGitHead,
  syncElegySkillAssetsFromGitHub,
  GITHUB_ELEGY_SKILL_ASSETS,
  clearReleaseCache,
} = require('../lib/elegyPlanningCliResolver');
const assetsLib = require('../lib/assets');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { resolvePlanningHealth, resolvePlanningFeatureStatus, resolvePlanningCliVersion } = require('../lib/elegyPlanningHealth');
const elegyPluginMarketplaceDefault = require('../lib/elegyPluginMarketplace');

function parseVersion(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  const match = normalized.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map((entry) => Number(entry));
}

function compareVersions(left, right) {
  const l = parseVersion(left);
  const r = parseVersion(right);
  if (!l || !r) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (l[i] > r[i]) return 1;
    if (l[i] < r[i]) return -1;
  }
  return 0;
}

function resolvePlanningVersion(cliPath, deps) {
  const childProcess = deps ? deps.childProcess : null;
  return resolvePlanningCliVersion(cliPath, childProcess);
}

function resolvePlanningSchemaVersion(cliPath, deps) {
  const childProcess = deps ? deps.childProcess : null;
  const health = resolvePlanningHealth(cliPath, childProcess);
  return health.schemaVersion;
}

function buildElegySkillAssetsStatus(targetHome, sourceRepoRoot, sourceGitHead) {
  const metadata = targetHome ? readElegyAssetsMetadata(targetHome) : null;
  const installedAssets = Array.isArray(metadata?.assets) ? metadata.assets : [];
  const installedById = new Map(installedAssets.map((asset) => [asset.id, asset]));
  const assets = GITHUB_ELEGY_SKILL_ASSETS.map((asset) => {
    const installed = installedById.get(asset.id);
    const destinationPath = installed?.destinationPath || (targetHome ? `${targetHome}/${asset.destination}` : null);
    return {
      id: asset.id,
      upToDate: Boolean(
        installed
          && metadata?.source === 'github-source'
          && metadata?.sourceGitHead
          && sourceGitHead
          && metadata.sourceGitHead === sourceGitHead
      ),
      installed: Boolean(installed),
      source: `github:${asset.source}`,
      destination: asset.destination,
      destinationPath,
    };
  });
  const outdated = assets.filter((asset) => asset.upToDate !== true);

  return {
    trackedCount: assets.length,
    outdatedCount: outdated.length,
    updateAvailable: outdated.length > 0,
    canUpdate: Boolean(targetHome),
    source: 'github-source',
    sourceRemote: 'https://github.com/Sofreshx/Elegy.git',
    managedSource: {
      repoRoot: sourceRepoRoot || metadata?.sourceRepoRoot || null,
      gitHead: sourceGitHead || null,
      installedGitHead: metadata?.sourceGitHead || null,
      updateAvailable: outdated.length > 0,
      kind: metadata?.source || null,
      remote: metadata?.sourceRemote || null,
    },
    assets,
    lastError: null,
  };
}

async function buildToolingStatus(ctx, deps, codexHome) {
  const checkedAtMs = Date.now();
  const cliPath = resolveElegyPlanningCliPath({
    cliPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: ctx.engineRoot,
    elegyHome: ctx.elegyHomeAbs,
    env: ctx.env,
  });

  const planningCurrentVersion = resolvePlanningVersion(cliPath, deps);
  const planningSchemaVersion = resolvePlanningSchemaVersion(cliPath, deps);
  const planningFeatures = resolvePlanningFeatureStatus(cliPath, deps.childProcess);
  let planningLatestVersion = null;
  let planningLatestError = null;
  let planningLatestPublishedAt = null;
  try {
    const release = await fetchLatestReleaseInfo(deps.fetchImpl);
    planningLatestVersion = release && release.version ? String(release.version) : null;
    planningLatestPublishedAt = release && release.published_at ? String(release.published_at) : null;
  } catch (error) {
    planningLatestError = error instanceof Error ? error.message : String(error);
  }

  const installedMetadata = ctx.elegyHomeAbs ? readInstallMetadata(ctx.elegyHomeAbs) : null;
  const installedVersion = installedMetadata && typeof installedMetadata.version === 'string'
    ? installedMetadata.version
    : planningCurrentVersion;

  // Timestamp-based update detection for binary download installs
  let timestampUpdateAvailable = false;
  if (planningLatestPublishedAt && installedMetadata && installedMetadata.installedAt) {
    try {
      timestampUpdateAvailable = new Date(planningLatestPublishedAt) > new Date(installedMetadata.installedAt);
    } catch {
      // ignore parse errors
    }
  }

  // Semver comparison (only works if both versions are valid semver)
  let versionUpdateAvailable = false;
  if (planningCurrentVersion && planningLatestVersion) {
    versionUpdateAvailable = compareVersions(planningLatestVersion, planningCurrentVersion) > 0;
  }

  const planningUpdateAvailable = Boolean(
    planningFeatures.complete !== true
      || versionUpdateAvailable
      || timestampUpdateAvailable
  );
  const managedSourceRoot = ctx.elegyHomeAbs ? buildManagedSourceDir(ctx.elegyHomeAbs) : '';
  const sourceRepoRoot = typeof installedMetadata?.sourceRepoRoot === 'string'
    ? installedMetadata.sourceRepoRoot
    : managedSourceRoot;
  const sourceGitHead = sourceRepoRoot
    ? resolveGitHead(sourceRepoRoot, {
        env: ctx.env,
        spawnSyncImpl: deps.childProcess && deps.childProcess.spawnSync,
      })
    : null;
  const installedSourceGitHead = installedMetadata && typeof installedMetadata.sourceGitHead === 'string'
    ? installedMetadata.sourceGitHead
    : null;
  const managedSourceUpdateAvailable = Boolean(
    sourceRepoRoot
      && (
        installedMetadata?.source !== 'github-source'
        || (sourceGitHead && installedSourceGitHead && sourceGitHead !== installedSourceGitHead)
        || (sourceGitHead && !installedSourceGitHead)
      ),
  ) || timestampUpdateAvailable; // Also signal update for binary-download path

  const elegySkillsStatus = buildElegySkillAssetsStatus(ctx.opencodeHome, sourceRepoRoot, sourceGitHead);

  let codexStatus = null;
  let elegyPluginsStatus = null;
  if (codexHome) {
    try {
      codexStatus = buildElegySkillAssetsStatus(codexHome, sourceRepoRoot, sourceGitHead);
    } catch {
      codexStatus = { error: 'Unable to check Codex skill status' };
    }
    try {
      elegyPluginsStatus = await deps.elegyPluginMarketplace.getElegyPluginMarketplaceStatus({
        codexHome,
        env: ctx.env,
        childProcess: deps.childProcess,
      });
    } catch (error) {
      elegyPluginsStatus = {
        marketplaceName: 'elegy',
        marketplaceRoot: `${codexHome}/marketplaces/elegy`,
        status: 'unknown',
        updateAvailable: true,
        canUpdate: Boolean(codexHome),
        plugins: [],
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Check AFT status
  let aftStatus = { clangd: { installed: false } };
  try {
    const clangdResult = deps.childProcess.spawnSync(
      process.platform === 'win32' ? 'where' : 'which',
      ['clangd'],
      { timeout: 5000, windowsHide: true }
    );
    aftStatus.clangd.installed = clangdResult.status === 0;
    if (clangdResult.status === 0 && clangdResult.stdout) {
      aftStatus.clangd.path = String(clangdResult.stdout).trim().split('\n')[0];
      try {
        const versionResult = deps.childProcess.spawnSync(aftStatus.clangd.path || 'clangd', ['--version'], { timeout: 5000 });
        if (versionResult.status === 0) {
          aftStatus.clangd.version = String(versionResult.stdout).trim().split('\n')[0];
        }
      } catch { /* best effort */ }
    }
    if (!aftStatus.clangd.installed) {
      aftStatus.warnings = [
        'clangd not found. Install from https://clangd.llvm.org/installation.html',
        'Use /aft-status in agent to check AFT health',
        'Check plugin log for LSP auto-install errors',
        'Set lsp.auto_install: false in config if auto-install is failing',
        'Verify lsp.versions.clangd in OpenCode/Codex configuration',
      ];
    }
  } catch { /* best effort */ }

  return {
    checkedAtMs,
    elegyPlanningCli: {
      cliPath: cliPath || null,
      currentVersion: installedVersion || planningCurrentVersion || (installedSourceGitHead ? `source:${installedSourceGitHead.slice(0, 12)}` : null),
      schemaVersion: planningSchemaVersion,
      latestVersion: planningLatestVersion,
      updateAvailable: planningUpdateAvailable || managedSourceUpdateAvailable,
      canUpdate: Boolean(ctx.elegyHomeAbs),
      lastError: planningLatestError,
      features: planningFeatures,
      managedSource: {
        repoRoot: sourceRepoRoot || null,
        gitHead: sourceGitHead,
        installedGitHead: installedSourceGitHead,
        updateAvailable: managedSourceUpdateAvailable,
        kind: installedMetadata?.source || null,
        remote: installedMetadata?.sourceRemote || null,
      },
      installMetadata: installedMetadata,
    },
    elegySkillsAssets: elegySkillsStatus,
    codexSkillsAssets: codexStatus,
    elegyPlugins: elegyPluginsStatus,
    aft: aftStatus,
  };
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    assets: deps.assets || assetsLib,
    childProcess: deps.childProcess || require('node:child_process'),
    fetchImpl: deps.fetchImpl,
    elegyPluginMarketplace: deps.elegyPluginMarketplace || elegyPluginMarketplaceDefault,
    env: deps.env || process.env,
  };

  return [
    {
      method: 'GET',
      path: '/api/tooling-updates/status',
      handler: async (ctx) => {
        try {
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, status);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/tooling-updates/check',
      handler: async (ctx) => {
        try {
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, status);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/tooling-updates/update/elegy-planning',
      handler: async (ctx) => {
        try {
          clearReleaseCache(); // Invalidate cached release info
          const installResult = await installLatestElegyPlanningCli({
            elegyHome: ctx.elegyHomeAbs,
            runtimeRoot: ctx.engineRoot,
            env: resolvedDeps.env,
            fetchImpl: resolvedDeps.fetchImpl,
            childProcess: resolvedDeps.childProcess,
          });
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            downloadedPath: installResult.installedPath,
            installMetadata: installResult.metadata,
            status,
          });
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
      path: '/api/tooling-updates/update/elegy-plugins',
      handler: async (ctx) => {
        try {
          if (!ctx.codexHome) {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: 'codexHome is required for Elegy plugin install.',
            });
            return;
          }
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const installResult = await resolvedDeps.elegyPluginMarketplace.installElegyCodexPlugins({
            codexHome: ctx.codexHome,
            env: resolvedDeps.env,
            childProcess: resolvedDeps.childProcess,
            fetchImpl: resolvedDeps.fetchImpl,
            pluginNames: Array.isArray(body.pluginNames) && body.pluginNames.length
              ? body.pluginNames.map((pluginName) => String(pluginName))
              : undefined,
            releaseTag: typeof body.releaseTag === 'string' && body.releaseTag.trim() ? body.releaseTag.trim() : undefined,
          });
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            installResult,
            status,
          });
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
      path: '/api/tooling-updates/update/elegy-skills',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const syncResult = await syncElegySkillAssetsFromGitHub({
            elegyHome: ctx.elegyHomeAbs,
            targetHome: ctx.opencodeHome,
            env: resolvedDeps.env,
            childProcess: resolvedDeps.childProcess,
            force: Boolean(body.force),
          });

          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            syncResult,
            status,
          });
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
      path: '/api/tooling-updates/update/elegy-skills-codex',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const syncResult = await syncElegySkillAssetsFromGitHub({
            elegyHome: ctx.elegyHomeAbs,
            targetHome: ctx.codexHome,
            env: resolvedDeps.env,
            childProcess: resolvedDeps.childProcess,
            force: Boolean(body.force),
          });

          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps, ctx.codexHome);
          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            syncResult,
            status,
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
};
