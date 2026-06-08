'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_OPENCODE_HOME = path.join(os.homedir(), '.config', 'opencode');
const DEFAULT_WORKTREE_BASE = path.join(os.homedir(), '.local', 'share', 'opencode', 'worktree');
const CONFIG_FILENAME = 'opencode.jsonc';
const STATE_FILENAME = '.elegy-opencode-agent-state.json';
const WORKTREE_PERMISSION_PROFILE_VERSION = 1;
const WORKTREE_PERMISSION_PROFILE_MARKER = 'instruction-engine-worktree-permission-profile';

const KNOWN_DEFAULT_EXPLORE_MODEL = 'opencode-go/deepseek-v4-flash';
const KNOWN_DEFAULT_SCOUT_MODEL = 'opencode-go/deepseek-v4-flash';

const AGENT_KEYS = ['explore', 'scout'];

const LANE_SMALL_AGENT_KEYS = ['explore', 'quick', 'impl', 'explorer'];
const LANE_BIG_AGENT_KEYS = ['scout', 'standard', 'spec', 'project'];
const LANE_REVIEW_AGENT_KEYS = ['reviewer'];
const ALL_LANE_AGENT_KEYS = [
  ...LANE_SMALL_AGENT_KEYS,
  ...LANE_BIG_AGENT_KEYS,
  ...LANE_REVIEW_AGENT_KEYS,
];

function resolveOpenCodeHome(opencodeHome) {
  return path.resolve(opencodeHome || DEFAULT_OPENCODE_HOME);
}

function resolveConfigPath(opencodeHome) {
  return path.join(resolveOpenCodeHome(opencodeHome), CONFIG_FILENAME);
}

function resolveStatePath(opencodeHome) {
  return path.join(resolveOpenCodeHome(opencodeHome), STATE_FILENAME);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch {
    return '';
  }
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, text, 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}

function stripJsonComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  let stringQuote = '"';
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function removeTrailingCommas(text) {
  let previous = null;
  let current = text;
  while (current !== previous) {
    previous = current;
    current = current.replace(/,\s*([}\]])/g, '$1');
  }
  return current;
}

function parseJsonc(text) {
  const stripped = stripJsonComments(String(text || ''));
  const withoutTrailingCommas = removeTrailingCommas(stripped);
  return JSON.parse(withoutTrailingCommas);
}

