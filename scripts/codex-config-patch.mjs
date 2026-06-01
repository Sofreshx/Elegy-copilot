#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DEFAULT_REVIEW_MODEL = 'deepseek-v4-pro';
export const DEFAULT_PROFILE_NAME = 'instruction_engine_plan_review';
export const MANAGED_BLOCK_START = '# BEGIN instruction-engine managed codex defaults';
export const MANAGED_BLOCK_END = '# END instruction-engine managed codex defaults';
export const DEFAULT_PROVIDER_ID = 'opencode-go';
export const DEFAULT_MODEL = 'mimo-v2-pro';

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

export function stripManagedBlock(text) {
  const normalized = normalizeText(text);
  const pattern = new RegExp(
    `\\n?${escapeRegExp(MANAGED_BLOCK_START)}[\\s\\S]*?${escapeRegExp(MANAGED_BLOCK_END)}\\n?`,
    'g',
  );
  return normalized.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTopLevelKey(text, key) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`, 'm').test(text);
}

function hasProfile(text, profileName) {
  return new RegExp(`^\\s*\\[profiles\\.${escapeRegExp(profileName)}\\]\\s*$`, 'm').test(text);
}

function hasProviderTable(text, providerId) {
  return new RegExp(`^\\s*\\[model_providers\\.${escapeRegExp(providerId)}\\]\\s*$`, 'm').test(text);
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

function buildManagedBlock({ needsModel, needsProvider, needsReviewModel, reviewModel, needsProfile, profileName, enableExternalProviders, existingProviders }) {
  const lines = [MANAGED_BLOCK_START];

  if (needsModel) {
    lines.push(`model = "${DEFAULT_MODEL}"`);
    lines.push('');
  }

  if (needsProvider) {
    lines.push(`model_provider = "${DEFAULT_PROVIDER_ID}"`);
    lines.push('');
  }

  if (needsReviewModel) {
    lines.push(`review_model = "${reviewModel}"`);
    lines.push('');
  }

  if (needsProfile) {
    lines.push(`[profiles.${profileName}]`);
    lines.push(`model_provider = "${DEFAULT_PROVIDER_ID}"`);
    lines.push(`model = "${DEFAULT_MODEL}"`);
    lines.push('personality = "pragmatic"');
    lines.push('model_reasoning_effort = "high"');
    lines.push('plan_mode_reasoning_effort = "xhigh"');
    lines.push('');
  }

  if (enableExternalProviders) {
    for (const provider of EXTERNAL_PROVIDERS) {
      if (existingProviders.has(provider.id)) {
        continue;
      }
      lines.push(buildProviderTable(provider));
      lines.push('');
    }
  }

  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  lines.push(MANAGED_BLOCK_END);
  return lines.join('\n');
}

export function patchCodexConfig(originalText, options = {}) {
  const reviewModel = options.reviewModel || DEFAULT_REVIEW_MODEL;
  const profileName = options.profileName || DEFAULT_PROFILE_NAME;
  const enableExternalProviders = options.enableExternalProviders !== false;
  const stripped = stripManagedBlock(originalText);
  const needsModel = !hasTopLevelKey(stripped, 'model');
  const needsProvider = !hasTopLevelKey(stripped, 'model_provider');
  const needsReviewModel = !hasTopLevelKey(stripped, 'review_model');
  const needsProfile = !hasProfile(stripped, profileName);

  const existingProviders = new Set();
  if (enableExternalProviders) {
    for (const provider of EXTERNAL_PROVIDERS) {
      if (hasProviderTable(stripped, provider.id)) {
        existingProviders.add(provider.id);
      }
    }
  }

  const needsProviders = enableExternalProviders && existingProviders.size < EXTERNAL_PROVIDERS.length;

  if (!needsModel && !needsProvider && !needsReviewModel && !needsProfile && !needsProviders) {
    return ensureTrailingNewline(stripped || '');
  }

  const block = buildManagedBlock({
    needsModel,
    needsProvider,
    needsReviewModel,
    reviewModel,
    needsProfile,
    profileName,
    enableExternalProviders,
    existingProviders,
  });

  if (!stripped.trim()) {
    return ensureTrailingNewline(block);
  }

  return ensureTrailingNewline(`${stripped}\n\n${block}`);
}

export function patchConfigFile(configPath, options = {}) {
  const existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const patched = patchCodexConfig(existing, options);
  const changed = normalizeText(existing) !== normalizeText(patched);

  if (!options.dryRun && changed) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, patched, 'utf8');
  }

  return { changed, content: patched };
}

const isMainModule = process.argv[1]
  ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  : false;

if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = patchConfigFile(args.config, {
      dryRun: args.dryRun,
      reviewModel: args.reviewModel,
      profileName: args.profileName,
      enableExternalProviders: args.enableExternalProviders,
    });

    if (args.dryRun) {
      process.stdout.write(result.content);
    } else if (result.changed) {
      console.log(`[CONFIG] ${args.config}`);
    } else {
      console.log(`[SKIP]   ${args.config} (up-to-date)`);
    }
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}
