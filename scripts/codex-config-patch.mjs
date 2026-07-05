#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import toml from 'toml';
import { fileURLToPath } from 'url';
import { getBestShell } from './shell-detect.mjs';
import { writeTextAtomically } from './install-surface-utils.mjs';

export const DEFAULT_REVIEW_MODEL = 'deepseek-v4-pro';
export const DEFAULT_PROFILE_NAME = 'instruction_engine_plan_review';
export const DEFAULT_PROVIDER_ID = 'opencode-go'; // default managed profile provider
export const DEFAULT_MODEL = 'mimo-v2-pro';
export const PROFILE_CONFIG_SUFFIX = '.config.toml';
export const DEFAULT_AGENT_CONFIG = {
  maxThreads: 3,
  maxDepth: 1,
  jobMaxRuntimeSeconds: 1800,
};

export const EXTERNAL_PROVIDERS = [
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    envKey: 'OPENCODE_API_KEY',
  },
  {
    id: 'opencode-chat',
    name: 'OpenCode Zen Chat',
    baseUrl: 'https://opencode.ai/zen/v1',
    envKey: 'OPENCODE_API_KEY',
    wireApi: 'responses',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    envKey: 'OPENCODE_API_KEY',
    wireApi: 'responses',
  },
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    config: '',
    reviewModel: DEFAULT_REVIEW_MODEL,
    profileName: DEFAULT_PROFILE_NAME,
    enableExternalProviders: true,
    providerId: '',
    modelId: '',
    shell: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value.startsWith('--config=')) {
      args.config = value.slice('--config='.length);
      continue;
    }
    if (value === '--config') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required --config <path>');
      }
      args.config = argv[i] || '';
      continue;
    }
    if (value.startsWith('--review-model=')) {
      args.reviewModel = value.slice('--review-model='.length);
      continue;
    }
    if (value === '--review-model') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required review model value');
      }
      args.reviewModel = argv[i] || '';
      continue;
    }
    if (value.startsWith('--profile-name=')) {
      args.profileName = value.slice('--profile-name='.length);
      continue;
    }
    if (value === '--profile-name') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required profile name value');
      }
      args.profileName = argv[i] || '';
      continue;
    }
    if (value === '--enable-external-providers') {
      args.enableExternalProviders = true;
      continue;
    }
    if (value === '--disable-external-providers') {
      args.enableExternalProviders = false;
      continue;
    }
    if (value.startsWith('--provider-id=')) {
      args.providerId = value.slice('--provider-id='.length);
      continue;
    }
    if (value === '--provider-id') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required --provider-id <id>');
      }
      args.providerId = argv[i] || '';
      continue;
    }
    if (value.startsWith('--model-id=')) {
      args.modelId = value.slice('--model-id='.length);
      continue;
    }
    if (value === '--model-id') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required --model-id <id>');
      }
      args.modelId = argv[i] || '';
      continue;
    }
    if (value.startsWith('--shell=')) {
      args.shell = value.slice('--shell='.length);
      continue;
    }
    if (value === '--shell') {
      i += 1;
      if (i >= argv.length || String(argv[i]).startsWith('--')) {
        throw new Error('Missing required --shell <value>');
      }
      args.shell = argv[i] || '';
      continue;
    }
    throw new Error(`Unknown arg: ${value}`);
  }

  if (!args.config) {
    throw new Error('Missing required --config <path>');
  }

  if (!args.reviewModel) {
    throw new Error('Missing required review model value');
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
    maxThreads: asBoundedInteger(options.maxThreads, DEFAULT_AGENT_CONFIG.maxThreads, 1, 8),
    maxDepth: asBoundedInteger(options.maxDepth, DEFAULT_AGENT_CONFIG.maxDepth, 0, 2),
    jobMaxRuntimeSeconds: asBoundedInteger(
      options.jobMaxRuntimeSeconds,
      DEFAULT_AGENT_CONFIG.jobMaxRuntimeSeconds,
      60,
      86400,
    ),
  };
}

