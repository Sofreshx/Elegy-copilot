#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  DEFAULT_PROFILE_NAME,
  patchConfigFile,
  resolveProfileConfigPath,
  writeProfileConfigFile,
} from './codex-config-patch.mjs';
import { runRepoSetupProfileBootstrap } from './repo-setup-profile-bootstrap.mjs';
import {
  dirHash,
  ensureDir,
  getUserHome,
  normalizeRel,
  shaText,
  shaFile,
  syncDirectory,
  syncFile,
  syncText,
} from './install-surface-utils.mjs';
import { buildProfileContent, composeInstructionsFromAsset } from './instruction-compose-utils.mjs';
import {
  buildElegyHookDefinitions,
  createHookReceipt,
  mergeElegyHooksDocument,
  parseHooksDocument,
  serializeHooksDocument,
  uninstallElegyHooksDocument,
} from './codex-hook-merge.mjs';
const require = createRequire(import.meta.url);
const { getCollaborationProfile } = require('../copilot-ui/lib/copilotConfig.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const codexAssetsRoot = path.join(repoRoot, 'codex-assets');
const manifestPath = path.join(codexAssetsRoot, 'manifest.json');
const INVENTORY_FILE = '.elegy-copilot-codex-managed.json';
const PORTABILITY_RECEIPT_FILE = '.elegy-codex-portability.json';
const PORTABILITY_LICENSE_ROOT = '.elegy-codex-licenses';
const MARKETPLACE_RECEIPT_RELATIVE_PATH = path.join('marketplaces', 'elegy', 'elegy-codex-marketplace.install.json');
const HOOK_RECEIPT_FILE = '.elegy-codex-hooks.json';
const HOOK_RUNTIME_RELATIVE_PATH = path.join('hooks', 'elegy-workflow-improvement');

function pendingHookVerification(note) {
  return {
    verified: false,
    discoveryVerification: {
      method: 'hooks/list',
      status: 'pending',
      required: true,
    },
    trustVerification: {
      command: '/hooks',
      status: 'pending',
      required: true,
      note,
    },
  };
}

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
      case 'patched':
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
      case 'would_patch':
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

function readManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function readPortabilityLedger() {
  const ledgerPath = path.join(repoRoot, 'codex-assets', 'portability.json');
  if (!fs.existsSync(ledgerPath)) {
    throw new Error(`Codex portability ledger is missing: ${ledgerPath}`);
  }
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  if (!ledger || ledger.profile !== 'codex-portable/v1' || !Array.isArray(ledger.approvedPortable)) {
    throw new Error('Codex portability ledger is incomplete or invalid.');
  }
  return ledger;
}

function portabilityLicenseMaterials(ledger) {
  const materials = [];
  const seen = new Set();
  for (const entry of Array.isArray(ledger?.approvedPortable) ? ledger.approvedPortable : []) {
    for (const material of Array.isArray(entry?.licenseFiles) ? entry.licenseFiles : []) {
      if (!material || typeof material !== 'object') continue;
      const source = normalizeRel(material.source || '');
      const destination = normalizeRel(material.destination || '');
      if (!source || !destination || source.startsWith('../') || destination.startsWith('../')) {
        throw new Error(`Invalid Codex portability license material: ${JSON.stringify(material)}`);
      }
      const key = `${source}\u0000${destination}`;
      if (seen.has(key)) continue;
      seen.add(key);
      materials.push({ source, destination });
    }
  }
  return materials;
}

function installPortabilityLicenseMaterials(ledger, codexHome, options = {}) {
  const materials = portabilityLicenseMaterials(ledger);
  return materials.map((material) => {
    const sourcePath = path.resolve(repoRoot, material.source);
    const repoRelative = path.relative(repoRoot, sourcePath);
    if (!repoRelative || repoRelative.startsWith('..') || path.isAbsolute(repoRelative) || !fs.existsSync(sourcePath)) {
      throw new Error(`Codex portability license material is missing: ${material.source}`);
    }
    const destination = path.join(codexHome, PORTABILITY_LICENSE_ROOT, material.destination);
    const result = syncFile(sourcePath, destination, { ...options, force: true });
    return {
      source: material.source,
      destination: path.relative(codexHome, destination).replace(/\\/g, '/'),
      ...result,
    };
  });
}

function installMarketplaceReceipt(ledger, codexHome, options = {}) {
  const receiptPath = path.join(codexHome, MARKETPLACE_RECEIPT_RELATIVE_PATH);
  if (fs.existsSync(receiptPath)) {
    let existingReceipt;
    try {
      existingReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    } catch {
      throw new Error(`Existing Elegy marketplace receipt is invalid JSON: ${receiptPath}`);
    }
    let status;
    if (existingReceipt?.schemaVersion === 'elegy-codex-marketplace-receipt/v1') {
      if (existingReceipt.status !== 'external-install-required' || existingReceipt.marketplaceName !== 'elegy') {
        throw new Error(`Existing Elegy marketplace handoff receipt is incomplete: ${receiptPath}`);
      }
      status = 'external-install-required';
    } else if (existingReceipt?.schemaVersion === 'elegy-codex-marketplace-install/v1') {
      if (existingReceipt.marketplaceName !== 'elegy'
        || typeof existingReceipt.archiveSha256 !== 'string'
        || !/^[a-f0-9]{64}$/i.test(existingReceipt.archiveSha256)
        || typeof existingReceipt.installedAt !== 'string'
        || Number.isNaN(Date.parse(existingReceipt.installedAt))) {
        throw new Error(`Existing Elegy marketplace install receipt is incomplete: ${receiptPath}`);
      }
      status = 'installed-receipt';
    } else {
      throw new Error(`Existing Elegy marketplace receipt has an unsupported schema: ${receiptPath}`);
    }
    return {
      action: 'skipped',
      path: receiptPath,
      status,
      reason: 'existing-authoritative-marketplace-receipt-preserved',
    };
  }

  const marketplaceEntry = (Array.isArray(ledger?.requiredReceipts) ? ledger.requiredReceipts : [])
    .find((entry) => entry?.id === 'elegy-marketplace');
  const content = `${JSON.stringify({
    schemaVersion: 'elegy-codex-marketplace-receipt/v1',
    marketplaceName: 'elegy',
    status: 'external-install-required',
    installOwner: 'Maintenance marketplace service',
    producedBy: 'scripts/codex-install.mjs',
    authoritativeInstaller: 'copilot-ui/lib/elegyPluginMarketplace.js',
    requiredReceipt: marketplaceEntry?.path || MARKETPLACE_RECEIPT_RELATIVE_PATH.replace(/\\/g, '/'),
    pluginNames: ['elegy-documentation', 'elegy-mcp', 'elegy-checks', 'elegy-planning'],
    note: 'This deterministic handoff receipt does not claim that plugin artifacts are installed. Maintenance → Updates can replace it with the verified marketplace install receipt.',
  }, null, 2)}\n`;
  const result = syncText(content, receiptPath, { ...options, force: true });
  return {
    ...result,
    path: receiptPath,
    status: 'external-install-required',
  };
}

function isElegyManagedAsset(asset) {
  const owner = String(asset?.management?.owner || '').trim().toLowerCase();
  return owner !== 'harness' && owner !== 'harness-owned' && owner !== 'repository' && owner !== 'repo-owned';
}

function mergeManagedInventories(previous, current) {
  const currentMap = (key) => ({
    ...(current?.[key] && typeof current[key] === 'object' ? current[key] : {}),
  });
  const previousMap = (key) => ({
    ...(previous?.[key] && typeof previous[key] === 'object' ? previous[key] : {}),
  });
  return {
    schemaVersion: 1,
    surface: 'codex',
    // managedOnly deliberately owns compatibility instructions and skills;
    // native agents and config remain outside this lifecycle lane.
    instructions: currentMap('instructions'),
    skills: currentMap('skills'),
    agents: previousMap('agents'),
    configFiles: previousMap('configFiles'),
  };
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
  const description = String(attributes.description || `${name} role installed from elegy-copilot.`).trim();
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
    surface: 'codex',
    instructions: {},
    agents: {},
    skills: {},
    configFiles: {},
  };

  for (const result of Array.isArray(assetResults) ? assetResults : []) {
    const destination = normalizeRel(result.destination);
    const managedHash = String(result.managedHash ?? result.sourceHash ?? '');
    if (!managedHash) {
      continue;
    }
    if (result.type === 'instructions') {
      inventory.instructions[path.basename(destination)] = managedHash;
      continue;
    }
    if (result.type === 'agent') {
      inventory.agents[path.basename(destination)] = managedHash;
      continue;
    }
    if (result.type === 'skill') {
      const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
      const topDirectory = normalizeRel(suffix).split('/').filter(Boolean)[0];
      if (topDirectory) {
        inventory.skills[topDirectory] = managedHash;
      }
      continue;
    }
    if (result.type === 'config') {
      inventory.configFiles[path.basename(destination)] = managedHash;
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
      surface: 'codex',
      instructions: toStringMap(parsed.instructions),
      agents: toStringMap(parsed.agents),
      skills: toStringMap(parsed.skills),
      configFiles: toStringMap(parsed.configFiles),
    };
  } catch {
    return buildManagedInventory([]);
  }
}

