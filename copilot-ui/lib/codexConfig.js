'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');
const CONFIG_FILENAME = 'config.toml';
const LEGACY_STATE_FILENAME = '.elegy-deepseek-state.json';
const LEGACY_CATALOG_FILENAME = 'models_catalog.deepseek.json';
const LEGACY_MARKERS = [
  ['# BEGIN elegy managed deepseek provider', '# END elegy managed deepseek provider'],
  ['# BEGIN elegy managed codex provider', '# END elegy managed codex provider'],
  ['# BEGIN elegy-copilot managed codex defaults', '# END elegy-copilot managed codex defaults'],
  ['# BEGIN elegy managed native Go provider', '# END elegy managed native Go provider'],
];
const LEGACY_PROVIDER_SIGNATURES = new Map([
  ['instruction_engine_deepseek', ['base_url = "http://127.0.0.1:38440/v1"']],
  ['opencode_go_bridge', ['base_url = "http://127.0.0.1:38441/v1"']],
  ['opencode-go', ['base_url = "https://opencode.ai/zen/go/v1"', 'env_key = "OPENCODE_API_KEY"']],
  ['opencode', ['base_url = "https://opencode.ai/zen/v1"', 'env_key = "OPENCODE_API_KEY"']],
  ['opencode-chat', ['base_url = "https://opencode.ai/zen/v1"', 'env_key = "OPENCODE_API_KEY"']],
]);
const LEGACY_ROOT_REFERENCES = new Set([
  'instruction_engine_deepseek',
  'opencode-go',
  'opencode',
  'opencode-chat',
  'opencode_go_bridge',
]);

function resolveCodexHome(codexHome) {
  return path.resolve(codexHome || DEFAULT_CODEX_HOME);
}

function resolveConfigPath(codexHome) {
  return path.join(resolveCodexHome(codexHome), CONFIG_FILENAME);
}

function readTextIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch {
    return '';
  }
}

