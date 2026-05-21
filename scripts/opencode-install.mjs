#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';
import {
  dirHash,
  ensureDir,
  getUserHome,
  normalizeRel,
  shaFile,
  syncDirectory,
  syncFile,
  syncText,
} from './install-surface-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const opencodeAssetsRoot = path.join(repoRoot, 'opencode-assets');
const manifestPath = path.join(opencodeAssetsRoot, 'manifest.json');
const managedInventoryFileName = '.instruction-engine-opencode-managed.json';

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
    pruned: 0,
    skippedPruneConflict: 0,
    wouldCreate: 0,
    wouldUpdate: 0,
    wouldPrune: 0,
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
      case 'pruned':
        counts.pruned += 1;
        break;
      case 'skipped_prune_conflict':
        counts.skippedPruneConflict += 1;
        break;
      case 'would_create':
        counts.wouldCreate += 1;
        break;
      case 'would_update':
        counts.wouldUpdate += 1;
        break;
      case 'would_prune':
        counts.wouldPrune += 1;
        break;
      default:
        break;
    }
  }

  return counts;
}

function toStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key, mappedValue]) => typeof key === 'string' && key && typeof mappedValue === 'string')
  );
}

function buildManagedInventory(assetResults) {
  const inventory = {
    schemaVersion: 1,
    surface: 'opencode',
    instructions: {},
    agents: {},
    skills: {},
  };

  for (const result of Array.isArray(assetResults) ? assetResults : []) {
    const destination = normalizeRel(result.destination);
    if (result.type === 'instructions') {
      inventory.instructions[path.basename(destination)] = String(result.sourceHash || '');
      continue;
    }
    if (result.type === 'agent') {
      inventory.agents[path.basename(destination)] = String(result.sourceHash || '');
      continue;
    }
    if (result.type === 'skill') {
      const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
      const topDirectory = normalizeRel(suffix).split('/').filter(Boolean)[0];
      if (topDirectory) {
        inventory.skills[topDirectory] = String(result.sourceHash || '');
      }
    }
  }

  return inventory;
}

function readManagedInventory(inventoryPath) {
  if (!fs.existsSync(inventoryPath)) {
    return buildManagedInventory([]);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    return {
      schemaVersion: 1,
      surface: 'opencode',
      instructions: toStringMap(parsed.instructions),
      agents: toStringMap(parsed.agents),
      skills: toStringMap(parsed.skills),
    };
  } catch {
    return buildManagedInventory([]);
  }
}

function isSafeManagedEntryName(entryName) {
  return Boolean(entryName) && path.basename(entryName) === entryName && !normalizeRel(entryName).includes('/');
}

function logPruneAction(action, targetPath, kind, log) {
  if (action === 'pruned') {
    log(`[PRUNE]  ${targetPath} (${kind})`);
    return;
  }
  if (action === 'would_prune') {
    log(`[DRY-RUN] PRUNE ${targetPath} (${kind})`);
    return;
  }
  if (action === 'skipped_prune_conflict') {
    log(`[SKIP]   ${targetPath} (${kind} diverged; leaving user-modified content in place)`);
  }
}

function pruneManagedEntries(targetRoot, recordedEntries, desiredEntries, kind, hashReader, options = {}) {
  const log = options.log || console.log;
  const results = [];

  if (!fs.existsSync(targetRoot)) {
    return results;
  }

  const entries = Object.entries(recordedEntries || {}).sort(([left], [right]) => left.localeCompare(right));
  for (const [entryName, recordedHash] of entries) {
    if (Object.prototype.hasOwnProperty.call(desiredEntries || {}, entryName)) {
      continue;
    }
    if (!isSafeManagedEntryName(entryName)) {
      continue;
    }

    const targetPath = path.join(targetRoot, entryName);
    if (!fs.existsSync(targetPath)) {
      continue;
    }

    const currentHash = hashReader(targetPath);
    if (recordedHash && currentHash && currentHash !== recordedHash) {
      const result = {
        action: 'skipped_prune_conflict',
        kind,
        path: targetPath,
        recordedHash,
        currentHash,
      };
      results.push(result);
      logPruneAction(result.action, targetPath, kind, log);
      continue;
    }

    const action = options.dryRun ? 'would_prune' : 'pruned';
    if (!options.dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    const result = {
      action,
      kind,
      path: targetPath,
      recordedHash,
      currentHash,
    };
    results.push(result);
    logPruneAction(action, targetPath, kind, log);
  }

  return results;
}

export function resolveOpenCodeHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.OPENCODE_HOME) return path.resolve(process.env.OPENCODE_HOME);
  const cfgDir = process.env.OPENCODE_CONFIG_DIR || process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME || path.join(getUserHome(), '.config'), 'opencode')
    : path.join(getUserHome(), '.config', 'opencode');
  return cfgDir;
}

