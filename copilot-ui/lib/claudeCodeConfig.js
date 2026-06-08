'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_CLAUDE_HOME = path.join(os.homedir(), '.claude');
const SETTINGS_FILENAME = 'settings.json';
const STATE_FILENAME = '.elegy-claude-code-provider-state.json';
const BACKUP_FILENAME = '.elegy-claude-code-backup.json';
const DEEPSEEK_KEY_FILENAME = '.elegy-claude-deepseek-key.json';

const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen';
const DEEPSEEK_DIRECT_BASE_URL = 'https://api.deepseek.com/anthropic';
const DEEPSEEK_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_FLASH_MODEL = 'deepseek-v4-flash';
const OPENCODE_GO_OPUS_MODEL = 'claude-opus-4-6';
const OPENCODE_GO_SONNET_MODEL = 'claude-sonnet-4-6';
const OPENCODE_GO_HAIKU_MODEL = 'claude-haiku-4-5';

// Native OpenCode auth file (shared with opencodeGoWorkspaces)
const NATIVE_AUTH_FILENAME = 'auth.json';
const OPENCODE_GO_PROVIDER_KEY = 'opencode-go';
const DEEPSEEK_PROVIDER_KEY = 'deepseek';

const PROVIDER_MODES = Object.freeze({
  VANILLA: 'vanilla',
  OPENCODE_GO: 'opencode-go',
  DEEPSEEK_DIRECT: 'deepseek-direct',
  CUSTOM: 'custom',
});

function resolveClaudeHome(claudeHome) {
  return path.resolve(claudeHome || DEFAULT_CLAUDE_HOME);
}

function resolveSettingsPath(claudeHome) {
  return path.join(resolveClaudeHome(claudeHome), SETTINGS_FILENAME);
}

function resolveStatePath(claudeHome) {
  return path.join(resolveClaudeHome(claudeHome), STATE_FILENAME);
}

function resolveBackupPath(claudeHome) {
  return path.join(resolveClaudeHome(claudeHome), BACKUP_FILENAME);
}

