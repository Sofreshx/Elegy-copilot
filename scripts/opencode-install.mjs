#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ensureDir,
  getUserHome,
  normalizeRel,
  syncDirectory,
  syncFile,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const opencodeAssetsRoot = path.join(repoRoot, 'opencode-assets');
const manifestPath = path.join(opencodeAssetsRoot, 'manifest.json');

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validateManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Manifest asset entry must be an object');
  }
  if (!asset.id || !asset.type || !asset.source || !asset.destination) {
    throw new Error(`Manifest asset is missing required fields: ${JSON.stringify(asset)}`);
  }
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

function resolveOpenCodeHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.OPENCODE_HOME) return path.resolve(process.env.OPENCODE_HOME);
  const cfgDir = process.env.OPENCODE_CONFIG_DIR || process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME || path.join(getUserHome(), '.config'), 'opencode')
    : path.join(getUserHome(), '.config', 'opencode');
  return cfgDir;
}

function resolveSkillsHome(explicit, opencodeHome) {
  if (explicit) return path.resolve(explicit);
  if (process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME) {
    return path.resolve(process.env.INSTRUCTION_ENGINE_OPENCODE_SKILLS_HOME);
  }
  return path.join(opencodeHome, 'skills');
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    opencodeHome: '',
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
    if (value.startsWith('--opencode-home=')) {
      args.opencodeHome = value.slice('--opencode-home='.length);
      continue;
    }
    if (value === '--opencode-home') {
      i += 1;
      if (i >= argv.length) {
        throw new Error('Missing value for --opencode-home');
      }
      args.opencodeHome = argv[i] || '';
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
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --opencode-home <path>, --skills-home <path>)`);
  }

  return args;
}

export function runInstall(args = {}) {
  const opencodeHome = resolveOpenCodeHome(args.opencodeHome);
  const skillsHome = resolveSkillsHome(args.skillsHome, opencodeHome);
  const manifest = readManifest();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`OpenCode home: ${opencodeHome}`);
  console.log(`Skills home:   ${skillsHome}`);
  console.log(`Engine root:   ${repoRoot}`);
  console.log(`Assets:        ${assets.length}`);

  ensureDir(opencodeHome, args.dryRun);
  ensureDir(path.join(opencodeHome, 'agents'), args.dryRun);
  ensureDir(skillsHome, args.dryRun);

  const assetResults = [];
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dstRel = normalizeRel(asset.destination);
    let dst;

    if (asset.type === 'skill') {
      const suffix = dstRel.startsWith('skills/') ? dstRel.slice('skills/'.length) : dstRel;
      dst = path.join(skillsHome, suffix);
    } else if (asset.type === 'instructions') {
      dst = path.join(opencodeHome, dstRel);
    } else {
      dst = path.join(opencodeHome, dstRel);
    }

    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    let syncResult;
    if (asset.type === 'skill') {
      syncResult = syncDirectory(src, dst, args);
    } else {
      syncResult = syncFile(src, dst, args);
    }

    assetResults.push({
      id: asset.id,
      type: asset.type,
      source: normalizeRel(asset.source),
      destination: dstRel,
      ...syncResult,
    });
  }

  const summary = {
    surface: 'opencode',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: {
      opencodeHome,
      skillsHome,
      agentsHome: path.join(opencodeHome, 'agents'),
    },
    counts: buildCounts(assetResults),
    assets: assetResults,
  };

  console.log('Done.');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Ensure your OpenCode config exists at ${path.join(opencodeHome, 'opencode.json')}`);
  console.log('  2. Configure your provider (e.g. DeepSeek for light agents):');
  console.log('     Run /connect in OpenCode TUI and select DeepSeek');
  console.log('  3. Restart OpenCode to pick up new agents and skills');
  console.log('  4. Try: @code-explorer find the auth module, or @web-searcher check latest React docs');
  console.log('');
  console.log('For light-model agents (code-explorer, web-searcher), add to opencode.json:');
  console.log('  "agent": {');
  console.log('    "code-explorer": { "model": "deepseek/deepseek-chat" },');
  console.log('    "web-searcher": { "model": "deepseek/deepseek-chat" }');
  console.log('  }');

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
