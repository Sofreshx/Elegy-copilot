#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import toml from 'toml';
import { fileURLToPath } from 'url';
import { getBestShell } from './shell-detect.mjs';
import { writeTextAtomically } from './install-surface-utils.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { migrateLegacyCodexConfig } = require('../copilot-ui/lib/codexConfig.js');

export const DEFAULT_PROFILE_NAME = 'instruction_engine_plan_review';
export const PROFILE_CONFIG_SUFFIX = '.config.toml';
export const DEFAULT_AGENT_CONFIG = Object.freeze({
  enabled: true,
  maxThreads: 6,
  defaultSubagentModel: 'gpt-5.6-luna',
  defaultSubagentReasoningEffort: 'high',
  maxDepth: 1,
  jobMaxRuntimeSeconds: 1800,
});

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    config: '',
    profileName: DEFAULT_PROFILE_NAME,
    shell: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value.startsWith('--config=')) {
      args.config = value.slice('--config='.length);
      continue;
    }
    if (value === '--config') {
      index += 1;
      if (index >= argv.length || String(argv[index]).startsWith('--')) {
        throw new Error('Missing required --config <path>');
      }
      args.config = argv[index] || '';
      continue;
    }
    if (value.startsWith('--profile-name=')) {
      args.profileName = value.slice('--profile-name='.length);
      continue;
    }
    if (value === '--profile-name') {
      index += 1;
      if (index >= argv.length || String(argv[index]).startsWith('--')) {
        throw new Error('Missing required profile name value');
      }
      args.profileName = argv[index] || '';
      continue;
    }
    if (value.startsWith('--shell=')) {
      args.shell = value.slice('--shell='.length);
      continue;
    }
    if (value === '--shell') {
      index += 1;
      if (index >= argv.length || String(argv[index]).startsWith('--')) {
        throw new Error('Missing required --shell <value>');
      }
      args.shell = argv[index] || '';
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --config <path>, --profile-name <name>, --shell <value>)`);
  }

  if (!args.config) {
    throw new Error('Missing required --config <path>');
  }
  if (!args.profileName) {
    throw new Error('Missing required profile name value');
  }
  return args;
}

function normalizeText(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function asBoundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function normalizeAgentConfig(options = {}) {
  return {
    enabled: options.enabled !== false,
    maxThreads: asBoundedInteger(options.maxThreads, DEFAULT_AGENT_CONFIG.maxThreads, 1, 8),
    defaultSubagentModel: String(options.defaultSubagentModel || DEFAULT_AGENT_CONFIG.defaultSubagentModel),
    defaultSubagentReasoningEffort: String(
      options.defaultSubagentReasoningEffort || DEFAULT_AGENT_CONFIG.defaultSubagentReasoningEffort,
    ),
    maxDepth: asBoundedInteger(options.maxDepth, DEFAULT_AGENT_CONFIG.maxDepth, 0, 2),
    jobMaxRuntimeSeconds: asBoundedInteger(
      options.jobMaxRuntimeSeconds,
      DEFAULT_AGENT_CONFIG.jobMaxRuntimeSeconds,
      60,
      86400,
    ),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTableHeaderLine(line) {
  return /^\s*\[\[?[^\]]+\]?\]\]\s*(?:#.*)?$/.test(String(line || '').trim())
    || /^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function isAgentsTableHeader(line) {
  return /^\s*\[agents\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

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

const LEGACY_ROOT_PROVIDERS = new Set([
  'instruction_engine_deepseek',
  'opencode_go_bridge',
  'opencode-go',
  'opencode',
  'opencode-chat',
]);

function stripMarkedBlocks(text) {
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

function stripKnownProviderTables(text) {
  const lines = normalizeText(text).split('\n');
  const output = [];
  let changed = false;
  for (let index = 0; index < lines.length;) {
    const match = String(lines[index] || '').trim().match(/^\[model_providers\.([^\]]+)\]\s*$/);
    if (!match || !LEGACY_PROVIDER_SIGNATURES.has(match[1])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const section = [];
    let cursor = index + 1;
    while (cursor < lines.length && !isTableHeaderLine(lines[cursor])) {
      section.push(String(lines[cursor] || '').trim());
      cursor += 1;
    }
    const signatures = LEGACY_PROVIDER_SIGNATURES.get(match[1]) || [];
    if (signatures.every((signature) => section.includes(signature))) {
      changed = true;
    } else {
      output.push(...lines.slice(index, cursor));
    }
    index = cursor;
  }
  return {
    text: output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    changed,
  };
}

function stripKnownProfileTable(text, profileName = DEFAULT_PROFILE_NAME) {
  const lines = normalizeText(text).split('\n');
  const header = `[profiles.${profileName}]`;
  const output = [];
  let changed = false;
  for (let index = 0; index < lines.length;) {
    if (String(lines[index] || '').trim() !== header) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    changed = true;
    index += 1;
    while (index < lines.length && !isTableHeaderLine(lines[index])) index += 1;
  }
  return {
    text: output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    changed,
  };
}

function stripKnownRootReferences(text, enabled) {
  if (!enabled) return { text, changed: false };
  const legacyModels = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);
  const lines = normalizeText(text).split('\n');
  let inTable = false;
  const filtered = lines.filter((line) => {
    if (isTableHeaderLine(line)) {
      inTable = true;
      return true;
    }
    if (inTable) return true;
    const match = String(line || '').trim().match(/^(model_provider|model|review_model|model_catalog_json)\s*=\s*"([^"]*)"\s*$/);
    if (!match) return true;
    if (match[1] === 'model_provider') return !LEGACY_ROOT_PROVIDERS.has(match[2]);
    if (match[1] === 'model_catalog_json') return !match[2].includes('models_catalog.deepseek.json');
    return !legacyModels.has(match[2]);
  });
  return {
    text: filtered.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    changed: filtered.length !== lines.length,
  };
}

export function stripKnownLegacyConfig(text, options = {}) {
  const marked = stripMarkedBlocks(text);
  const providers = stripKnownProviderTables(marked.text);
  const profiles = stripKnownProfileTable(providers.text, options.profileName || DEFAULT_PROFILE_NAME);
  const cleaned = marked.changed || providers.changed || profiles.changed;
  // Root references are known legacy surface identifiers themselves. Remove
  // them even when no matching provider table remains in the user's config.
  const roots = stripKnownRootReferences(profiles.text, true);
  return {
    text: roots.text,
    changed: cleaned || roots.changed,
  };
}

function validateToml(text, context = 'after Codex config patch') {
  const normalized = normalizeText(text).trim();
  if (!normalized) return;
  try {
    toml.parse(normalized);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Codex config TOML validation failed ${context}: ${detail}`);
  }
}