function resolveDeepseekKeyPath(claudeHome) {
  return path.join(resolveClaudeHome(claudeHome), DEEPSEEK_KEY_FILENAME);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // ignore temp cleanup failures
    }
    throw error;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readSettings(claudeHome) {
  const settingsPath = resolveSettingsPath(claudeHome);
  const raw = readJsonFile(settingsPath);
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function writeSettings(claudeHome, settings) {
  const settingsPath = resolveSettingsPath(claudeHome);
  writeJsonAtomic(settingsPath, settings);
}

function backupSettings(claudeHome) {
  const backupPath = resolveBackupPath(claudeHome);
  if (fs.existsSync(backupPath)) return false;
  const settings = readSettings(claudeHome);
  settings._backupCreatedAt = nowIso();
  writeJsonAtomic(backupPath, settings);
  return true;
}

function restoreSettings(claudeHome) {
  const backupPath = resolveBackupPath(claudeHome);
  const backup = readJsonFile(backupPath);
  if (!backup || typeof backup !== 'object') return null;
  // Strip internal metadata before writing to settings.json
  delete backup._backupCreatedAt;
  writeSettings(claudeHome, backup);
  return backup;
}

function deleteBackup(claudeHome) {
  const backupPath = resolveBackupPath(claudeHome);
  if (fs.existsSync(backupPath)) {
    fs.rmSync(backupPath, { force: true });
    return true;
  }
  return false;
}

function readState(claudeHome) {
  const statePath = resolveStatePath(claudeHome);
  return readJsonFile(statePath) || {};
}

function writeState(claudeHome, state) {
  const statePath = resolveStatePath(claudeHome);
  writeJsonAtomic(statePath, state);
}

function readDeepseekKey(claudeHome) {
  const keyPath = resolveDeepseekKeyPath(claudeHome);
  const raw = readJsonFile(keyPath);
  if (!raw || typeof raw !== 'object') return null;
  return typeof raw.key === 'string' ? raw.key : null;
}

function resolveNativeAuthPath() {
  const xdgData = process.env.XDG_DATA_HOME;
  if (xdgData) {
    return path.resolve(xdgData, 'opencode', NATIVE_AUTH_FILENAME);
  }
  return path.join(os.homedir(), '.local', 'share', 'opencode', NATIVE_AUTH_FILENAME);
}

function readNativeAuthFile() {
  const authPath = resolveNativeAuthPath();
  return readJsonFile(authPath);
}

function resolveOpenCodeGoKeyFromNativeAuth() {
  const auth = readNativeAuthFile();
  if (!auth || typeof auth !== 'object') return null;
  const entry = auth[OPENCODE_GO_PROVIDER_KEY];
  if (!entry || typeof entry !== 'object') return null;
  const key = typeof entry.key === 'string' && entry.key.trim().length > 0 ? entry.key.trim() : null;
  return key ? { value: key, source: 'opencode-auth' } : null;
}

function resolveDeepseekKeyFromNativeAuth() {
  const auth = readNativeAuthFile();
  if (!auth || typeof auth !== 'object') return null;
  const entry = auth[DEEPSEEK_PROVIDER_KEY];
  if (!entry || typeof entry !== 'object') return null;
  const key = typeof entry.key === 'string' && entry.key.trim().length > 0 ? entry.key.trim() : null;
  return key;
}

function writeDeepseekKey(claudeHome, apiKey) {
  const keyPath = resolveDeepseekKeyPath(claudeHome);
  writeJsonAtomic(keyPath, { key: apiKey, updatedAt: nowIso() });
}

function detectProviderMode(claudeHome) {
  const settings = readSettings(claudeHome);
  const env = settings.env || {};
  const baseUrl = env.ANTHROPIC_BASE_URL || '';

  if (!baseUrl) return { mode: PROVIDER_MODES.VANILLA, baseUrl: null };

  if (baseUrl === OPENCODE_GO_BASE_URL) {
    return { mode: PROVIDER_MODES.OPENCODE_GO, baseUrl };
  }

  if (baseUrl === DEEPSEEK_DIRECT_BASE_URL) {
    return { mode: PROVIDER_MODES.DEEPSEEK_DIRECT, baseUrl };
  }

  return { mode: PROVIDER_MODES.CUSTOM, baseUrl };
}

function getStatus(claudeHome, resolveOpenCodeGoApiKey) {
  const resolved = resolveClaudeHome(claudeHome);
  const settingsPath = resolveSettingsPath(resolved);
  const settingsExists = fs.existsSync(settingsPath);
  const settings = readSettings(resolved);
  const env = settings.env || {};
  const { mode, baseUrl } = detectProviderMode(resolved);

  const hasBackup = fs.existsSync(resolveBackupPath(resolved));
  const backup = hasBackup ? readJsonFile(resolveBackupPath(resolved)) : null;

  let apiKeyConfigured = false;
  let openCodeGoKeyAvailable = false;
  let openCodeGoKeySource = null;

  if (mode === PROVIDER_MODES.OPENCODE_GO) {
    let keyResult = null;
    if (typeof resolveOpenCodeGoApiKey === 'function') {
      try {
        keyResult = resolveOpenCodeGoApiKey();
      } catch {
        // resolver failed, try fallback
      }
    }
    if (!keyResult) {
      keyResult = resolveOpenCodeGoKeyFromNativeAuth();
    }
    if (keyResult) {
      openCodeGoKeyAvailable = true;
      openCodeGoKeySource = keyResult.source;
      apiKeyConfigured = true;
    }
  } else if (mode === PROVIDER_MODES.DEEPSEEK_DIRECT) {
    apiKeyConfigured = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.length > 0;
  }

  const state = readState(resolved);

  return {
    activeMode: mode,
    baseUrl,
    hasBackup,
    backupCreatedAt: backup ? backup._backupCreatedAt || null : null,
    settingsPath,
    settingsExists,
    apiKeyConfigured,
    openCodeGoKeyAvailable,
    openCodeGoKeySource,
    model: env.ANTHROPIC_MODEL || null,
    lastAppliedAt: state.lastAppliedAt || null,
    lastResetAt: state.lastResetAt || null,
  };
}

function setMode(claudeHome, mode, options = {}) {
  const resolved = resolveClaudeHome(claudeHome);
  const { apiKey, resolveOpenCodeGoApiKey } = options;

  // Back up before first switch
  backupSettings(resolved);

  const settings = readSettings(resolved);
  if (!settings.env || typeof settings.env !== 'object') {
    settings.env = {};
  }
  const env = settings.env;

  // Clear previous provider env vars
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  delete env.CLAUDE_CODE_EFFORT_LEVEL;
  delete env.CLADE_CODE_EFFORT_LEVEL; // cleanup typo from earlier versions
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  delete env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK;

  if (mode === PROVIDER_MODES.OPENCODE_GO) {
    let resolvedKey = null;
    if (typeof resolveOpenCodeGoApiKey === 'function') {
      try {
        const keyResult = resolveOpenCodeGoApiKey();
        if (keyResult && keyResult.value) resolvedKey = keyResult.value;
      } catch {
        // key resolution failed
      }
    }
    if (!resolvedKey) {
      const fallback = resolveOpenCodeGoKeyFromNativeAuth();
      if (fallback && fallback.value) resolvedKey = fallback.value;
    }
    if (!resolvedKey) {
      throw new Error('OpenCode Go API key not available. Set up a workspace or provide an API key first.');
    }
    env.ANTHROPIC_BASE_URL = OPENCODE_GO_BASE_URL;
    env.ANTHROPIC_API_KEY = resolvedKey;
    env.ANTHROPIC_MODEL = OPENCODE_GO_OPUS_MODEL;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = OPENCODE_GO_OPUS_MODEL;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = OPENCODE_GO_SONNET_MODEL;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = OPENCODE_GO_HAIKU_MODEL;
    env.CLAUDE_CODE_SUBAGENT_MODEL = OPENCODE_GO_HAIKU_MODEL;
    env.CLAUDE_CODE_EFFORT_LEVEL = 'max';
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  } else if (mode === PROVIDER_MODES.DEEPSEEK_DIRECT) {
    const deepseekKey = apiKey || readDeepseekKey(resolved) || resolveDeepseekKeyFromNativeAuth();
    if (!deepseekKey) {
      throw new Error('DeepSeek API key is required. Provide it in the settings UI.');
    }
    env.ANTHROPIC_BASE_URL = DEEPSEEK_DIRECT_BASE_URL;
    env.ANTHROPIC_API_KEY = deepseekKey;
    env.ANTHROPIC_MODEL = DEEPSEEK_MODEL;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = DEEPSEEK_MODEL;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = DEEPSEEK_MODEL;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = DEEPSEEK_FLASH_MODEL;
    env.CLAUDE_CODE_SUBAGENT_MODEL = DEEPSEEK_FLASH_MODEL;
    env.CLAUDE_CODE_EFFORT_LEVEL = 'max';
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  }
  // mode === 'vanilla' or 'custom': env vars already cleared above

  writeSettings(resolved, settings);

  // Update provider state
  const state = readState(resolved);
  state.activeMode = mode;
  state.lastAppliedAt = nowIso();
  writeState(resolved, state);

  return getStatus(resolved, resolveOpenCodeGoApiKey);
}

function resetToVanilla(claudeHome) {
  const resolved = resolveClaudeHome(claudeHome);

  const settings = readSettings(resolved);
  if (!settings.env || typeof settings.env !== 'object') {
    settings.env = {};
  }
  const env = settings.env;

  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_MODEL;
  delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
  delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
  delete env.CLAUDE_CODE_SUBAGENT_MODEL;
  delete env.CLAUDE_CODE_EFFORT_LEVEL;
  delete env.CLADE_CODE_EFFORT_LEVEL; // cleanup typo from earlier versions
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  delete env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK;

  writeSettings(resolved, settings);

  const state = readState(resolved);
  state.activeMode = PROVIDER_MODES.VANILLA;
  state.lastResetAt = nowIso();
  writeState(resolved, state);

  return getStatus(resolved);
}

function restoreFromBackup(claudeHome, resolveOpenCodeGoApiKey) {
  const resolved = resolveClaudeHome(claudeHome);
  const restored = restoreSettings(resolved);
  if (!restored) {
    throw new Error('No backup found to restore.');
  }

  const state = readState(resolved);
  state.lastResetAt = nowIso();
  writeState(resolved, state);

  return getStatus(resolved, resolveOpenCodeGoApiKey);
}

function saveDeepseekApiKey(claudeHome, apiKey) {
  const resolved = resolveClaudeHome(claudeHome);
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('API key is required.');
  }
  writeDeepseekKey(resolved, apiKey.trim());
  return { ok: true };
}