function writeTextAtomic(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, text, 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkedLegacyBlocks(text) {
  let next = normalizeText(text);
  let changed = false;
  for (const [start, end] of LEGACY_MARKERS) {
    const pattern = new RegExp(`\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'g');
    const stripped = next.replace(pattern, '\n');
    changed ||= stripped !== next;
    next = stripped;
  }
  return { text: next.replace(/\n{3,}/g, '\n\n').trimEnd(), changed };
}

function isTableHeader(line) {
  const normalized = String(line || '').trim();
  return /^\s*\[\[[^\]]+\]\]\s*(?:#.*)?$/.test(normalized)
    || /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(normalized);
}

function stripLegacyProviderTables(text) {
  const lines = normalizeText(text).split('\n');
  const output = [];
  let removed = false;
  for (let index = 0; index < lines.length;) {
    const match = String(lines[index] || '').trim().match(/^\[model_providers\.([^\]]+)\]\s*$/);
    if (!match || !LEGACY_PROVIDER_SIGNATURES.has(match[1])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const providerId = match[1];
    const section = [];
    let cursor = index + 1;
    while (cursor < lines.length && !isTableHeader(lines[cursor])) {
      section.push(String(lines[cursor] || '').trim());
      cursor += 1;
    }
    const signatures = LEGACY_PROVIDER_SIGNATURES.get(providerId) || [];
    const matchesSignature = signatures.every((signature) => section.includes(signature));
    if (!matchesSignature) {
      output.push(...lines.slice(index, cursor));
    } else {
      removed = true;
    }
    index = cursor;
  }
  return {
    text: output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    changed: removed,
  };
}

function stripLegacyRootReferences(text, enabled) {
  if (!enabled) return { text, changed: false };
  const lines = normalizeText(text).split('\n');
  let inTable = false;
  const next = lines.filter((line) => {
    if (isTableHeader(line)) {
      inTable = true;
      return true;
    }
    if (inTable) return true;
    const match = String(line || '').trim().match(/^(model_provider|model|review_model|model_catalog_json)\s*=\s*"([^"]*)"\s*$/);
    if (!match) return true;
    const [, key, value] = match;
    if (key === 'model_provider') return !LEGACY_ROOT_REFERENCES.has(value);
    if (key === 'model_catalog_json') return !value.includes('models_catalog.deepseek.json');
    return !['deepseek-v4-pro', 'deepseek-v4-flash'].includes(value);
  });
  return { text: next.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(), changed: next.length !== lines.length };
}

function listLegacyBackups(codexHome) {
  const home = resolveCodexHome(codexHome);
  try {
    return fs.readdirSync(home)
      .filter((name) => name.startsWith('.elegy-codex-legacy-backup-') && name.endsWith('.toml'))
      .sort()
      .map((name) => path.join(home, name));
  } catch {
    return [];
  }
}

/**
 * Remove only legacy Elegy-owned provider markers/signatures. A timestamped
 * copy is written before a change; unrelated Codex tables and keys remain.
 */
function migrateLegacyCodexConfig(codexHome, options = {}) {
  const resolvedHome = resolveCodexHome(codexHome);
  const configPath = resolveConfigPath(resolvedHome);
  const original = readTextIfExists(configPath);
  const marked = stripMarkedLegacyBlocks(original);
  const providers = stripLegacyProviderTables(marked.text);
  // Root references are part of the known legacy provider surface too. Strip
  // them even when a config only contains the root key and no provider table;
  // unrelated provider IDs, models, and tables are left untouched.
  const roots = stripLegacyRootReferences(providers.text, true);
  const migratedContent = roots.text ? ensureTrailingNewline(roots.text) : '';
  const configChanged = normalizeText(original) !== normalizeText(migratedContent);
  const legacyArtifactPaths = [LEGACY_STATE_FILENAME, LEGACY_CATALOG_FILENAME]
    .map((artifactName) => path.join(resolvedHome, artifactName))
    .filter((artifactPath) => fs.existsSync(artifactPath));
  const changed = configChanged || legacyArtifactPaths.length > 0;
  const backupPath = configChanged && original.trim()
    ? path.join(resolvedHome, `.elegy-codex-legacy-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.toml`)
    : null;
  const removedArtifacts = [];

  if (!options.dryRun && configChanged) {
    writeTextAtomic(backupPath, ensureTrailingNewline(normalizeText(original)));
    writeTextAtomic(configPath, migratedContent);
  }

  for (const artifactPath of legacyArtifactPaths) {
    if (!fs.existsSync(artifactPath)) continue;
    removedArtifacts.push(artifactPath);
    if (!options.dryRun) {
      try { fs.rmSync(artifactPath, { force: true }); } catch { /* best effort */ }
    }
  }

  return {
    changed,
    dryRun: options.dryRun === true,
    configPath,
    backupPath,
    removedArtifacts,
    content: roots.text ? ensureTrailingNewline(roots.text) : '',
  };
}

function getStatus(codexHome) {
  const resolvedHome = resolveCodexHome(codexHome);
  const configPath = resolveConfigPath(resolvedHome);
  const configText = readTextIfExists(configPath);
  const marked = stripMarkedLegacyBlocks(configText).changed;
  const providers = stripLegacyProviderTables(configText).changed;
  const legacy = marked || providers
    || /model_provider\s*=\s*"(?:instruction_engine_deepseek|opencode(?:-chat|-go)?|opencode_go_bridge)"/.test(configText)
    || configText.includes('models_catalog.deepseek.json');
  const backups = listLegacyBackups(resolvedHome);
  return {
    codexHome: resolvedHome,
    configPath,
    backupPath: backups.at(-1) || null,
    exists: fs.existsSync(configPath),
    activeMode: 'native',
    providerId: 'openai',
    hasLegacyBlock: legacy,
    hasBackup: backups.length > 0,
    legacyMigration: {
      required: legacy,
      action: 'Run the Codex installer to remove known Elegy legacy provider blocks.',
    },
  };
}

module.exports = {
  resolveCodexHome,
  resolveConfigPath,
  getStatus,
  migrateLegacyCodexConfig,
};
