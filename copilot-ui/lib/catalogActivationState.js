'use strict';

const fs = require('fs');
const path = require('path');

const { getRepoStateKey } = require('./catalogProjectionService');

const ACTIVATION_STATE_SCHEMA_VERSION = 1;
const ROUTING_POLICY_SNAPSHOT_SCHEMA_VERSION = 1;
const BALANCED_DEFAULT_PROFILE_ID = 'balanced-default';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

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

function hasOwn(objectValue, key) {
  return Boolean(objectValue && typeof objectValue === 'object' && Object.prototype.hasOwnProperty.call(objectValue, key));
}

function normalizeActivationLayer(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    schemaVersion: Number(source.schemaVersion) || ACTIVATION_STATE_SCHEMA_VERSION,
    plannerProfile: normalizeString(source.plannerProfile),
    orchestrationPolicy: normalizeString(source.orchestrationPolicy),
    activeBundleIds: uniqueStrings(source.activeBundleIds),
    updatedAt: normalizeString(source.updatedAt) || null,
    repoId: normalizeString(source.repoId) || null,
    repoPath: normalizeString(source.repoPath) || null,
    hasPlannerProfile: hasOwn(source, 'plannerProfile'),
    hasOrchestrationPolicy: hasOwn(source, 'orchestrationPolicy'),
    hasActiveBundleIds: hasOwn(source, 'activeBundleIds'),
  };
}

function resolveGlobalActivationStatePath(copilotHome) {
  return path.join(path.resolve(copilotHome), 'catalog', 'activation-state.json');
}

function resolveRepoActivationStatePath(copilotHome, repoPath) {
  const repoKey = getRepoStateKey(repoPath);
  return {
    ...repoKey,
    path: path.join(path.resolve(copilotHome), 'repo-state', repoKey.repoId, 'activation.json'),
  };
}

function readActivationLayer(absPath) {
  const raw = readJsonIfExists(absPath);
  return {
    path: absPath,
    exists: raw !== null,
    state: normalizeActivationLayer(raw),
  };
}

function deriveDefaultsFromProviders(providers) {
  const defaultBundleIds = [];
  const availablePlannerProfiles = [BALANCED_DEFAULT_PROFILE_ID];
  const managedImportProviderIds = [];
  let plannerProfile = '';
  let orchestrationPolicy = '';

  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!provider || typeof provider !== 'object') {
      continue;
    }

    if (normalizeString(provider.installStrategy) === 'managed-import' && normalizeString(provider.providerId)) {
      managedImportProviderIds.push(normalizeString(provider.providerId));
    }

    const activationDefaults =
      provider.activationDefaults && typeof provider.activationDefaults === 'object'
        ? provider.activationDefaults
        : null;

    if (activationDefaults) {
      if (!plannerProfile) {
        plannerProfile = normalizeString(activationDefaults.plannerProfile);
      }
      if (!orchestrationPolicy) {
        orchestrationPolicy = normalizeString(activationDefaults.orchestrationPolicy);
      }
      if (normalizeString(activationDefaults.plannerProfile)) {
        availablePlannerProfiles.push(normalizeString(activationDefaults.plannerProfile));
      }
      if (Array.isArray(activationDefaults.defaultBundles)) {
        defaultBundleIds.push(...activationDefaults.defaultBundles);
      }
    }

    if (Array.isArray(provider.defaultBundles)) {
      defaultBundleIds.push(...provider.defaultBundles);
    }
  }

  return {
    plannerProfile: plannerProfile || BALANCED_DEFAULT_PROFILE_ID,
    orchestrationPolicy: orchestrationPolicy || plannerProfile || BALANCED_DEFAULT_PROFILE_ID,
    defaultBundleIds: uniqueStrings(defaultBundleIds),
    availablePlannerProfiles: uniqueStrings(availablePlannerProfiles),
    managedImportProviderIds: uniqueStrings(managedImportProviderIds),
  };
}

function deriveDefaultsFromSnapshot(snapshot) {
  const bundles = Array.isArray(snapshot?.bundles) ? snapshot.bundles : [];
  const providerDefaults = deriveDefaultsFromProviders(snapshot?.providers);
  const availableBundleIds = uniqueStrings(bundles.map((bundle) => bundle?.bundleId));
  const defaultBundleIds = providerDefaults.defaultBundleIds.length > 0
    ? providerDefaults.defaultBundleIds
    : uniqueStrings(
      bundles
        .filter((bundle) => bundle?.defaultRecommended)
        .map((bundle) => bundle?.bundleId)
    );

  return {
    plannerProfile: providerDefaults.plannerProfile,
    orchestrationPolicy: providerDefaults.orchestrationPolicy,
    activeBundleIds: defaultBundleIds.filter((bundleId) => availableBundleIds.includes(bundleId)),
    availableBundleIds,
    availablePlannerProfiles: providerDefaults.availablePlannerProfiles,
    managedImportProviderIds: providerDefaults.managedImportProviderIds,
  };
}

