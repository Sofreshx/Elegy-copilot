import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  getShippedAsset,
  getShippedBundle,
} from '../catalog-assets/shippedAssets.mjs';
import {
  CLI_MANDATORY_ALLOWLIST_ITEMS,
  COMPATIBILITY_MANIFESTS,
} from '../catalog-assets/targetRouting.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const manifestById = new Map(COMPATIBILITY_MANIFESTS.map((entry) => [entry.manifestId, entry]));

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizePathValue(value) {
  return String(value || '').replace(/\\/g, '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableTypeOrder(type) {
  if (type === 'agent') return 0;
  if (type === 'instructions') return 1;
  if (type === 'prompt') return 2;
  if (type === 'skill') return 3;
  return 9;
}

function deriveDefaultDestination(asset) {
  const source = normalizePathValue(asset?.source);
  const sourceBaseName = path.posix.basename(source);

  if (asset?.type === 'agent') {
    return `agents/${sourceBaseName}`;
  }
  if (asset?.type === 'prompt') {
    return `prompts/${sourceBaseName}`;
  }
  if (asset?.type === 'instructions') {
    return sourceBaseName;
  }
  if (asset?.type === 'skill') {
    return `skills/${path.posix.basename(source)}`;
  }
  if (asset?.type === 'hook') {
    const hookDirName = path.posix.basename(path.posix.dirname(source));
    return `hooks/${hookDirName}/hook.md`;
  }
  if (asset?.type === 'plugin') {
    return `plugins/${path.posix.basename(source)}`;
  }
  throw new Error(`Unsupported asset type for destination derivation: ${asset?.type || '<unknown>'}`);
}

function resolveManifestDefinition(manifestId) {
  const manifest = manifestById.get(String(manifestId || '').trim());
  if (!manifest) {
    throw new Error(`Unknown compatibility manifest id: ${manifestId}`);
  }
  return manifest;
}

function resolveAssetRoutes(manifestDefinition) {
  if (manifestDefinition.inheritRoutesFromManifestId) {
    return resolveAssetRoutes(resolveManifestDefinition(manifestDefinition.inheritRoutesFromManifestId));
  }
  return Array.isArray(manifestDefinition.assetRoutes) ? manifestDefinition.assetRoutes.map((entry) => ({ ...entry })) : [];
}

function materializeAsset(route) {
  const sourceAsset = getShippedAsset(route.sourceAssetId || route.assetId);
  if (!sourceAsset) {
    throw new Error(`Unknown shipped asset '${route.sourceAssetId || route.assetId}' in manifest routing.`);
  }

  return {
    id: route.assetId || sourceAsset.id,
    type: sourceAsset.type,
    source: route.source || sourceAsset.source,
    destination: route.destination || deriveDefaultDestination(sourceAsset),
    ...(route.loadMode || sourceAsset.loadMode ? { loadMode: route.loadMode || sourceAsset.loadMode } : {}),
    ...(route.governance || sourceAsset.governance
      ? { governance: cloneJson(route.governance || sourceAsset.governance) }
      : {}),
    ...(sourceAsset.appendix ? { appendix: sourceAsset.appendix } : {}),
  };
}

function parseAllowlistArgs(options = {}) {
  return {
    all: Boolean(options.all),
  };
}

function loadAllowlist(repoRoot, manifestDefinition, options = {}) {
  if (!manifestDefinition.useAllowlist) {
    return null;
  }

  const args = parseAllowlistArgs(options);
  if (args.all) {
    return null;
  }

  const allowlistPath = path.join(repoRoot, manifestDefinition.allowlistPath || '.cli/manifest.allowlist.json');
  if (!fs.existsSync(allowlistPath)) {
    return null;
  }

  const parsed = readJson(allowlistPath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid allowlist JSON at ${allowlistPath}`);
  }

  return {
    allowPath: allowlistPath,
    agents: new Set(Array.isArray(parsed.agents) ? parsed.agents.map((entry) => String(entry)) : []),
    skills: new Set(Array.isArray(parsed.skills) ? parsed.skills.map((entry) => String(entry)) : []),
    prompts: new Set(Array.isArray(parsed.prompts) ? parsed.prompts.map((entry) => String(entry)) : []),
  };
}

function enforceMandatoryAllowlistItems(allow, manifestDefinition) {
  if (!allow) {
    return;
  }

  const mandatory = manifestDefinition.mandatoryAllowlistItems || CLI_MANDATORY_ALLOWLIST_ITEMS;
  for (const entry of mandatory.agents || []) {
    allow.agents.add(entry);
  }
  for (const entry of mandatory.skills || []) {
    allow.skills.add(entry);
  }
  for (const entry of mandatory.prompts || []) {
    allow.prompts.add(entry);
  }
}

function getAllowlistKey(asset) {
  const source = normalizePathValue(asset?.source);
  if (asset?.type === 'agent') {
    return path.posix.basename(source).replace(/\.agent\.md$/i, '');
  }
  if (asset?.type === 'prompt') {
    return path.posix.basename(source).replace(/\.prompt\.md$/i, '');
  }
  if (asset?.type === 'skill') {
    const destination = normalizePathValue(asset?.destination);
    return path.posix.basename(destination || source);
  }
  return '';
}

function filterAssetsByAllowlist(assets, allow) {
  if (!allow) {
    return assets;
  }

  const matched = {
    agents: new Set(),
    skills: new Set(),
    prompts: new Set(),
  };
  const filtered = [];

  for (const asset of assets) {
    if (asset.type === 'instructions') {
      filtered.push(asset);
      continue;
    }

    const allowlistKey = getAllowlistKey(asset);
    if (!allowlistKey) {
      continue;
    }

    if (asset.type === 'agent') {
      if (!allow.agents.has(allowlistKey)) {
        continue;
      }
      matched.agents.add(allowlistKey);
      filtered.push(asset);
      continue;
    }

    if (asset.type === 'skill') {
      if (!allow.skills.has(allowlistKey)) {
        continue;
      }
      matched.skills.add(allowlistKey);
      filtered.push(asset);
      continue;
    }

    if (asset.type === 'prompt') {
      if (!allow.prompts.has(allowlistKey)) {
        continue;
      }
      matched.prompts.add(allowlistKey);
      filtered.push(asset);
    }
  }

  const missingAgents = [...allow.agents].filter((entry) => !matched.agents.has(entry));
  const missingSkills = [...allow.skills].filter((entry) => !matched.skills.has(entry));
  const missingPrompts = [...allow.prompts].filter((entry) => !matched.prompts.has(entry));
  const missing = [...missingAgents, ...missingSkills, ...missingPrompts];
  if (missing.length > 0) {
    throw new Error(`Allowlist contains items not routed by the manifest: ${missing.join(', ')}`);
  }

  return filtered;
}

function sortAssets(assets, sortMode) {
  if (sortMode !== 'type-id') {
    return assets;
  }
  return [...assets].sort((left, right) => {
    const typeOrder = stableTypeOrder(left.type) - stableTypeOrder(right.type);
    if (typeOrder !== 0) {
      return typeOrder;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });
}

function filterBundlesForAvailableAssets(bundles, availableAssetIds) {
  if (!Array.isArray(bundles)) {
    return [];
  }

  const includedBundles = [];
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== 'object') {
      continue;
    }

    const assetIds = Array.isArray(bundle.assetIds)
      ? bundle.assetIds.filter((assetId) => availableAssetIds.has(String(assetId || '')))
      : [];
    if (assetIds.length === 0) {
      continue;
    }
    includedBundles.push({
      ...cloneJson(bundle),
      assetIds,
    });
  }

  const includedBundleIds = new Set(includedBundles.map((entry) => String(entry.id || '')));
  return includedBundles.map((bundle) => ({
    ...bundle,
    dependsOn: Array.isArray(bundle.dependsOn)
      ? bundle.dependsOn.filter((bundleId) => includedBundleIds.has(String(bundleId || '')))
      : [],
  }));
}

function resolveBundles(manifestDefinition, assets) {
  const bundleIds = Array.isArray(manifestDefinition.bundleIds)
    ? manifestDefinition.bundleIds.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const bundles = bundleIds
    .map((bundleId) => getShippedBundle(bundleId))
    .filter(Boolean)
    .map((bundle) => cloneJson(bundle));
  const availableAssetIds = new Set(assets.map((asset) => String(asset.id || '')));
  return filterBundlesForAvailableAssets(bundles, availableAssetIds);
}

export function buildCompatibilityManifest(manifestId, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const manifestDefinition = resolveManifestDefinition(manifestId);
  const allow = loadAllowlist(repoRoot, manifestDefinition, options);
  enforceMandatoryAllowlistItems(allow, manifestDefinition);

  const routeAssets = resolveAssetRoutes(manifestDefinition).map(materializeAsset);
  const filteredAssets = filterAssetsByAllowlist(routeAssets, allow);
  const assets = sortAssets(filteredAssets, manifestDefinition.sortAssets);
  const bundles = resolveBundles(manifestDefinition, assets);

  return {
    schemaVersion: 1,
    package: cloneJson(manifestDefinition.package),
    installDefaults: cloneJson(manifestDefinition.installDefaults),
    ...(manifestDefinition.installerHints ? { installerHints: cloneJson(manifestDefinition.installerHints) } : {}),
    ...(manifestDefinition.skillPointer ? { skillPointer: cloneJson(manifestDefinition.skillPointer) } : {}),
    ...(manifestDefinition.governance ? { governance: cloneJson(manifestDefinition.governance) } : {}),
    ...(bundles.length > 0 ? { bundles } : {}),
    assets,
    sourcePatterns: [],
  };
}

export function writeCompatibilityManifest(manifestId, options = {}) {
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const manifestDefinition = resolveManifestDefinition(manifestId);
  const manifest = buildCompatibilityManifest(manifestId, options);
  const outputPath = path.join(repoRoot, manifestDefinition.outputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifestId,
    outputPath,
    manifest,
  };
}

export function writeCompatibilityManifests(manifestIds, options = {}) {
  return (Array.isArray(manifestIds) ? manifestIds : []).map((manifestId) =>
    writeCompatibilityManifest(manifestId, options)
  );
}

export function listCompatibilityManifestIds() {
  return COMPATIBILITY_MANIFESTS.map((entry) => entry.manifestId);
}
