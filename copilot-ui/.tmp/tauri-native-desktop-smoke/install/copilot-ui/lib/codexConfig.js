'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml');

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');
const CONFIG_FILENAME = 'config.toml';
const STATE_FILENAME = '.elegy-codex-provider-state.json';
const BACKUP_FILENAME = '.elegy-codex-provider-backup.toml';
const MANAGED_BLOCK_START = '# BEGIN elegy managed codex provider';
const MANAGED_BLOCK_END = '# END elegy managed codex provider';
const ROUTED_PROVIDER_ID = 'instruction_engine_elegy';
const ROUTED_PROVIDER_NAME = 'Elegy Routed';
const ROUTED_MODEL = 'opencode-go';
const ROUTED_BASE_URL = 'http://127.0.0.1:4318/v1';
const ROUTED_ENV_KEY = 'OPENCODE_GO_API_KEY';

function resolveCodexHome(codexHome) {
  return path.resolve(codexHome || DEFAULT_CODEX_HOME);
}

function resolveConfigPath(codexHome) {
  return path.join(resolveCodexHome(codexHome), CONFIG_FILENAME);
}

function resolveStatePath(codexHome) {
  return path.join(resolveCodexHome(codexHome), STATE_FILENAME);
}

function resolveBackupPath(codexHome) {
  return path.join(resolveCodexHome(codexHome), BACKUP_FILENAME);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function validateConfigToml(text, context) {
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) {
    return;
  }

  try {
    toml.parse(normalized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const prefix = context ? `Codex config TOML validation failed ${context}` : 'Codex config TOML validation failed';
    const validationError = new Error(`${prefix}: ${detail}`);
    validationError.statusCode = 422;
    throw validationError;
  }
}

function readState(codexHome) {
  const statePath = resolveStatePath(codexHome);
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

function writeState(codexHome, state) {
  const statePath = resolveStatePath(codexHome);
  writeTextAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return statePath;
}

function removeState(codexHome) {
  const statePath = resolveStatePath(codexHome);
  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function hasTopLevelKey(text, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'm').test(text);
}

function stripManagedBlock(text) {
  const normalized = normalizeNewlines(text);
  const pattern = new RegExp(
    `\\n?${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}\\n?`,
    'g',
  );
  return normalized.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function buildManagedBlock() {
  return [
    MANAGED_BLOCK_START,
    `[model_providers.${ROUTED_PROVIDER_ID}]`,
    `name = "${ROUTED_PROVIDER_NAME}"`,
    `base_url = "${ROUTED_BASE_URL}"`,
    `env_key = "${ROUTED_ENV_KEY}"`,
    'wire_api = "responses"',
    MANAGED_BLOCK_END,
  ].join('\n');
}

function writeBackupIfNeeded(codexHome, originalText) {
  const backupPath = resolveBackupPath(codexHome);
  if (fs.existsSync(backupPath)) {
    return backupPath;
  }
  writeTextAtomic(backupPath, normalizeNewlines(originalText || ''));
  return backupPath;
}

function isTableHeaderLine(line) {
  return /^\s*\[\[?[^\]]+\]?\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function splitRootPreamble(text) {
  const normalized = normalizeNewlines(text);
  const lines = normalized.split('\n');
  const tableHeaderIndex = lines.findIndex((line) => isTableHeaderLine(line));
  if (tableHeaderIndex === -1) {
    return {
      preambleLines: lines,
      bodyText: '',
    };
  }
  return {
    preambleLines: lines.slice(0, tableHeaderIndex),
    bodyText: lines.slice(tableHeaderIndex).join('\n').trim(),
  };
}

function composeConfigText(preambleLines, bodyText, managedBlockText) {
  const sections = [];
  const preambleText = preambleLines.join('\n').trimEnd();
  if (preambleText) {
    sections.push(preambleText);
  }
  if (String(bodyText || '').trim()) {
    sections.push(String(bodyText || '').trim());
  }
  if (String(managedBlockText || '').trim()) {
    sections.push(String(managedBlockText || '').trim());
  }
  if (sections.length === 0) {
    return '';
  }
  return ensureTrailingNewline(sections.join('\n\n'));
}

function findRootKeyLineIndex(lines, key) {
  return lines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(String(line || '')));
}

function removeRootKeyLines(lines, key) {
  return lines.filter((line) => !new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(String(line || '')));
}

function insertRootKeyLine(lines, line) {
  const nextLines = [...lines];
  let insertAt = nextLines.length;
  while (insertAt > 0 && !String(nextLines[insertAt - 1] || '').trim()) {
    insertAt -= 1;
  }
  nextLines.splice(insertAt, 0, line);
  return nextLines;
}

function upsertRootKeyLine(lines, key, line) {
  const nextLines = [...lines];
  const index = findRootKeyLineIndex(nextLines, key);
  const previousLine = index === -1 ? null : nextLines[index];
  if (index === -1) {
    return {
      lines: insertRootKeyLine(nextLines, line),
      previousLine,
    };
  }
  nextLines[index] = line;
  return {
    lines: nextLines,
    previousLine,
  };
}

function restoreRootKeyLine(lines, key, previousLine) {
  const withoutKey = removeRootKeyLines(lines, key);
  if (!previousLine) {
    return withoutKey;
  }
  return insertRootKeyLine(withoutKey, previousLine);
}

function hasProviderTable(text, providerId) {
  return new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(providerId)}\\]\\s*$`, 'm').test(normalizeNewlines(text));
}

function appendManagedBlock(text) {
  const stripped = stripManagedBlock(text);
  if (hasProviderTable(stripped, ROUTED_PROVIDER_ID)) {
    const error = new Error(`Existing Codex config already defines [model_providers.${ROUTED_PROVIDER_ID}].`);
    error.statusCode = 409;
    throw error;
  }

  const { preambleLines, bodyText } = splitRootPreamble(stripped);
  const providerResult = upsertRootKeyLine(
    preambleLines,
    'model_provider',
    `model_provider = "${ROUTED_PROVIDER_ID}"`,
  );
  const modelResult = upsertRootKeyLine(
    providerResult.lines,
    'model',
    `model = "${ROUTED_MODEL}"`,
  );

  return {
    nextText: composeConfigText(modelResult.lines, bodyText, buildManagedBlock()),
    previousModelLine: modelResult.previousLine,
    previousModelProviderLine: providerResult.previousLine,
  };
}

function applySoftReset(text, state = {}) {
  const stripped = stripManagedBlock(text);
  const { preambleLines, bodyText } = splitRootPreamble(stripped);
  const restoredProviderLines = restoreRootKeyLine(
    preambleLines,
    'model_provider',
    typeof state.previousModelProviderLine === 'string' ? state.previousModelProviderLine : null,
  );
  const restoredModelLines = restoreRootKeyLine(
    restoredProviderLines,
    'model',
    typeof state.previousModelLine === 'string' ? state.previousModelLine : null,
  );
  return composeConfigText(restoredModelLines, bodyText, '');
}

function hasBackup(codexHome) {
  return fs.existsSync(resolveBackupPath(codexHome));
}

function getStatus(codexHome) {
  const resolvedHome = resolveCodexHome(codexHome);
  const configPath = resolveConfigPath(resolvedHome);
  const statePath = resolveStatePath(resolvedHome);
  const backupPath = resolveBackupPath(resolvedHome);
  const configText = readTextIfExists(configPath);
  const state = readState(resolvedHome);
  const activeMode = configText.includes(MANAGED_BLOCK_START) ? 'elegy-routed' : 'native';

  return {
    codexHome: resolvedHome,
    configPath,
    statePath,
    backupPath,
    exists: fs.existsSync(configPath),
    activeMode,
    providerId: activeMode === 'elegy-routed' ? ROUTED_PROVIDER_ID : 'openai',
    hasManagedBlock: configText.includes(MANAGED_BLOCK_START),
    hasBackup: hasBackup(resolvedHome),
    lastAppliedAt: typeof state.lastAppliedAt === 'string' ? state.lastAppliedAt : null,
    lastResetAt: typeof state.lastResetAt === 'string' ? state.lastResetAt : null,
    backupCreatedAt: typeof state.backupCreatedAt === 'string' ? state.backupCreatedAt : null,
    gateway: {
      providerId: ROUTED_PROVIDER_ID,
      model: ROUTED_MODEL,
      baseUrl: ROUTED_BASE_URL,
      envKey: ROUTED_ENV_KEY,
    },
  };
}

function setMode(codexHome, mode) {
  const resolvedHome = resolveCodexHome(codexHome);
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (normalizedMode !== 'native' && normalizedMode !== 'elegy-routed') {
    const error = new Error('mode must be "native" or "elegy-routed"');
    error.statusCode = 400;
    throw error;
  }

  const configPath = resolveConfigPath(resolvedHome);
  const existing = readTextIfExists(configPath);
  const previousState = readState(resolvedHome);
  const alreadyActive = existing.includes(MANAGED_BLOCK_START);
  if (normalizedMode === 'elegy-routed' && alreadyActive) {
    return {
      ...getStatus(resolvedHome),
      changed: false,
      action: 'activate',
    };
  }
  const nextText = normalizedMode === 'elegy-routed'
    ? appendManagedBlock(existing)
    : { nextText: applySoftReset(existing, previousState) };
  const changed = normalizeNewlines(existing) !== normalizeNewlines(nextText.nextText);

  if (changed && nextText.nextText) {
    validateConfigToml(
      nextText.nextText,
      normalizedMode === 'elegy-routed' ? 'after enabling Elegy Routed' : 'after restoring native mode',
    );
  }

  if (normalizedMode === 'elegy-routed') {
    const backupPath = writeBackupIfNeeded(resolvedHome, existing);
    writeState(resolvedHome, {
      ...previousState,
      backupPath,
      backupCreatedAt: previousState.backupCreatedAt || new Date().toISOString(),
      originalConfigExisted: fs.existsSync(configPath),
      previousModelLine: nextText.previousModelLine,
      previousModelProviderLine: nextText.previousModelProviderLine,
      lastAppliedAt: new Date().toISOString(),
      activeMode: normalizedMode,
    });
  } else {
    writeState(resolvedHome, {
      ...previousState,
      activeMode: normalizedMode,
      lastResetAt: new Date().toISOString(),
    });
  }

  if (changed) {
    if (!nextText.nextText && previousState.originalConfigExisted === false) {
      try {
        fs.rmSync(configPath, { force: true });
      } catch {
        // Ignore deletion failures for soft reset.
      }
    } else {
      writeTextAtomic(configPath, nextText.nextText);
    }
  }

  return {
    ...getStatus(resolvedHome),
    changed,
    action: normalizedMode === 'elegy-routed' ? 'activate' : 'soft-reset',
  };
}

function hardReset(codexHome) {
  const resolvedHome = resolveCodexHome(codexHome);
  const backupPath = resolveBackupPath(resolvedHome);
  const configPath = resolveConfigPath(resolvedHome);
  const previousState = readState(resolvedHome);

  if (!fs.existsSync(backupPath) && previousState.originalConfigExisted !== false) {
    const error = new Error('No Codex backup snapshot is available for hard restore.');
    error.statusCode = 404;
    throw error;
  }

  const backupText = readTextIfExists(backupPath);
  const existing = readTextIfExists(configPath);
  const nextText = previousState.originalConfigExisted === false ? '' : normalizeNewlines(backupText);
  const changed = normalizeNewlines(existing) !== normalizeNewlines(nextText);
  if (changed && nextText) {
    validateConfigToml(nextText, 'before hard restore');
  }
  if (previousState.originalConfigExisted === false) {
    try {
      fs.rmSync(configPath, { force: true });
    } catch {
      // Ignore deletion failures during hard restore.
    }
  } else {
    writeTextAtomic(configPath, nextText);
  }
  try {
    fs.rmSync(backupPath, { force: true });
  } catch {
    // Ignore backup cleanup failures.
  }
  removeState(resolvedHome);

  return {
    ...getStatus(resolvedHome),
    changed,
    action: 'hard-reset',
  };
}

module.exports = {
  ROUTED_PROVIDER_ID,
  ROUTED_MODEL,
  ROUTED_BASE_URL,
  ROUTED_ENV_KEY,
  MANAGED_BLOCK_START,
  MANAGED_BLOCK_END,
  resolveCodexHome,
  resolveConfigPath,
  resolveStatePath,
  resolveBackupPath,
  stripManagedBlock,
  appendManagedBlock,
  applySoftReset,
  getStatus,
  setMode,
  hardReset,
};
