#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_PROFILE_NAME, DEFAULT_REVIEW_MODEL, patchConfigFile } from './codex-config-patch.mjs';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';
import {
  ensureDir,
  getUserHome,
  normalizeRel,
  syncDirectory,
  syncFile,
  syncText,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const codexAssetsRoot = path.join(repoRoot, 'codex-assets');
const manifestPath = path.join(codexAssetsRoot, 'manifest.json');

function toPosixJoin(...parts) {
  return normalizeRel(path.posix.join(...parts.filter(Boolean)));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isExpectedPatternMatch(entry, patternType) {
  const normalizedType = String(patternType || '').trim().toLowerCase();
  if (normalizedType === 'skill') {
    return entry.isDirectory();
  }
  if (normalizedType === 'agent' || normalizedType === 'instructions') {
    return entry.isFile();
  }
  return true;
}

function buildCounts(results) {
  const counts = {
    created: 0,
    updated: 0,
    skipped: 0,
    skippedConflict: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
  };

  for (const result of Array.isArray(results) ? results : []) {
    switch (result?.action) {
      case 'created':
        counts.created += 1;
        break;
      case 'updated':
        counts.updated += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'skipped_conflict':
        counts.skippedConflict += 1;
        break;
      case 'would_create':
        counts.wouldCreate += 1;
        break;
      case 'would_update':
        counts.wouldUpdate += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function listPatternMatches(sourceGlob, patternType) {
  const normalized = normalizeRel(sourceGlob);
  if (!normalized.includes('*')) {
    const sourceAbs = path.join(repoRoot, normalized);
    if (fs.existsSync(sourceAbs) && !isExpectedPatternMatch(fs.statSync(sourceAbs), patternType)) {
      return [];
    }
    return [normalized];
  }

  const dirRel = path.posix.dirname(normalized);
  const basePattern = path.posix.basename(normalized);
  const dirAbs = path.join(repoRoot, dirRel);
  const matcher = new RegExp(`^${escapeRegExp(basePattern).replace(/\\\*/g, '.*')}$`);
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  return entries
    .filter((entry) => matcher.test(entry.name) && isExpectedPatternMatch(entry, patternType))
    .map((entry) => toPosixJoin(dirRel, entry.name));
}

function deriveAssetId(type, sourceRel, transform) {
  const fileName = path.posix.basename(sourceRel);
  const baseName = fileName
    .replace(/\.agent\.md$/i, '')
    .replace(/\.prompt\.md$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.md$/i, '');
  const suffix = transform === 'engine-agent-to-codex-role' ? '-role' : '';
  return `${type}-${baseName}${suffix}`.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();
}

function createExpandedAsset(pattern, sourceRel) {
  const destinationDir = normalizeRel(String(pattern.destinationDir || '.')).replace(/\/$/, '');
  const sourceBaseName = path.posix.basename(sourceRel);
  const transform = String(pattern.transform || '').trim();
  const destinationFileName = transform === 'engine-agent-to-codex-role'
    ? sourceBaseName.replace(/\.agent\.md$/i, '.toml')
    : sourceBaseName;
  const destination = destinationDir === '.' || destinationDir === ''
    ? destinationFileName
    : toPosixJoin(destinationDir, destinationFileName);

  return {
    id: deriveAssetId(pattern.type, sourceRel, transform),
    type: pattern.type,
    source: sourceRel,
    destination,
    transform: transform || undefined,
    generated: transform === 'engine-agent-to-codex-role',
  };
}

function expandManifestAssets(manifest) {
  const explicitAssets = Array.isArray(manifest.assets) ? [...manifest.assets] : [];
  const byDestination = new Set(
    explicitAssets
      .filter((asset) => asset && typeof asset.destination === 'string')
      .map((asset) => normalizeRel(asset.destination))
  );
  const expandedAssets = [...explicitAssets];

  for (const pattern of Array.isArray(manifest.sourcePatterns) ? manifest.sourcePatterns : []) {
    if (!pattern || typeof pattern !== 'object') {
      continue;
    }
    for (const sourceRel of listPatternMatches(pattern.sourceGlob, pattern.type)) {
      const asset = createExpandedAsset(pattern, sourceRel);
      const destination = normalizeRel(asset.destination);
      if (byDestination.has(destination)) {
        continue;
      }
      expandedAssets.push(asset);
      byDestination.add(destination);
    }
  }

  return expandedAssets;
}

function parseFrontmatter(text) {
  const source = String(text || '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      attributes: {},
      body: source.trim(),
    };
  }

  const attributes = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || /^\s/.test(rawLine)) {
      continue;
    }

    const keyMatch = rawLine.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    attributes[key] = String(rawValue || '').trim().replace(/^['"]|['"]$/g, '');
  }

  return {
    attributes,
    body: source.slice(match[0].length).trim(),
  };
}

function buildCodexRoleToml(agentSourceAbs, sourceRel) {
  const text = fs.readFileSync(agentSourceAbs, 'utf8');
  const { attributes, body } = parseFrontmatter(text);
  const fallbackName = path.posix.basename(sourceRel).replace(/\.agent\.md$/i, '');
  const name = String(attributes.name || fallbackName).trim();
  const description = String(attributes.description || `${name} role installed from instruction-engine.`).trim();
  const developerInstructions = String(body || '').trim();

  if (!name) {
    throw new Error(`Generated Codex role is missing a name: ${sourceRel}`);
  }
  if (!description) {
    throw new Error(`Generated Codex role is missing a description: ${sourceRel}`);
  }
  if (!developerInstructions) {
    throw new Error(`Generated Codex role is missing developer instructions: ${sourceRel}`);
  }

  return [
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(developerInstructions)}`,
    '',
  ].join('\n');
}

function mapDestination(asset, codexHome, skillsHome) {
  const destination = normalizeRel(asset.destination);
  if (asset.type === 'skill') {
    const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
    return path.join(skillsHome, suffix);
  }
  return path.join(codexHome, destination);
}

function validateManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Manifest asset entry must be an object');
  }
  if (!asset.id || !asset.type || !asset.source || !asset.destination) {
    throw new Error(`Manifest asset is missing required fields: ${JSON.stringify(asset)}`);
  }
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    codexHome: '',
    skillsHome: '',
    repoRoot: '',
    elegyCliPath: '',
    reviewModel: DEFAULT_REVIEW_MODEL,
    profileName: DEFAULT_PROFILE_NAME,
    setupProfile: '',
    enableExternalProviders: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--force') {
      args.force = true;
      continue;
    }
    if (value.startsWith('--codex-home=')) {
      args.codexHome = value.slice('--codex-home='.length);
      continue;
    }
    if (value === '--codex-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --codex-home');
      }
      args.codexHome = argv[i] || '';
      continue;
    }
    if (value.startsWith('--skills-home=')) {
      args.skillsHome = value.slice('--skills-home='.length);
      continue;
    }
    if (value === '--skills-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --skills-home');
      }
      args.skillsHome = argv[i] || '';
      continue;
    }
    if (value.startsWith('--repo-root=')) {
      args.repoRoot = value.slice('--repo-root='.length);
      continue;
    }
    if (value.startsWith('--elegy-cli=')) {
      args.elegyCliPath = value.slice('--elegy-cli='.length);
      continue;
    }
    if (value === '--repo-root') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --repo-root');
      }
      args.repoRoot = argv[i] || '';
      continue;
    }
    if (value === '--elegy-cli') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --elegy-cli');
      }
      args.elegyCliPath = argv[i] || '';
      continue;
    }
    if (value.startsWith('--review-model=')) {
      args.reviewModel = value.slice('--review-model='.length);
      continue;
    }
    if (value === '--review-model') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --review-model');
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
      if (i >= argv.length) {
        throw new Error('Missing value for --profile-name');
      }
      args.profileName = argv[i] || '';
      continue;
    }
    if (value.startsWith('--setup-profile=')) {
      args.setupProfile = value.slice('--setup-profile='.length);
      continue;
    }
    if (value === '--setup-profile') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --setup-profile');
      }
      args.setupProfile = argv[i] || '';
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
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --codex-home <path>, --skills-home <path>, --repo-root <path>, --elegy-cli <path>, --review-model <model>, --profile-name <name>, --setup-profile <key>, --enable-external-providers, --disable-external-providers)`);
  }

  if (args.repoRoot && !args.setupProfile) {
    throw new Error('Missing value for --setup-profile when --repo-root is provided');
  }

  if (args.setupProfile && !args.repoRoot) {
    throw new Error('Missing value for --repo-root when --setup-profile is provided');
  }

  return args;
}

export function resolveCodexHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.CODEX_HOME) return path.resolve(process.env.CODEX_HOME);
  return path.join(getUserHome(), '.codex');
}