export function stripManagedBlock(text) {
  const normalized = normalizeText(text);
  return normalized
    .replace(/\n?# BEGIN elegy-copilot managed codex defaults[\s\S]*?# END elegy-copilot managed codex defaults\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTableHeaderLine(line) {
  return /^\s*\[\[?[^\]]+\]?\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function isAgentsTableHeader(line) {
  return /^\s*\[agents\]\s*(?:#.*)?$/.test(String(line || '').trim());
}

function splitRootPreamble(text) {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const tableHeaderIndex = lines.findIndex((line) => isTableHeaderLine(line));
  if (tableHeaderIndex === -1) {
    return { preambleLines: lines, bodyText: '' };
  }
  return {
    preambleLines: lines.slice(0, tableHeaderIndex),
    bodyText: lines.slice(tableHeaderIndex).join('\n').trim(),
  };
}

function hasTopLevelKey(text, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'm').test(text);
}

function hasProviderTable(text, providerId) {
  return new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(providerId)}\\]\\s*$`, 'm').test(text);
}

function stripTable(text, tableHeaderPattern) {
  const normalized = normalizeText(text);
  const pattern = new RegExp(
    `(?:^|\\n)\\s*\\[${tableHeaderPattern}\\]\\s*\\n[\\s\\S]*?(?=\\n\\s*\\[[^\\]]+\\]\\s*\\n|$)`,
    'g',
  );
  return normalized.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function stripLegacyProfileTable(text, profileName) {
  return stripTable(text, `profiles\\.${escapeRegExp(profileName)}`);
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

function buildProviderTable(provider) {
  const lines = [];
  lines.push(`[model_providers.${provider.id}]`);
  lines.push(`name = "${provider.name}"`);
  lines.push(`base_url = "${provider.baseUrl}"`);
  lines.push(`env_key = "${provider.envKey}"`);
  if (provider.wireApi) {
    lines.push(`wire_api = "${provider.wireApi}"`);
  }
  return lines.join('\n');
}

function buildRootKeyLines({ needsModel, needsProvider, needsReviewModel, reviewModel, modelId, providerId }) {
  const lines = [];
  if (needsModel) {
    lines.push(`model = "${modelId || DEFAULT_MODEL}"`);
  }
  if (needsProvider && providerId) {
    lines.push(`model_provider = "${providerId}"`);
  }
  if (needsReviewModel) {
    lines.push(`review_model = "${reviewModel}"`);
  }
  return lines;
}

function buildProfileConfig(options = {}) {
  const enableExternalProviders = options.enableExternalProviders !== false;
  const providerId = options.providerId || (enableExternalProviders ? DEFAULT_PROVIDER_ID : '');
  const modelId = options.modelId || (providerId ? DEFAULT_MODEL : '');
  const lines = [];
  if (providerId) {
    lines.push(`model_provider = "${providerId}"`);
  }
  if (modelId) {
    lines.push(`model = "${modelId}"`);
  }
  lines.push(
    'personality = "pragmatic"',
    'model_reasoning_effort = "max"',
    'plan_mode_reasoning_effort = "xhigh"',
  );
  return ensureTrailingNewline(lines.join('\n'));
}

function buildMissingProviderTables({ enableExternalProviders, existingProviders }) {
  if (!enableExternalProviders) {
    return [];
  }
  return EXTERNAL_PROVIDERS
    .filter((provider) => !existingProviders.has(provider.id))
    .map((provider) => buildProviderTable(provider));
}

function upsertKeyLine(lines, key, line) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`);
  const index = lines.findIndex((candidate) => pattern.test(String(candidate || '')));
  if (index >= 0) {
    const next = [...lines];
    next[index] = line;
    return next;
  }
  return [...lines, line];
}

function upsertAgentConfigLines(sectionLines, values) {
  let nextLines = [...sectionLines];
  nextLines = upsertKeyLine(nextLines, 'max_threads', `max_threads = ${values.maxThreads}`);
  nextLines = upsertKeyLine(nextLines, 'max_depth', `max_depth = ${values.maxDepth}`);
  nextLines = upsertKeyLine(nextLines, 'job_max_runtime_seconds', `job_max_runtime_seconds = ${values.jobMaxRuntimeSeconds}`);
  return nextLines;
}