function readConfig(opencodeHome) {
  const configPath = resolveConfigPath(opencodeHome);
  const raw = readTextIfExists(configPath);
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = parseJsonc(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeConfig(opencodeHome, config) {
  const configPath = resolveConfigPath(opencodeHome);
  const cleaned = { ...config };
  if (cleaned.provider && typeof cleaned.provider === 'object' && !Array.isArray(cleaned.provider)) {
    const { route: _removed, ...rest } = cleaned.provider;
    if (Object.keys(rest).length > 0) {
      cleaned.provider = rest;
    } else {
      delete cleaned.provider;
    }
  }
  const json = JSON.stringify(cleaned, null, 2) + '\n';
  writeTextAtomic(configPath, json);
}

function readState(opencodeHome) {
  const statePath = resolveStatePath(opencodeHome);
  try {
    if (!fs.existsSync(statePath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getActiveProfileRoute(opencodeHome) {
  const state = readState(opencodeHome);
  if (typeof state.activeProfileRoute === 'string' && state.activeProfileRoute) {
    return state.activeProfileRoute;
  }
  return 'opencode-go';
}

function setActiveProfileRoute(opencodeHome, route) {
  const state = readState(opencodeHome);
  state.activeProfileRoute = route;
  state.updatedAt = new Date().toISOString();
  writeState(opencodeHome, state);
}

function removeActiveProfileRoute(opencodeHome) {
  const state = readState(opencodeHome);
  delete state.activeProfileRoute;
  state.updatedAt = new Date().toISOString();
  writeState(opencodeHome, state);
}

function updateStateProfileRoute(opencodeHome, route) {
  if (typeof route === 'string' && route) {
    setActiveProfileRoute(opencodeHome, route);
  } else {
    removeActiveProfileRoute(opencodeHome);
  }
}

function writeState(opencodeHome, state) {
  const statePath = resolveStatePath(opencodeHome);
  writeTextAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function removeState(opencodeHome) {
  const statePath = resolveStatePath(opencodeHome);
  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function resolveAgentModel(agentSection, key) {
  if (!agentSection || typeof agentSection !== 'object') return null;
  const entry = agentSection[key];
  return typeof entry === 'object' && typeof entry.model === 'string' ? entry.model : null;
}

function getAgentModels(config) {
  const agent = config.agent && typeof config.agent === 'object' ? config.agent : {};
  const models = {};
  for (const key of ALL_LANE_AGENT_KEYS) {
    models[key] = resolveAgentModel(agent, key);
  }
  return models;
}

function listAvailableModels(config) {
  const models = new Set();

  models.add(KNOWN_DEFAULT_EXPLORE_MODEL);
  models.add(KNOWN_DEFAULT_SCOUT_MODEL);

  const providers = config.provider && typeof config.provider === 'object' ? config.provider : {};
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    if (!providerConfig || typeof providerConfig !== 'object') continue;
    const providerModels = providerConfig.models && typeof providerConfig.models === 'object'
      ? providerConfig.models
      : {};
    for (const modelId of Object.keys(providerModels)) {
      models.add(`${providerId}/${modelId}`);
    }
  }

  return Array.from(models).sort();
}

function getStatus(opencodeHome) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);
  const state = readState(resolvedHome);
  const models = getAgentModels(config);
  const availableModels = listAvailableModels(config);
  const isCustom = Object.values(models).some((m) => m !== null);

  return {
    opencodeHome: resolvedHome,
    configPath: resolveConfigPath(resolvedHome),
    exploreModel: models.explore || KNOWN_DEFAULT_EXPLORE_MODEL,
    scoutModel: models.scout || KNOWN_DEFAULT_SCOUT_MODEL,
    agentModels: models,
    isCustom,
    availableModels,
    lastAppliedAt: typeof state.lastAppliedAt === 'string' ? state.lastAppliedAt : null,
  };
}

function setAgentModels(opencodeHome, smallModel, bigModel, reviewModel) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);
  const previousModels = getAgentModels(config);

  // Build normalized roleModels from legacy small/big/review
  const roleModels = {};
  if (typeof smallModel === 'string' && smallModel.trim()) {
    roleModels.exploration = smallModel.trim();
    roleModels.implementation = smallModel.trim();
  }
  if (typeof bigModel === 'string' && bigModel.trim()) {
    roleModels.planning = bigModel.trim();
    roleModels.research = bigModel.trim();
  }
  if (typeof reviewModel === 'string' && reviewModel.trim()) {
    roleModels.review = reviewModel.trim();
  }

  // Write role-level overrides via new API
  if (!config.agentRoleModels || typeof config.agentRoleModels !== 'object') {
    config.agentRoleModels = {};
  }
  for (const [role, model] of Object.entries(roleModels)) {
    if (!config.agentRoleModels[role] || typeof config.agentRoleModels[role] !== 'object') {
      config.agentRoleModels[role] = {};
    }
    config.agentRoleModels[role].model = model;
  }

  // Also write legacy agent.<name>.model for backward compat
  function ensureAgentEntry(name) {
    if (!config.agent || typeof config.agent !== 'object') {
      config.agent = {};
    }
    if (!config.agent[name] || typeof config.agent[name] !== 'object') {
      config.agent[name] = {};
    }
  }
  function applyModel(targetKeys, modelValue) {
    if (typeof modelValue !== 'string' || !modelValue.trim()) return;
    for (const key of targetKeys) {
      ensureAgentEntry(key);
      config.agent[key].model = modelValue.trim();
    }
  }
  applyModel(LANE_SMALL_AGENT_KEYS, smallModel);
  applyModel(LANE_BIG_AGENT_KEYS, bigModel);
  applyModel(LANE_REVIEW_AGENT_KEYS, reviewModel);

  writeConfig(resolvedHome, config);
  writeState(resolvedHome, {
    ...readState(resolvedHome),
    lastAppliedAt: new Date().toISOString(),
    previousExploreModel: previousModels.explore,
    previousScoutModel: previousModels.scout,
  });

  return getStatus(resolvedHome);
}

function resetConfig(opencodeHome) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);

  if (config.agent && typeof config.agent === 'object') {
    for (const key of ALL_LANE_AGENT_KEYS) {
      if (config.agent[key] && typeof config.agent[key] === 'object') {
        delete config.agent[key].model;
        if (Object.keys(config.agent[key]).length === 0) {
          delete config.agent[key];
        }
      }
    }
    if (Object.keys(config.agent).length === 0) {
      delete config.agent;
    }
  }

  writeConfig(resolvedHome, config);
  removeState(resolvedHome);

  return getStatus(resolvedHome);
}

function resolveWorktreeBase(explicit) {
  if (typeof explicit === 'string' && explicit.trim()) {
    return path.resolve(explicit);
  }
  if (typeof process !== 'undefined' && process.env && process.env.OPENCODE_WORKTREE_BASE) {
    return path.resolve(process.env.OPENCODE_WORKTREE_BASE);
  }
  return DEFAULT_WORKTREE_BASE;
}

function buildWorktreePermissionProfile(worktreeBase) {
  const resolvedBase = resolveWorktreeBase(worktreeBase);
  return {
    permission: {
      external_directory: 'allow',
      bash: 'allow',
    },
    marker: {
      version: WORKTREE_PERMISSION_PROFILE_VERSION,
      marker: WORKTREE_PERMISSION_PROFILE_MARKER,
      worktreeBase: resolvedBase,
    },
  };
}

function ensureWorktreePermissionProfile(config, worktreeBase) {
  const profile = buildWorktreePermissionProfile(worktreeBase);
  const target = config && typeof config === 'object' && !Array.isArray(config) ? { ...config } : {};
  const existingPermission = target.permission && typeof target.permission === 'object' && !Array.isArray(target.permission)
    ? { ...target.permission }
    : {};

  // Apply flat permission values from the profile
  for (const [key, value] of Object.entries(profile.permission)) {
    existingPermission[key] = value;
  }

  target.permission = existingPermission;
  return { config: target, profile };
}

function applyWorktreePermissionProfile(opencodeHome, options = {}) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const configPath = resolveConfigPath(resolvedHome);
  const config = readConfig(resolvedHome);
  const { config: nextConfig, profile } = ensureWorktreePermissionProfile(config, options.worktreeBase);

  let changed = false;
  const previousJson = JSON.stringify(config || {}, null, 2);
  const nextJson = JSON.stringify(nextConfig, null, 2);
  if (previousJson !== nextJson) {
    changed = true;
    if (!options.dryRun) {
      writeConfig(resolvedHome, nextConfig);
      // Track the profile application in the state file (not in config.permission, which only accepts PermissionActionConfig strings)
      const state = readState(resolvedHome);
      state.worktreeProfile = {
        ...profile.marker,
        appliedAt: new Date().toISOString(),
      };
      state.updatedAt = new Date().toISOString();
      writeState(resolvedHome, state);
    }
  }

  return {
    configPath,
    opencodeHome: resolvedHome,
    profile,
    changed,
    dryRun: Boolean(options.dryRun),
  };
}