function deriveDefaultsFromEngineRoot(engineRoot) {
  const engineRootAbs = path.resolve(engineRoot);
  const manifest = readJsonIfExists(path.join(engineRootAbs, 'engine-assets', 'manifest.json'));
  const providerCatalog = readJsonIfExists(path.join(engineRootAbs, 'engine-assets', 'providers.json'));
  const manifestBundles = Array.isArray(manifest?.bundles) ? manifest.bundles : [];
  const availableBundleIds = uniqueStrings(
    manifestBundles.map((bundle) => bundle?.id || bundle?.bundleId)
  );
  const providerDefaults = deriveDefaultsFromProviders(providerCatalog?.providers);
  const defaultBundleIds = providerDefaults.defaultBundleIds.length > 0
    ? providerDefaults.defaultBundleIds
    : uniqueStrings(
      manifestBundles
        .filter((bundle) => bundle?.defaultRecommended)
        .map((bundle) => bundle?.id || bundle?.bundleId)
    );

  return {
    plannerProfile: providerDefaults.plannerProfile,
    orchestrationPolicy: providerDefaults.orchestrationPolicy,
    activeBundleIds: defaultBundleIds.filter((bundleId) => availableBundleIds.includes(bundleId)),
    availableBundleIds,
    availablePlannerProfiles: providerDefaults.availablePlannerProfiles,
    managedImportProviderIds: providerDefaults.managedImportProviderIds,
  };
}

function filterToAvailableBundleIds(bundleIds, availableBundleIds) {
  if (!Array.isArray(availableBundleIds) || availableBundleIds.length === 0) {
    return uniqueStrings(bundleIds);
  }
  const available = new Set(uniqueStrings(availableBundleIds));
  return uniqueStrings(bundleIds).filter((bundleId) => available.has(bundleId));
}

function chooseLayerBundleIds(layer, fallbackBundleIds, availableBundleIds) {
  if (layer.hasActiveBundleIds) {
    return filterToAvailableBundleIds(layer.activeBundleIds, availableBundleIds);
  }
  return filterToAvailableBundleIds(fallbackBundleIds, availableBundleIds);
}