export function patchAgentsConfig(originalText, options = {}) {
  const values = normalizeAgentConfig(options);
  const normalized = normalizeText(originalText).trimEnd();
  const lines = normalized ? normalized.split('\n') : [];
  const headerIndex = lines.findIndex((line) => isAgentsTableHeader(line));

  if (headerIndex === -1) {
    const agentSection = [
      '[agents]',
      `max_threads = ${values.maxThreads}`,
      `max_depth = ${values.maxDepth}`,
      `job_max_runtime_seconds = ${values.jobMaxRuntimeSeconds}`,
    ].join('\n');
    const patched = ensureTrailingNewline([normalized, agentSection].filter((section) => section.trim()).join('\n\n'));
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

  const before = lines.slice(0, headerIndex + 1);
  const section = lines.slice(headerIndex + 1, nextHeaderIndex);
  const after = lines.slice(nextHeaderIndex);
  const patched = ensureTrailingNewline([
    ...before,
    ...upsertAgentConfigLines(section, values),
    ...after,
  ].join('\n').trimEnd());
  validateToml(patched);
  return patched;
}

export function resolveProfileConfigPath(configPath, profileName = DEFAULT_PROFILE_NAME) {
  const resolvedConfigPath = path.resolve(configPath);
  return path.join(path.dirname(resolvedConfigPath), `${profileName}${PROFILE_CONFIG_SUFFIX}`);
}

export function patchCodexConfig(originalText, options = {}) {
  const reviewModel = options.reviewModel || DEFAULT_REVIEW_MODEL;
  const profileName = options.profileName || DEFAULT_PROFILE_NAME;
  const enableExternalProviders = options.enableExternalProviders !== false;
  const providerId = options.providerId;
  const modelId = options.modelId;
  const stripped = stripLegacyProfileTable(stripManagedBlock(originalText), profileName);
  // Only check the preamble (before first table header) for root keys.
  // Keys inside [profiles.*] or [model_providers.*] sections are NOT root-level defaults.
  const rootPreambleText = splitRootPreamble(stripped).preambleLines.join('\n');
  const needsModel = !hasTopLevelKey(rootPreambleText, 'model');
  const needsProvider = !!providerId && !hasTopLevelKey(rootPreambleText, 'model_provider');
  const needsReviewModel = !hasTopLevelKey(rootPreambleText, 'review_model');

  const existingProviders = new Set();
  if (enableExternalProviders) {
    for (const provider of EXTERNAL_PROVIDERS) {
      if (hasProviderTable(stripped, provider.id)) {
        existingProviders.add(provider.id);
      }
    }
  }

  const missingProviderTables = buildMissingProviderTables({
    enableExternalProviders,
    existingProviders,
  });
  const needsProviders = missingProviderTables.length > 0;

  if (!needsModel && !needsProvider && !needsReviewModel && !needsProviders && stripped === normalizeText(originalText).trimEnd()) {
    const stable = ensureTrailingNewline(stripped || '');
    return options.manageAgents === false ? stable : patchAgentsConfig(stable, options);
  }

  const rootKeyLines = buildRootKeyLines({ needsModel, needsProvider, needsReviewModel, reviewModel, modelId, providerId });
  const { preambleLines, bodyText } = splitRootPreamble(stripped);
  const rootKeysNeeded = rootKeyLines.length > 0;
  let nextPreambleLines = [...preambleLines];

  if (rootKeysNeeded) {
    // Remove any existing root key lines for the keys we're adding to avoid duplication
    const rootKeysToCheck = [];
    if (needsModel) rootKeysToCheck.push('model');
    if (needsProvider) rootKeysToCheck.push('model_provider');
    if (needsReviewModel) rootKeysToCheck.push('review_model');

    nextPreambleLines = nextPreambleLines.filter((line) => {
      for (const key of rootKeysToCheck) {
        if (new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(String(line || ''))) {
          return false;
        }
      }
      return true;
    });

    nextPreambleLines = nextPreambleLines.concat(rootKeyLines);
  }

  const preambleText = nextPreambleLines.join('\n').trimEnd();
  const sections = [];
  if (preambleText) sections.push(preambleText);
  if (bodyText) sections.push(bodyText);
  sections.push(...missingProviderTables);

  if (sections.length === 0) {
    return '';
  }

  const patched = ensureTrailingNewline(sections.join('\n\n'));
  return options.manageAgents === false ? patched : patchAgentsConfig(patched, options);
}

export function patchConfigFile(configPath, options = {}) {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const patched = patchCodexConfig(existing, options);
  const changed = normalizeText(existing) !== normalizeText(patched);

  if (!options.dryRun && changed) {
    writeTextAtomically(patched, configPath);
  }

  return { changed, content: patched };
}

export function writeProfileConfigFile(configPath, options = {}) {
  const profileName = options.profileName || DEFAULT_PROFILE_NAME;
  const profilePath = resolveProfileConfigPath(configPath, profileName);
  const existing = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf8') : '';
  const patched = buildProfileConfig(options);
  const changed = normalizeText(existing) !== normalizeText(patched);

  if (!options.dryRun && changed) {
    writeTextAtomically(patched, profilePath);
  }

  return {
    changed,
    content: patched,
    path: profilePath,
  };
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  (async () => {
    try {
      const args = parseArgs(process.argv.slice(2));

      // Resolve shell: prefer --shell flag, otherwise auto-detect
      let shellValue = args.shell || null;
      if (!shellValue) {
        const bestShell = await getBestShell({ skipSlowProbes: true });
        if (bestShell) {
          shellValue = bestShell.path.includes('bash') ? 'bash' : bestShell.path.includes('pwsh') ? 'pwsh' : 'cmd';
        }
      }

      const result = patchConfigFile(args.config, {
        dryRun: args.dryRun,
        reviewModel: args.reviewModel,
        profileName: args.profileName,
        enableExternalProviders: args.enableExternalProviders,
        providerId: args.providerId || undefined,
        modelId: args.modelId || undefined,
      });
      const profileResult = writeProfileConfigFile(args.config, {
        dryRun: args.dryRun,
        profileName: args.profileName,
        providerId: args.providerId || undefined,
        modelId: args.modelId || undefined,
      });

      // Apply [windows] shell section if not already present
      let finalContent = result.content;
      let shellChanged = false;
      if (shellValue && !finalContent.includes('[windows]')) {
        finalContent = ensureTrailingNewline(finalContent) + `[windows]\nshell = "${shellValue}"\n`;
        shellChanged = true;
      }

      if (args.dryRun) {
        process.stdout.write(finalContent);
      } else if (result.changed || shellChanged || profileResult.changed) {
        if (shellChanged && !args.dryRun) {
          writeTextAtomically(finalContent, args.config);
        }
        if (result.changed || shellChanged) {
          console.log(`[CONFIG] ${args.config}`);
        } else {
          console.log(`[SKIP]   ${args.config} (up-to-date)`);
        }
        if (profileResult.changed) {
          console.log(`[CONFIG] ${profileResult.path}`);
        } else {
          console.log(`[SKIP]   ${profileResult.path} (up-to-date)`);
        }
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