function getWorktreePermissionProfileStatus(opencodeHome) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);
  const state = readState(resolvedHome);
  const profile = buildWorktreePermissionProfile();
  const permission = config && typeof config.permission === 'object' && !Array.isArray(config.permission)
    ? config.permission
    : {};
  const marker = state && typeof state.worktreeProfile === 'object'
    ? state.worktreeProfile
    : null;

  // Check that expected permission keys exist with the correct values
  const expectedPermKeys = Object.keys(profile.permission);
  const missingPermKeys = expectedPermKeys.filter(
    (key) => permission[key] !== 'allow' && permission[key] !== 'deny'
  );

  const applied = Boolean(marker)
    && Number(marker.version) === profile.marker.version
    && marker.marker === WORKTREE_PERMISSION_PROFILE_MARKER
    && missingPermKeys.length === 0;

  return {
    worktreeBase: marker && typeof marker.worktreeBase === 'string' ? marker.worktreeBase : resolveWorktreeBase(),
    configPath: resolveConfigPath(resolvedHome),
    applied,
    version: marker && Number(marker.version) === profile.marker.version ? profile.marker.version : null,
    expectedVersion: profile.marker.version,
    marker,
    missingPermissionKeys: missingPermKeys,
  };
}

function readProfileCatalog(workspaceRoot) {
  const root = workspaceRoot || process.cwd();
  const profilesPath = path.join(root, 'opencode-assets', 'profiles.json');
  const raw = fs.readFileSync(profilesPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeProfile(profile, profileId) {
  if (!profile || typeof profile !== 'object') {
    return profile;
  }

  const normalized = { ...profile };

  if (!normalized.roleModels || typeof normalized.roleModels !== 'object') {
    normalized.roleModels = {
      exploration: typeof normalized.small === 'string' ? normalized.small : '',
      implementation: typeof normalized.small === 'string' ? normalized.small : '',
      planning: typeof normalized.big === 'string' ? normalized.big : '',
      review: typeof normalized.review === 'string' ? normalized.review : '',
      research: typeof normalized.big === 'string' ? normalized.big : '',
    };
  }

  if (!normalized.label) {
    normalized.label = typeof profileId === 'string' ? profileId : 'Unknown Profile';
  }
  if (!normalized.description) {
    normalized.description = '';
  }
  if (!Array.isArray(normalized.tags)) {
    normalized.tags = [];
  }

  return normalized;
}

function applyProfile(opencodeHome, profile) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);

  const normalized = normalizeProfile(profile);

  if (normalized.roleModels && typeof normalized.roleModels === 'object') {
    if (!config.agentRoleModels || typeof config.agentRoleModels !== 'object') {
      config.agentRoleModels = {};
    }
    for (const [role, model] of Object.entries(normalized.roleModels)) {
      if (typeof model === 'string' && model.trim()) {
        if (!config.agentRoleModels[role] || typeof config.agentRoleModels[role] !== 'object') {
          config.agentRoleModels[role] = {};
        }
        config.agentRoleModels[role].model = model.trim();
      }
    }
  }

  writeConfig(resolvedHome, config);
  return getStatus(resolvedHome);
}

