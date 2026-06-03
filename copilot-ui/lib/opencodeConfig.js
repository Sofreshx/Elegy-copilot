'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_OPENCODE_HOME = path.join(os.homedir(), '.config', 'opencode');
const CONFIG_FILENAME = 'opencode.jsonc';
const STATE_FILENAME = '.elegy-opencode-agent-state.json';

const KNOWN_DEFAULT_EXPLORE_MODEL = 'deepseek/deepseek-v4-flash';
const KNOWN_DEFAULT_SCOUT_MODEL = 'deepseek/deepseek-v4-flash';

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

  if (!config.agent || typeof config.agent !== 'object') {
    config.agent = {};
  }

  function ensureAgentEntry(name) {
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

module.exports = {
  KNOWN_DEFAULT_EXPLORE_MODEL,
  KNOWN_DEFAULT_SCOUT_MODEL,
  AGENT_KEYS,
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
  getActiveProfileRoute,
  setActiveProfileRoute,
  removeActiveProfileRoute,
  updateStateProfileRoute,
};
