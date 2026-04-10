#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const defaultRepoRoot = path.resolve(__dirname, '..');
const gateName = 'Repo Setup Baseline Gate';
const shippedLaneBundleId = 'repo-setup-governance-global';
const shippedLaneAssetIds = ['agent-repo-setup-governor', 'skill-repo-setup-governance'];
const shippedLaneBundleContract = {
  installTarget: 'user-global',
  activationScope: 'global',
  materialization: 'on-demand',
  classification: 'workflow',
  defaultRecommended: false,
};
const expectedRequiredAssetKeys = [
  'repo-readme',
  'repo-copilot-instructions',
  'repo-agents-directory',
  'repo-skills-directory',
  'canonical-doc-entrypoint',
];
const expectedRecommendedAssetKeys = [
  'workspace-settings',
  'workspace-mcp-config',
];
const expectedCanonicalDocEntrypointPaths = [
  'docs/system/index.md',
  'docs/index.md',
  'documentation/index.md',
];
const expectedTargetRepoContract = {
  workspaceRoots: 'open-workspace-only',
  explicitRootSelectionRequiredWhenMultiple: true,
  cwdInference: false,
};

function toRepoPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function readJson(filePath, repoRoot, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`failed to parse JSON ${path.relative(repoRoot, filePath)}: ${error.message}`);
    return null;
  }
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatListForError(values) {
  return `[${values.map((value) => `'${value}'`).join(', ')}]`;
}

function normalizeStringCollection(values) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function validateExactStringCollection(label, actualValues, expectedValues, errors) {
  const actual = normalizeStringCollection(actualValues);
  const expected = normalizeStringCollection(expectedValues);

  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    errors.push(`${label} must be exactly ${formatListForError(expected)} (actual: ${formatListForError(actual)})`);
  }
}

function validateBaselineDefinitionPolicy(options) {
  const baselineDefinition = options.baselineDefinition;
  const baselineDefinitionPath = options.baselineDefinitionPath;
  const repoRoot = options.repoRoot;
  const errors = options.errors;
  const definitionLabel = toRepoPath(repoRoot, baselineDefinitionPath);
  const requiredAssets = Array.isArray(baselineDefinition?.minimumAssetSet?.required)
    ? baselineDefinition.minimumAssetSet.required
    : [];
  const recommendedAssets = Array.isArray(baselineDefinition?.minimumAssetSet?.recommended)
    ? baselineDefinition.minimumAssetSet.recommended
    : [];

  validateExactStringCollection(
    `${definitionLabel} minimumAssetSet.required keys`,
    requiredAssets.map((asset) => asset?.key),
    expectedRequiredAssetKeys,
    errors
  );
  validateExactStringCollection(
    `${definitionLabel} minimumAssetSet.recommended keys`,
    recommendedAssets.map((asset) => asset?.key),
    expectedRecommendedAssetKeys,
    errors
  );

  const canonicalDocAssets = requiredAssets.filter((asset) => String(asset?.key || '').trim() === 'canonical-doc-entrypoint');
  if (canonicalDocAssets.length !== 1) {
    errors.push(`${definitionLabel} must declare exactly one required asset with key 'canonical-doc-entrypoint'`);
  } else {
    const [canonicalDocAsset] = canonicalDocAssets;
    if (canonicalDocAsset?.kind !== 'one-of') {
      errors.push(`${definitionLabel} required asset 'canonical-doc-entrypoint' must use kind 'one-of'`);
    }

    validateExactStringCollection(
      `${definitionLabel} required asset 'canonical-doc-entrypoint' paths`,
      Array.isArray(canonicalDocAsset?.paths) ? canonicalDocAsset.paths : [],
      expectedCanonicalDocEntrypointPaths,
      errors
    );
  }

  const targetRepoContract = baselineDefinition?.targetRepoContract || {};
  for (const [fieldName, expectedValue] of Object.entries(expectedTargetRepoContract)) {
    if (targetRepoContract?.[fieldName] !== expectedValue) {
      errors.push(`${definitionLabel} targetRepoContract.${fieldName} must be ${JSON.stringify(expectedValue)}`);
    }
  }
}