export function resolveSkillsHome(explicit, opencodeHome) {
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
    repoRoot: '',
    setupProfile: '',
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
    if (value.startsWith('--repo-root=')) {
      args.repoRoot = value.slice('--repo-root='.length);
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
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --opencode-home <path>, --skills-home <path>, --repo-root <path>, --setup-profile <key>)`);
  }

  if (args.repoRoot && !args.setupProfile) {
    throw new Error('Missing value for --setup-profile when --repo-root is provided');
  }

  if (args.setupProfile && !args.repoRoot) {
    throw new Error('Missing value for --repo-root when --setup-profile is provided');
  }

  return args;
}

export function runInstall(args = {}) {
  const opencodeHome = resolveOpenCodeHome(args.opencodeHome);
  const skillsHome = resolveSkillsHome(args.skillsHome, opencodeHome);
  const repoSetupRoot = args.repoRoot ? path.resolve(args.repoRoot) : '';
  const inventoryPath = path.join(opencodeHome, managedInventoryFileName);
  const manifest = readManifest();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`OpenCode home: ${opencodeHome}`);
  console.log(`Skills home:   ${skillsHome}`);
  console.log(`Engine root:   ${repoRoot}`);
  console.log(`Assets:        ${assets.length}`);
  if (repoSetupRoot) {
    console.log(`Repo setup:    ${repoSetupRoot} (${args.setupProfile})`);
  }

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

  const previousInventory = readManagedInventory(inventoryPath);
  const desiredInventory = buildManagedInventory(assetResults);
  const pruneResults = [
    ...pruneManagedEntries(path.join(opencodeHome, 'agents'), previousInventory.agents, desiredInventory.agents, 'agent', shaFile, args),
    ...pruneManagedEntries(skillsHome, previousInventory.skills, desiredInventory.skills, 'skill', dirHash, args),
  ];
  const inventoryResult = syncText(`${JSON.stringify(desiredInventory, null, 2)}\n`, inventoryPath, {
    dryRun: args.dryRun,
    force: true,
  });
  const repoSetup = repoSetupRoot
    ? runRepoSetupProfileBootstrap({
      surface: 'opencode',
      repoRoot: repoSetupRoot,
      profileKey: args.setupProfile,
      dryRun: args.dryRun,
      force: args.force,
    })
    : null;

  const summary = {
    surface: 'opencode',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: {
      opencodeHome,
      skillsHome,
      agentsHome: path.join(opencodeHome, 'agents'),
      inventoryPath,
    },
    counts: buildCounts([...assetResults, ...pruneResults, inventoryResult]),
    assets: assetResults,
    cleanup: {
      inventory: inventoryResult,
      pruneResults,
    },
    repoSetup,
  };

  console.log('Done.');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Ensure your OpenCode config exists at ${path.join(opencodeHome, 'opencode.json')}`);
  console.log('  2. Configure your provider and preferred models for the built-in OpenCode agents:');
  console.log('     Run /connect in OpenCode TUI and select DeepSeek');
  console.log('  3. Restart OpenCode to pick up new agents and skills');
  console.log('  4. Try: use Plan for a non-trivial task, Explore for code discovery, Scout for docs, and rubberduck-plan-review for risky plans');
  console.log('');
  console.log('For native-first model overrides, add to opencode.json:');
  console.log('  "agent": {');
  console.log('    "plan": { "model": "anthropic/claude-sonnet-4-5" },');
  console.log('    "explore": { "model": "deepseek/deepseek-chat" },');
  console.log('    "scout": { "model": "deepseek/deepseek-chat" }');
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
