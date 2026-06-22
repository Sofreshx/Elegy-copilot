#!/usr/bin/env node
/**
 * harness-install-template.mjs — Shared install logic for harness home directories.
 *
 * Provides a reusable `runHarnessInstall(descriptor, args)` function that handles
 * the common flow: resolve dirs → read manifest → sync assets → prune → write inventory.
 *
 * Each harness provides a descriptor with harness-specific configuration and optional
 * callbacks for asset transforms and post-sync logic.
 */

'use strict';

import fs from 'fs';
import path from 'path';
import {
  dirHash,
  ensureDir,
  normalizeRel,
  shaFile,
  syncDirectory,
  syncFile,
  syncText,
} from './install-surface-utils.mjs';
import { createRequire } from 'module';
import { buildProfileContent, composeInstructionsFromAsset } from './instruction-compose-utils.mjs';

const require = createRequire(import.meta.url);
const { getCollaborationProfile } = require('../copilot-ui/lib/copilotConfig.js');

/**
 * @typedef {Object} HarnessDescriptor
 * @property {string} surface — Harness name (e.g. 'opencode', 'codex', 'claude')
 * @property {string} manifestPath — Absolute path to manifest.json
 * @property {function(string): string} resolveHome — Resolve harness home from explicit value
 * @property {function(string, string): string} resolveSkills — Resolve skills dir from explicit value and home
 * @property {string} inventoryFileName — Name of managed inventory file
 * @property {function(object, string, string): string} [mapDestination] — Custom destination mapping (asset, home, skillsHome) → absDst
 * @property {function(object, string, string, {readDst: function}): {text:string}|null} [onAssetSync] — Custom sync handler (asset, srcAbs, dstAbs, {readDst}) → {text} or null
 * @property {function(object, object): void} [postSync] — Post-sync hook (summary, args) → void
 */

/**
 * Build counts from an array of results.
 */
export function buildCounts(results) {
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
      case 'created_dir':
        counts.created += 1;
        break;
      case 'updated':
        counts.updated += 1;
        break;
      case 'skipped':
      case 'exists':
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
      case 'would_create_dir':
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

/**
 * Validate a manifest asset entry.
 */
export function validateManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Manifest asset entry must be an object');
  }
  if (!asset.id || !asset.type || !asset.source || !asset.destination) {
    throw new Error(`Manifest asset is missing required fields: ${JSON.stringify(asset)}`);
  }
}

/**
 * Build a managed inventory from asset results.
 */
export function buildManagedInventory(assetResults, surface, trackedTypes = ['instructions', 'skill']) {
  const inventory = { schemaVersion: 1, surface };

  for (const result of Array.isArray(assetResults) ? assetResults : []) {
    const destination = normalizeRel(result.destination);
    for (const type of trackedTypes) {
      if (result.type === type) {
        if (!inventory[type]) inventory[type] = {};
        if (type === 'skill') {
          const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
          const topDir = normalizeRel(suffix).split('/').filter(Boolean)[0];
          if (topDir) {
            inventory[type][topDir] = String(result.sourceHash || '');
          }
        } else {
          inventory[type][path.basename(destination)] = String(result.sourceHash || '');
        }
      }
    }
  }

  return inventory;
}

/**
 * Read a managed inventory file.
 */
export function readManagedInventory(inventoryPath, surface, trackedTypes = ['instructions', 'skill']) {
  if (!fs.existsSync(inventoryPath)) {
    return buildManagedInventory([], surface, trackedTypes);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    const inventory = { schemaVersion: 1, surface };
    for (const type of trackedTypes) {
      inventory[type] = Object.fromEntries(
        Object.entries(parsed[type] || {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
      );
    }
    return inventory;
  } catch {
    return buildManagedInventory([], surface, trackedTypes);
  }
}

function isSafeManagedEntryName(entryName) {
  return Boolean(entryName) && path.basename(entryName) === entryName && !normalizeRel(entryName).includes('/');
}

/**
 * Prune managed entries that are no longer in the desired set.
 */
export function pruneManagedEntries(targetRoot, recordedEntries, desiredEntries, kind, hashReader, options = {}) {
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
      results.push({
        action: 'skipped_prune_conflict',
        kind,
        path: targetPath,
        recordedHash,
        currentHash,
      });
      continue;
    }

    const action = options.dryRun ? 'would_prune' : 'pruned';
    if (!options.dryRun) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    results.push({ action, kind, path: targetPath, recordedHash, currentHash });
  }

  return results;
}