function upsertKeyLine(lines, key, line) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const index = lines.findIndex((candidate) => pattern.test(String(candidate || '')));
  if (index < 0) return [...lines, line];
  const next = [...lines];
  next[index] = line;
  return next;
}

function upsertAgentConfigLines(sectionLines, values) {
  let next = sectionLines.filter((line) => !/^\s*max_threads\s*=/.test(String(line || '')));
  next = upsertKeyLine(next, 'enabled', `enabled = ${values.enabled}`);
  next = upsertKeyLine(next, 'max_concurrent_threads_per_session', `max_concurrent_threads_per_session = ${values.maxThreads}`);
  next = upsertKeyLine(next, 'default_subagent_model', `default_subagent_model = "${values.defaultSubagentModel}"`);
  next = upsertKeyLine(next, 'default_subagent_reasoning_effort', `default_subagent_reasoning_effort = "${values.defaultSubagentReasoningEffort}"`);
  next = upsertKeyLine(next, 'max_depth', `max_depth = ${values.maxDepth}`);
  next = upsertKeyLine(next, 'job_max_runtime_seconds', `job_max_runtime_seconds = ${values.jobMaxRuntimeSeconds}`);
  return next;
}

export function patchAgentsConfig(originalText, options = {}) {
  const values = normalizeAgentConfig(options);
  const normalized = normalizeText(originalText).trimEnd();
  const lines = normalized ? normalized.split('\n') : [];
  const headerIndex = lines.findIndex((line) => isAgentsTableHeader(line));

  if (headerIndex < 0) {
    const section = [
      '[agents]',
      `enabled = ${values.enabled}`,
      `max_concurrent_threads_per_session = ${values.maxThreads}`,
      `default_subagent_model = "${values.defaultSubagentModel}"`,
      `default_subagent_reasoning_effort = "${values.defaultSubagentReasoningEffort}"`,
      `max_depth = ${values.maxDepth}`,
      `job_max_runtime_seconds = ${values.jobMaxRuntimeSeconds}`,
    ].join('\n');
    const patched = ensureTrailingNewline([normalized, section].filter((value) => value.trim()).join('\n\n'));
    validateToml(patched);
    return patched;
  }

  let nextHeaderIndex = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (isTableHeaderLine(lines[index])) {
      nextHeaderIndex = index;
      break;
    }
  }
  const patched = ensureTrailingNewline([
    ...lines.slice(0, headerIndex + 1),
    ...upsertAgentConfigLines(lines.slice(headerIndex + 1, nextHeaderIndex), values),
    ...lines.slice(nextHeaderIndex),
  ].join('\n').trimEnd());
  validateToml(patched);
  return patched;
}

