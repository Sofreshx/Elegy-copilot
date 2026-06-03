'use strict';

const path = require('path');
const fs = require('fs');
const opencodeConfigDefault = require('../lib/opencodeConfig');
const opencodeLogReaderDefault = require('../lib/opencodeLogReader');
const assetsLib = require('../lib/assets');
const {
  resolveElegyPlanningCliPath,
  downloadElegyPlanningCli,
} = require('../lib/elegyPlanningCliResolver');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const codexConfig = require('../lib/codexConfig');

const TOOLING_INSTALL_KINDS = new Set(['elegy-planning-cli', 'elegy-skills']);

function isElegySkillAsset(asset) {
  if (!asset || typeof asset !== 'object') return false;
  const id = typeof asset.id === 'string' ? asset.id.toLowerCase() : '';
  const source = typeof asset.source === 'string' ? asset.source.toLowerCase() : '';
  return id.includes('elegy-') || source.includes('catalog-assets/shared-skills/elegy-');
}

function isTruthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function asTrimmedString(value, fallback = '') {
  return asString(value, fallback).trim() || fallback;
}

function asBoolean(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function filterOpenCodeAssets(assets) {
  return toArray(assets).filter((a) => {
    const id = asTrimmedString(a.id).toLowerCase();
    return id.startsWith('opencode-');
  });
}

function checkWorktreePluginFile(copilotHome) {
  const pluginPath = path.join(copilotHome, 'plugins', 'worktree.js');
  try {
    return fs.existsSync(pluginPath);
  } catch {
    return false;
  }
}

function checkAgentsMdFile(copilotHome) {
  const agentsPath = path.join(copilotHome, 'AGENTS.md');
  try {
    return fs.existsSync(agentsPath);
  } catch {
    return false;
  }
}

function getConfigPreview(opencodeConfigLib, opencodeHome) {
  try {
    const config = opencodeConfigLib.readConfig(opencodeHome);
    const cleaned = {};
    if (config.provider) cleaned.provider = config.provider;
    if (config.agent) cleaned.agent = config.agent;
    if (config.lanes) cleaned.lanes = config.lanes;
    if (config.profile) cleaned.profile = config.profile;
    return cleaned;
  } catch {
    return null;
  }
}

function buildLanes() {
  return [
    {
      id: 'quick',
      label: 'Quick',
      description: 'Fast, focused implementation with optional review',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'lane-classifier', label: 'Lane Classifier', kind: 'decision' },
        { id: 'exploration', label: 'Exploration (Flash Max)', kind: 'action' },
        { id: 'review-gate', label: 'Optional Review', kind: 'optional' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [
        { from: 'user-request', to: 'lane-classifier', label: 'classify' },
        { from: 'lane-classifier', to: 'exploration', label: 'quick route' },
        { from: 'exploration', to: 'review-gate', label: 'optional' },
        { from: 'exploration', to: 'implementation', label: 'direct' },
        { from: 'review-gate', to: 'implementation', label: 'approved' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: null, review: 'optional' },
      requiredSetup: ['opencode-config', 'provider-route'],
      clarificationGates: [],
      worktreeBehavior: null,
      escalationTriggers: [],
    },
    {
      id: 'standard',
      label: 'Standard',
      description: 'Balanced implementation with escalation on ambiguity',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'lane-classifier', label: 'Lane Classifier', kind: 'decision' },
        { id: 'exploration', label: 'Exploration (Flash Max)', kind: 'action' },
        { id: 'ambiguity-gate', label: 'Clarification Gate', kind: 'gate' },
        { id: 'escalation', label: 'Escalate on Failure', kind: 'escalation' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [
        { from: 'user-request', to: 'lane-classifier', label: 'classify' },
        { from: 'lane-classifier', to: 'exploration', label: 'standard route' },
        { from: 'exploration', to: 'ambiguity-gate', label: 'check clarity' },
        { from: 'ambiguity-gate', to: 'escalation', label: 'ambiguous' },
        { from: 'ambiguity-gate', to: 'implementation', label: 'clear' },
        { from: 'escalation', to: 'implementation', label: 'resolved' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: null, review: 'optional' },
      requiredSetup: ['opencode-config', 'provider-route'],
      clarificationGates: ['ambiguity', 'missing-context'],
      worktreeBehavior: null,
      escalationTriggers: ['ambiguity-detected', 'execution-failure'],
    },
    {
      id: 'spec',
      label: 'Spec',
      description: 'Spec-driven development with exploration, planning, and review gates',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'lane-classifier', label: 'Lane Classifier', kind: 'decision' },
        { id: 'exploration', label: 'Flash Exploration', kind: 'action' },
        { id: 'spec-gate', label: 'Spec Gate', kind: 'gate' },
        { id: 'pro-max-plan', label: 'Pro Max Plan', kind: 'action' },
        { id: 'review-gate', label: 'Review Gate', kind: 'gate' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
      ],
      edges: [
        { from: 'user-request', to: 'lane-classifier', label: 'classify' },
        { from: 'lane-classifier', to: 'exploration', label: 'spec route' },
        { from: 'exploration', to: 'spec-gate', label: 'draft spec' },
        { from: 'spec-gate', to: 'pro-max-plan', label: 'approved' },
        { from: 'spec-gate', to: 'exploration', label: 'revise' },
        { from: 'pro-max-plan', to: 'review-gate', label: 'plan ready' },
        { from: 'review-gate', to: 'implementation', label: 'approved' },
        { from: 'review-gate', to: 'pro-max-plan', label: 'revision needed' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: 'DeepSeek V4 Pro Max', review: 'DeepSeek V4 Pro High' },
      requiredSetup: ['opencode-config', 'provider-route'],
      clarificationGates: ['spec-scope', 'acceptance-criteria'],
      worktreeBehavior: null,
      escalationTriggers: ['spec-rejected', 'review-failed'],
    },
    {
      id: 'project',
      label: 'Project',
      description: 'Full project life cycle via Elegy Planning graph, worktrees, and evidence',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'lane-classifier', label: 'Lane Classifier', kind: 'decision' },
        { id: 'elegy-planning', label: 'Elegy Planning Graph', kind: 'action' },
        { id: 'runnable-leaf', label: 'Dependency-Ready Work Point', kind: 'decision' },
        { id: 'worktree', label: 'Worktree Isolation', kind: 'action' },
        { id: 'implementation', label: 'Implementation', kind: 'action' },
        { id: 'evidence', label: 'Evidence / Commit / PR', kind: 'action' },
        { id: 'review', label: 'Review', kind: 'gate' },
      ],
      edges: [
        { from: 'user-request', to: 'lane-classifier', label: 'classify' },
        { from: 'lane-classifier', to: 'elegy-planning', label: 'project route' },
        { from: 'elegy-planning', to: 'runnable-leaf', label: 'goal/roadmap' },
        { from: 'runnable-leaf', to: 'worktree', label: 'lease acquired' },
        { from: 'worktree', to: 'implementation', label: 'isolated run' },
        { from: 'implementation', to: 'evidence', label: 'complete' },
        { from: 'evidence', to: 'review', label: 'evidence ready' },
        { from: 'review', to: 'evidence', label: 'revision needed' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: 'DeepSeek V4 Pro Max', review: 'DeepSeek V4 Pro High' },
      requiredSetup: ['opencode-config', 'provider-route', 'elegy-planning-cli', 'worktree-plugin', 'elegy-skills'],
      clarificationGates: ['goal-definition', 'roadmap-scope'],
      worktreeBehavior: 'git-worktree-based isolation with automatic cleanup',
      escalationTriggers: ['planning-graph-unavailable', 'lease-failure', 'worktree-creation-failure'],
    },
  ];
}

function buildProfiles(opencodeConfig, opencodeHome) {
  const activeProviderRoute = opencodeConfig.getActiveProfileRoute
    ? opencodeConfig.getActiveProfileRoute(opencodeHome)
    : 'opencode-go';
  const availableRoutes = ['opencode-go', 'deepseek-direct'];

  const profiles = [
    {
      id: 'opencode-go',
      label: 'OpenCode Go',
      description: 'Default provider route via OpenCode Go runtime',
      route: 'opencode-go',
      smallModel: 'DeepSeek V4 Flash Max',
      bigModel: 'DeepSeek V4 Pro Max',
      reviewModel: 'DeepSeek V4 Pro High',
    },
    {
      id: 'deepseek-direct',
      label: 'Direct DeepSeek',
      description: 'Direct DeepSeek API provider route',
      route: 'deepseek-direct',
      smallModel: 'DeepSeek V4 Flash Max',
      bigModel: 'DeepSeek V4 Pro Max',
      reviewModel: 'DeepSeek V4 Pro High',
    },
  ];

  return {
    availableRoutes,
    activeProfileId: activeProviderRoute,
    profiles,
  };
}

function buildSetupChecks(opencodeHome, copilotHomeAbs, engineRoot, assets, ctx, opencodeConfigLib, codexHome) {
  const checks = [];
  const ocLib = opencodeConfigLib || opencodeConfigDefault;

  const configPath = ocLib.resolveConfigPath(opencodeHome);
  const configReadable = fs.existsSync(configPath);
  checks.push({
    id: 'opencode-config',
    label: 'OpenCode config readable',
    status: configReadable ? 'ok' : 'warning',
    detail: configReadable
      ? configPath
      : 'No opencode.jsonc found. Run OpenCode setup or create the file.',
    action: configReadable ? null : { kind: 'info', label: 'Create config', target: '#profiles' },
  });

  const agentsMd = checkAgentsMdFile(opencodeHome);
  checks.push({
    id: 'opencode-agents-md',
    label: 'OpenCode AGENTS.md installed',
    status: agentsMd ? 'ok' : 'warning',
    detail: agentsMd
      ? 'AGENTS.md is present'
      : 'AGENTS.md not found. Install OpenCode assets to create it.',
    action: agentsMd ? null : { kind: 'install', label: 'Install OpenCode assets' },
  });

  const hasElegyPlanningCli = Boolean(ctx.toolingStatus && ctx.toolingStatus.elegyPlanningCli
    && ctx.toolingStatus.elegyPlanningCli.cliPath);
  checks.push({
    id: 'elegy-planning-cli',
    label: 'elegy-planning CLI detected',
    status: hasElegyPlanningCli ? 'ok' : 'warning',
    detail: hasElegyPlanningCli
      ? 'elegy-planning CLI is available'
      : 'elegy-planning CLI not detected. Install via tooling updates.',
    action: hasElegyPlanningCli ? null : { kind: 'update', label: 'Install elegy-planning CLI' },
  });

  const hasElegyPlanningLive =
    Boolean(ctx.planningLiveAuthority && ctx.planningLiveAuthority.ready);
  checks.push({
    id: 'elegy-planning-live',
    label: 'elegy-planning live authority ready',
    status: hasElegyPlanningLive ? 'ok' : 'warning',
    detail: hasElegyPlanningLive
      ? 'Planning live authority is ready'
      : 'Planning live authority is not ready. Check gateway state.',
    action: hasElegyPlanningLive ? null : { kind: 'info', label: 'Check gateway', target: '#gateway' },
  });

  const elegySkillsTracked = ctx.toolingStatus && ctx.toolingStatus.elegySkillsAssets
    ? ctx.toolingStatus.elegySkillsAssets.trackedCount : 0;
  const elegySkillsOutdated = ctx.toolingStatus && ctx.toolingStatus.elegySkillsAssets
    ? ctx.toolingStatus.elegySkillsAssets.outdatedCount : 0;
  checks.push({
    id: 'elegy-skills',
    label: 'Elegy planning/skills assets installed',
    status: elegySkillsTracked > 0 ? (elegySkillsOutdated === 0 ? 'ok' : 'warning') : 'warning',
    detail: elegySkillsTracked > 0
      ? (elegySkillsOutdated === 0
        ? `${elegySkillsTracked} assets up to date`
        : `${elegySkillsOutdated} of ${elegySkillsTracked} assets outdated`)
      : 'No Elegy skill assets tracked. Install Elegy skills.',
    action: elegySkillsOutdated > 0
      ? { kind: 'update', label: 'Update Elegy skills' }
      : (elegySkillsTracked === 0 ? { kind: 'install', label: 'Install Elegy skills' } : null),
  });

  const managedAssets = ctx.managedAssetStatuses
    || (assets && engineRoot && opencodeHome
      ? assets.getManagedAssetStatuses(engineRoot, opencodeHome, 'opencode-assets/manifest.json')
      : []);
  const openCodeAssets = filterOpenCodeAssets(managedAssets);
  const openCodeOutdated = openCodeAssets.filter((a) => a.upToDate !== true);

  checks.push({
    id: 'opencode-assets',
    label: 'OpenCode installed assets',
    status: openCodeOutdated.length === 0 && openCodeAssets.length > 0 ? 'ok' : 'warning',
    detail: openCodeAssets.length > 0
      ? (openCodeOutdated.length === 0
        ? `${openCodeAssets.length} assets up to date`
        : `${openCodeOutdated.length} of ${openCodeAssets.length} assets outdated or missing`)
      : 'No OpenCode managed assets found. Install OpenCode surface assets.',
    action: openCodeOutdated.length > 0 || openCodeAssets.length === 0
      ? { kind: 'install', label: 'Install/refresh OpenCode assets' }
      : null,
  });

  const worktreePlugin = checkWorktreePluginFile(opencodeHome);
  checks.push({
    id: 'worktree-plugin',
    label: 'OpenCode worktree plugin installed',
    status: worktreePlugin ? 'ok' : 'warning',
    detail: worktreePlugin
      ? 'Worktree plugin is present'
      : 'Worktree plugin not found. Install OpenCode assets.',
    action: worktreePlugin ? null : { kind: 'install', label: 'Install OpenCode assets' },
  });

  const providerRoute = asTrimmedString(ctx.activeProviderRoute || 'opencode-go');
  checks.push({
    id: 'provider-route',
    label: `Selected provider route configured (${providerRoute})`,
    status: 'ok',
    detail: `Provider route is set to ${providerRoute}`,
    action: null,
  });

  // Codex elegy-planning check (only when codexHome is available)
  if (codexHome) {
    try {
      const planningSkillStatus = codexConfig.getPlanningSkillStatus(codexHome);
      const cliPath = resolveElegyPlanningCliPath({
        cliPath: process.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
        runtimeRoot: engineRoot,
        copilotHome: copilotHomeAbs,
        env: process.env,
      });
      const ready = planningSkillStatus.installed && Boolean(cliPath);
      checks.push({
        id: 'codex-elegy-planning',
        label: 'Codex Elegy Planning',
        status: ready ? 'ok' : 'warning',
        detail: ready
          ? `Codex planning skill installed at ${planningSkillStatus.skillDir}`
          : 'Install elegy-planning skill for Codex to enable planning-first work.',
        action: ready ? undefined : { kind: 'install-codex-planning', label: 'Install Codex Planning' },
      });
    } catch (_) {
      checks.push({
        id: 'codex-elegy-planning',
        label: 'Codex Elegy Planning',
        status: 'warning',
        detail: 'Unable to check Codex planning status. Install elegy-planning skill for Codex.',
        action: { kind: 'install-codex-planning', label: 'Install Codex Planning' },
      });
    }
  }

  const projectLaneReady = checks.filter((c) => c.id === 'elegy-planning-cli' || c.id === 'elegy-planning-live' || c.id === 'elegy-skills' || c.id === 'worktree-plugin' || c.id === 'opencode-config');
  const projectLaneBlockers = projectLaneReady.filter((c) => c.status !== 'ok');
  checks.push({
    id: 'project-lane',
    label: 'Project lane ready',
    status: projectLaneBlockers.length === 0 ? 'ok' : (projectLaneBlockers.length <= 2 ? 'warning' : 'blocked'),
    detail: projectLaneBlockers.length === 0
      ? 'All project lane dependencies are satisfied'
      : `Blocked by ${projectLaneBlockers.length} missing check(s): ${projectLaneBlockers.map((c) => c.id).join(', ')}`,
    action: projectLaneBlockers.length === 0 ? null : { kind: 'info', label: 'Resolve blockers', target: '#setup' },
  });

  // Spec lane: requires opencode-config + provider-route (elegy-planning is recommended but optional)
  const specLaneRequired = checks.filter((c) => c.id === 'opencode-config' || c.id === 'provider-route');
  const specLaneBlockers = specLaneRequired.filter((c) => c.status !== 'ok');
  const specLaneElegyMissing = checks.filter((c) => c.id === 'elegy-planning-cli' || c.id === 'elegy-skills').filter((c) => c.status !== 'ok');
  const specLaneAdvisoryDetail = specLaneElegyMissing.length > 0
    ? ` (${specLaneElegyMissing.length} advisory: elegy-planning not detected — spec work can proceed but durable planning state sync is unavailable)`
    : '';
  checks.push({
    id: 'spec-lane',
    label: 'Spec lane ready',
    status: specLaneBlockers.length === 0 ? 'ok' : (specLaneBlockers.length === 1 ? 'warning' : 'blocked'),
    detail: specLaneBlockers.length === 0
      ? `All spec lane dependencies are satisfied${specLaneAdvisoryDetail}`
      : `Blocked by ${specLaneBlockers.length} missing check(s): ${specLaneBlockers.map((c) => c.id).join(', ')}${specLaneAdvisoryDetail}`,
    action: specLaneBlockers.length === 0 ? null : { kind: 'info', label: 'Resolve blockers', target: '#setup' },
  });

  return checks;
}

function resolveOverallStatus(setupChecks) {
  const criticalSystemChecks = setupChecks.filter((c) => c.id !== 'project-lane' && c.id !== 'spec-lane');
  const blocked = criticalSystemChecks.some((c) => c.status === 'blocked');
  const degraded = setupChecks.some((c) => c.status !== 'ok');
  if (blocked) return 'blocked';
  if (degraded) return 'degraded';
  return 'ready';
}

function buildWarnings(setupChecks) {
  return setupChecks
    .filter((c) => c.status !== 'ok')
    .map((c) => ({
      id: c.id,
      severity: c.status === 'blocked' ? 'critical' : 'warning',
      title: c.label,
      detail: c.detail,
      action: c.action,
    }));
}

function resolvePlanningVersion(cliPath, childProcess) {
  const command = typeof cliPath === 'string' ? cliPath.trim() : '';
  if (!command) return null;
  if (!childProcess || typeof childProcess.spawnSync !== 'function') return null;
  try {
    const result = childProcess.spawnSync(command, ['--version'], {
      windowsHide: true,
      stdio: 'pipe',
      shell: false,
      encoding: 'utf8',
    });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function computeToolingStatus(ctx, deps, managedStatusesOverride) {
  const cliPath = resolveElegyPlanningCliPath({
    cliPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: ctx.engineRoot,
    copilotHome: ctx.copilotHomeAbs,
    env: ctx.env,
  });

  const planningVersion = resolvePlanningVersion(cliPath, deps.childProcess);

  const managedStatuses = managedStatusesOverride
    || (deps.assets && ctx.engineRoot && ctx.opencodeHome
      ? deps.assets.getManagedAssetStatuses(ctx.engineRoot, ctx.opencodeHome, 'opencode-assets/manifest.json')
      : []);
  const trackedSkills = (Array.isArray(managedStatuses) ? managedStatuses : []).filter((asset) => {
    const source = typeof asset.source === 'string' ? asset.source.toLowerCase() : '';
    const id = typeof asset.id === 'string' ? asset.id.toLowerCase() : '';
    return source.includes('catalog-assets/shared-skills/elegy-')
      || id.includes('elegy-planning')
      || id.includes('elegy-skills');
  });
  const outdatedSkills = trackedSkills.filter((asset) => asset.upToDate !== true);

  return {
    elegyPlanningCli: {
      cliPath: cliPath || null,
      currentVersion: planningVersion,
      canUpdate: Boolean(ctx.copilotHomeAbs),
    },
    elegySkillsAssets: {
      trackedCount: trackedSkills.length,
      outdatedCount: outdatedSkills.length,
      updateAvailable: outdatedSkills.length > 0,
      canUpdate: Boolean(ctx.engineRoot && ctx.opencodeHome),
      assets: trackedSkills.map((a) => ({
        id: a.id,
        upToDate: a.upToDate === true,
        installed: a.installed === true,
        source: a.source,
        destination: a.destination,
      })),
    },
  };
}

function resolvePlanningLiveAuthorityState(roadmapWorkflowPlanningBridge) {
  if (roadmapWorkflowPlanningBridge && typeof roadmapWorkflowPlanningBridge.getStatus === 'function') {
    try {
      const status = roadmapWorkflowPlanningBridge.getStatus();
      return { ready: Boolean(status && status.ready), state: status || null };
    } catch {
      return { ready: false, state: null };
    }
  }
  return { ready: false, state: null };
}

async function buildOpenCodeStatus(ctx, deps) {
  const { opencodeHome, copilotHomeAbs, engineRoot } = ctx;
  const opencodeConfig = deps.opencodeConfig;
  const assets = deps.assets;

  const managedAssetStatuses = assets && engineRoot && opencodeHome
    ? assets.getManagedAssetStatuses(engineRoot, opencodeHome, 'opencode-assets/manifest.json')
    : [];
  const configStatus = opencodeConfig.getStatus(opencodeHome);
  const profiles = buildProfiles(opencodeConfig, opencodeHome);
  const lanes = buildLanes();
  const toolingStatus = computeToolingStatus(ctx, deps, managedAssetStatuses);
  const planningLiveAuthority = resolvePlanningLiveAuthorityState(deps.roadmapWorkflowPlanningBridge);

  const augmentedContext = {
    ...ctx,
    toolingStatus,
    planningLiveAuthority,
    managedAssetStatuses,
    activeProviderRoute: profiles.activeProfileId,
    smallModel: configStatus.exploreModel,
    bigModel: configStatus.scoutModel,
  };

  const codexHome = ctx.codexHome || path.join(require('os').homedir(), '.codex');
  const setupChecks = buildSetupChecks(
    opencodeHome,
    copilotHomeAbs,
    engineRoot,
    assets,
    augmentedContext,
    opencodeConfig,
    codexHome,
  );

  const overallStatus = resolveOverallStatus(setupChecks);
  const warnings = buildWarnings(setupChecks);

  return {
    overallStatus,
    warnings,
    setupChecks,
    activeProfileId: profiles.activeProfileId,
    profiles: profiles.profiles,
    availableRoutes: profiles.availableRoutes,
    lanes,
    configPreview: getConfigPreview(opencodeConfig, opencodeHome),
    opencodeHome: configStatus.opencodeHome,
    configPath: configStatus.configPath,
    smallModel: configStatus.exploreModel,
    bigModel: configStatus.scoutModel,
    isCustomConfig: configStatus.isCustom,
    elegyPlanningCli: toolingStatus.elegyPlanningCli,
    elegySkillsAssets: toolingStatus.elegySkillsAssets,
    planningLiveAuthority,
  };
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    opencodeConfig: deps.opencodeConfig || opencodeConfigDefault,
    opencodeLogReader: deps.opencodeLogReader || opencodeLogReaderDefault,
    assets: deps.assets || assetsLib,
    childProcess: deps.childProcess || require('node:child_process'),
    fs: deps.fs || fs,
    path: deps.path || path,
    roadmapWorkflowPlanningBridge: deps.roadmapWorkflowPlanningBridge || null,
  };

  return [
    {
      method: 'GET',
      path: '/api/opencode/status',
      handler: async (ctx) => {
        try {
          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
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
      path: '/api/opencode/config',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const { opencodeHome } = ctx;
          const profileRoute = asTrimmedString(body.profileRoute);
          const smallModel = asTrimmedString(body.smallModel);
          const bigModel = asTrimmedString(body.bigModel);
          const reviewModel = asTrimmedString(body.reviewModel);

          if (profileRoute) {
            resolvedDeps.opencodeConfig.updateStateProfileRoute
              ? resolvedDeps.opencodeConfig.updateStateProfileRoute(opencodeHome, profileRoute)
              : null;
          }

          if (smallModel || bigModel || reviewModel) {
            resolvedDeps.opencodeConfig.setAgentModels(
              opencodeHome,
              smallModel || undefined,
              bigModel || undefined,
              reviewModel || undefined,
            );
          }

          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, status });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/config/reset',
      handler: async (ctx) => {
        try {
          const { opencodeHome } = ctx;
          resolvedDeps.opencodeConfig.resetConfig(opencodeHome);
          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, status });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/assets/install',
      handler: async (ctx) => {
        try {
          const { engineRoot, opencodeHome } = ctx;
          if (!engineRoot || !opencodeHome) {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: 'engineRoot and opencodeHome are required for asset install.',
            });
            return;
          }
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const force = asBoolean(body.force, false);

          const syncResult = resolvedDeps.assets.syncAll(engineRoot, opencodeHome, {
            dryRun: false,
            force,
            pointerMode: true,
            manifestPath: 'opencode-assets/manifest.json',
            assetFilter: (asset) => {
              const id = asTrimmedString(asset.id).toLowerCase();
              return id.startsWith('opencode-');
            },
          });

          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, syncResult, status });
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
      path: '/api/opencode/tooling/install',
      handler: async (ctx) => {
        try {
          const { copilotHomeAbs, engineRoot, opencodeHome } = ctx;
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const kind = asTrimmedString(body.kind);
          const force = asBoolean(body.force, false);

          if (!TOOLING_INSTALL_KINDS.has(kind)) {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: `Unknown tooling install kind: ${kind || '(missing)'}. Expected one of: ${Array.from(TOOLING_INSTALL_KINDS).join(', ')}.`,
            });
            return;
          }

          let result = {};
          if (kind === 'elegy-planning-cli') {
            if (!copilotHomeAbs) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'copilotHome is required for elegy-planning CLI install.',
              });
              return;
            }
            const fetchImpl = resolvedDeps.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
            const downloadedPath = await downloadElegyPlanningCli({ copilotHome: copilotHomeAbs, fetchImpl });
            result = { downloadedPath };
          } else if (kind === 'elegy-skills') {
            if (!engineRoot || !opencodeHome) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'engineRoot and opencodeHome are required to install Elegy skills.',
              });
              return;
            }
            const syncResult = resolvedDeps.assets.syncAll(engineRoot, opencodeHome, {
              dryRun: false,
              force,
              pointerMode: true,
              manifestPath: 'opencode-assets/manifest.json',
              assetFilter: isElegySkillAsset,
            });
            result = { syncResult };
          }

          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, kind, ...result, status });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/opencode/logs/requests',
      handler: async (ctx) => {
        try {
          const limit = asNumber(ctx.query && ctx.query.limit, resolvedDeps.opencodeLogReader.DEFAULT_LIMIT);
          const since = asTrimmedString(ctx.query && ctx.query.since);
          const result = resolvedDeps.opencodeLogReader.readRequestLogs({ limit, since });
          resolvedDeps.sendJson(ctx.res, 200, result);
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/codex-planning-status',
      handler: async (ctx) => {
        try {
          const codexHome = ctx.codexHome || path.join(require('os').homedir(), '.codex');
          const codexConfig = require('../lib/codexConfig');
          const planningSkillStatus = codexConfig.getPlanningSkillStatus(codexHome);
          const cliPath = resolveElegyPlanningCliPath({
            cliPath: ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
            runtimeRoot: ctx.engineRoot,
            copilotHome: ctx.copilotHomeAbs,
            env: ctx.env,
          });
          resolvedDeps.sendJson(ctx.res, 200, {
            codexHome,
            planningSkill: planningSkillStatus,
            planningCliPath: cliPath || null,
            planningDbPath: ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH || null,
            ready: planningSkillStatus.installed && Boolean(cliPath),
          });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
  ];
}

module.exports = { register };
