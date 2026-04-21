#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDir,
  getUserHome,
  normalizeRel,
  shaText,
  syncDirectory,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const antigravityAssetsRoot = path.join(repoRoot, 'antigravity-assets');
const manifestPath = path.join(antigravityAssetsRoot, 'manifest.json');
const MANAGED_BLOCK_START = '<!-- instruction-engine:begin antigravity -->';
const MANAGED_BLOCK_END = '<!-- instruction-engine:end antigravity -->';

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

function deriveAssetId(type, sourceRel) {
  const fileName = path.posix.basename(sourceRel);
  const baseName = fileName.replace(/\.md$/i, '');
  return `${type}-${baseName}`.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase();
}

function createExpandedAsset(pattern, sourceRel) {
  const destinationDir = normalizeRel(String(pattern.destinationDir || '.')).replace(/\/$/, '');
  const sourceBaseName = path.posix.basename(sourceRel);
  const destination = destinationDir === '.' || destinationDir === ''
    ? sourceBaseName
    : toPosixJoin(destinationDir, sourceBaseName);

  return {
    id: deriveAssetId(pattern.type, sourceRel),
    type: pattern.type,
    source: sourceRel,
    destination,
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

function renderManagedBlock(templateText) {
  return [
    MANAGED_BLOCK_START,
    String(templateText || '').trim(),
    MANAGED_BLOCK_END,
    '',
  ].join('\n');
}

function composeGeminiInstructions(existingText, templateText) {
  const managedBlock = renderManagedBlock(templateText);
  const source = String(existingText || '').replace(/\r\n/g, '\n');

  if (!source.trim()) {
    return managedBlock;
  }

  const startIndex = source.indexOf(MANAGED_BLOCK_START);
  const endIndex = source.indexOf(MANAGED_BLOCK_END);
  if (startIndex >= 0 && endIndex >= startIndex) {
    const blockEnd = endIndex + MANAGED_BLOCK_END.length;
    const before = source.slice(0, startIndex).replace(/\s*$/, '');
    const after = source.slice(blockEnd).replace(/^\s*/, '');
    return [before, managedBlock.trimEnd(), after]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n';
  }

  return `${source.trimEnd()}\n\n${managedBlock}`;
}

function syncManagedInstructions(templatePath, instructionsPath, options = {}) {
  const log = options.log || console.log;
  ensureDir(path.dirname(instructionsPath), options.dryRun, log);

  const templateText = fs.readFileSync(templatePath, 'utf8');
  const existingText = fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : '';
  const nextText = composeGeminiInstructions(existingText, templateText);
  const previousHash = fs.existsSync(instructionsPath) ? shaText(existingText) : null;
  const nextHash = shaText(nextText);

  if (previousHash === nextHash) {
    log(`[SKIP]   ${instructionsPath} (up-to-date)`);
    return {
      action: 'skipped',
      path: instructionsPath,
      sourceHash: nextHash,
      destinationHash: previousHash,
    };
  }

  const action = fs.existsSync(instructionsPath)
    ? (options.dryRun ? 'would_update' : 'updated')
    : (options.dryRun ? 'would_create' : 'created');

  if (options.dryRun) {
    log(`[DRY-RUN] ${action === 'would_create' ? 'CREATE' : 'UPDATE'} ${instructionsPath}`);
  } else {
    fs.writeFileSync(instructionsPath, nextText, 'utf8');
    log(`[${action === 'created' ? 'CREATE' : 'UPDATE'}] ${instructionsPath}`);
  }

  return {
    action,
    path: instructionsPath,
    sourceHash: nextHash,
    destinationHash: options.dryRun ? previousHash : shaText(fs.readFileSync(instructionsPath, 'utf8')),
  };
}

function mapSkillDestination(asset, skillsHome) {
  const destination = normalizeRel(asset.destination);
  if (destination.startsWith('antigravity/skills/')) {
    return path.join(skillsHome, destination.slice('antigravity/skills/'.length));
  }
  if (destination.startsWith('skills/')) {
    return path.join(skillsHome, destination.slice('skills/'.length));
  }
  return path.join(skillsHome, destination);
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
    geminiHome: '',
    antigravityHome: '',
    skillsHome: '',
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
    if (value.startsWith('--gemini-home=')) {
      args.geminiHome = value.slice('--gemini-home='.length);
      continue;
    }
    if (value === '--gemini-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --gemini-home');
      }
      args.geminiHome = argv[i] || '';
      continue;
    }
    if (value.startsWith('--antigravity-home=')) {
      args.antigravityHome = value.slice('--antigravity-home='.length);
      continue;
    }
    if (value === '--antigravity-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --antigravity-home');
      }
      args.antigravityHome = argv[i] || '';
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

    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --gemini-home <path>, --antigravity-home <path>, --skills-home <path>)`);
  }

  return args;
}

export function resolveGeminiHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.GEMINI_HOME) return path.resolve(process.env.GEMINI_HOME);
  return path.join(getUserHome(), '.gemini');
}

export function resolveAntigravityHome(explicit, geminiHome = '') {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_HOME);
  }
  const resolvedGeminiHome = geminiHome ? path.resolve(geminiHome) : resolveGeminiHome('');
  return path.join(resolvedGeminiHome, 'antigravity');
}

export function resolveSkillsHome(explicit, antigravityHome = '') {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_ANTIGRAVITY_SKILLS_HOME);
  }
  const resolvedAntigravityHome = antigravityHome ? path.resolve(antigravityHome) : resolveAntigravityHome('');
  return path.join(resolvedAntigravityHome, 'skills');
}

export function runInstall(args = {}) {
  const geminiHome = resolveGeminiHome(args.geminiHome);
  const antigravityHome = resolveAntigravityHome(args.antigravityHome, geminiHome);
  const skillsHome = resolveSkillsHome(args.skillsHome, antigravityHome);
  const manifest = readManifest();
  const assets = expandManifestAssets(manifest);

  console.log(`Gemini home:       ${geminiHome}`);
  console.log(`Antigravity home:  ${antigravityHome}`);
  console.log(`Skills home:       ${skillsHome}`);
  console.log(`Engine root:       ${repoRoot}`);
  console.log(`Assets:            ${assets.length}`);

  ensureDir(geminiHome, args.dryRun);
  ensureDir(antigravityHome, args.dryRun);
  ensureDir(skillsHome, args.dryRun);

  const skillResults = [];
  let instructionsResult = null;
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    if (asset.type === 'instructions') {
      const instructionsPath = path.join(geminiHome, normalizeRel(asset.destination));
      instructionsResult = syncManagedInstructions(src, instructionsPath, args);
      continue;
    }

    if (asset.type === 'skill') {
      const dst = mapSkillDestination(asset, skillsHome);
      const result = syncDirectory(src, dst, args);
      skillResults.push({
        id: asset.id,
        type: asset.type,
        source: normalizeRel(asset.source),
        destination: normalizeRel(asset.destination),
        ...result,
      });
      continue;
    }

    throw new Error(`Unsupported Antigravity asset type: ${asset.type}`);
  }

  const allResults = instructionsResult ? [...skillResults, instructionsResult] : skillResults;
  const summary = {
    surface: 'antigravity',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: {
      geminiHome,
      antigravityHome,
      skillsHome,
      instructionsPath: path.join(geminiHome, 'GEMINI.md'),
    },
    counts: buildCounts(allResults),
    assets: skillResults,
    instructions: instructionsResult
      ? {
          action: instructionsResult.action,
          changed: instructionsResult.action !== 'skipped',
          path: instructionsResult.path,
        }
      : null,
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