function setAgentRoleModels(opencodeHome, roleModels) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);

  if (!config.agentRoleModels || typeof config.agentRoleModels !== 'object') {
    config.agentRoleModels = {};
  }

  for (const [role, model] of Object.entries(roleModels)) {
    if (typeof model !== 'string' || !model.trim()) continue;
    if (!config.agentRoleModels[role] || typeof config.agentRoleModels[role] !== 'object') {
      config.agentRoleModels[role] = {};
    }
    config.agentRoleModels[role].model = model.trim();
  }

  writeConfig(resolvedHome, config);
  return getStatus(resolvedHome);
}

function getActiveProfileId(opencodeHome) {
  const state = readState(opencodeHome);
  if (typeof state.activeProfileId === 'string' && state.activeProfileId) {
    return state.activeProfileId;
  }
  if (typeof state.activeProfileRoute === 'string' && state.activeProfileRoute) {
    return state.activeProfileRoute;
  }
  return 'opencode-go-balanced';
}

function setActiveProfileId(opencodeHome, profileId) {
  const state = readState(opencodeHome);
  state.activeProfileId = profileId;
  state.updatedAt = new Date().toISOString();
  writeState(opencodeHome, state);
}

module.exports = {
  KNOWN_DEFAULT_EXPLORE_MODEL,
  KNOWN_DEFAULT_SCOUT_MODEL,
  AGENT_KEYS,
  DEFAULT_OPENCODE_HOME,
  DEFAULT_WORKTREE_BASE,
  LANE_SMALL_AGENT_KEYS,
  LANE_BIG_AGENT_KEYS,
  LANE_REVIEW_AGENT_KEYS,
  ALL_LANE_AGENT_KEYS,
  resolveOpenCodeHome,
  resolveConfigPath,
  resolveStatePath,
  readConfig,
  writeConfig,
  parseJsonc,
  getAgentModels,
  listAvailableModels,
  getStatus,
  setAgentModels,
  resetConfig,
  getActiveProfileId,
  getActiveProfileRoute,
  setActiveProfileRoute,
  normalizeProfile,
  readProfileCatalog,
  removeActiveProfileRoute,
  updateStateProfileRoute,
  applyProfile,
  resolveWorktreeBase,
  setActiveProfileId,
  setAgentRoleModels,
  buildWorktreePermissionProfile,
  ensureWorktreePermissionProfile,
  applyWorktreePermissionProfile,
  getWorktreePermissionProfileStatus,
  WORKTREE_PERMISSION_PROFILE_MARKER,
  WORKTREE_PERMISSION_PROFILE_VERSION,
};
