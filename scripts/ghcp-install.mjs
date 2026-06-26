#!/usr/bin/env node

/**
 * ghcp-install.mjs — Deploy Elegy Copilot assets to GitHub Copilot CLI home.
 *
 * Usage:
 *   node scripts/ghcp-install.mjs [--dry-run] [--force] [--copilot-home <path>]
 *
 * Reads ghcp-assets/manifest.json, deploys agents and instructions to
 * ~/.copilot/ (or COPILOT_HOME), applies active profile, and installs the
 * wrapper script.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
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
import { composeInstructionsFromAsset } from './instruction-compose-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const ghcpAssetsRoot = path.join(repoRoot, 'ghcp-assets');
const manifestPath = path.join(ghcpAssetsRoot, 'manifest.json');
const managedInventoryFileName = '.elegy-copilot-ghcp-managed.json';

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
  const counts = { created: 0, updated: 0, skipped: 0, skippedConflict: 0, pruned: 0, skippedPruneConflict: 0 };
  for (const result of Array.isArray(results) ? results : []) {
    switch (result?.action) {
      case 'created': counts.created += 1; break;
      case 'updated': counts.updated += 1; break;
      case 'skipped': counts.skipped += 1; break;
      case 'skipped_conflict': counts.skippedConflict += 1; break;
      case 'pruned': counts.pruned += 1; break;
      case 'skipped_prune_conflict': counts.skippedPruneConflict += 1; break;
    }
  }
  return counts;
}

function toStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([k, v]) => typeof k === 'string' && k && typeof v === 'string')
  );
}

function buildManagedInventory(assetResults) {
  const inventory = { schemaVersion: 1, surface: 'ghcp', agents: {}, instructions: {} };
  for (const result of Array.isArray(assetResults) ? assetResults : []) {
    const destination = normalizeRel(result.destination);
    if (result.type === 'agent') {
      inventory.agents[path.basename(destination)] = String(result.sourceHash || '');
    } else if (result.type === 'instructions') {
      inventory.instructions[path.basename(destination)] = String(result.sourceHash || '');
    }
  }
  return inventory;
}

function readManagedInventory(inventoryPath) {
  if (!fs.existsSync(inventoryPath)) return buildManagedInventory([]);
  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    return { schemaVersion: 1, surface: 'ghcp', agents: toStringMap(parsed.agents), instructions: toStringMap(parsed.instructions) };
  } catch {
    return buildManagedInventory([]);
  }
}

function isSafeManagedEntryName(entryName) {
  return Boolean(entryName) && path.basename(entryName) === entryName && !normalizeRel(entryName).includes('/');
}

function pruneManagedEntries(targetRoot, recordedEntries, desiredEntries, kind, hashReader, options = {}) {
  const log = options.log || console.log;
  const results = [];
  if (!fs.existsSync(targetRoot)) return results;
  const entries = Object.entries(recordedEntries || {}).sort(([l], [r]) => l.localeCompare(r));
  for (const [entryName, recordedHash] of entries) {
    if (Object.prototype.hasOwnProperty.call(desiredEntries || {}, entryName)) continue;
    if (!isSafeManagedEntryName(entryName)) continue;
    const targetPath = path.join(targetRoot, entryName);
    if (!fs.existsSync(targetPath)) continue;
    const currentHash = hashReader(targetPath);
    if (recordedHash && currentHash && currentHash !== recordedHash) {
      const result = { action: 'skipped_prune_conflict', kind, path: targetPath, recordedHash, currentHash };
      results.push(result);
      log(`[SKIP]   ${targetPath} (${kind} diverged; leaving in place)`);
      continue;
    }
    const action = options.dryRun ? 'would_prune' : 'pruned';
    if (!options.dryRun) fs.rmSync(targetPath, { force: true });
    results.push({ action, kind, path: targetPath, recordedHash, currentHash });
    if (action === 'pruned') log(`[PRUNE]  ${targetPath} (${kind})`);
    else log(`[DRY-RUN] PRUNE ${targetPath} (${kind})`);
  }
  return results;
}

function shaText(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function readActiveProfile() {
  const profilesPath = path.join(ghcpAssetsRoot, 'profiles.json');
  if (!fs.existsSync(profilesPath)) return 'deepseek-direct';
  const p = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  return p.activeProfile || 'deepseek-direct';
}

function resolveCopilotHome(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.COPILOT_HOME) return path.resolve(process.env.COPILOT_HOME);
  return path.join(getUserHome(), '.copilot');
}

function parseArgs(argv) {
  const args = { dryRun: false, force: false, copilotHome: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') { args.dryRun = true; continue; }
    if (value === '--force') { args.force = true; continue; }
    if (value.startsWith('--copilot-home=')) { args.copilotHome = value.slice('--copilot-home='.length); continue; }
    if (value === '--copilot-home') {
      i += 1;
      if (i >= argv.length) throw new Error('Missing value for --copilot-home');
      args.copilotHome = argv[i] || '';
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --copilot-home <path>)`);
  }
  return args;
}

function installWrapperScript(copilotHome, dryRun) {
  const wrapperSrc = path.join(ghcpAssetsRoot, 'wrapper');
  if (!fs.existsSync(wrapperSrc)) {
    console.log('[SKIP] Wrapper source not found; skipping wrapper install');
    return;
  }

  // Install wrapper scripts to ~/.local/bin/ on Unix or %LOCALAPPDATA%\Programs\ghcp on Windows
  let binDir;
  if (process.platform === 'win32') {
    binDir = path.join(process.env.LOCALAPPDATA || path.join(getUserHome(), 'AppData', 'Local'), 'Programs', 'ghcp');
  } else {
    binDir = path.join(getUserHome(), '.local', 'bin');
  }

  if (!dryRun) ensureDir(binDir, false);

  for (const entry of fs.readdirSync(wrapperSrc)) {
    const src = path.join(wrapperSrc, entry);
    if (!fs.statSync(src).isFile()) continue;
    let dstName = entry;
    // On Windows, make .sh wrapper runnable via Git Bash; also copy .cmd shim
    const dst = path.join(binDir, dstName);
    syncFile(src, dst, { dryRun, force: true });
  }

  console.log(`[OK] Wrapper scripts installed to ${binDir}`);
  if (process.platform === 'win32') {
    console.log(`     Add to PATH: ${binDir}`);
    console.log('     Or run: ghcp <lane> <prompt> from a shell that has this on PATH');
  } else {
    console.log(`     Ensure this is on PATH: export PATH="${binDir}:$PATH"`);
  }
}

function printEnvSummary(copilotHome) {
  const activeProfile = readActiveProfile();
  const profilesPath = path.join(ghcpAssetsRoot, 'profiles.json');
  const profilesConfig = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  const profile = profilesConfig.profiles[activeProfile];
  if (!profile) return;

  const provider = profile.provider || {};
  console.log('');
  console.log(`Active profile: ${activeProfile}`);
  console.log(`  COPILOT_PROVIDER_TYPE=${provider.type || 'openai'}`);
  if (provider.baseUrl) console.log(`  COPILOT_PROVIDER_BASE_URL=${provider.baseUrl}`);
  if (provider.apiKeyEnv) console.log(`  COPILOT_PROVIDER_API_KEY=\$${provider.apiKeyEnv}`);
  if (profile.roleModels) {
    console.log('  Models by role:');
    for (const [role, model] of Object.entries(profile.roleModels)) {
      console.log(`    ${role.padEnd(16)} ${model}`);
    }
  }
}

export async function runInstall(args = {}) {
  const copilotHome = resolveCopilotHome(args.copilotHome);
  const inventoryPath = path.join(copilotHome, managedInventoryFileName);
  const manifest = readManifest();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`Copilot CLI home: ${copilotHome}`);
  console.log(`Engine root:      ${repoRoot}`);
  console.log(`Assets:           ${assets.length}`);

  ensureDir(copilotHome, args.dryRun);
  ensureDir(path.join(copilotHome, 'agents'), args.dryRun);

  const assetResults = [];

  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dstRel = normalizeRel(asset.destination);
    let dst;

    if (asset.type === 'instructions') {
      dst = path.join(copilotHome, dstRel);
    } else if (asset.type === 'agent') {
      dst = path.join(copilotHome, dstRel);
    } else {
      dst = path.join(copilotHome, dstRel);
    }

    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    let syncResult;
    if (asset.appendix) {
      // Compose instructions from baseline + appendix
      const profile = getCollaborationProfile();
      const profileContent = profile && profile.enabled ? '' : '';
      const composed = composeInstructionsFromAsset(asset, repoRoot, profileContent);
      syncResult = syncText(composed, dst, args);
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
    ...pruneManagedEntries(
      path.join(copilotHome, 'agents'),
      previousInventory.agents,
      desiredInventory.agents,
      'agent',
      shaFile,
      args
    ),
  ];

  const inventoryResult = syncText(`${JSON.stringify(desiredInventory, null, 2)}\n`, inventoryPath, {
    dryRun: args.dryRun,
    force: true,
  });

  // Install wrapper script
  installWrapperScript(copilotHome, args.dryRun);

  // Deploy profiles.json to fallback location for wrapper scripts
  const fallbackDir = path.join(getUserHome(), '.config', 'ghcp');
  const fallbackProfiles = path.join(fallbackDir, 'profiles.json');
  const sourceProfiles = path.join(ghcpAssetsRoot, 'profiles.json');
  if (fs.existsSync(sourceProfiles)) {
    syncFile(sourceProfiles, fallbackProfiles, { dryRun: args.dryRun, force: true });
  }

  // Smoke-test copilot binary
  if (!args.dryRun) {
    try {
      const { execSync } = await import('child_process');
      const version = execSync('copilot --version 2>&1 || echo "not found"', { encoding: 'utf8', timeout: 10000 }).trim();
      if (version && !version.includes('not found')) {
        console.log(`[OK] copilot binary detected: ${version}`);
      } else {
        console.log('[WARN] copilot binary not found on PATH — install from: brew install copilot-cli or npm i -g @github/copilot');
      }
    } catch {
      console.log('[WARN] Could not probe copilot binary — ensure it is installed');
    }
  }

  const summary = {
    surface: 'ghcp',
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: { copilotHome, agentsHome: path.join(copilotHome, 'agents'), inventoryPath },
    counts: buildCounts([...assetResults, ...pruneResults, inventoryResult]),
    assets: assetResults,
    cleanup: { inventory: inventoryResult, pruneResults },
  };

  console.log('');
  console.log('Done.');
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Ensure copilot CLI is installed: brew install copilot-cli or npm i -g @github/copilot`);
  console.log(`  2. Set your API key: export DEEPSEEK_API_KEY=<your-key>`);
  console.log(`  3. Try: ghcp quick "fix the typo in README.md"`);
  console.log(`  4. Switch profiles: ghcp profile switch <profile-id>`);
  console.log(`  5. List profiles: ghcp profile list`);
  console.log('');

  printEnvSummary(copilotHome);

  return summary;
}

// --- Collaboration profile stub (ghcp doesn't use presets the same way) ---
function getCollaborationProfile() {
  return { enabled: false };
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = parseArgs(process.argv.slice(2));
    await runInstall(args);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
