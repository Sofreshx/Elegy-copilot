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
} = require('../lib/elegyPlanningCliResolver');
const assetsLib = require('../lib/assets');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const { resolvePlanningHealth, resolvePlanningFeatureStatus } = require('../lib/elegyPlanningHealth');

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
  const health = resolvePlanningHealth(cliPath, childProcess);
  return health.version;
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
    cliPath: ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: ctx.engineRoot,
    copilotHome: ctx.copilotHomeAbs,
    env: ctx.env,
  });

  const planningCurrentVersion = resolvePlanningVersion(cliPath, deps);
  const planningFeatures = resolvePlanningFeatureStatus(cliPath, deps.childProcess);
  let planningLatestVersion = null;
  let planningLatestError = null;
  try {
    const release = await fetchLatestReleaseInfo(deps.fetchImpl);
    planningLatestVersion = release && release.version ? String(release.version) : null;
  } catch (error) {
    planningLatestError = error instanceof Error ? error.message : String(error);
  }

  const planningUpdateAvailable = Boolean(
    planningFeatures.complete !== true
      || (
        planningCurrentVersion
      && planningLatestVersion
      && compareVersions(planningLatestVersion, planningCurrentVersion) > 0
      ),
  );

  const installedMetadata = ctx.copilotHomeAbs ? readInstallMetadata(ctx.copilotHomeAbs) : null;
  const managedSourceRoot = ctx.copilotHomeAbs ? buildManagedSourceDir(ctx.copilotHomeAbs) : '';
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
  );

  const elegySkillsStatus = buildElegySkillAssetsStatus(ctx.opencodeHome, sourceRepoRoot, sourceGitHead);

  let codexStatus = null;
  if (codexHome) {
    try {
      codexStatus = buildElegySkillAssetsStatus(codexHome, sourceRepoRoot, sourceGitHead);
    } catch {
      codexStatus = { error: 'Unable to check Codex skill status' };
    }
  }

  return {
    checkedAtMs,
    elegyPlanningCli: {
      cliPath: cliPath || null,
      currentVersion: planningCurrentVersion || (installedSourceGitHead ? `source:${installedSourceGitHead.slice(0, 12)}` : null),
      latestVersion: planningLatestVersion,
      updateAvailable: planningUpdateAvailable || managedSourceUpdateAvailable,
      canUpdate: Boolean(ctx.copilotHomeAbs),
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
  };
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    assets: deps.assets || assetsLib,
    childProcess: deps.childProcess || require('node:child_process'),
    fetchImpl: deps.fetchImpl,
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
          const installResult = await installLatestElegyPlanningCli({
            copilotHome: ctx.copilotHomeAbs,
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
      path: '/api/tooling-updates/update/elegy-skills',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const syncResult = await syncElegySkillAssetsFromGitHub({
            copilotHome: ctx.copilotHomeAbs,
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
            copilotHome: ctx.copilotHomeAbs,
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