function normalizeComparablePath(value) {
  const resolved = path.resolve(String(value || ''));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isValidHookReceipt(receipt, runtimePath, definitions) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (receipt.schemaVersion !== 1) return false;
  if (normalizeComparablePath(receipt.runtimeDirectory) !== normalizeComparablePath(runtimePath)) return false;
  if (typeof receipt.runtimeHash !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.runtimeHash)) return false;
  if (!Array.isArray(receipt.managedHandlers) || receipt.managedHandlers.length !== definitions.length) return false;

  const expected = new Set(definitions.map((definition) => JSON.stringify({
    event: definition.event,
    command: definition.group.hooks[0].command,
    commandWindows: definition.group.hooks[0].commandWindows,
  })));
  const actual = new Set(receipt.managedHandlers.map((handler) => JSON.stringify({
    event: handler?.event,
    command: handler?.command,
    commandWindows: handler?.commandWindows,
  })));
  return actual.size === expected.size && [...actual].every((signature) => expected.has(signature));
}

function readHookReceipt(receiptPath, runtimePath, definitions) {
  if (!fs.existsSync(receiptPath)) return {};
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    return isValidHookReceipt(receipt, runtimePath, definitions) ? receipt : {};
  } catch {
    return {};
  }
}

function removeManagedHookRuntime(runtimePath, receipt, options = {}) {
  if (!fs.existsSync(runtimePath)) {
    return { action: 'skipped', path: runtimePath };
  }
  const currentHash = dirHash(runtimePath);
  if (!receipt?.runtimeHash || receipt.runtimeHash !== currentHash) {
    return { action: 'skipped_conflict', path: runtimePath, currentHash };
  }
  if (options.dryRun) {
    console.log(`[DRY-RUN] PRUNE ${runtimePath} (managed hook runtime)`);
    return { action: 'would_prune', path: runtimePath, currentHash };
  }
  fs.rmSync(runtimePath, { recursive: true, force: true });
  console.log(`[PRUNE]  ${runtimePath} (managed hook runtime)`);
  return { action: 'pruned', path: runtimePath, currentHash };
}