async function loadGeneratedBaseline(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const generatorModulePath = options.generatorModulePath || path.join(__dirname, 'generate-repo-setup-baseline.mjs');
  const errors = options.errors || [];

  try {
    const module = await import(pathToFileURL(generatorModulePath).href);
    if (typeof module.generateBaseline !== 'function') {
      throw new Error('generateBaseline export is missing');
    }
    return module.generateBaseline({ write: false, repoRoot });
  } catch (error) {
    errors.push(`failed to load baseline generator: ${error.message}`);
    return null;
  }
}

function validateManifestAsset(options) {
  const manifest = options.manifest;
  const manifestPath = options.manifestPath;
  const repoRoot = options.repoRoot;
  const requiredManifestAssetId = options.requiredManifestAssetId;
  const requiredLoadMode = options.requiredLoadMode;
  const errors = options.errors;

  const manifestAssets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const manifestAsset = manifestAssets.find((asset) => asset && asset.id === requiredManifestAssetId);

  if (!manifestAsset) {
    errors.push(`${toRepoPath(repoRoot, manifestPath)} is missing required baseline asset '${requiredManifestAssetId}'`);
    return;
  }

  if (requiredLoadMode && manifestAsset.loadMode !== requiredLoadMode) {
    errors.push(
      `${toRepoPath(repoRoot, manifestPath)} asset '${requiredManifestAssetId}' must use loadMode '${requiredLoadMode}'`
    );
  }
}

