'use strict';

const fs = require('fs');
const path = require('path');

const LEDGER_SCHEMA_VERSION = 1;

function readInstallLedger(elegyHomeAbs) {
  const ledgerPath = path.join(path.resolve(elegyHomeAbs), 'catalog', 'install-ledger.json');
  try {
    const stat = fs.statSync(ledgerPath);
    if (!stat.isFile()) return null;
    const content = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    if (content && content.schemaVersion === LEDGER_SCHEMA_VERSION) return content;
    return null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(absPath, value) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(
    dir,
    `.${path.basename(absPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, absPath);
}

function writeInstallLedger(elegyHomeAbs, harnessId, managedAssetIds, lastResult) {
  const ledgerPath = path.join(path.resolve(elegyHomeAbs), 'catalog', 'install-ledger.json');
  const now = new Date().toISOString();
  const existing = readInstallLedger(elegyHomeAbs) || {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generatedAt: now,
    harnesses: {},
  };

  existing.harnesses[harnessId] = {
    optedInAt: existing.harnesses[harnessId]?.optedInAt || now,
    managedAssetIds: Array.isArray(managedAssetIds) ? [...new Set(managedAssetIds)].sort() : [],
    assetHashes: existing.harnesses[harnessId]?.assetHashes || {},
    lastResult: lastResult || 'ok',
    lastRunAt: now,
  };
  existing.generatedAt = now;

  writeJsonAtomic(ledgerPath, existing);
  return existing;
}

function isAssetExpectedForUser(assetId, harnessId, ledger) {
  if (!harnessId || !assetId) return false;
  const harnessEntry = ledger?.harnesses?.[harnessId];
  if (!harnessEntry?.optedInAt) return false;
  const assetIds = Array.isArray(harnessEntry.managedAssetIds) ? harnessEntry.managedAssetIds : [];
  return assetIds.includes(assetId);
}

function listHarnessOptedInAssetIds(ledger, harnessId) {
  if (!ledger) return [];
  const entry = ledger.harnesses?.[harnessId];
  return Array.isArray(entry?.managedAssetIds) ? entry.managedAssetIds : [];
}

function setHarnessOptedIn(elegyHomeAbs, harnessId, assetIds) {
  return writeInstallLedger(elegyHomeAbs, harnessId, assetIds, 'ok');
}

function removeHarnessOptIn(elegyHomeAbs, harnessId) {
  const ledgerPath = path.join(path.resolve(elegyHomeAbs), 'catalog', 'install-ledger.json');
  const now = new Date().toISOString();
  const existing = readInstallLedger(elegyHomeAbs) || {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generatedAt: now,
    harnesses: {},
  };
  delete existing.harnesses[harnessId];
  existing.generatedAt = now;
  writeJsonAtomic(ledgerPath, existing);
  return existing;
}

function setAssetHashes(elegyHomeAbs, harnessId, hashMap) {
  const ledgerPath = path.join(path.resolve(elegyHomeAbs), 'catalog', 'install-ledger.json');
  const now = new Date().toISOString();
  const existing = readInstallLedger(elegyHomeAbs) || {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    generatedAt: now,
    harnesses: {},
  };
  if (!existing.harnesses[harnessId]) {
    existing.harnesses[harnessId] = {
      optedInAt: now,
      managedAssetIds: [],
      assetHashes: {},
      lastResult: 'ok',
      lastRunAt: now,
    };
  }
  existing.harnesses[harnessId].assetHashes = { ...existing.harnesses[harnessId].assetHashes, ...hashMap };
  existing.generatedAt = now;
  writeJsonAtomic(ledgerPath, existing);
  return existing;
}

function getAssetHash(elegyHomeAbs, harnessId, assetId) {
  const ledger = readInstallLedger(elegyHomeAbs);
  return ledger?.harnesses?.[harnessId]?.assetHashes?.[assetId] || null;
}

function readOpenCodeManagedInventory(opencodeHomeAbs) {
  const inventoryPath = path.join(path.resolve(opencodeHomeAbs), '.elegy-copilot-opencode-managed.json');
  try {
    if (!fs.existsSync(inventoryPath)) return null;
    const content = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    if (content && typeof content === 'object') return content;
    return null;
  } catch {
    return null;
  }
}

function readElegyAssetsMetadata(targetHomeAbs) {
  const metadataPath = path.join(path.resolve(targetHomeAbs), 'elegy-assets.install.json');
  try {
    if (!fs.existsSync(metadataPath)) return null;
    const content = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    if (content && typeof content === 'object') return content;
    return null;
  } catch {
    return null;
  }
}

function isAssetInOpenCodeManagedInventory(assetId, opencodeHomeAbs) {
  const inventory = readOpenCodeManagedInventory(opencodeHomeAbs);
  if (!inventory) return false;

  // Strip harness prefix to get the core asset name for matching
  let coreName = assetId;
  if (coreName.startsWith('opencode-')) coreName = coreName.slice('opencode-'.length);
  else if (coreName.startsWith('codex-')) coreName = coreName.slice('codex-'.length);

  // Collect all keys from all inventory sections
  const sections = ['instructions', 'agents', 'skills', 'plugins'];
  const allKeys = [];
  for (const section of sections) {
    if (inventory[section] && typeof inventory[section] === 'object') {
      allKeys.push(...Object.keys(inventory[section]));
    }
  }

  if (allKeys.length === 0) return false;

  // Check if coreName matches any key (flexible: exact, extension-stripped, or substring)
  return allKeys.some((key) => {
    const keyWithoutExt = key.replace(/\.[^.]+$/, '');
    return (
      key === coreName ||
      keyWithoutExt === coreName ||
      coreName.includes(key) ||
      coreName.includes(keyWithoutExt) ||
      key.includes(coreName) ||
      keyWithoutExt.includes(coreName)
    );
  });
}

function isAssetExternallyManaged(assetId, harnessId, opencodeHomeAbs, codexHomeAbs, elegyHomeAbs) {
  if (harnessId === 'opencode') {
    return isAssetInOpenCodeManagedInventory(assetId, opencodeHomeAbs);
  }

  if (harnessId === 'codex') {
    if (isAssetInOpenCodeManagedInventory(assetId, codexHomeAbs)) return true;

    // Also check elegy-assets.install.json metadata for GitHub-sourced assets
    const elegyMeta = readElegyAssetsMetadata(elegyHomeAbs);
    if (elegyMeta && Array.isArray(elegyMeta.assets)) {
      if (elegyMeta.assets.some((a) => a && a.id === assetId)) return true;
    }

    const codexMeta = readElegyAssetsMetadata(codexHomeAbs);
    if (codexMeta && Array.isArray(codexMeta.assets)) {
      if (codexMeta.assets.some((a) => a && a.id === assetId)) return true;
    }

    return false;
  }

  return false;
}

module.exports = {
  readInstallLedger,
  writeInstallLedger,
  isAssetExpectedForUser,
  listHarnessOptedInAssetIds,
  setHarnessOptedIn,
  removeHarnessOptIn,
  setAssetHashes,
  getAssetHash,
  readOpenCodeManagedInventory,
  readElegyAssetsMetadata,
  isAssetInOpenCodeManagedInventory,
  isAssetExternallyManaged,
};
