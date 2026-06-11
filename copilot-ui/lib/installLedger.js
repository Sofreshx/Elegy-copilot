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

module.exports = {
  readInstallLedger,
  writeInstallLedger,
  isAssetExpectedForUser,
  listHarnessOptedInAssetIds,
  setHarnessOptedIn,
  removeHarnessOptIn,
  setAssetHashes,
  getAssetHash,
};
