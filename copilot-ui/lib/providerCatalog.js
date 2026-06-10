'use strict';

const fs = require('fs');
const path = require('path');

const {
  normalizeProviderCatalogDocument,
} = require('@elegy-copilot/contracts');

function readJsonIfExists(absPath) {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadProviderCatalog(engineRoot) {
  const providerCatalogPath = path.join(path.resolve(engineRoot), 'engine-assets', 'providers.json');
  const providerCatalog = normalizeProviderCatalogDocument(readJsonIfExists(providerCatalogPath));
  return {
    providerCatalogPath,
    providerCatalog,
  };
}

function resolveProviderInstallStatePath(elegyHome) {
  return path.join(path.resolve(elegyHome), 'catalog', 'providers-state.json');
}

function loadProviderInstallState(elegyHome) {
  const statePath = resolveProviderInstallStatePath(elegyHome);
  const raw = readJsonIfExists(statePath);
  const providers =
    raw && raw.providers && typeof raw.providers === 'object' && !Array.isArray(raw.providers)
      ? raw.providers
      : {};

  return {
    statePath,
    state: {
      schemaVersion: Number(raw?.schemaVersion) || 1,
      providers,
    },
  };
}

function buildProviderProjection(providerCatalog, providerState, effectiveAssets) {
  const assets = Array.isArray(effectiveAssets) ? effectiveAssets : [];
  return (Array.isArray(providerCatalog?.providers) ? providerCatalog.providers : []).map((provider) => {
    const providerAssets = assets.filter(
      (asset) => asset?.selectedEntry?.provenance?.providerId === provider.id,
    );
    const stateEntry = providerState?.providers?.[provider.id] || null;

    return {
      providerId: provider.id,
      title: provider.title,
      description: provider.description || null,
      sourceType: provider.sourceType || null,
      installStrategy: provider.installStrategy || null,
      bridgeStrategy: provider.bridgeStrategy || null,
      activationDefaults: provider.activationDefaults || null,
      defaultBundles: Array.isArray(provider.defaultBundles) ? provider.defaultBundles : [],
      state: stateEntry,
      discoveredAssets: {
        count: providerAssets.length,
        assetIds: providerAssets.map((asset) => asset.assetId),
        byKind: providerAssets.reduce((acc, asset) => {
          const kind = String(asset?.kind || '').trim();
          if (kind) {
            acc[kind] = (acc[kind] || 0) + 1;
          }
          return acc;
        }, {}),
      },
    };
  });
}

module.exports = {
  loadProviderCatalog,
  loadProviderInstallState,
  resolveProviderInstallStatePath,
  buildProviderProjection,
};