function updateHookReceipt(receiptPath, receipt, options = {}) {
  return syncText(`${JSON.stringify(receipt, null, 2)}\n`, receiptPath, {
    dryRun: options.dryRun,
    force: true,
  });
}

function manageCodexHooks(args, codexHome) {
  const runtimeSource = path.join(codexAssetsRoot, 'hooks', 'elegy-workflow-improvement');
  const runtimePath = path.join(codexHome, HOOK_RUNTIME_RELATIVE_PATH);
  const runtimeFile = path.join(runtimePath, 'elegy-codex-hook.mjs');
  const hooksPath = path.join(codexHome, 'hooks.json');
  const receiptPath = path.join(codexHome, HOOK_RECEIPT_FILE);
  const definitions = buildElegyHookDefinitions(runtimeFile);
  const receipt = readHookReceipt(receiptPath, runtimePath, definitions);
  const existingText = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, 'utf8') : '';

  let mergedDocument;
  try {
    mergedDocument = args.uninstallHooks
      ? (fs.existsSync(hooksPath) ? uninstallElegyHooksDocument(existingText, definitions, receipt) : null)
      : mergeElegyHooksDocument(existingText, definitions, receipt);
  } catch (error) {
    console.warn(`[HOOKS] Existing ${hooksPath} was left unchanged: ${error.message || String(error)}`);
    return {
      enabled: false,
      valid: false,
      action: 'skipped_invalid',
      runtimePath,
      hooksPath,
      receiptPath,
      error: error.message || String(error),
      ...pendingHookVerification('Review and trust the exact command hooks in Codex; this installer never bypasses hook trust.'),
    };
  }

  if (args.hooksStatus) {
    const existing = parseHooksDocument(existingText);
    const workflowStateRoot = process.env.ELEGY_CODEX_WORKFLOW_HOME
      ? path.resolve(process.env.ELEGY_CODEX_WORKFLOW_HOME)
      : path.join(os.homedir(), '.elegy', 'codex-workflow-improvement');
    return {
      enabled: !args.uninstallHooks,
      valid: true,
      runtimePath,
      hooksPath,
      receiptPath,
      managedEvents: definitions.map((definition) => definition.event),
      localStatus: {
        method: 'hooks.json',
        configuredEvents: Object.keys(existing.hooks || {}).sort(),
      },
      runtimeStatus: {
        stateRoot: workflowStateRoot,
        stateRootExists: fs.existsSync(workflowStateRoot),
        bindingsObserved: fs.existsSync(path.join(workflowStateRoot, 'bindings.json')),
        sessionsObserved: fs.existsSync(path.join(workflowStateRoot, 'sessions')),
        note: 'Runtime files show observed execution only; hooks/list discovery and /hooks trust remain separate gates.',
      },
      ...pendingHookVerification('Local hooks.json status is not app-server hooks/list evidence. Review and trust the exact commands with /hooks.'),
    };
  }

  if (args.uninstallHooks) {
    const hooksResult = mergedDocument
      ? syncText(serializeHooksDocument(mergedDocument), hooksPath, { dryRun: args.dryRun, force: true })
      : { action: 'skipped', path: hooksPath };
    const runtimeResult = removeManagedHookRuntime(runtimePath, receipt, args);
    const receiptResult = fs.existsSync(receiptPath)
      ? (args.dryRun
        ? { action: 'would_prune', path: receiptPath }
        : (() => {
          fs.rmSync(receiptPath, { force: true });
          return { action: 'pruned', path: receiptPath };
        })())
      : { action: 'skipped', path: receiptPath };
    return {
      enabled: false,
      valid: true,
      action: 'uninstalled',
      runtimePath,
      hooksPath,
      receiptPath,
      runtime: runtimeResult,
      config: hooksResult,
      receipt: receiptResult,
      ...pendingHookVerification('Use /hooks to confirm the managed entries are gone; the installer never bypasses hook trust.'),
    };
  }

  const runtime = syncDirectory(runtimeSource, runtimePath, {
    dryRun: args.dryRun,
    force: args.force,
    previousHash: receipt.runtimeHash || '',
  });
  if (runtime.action === 'skipped_conflict') {
    return {
      enabled: false,
      valid: true,
      action: 'skipped_conflict',
      runtimePath,
      hooksPath,
      receiptPath,
      runtime,
      ...pendingHookVerification('The managed hook runtime has local changes. Resolve the conflict before configuring or trusting its commands.'),
    };
  }
  const config = syncText(serializeHooksDocument(mergedDocument), hooksPath, {
    dryRun: args.dryRun,
    force: true,
  });
  const nextReceipt = createHookReceipt(runtimePath, definitions, runtime.sourceHash);
  const receiptResult = updateHookReceipt(receiptPath, nextReceipt, args);
  return {
    enabled: true,
    valid: true,
    action: 'merged',
    runtimePath,
    hooksPath,
    receiptPath,
    runtime,
    config,
    receipt: receiptResult,
    managedEvents: definitions.map((definition) => definition.event),
    ...pendingHookVerification('Review and trust the exact command hooks in Codex; this installer never bypasses hook trust.'),
  };
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

