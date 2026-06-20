'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const toml = require('toml');

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');
const CONFIG_FILENAME = 'config.toml';
const STATE_FILENAME = '.elegy-codex-provider-state.json';
const BACKUP_FILENAME = '.elegy-codex-provider-backup.toml';
const DEEPSEEK_STATE_FILENAME = '.elegy-deepseek-state.json';
const DEEPSEEK_CATALOG_FILENAME = 'models_catalog.deepseek.json';
const MANAGED_DEEPSEEK_BLOCK_START = '# BEGIN elegy managed deepseek provider';
const MANAGED_DEEPSEEK_BLOCK_END = '# END elegy managed deepseek provider';
const IE_MANAGED_BLOCK_START = '# BEGIN elegy-copilot managed codex defaults';
const IE_MANAGED_BLOCK_END = '# END elegy-copilot managed codex defaults';
const DEEPSEEK_PROVIDER_ID = 'instruction_engine_deepseek';
const DEEPSEEK_PROVIDER_NAME = 'DeepSeek V4 via Moon Bridge';
const DEEPSEEK_MODEL = 'deepseek-v4-pro';
const DEEPSEEK_BASE_URL = 'http://127.0.0.1:38440/v1';

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

function resolveDeepseekStatePath(codexHome) {
  return path.join(resolveCodexHome(codexHome), DEEPSEEK_STATE_FILENAME);
}

function resolveDeepseekCatalogPath(codexHome) {
  return path.join(resolveCodexHome(codexHome), DEEPSEEK_CATALOG_FILENAME);
}