export function resolveSkillsHome(explicit, codexHome = '') {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_CODEX_SKILLS_HOME);
  }
  const resolvedCodexHome = codexHome ? path.resolve(codexHome) : resolveCodexHome('');
  return path.join(resolvedCodexHome, 'skills');
}

export function runInstall(args = {}) {
  const codexHome = resolveCodexHome(args.codexHome);
  const skillsHome = resolveSkillsHome(args.skillsHome, codexHome);
  const repoSetupRoot = args.repoRoot ? path.resolve(args.repoRoot) : '';
  const manifest = readManifest();
  const assets = expandManifestAssets(manifest);

  console.log(`Codex home:  ${codexHome}`);
  console.log(`Skills home: ${skillsHome}`);
  console.log(`Engine root: ${repoRoot}`);
  console.log(`Assets:      ${assets.length}`);
  if (repoSetupRoot) {
    console.log(`Repo setup:  ${repoSetupRoot} (${args.setupProfile})`);
  }

  ensureDir(codexHome, args.dryRun);
  ensureDir(path.join(codexHome, 'agents'), args.dryRun);
  ensureDir(skillsHome, args.dryRun);

  const assetResults = [];
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dst = mapDestination(asset, codexHome, skillsHome);
    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    let syncResult;
    if (asset.transform === 'engine-agent-to-codex-role') {
      const roleToml = buildCodexRoleToml(src, normalizeRel(asset.source));
      syncResult = syncText(roleToml, dst, args);
    } else if (asset.type === 'skill') {
      syncResult = syncDirectory(src, dst, args);
    } else {
      syncResult = syncFile(src, dst, args);
    }

    assetResults.push({
      id: asset.id,
      type: asset.type,
      source: normalizeRel(asset.source),
      destination: normalizeRel(asset.destination),
      generated: asset.generated === true,
      ...syncResult,
    });
  }

  const configPath = path.join(codexHome, 'config.toml');
  const configResult = patchConfigFile(configPath, {
    dryRun: args.dryRun,
    reviewModel: args.reviewModel,
    profileName: args.profileName,
    enableExternalProviders: args.enableExternalProviders,
  });
  const configAction = args.dryRun
    ? (configResult.changed ? 'would_patch' : 'skipped')
    : (configResult.changed ? 'patched' : 'skipped');
  if (args.dryRun) {
    if (configResult.changed) {
      console.log(`[DRY-RUN] PATCH ${configPath}`);
    } else {
      console.log(`[SKIP]   ${configPath} (up-to-date)`);
    }
  } else if (configResult.changed) {
    console.log(`[CONFIG] ${configPath}`);
  } else {
    console.log(`[SKIP]   ${configPath} (up-to-date)`);
  }

  const repoSetup = repoSetupRoot
    ? runRepoSetupProfileBootstrap({
      surface: 'codex',
      repoRoot: repoSetupRoot,
      profileKey: args.setupProfile,
      elegyCliPath: args.elegyCliPath,
      dryRun: args.dryRun,
      force: args.force,
    })
    : null;

  const summary = {
    surface: 'codex',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: {
      codexHome,
      skillsHome,
      agentsHome: path.join(codexHome, 'agents'),
      configPath,
    },
    counts: buildCounts(assetResults),
    assets: assetResults,
    generatedRoles: assetResults.filter((asset) => asset.generated === true).length,
    config: {
      action: configAction,
      changed: Boolean(configResult.changed),
      path: configPath,
    },
    repoSetup,
  };

  console.log('Done.');
  return summary;
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    runInstall(parseArgs(process.argv.slice(2)));
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