function resolveCatalogActivationState(options = {}) {
  const defaults = options.snapshot
    ? deriveDefaultsFromSnapshot(options.snapshot)
    : deriveDefaultsFromEngineRoot(options.engineRoot);
  const globalLayer = readActivationLayer(resolveGlobalActivationStatePath(options.copilotHome));
  const repoLayer = normalizeString(options.repoPath)
    ? readActivationLayer(resolveRepoActivationStatePath(options.copilotHome, options.repoPath).path)
    : null;

  const globalPlannerProfile = globalLayer.state.hasPlannerProfile
    ? (globalLayer.state.plannerProfile || defaults.plannerProfile)
    : defaults.plannerProfile;
  const globalOrchestrationPolicy = globalLayer.state.hasOrchestrationPolicy
    ? (globalLayer.state.orchestrationPolicy || globalPlannerProfile || defaults.orchestrationPolicy)
    : (globalLayer.state.hasPlannerProfile ? (globalPlannerProfile || defaults.orchestrationPolicy) : defaults.orchestrationPolicy);
  const globalActiveBundleIds = chooseLayerBundleIds(globalLayer.state, defaults.activeBundleIds, defaults.availableBundleIds);

  const effectivePlannerProfile = repoLayer?.state.hasPlannerProfile
    ? (repoLayer.state.plannerProfile || globalPlannerProfile)
    : globalPlannerProfile;
  const effectiveOrchestrationPolicy = repoLayer?.state.hasOrchestrationPolicy
    ? (repoLayer.state.orchestrationPolicy || effectivePlannerProfile || globalOrchestrationPolicy)
    : (repoLayer?.state.hasPlannerProfile ? (effectivePlannerProfile || globalOrchestrationPolicy) : globalOrchestrationPolicy);
  const effectiveActiveBundleIds = repoLayer
    ? chooseLayerBundleIds(repoLayer.state, globalActiveBundleIds, defaults.availableBundleIds)
    : globalActiveBundleIds;
  const availablePlannerProfiles = uniqueStrings([
    ...defaults.availablePlannerProfiles,
    globalPlannerProfile,
    effectivePlannerProfile,
    repoLayer?.state.plannerProfile,
  ]);
  const hasRepoOverride = Boolean(
    repoLayer && (
      repoLayer.state.hasPlannerProfile ||
      repoLayer.state.hasOrchestrationPolicy ||
      repoLayer.state.hasActiveBundleIds
    )
  );

  return {
    schemaVersion: ACTIVATION_STATE_SCHEMA_VERSION,
    plannerProfile: effectivePlannerProfile || BALANCED_DEFAULT_PROFILE_ID,
    plannerProfileSource: repoLayer?.state.hasPlannerProfile ? 'repo-override' : globalLayer.state.hasPlannerProfile ? 'user-global' : 'provider-defaults',
    orchestrationPolicy: effectiveOrchestrationPolicy || effectivePlannerProfile || BALANCED_DEFAULT_PROFILE_ID,
    orchestrationPolicySource: repoLayer?.state.hasOrchestrationPolicy
      ? 'repo-override'
      : repoLayer?.state.hasPlannerProfile
        ? 'repo-override'
        : globalLayer.state.hasOrchestrationPolicy || globalLayer.state.hasPlannerProfile
          ? 'user-global'
          : 'provider-defaults',
    activeBundleIds: effectiveActiveBundleIds,
    bundleSource: repoLayer?.state.hasActiveBundleIds ? 'repo-override' : globalLayer.state.hasActiveBundleIds ? 'user-global' : 'provider-defaults',
    availableBundleIds: defaults.availableBundleIds,
    availablePlannerProfiles,
    managedImportProviderIds: defaults.managedImportProviderIds,
    globalDefaults: {
      exists: globalLayer.exists,
      path: globalLayer.path,
      plannerProfile: globalPlannerProfile || BALANCED_DEFAULT_PROFILE_ID,
      orchestrationPolicy: globalOrchestrationPolicy || globalPlannerProfile || BALANCED_DEFAULT_PROFILE_ID,
      activeBundleIds: globalActiveBundleIds,
      updatedAt: globalLayer.state.updatedAt,
    },
    repoOverride: repoLayer
      ? {
        exists: repoLayer.exists,
        active: hasRepoOverride,
        path: repoLayer.path,
        plannerProfile: repoLayer.state.hasPlannerProfile ? repoLayer.state.plannerProfile : null,
        orchestrationPolicy: repoLayer.state.hasOrchestrationPolicy ? repoLayer.state.orchestrationPolicy : null,
        activeBundleIds: repoLayer.state.hasActiveBundleIds ? repoLayer.state.activeBundleIds : null,
        updatedAt: repoLayer.state.updatedAt,
      }
      : null,
  };
}

function applyActivationToBundles(bundles, activationState) {
  const activeBundleIds = new Set(uniqueStrings(activationState?.activeBundleIds));
  return (Array.isArray(bundles) ? bundles : []).map((bundle) => {
    const bundleId = normalizeString(bundle?.bundleId);
    const selected = Boolean(bundleId && activeBundleIds.has(bundleId));
    return {
      ...bundle,
      selected,
      activationStatus: selected ? 'active' : 'inactive',
      activationSource: selected ? activationState?.bundleSource || 'provider-defaults' : null,
    };
  });
}

function buildBundleMembershipIndex(snapshot) {
  const index = new Map();
  for (const bundle of Array.isArray(snapshot?.bundles) ? snapshot.bundles : []) {
    const bundleId = normalizeString(bundle?.bundleId);
    if (!bundleId) {
      continue;
    }
    for (const assetId of uniqueStrings(bundle?.assetIds)) {
      if (!index.has(assetId)) {
        index.set(assetId, new Set());
      }
      index.get(assetId).add(bundleId);
    }
  }
  return index;
}

function collectAssetBundleIds(asset, bundleMembershipIndex, availableBundleIds) {
  const bundleIds = new Set(
    Array.from(bundleMembershipIndex.get(normalizeString(asset?.assetId)) || [])
  );
  const activation = asset?.activation && typeof asset.activation === 'object'
    ? asset.activation
    : asset?.selectedEntry?.activation && typeof asset.selectedEntry.activation === 'object'
      ? asset.selectedEntry.activation
      : null;
  const allowedBundleIds = new Set(uniqueStrings(availableBundleIds));

  for (const bundleId of uniqueStrings(activation?.defaultBundles)) {
    if (allowedBundleIds.size > 0 && !allowedBundleIds.has(bundleId)) {
      continue;
    }
    bundleIds.add(bundleId);
  }

  return Array.from(bundleIds).sort((left, right) => left.localeCompare(right));
}