export function resolveProfileConfigPath(configPath, profileName = DEFAULT_PROFILE_NAME) {
  return path.join(path.dirname(path.resolve(configPath)), `${profileName}${PROFILE_CONFIG_SUFFIX}`);
}

export function buildProfileConfig() {
  return ensureTrailingNewline([
    'personality = "pragmatic"',
    'model_reasoning_effort = "max"',
    'plan_mode_reasoning_effort = "xhigh"',
  ].join('\n'));
}

export function patchCodexConfig(originalText, options = {}) {
  const cleaned = stripKnownLegacyConfig(originalText, options).text;
  return options.manageAgents === false ? cleaned : patchAgentsConfig(cleaned, options);
}

export function patchConfigFile(configPath, options = {}) {
  const migration = migrateLegacyCodexConfig(path.dirname(configPath), { dryRun: options.dryRun });
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const patched = patchCodexConfig(existing, options);
  const changed = normalizeText(existing) !== normalizeText(patched) || migration.changed;
  if (!options.dryRun && normalizeText(existing) !== normalizeText(patched)) {
    writeTextAtomically(patched, configPath);
  }
  return { changed, content: patched, migration };
}

export function writeProfileConfigFile(configPath, options = {}) {
  const profilePath = resolveProfileConfigPath(configPath, options.profileName || DEFAULT_PROFILE_NAME);
  const existing = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';
  const patched = buildProfileConfig();
  const changed = normalizeText(existing) !== normalizeText(patched);
  if (!options.dryRun && changed) writeTextAtomically(patched, profilePath);
  return { changed, content: patched, path: profilePath };
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2));
      let shellValue = args.shell || null;
      if (!shellValue) {
        const bestShell = await getBestShell({ skipSlowProbes: true });
        if (bestShell) {
          shellValue = bestShell.path.includes('bash') ? 'bash' : bestShell.path.includes('pwsh') ? 'pwsh' : 'cmd';
        }
      }

      const result = patchConfigFile(args.config, { dryRun: args.dryRun, profileName: args.profileName });
      const profileResult = writeProfileConfigFile(args.config, { dryRun: args.dryRun, profileName: args.profileName });
      let finalContent = result.content;
      let shellChanged = false;
      if (shellValue && !finalContent.includes('[windows]')) {
        finalContent = ensureTrailingNewline(finalContent) + `[windows]\nshell = "${shellValue}"\n`;
        shellChanged = true;
      }

      if (args.dryRun) {
        process.stdout.write(finalContent);
      } else if (result.changed || shellChanged || profileResult.changed) {
        if (shellChanged) writeTextAtomically(finalContent, args.config);
        console.log(result.changed || shellChanged ? `[CONFIG] ${args.config}` : `[SKIP]   ${args.config} (up-to-date)`);
        console.log(profileResult.changed ? `[CONFIG] ${profileResult.path}` : `[SKIP]   ${profileResult.path} (up-to-date)`);
      } else {
        console.log(`[SKIP]   ${args.config} (up-to-date)`);
        console.log(`[SKIP]   ${profileResult.path} (up-to-date)`);
      }
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
  })();
}
