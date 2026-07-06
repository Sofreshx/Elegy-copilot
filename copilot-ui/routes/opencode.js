'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const opencodeConfigDefault = require('../lib/opencodeConfig');
const opencodeLogReaderDefault = require('../lib/opencodeLogReader');
const opencodeGoWorkspacesDefault = require('../lib/opencodeGoWorkspaces');
const assetsLib = require('../lib/assets');
const {
  resolveElegyPlanningCliPath,
  installLatestElegyPlanningCli,
  syncElegySkillAssetsFromGitHub,
  readElegyAssetsMetadata,
  readInstallMetadata,
  buildManagedSourceDir,
  resolveGitHead,
  GITHUB_ELEGY_SKILL_ASSETS,
} = require('../lib/elegyPlanningCliResolver');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const codexConfig = require('../lib/codexConfig');
const { resolvePlanningHealth, resolvePlanningFeatureStatus } = require('../lib/elegyPlanningHealth');
const providerUsageStats = require('../lib/providerUsageStats');
const toolCliInstallers = require('../lib/toolCliInstallers');

const TOOLING_INSTALL_KINDS = new Set(['elegy-planning-cli', 'elegy-skills', 'install-codex-planning', 'worktree-permission-profile']);

function isLegacyElegyManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') return false;
  const id = asTrimmedString(asset.id).toLowerCase();
  const source = asTrimmedString(asset.source).toLowerCase();
  const destination = asTrimmedString(asset.destination).toLowerCase();
  return id.includes('elegy-')
    || source.includes('catalog-assets/shared-skills/elegy-')
    || destination.includes('skills/elegy-');
}

function isElegySkillAsset(asset) {
  if (!asset || typeof asset !== 'object') return false;
  const id = asTrimmedString(asset.id).toLowerCase();
  return id.includes('elegy-')
    || id.includes('codex-elegy-planning');
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
    return id.startsWith('opencode-') && !isLegacyElegyManifestAsset(a);
  });
}

function checkWorktreePluginFile(elegyHome) {
  const pluginPath = path.join(elegyHome, 'plugins', 'worktree.js');
  try {
    return fs.existsSync(pluginPath);
  } catch {
    return false;
  }
}

function checkAgentsMdFile(elegyHome) {
  const agentsPath = path.join(elegyHome, 'AGENTS.md');
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
    if (typeof config.lsp === 'boolean') cleaned.lsp = config.lsp;
    // Expose experimental config keys to the frontend
    if (config.experimental && typeof config.experimental === 'object') {
      cleaned.experimental = {};
      const exp = config.experimental;
      if (typeof exp.batch_tool === 'boolean') cleaned.experimental.batch_tool = exp.batch_tool;
      if (typeof exp.openTelemetry === 'boolean') cleaned.experimental.openTelemetry = exp.openTelemetry;
      if (typeof exp.continue_loop_on_deny === 'boolean') cleaned.experimental.continue_loop_on_deny = exp.continue_loop_on_deny;
      if (typeof exp.disable_paste_summary === 'boolean') cleaned.experimental.disable_paste_summary = exp.disable_paste_summary;
      if (typeof exp.mcp_timeout === 'number') cleaned.experimental.mcp_timeout = exp.mcp_timeout;
      if (Array.isArray(exp.primary_tools)) cleaned.experimental.primary_tools = exp.primary_tools;
      if (Array.isArray(exp.policies)) cleaned.experimental.policies = exp.policies;
    }
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
    {
      id: 'runner',
      label: 'Runner',
      description: 'Execute a text plan via sub-agents with full review gates. No elegy-planning.',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'parse-plan', label: 'Parse Text Plan', kind: 'action' },
        { id: 'plan-review', label: 'Plan Review', kind: 'gate' },
        { id: 'exploration', label: 'Exploration (Flash)', kind: 'action' },
        { id: 'implementation', label: 'Implementation (Pro)', kind: 'action' },
        { id: 'code-review', label: 'Code Review', kind: 'gate' },
        { id: 'fix-retry', label: 'Auto-Fix Retry', kind: 'action' },
        { id: 'evidence-review', label: 'Evidence Review', kind: 'gate' },
      ],
      edges: [
        { from: 'user-request', to: 'parse-plan', label: 'plan text' },
        { from: 'parse-plan', to: 'plan-review', label: 'tasks parsed' },
        { from: 'plan-review', to: 'exploration', label: 'approved' },
        { from: 'plan-review', to: 'parse-plan', label: 'revise' },
        { from: 'exploration', to: 'implementation', label: 'context ready' },
        { from: 'implementation', to: 'code-review', label: 'impl done' },
        { from: 'code-review', to: 'fix-retry', label: 'changes-requested' },
        { from: 'code-review', to: 'evidence-review', label: 'approved' },
        { from: 'fix-retry', to: 'code-review', label: 'fixed (max 2x)' },
        { from: 'fix-retry', to: 'user-request', label: 'retries exhausted' },
        { from: 'evidence-review', to: 'implementation', label: 'gaps found' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: 'DeepSeek V4 Pro Max', review: 'DeepSeek V4 Pro High' },
      requiredSetup: ['opencode-config', 'opencode-assets'],
      clarificationGates: ['plan-ambiguity', 'missing-tasks'],
      worktreeBehavior: 'optional-on-request',
      escalationTriggers: ['plan-review-blocked', 'retries-exhausted', 'code-review-blocked'],
    },
    {
      id: 'runner-flash',
      label: 'Runner Flash',
      description: 'Same as Runner but uses Flash implementation model for lower cost.',
      nodes: [
        { id: 'user-request', label: 'User Request', kind: 'start' },
        { id: 'parse-plan', label: 'Parse Text Plan', kind: 'action' },
        { id: 'plan-review', label: 'Plan Review', kind: 'gate' },
        { id: 'exploration', label: 'Exploration (Flash)', kind: 'action' },
        { id: 'implementation', label: 'Implementation (Flash)', kind: 'action' },
        { id: 'code-review', label: 'Code Review', kind: 'gate' },
        { id: 'fix-retry', label: 'Auto-Fix Retry', kind: 'action' },
        { id: 'evidence-review', label: 'Evidence Review', kind: 'gate' },
      ],
      edges: [
        { from: 'user-request', to: 'parse-plan', label: 'plan text' },
        { from: 'parse-plan', to: 'plan-review', label: 'tasks parsed' },
        { from: 'plan-review', to: 'exploration', label: 'approved' },
        { from: 'plan-review', to: 'parse-plan', label: 'revise' },
        { from: 'exploration', to: 'implementation', label: 'context ready' },
        { from: 'implementation', to: 'code-review', label: 'impl done' },
        { from: 'code-review', to: 'fix-retry', label: 'changes-requested' },
        { from: 'code-review', to: 'evidence-review', label: 'approved' },
        { from: 'fix-retry', to: 'code-review', label: 'fixed (max 2x)' },
        { from: 'fix-retry', to: 'user-request', label: 'retries exhausted' },
        { from: 'evidence-review', to: 'implementation', label: 'gaps found' },
      ],
      modelPolicy: { small: 'DeepSeek V4 Flash Max', big: 'DeepSeek V4 Pro Max', review: 'DeepSeek V4 Pro High' },
      requiredSetup: ['opencode-config', 'opencode-assets'],
      clarificationGates: ['plan-ambiguity', 'missing-tasks'],
      worktreeBehavior: 'optional-on-request',
      escalationTriggers: ['plan-review-blocked', 'retries-exhausted', 'code-review-blocked'],
    },
  ];
}