/**
 * Run the standard harness install flow.
 *
 * @param {HarnessDescriptor} descriptor
 * @param {Object} args — { dryRun, force, explicitHome, explicitSkillsHome, repoRoot, setupProfile, ... }
 * @returns {Object} summary
 */
export function runHarnessInstall(descriptor, args = {}) {
  const {
    surface,
    manifestPath,
    resolveHome,
    resolveSkills,
    inventoryFileName,
    mapDestination,
    onAssetSync,
    postSync,
  } = descriptor;

  const home = resolveHome(args.explicitHome || '');
  const skillsHome = resolveSkills(args.explicitSkillsHome || '', home);
  const repoRoot = path.resolve(manifestPath, '..', '..');
  const inventoryPath = path.join(home, inventoryFileName);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

  console.log(`${surface} home:    ${home}`);
  console.log(`Skills home:   ${skillsHome}`);
  console.log(`Engine root:   ${repoRoot}`);
  console.log(`Assets:        ${assets.length}`);

  ensureDir(home, args.dryRun);
  ensureDir(skillsHome, args.dryRun);

  const assetResults = [];
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));

    let dst;
    if (mapDestination) {
      dst = mapDestination(asset, home, skillsHome);
    } else if (asset.type === 'skill') {
      const dstRel = normalizeRel(asset.destination);
      const suffix = dstRel.startsWith('skills/') ? dstRel.slice('skills/'.length) : dstRel;
      dst = path.join(skillsHome, suffix);
    } else {
      dst = path.join(home, normalizeRel(asset.destination));
    }

    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    let syncResult;
    if (onAssetSync) {
      const readDst = () => fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : '';
      const customResult = onAssetSync(asset, src, dst, { readDst });
      if (customResult && customResult.text != null) {
        syncResult = syncText(customResult.text, dst, args);
      } else if (asset.type === 'skill') {
        syncResult = syncDirectory(src, dst, args);
      } else if (asset.appendix) {
        const profile = getCollaborationProfile();
        const profileContent = buildProfileContent(profile);
        const composed = composeInstructionsFromAsset(asset, repoRoot, profileContent);
        syncResult = syncText(composed, dst, args);
      } else {
        syncResult = syncFile(src, dst, args);
      }
    } else if (asset.type === 'skill') {
      syncResult = syncDirectory(src, dst, args);
    } else if (asset.appendix) {
      const profile = getCollaborationProfile();
      const profileContent = buildProfileContent(profile);
      const composed = composeInstructionsFromAsset(asset, repoRoot, profileContent);
      syncResult = syncText(composed, dst, args);
    } else {
      syncResult = syncFile(src, dst, args);
    }

    assetResults.push({
      id: asset.id,
      type: asset.type,
      source: normalizeRel(asset.source),
      destination: normalizeRel(asset.destination),
      ...syncResult,
    });
  }

  const trackedTypes = ['instructions', 'skill'];
  if (assetResults.some(r => r.type === 'agent')) trackedTypes.push('agent');
  if (assetResults.some(r => r.type === 'plugin')) trackedTypes.push('plugin');

  const previousInventory = readManagedInventory(inventoryPath, surface, trackedTypes);
  const desiredInventory = buildManagedInventory(assetResults, surface, trackedTypes);

  const pruneResults = [];
  for (const type of trackedTypes) {
    if (previousInventory[type] && desiredInventory[type]) {
      const reader = type === 'skill' ? dirHash : shaFile;
      const kind = type;
      const targetDir = type === 'skill'
        ? skillsHome
        : path.join(home, `${type}${type.endsWith('s') ? '' : 's'}/`);
      pruneResults.push(...pruneManagedEntries(targetDir, previousInventory[type], desiredInventory[type], kind, reader, args));
    }
  }

  const inventoryResult = syncText(`${JSON.stringify(desiredInventory, null, 2)}\n`, inventoryPath, {
    dryRun: args.dryRun,
    force: true,
  });

  const summary = {
    surface,
    ok: true,
    dryRun: Boolean(args.dryRun),
    force: Boolean(args.force),
    homes: { home, skillsHome, inventoryPath },
    counts: buildCounts([...assetResults, ...pruneResults, inventoryResult]),
    assets: assetResults,
    cleanup: { inventory: inventoryResult, pruneResults },
  };

  if (postSync) {
    postSync(summary, args);
  }

  console.log('Done.');
  return summary;
}