function assetMatchesRoutingProfile(asset, activationState) {
  const activation = asset?.activation && typeof asset.activation === 'object'
    ? asset.activation
    : asset?.selectedEntry?.activation && typeof asset.selectedEntry.activation === 'object'
      ? asset.selectedEntry.activation
      : null;
  if (!activation) {
    return true;
  }
  if (activation.eligible === false) {
    return false;
  }

  const currentProfile = normalizeString(activationState?.plannerProfile || activationState?.orchestrationPolicy);
  const requiredProfiles = uniqueStrings([
    activation.plannerProfile,
    activation.orchestrationPolicy,
  ]);
  if (requiredProfiles.length === 0) {
    return true;
  }
  if (!currentProfile) {
    return false;
  }
  return requiredProfiles.includes(currentProfile);
}

function isAssetEligibleForDefaultRouting(asset, activationState, bundleMembershipIndex) {
  if (!asset || typeof asset !== 'object') {
    return false;
  }
  if (!asset.available || !asset.installed || asset.enabled === false) {
    return false;
  }
  if (!assetMatchesRoutingProfile(asset, activationState)) {
    return false;
  }

  const activeBundleIds = new Set(uniqueStrings(activationState?.activeBundleIds));
  if (activeBundleIds.size === 0) {
    return false;
  }

  const bundleIds = collectAssetBundleIds(
    asset,
    bundleMembershipIndex,
    activationState?.availableBundleIds,
  );
  if (bundleIds.length === 0) {
    return false;
  }

  return bundleIds.some((bundleId) => activeBundleIds.has(bundleId));
}

function buildRoutingPolicySnapshot(options = {}) {
  const snapshot = options.snapshot || null;
  const activationState = options.activationState || resolveCatalogActivationState(options);
  const bundleMembershipIndex = buildBundleMembershipIndex(snapshot);
  const effectiveAssets = Array.isArray(snapshot?.effectiveAssets) ? snapshot.effectiveAssets : [];
  const eligibleAssets = effectiveAssets
    .filter((asset) => isAssetEligibleForDefaultRouting(asset, activationState, bundleMembershipIndex))
    .sort((left, right) => String(left?.assetId || '').localeCompare(String(right?.assetId || '')));

  return {
    schemaVersion: ROUTING_POLICY_SNAPSHOT_SCHEMA_VERSION,
    profile: activationState?.plannerProfile || BALANCED_DEFAULT_PROFILE_ID,
    orchestrationPolicy:
      activationState?.orchestrationPolicy ||
      activationState?.plannerProfile ||
      BALANCED_DEFAULT_PROFILE_ID,
    activeBundleIds: uniqueStrings(activationState?.activeBundleIds),
    repoOverride: Boolean(activationState?.repoOverride?.active),
    bundleSource: activationState?.bundleSource || 'provider-defaults',
    plannerProfileSource: activationState?.plannerProfileSource || 'provider-defaults',
    eligibleAssetIds: eligibleAssets.map((asset) => asset.assetId),
    eligibleCapabilityFamilies: uniqueStrings(eligibleAssets.map((asset) => asset.kind)),
    managedImportProviderIds: uniqueStrings(activationState?.managedImportProviderIds),
    failClosed: true,
  };
}

function buildActivationStateDocument(input = {}) {
  const plannerProfile = normalizeString(input.plannerProfile);
  const orchestrationPolicy = normalizeString(input.orchestrationPolicy);
  const document = {
    schemaVersion: ACTIVATION_STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };

  if (plannerProfile) {
    document.plannerProfile = plannerProfile;
  }
  if (orchestrationPolicy) {
    document.orchestrationPolicy = orchestrationPolicy;
  }
  if (hasOwn(input, 'activeBundleIds')) {
    document.activeBundleIds = uniqueStrings(input.activeBundleIds);
  }
  if (normalizeString(input.repoId)) {
    document.repoId = normalizeString(input.repoId);
  }
  if (normalizeString(input.repoPath)) {
    document.repoPath = normalizeString(input.repoPath);
  }

  return document;
}

module.exports = {
  ACTIVATION_STATE_SCHEMA_VERSION,
  BALANCED_DEFAULT_PROFILE_ID,
  ROUTING_POLICY_SNAPSHOT_SCHEMA_VERSION,
  applyActivationToBundles,
  buildBundleMembershipIndex,
  buildRoutingPolicySnapshot,
  buildActivationStateDocument,
  collectAssetBundleIds,
  deriveDefaultsFromEngineRoot,
  deriveDefaultsFromSnapshot,
  isAssetEligibleForDefaultRouting,
  normalizeActivationLayer,
  resolveCatalogActivationState,
  resolveGlobalActivationStatePath,
  resolveRepoActivationStatePath,
};
