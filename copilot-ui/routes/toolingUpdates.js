'use strict';

const {
  resolveElegyPlanningCliPath,
  downloadElegyPlanningCli,
  fetchLatestReleaseInfo,
} = require('../lib/elegyPlanningCliResolver');
const assetsLib = require('../lib/assets');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

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
  const command = typeof cliPath === 'string' ? cliPath.trim() : '';
  if (!command) {
    return null;
  }
  const childProcess = deps.childProcess;
  if (!childProcess || typeof childProcess.spawnSync !== 'function') {
    return null;
  }

  try {
    const result = childProcess.spawnSync(command, ['--version'], {
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
      env: deps.env,
    });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function mapManagedSkillAsset(asset) {
  return {
    id: asset.id,
    upToDate: asset.upToDate === true,
    installed: asset.installed === true,
    source: asset.source,
    destination: asset.destination,
  };
}

function filterElegySkillAssets(assets) {
  return (Array.isArray(assets) ? assets : []).filter((asset) => {
    const source = typeof asset.source === 'string' ? asset.source.toLowerCase() : '';
    const id = typeof asset.id === 'string' ? asset.id.toLowerCase() : '';
    return source.includes('catalog-assets/shared-skills/elegy-')
      || id.includes('elegy-planning')
      || id.includes('elegy-skills');
  });
}

function isElegySkillAsset(asset) {
  const source = typeof asset?.source === 'string' ? asset.source.toLowerCase() : '';
  const id = typeof asset?.id === 'string' ? asset.id.toLowerCase() : '';
  return source.includes('catalog-assets/shared-skills/elegy-')
    || id.includes('elegy-planning')
    || id.includes('elegy-skills');
}

async function buildToolingStatus(ctx, deps) {
  const checkedAtMs = Date.now();
  const cliPath = resolveElegyPlanningCliPath({
    cliPath: ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: ctx.engineRoot,
    copilotHome: ctx.copilotHomeAbs,
    env: ctx.env,
  });

  const planningCurrentVersion = resolvePlanningVersion(cliPath, deps);
  let planningLatestVersion = null;
  let planningLatestError = null;
  try {
    const release = await fetchLatestReleaseInfo(deps.fetchImpl);
    planningLatestVersion = release && release.version ? String(release.version) : null;
  } catch (error) {
    planningLatestError = error instanceof Error ? error.message : String(error);
  }

  const planningUpdateAvailable = Boolean(
    planningCurrentVersion
      && planningLatestVersion
      && compareVersions(planningLatestVersion, planningCurrentVersion) > 0,
  );

  const managedStatuses = deps.assets.getManagedAssetStatuses(ctx.engineRoot, ctx.opencodeHome, 'opencode-assets/manifest.json');
  const trackedSkills = filterElegySkillAssets(managedStatuses);
  const outdatedSkills = trackedSkills.filter((asset) => asset.upToDate !== true);

  return {
    checkedAtMs,
    elegyPlanningCli: {
      cliPath: cliPath || null,
      currentVersion: planningCurrentVersion,
      latestVersion: planningLatestVersion,
      updateAvailable: planningUpdateAvailable,
      canUpdate: Boolean(ctx.copilotHomeAbs),
      lastError: planningLatestError,
    },
    elegySkillsAssets: {
      trackedCount: trackedSkills.length,
      outdatedCount: outdatedSkills.length,
      updateAvailable: outdatedSkills.length > 0,
      canUpdate: Boolean(ctx.engineRoot && ctx.opencodeHome),
      assets: trackedSkills.map(mapManagedSkillAsset),
      lastError: null,
    },
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
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps);
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
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps);
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
          const downloadedPath = await downloadElegyPlanningCli({
            copilotHome: ctx.copilotHomeAbs,
            fetchImpl: resolvedDeps.fetchImpl,
          });
          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            downloadedPath,
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
          const force = Boolean(body.force);
          const syncResult = resolvedDeps.assets.syncAll(ctx.engineRoot, ctx.opencodeHome, {
            dryRun: false,
            force,
            pointerMode: true,
            manifestPath: 'opencode-assets/manifest.json',
            assetFilter: isElegySkillAsset,
          });

          const status = await buildToolingStatus({ ...ctx, env: resolvedDeps.env }, resolvedDeps);
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
