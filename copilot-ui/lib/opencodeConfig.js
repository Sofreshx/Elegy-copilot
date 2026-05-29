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
  const json = JSON.stringify(config, null, 2) + '\n';
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

function getAgentModels(config) {
  const agent = config.agent && typeof config.agent === 'object' ? config.agent : {};
  return {
    explore: typeof agent.explore === 'object' && typeof agent.explore.model === 'string'
      ? agent.explore.model
      : null,
    scout: typeof agent.scout === 'object' && typeof agent.scout.model === 'string'
      ? agent.scout.model
      : null,
  };
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
  const isCustom = models.explore !== null || models.scout !== null;

  return {
    opencodeHome: resolvedHome,
    configPath: resolveConfigPath(resolvedHome),
    exploreModel: models.explore || KNOWN_DEFAULT_EXPLORE_MODEL,
    scoutModel: models.scout || KNOWN_DEFAULT_SCOUT_MODEL,
    isCustom,
    availableModels,
    lastAppliedAt: typeof state.lastAppliedAt === 'string' ? state.lastAppliedAt : null,
  };
}

function setAgentModels(opencodeHome, exploreModel, scoutModel) {
  const resolvedHome = resolveOpenCodeHome(opencodeHome);
  const config = readConfig(resolvedHome);
  const previousModels = getAgentModels(config);

  if (!config.agent || typeof config.agent !== 'object') {
    config.agent = {};
  }

  if (typeof exploreModel === 'string' && exploreModel.trim()) {
    if (!config.agent.explore || typeof config.agent.explore !== 'object') {
      config.agent.explore = {};
    }
    config.agent.explore.model = exploreModel.trim();
  }

  if (typeof scoutModel === 'string' && scoutModel.trim()) {
    if (!config.agent.scout || typeof config.agent.scout !== 'object') {
      config.agent.scout = {};
    }
    config.agent.scout.model = scoutModel.trim();
  }

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
    if (config.agent.explore && typeof config.agent.explore === 'object') {
      delete config.agent.explore.model;
      if (Object.keys(config.agent.explore).length === 0) {
        delete config.agent.explore;
      }
    }
    if (config.agent.scout && typeof config.agent.scout === 'object') {
      delete config.agent.scout.model;
      if (Object.keys(config.agent.scout).length === 0) {
        delete config.agent.scout;
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
};