function deriveModelDisplayName(modelId) {
  if (typeof modelId !== 'string' || !modelId) return modelId;
  const parts = modelId.split('/');
  const modelName = parts.length > 1 ? parts.slice(1).join('/') : modelId;
  return modelName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildProfiles(opencodeHome, engineRoot) {
  let activeProfileId;
  try {
    activeProfileId = opencodeConfigDefault.getActiveProfileId(opencodeHome);
  } catch {
    activeProfileId = 'opencode-go-balanced';
  }

  // Fallback profile definitions used when profiles.json cannot be read
  const FALLBACK_PROFILES = {
    'opencode-go': {
      label: 'OpenCode Go',
      description: 'Default provider route via OpenCode Go runtime',
      small: 'deepseek-v4-flash',
      big: 'deepseek-v4-pro',
      review: 'deepseek-v4-pro',
    },
    'deepseek-direct': {
      label: 'Direct DeepSeek',
      description: 'Direct DeepSeek API provider route',
      small: 'deepseek-v4-flash',
      big: 'deepseek-v4-pro',
      review: 'deepseek-v4-pro',
    },
  };

  let profilesCatalog;
  try {
    profilesCatalog = opencodeConfigDefault.readProfileCatalog(engineRoot);
  } catch {
    profilesCatalog = { profiles: {} };
  }

  const profileDefs = profilesCatalog.profiles || {};
  const resolvedProfileDefs = Object.keys(profileDefs).length > 0 ? profileDefs : FALLBACK_PROFILES;

  const profiles = [];
  const seen = new Set();
  const availableModels = [];

  for (const [profileId, profileDef] of Object.entries(resolvedProfileDefs)) {
    const normalized = opencodeConfigDefault.normalizeProfile(profileDef, profileId);

    // Collect model IDs from roleModels (preferred)
    const roleModels = normalized.roleModels || {};
    for (const modelId of Object.values(roleModels)) {
      if (modelId && typeof modelId === 'string' && !seen.has(modelId)) {
        seen.add(modelId);
        const parts = modelId.split('/');
        const providerName = parts.length > 1 ? parts[0] : 'unknown';
        availableModels.push({
          id: modelId,
          displayName: deriveModelDisplayName(modelId),
          provider: providerName,
        });
      }
    }

    // Also collect legacy small/big/review model IDs
    for (const role of ['small', 'big', 'review']) {
      const modelId = normalized[role];
      if (modelId && typeof modelId === 'string' && !seen.has(modelId)) {
        seen.add(modelId);
        const parts = modelId.split('/');
        const providerName = parts.length > 1 ? parts[0] : 'unknown';
        const labelKey = `${role}Label`;
        const displayName = normalized[labelKey] || deriveModelDisplayName(modelId);
        availableModels.push({
          id: modelId,
          displayName,
          provider: providerName,
        });
      }
    }

    profiles.push({
      id: profileId,
      label: normalized.label || profileId,
      description: normalized.description || '',
      tags: normalized.tags || [],
      roleModels: normalized.roleModels || {},
      notes: normalized.notes || undefined,
      route: profileId,
      smallModel: normalized.smallLabel || deriveModelDisplayName(normalized.small || ''),
      bigModel: normalized.bigLabel || deriveModelDisplayName(normalized.big || ''),
      reviewModel: normalized.reviewLabel || deriveModelDisplayName(normalized.review || ''),
      smallModelId: normalized.small || null,
      bigModelId: normalized.big || null,
      reviewModelId: normalized.review || null,
    });
  }

  const availableRoutes = Object.keys(resolvedProfileDefs);

  return {
    availableRoutes,
    activeProfileId,
    profiles,
    availableModels,
  };
}

function buildSetupChecks(opencodeHome, elegyHomeAbs, engineRoot, assets, ctx, opencodeConfigLib, codexHome) {
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
      : 'AGENTS.md not found. Manage asset installation in Assets & Tools.',
    action: null,
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

  // OpenCode CLI check — uses the shared toolCliInstallers helper
  const ocCliInstaller = (ctx.toolCliInstallers || toolCliInstallers);
  const opencodeCliStatus = ocCliInstaller.getCliToolStatus
    ? ocCliInstaller.getCliToolStatus('opencode-cli')
    : { installed: false };
  checks.push({
    id: 'opencode-cli',
    label: 'OpenCode CLI detected',
    status: opencodeCliStatus.installed ? 'ok' : 'warning',
    detail: opencodeCliStatus.installed
      ? `OpenCode CLI is available${opencodeCliStatus.version ? ` (${opencodeCliStatus.version})` : ''}`
      : 'OpenCode CLI not detected. Install to use OpenCode outside the dashboard.',
    action: opencodeCliStatus.installed
      ? null
      : { kind: 'install-opencode-cli', label: 'Install OpenCode CLI' },
  });

  const hasElegyPlanningLive =
    Boolean(ctx.planningLiveAuthority && ctx.planningLiveAuthority.ready);
  checks.push({
    id: 'elegy-planning-live',
    label: 'elegy-planning live authority ready',
    status: hasElegyPlanningLive ? 'ok' : 'warning',
    detail: hasElegyPlanningLive
      ? 'Planning live authority is ready'
      : 'Planning live authority is not ready.',
    action: null,
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
        : `${openCodeOutdated.length} of ${openCodeAssets.length} assets outdated or missing — manage in Assets & Tools`)
      : 'No OpenCode managed assets found. Manage asset installation in Assets & Tools.',
    action: null,
  });

  const worktreePlugin = checkWorktreePluginFile(opencodeHome);
  checks.push({
    id: 'worktree-plugin',
    label: 'OpenCode worktree plugin installed',
    status: worktreePlugin ? 'ok' : 'warning',
    detail: worktreePlugin
      ? 'Worktree plugin is present'
      : 'Worktree plugin not found. Manage asset installation in Assets & Tools.',
    action: null,
  });

  let worktreePermissionStatus = null;
  try {
    worktreePermissionStatus = ocLib.getWorktreePermissionProfileStatus
      ? ocLib.getWorktreePermissionProfileStatus(opencodeHome)
      : null;
  } catch {
    worktreePermissionStatus = null;
  }
  if (worktreePermissionStatus) {
    const { applied, worktreeBase } = worktreePermissionStatus;
    const missingPermKeys = Array.isArray(worktreePermissionStatus.missingPermissionKeys)
      ? worktreePermissionStatus.missingPermissionKeys
      : [];
    const missingParts = [];
    if (missingPermKeys.length > 0) {
      missingParts.push(`${missingPermKeys.length} permission key(s): ${missingPermKeys.join(', ')}`);
    }
    checks.push({
      id: 'worktree-permission-profile',
      label: 'OpenCode worktree permission profile',
      status: applied ? 'ok' : 'warning',
      detail: applied
        ? `Permission profile applied for ${worktreeBase}`
        : `Permission profile not applied: missing ${missingParts.join(' + ')} for ${worktreeBase}`,
      action: applied ? null : { kind: 'worktree-permission-profile', label: 'Apply worktree permission profile' },
    });
  }

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
        cliPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
        runtimeRoot: engineRoot,
        elegyHome: elegyHomeAbs,
        env: ctx.env,
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

  // Runner lane: requires opencode-config + installed agent files + required skills
  const runnerLaneDeps = checks.filter((c) =>
    c.id === 'opencode-config' || c.id === 'opencode-assets'
  );
  const runnerLaneBlockers = runnerLaneDeps.filter((c) => c.status !== 'ok');
  const runnerAgentFiles = ['runner.md', 'runner-flash.md', 'impl.md', 'impl-pro.md', 'reviewer.md', 'explorer.md']
    .filter((name) => !fs.existsSync(path.join(opencodeHome, 'agents', name)));
  const runnerSkillsMissing = ['runner-workflow', 'implementation-review', 'rubberduck-plan-review']
    .filter((name) => !fs.existsSync(path.join(opencodeHome, 'skills', name)));
  const runnerMissing = runnerAgentFiles.length + runnerSkillsMissing.length;
  checks.push({
    id: 'runner-lane',
    label: 'Runner lane ready',
    status: runnerLaneBlockers.length === 0 && runnerMissing === 0 ? 'ok'
      : (runnerLaneBlockers.length <= 1 && runnerMissing <= 2 ? 'warning' : 'blocked'),
    detail: runnerLaneBlockers.length === 0 && runnerMissing === 0
      ? 'All runner lane dependencies are satisfied'
      : [
        runnerLaneBlockers.length > 0 ? `Blocked by ${runnerLaneBlockers.length} missing check(s): ${runnerLaneBlockers.map((c) => c.id).join(', ')}` : '',
        runnerAgentFiles.length > 0 ? `Missing agents: ${runnerAgentFiles.join(', ')}` : '',
        runnerSkillsMissing.length > 0 ? `Missing skills: ${runnerSkillsMissing.join(', ')}` : '',
      ].filter(Boolean).join('. '),
    action: runnerLaneBlockers.length === 0 && runnerMissing === 0 ? null
      : { kind: 'info', label: 'Resolve blockers', target: '#assets' },
  });

  // Instruction Governance — validate shared baseline + authoring skills wiring across all harnesses
  try {
    const scriptPath = path.join(engineRoot, 'scripts', 'validate-instruction-wiring.mjs');
    if (fs.existsSync(scriptPath)) {
      const result = execSync(`node "${scriptPath}" --json`, {
        cwd: engineRoot,
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(result);
      const governanceCheck = parsed.setupChecks && parsed.setupChecks[0];
      if (governanceCheck) {
        checks.push({
          id: 'instruction-governance',
          label: 'Instruction Governance',
          status: governanceCheck.status || 'warning',
          detail: governanceCheck.detail || '',
          action: null,
        });
      } else {
        // Fallback: derive status from summary when setupChecks is missing
        const summary = parsed.summary || {};
        const status = (summary.missing > 0 || summary.stale > 0) ? 'warning' : 'ok';
        const detail = `${summary.pass || 0}/${summary.total || 0} shared baseline + authoring skills checks pass`;
        checks.push({
          id: 'instruction-governance',
          label: 'Instruction Governance',
          status,
          detail,
          action: null,
        });
      }
    } else {
      checks.push({
        id: 'instruction-governance',
        label: 'Instruction Governance',
        status: 'warning',
        detail: 'Validation script not found. Unable to check instruction governance status.',
        action: null,
      });
    }
  } catch (err) {
    checks.push({
      id: 'instruction-governance',
      label: 'Instruction Governance',
      status: 'warning',
      detail: err.stderr
        ? `Validation error: ${err.stderr.trim().split('\n')[0]}`
        : 'Unable to check instruction governance status.',
      action: null,
    });
  }

  return checks;
}

function resolveOverallStatus(setupChecks) {
  const criticalSystemChecks = setupChecks.filter((c) => c.id !== 'project-lane' && c.id !== 'spec-lane' && c.id !== 'runner-lane');
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
  const health = resolvePlanningHealth(cliPath, childProcess);
  return health.version;
}

function buildGitHubElegySkillAssetsStatus(targetHome, elegyHomeAbs, env, childProcess) {
  const installMetadata = elegyHomeAbs ? readInstallMetadata(elegyHomeAbs) : null;
  const sourceRepoRoot = installMetadata?.sourceRepoRoot || (elegyHomeAbs ? buildManagedSourceDir(elegyHomeAbs) : '');
  const sourceGitHead = sourceRepoRoot
    ? resolveGitHead(sourceRepoRoot, {
        env,
        spawnSyncImpl: childProcess && childProcess.spawnSync,
      })
    : null;
  const metadata = targetHome ? readElegyAssetsMetadata(targetHome) : null;
  const installedAssets = Array.isArray(metadata?.assets) ? metadata.assets : [];
  const installedById = new Map(installedAssets.map((asset) => [asset.id, asset]));
  const assets = GITHUB_ELEGY_SKILL_ASSETS.map((asset) => {
    const installed = installedById.get(asset.id);
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
    };
  });
  const outdated = assets.filter((asset) => asset.upToDate !== true);
  return {
    trackedCount: assets.length,
    outdatedCount: outdated.length,
    updateAvailable: outdated.length > 0,
    canUpdate: Boolean(targetHome && elegyHomeAbs),
    source: 'github-source',
    sourceRemote: 'https://github.com/Sofreshx/Elegy.git',
    managedSource: {
      repoRoot: sourceRepoRoot || metadata?.sourceRepoRoot || null,
      gitHead: sourceGitHead,
      installedGitHead: metadata?.sourceGitHead || null,
      updateAvailable: outdated.length > 0,
      kind: metadata?.source || null,
      remote: metadata?.sourceRemote || null,
    },
    assets,
  };
}

function computeToolingStatus(ctx, deps, managedStatusesOverride) {
  const cliPath = resolveElegyPlanningCliPath({
    cliPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
    runtimeRoot: ctx.engineRoot,
    elegyHome: ctx.elegyHomeAbs,
    env: ctx.env,
  });

  const planningHealth = resolvePlanningHealth(cliPath, deps.childProcess);
  const planningVersion = planningHealth.version;
  // R2.3: readiness based on health --json (preferred), with feature-check fallback
  let cliReady = planningHealth.ready;
  if (!cliReady && cliPath) {
    // Fallback: if health --json failed, check subcommand availability
    const features = resolvePlanningFeatureStatus(cliPath, deps.childProcess);
    cliReady = features.complete;
  }

  void managedStatusesOverride;

  return {
    elegyPlanningCli: {
      cliPath: cliPath || null,
      currentVersion: planningVersion,
      ready: cliReady,
      canUpdate: Boolean(ctx.elegyHomeAbs),
    },
    elegySkillsAssets: buildGitHubElegySkillAssetsStatus(
      ctx.opencodeHome,
      ctx.elegyHomeAbs,
      ctx.env,
      deps.childProcess,
    ),
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

/**
 * Find the profile whose role/agent models best match the current effective config.
 * Returns { effectiveProfileId, selectedProfileId, roleModels, mismatches }
 * or null if no profile matches.
 */
function findEffectiveProfile(configStatus, profiles, opencodeConfigLib, opencodeHome) {
  // The selected profile from sidecar state
  const selectedProfileId = profiles.activeProfileId || null;

  // Read the actual config to get effective agent models
  let effectiveAgentModels = {};
  try {
    const config = opencodeConfigLib.readConfig(opencodeHome);
    const agent = config.agent && typeof config.agent === 'object' ? config.agent : {};
    for (const [agentName, agentCfg] of Object.entries(agent)) {
      if (agentCfg && typeof agentCfg === 'object' && typeof agentCfg.model === 'string') {
        effectiveAgentModels[agentName] = agentCfg.model;
      }
    }
  } catch {
    effectiveAgentModels = {};
  }

  // Also read effective role models if available
  let effectiveRoleModels = {};
  try {
    const state = opencodeConfigLib.readState ? opencodeConfigLib.readState(opencodeHome) : null;
    if (state && state.roleModels) {
      effectiveRoleModels = state.roleModels;
    }
  } catch {
    effectiveRoleModels = {};
  }

  const profileDefs = profiles.profiles || [];

  // If no effective models are set, the selected profile is the effective one
  const hasEffectiveRoleModels = Object.keys(effectiveRoleModels).length > 0;
  const hasEffectiveAgentModels = Object.keys(effectiveAgentModels).length > 0;

  if (!hasEffectiveRoleModels && !hasEffectiveAgentModels) {
    // Use selected profile's roleModels as the effective models
    const selectedDef = profileDefs.find(p => p.id === selectedProfileId);
    const roleModels = selectedDef?.roleModels || {};
    return {
      effectiveProfileId: selectedProfileId || 'opencode-go-balanced',
      selectedProfileId,
      mismatches: null,
      roleModels,
    };
  }

  // Compare effective role models against each profile's definitions
  // If roleModels are set, use those; otherwise use agent models via agentRoles mapping
  if (hasEffectiveRoleModels) {
    // Try to match roleModels to a profile
    for (const def of profileDefs) {
      const profileRoleModels = def.roleModels || {};
      const profileRoles = Object.keys(profileRoleModels);
      if (profileRoles.length === 0) continue;

      // Check if all profile role models match effective role models
      let allMatch = true;
      const mismatches = [];
      for (const role of profileRoles) {
        const profileModel = profileRoleModels[role];
        const effectiveModel = effectiveRoleModels[role];
        if (effectiveModel && effectiveModel !== profileModel) {
          allMatch = false;
          mismatches.push({ role, expectedModel: profileModel, actualModel: effectiveModel });
        }
      }

      if (allMatch && mismatches.length === 0) {
        return {
          effectiveProfileId: def.id,
          selectedProfileId,
          mismatches: null,
          roleModels: effectiveRoleModels,
        };
      }
    }

    // No exact match — find closest match
    let bestMatch = null;
    let bestMismatchCount = Infinity;

    for (const def of profileDefs) {
      const profileRoleModels = def.roleModels || {};
      const profileRoles = Object.keys(profileRoleModels);
      if (profileRoles.length === 0) continue;

      const mismatches = [];
      for (const role of profileRoles) {
        const profileModel = profileRoleModels[role];
        const effectiveModel = effectiveRoleModels[role];
        if (effectiveModel && effectiveModel !== profileModel) {
          mismatches.push({ role, expectedModel: profileModel, actualModel: effectiveModel });
        }
      }

      if (mismatches.length < bestMismatchCount) {
        bestMismatchCount = mismatches.length;
        bestMatch = { def, mismatches };
      }
    }

    if (bestMatch) {
      return {
        effectiveProfileId: bestMatch.mismatches.length === 0 ? bestMatch.def.id : null,
        selectedProfileId,
        mismatches: bestMatch.mismatches.length > 0 ? {
          effectiveProfileId: bestMatch.def.id,
          mismatches: bestMatch.mismatches,
        } : null,
        roleModels: effectiveRoleModels,
      };
    }
  }

  // Fallback: no match found, use selected profile
  return {
    effectiveProfileId: selectedProfileId || 'opencode-go-balanced',
    selectedProfileId,
    mismatches: null,
    roleModels: effectiveRoleModels,
  };
}

async function buildOpenCodeStatus(ctx, deps) {
  const { opencodeHome, elegyHomeAbs, engineRoot } = ctx;
  const opencodeConfig = deps.opencodeConfig;
  const assets = deps.assets;

  const managedAssetStatuses = assets && engineRoot && opencodeHome
    ? assets.getManagedAssetStatuses(engineRoot, opencodeHome, 'opencode-assets/manifest.json')
    : [];
  const configStatus = opencodeConfig.getStatus(opencodeHome);
  const profiles = buildProfiles(opencodeHome, engineRoot);

  // Compute effective profile (what the config actually uses vs what's selected)
  const effectiveProfileResult = findEffectiveProfile(configStatus, profiles, opencodeConfig, opencodeHome);
  const effectiveProfileId = effectiveProfileResult ? effectiveProfileResult.effectiveProfileId : profiles.activeProfileId;
  const selectedProfileId = effectiveProfileResult ? effectiveProfileResult.selectedProfileId : profiles.activeProfileId;

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
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallers,
  };

  const codexHome = ctx.codexHome || path.join(require('os').homedir(), '.codex');
  const setupChecks = buildSetupChecks(
    opencodeHome,
    elegyHomeAbs,
    engineRoot,
    assets,
    augmentedContext,
    opencodeConfig,
    codexHome,
  );

  const overallStatus = resolveOverallStatus(setupChecks);
  const warnings = buildWarnings(setupChecks);

  let worktreePermissionStatus = null;
  if (opencodeConfig && typeof opencodeConfig.getWorktreePermissionProfileStatus === 'function') {
    try {
      worktreePermissionStatus = opencodeConfig.getWorktreePermissionProfileStatus(opencodeHome) || null;
    } catch {
      worktreePermissionStatus = null;
    }
  }

  const opencodeCliStatus = (deps.toolCliInstallers || toolCliInstallers).getCliToolStatus
    ? (deps.toolCliInstallers || toolCliInstallers).getCliToolStatus('opencode-cli')
    : { installed: false };

  // R5: Profile mismatch detection — compare state file active profile against all agent file models
  let profileMismatch = null;
  try {
    const stateActiveRoute = opencodeConfig.getActiveProfileRoute
      ? opencodeConfig.getActiveProfileRoute(opencodeHome)
      : 'opencode-go';
    const profilesPath = path.resolve(engineRoot, 'opencode-assets', 'profiles.json');
    if (fs.existsSync(profilesPath)) {
      const profilesData = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
      const targetProfile = profilesData.profiles && profilesData.profiles[stateActiveRoute];
      const agentRoles = profilesData.agentRoles || {};
      if (targetProfile) {
        const agentsDir = path.join(opencodeHome, 'agents');
        if (fs.existsSync(agentsDir)) {
          const mismatches = [];
          for (const entry of fs.readdirSync(agentsDir).sort()) {
            if (!entry.endsWith('.md')) continue;
            const agentName = entry.slice(0, -3);
            const role = agentRoles[agentName];
            if (!role) continue;
            const expectedModel = targetProfile[role];
            if (!expectedModel) continue;
            const agentPath = path.join(agentsDir, entry);
            const agentContent = fs.readFileSync(agentPath, 'utf8');
            const fmMatch = agentContent.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
              const modelMatch = fmMatch[1].match(/^model:\s*(.+)$/m);
              if (modelMatch) {
                const actualModel = modelMatch[1].trim();
                if (actualModel !== expectedModel) {
                  mismatches.push({ agent: agentName, role, actualModel, expectedModel });
                }
              }
            }
          }
          if (mismatches.length > 0) {
            profileMismatch = { expectedProfile: stateActiveRoute, mismatches };
          }
        }
      }
    }
  } catch {
    // If drift detection fails (e.g., no agent file yet), leave profileMismatch as null
    profileMismatch = null;
  }

  // If selected profile != effective profile, enhance mismatch
  if (selectedProfileId && effectiveProfileId && selectedProfileId !== effectiveProfileId && !profileMismatch) {
    if (effectiveProfileResult && effectiveProfileResult.mismatches && effectiveProfileResult.mismatches.mismatches) {
      profileMismatch = {
        expectedProfile: selectedProfileId,
        effectiveProfile: effectiveProfileId,
        mismatches: effectiveProfileResult.mismatches.mismatches.map(m => ({
          agent: `role:${m.role}`,
          role: m.role,
          actualModel: m.actualModel,
          expectedModel: m.expectedModel,
        })),
      };
    }
  }

  // R6: Detect invalid custom provider/model pairs in opencode.jsonc agent config
  let invalidProviderModels = null;
  try {
    const config = opencodeConfig.readConfig(opencodeHome);
    const providers = config.provider && typeof config.provider === 'object' ? config.provider : {};
    const agent = config.agent && typeof config.agent === 'object' ? config.agent : {};
    const builtInProviders = new Set(['deepseek', 'opencode', 'opencode-go']);
    const invalid = [];
    for (const [agentName, agentCfg] of Object.entries(agent)) {
      if (!agentCfg || typeof agentCfg !== 'object' || typeof agentCfg.model !== 'string') continue;
      const modelId = agentCfg.model;
      const slashIdx = modelId.indexOf('/');
      if (slashIdx <= 0) continue;
      const providerPrefix = modelId.slice(0, slashIdx);
      if (builtInProviders.has(providerPrefix)) continue;
      const providerCfg = providers[providerPrefix];
      if (!providerCfg) {
        invalid.push({ agent: agentName, model: modelId, reason: `provider "${providerPrefix}" not configured` });
      } else if (providerCfg.models && typeof providerCfg.models === 'object') {
        const modelKey = modelId.slice(slashIdx + 1);
        if (!providerCfg.models[modelKey]) {
          invalid.push({ agent: agentName, model: modelId, reason: `model "${modelKey}" not found in provider "${providerPrefix}".models` });
        }
      }
    }
    if (invalid.length > 0) {
      invalidProviderModels = invalid;
    }
  } catch {
    invalidProviderModels = null;
  }

  const activeProfile = Array.isArray(profiles.profiles)
    ? profiles.profiles.find((p) => p.id === profiles.activeProfileId)
    : null;

  return {
    overallStatus,
    warnings,
    setupChecks,
    activeProfileId: profiles.activeProfileId,
    effectiveProfileId: effectiveProfileId || null,
    selectedProfileId: selectedProfileId || null,
    profiles: profiles.profiles,
    availableRoutes: profiles.availableRoutes,
    availableModels: profiles.availableModels || [],
    lanes,
    configPreview: getConfigPreview(opencodeConfig, opencodeHome),
    opencodeHome: configStatus.opencodeHome,
    configPath: configStatus.configPath,
    smallModel: configStatus.exploreModel,
    bigModel: configStatus.scoutModel,
    isCustomConfig: configStatus.isCustom,
    roleModels: (effectiveProfileResult?.roleModels && Object.keys(effectiveProfileResult.roleModels).length > 0)
      ? effectiveProfileResult.roleModels
      : (activeProfile?.roleModels || null),
    elegyPlanningCli: toolingStatus.elegyPlanningCli,
    elegySkillsAssets: toolingStatus.elegySkillsAssets,
    planningLiveAuthority,
    worktreePermissionProfile: worktreePermissionStatus,
    opencodeCli: opencodeCliStatus,
    profileMismatch,
    invalidProviderModels,
    customPrompts: deps.opencodeConfig.readCustomPrompts(opencodeHome),
    _managedPrompts: (deps.opencodeConfig.readState(opencodeHome))._managedPrompts || {},
  };
}

function handleProviderUsage(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  try {
    const data = providerUsageStats.buildProviderUsage();
    sendJson(res, 200, data);
  } catch (error) {
    sendJson(res, 500, { error: String(error.message || error) });
  }
}

function resolveOpencodeGoWorkspacesStore(deps) {
  if (!deps.opencodeGoWorkspaces) {
    return opencodeGoWorkspacesDefault.createOpenCodeGoWorkspaces({
      env: deps.env || process.env,
    });
  }
  if (typeof deps.opencodeGoWorkspaces.listWorkspaces === 'function') {
    return deps.opencodeGoWorkspaces;
  }
  if (typeof deps.opencodeGoWorkspaces === 'function') {
    return deps.opencodeGoWorkspaces({ env: deps.env || process.env });
  }
  return opencodeGoWorkspacesDefault.createOpenCodeGoWorkspaces({
    env: deps.env || process.env,
  });
}

function buildGoWorkspacesListResponse(ctx, deps) {
  const store = resolveOpencodeGoWorkspacesStore(deps);
  return store.listWorkspaces(ctx.opencodeHome);
}

function asPathParams(ctx) {
  if (ctx && ctx.match && Array.isArray(ctx.match)) {
    return ctx.match;
  }
  if (ctx && ctx.params && typeof ctx.params === 'object') {
    return [ctx.params.id, ctx.params.workspaceId];
  }
  return [];
}

function getPathParam(ctx, name) {
  const decodePathParam = (value) => {
    if (typeof value !== 'string') return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  if (ctx && ctx.params && typeof ctx.params === 'object' && ctx.params[name]) {
    return decodePathParam(ctx.params[name]);
  }
  const params = asPathParams(ctx);
  if (name === 'id' && typeof params[1] === 'string') {
    return decodePathParam(params[1]);
  }
  return null;
}

function registerGoWorkspacesRoutes(deps) {
  return [
    {
      method: 'GET',
      path: /^\/api\/opencode\/go-workspaces\/?$/,
      handler: async (ctx) => {
        try {
          const data = await buildGoWorkspacesListResponse(ctx, deps);
          deps.sendJson(ctx.res, 200, data);
        } catch (error) {
          deps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/opencode\/go-workspaces\/?$/,
      handler: async (ctx) => {
        try {
          const body = await deps.readJsonBody(ctx.req);
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.registerWorkspace(ctx.opencodeHome, body || {});
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/opencode\/go-workspaces\/(create-flow)\/?$/,
      handler: async (ctx) => {
        try {
          const body = await deps.readJsonBody(ctx.req).catch(() => ({}));
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const draft = store.createDraftProfile(body || {});
          deps.sendJson(ctx.res, 200, {
            ok: true,
            draft,
            consoleUrl: draft.consoleUrl || 'https://opencode.ai/workspace/new/go',
            authUrl: 'https://opencode.ai/connect',
          });
        } catch (error) {
          deps.sendJson(ctx.res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/opencode\/go-workspaces\/([^/]+)\/activate\/?$/,
      handler: async (ctx) => {
        const id = getPathParam(ctx, 'id');
        if (!id) {
          deps.sendJson(ctx.res, 400, { ok: false, error: 'id path param is required.' });
          return;
        }
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.activateWorkspace(ctx.opencodeHome, id);
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/go-workspaces/deactivate',
      handler: async (ctx) => {
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.deactivateWorkspace(ctx.opencodeHome);
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/go-workspaces/set-auto',
      handler: async (ctx) => {
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.setAutoMode(ctx.opencodeHome);
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: /^\/api\/opencode\/go-workspaces\/([^/]+)\/validate\/?$/,
      handler: async (ctx) => {
        const id = getPathParam(ctx, 'id');
        if (!id) {
          deps.sendJson(ctx.res, 400, { ok: false, error: 'id path param is required.' });
          return;
        }
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.validateWorkspace(ctx.opencodeHome, id);
          deps.sendJson(ctx.res, 200, { ok: data.status === 'ok', ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'PUT',
      path: /^\/api\/opencode\/go-workspaces\/([^/]+)\/?$/,
      handler: async (ctx) => {
        const id = getPathParam(ctx, 'id');
        if (!id) {
          deps.sendJson(ctx.res, 400, { ok: false, error: 'id path param is required.' });
          return;
        }
        try {
          const body = await deps.readJsonBody(ctx.req);
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.updateWorkspace(ctx.opencodeHome, id, body || {});
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'DELETE',
      path: /^\/api\/opencode\/go-workspaces\/([^/]+)\/?$/,
      handler: async (ctx) => {
        const id = getPathParam(ctx, 'id');
        if (!id) {
          deps.sendJson(ctx.res, 400, { ok: false, error: 'id path param is required.' });
          return;
        }
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const data = await store.deleteWorkspace(ctx.opencodeHome, id);
          deps.sendJson(ctx.res, 200, { ok: true, ...data });
        } catch (error) {
          const status = isValidationError(error) ? 400 : 500;
          deps.sendJson(ctx.res, status, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    // GET /api/opencode/go-workspaces/pool
    {
      method: 'GET',
      path: '/api/opencode/go-workspaces/pool',
      handler: (ctx) => {
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const pool = store.getPool(ctx.opencodeHome);
          deps.sendJson(ctx.res, 200, { pool });
        } catch (err) {
          deps.sendJson(ctx.res, 500, { error: String(err.message || err) });
        }
      },
    },
    // PUT /api/opencode/go-workspaces/pool
    {
      method: 'PUT',
      path: '/api/opencode/go-workspaces/pool',
      handler: async (ctx) => {
        try {
          const body = await deps.readJsonBody(ctx.req);
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const pool = store.setPool(ctx.opencodeHome, body);
          deps.sendJson(ctx.res, 200, { pool });
        } catch (err) {
          deps.sendJson(ctx.res, err.statusCode || 500, { error: String(err.message || err) });
        }
      },
    },
    // POST /api/opencode/go-workspaces/pool/validate
    {
      method: 'POST',
      path: '/api/opencode/go-workspaces/pool/validate',
      handler: async (ctx) => {
        try {
          const store = resolveOpencodeGoWorkspacesStore(deps);
          const result = await store.validatePool(ctx.opencodeHome);
          deps.sendJson(ctx.res, 200, result);
        } catch (err) {
          deps.sendJson(ctx.res, 500, { error: String(err.message || err) });
        }
      },
    },
  ];
}

function isValidationError(error) {
  if (!(error instanceof Error)) return false;
  const message = String(error.message || '');
  return /is required|must match|Unknown/.test(message);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizePermission(value) {
  // null / undefined / missing clears the permission field
  if (value == null) {
    return { ok: true, value: null };
  }

  if (!isPlainObject(value)) {
    return { ok: false, error: 'permission must be a plain object or null' };
  }

  // OpenCode's config schema expects all values under "permission" to be
  // PermissionActionConfig strings: "allow", "deny", or "ask".
  // Nested objects, arrays, numbers, etc. will cause SchemaError at startup.
  // See: https://opencode.ai/config.json
  const permission = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof key !== 'string' || !key.trim()) {
      return { ok: false, error: 'permission keys must be non-empty strings' };
    }
    // Skip the elegy-copilot-worktree-permission-profile marker —
    // it is stored in the state file, not in config.permission.
    if (key === 'elegy-copilot-worktree-permission-profile') {
      continue;
    }
    if (val !== 'allow' && val !== 'deny' && val !== 'ask') {
      return { ok: false, error: `permission value for "${key}" must be "allow", "deny", or "ask"` };
    }
    permission[key.trim()] = val;
  }

  return { ok: true, value: permission };
}

/**
 * Normalize permission values to strings for safe UI rendering.
 * OpenCode config schema allows both simple strings ("allow") and
 * nested objects ({"allow": true}) as permission values.
 * This flattens object values to their string equivalent so the
 * UI never receives a non-string value in the permission object.
 */
function normalizePermissions(permission) {
  if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
    return null;
  }
  const normalized = {};
  for (const [key, val] of Object.entries(permission)) {
    if (typeof val === 'string') {
      normalized[key] = val;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      // Object-valued: {"allow": true} → "allow", {"deny": true} → "deny", {"ask": true} → "ask"
      if (val.allow === true) normalized[key] = 'allow';
      else if (val.deny === true) normalized[key] = 'deny';
      else if (val.ask === true) normalized[key] = 'ask';
      else normalized[key] = 'allow'; // safe default for unknown shapes
    } else {
      // Unknown type, skip
      normalized[key] = 'allow';
    }
  }
  return normalized;
}

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    opencodeConfig: deps.opencodeConfig || opencodeConfigDefault,
    opencodeLogReader: deps.opencodeLogReader || opencodeLogReaderDefault,
    assets: deps.assets || assetsLib,
    opencodeGoWorkspaces: deps.opencodeGoWorkspaces || null,
    env: deps.env || process.env,
    childProcess: deps.childProcess || require('node:child_process'),
    fs: deps.fs || fs,
    path: deps.path || path,
    roadmapWorkflowPlanningBridge: deps.roadmapWorkflowPlanningBridge || null,
    toolCliInstallers: deps.toolCliInstallers || toolCliInstallers,
  };

  const baseRoutes = [
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
          const { opencodeHome, engineRoot } = ctx;
          const profileId = asTrimmedString(body.profileId);
          const profileRoute = asTrimmedString(body.profileRoute);
          const roleModels = body.roleModels && typeof body.roleModels === 'object' ? body.roleModels : null;
          const smallModel = asTrimmedString(body.smallModel);
          const bigModel = asTrimmedString(body.bigModel);
          const reviewModel = asTrimmedString(body.reviewModel);
          const { path: pathModule, fs: fsModule, childProcess: childProcessModule } = resolvedDeps;

          // Resolve which profile ID to activate (profileId preferred over profileRoute)
          const targetProfileId = profileId || profileRoute;

          // R2: Profile activation must invoke the CLI profile-switch script
          if (targetProfileId) {
            const scriptPath = pathModule.resolve(engineRoot, 'scripts', 'opencode-profile-switch.mjs');

            // Pre-invocation existence check
            if (!fsModule.existsSync(scriptPath)) {
              resolvedDeps.sendJson(ctx.res, 500, {
                ok: false,
                error: `Profile switch script not found at: ${scriptPath}`,
              });
              return;
            }

            // Validate that targetProfileId is a known profile
            let knownProfiles;
            try {
              const catalog = opencodeConfigDefault.readProfileCatalog(engineRoot);
              knownProfiles = Object.keys(catalog.profiles || {});
            } catch {
              knownProfiles = ['opencode-go-balanced', 'opencode-go-fast', 'opencode-zen-free', 'opencode-zen-mixed', 'deepseek-direct'];
            }
            if (knownProfiles.length === 0) {
              knownProfiles = ['opencode-go-balanced', 'opencode-go-fast', 'opencode-zen-free', 'opencode-zen-mixed', 'deepseek-direct'];
            }
            if (!knownProfiles.includes(targetProfileId)) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: `Unknown profile: ${targetProfileId}. Available: ${knownProfiles.join(', ')}`,
              });
              return;
            }

            try {
              await new Promise((resolve, reject) => {
                const child = childProcessModule.execFile(
                  process.execPath,
                  [scriptPath, targetProfileId],
                  {
                    cwd: engineRoot,
                    timeout: 30000, // 30 seconds
                    maxBuffer: 1024 * 1024, // 1 MB output buffer
                  },
                  (error, stdout, stderr) => {
                    if (error) {
                      const detail = stderr || error.message;
                      reject(new Error(`Profile switch failed: ${detail.trim()}`));
                      return;
                    }
                    resolve({ stdout, stderr });
                  },
                );

                // Timeout handling: the `timeout` option on execFile sends SIGTERM
                // after the timeout, but for explicitness we track it
                child.on('error', (err) => {
                  reject(new Error(`Profile switch script error: ${err.message}`));
                });
              });

              // Script succeeded — now update the state file
              // Use setActiveProfileId (preferred) with fallback to updateStateProfileRoute
              if (resolvedDeps.opencodeConfig.setActiveProfileId) {
                resolvedDeps.opencodeConfig.setActiveProfileId(opencodeHome, targetProfileId);
              } else if (resolvedDeps.opencodeConfig.updateStateProfileRoute) {
                resolvedDeps.opencodeConfig.updateStateProfileRoute(opencodeHome, targetProfileId);
              }
            } catch (scriptError) {
              resolvedDeps.sendJson(ctx.res, 500, {
                ok: false,
                error: scriptError instanceof Error ? scriptError.message : String(scriptError),
              });
              return;
            }
          }

          // Role models overrides (new preferred API)
          if (roleModels) {
            if (resolvedDeps.opencodeConfig.setAgentRoleModels) {
              resolvedDeps.opencodeConfig.setAgentRoleModels(opencodeHome, roleModels);
            }
          }

          // Legacy model overrides: only used when small/big/review are passed WITHOUT roleModels
          if (!roleModels && (smallModel || bigModel || reviewModel)) {
            resolvedDeps.opencodeConfig.setAgentModels(
              opencodeHome,
              smallModel || undefined,
              bigModel || undefined,
              reviewModel || undefined,
            );
          }

          // Apply custom prompts after role model changes
          try {
            const effectiveRoleModels = roleModels || {};
            resolvedDeps.opencodeConfig.applyCustomPrompts(
              opencodeHome,
              effectiveRoleModels,
              engineRoot,
            );
          } catch (promptError) {
            // Non-fatal: log but don't fail the config save
            console.error('Failed to apply custom prompts after config save:', promptError instanceof Error ? promptError.message : String(promptError));
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
      path: '/api/opencode/prompts',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const { opencodeHome, engineRoot } = ctx;
          const customPrompts = body.customPrompts && typeof body.customPrompts === 'object' ? body.customPrompts : null;

          if (!customPrompts) {
            resolvedDeps.sendJson(ctx.res, 400, { ok: false, error: 'customPrompts object is required' });
            return;
          }

          // Write to sidecar
          resolvedDeps.opencodeConfig.writeCustomPrompts(opencodeHome, customPrompts);

          // Apply to opencode.jsonc
          // Read current profile from state to get active roleModels
          const state = resolvedDeps.opencodeConfig.readState(opencodeHome);
          const activeProfileId = state.activeProfileId || 'opencode-go-balanced';
          const profileCatalog = resolvedDeps.opencodeConfig.readProfileCatalog(engineRoot);
          const profile = profileCatalog.profiles[activeProfileId];

          // Apply custom prompts using roleModels approach
          const result = resolvedDeps.opencodeConfig.applyCustomPrompts(
            opencodeHome,
            profile,
            profileCatalog,
          );

          resolvedDeps.sendJson(ctx.res, 200, { ok: true, ...result });
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
      path: '/api/opencode/prompts/effective',
      handler: async (ctx) => {
        try {
          const { opencodeHome } = ctx;
          const agent = ctx.u && ctx.u.searchParams ? ctx.u.searchParams.get('agent') : null;

          if (!agent || !agent.trim()) {
            resolvedDeps.sendJson(ctx.res, 400, { ok: false, error: 'agent query parameter is required' });
            return;
          }

          const agentName = agent.trim();

          // Read AGENTS.md from opencodeHome
          const agentsMdPath = resolvedDeps.path.join(opencodeHome, 'AGENTS.md');
          const agentsMdContent = resolvedDeps.fs.existsSync(agentsMdPath)
            ? resolvedDeps.fs.readFileSync(agentsMdPath, 'utf8')
            : null;

          // Read agent .md definition
          const agentMdPath = resolvedDeps.path.join(opencodeHome, 'agents', `${agentName}.md`);
          const agentMdContent = resolvedDeps.fs.existsSync(agentMdPath)
            ? resolvedDeps.fs.readFileSync(agentMdPath, 'utf8')
            : null;

          // Read current agent prompt from opencode.jsonc
          const config = resolvedDeps.opencodeConfig.readConfig(opencodeHome);
          const agentConfig = config.agent && config.agent[agentName];
          const customPrompt = agentConfig && typeof agentConfig.prompt === 'string'
            ? agentConfig.prompt
            : null;

          // Check managed prompts hash tracking
          const state = resolvedDeps.opencodeConfig.readState(opencodeHome);
          const managedPrompts = (state && state._managedPrompts) || {};
          const managed = managedPrompts[agentName];

          let elegyManaged = null;
          if (managed && customPrompt) {
            const currentHash = resolvedDeps.opencodeConfig.computeHash(customPrompt);
            elegyManaged = managed.hash === currentHash;
          } else if (customPrompt) {
            elegyManaged = false;
          }

          resolvedDeps.sendJson(ctx.res, 200, {
            ok: true,
            agent: agentName,
            layers: [
              {
                name: 'Provider prompt',
                source: 'OpenCode built-in',
                content: null,
                note: 'Built-in provider prompt \u2014 content not available for display. This is set by OpenCode and cannot be edited here.',
              },
              {
                name: 'AGENTS.md',
                source: agentsMdPath,
                content: agentsMdContent,
                missing: agentsMdContent === null,
              },
              {
                name: 'Agent definition',
                source: agentMdPath,
                content: agentMdContent,
                missing: agentMdContent === null,
              },
              {
                name: 'Custom override',
                source: 'opencode.jsonc',
                content: customPrompt,
                elegyManaged,
              },
            ],
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
      path: '/api/opencode/config/key',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const { opencodeHome } = ctx;
          const key = asTrimmedString(body.key);
          const value = body.value;

          if (!key) {
            resolvedDeps.sendJson(ctx.res, 400, { error: 'key is required' });
            return;
          }

          // Only allow known top-level boolean feature flags and experimental sub-keys
          const allowedTopKeys = ['lsp'];
          const allowedExperimentalKeys = ['batch_tool', 'openTelemetry', 'continue_loop_on_deny', 'disable_paste_summary'];
          const isExperimentalKey = key.startsWith('experimental.');
          const topLevelKey = isExperimentalKey ? key.slice('experimental.'.length) : key;

          if (!allowedTopKeys.includes(key) && !isExperimentalKey) {
            resolvedDeps.sendJson(ctx.res, 400, { error: `Unknown config key: ${key}. Allowed keys: ${allowedTopKeys.join(', ')} or experimental.* (${allowedExperimentalKeys.join(', ')})` });
            return;
          }

          if (isExperimentalKey && !allowedExperimentalKeys.includes(topLevelKey)) {
            resolvedDeps.sendJson(ctx.res, 400, { error: `Unknown experimental key: ${topLevelKey}. Allowed experimental keys: ${allowedExperimentalKeys.join(', ')}` });
            return;
          }

          if (typeof value !== 'boolean') {
            resolvedDeps.sendJson(ctx.res, 400, { error: 'value must be a boolean' });
            return;
          }

          // Read, update, write config
          const config = resolvedDeps.opencodeConfig.readConfig(opencodeHome);
          if (isExperimentalKey) {
            if (!config.experimental || typeof config.experimental !== 'object') {
              config.experimental = {};
            }
            config.experimental[topLevelKey] = value;
          } else {
            config[key] = value;
          }
          resolvedDeps.opencodeConfig.writeConfig(opencodeHome, config);

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
              return id.startsWith('opencode-') && !isLegacyElegyManifestAsset(asset);
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
          const { elegyHomeAbs, engineRoot, opencodeHome } = ctx;
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
            if (!elegyHomeAbs) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'elegyHome is required for elegy-planning CLI install.',
              });
              return;
            }
            const fetchImpl = resolvedDeps.fetchImpl || (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
            const installResult = await installLatestElegyPlanningCli({
              elegyHome: elegyHomeAbs,
              runtimeRoot: engineRoot,
              fetchImpl,
              childProcess: resolvedDeps.childProcess,
            });
            result = {
              downloadedPath: installResult.installedPath,
              installMetadata: installResult.metadata,
            };
          } else if (kind === 'elegy-skills') {
            if (!elegyHomeAbs || !opencodeHome) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'elegyHome and opencodeHome are required to install Elegy skills from GitHub.',
              });
              return;
            }
            const syncResult = await syncElegySkillAssetsFromGitHub({
              elegyHome: elegyHomeAbs,
              targetHome: opencodeHome,
              env: ctx.env,
              childProcess: resolvedDeps.childProcess,
              force,
            });
            result = { syncResult };
          } else if (kind === 'install-codex-planning') {
            const codexHome = ctx.codexHome || path.join(require('os').homedir(), '.codex');
            if (!codexHome) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'codexHome is required for Codex planning skill install.',
              });
              return;
            }
            const syncResult = resolvedDeps.assets.syncAll(engineRoot, codexHome, {
              dryRun: false,
              force,
              pointerMode: true,
              manifestPath: 'codex-assets/manifest.json',
              assetFilter: isElegySkillAsset,
            });
            result = { syncResult };
          } else if (kind === 'worktree-permission-profile') {
            if (!opencodeHome) {
              resolvedDeps.sendJson(ctx.res, 400, {
                ok: false,
                error: 'opencodeHome is required to apply the worktree permission profile.',
              });
              return;
            }
            if (!resolvedDeps.opencodeConfig.applyWorktreePermissionProfile) {
              resolvedDeps.sendJson(ctx.res, 500, {
                ok: false,
                error: 'opencodeConfig.applyWorktreePermissionProfile is not available.',
              });
              return;
            }
            const applyResult = resolvedDeps.opencodeConfig.applyWorktreePermissionProfile(opencodeHome, {
              dryRun: false,
            });
            result = {
              configPath: applyResult.configPath,
              profile: applyResult.profile,
              changed: applyResult.changed,
            };
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
      method: 'POST',
      path: '/api/opencode/cli/install',
      handler: async (ctx) => {
        try {
          const installer = resolvedDeps.toolCliInstallers;
          const result = await installer.installCliTool('opencode-cli');
          const status = await buildOpenCodeStatus(ctx, resolvedDeps);
          resolvedDeps.sendJson(ctx.res, result.ok ? 200 : 500, { ...result, status });
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
          const limit = asNumber(ctx.u.searchParams.get('limit') || undefined, resolvedDeps.opencodeLogReader.DEFAULT_LIMIT);
          const since = asTrimmedString(ctx.u.searchParams.get('since') || undefined);
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
            cliPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH,
            runtimeRoot: ctx.engineRoot,
            elegyHome: ctx.elegyHomeAbs,
            env: ctx.env,
          });
          resolvedDeps.sendJson(ctx.res, 200, {
            codexHome,
            planningSkill: planningSkillStatus,
            planningCliPath: cliPath || null,
            planningDbPath: ctx.env && ctx.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH || null,
            ready: planningSkillStatus.installed && Boolean(cliPath),
          });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    {
      method: 'GET',
      path: '/api/stats/provider-usage',
      handler: (ctx) => handleProviderUsage(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/opencode/permissions',
      handler: async (ctx) => {
        try {
          const config = resolvedDeps.opencodeConfig.readConfig(ctx.opencodeHome);
          const rawPermission = config && config.permission ? config.permission : null;
          const permission = normalizePermissions(rawPermission);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, permission });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
    {
      method: 'POST',
      path: '/api/opencode/permissions',
      handler: async (ctx) => {
        try {
          const body = await resolvedDeps.readJsonBody(ctx.req);
          const rawPermission = body.permission;

          // Validate and sanitize the permission object before writing to config.
          const validated = sanitizePermission(rawPermission);
          if (!validated.ok) {
            resolvedDeps.sendJson(ctx.res, 400, {
              ok: false,
              error: validated.error,
            });
            return;
          }

          const config = resolvedDeps.opencodeConfig.readConfig(ctx.opencodeHome);
          config.permission = validated.value;
          resolvedDeps.opencodeConfig.writeConfig(ctx.opencodeHome, config);
          resolvedDeps.sendJson(ctx.res, 200, { ok: true, permission: config.permission });
        } catch (error) {
          resolvedDeps.sendJson(ctx.res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  ];

  return baseRoutes.concat(registerGoWorkspacesRoutes(resolvedDeps));
}

module.exports = {
  register,
  handleProviderUsage,
  registerGoWorkspacesRoutes,
  buildGoWorkspacesListResponse,
  resolveOpencodeGoWorkspacesStore,
};