function mapDestination(asset, codexHome, skillsHome) {
  const destination = normalizeRel(asset.destination);
  if (asset.type === 'skill') {
    const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
    return path.join(skillsHome, suffix);
  }
  return path.join(codexHome, destination);
}

function getPreviousManagedHash(inventory, asset) {
  const destination = normalizeRel(asset.destination);
  if (asset.type === 'instructions') {
    return inventory.instructions[path.basename(destination)] || '';
  }
  if (asset.type === 'agent') {
    return inventory.agents[path.basename(destination)] || '';
  }
  if (asset.type === 'skill') {
    const suffix = destination.startsWith('skills/') ? destination.slice('skills/'.length) : destination;
    const topDirectory = normalizeRel(suffix).split('/').filter(Boolean)[0];
    return topDirectory ? inventory.skills[topDirectory] || '' : '';
  }
  return '';
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
    profileName: DEFAULT_PROFILE_NAME,
    setupProfile: '',
    managedOnly: false,
    skipConfig: false,
    skipHooks: false,
    uninstallHooks: false,
    hooksStatus: false,
    printEnvOnly: false,
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
    if (value === '--managed-only') {
      args.managedOnly = true;
      continue;
    }
    if (value === '--skip-config') {
      args.skipConfig = true;
      continue;
    }
    if (value === '--skip-hooks') {
      args.skipHooks = true;
      continue;
    }
    if (value === '--uninstall-hooks') {
      args.uninstallHooks = true;
      continue;
    }
    if (value === '--hooks-status') {
      args.hooksStatus = true;
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
    if (value === '--print-env-only') {
      args.printEnvOnly = true;
      continue;
    }
    throw new Error(`Unknown arg: ${value} (supported: --dry-run, --force, --managed-only, --skip-config, --skip-hooks, --uninstall-hooks, --hooks-status, --codex-home <path>, --skills-home <path>, --repo-root <path>, --elegy-cli <path>, --profile-name <name>, --setup-profile <key>, --print-env-only)`);
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
  if (args.hooksStatus) {
    const hooks = manageCodexHooks({ ...args, hooksStatus: true }, codexHome);
    console.log(JSON.stringify(hooks, null, 2));
    return { surface: 'codex', ok: hooks.valid, hooks };
  }
  const repoSetupRoot = args.repoRoot ? path.resolve(args.repoRoot) : '';
  const manifest = readManifest();
  const portabilityLedger = readPortabilityLedger();
  const allAssets = expandManifestAssets(manifest);
  const assets = args.managedOnly ? allAssets.filter(isElegyManagedAsset) : allAssets;

  console.log(`Codex home:  ${codexHome}`);
  console.log(`Skills home: ${skillsHome}`);
  console.log(`Engine root: ${repoRoot}`);
  console.log(`Assets:      ${assets.length}`);
  if (repoSetupRoot) {
    console.log(`Repo setup:  ${repoSetupRoot} (${args.setupProfile})`);
  }

  const inventoryPath = path.join(codexHome, INVENTORY_FILE);
  const overridePath = path.join(codexHome, 'AGENTS.override.md');
  const previousInventory = readManagedInventory(inventoryPath);
  ensureDir(codexHome, args.dryRun);
  ensureDir(path.join(codexHome, 'agents'), args.dryRun);
  ensureDir(skillsHome, args.dryRun);
  const portabilityLicenseResults = installPortabilityLicenseMaterials(portabilityLedger, codexHome, args);
  const marketplaceReceiptResult = installMarketplaceReceipt(portabilityLedger, codexHome, args);

  const assetResults = [];
  for (const asset of assets) {
    validateManifestAsset(asset);
    const src = path.join(repoRoot, normalizeRel(asset.source));
    const dst = mapDestination(asset, codexHome, skillsHome);
    if (!fs.existsSync(src)) {
      throw new Error(`Source asset missing: ${asset.source}`);
    }

    const previousHash = getPreviousManagedHash(previousInventory, asset);
    const syncOptions = {
      ...args,
      previousHash,
    };
    let syncResult;
    if (asset.transform === 'engine-agent-to-codex-role') {
      const roleToml = buildCodexRoleToml(src, normalizeRel(asset.source));
      syncResult = syncText(roleToml, dst, syncOptions);
    } else if (asset.type === 'skill') {
      syncResult = syncDirectory(src, dst, syncOptions);
    } else if (asset.appendix) {
      const profile = getCollaborationProfile();
      const profileContent = buildProfileContent(profile);
      const composed = composeInstructionsFromAsset(asset, repoRoot, profileContent);
      syncResult = syncText(composed, dst, syncOptions);
    } else {
      syncResult = syncFile(src, dst, syncOptions);
    }

    assetResults.push({
      id: asset.id,
      type: asset.type,
      source: normalizeRel(asset.source),
      destination: normalizeRel(asset.destination),
      generated: asset.generated === true,
      ...syncResult,
      managedHash: syncResult.action === 'skipped_conflict' ? previousHash : syncResult.sourceHash,
    });
  }

  const portabilityReceiptPath = path.join(codexHome, PORTABILITY_RECEIPT_FILE);
  const portabilityReceipt = {
    ...portabilityLedger,
    generatedBy: 'scripts/codex-install.mjs',
    manifest: {
      path: path.relative(repoRoot, manifestPath).replace(/\\/g, '/'),
      sourceCommitSha: manifest.package?.sourceCommitSha || null,
      installedAssetIds: assetResults.map((asset) => asset.id),
    },
    licenseMaterials: portabilityLicenseResults.map((material) => ({
      source: material.source,
      destination: material.destination,
      action: material.action,
      sourceHash: material.sourceHash,
    })),
  };
  const portabilityReceiptResult = syncText(`${JSON.stringify(portabilityReceipt, null, 2)}\n`, portabilityReceiptPath, {
    dryRun: args.dryRun,
    force: true,
  });

  const hooks = args.skipHooks
    ? {
      enabled: false,
      valid: true,
      action: 'skipped',
      trustVerification: {
        command: '/hooks',
        status: 'pending',
        required: true,
        note: 'No hooks were installed because --skip-hooks was requested.',
      },
      verified: false,
      discoveryVerification: {
        method: 'hooks/list',
        status: 'pending',
        required: true,
      },
    }
    : manageCodexHooks(args, codexHome);

  const configPath = path.join(codexHome, 'config.toml');
  let configResult;
  let profileResult;
  if (args.skipConfig) {
    configResult = {
      changed: false,
      content: fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '',
    };
    profileResult = {
      changed: false,
      content: '',
      path: resolveProfileConfigPath(configPath, args.profileName),
    };
  } else {
    configResult = patchConfigFile(configPath, {
      dryRun: args.dryRun,
      profileName: args.profileName,
    });
    profileResult = writeProfileConfigFile(configPath, {
      dryRun: args.dryRun,
      profileName: args.profileName,
    });
  }
  const configAction = args.dryRun
    ? (configResult.changed ? 'would_patch' : 'skipped')
    : (configResult.changed ? 'patched' : 'skipped');
  const profileAction = args.dryRun
    ? (profileResult.changed ? 'would_patch' : 'skipped')
    : (profileResult.changed ? 'patched' : 'skipped');
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
  if (args.dryRun) {
    if (profileResult.changed) {
      console.log(`[DRY-RUN] PATCH ${profileResult.path}`);
    } else {
      console.log(`[SKIP]   ${profileResult.path} (up-to-date)`);
    }
  } else if (profileResult.changed) {
    console.log(`[CONFIG] ${profileResult.path}`);
  } else {
    console.log(`[SKIP]   ${profileResult.path} (up-to-date)`);
  }

  const configInventoryResults = [
    {
      id: 'codex-managed-config',
      type: 'config',
      destination: 'config.toml',
      sourceHash: configResult.content ? shaText(configResult.content) : '',
    },
    {
      id: 'codex-managed-profile',
      type: 'config',
      destination: path.basename(profileResult.path),
      sourceHash: profileResult.content ? shaText(profileResult.content) : '',
    },
  ];

  const desiredInventory = args.managedOnly
    ? mergeManagedInventories(previousInventory, buildManagedInventory(assetResults))
    : buildManagedInventory([...assetResults, ...configInventoryResults]);
  if (!args.managedOnly && args.skipConfig) {
    // Skipping config writes also preserves the previous config ownership ledger.
    desiredInventory.configFiles = toStringMap(previousInventory.configFiles);
  }

  const pruneResults = [
    ...(args.managedOnly ? [] : [
      ...pruneManagedEntries(path.join(codexHome, 'agents'), previousInventory.agents, desiredInventory.agents, 'agent', shaFile, args),
    ]),
    ...pruneManagedEntries(skillsHome, previousInventory.skills, desiredInventory.skills, 'skill', dirHash, args),
  ];

  // For instructions tracked in inventory (e.g. AGENTS.md), prune from codexHome root.
  // Only handle flat file entries that live directly in codexHome.
  const instructionsRoot = codexHome;
  if (!args.managedOnly) {
    pruneResults.push(...pruneManagedEntries(instructionsRoot, previousInventory.instructions, desiredInventory.instructions, 'instructions', shaFile, args));
    if (!args.skipConfig) {
      pruneResults.push(...pruneManagedEntries(instructionsRoot, previousInventory.configFiles, desiredInventory.configFiles, 'config', shaFile, args));
    }
  }

  const inventoryResult = syncText(`${JSON.stringify(desiredInventory, null, 2)}\n`, inventoryPath, {
    dryRun: args.dryRun,
    force: true,
  });

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
      inventoryPath,
      configPath,
    },
    instructions: {
      managedPath: path.join(codexHome, 'AGENTS.md'),
      overridePath,
      overridePresent: fs.existsSync(overridePath),
      activeGlobalPath: fs.existsSync(overridePath) ? overridePath : path.join(codexHome, 'AGENTS.md'),
    },
    counts: buildCounts([
      ...assetResults,
      ...pruneResults,
      inventoryResult,
      { action: configAction },
      { action: profileAction },
      hooks.runtime || {},
      hooks.config || {},
      hooks.receipt || {},
      portabilityReceiptResult,
      ...portabilityLicenseResults,
      marketplaceReceiptResult,
    ]),
    assets: assetResults,
    generatedRoles: assetResults.filter((asset) => asset.generated === true).length,
    cleanup: {
      inventory: inventoryResult,
      pruneResults,
    },
    config: {
      action: configAction,
      changed: Boolean(configResult.changed),
      path: configPath,
      profileAction,
      profileChanged: Boolean(profileResult.changed),
      profilePath: profileResult.path,
    },
    portability: {
      profile: portabilityLedger.profile,
      receiptPath: portabilityReceiptPath,
      receiptAction: portabilityReceiptResult.action,
      marketplaceReceipt: {
        path: path.relative(codexHome, marketplaceReceiptResult.path).replace(/\\/g, '/'),
        action: marketplaceReceiptResult.action,
        status: marketplaceReceiptResult.status || 'installed-receipt',
      },
      approvedPortable: portabilityLedger.approvedPortable.length,
      licenseMaterials: portabilityLicenseResults.length,
      licenseMaterialResults: portabilityLicenseResults,
      excludedLocalFolders: Array.isArray(portabilityLedger.reviewedLocalFolders)
        ? portabilityLedger.reviewedLocalFolders.length
        : 0,
      requiredReceipts: Array.isArray(portabilityLedger.requiredReceipts)
        ? portabilityLedger.requiredReceipts.map((entry) => entry.path)
        : [],
    },
    hooks,
    workflowAutomation: {
      status: 'disabled',
      scheduledTaskCreated: false,
      queueEnabled: false,
      reason: 'release_gates_pending',
      requiredGates: ['manual_v2', 'identity_binding', 'hook_trust', 'scheduled_permissions', 'self_exclusion'],
    },
    repoSetup,
  };

  if (summary.instructions.overridePresent) {
    console.warn(
      `[WARN]   ${overridePath} suppresses the managed AGENTS.md; merge or remove the override to activate Instruction Engine global policy.`,
    );
  }

  if (summary.hooks.valid) {
    console.log(`[HOOKS] ${summary.hooks.action}: ${summary.hooks.hooksPath || 'not configured'}`);
    console.warn(`[HOOKS] ${summary.hooks.trustVerification.note} Run /hooks to verify the installed entries.`);
  }

  // Keep planning session discovery pinned to the shared Elegy home.
  if (process.platform === 'win32') {
    const sessionPath = path.join(os.homedir(), '.elegy', 'planning-session.json');
    process.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH = sessionPath;
    console.log(`[ENV] INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=${sessionPath}`);

    // Mirror the sidecar from the CLI's default location to the override path.
    try {
      const _require = createRequire(import.meta.url);
      const { mirrorSessionSidecar } = _require('../copilot-ui/lib/planningSession.js');
      const defaultSource = path.join(os.homedir(), '.elegy', 'planning-session.json');
      const result = mirrorSessionSidecar({
        resolvedPath: sessionPath,
        defaultSourcePath: defaultSource,
        homedir: os.homedir(),
      });
      if (result) {
        console.log(`[SESSION] Mirrored sidecar: ${result.copiedFrom} → ${result.copiedTo}`);
      } else {
        console.log('[SESSION] No sidecar mirror needed (already present or source missing).');
      }
    } catch (err) {
      console.warn(`[SESSION] Mirror skipped: ${err.message}`);
    }
  }

  console.log('Done.');
  return summary;
}

try {
  if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = parseArgs(process.argv.slice(2));
    if (args.printEnvOnly) {
      if (process.platform === 'win32') {
        const sessionPath = path.join(os.homedir(), '.elegy', 'planning-session.json');
        console.log(`INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=${sessionPath}`);
      }
      process.exit(0);
    }
    runInstall(args);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}