function readDeepseekState(codexHome) {
  const statePath = resolveDeepseekStatePath(codexHome);
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

function writeDeepseekState(codexHome, state) {
  const statePath = resolveDeepseekStatePath(codexHome);
  writeTextAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
  return statePath;
}

function removeDeepseekState(codexHome) {
  const statePath = resolveDeepseekStatePath(codexHome);
  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function hasTopLevelKey(text, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'm').test(text);
}

function buildDeepseekManagedBlock(codexHome) {
  return [
    MANAGED_DEEPSEEK_BLOCK_START,
    `[model_providers.${DEEPSEEK_PROVIDER_ID}]`,
    `name = "${DEEPSEEK_PROVIDER_NAME}"`,
    `base_url = "${DEEPSEEK_BASE_URL}"`,
    'wire_api = "responses"',
    MANAGED_DEEPSEEK_BLOCK_END,
  ].join('\n');
}

function buildDeepseekModelCatalog() {
  const REASONING_LEVELS = [
    { effort: 'low', description: 'Fast responses with lighter reasoning' },
    { effort: 'medium', description: 'Balanced speed and reasoning depth' },
    { effort: 'high', description: 'Greater reasoning depth for complex problems' },
    { effort: 'xhigh', description: 'Maximum reasoning depth for complex problems' },
  ];
  return {
    fetched_at: new Date().toISOString(),
    models: [
      {
        slug: 'deepseek-v4-pro',
        display_name: 'DeepSeek V4 Pro',
        description: 'DeepSeek V4 Pro reasoning model via Moon Bridge.',
        default_reasoning_level: 'high',
        supported_reasoning_levels: REASONING_LEVELS,
        visibility: 'list',
        context_window: 262144,
        max_context_window: 262144,
        input_modalities: ['text'],
        supports_parallel_tool_calls: true,
      },
      {
        slug: 'deepseek-v4-flash',
        display_name: 'DeepSeek V4 Flash',
        description: 'DeepSeek V4 Flash fast reasoning model via Moon Bridge.',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: REASONING_LEVELS,
        visibility: 'list',
        context_window: 262144,
        max_context_window: 262144,
        input_modalities: ['text'],
        supports_parallel_tool_calls: true,
      },
    ],
  };
}

function writeDeepseekCatalog(codexHome) {
  const catalogPath = resolveDeepseekCatalogPath(codexHome);
  writeTextAtomic(catalogPath, `${JSON.stringify(buildDeepseekModelCatalog(), null, 2)}\n`);
  return catalogPath;
}

function removeDeepseekCatalog(codexHome) {
  const catalogPath = resolveDeepseekCatalogPath(codexHome);
  try {
    fs.rmSync(catalogPath, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
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

function stripIeManagedRootKeys(preambleLines) {
  const ieManagedIdentifiers = [
    'opencode',
    'opencode-chat',
    'opencode-go',
    DEEPSEEK_PROVIDER_ID,
    DEEPSEEK_MODEL,
    'deepseek-v4-flash',
    'models_catalog.deepseek.json',
  ];
  return preambleLines.filter((line) => {
    const trimmed = String(line || '').trim();
    // Check if this is a root key line we care about
    const matching = trimmed.match(/^\s*(model_provider|model|review_model|model_catalog_json)\s*=\s*"([^"]*)"/);
    if (!matching) return true;
    const value = matching[2];
    for (const identifier of ieManagedIdentifiers) {
      if (value === identifier || value.includes(identifier)) {
        return false;
      }
    }
    return true;
  });
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

function stripDeepseekManagedBlock(text) {
  const normalized = normalizeNewlines(text);
  const pattern = new RegExp(
    `\\n?${escapeRegExp(MANAGED_DEEPSEEK_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_DEEPSEEK_BLOCK_END)}\\n?`,
    'g',
  );
  return normalized.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function hasDeepseekManagedBlock(text) {
  return text.includes(MANAGED_DEEPSEEK_BLOCK_START);
}

function hasInstructionEngineManagedBlock(text) {
  return text.includes(IE_MANAGED_BLOCK_START);
}

function stripInstructionEngineManagedBlock(text) {
  const normalized = normalizeNewlines(text);
  const pattern = new RegExp(
    `\\n?${escapeRegExp(IE_MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(IE_MANAGED_BLOCK_END)}\\n?`,
    'g',
  );
  return normalized.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function appendDeepseekManagedBlock(text, codexHome) {
  const stripped = stripDeepseekManagedBlock(text);
  if (hasProviderTable(stripped, DEEPSEEK_PROVIDER_ID)) {
    const error = new Error(`Existing Codex config already defines [model_providers.${DEEPSEEK_PROVIDER_ID}].`);
    error.statusCode = 409;
    throw error;
  }

  const { preambleLines, bodyText } = splitRootPreamble(stripped);
  const providerResult = upsertRootKeyLine(
    preambleLines,
    'model_provider',
    `model_provider = "${DEEPSEEK_PROVIDER_ID}"`,
  );
  const modelResult = upsertRootKeyLine(
    providerResult.lines,
    'model',
    `model = "${DEEPSEEK_MODEL}"`,
  );
  const catalogResult = upsertRootKeyLine(
    modelResult.lines,
    'model_catalog_json',
    `model_catalog_json = "${resolveDeepseekCatalogPath(codexHome).replace(/\\/g, '\\\\')}"`,
  );

  return {
    nextText: composeConfigText(catalogResult.lines, bodyText, buildDeepseekManagedBlock(codexHome)),
    previousModelLine: modelResult.previousLine,
    previousModelProviderLine: providerResult.previousLine,
    previousModelCatalogJsonLine: catalogResult.previousLine,
  };
}

function applyDeepseekSoftReset(text, state = {}) {
  const stripped = stripDeepseekManagedBlock(text);
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
  const restoredCatalogLines = restoreRootKeyLine(
    restoredModelLines,
    'model_catalog_json',
    typeof state.previousModelCatalogJsonLine === 'string' ? state.previousModelCatalogJsonLine : null,
  );
  return composeConfigText(restoredCatalogLines, bodyText, '');
}

function saveDeepseekSettings(codexHome, settings) {
  const prev = readDeepseekState(codexHome);
  const next = { ...prev };

  if (typeof settings.bridgePath === 'string') {
    next.bridgePath = settings.bridgePath;
    const pathExists = fs.existsSync(settings.bridgePath);
    if (pathExists) {
      const stat = fs.statSync(settings.bridgePath);
      next.bridgeBinaryAvailable = stat.isFile();
      next.bridgeCheckoutAvailable = stat.isDirectory();
    } else {
      next.bridgeBinaryAvailable = false;
      next.bridgeCheckoutAvailable = false;
    }
  }
  if (typeof settings.bridgeConfigPath === 'string') {
    next.bridgeConfigPath = settings.bridgeConfigPath;
  }
  if (typeof settings.bridgeUrl === 'string') {
    next.bridgeUrl = settings.bridgeUrl;
  }
  if (typeof settings.keyConfigured === 'boolean') {
    next.keyConfigured = settings.keyConfigured;
  }
  if (typeof settings.bridgeReachable === 'boolean') {
    next.bridgeReachable = settings.bridgeReachable;
  }
  if (typeof settings.modelsVisible === 'boolean') {
    next.modelsVisible = settings.modelsVisible;
  }

  writeDeepseekState(codexHome, next);
  return getDeepseekStatus(codexHome);
}

function getDeepseekStatus(codexHome) {
  const dsState = readDeepseekState(codexHome);
  return {
    bridgePath: typeof dsState.bridgePath === 'string' ? dsState.bridgePath : null,
    bridgeConfigPath: typeof dsState.bridgeConfigPath === 'string' ? dsState.bridgeConfigPath : null,
    bridgeUrl: typeof dsState.bridgeUrl === 'string' ? dsState.bridgeUrl : DEEPSEEK_BASE_URL,
    keyConfigured: dsState.keyConfigured === true,
    bridgeReachable: dsState.bridgeReachable === true,
    modelsVisible: dsState.modelsVisible === true,
    bridgeBinaryAvailable: dsState.bridgeBinaryAvailable === true,
    bridgeCheckoutAvailable: dsState.bridgeCheckoutAvailable === true,
    envKeyConfigured: typeof process !== 'undefined' && process.env && !!process.env.MOON_BRIDGE_DEEPSEEK_TOKEN,
    bootstrap: dsState.bootstrap && typeof dsState.bootstrap === 'object' ? dsState.bootstrap : null,
  };
}

function getBootstrapState(codexHome) {
  const dsState = readDeepseekState(codexHome);
  if (dsState.bootstrap && typeof dsState.bootstrap === 'object') {
    return dsState.bootstrap;
  }
  return null;
}

function saveBootstrapState(codexHome, bootstrapState) {
  const prev = readDeepseekState(codexHome);
  const next = { ...prev, bootstrap: { ...(prev.bootstrap || {}), ...bootstrapState } };

  // When the managed bootstrap has a built binary, forward it to bridgePath
  // so that bridge start/check-status and the activate-prereqs gate recognize
  // the managed install path without requiring the user to set it manually.
  if (next.bootstrap && next.bootstrap.built === true && typeof next.bootstrap.binaryPath === 'string') {
    next.bridgePath = next.bootstrap.binaryPath;
    next.bridgeBinaryAvailable = true;
    next.bridgeCheckoutAvailable = false;
  }

  writeDeepseekState(codexHome, next);
  return getBootstrapState(codexHome);
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
  let activeMode = 'native';
  if (configText.includes(MANAGED_DEEPSEEK_BLOCK_START)) {
    activeMode = 'deepseek-bridge';
  }
  const hasLegacyBlock = configText.includes('# BEGIN elegy managed codex provider')
    || configText.includes(IE_MANAGED_BLOCK_START);

  return {
    codexHome: resolvedHome,
    configPath,
    statePath,
    backupPath,
    exists: fs.existsSync(configPath),
    activeMode,
    providerId: activeMode === 'deepseek-bridge' ? DEEPSEEK_PROVIDER_ID : 'openai',
    hasManagedBlock: configText.includes(MANAGED_DEEPSEEK_BLOCK_START),
    hasLegacyBlock,
    hasBackup: hasBackup(resolvedHome),
    lastAppliedAt: typeof state.lastAppliedAt === 'string' ? state.lastAppliedAt : null,
    lastResetAt: typeof state.lastResetAt === 'string' ? state.lastResetAt : null,
    backupCreatedAt: typeof state.backupCreatedAt === 'string' ? state.backupCreatedAt : null,
    gateway: activeMode === 'deepseek-bridge'
      ? {
        providerId: DEEPSEEK_PROVIDER_ID,
        model: DEEPSEEK_MODEL,
        baseUrl: DEEPSEEK_BASE_URL,
      }
      : {
        providerId: 'openai',
        model: 'gpt-5.4',
        baseUrl: '',
      },
    deepseek: getDeepseekStatus(resolvedHome),
  };
}

function setMode(codexHome, mode) {
  const resolvedHome = resolveCodexHome(codexHome);
  const normalizedMode = String(mode || '').trim().toLowerCase();
  if (normalizedMode !== 'native' && normalizedMode !== 'deepseek-bridge') {
    const error = new Error('mode must be "native" or "deepseek-bridge"');
    error.statusCode = 400;
    throw error;
  }

  const configPath = resolveConfigPath(resolvedHome);
  let existing = readTextIfExists(configPath);
  const previousState = readState(resolvedHome);

  // Always strip legacy blocks first
  if (hasInstructionEngineManagedBlock(existing)) {
    existing = stripInstructionEngineManagedBlock(existing);
  }
  // Also strip legacy elegy managed codex provider block
  if (existing.includes('# BEGIN elegy managed codex provider')) {
    existing = existing.replace(
      new RegExp(`\\n?# BEGIN elegy managed codex provider[\\s\\S]*?# END elegy managed codex provider\\n?`, 'g'),
      '\n'
    ).replace(/\n{3,}/g, '\n\n').trimEnd();
  }

  const isDeepseekActive = hasDeepseekManagedBlock(existing);

  if (normalizedMode === 'deepseek-bridge' && isDeepseekActive) {
    return {
      ...getStatus(resolvedHome),
      changed: false,
      action: 'activate',
    };
  }

  let nextTextResult;
  let action;

  if (normalizedMode === 'deepseek-bridge') {
    nextTextResult = appendDeepseekManagedBlock(existing, resolvedHome);
    action = 'activate';
  } else {
    if (isDeepseekActive) {
      nextTextResult = { nextText: applyDeepseekSoftReset(existing, previousState) };
      action = 'soft-reset';
    } else {
      // For native mode when no deepseek block is active, just strip any legacy blocks
      nextTextResult = { nextText: existing, previousModelLine: null, previousModelProviderLine: null, previousModelCatalogJsonLine: null };
      action = 'soft-reset';
    }
  }

  // When switching to native, strip any root-level model_provider/model keys
  // that reference elegy-copilot-managed provider IDs. These are orphaned
  // when the managed provider table block is stripped, leaving Codex unable to
  // resolve the provider (e.g. "Model provider `opencode-go` not found").
  if (normalizedMode === 'native' && nextTextResult.nextText) {
    const { preambleLines, bodyText } = splitRootPreamble(nextTextResult.nextText);
    const cleanedPreamble = stripIeManagedRootKeys(preambleLines);
    if (cleanedPreamble !== preambleLines) {
      nextTextResult.nextText = composeConfigText(cleanedPreamble, bodyText, '');
    }
  }

  // For the native case, need to compare against original pre-strip text
  const originalText = readTextIfExists(configPath);
  const changed = normalizeNewlines(originalText) !== normalizeNewlines(nextTextResult.nextText);

  if (changed && nextTextResult.nextText) {
    const contextLabel = normalizedMode === 'deepseek-bridge'
      ? 'after enabling DeepSeek V4'
      : 'after restoring native mode';
    validateConfigToml(nextTextResult.nextText, contextLabel);
  }

  if (normalizedMode === 'deepseek-bridge') {
    const backupPath = writeBackupIfNeeded(resolvedHome, existing);
    writeDeepseekCatalog(resolvedHome);
    writeState(resolvedHome, {
      ...previousState,
      backupPath,
      backupCreatedAt: previousState.backupCreatedAt || new Date().toISOString(),
      originalConfigExisted: fs.existsSync(configPath),
      previousModelLine: nextTextResult.previousModelLine,
      previousModelProviderLine: nextTextResult.previousModelProviderLine,
      previousModelCatalogJsonLine: nextTextResult.previousModelCatalogJsonLine,
      lastAppliedAt: new Date().toISOString(),
      activeMode: normalizedMode,
    });
  } else {
    removeDeepseekCatalog(resolvedHome);
    writeState(resolvedHome, {
      ...previousState,
      activeMode: normalizedMode,
      lastResetAt: new Date().toISOString(),
    });
  }

  if (changed) {
    if (!nextTextResult.nextText && previousState.originalConfigExisted === false) {
      try {
        fs.rmSync(configPath, { force: true });
      } catch {
        // Ignore deletion failures for soft reset.
      }
    } else {
      writeTextAtomic(configPath, nextTextResult.nextText);
    }
  }

  return {
    ...getStatus(resolvedHome),
    changed,
    action,
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
  let existing = readTextIfExists(configPath);
  // Strip legacy blocks from the backup text too
  let cleanBackup = normalizeNewlines(backupText);
  if (hasInstructionEngineManagedBlock(cleanBackup)) {
    cleanBackup = stripInstructionEngineManagedBlock(cleanBackup);
  }
  const nextText = previousState.originalConfigExisted === false ? '' : cleanBackup;
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
  removeDeepseekState(resolvedHome);
  removeDeepseekCatalog(resolvedHome);

  return {
    ...getStatus(resolvedHome),
    changed,
    action: 'hard-reset',
  };
}

function factoryReset(codexHome) {
  const resolvedHome = resolveCodexHome(codexHome);
  const configPath = resolveConfigPath(resolvedHome);
  const configText = readTextIfExists(configPath);

  let backupCreatedAt = null;

  // Save a timestamped backup if config exists and has content
  if (configText && configText.trim()) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = `.elegy-factory-reset-${timestamp}.toml`;
    const factoryResetBackupPath = path.join(resolvedHome, backupFilename);
    writeTextAtomic(factoryResetBackupPath, configText);
    backupCreatedAt = new Date().toISOString();
  }

  // Strip all managed blocks from the text
  let cleaned = configText;
  if (hasInstructionEngineManagedBlock(cleaned)) {
    cleaned = stripInstructionEngineManagedBlock(cleaned);
  }
  // Also strip legacy elegy managed codex provider block
  if (cleaned.includes('# BEGIN elegy managed codex provider')) {
    cleaned = cleaned.replace(
      new RegExp(`\\n?# BEGIN elegy managed codex provider[\\s\\S]*?# END elegy managed codex provider\\n?`, 'g'),
      '\n',
    ).replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  if (hasDeepseekManagedBlock(cleaned)) {
    cleaned = stripDeepseekManagedBlock(cleaned);
  }

  // Delete the config.toml file entirely
  try {
    fs.rmSync(configPath, { force: true });
  } catch {
    // Ignore deletion failures.
  }

  // Delete state files and artifacts
  removeState(resolvedHome);
  removeDeepseekState(resolvedHome);
  const backupPath = resolveBackupPath(resolvedHome);
  try {
    fs.rmSync(backupPath, { force: true });
  } catch {
    // Ignore backup deletion failures.
  }
  removeDeepseekCatalog(resolvedHome);

  return {
    ...getStatus(resolvedHome),
    action: 'factory-reset',
    backupCreatedAt,
  };
}

function getPlanningSkillStatus(codexHome) {
  const resolvedHome = resolveCodexHome(codexHome);
  const skillDir = path.join(resolvedHome, 'skills', 'elegy-planning');
  const skillFile = path.join(skillDir, 'SKILL.md');
  return {
    codexHome: resolvedHome,
    skillDir,
    skillFile,
    installed: fs.existsSync(skillFile),
  };
}

module.exports = {
  DEEPSEEK_PROVIDER_ID,
  DEEPSEEK_MODEL,
  DEEPSEEK_BASE_URL,
  MANAGED_DEEPSEEK_BLOCK_START,
  MANAGED_DEEPSEEK_BLOCK_END,
  resolveCodexHome,
  resolveConfigPath,
  resolveStatePath,
  resolveBackupPath,
  resolveDeepseekStatePath,
  resolveDeepseekCatalogPath,
  stripDeepseekManagedBlock,
  stripIeManagedRootKeys,
  appendDeepseekManagedBlock,
  applyDeepseekSoftReset,
  getDeepseekStatus,
  saveDeepseekSettings,
  getBootstrapState,
  saveBootstrapState,
  getPlanningSkillStatus,
  getStatus,
  setMode,
  hardReset,
  factoryReset,
};