function applyDefaultProvider(claudeHome) {
  const resolved = resolveClaudeHome(claudeHome);
  const current = detectProviderMode(resolved);

  // Don't overwrite if user has already configured a provider
  if (current.mode !== PROVIDER_MODES.VANILLA) {
    return { applied: false, reason: `Already configured as ${current.mode}` };
  }

  // Try DeepSeek Direct first (Anthropic-compatible, works with Claude Code)
  const deepseekKey = resolveDeepseekKeyFromNativeAuth();
  if (deepseekKey) {
    try {
      const result = setMode(resolved, PROVIDER_MODES.DEEPSEEK_DIRECT, { apiKey: deepseekKey });
      return { applied: true, mode: result.activeMode, source: 'native-auth' };
    } catch {
      // fall through
    }
  }

  return { applied: false, reason: 'No DeepSeek API key found in native auth file' };
}

module.exports = {
  PROVIDER_MODES,
  OPENCODE_GO_BASE_URL,
  DEEPSEEK_DIRECT_BASE_URL,
  resolveClaudeHome,
  readSettings,
  writeSettings,
  backupSettings,
  restoreSettings,
  deleteBackup,
  detectProviderMode,
  getStatus,
  setMode,
  resetToVanilla,
  restoreFromBackup,
  saveDeepseekApiKey,
  readDeepseekKey,
  applyDefaultProvider,
  _testing: {
    resolveSettingsPath,
    resolveStatePath,
    resolveBackupPath,
    resolveDeepseekKeyPath,
  },
};