function validateShippedLaneManifest(options) {
  const manifest = options.manifest;
  const manifestPath = options.manifestPath;
  const repoRoot = options.repoRoot;
  const errors = options.errors;

  const manifestPathLabel = toRepoPath(repoRoot, manifestPath);
  const manifestAssets = Array.isArray(manifest?.assets) ? manifest.assets : [];
  const manifestBundles = Array.isArray(manifest?.bundles) ? manifest.bundles : [];

  for (const assetId of shippedLaneAssetIds) {
    if (!manifestAssets.some((asset) => asset && asset.id === assetId)) {
      errors.push(`${manifestPathLabel} is missing shipped repo-setup lane asset '${assetId}'`);
    }
  }

  const shippedLaneBundle = manifestBundles.find((bundle) => bundle && bundle.id === shippedLaneBundleId);
  if (!shippedLaneBundle) {
    errors.push(`${manifestPathLabel} is missing shipped repo-setup lane bundle '${shippedLaneBundleId}'`);
    return;
  }

  const bundleAssetIds = Array.isArray(shippedLaneBundle.assetIds) ? shippedLaneBundle.assetIds : [];
  for (const assetId of shippedLaneAssetIds) {
    if (!bundleAssetIds.includes(assetId)) {
      errors.push(`${manifestPathLabel} bundle '${shippedLaneBundleId}' must include asset '${assetId}'`);
    }
  }

  const actualAssetIds = bundleAssetIds
    .map((assetId) => String(assetId || '').trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
  const expectedAssetIds = [...shippedLaneAssetIds].sort((left, right) => left.localeCompare(right));

  if (
    actualAssetIds.length !== expectedAssetIds.length
    || actualAssetIds.some((assetId, index) => assetId !== expectedAssetIds[index])
  ) {
    errors.push(
      `${manifestPathLabel} bundle '${shippedLaneBundleId}' must declare exactly assetIds ${formatListForError(expectedAssetIds)} (actual: ${formatListForError(actualAssetIds)})`
    );
  }

  for (const [fieldName, expectedValue] of Object.entries(shippedLaneBundleContract)) {
    if (shippedLaneBundle?.[fieldName] !== expectedValue) {
      errors.push(
        `${manifestPathLabel} bundle '${shippedLaneBundleId}' must use ${fieldName} ${JSON.stringify(expectedValue)}`
      );
    }
  }
}

async function validateRepoSetupBaseline(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const baselinePath = options.baselinePath || path.join(repoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'baseline.json');
  const baselineDefinitionPath = options.baselineDefinitionPath || path.join(repoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'baseline.definition.json');
  const generatorModulePath = options.generatorModulePath || path.join(__dirname, 'generate-repo-setup-baseline.mjs');
  const manifestPath = options.manifestPath || path.join(repoRoot, 'engine-assets', 'manifest.json');
  const cliManifestPath = options.cliManifestPath || path.join(repoRoot, '.cli', 'manifest.json');
  const skillMetadataIndexPath = options.skillMetadataIndexPath || path.join(repoRoot, 'engine-assets', 'skills', 'skill-metadata-index.json');
  const errors = [];

  const committedBaseline = readJson(baselinePath, repoRoot, errors);
  const baselineDefinition = readJson(baselineDefinitionPath, repoRoot, errors);
  const expectedBaseline = await loadGeneratedBaseline({ repoRoot, generatorModulePath, errors });
  const manifest = readJson(manifestPath, repoRoot, errors);
  const cliManifest = readJson(cliManifestPath, repoRoot, errors);
  const skillMetadataIndex = readJson(skillMetadataIndexPath, repoRoot, errors);

  if (baselineDefinition) {
    validateBaselineDefinitionPolicy({ baselineDefinition, baselineDefinitionPath, repoRoot, errors });
  }

  if (committedBaseline && expectedBaseline && stringifyJson(committedBaseline) !== stringifyJson(expectedBaseline)) {
    errors.push(
      `${path.relative(repoRoot, baselinePath)} is stale relative to baseline.definition.json. Regenerate with: node scripts/generate-repo-setup-baseline.mjs`
    );
  }

  const compatibility = expectedBaseline?.compatibility || committedBaseline?.compatibility || {};
  const minIndexSchemaVersion = Number(compatibility.minIndexSchemaVersion);
  if (!Number.isInteger(minIndexSchemaVersion) || minIndexSchemaVersion < 1) {
    errors.push('baseline.compatibility.minIndexSchemaVersion must be an integer >= 1');
  }

  const actualIndexSchemaVersion = Number(skillMetadataIndex?.schemaVersion);
  if (!Number.isInteger(actualIndexSchemaVersion)) {
    errors.push('engine-assets/skills/skill-metadata-index.json must declare an integer schemaVersion');
  } else if (Number.isInteger(minIndexSchemaVersion) && actualIndexSchemaVersion < minIndexSchemaVersion) {
    errors.push(
      `baseline.compatibility.minIndexSchemaVersion (${minIndexSchemaVersion}) exceeds engine-assets/skills/skill-metadata-index.json schemaVersion (${actualIndexSchemaVersion})`
    );
  }

  const requiredInstalledSkill = String(compatibility.requiredInstalledSkill || '').trim();
  const requiredManifestAssetId = String(compatibility.requiredManifestAssetId || '').trim();
  const requiredLoadMode = String(compatibility.requiredLoadMode || '').trim();

  if (!requiredManifestAssetId) {
    errors.push('baseline.compatibility.requiredManifestAssetId must be a non-empty string');
  } else {
    validateManifestAsset({ manifest, manifestPath, repoRoot, requiredManifestAssetId, requiredLoadMode, errors });
    validateManifestAsset({ manifest: cliManifest, manifestPath: cliManifestPath, repoRoot, requiredManifestAssetId, requiredLoadMode, errors });
  }

  validateShippedLaneManifest({ manifest, manifestPath, repoRoot, errors });
  validateShippedLaneManifest({ manifest: cliManifest, manifestPath: cliManifestPath, repoRoot, errors });

  const skillEntries = Array.isArray(skillMetadataIndex?.entries) ? skillMetadataIndex.entries : [];
  const skillEntry = skillEntries.find((entry) => entry && entry.skill === requiredInstalledSkill);
  if (!requiredInstalledSkill) {
    errors.push('baseline.compatibility.requiredInstalledSkill must be a non-empty string');
  } else if (!skillEntry) {
    errors.push(`engine-assets/skills/skill-metadata-index.json is missing required installed skill '${requiredInstalledSkill}'`);
  } else if (requiredLoadMode && skillEntry?.manifest?.loadMode !== requiredLoadMode) {
    errors.push(
      `skill metadata entry '${requiredInstalledSkill}' must report loadMode '${requiredLoadMode}'`
    );
  }

  return {
    gateName,
    baselinePath,
    errors,
  };
}

async function main() {
  const result = await validateRepoSetupBaseline();

  if (result.errors.length > 0) {
    for (const message of result.errors) {
      console.error(`${gateName} failed: ${message}`);
    }
    process.exit(1);
  }

  console.log(`${gateName} ok (${path.relative(defaultRepoRoot, result.baselinePath).replace(/\\/g, '/')})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${gateName} failed: ${error.message || String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  gateName,
  loadGeneratedBaseline,
  validateRepoSetupBaseline,
};