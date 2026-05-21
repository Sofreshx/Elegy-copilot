#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const defaultRepoRoot = path.resolve(__dirname, '..');
const gateName = 'Repo Setup Profiles Gate';
const expectedMutationAuthority = 'copilot-ui-catalog-mutation-api';
const expectedUpdateExecution = 'gated-not-yet-enabled';
const expectedPlanningMode = 'classify-and-propose-only';
const expectedWorkspaceRoots = 'open-workspace-only';
const expectedCanonicalProfileType = 'canonical-doc-entrypoint';
const expectedOverlayProfileType = 'overlay';
const expectedSpecDrivenProfileKey = 'spec-driven';
const expectedRequiredRepoResourcePaths = [
  'README.md',
  '.github/copilot-instructions.md',
  '.github/agents',
  '.github/skills',
];
const expectedRecommendedResourcePaths = [
  '.vscode/settings.json',
  '.vscode/mcp.json',
];
const expectedSpecDrivenExtendsProfileKeys = [
  'documentation-root-index',
  'docs-root-index',
  'system-docs-index',
];
const expectedSpecDrivenRequiredResourcePaths = [
  '.github/copilot-instructions.md',
  '.github/skills',
  'specs/index.md',
];
const expectedSpecDrivenRecommendedResourcePaths = [
  'AGENTS.md',
  'GEMINI.md',
  'package.json#scripts.validate:specs',
  'scripts/validate-specs.js',
];

function toRepoPath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function readJson(filePath, repoRoot, errors) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    errors.push(`failed to parse JSON ${path.relative(repoRoot, filePath).replace(/\\/g, '/')}: ${error.message}`);
    return null;
  }
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function formatValueForError(value) {
  return value ? `'${value}'` : "'<empty>'";
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

async function loadGeneratedSetupProfiles(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const generatorModulePath = options.generatorModulePath || path.join(__dirname, 'generate-repo-setup-profiles.mjs');
  const errors = options.errors || [];

  try {
    const module = await import(pathToFileURL(generatorModulePath).href);
    if (typeof module.generateSetupProfiles !== 'function') {
      throw new Error('generateSetupProfiles export is missing');
    }
    return module.generateSetupProfiles({ write: false, repoRoot });
  } catch (error) {
    errors.push(`failed to load setup profiles generator: ${error.message}`);
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
    errors.push(`${toRepoPath(repoRoot, manifestPath)} is missing required setup profiles asset '${requiredManifestAssetId}'`);
    return;
  }

  if (requiredLoadMode && manifestAsset.loadMode !== requiredLoadMode) {
    errors.push(
      `${toRepoPath(repoRoot, manifestPath)} asset '${requiredManifestAssetId}' must use loadMode '${requiredLoadMode}'`
    );
  }
}

function getBaselineConstraints(baselineDefinition) {
  const requiredAssets = Array.isArray(baselineDefinition?.minimumAssetSet?.required)
    ? baselineDefinition.minimumAssetSet.required
    : [];
  const requiredAssetKeys = new Set(
    requiredAssets
      .map((asset) => String(asset?.key || '').trim())
      .filter(Boolean)
  );
  const canonicalDocAsset = requiredAssets.find((asset) => asset?.kind === 'one-of' && asset?.key === 'canonical-doc-entrypoint');
  const canonicalDocEntrypointPaths = new Set(
    (Array.isArray(canonicalDocAsset?.paths) ? canonicalDocAsset.paths : [])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  );

  return { requiredAssetKeys, canonicalDocEntrypointPaths };
}

function validateUniqueProfilesDocument(options) {
  const documentLabel = options.documentLabel;
  const profilesDocument = options.profilesDocument;
  const errors = options.errors;
  const profiles = Array.isArray(profilesDocument?.profiles) ? profilesDocument.profiles : [];
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  const canonicalDocPathToProfileKeys = new Map();

  for (const profile of profiles) {
    const profileKey = String(profile?.key || '').trim();
    const profileType = String(profile?.profileType || expectedCanonicalProfileType).trim();
    const canonicalDocEntrypointPath = String(profile?.match?.canonicalDocEntrypointPath || '').trim();

    if (seenKeys.has(profileKey)) {
      duplicateKeys.add(profileKey);
    } else {
      seenKeys.add(profileKey);
    }

    if (profileType === expectedCanonicalProfileType && canonicalDocEntrypointPath) {
      const profileKeys = canonicalDocPathToProfileKeys.get(canonicalDocEntrypointPath) || [];
      profileKeys.push(profileKey);
      canonicalDocPathToProfileKeys.set(canonicalDocEntrypointPath, profileKeys);
    }
  }

  for (const duplicateKey of Array.from(duplicateKeys).sort((left, right) => left.localeCompare(right))) {
    errors.push(`${documentLabel} contains duplicate profile key ${formatValueForError(duplicateKey)}`);
  }

  for (const [canonicalDocEntrypointPath, profileKeys] of Array.from(canonicalDocPathToProfileKeys.entries())
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (profileKeys.length > 1) {
      const sortedProfileKeys = [...profileKeys].sort((left, right) => left.localeCompare(right));
      errors.push(
        `${documentLabel} contains duplicate match.canonicalDocEntrypointPath ${formatValueForError(canonicalDocEntrypointPath)} for profiles ${sortedProfileKeys.map(formatValueForError).join(', ')}`
      );
    }
  }
}

function validateProfileAuthorityBoundary(options) {
  const profilesDocument = options.profilesDocument;
  const baselineDefinition = options.baselineDefinition;
  const errors = options.errors;

  const compatibility = profilesDocument?.compatibility || {};
  const profiles = Array.isArray(profilesDocument?.profiles) ? profilesDocument.profiles : [];
  const { requiredAssetKeys, canonicalDocEntrypointPaths } = getBaselineConstraints(baselineDefinition);
  const observedCanonicalDocEntrypointPaths = [];
  const canonicalProfiles = profiles.filter((profile) => String(profile?.profileType || expectedCanonicalProfileType).trim() === expectedCanonicalProfileType);
  const overlayProfiles = profiles.filter((profile) => String(profile?.profileType || expectedCanonicalProfileType).trim() === expectedOverlayProfileType);
  const canonicalProfileKeys = new Set(canonicalProfiles.map((profile) => String(profile?.key || '').trim()).filter(Boolean));

  if (compatibility.mutationAuthority !== expectedMutationAuthority) {
    errors.push(`setup-profiles.compatibility.mutationAuthority must be '${expectedMutationAuthority}'`);
  }

  if (compatibility.updateExecution !== expectedUpdateExecution) {
    errors.push(`setup-profiles.compatibility.updateExecution must be '${expectedUpdateExecution}'`);
  }

  if (canonicalDocEntrypointPaths.size === 0) {
    errors.push('baseline.definition.json must declare canonical doc entrypoint paths in the required one-of asset');
  }

  if (requiredAssetKeys.size === 0) {
    errors.push('baseline.definition.json must declare required asset keys');
  }

  for (const profile of profiles) {
    const profileKey = String(profile?.key || '<unknown-profile>');
    const profileType = String(profile?.profileType || expectedCanonicalProfileType).trim();
    const workspaceRoots = profile?.match?.workspaceRoots;
    const preferredCanonicalDocEntrypointPath = String(profile?.proposals?.preferredCanonicalDocEntrypointPath || '').trim();
    const planningMode = profile?.proposals?.planningMode;
    if (planningMode !== expectedPlanningMode) {
      errors.push(`setup-profiles profile '${profileKey}' must use proposals.planningMode '${expectedPlanningMode}'`);
    }

    const canonicalDocEntrypointPath = String(profile?.match?.canonicalDocEntrypointPath || '').trim();
    observedCanonicalDocEntrypointPaths.push(canonicalDocEntrypointPath);

    if (workspaceRoots !== expectedWorkspaceRoots) {
      errors.push(`setup-profiles profile '${profileKey}' must use match.workspaceRoots '${expectedWorkspaceRoots}'`);
    }

    if (profileType !== expectedCanonicalProfileType && profileType !== expectedOverlayProfileType) {
      errors.push(`setup-profiles profile '${profileKey}' must use profileType '${expectedCanonicalProfileType}' or '${expectedOverlayProfileType}'`);
      continue;
    }

    if (profileType === expectedCanonicalProfileType) {
      if (preferredCanonicalDocEntrypointPath !== canonicalDocEntrypointPath) {
        errors.push(
          `setup-profiles profile '${profileKey}' proposals.preferredCanonicalDocEntrypointPath must match match.canonicalDocEntrypointPath`
        );
      }

      if (canonicalDocEntrypointPath && canonicalDocEntrypointPaths.size > 0 && !canonicalDocEntrypointPaths.has(canonicalDocEntrypointPath)) {
        errors.push(
          `setup-profiles profile '${profileKey}' uses unsupported canonical doc entrypoint '${canonicalDocEntrypointPath}'`
        );
      }

      validateExactStringCollection(
        `setup-profiles profile '${profileKey}' proposals.requiredResourcePaths`,
        Array.isArray(profile?.proposals?.requiredResourcePaths) ? profile.proposals.requiredResourcePaths : [],
        [...expectedRequiredRepoResourcePaths, canonicalDocEntrypointPath],
        errors
      );
      validateExactStringCollection(
        `setup-profiles profile '${profileKey}' proposals.recommendedResourcePaths`,
        Array.isArray(profile?.proposals?.recommendedResourcePaths) ? profile.proposals.recommendedResourcePaths : [],
        expectedRecommendedResourcePaths,
        errors
      );
    } else {
      const extendsProfileKeys = Array.isArray(profile?.match?.extendsProfileKeys) ? profile.match.extendsProfileKeys : [];
      validateExactStringCollection(
        `setup-profiles overlay profile '${profileKey}' match.extendsProfileKeys`,
        extendsProfileKeys,
        expectedSpecDrivenExtendsProfileKeys,
        errors
      );
      validateExactStringCollection(
        `setup-profiles overlay profile '${profileKey}' match.requiredAssetKeys`,
        Array.isArray(profile?.match?.requiredAssetKeys) ? profile.match.requiredAssetKeys : [],
        [],
        errors
      );
      validateExactStringCollection(
        `setup-profiles overlay profile '${profileKey}' proposals.requiredResourcePaths`,
        Array.isArray(profile?.proposals?.requiredResourcePaths) ? profile.proposals.requiredResourcePaths : [],
        expectedSpecDrivenRequiredResourcePaths,
        errors
      );
      validateExactStringCollection(
        `setup-profiles overlay profile '${profileKey}' proposals.recommendedResourcePaths`,
        Array.isArray(profile?.proposals?.recommendedResourcePaths) ? profile.proposals.recommendedResourcePaths : [],
        expectedSpecDrivenRecommendedResourcePaths,
        errors
      );

      if (profileKey !== expectedSpecDrivenProfileKey) {
        errors.push(`setup-profiles overlay profile '${profileKey}' is unsupported; expected only '${expectedSpecDrivenProfileKey}'`);
      }

      if (canonicalDocEntrypointPath) {
        errors.push(`setup-profiles overlay profile '${profileKey}' must not declare match.canonicalDocEntrypointPath`);
      }

      if (preferredCanonicalDocEntrypointPath) {
        errors.push(`setup-profiles overlay profile '${profileKey}' must not declare proposals.preferredCanonicalDocEntrypointPath`);
      }

      for (const extendedProfileKey of extendsProfileKeys) {
        if (!canonicalProfileKeys.has(String(extendedProfileKey || '').trim())) {
          errors.push(`setup-profiles overlay profile '${profileKey}' extends unknown canonical profile '${extendedProfileKey}'`);
        }
      }
    }

    const profileRequiredAssetKeys = Array.isArray(profile?.match?.requiredAssetKeys) ? profile.match.requiredAssetKeys : [];
    for (const assetKey of profileRequiredAssetKeys) {
      if (!requiredAssetKeys.has(assetKey)) {
        errors.push(`setup-profiles profile '${profileKey}' uses unsupported required asset key '${assetKey}'`);
      }
    }
  }

  if (overlayProfiles.length !== 1 || String(overlayProfiles[0]?.key || '').trim() !== expectedSpecDrivenProfileKey) {
    errors.push(`setup-profiles must include exactly one overlay profile '${expectedSpecDrivenProfileKey}'`);
  }

  if (canonicalDocEntrypointPaths.size > 0) {
    validateExactStringCollection(
      'setup-profiles match.canonicalDocEntrypointPath coverage',
      observedCanonicalDocEntrypointPaths.filter(Boolean),
      Array.from(canonicalDocEntrypointPaths),
      errors
    );
  }
}

async function validateRepoSetupProfiles(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const setupProfilesPath = options.setupProfilesPath || path.join(repoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'setup-profiles.json');
  const baselineDefinitionPath = options.baselineDefinitionPath || path.join(repoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'baseline.definition.json');
  const generatorModulePath = options.generatorModulePath || path.join(__dirname, 'generate-repo-setup-profiles.mjs');
  const manifestPath = options.manifestPath || path.join(repoRoot, 'engine-assets', 'manifest.json');
  const cliManifestPath = options.cliManifestPath || path.join(repoRoot, '.cli', 'manifest.json');
  const skillMetadataIndexPath = options.skillMetadataIndexPath || path.join(repoRoot, 'engine-assets', 'skills', 'skill-metadata-index.json');
  const errors = [];

  const committedSetupProfiles = readJson(setupProfilesPath, repoRoot, errors);
  const baselineDefinition = readJson(baselineDefinitionPath, repoRoot, errors);
  const expectedSetupProfiles = await loadGeneratedSetupProfiles({ repoRoot, generatorModulePath, errors });
  const manifest = readJson(manifestPath, repoRoot, errors);
  const cliManifest = readJson(cliManifestPath, repoRoot, errors);
  const skillMetadataIndex = readJson(skillMetadataIndexPath, repoRoot, errors);

  if (committedSetupProfiles) {
    validateUniqueProfilesDocument({
      documentLabel: toRepoPath(repoRoot, setupProfilesPath),
      profilesDocument: committedSetupProfiles,
      errors,
    });
  }

  if (expectedSetupProfiles) {
    validateUniqueProfilesDocument({
      documentLabel: 'generated setup profiles projection',
      profilesDocument: expectedSetupProfiles,
      errors,
    });
  }

  if (committedSetupProfiles && expectedSetupProfiles && stringifyJson(committedSetupProfiles) !== stringifyJson(expectedSetupProfiles)) {
    errors.push(
      `${path.relative(repoRoot, setupProfilesPath).replace(/\\/g, '/')} is stale relative to profile-definitions.json. Regenerate with: node scripts/generate-repo-setup-profiles.mjs`
    );
  }

  const compatibility = expectedSetupProfiles?.compatibility || committedSetupProfiles?.compatibility || {};
  const minIndexSchemaVersion = Number(compatibility.minIndexSchemaVersion);
  if (!Number.isInteger(minIndexSchemaVersion) || minIndexSchemaVersion < 1) {
    errors.push('setup-profiles.compatibility.minIndexSchemaVersion must be an integer >= 1');
  }

  const actualIndexSchemaVersion = Number(skillMetadataIndex?.schemaVersion);
  if (!Number.isInteger(actualIndexSchemaVersion)) {
    errors.push('engine-assets/skills/skill-metadata-index.json must declare an integer schemaVersion');
  } else if (Number.isInteger(minIndexSchemaVersion) && actualIndexSchemaVersion < minIndexSchemaVersion) {
    errors.push(
      `setup-profiles.compatibility.minIndexSchemaVersion (${minIndexSchemaVersion}) exceeds engine-assets/skills/skill-metadata-index.json schemaVersion (${actualIndexSchemaVersion})`
    );
  }

  const requiredInstalledSkill = String(compatibility.requiredInstalledSkill || '').trim();
  const requiredManifestAssetId = String(compatibility.requiredManifestAssetId || '').trim();
  const requiredLoadMode = String(compatibility.requiredLoadMode || '').trim();

  if (!requiredManifestAssetId) {
    errors.push('setup-profiles.compatibility.requiredManifestAssetId must be a non-empty string');
  } else {
    validateManifestAsset({ manifest, manifestPath, repoRoot, requiredManifestAssetId, requiredLoadMode, errors });
    validateManifestAsset({ manifest: cliManifest, manifestPath: cliManifestPath, repoRoot, requiredManifestAssetId, requiredLoadMode, errors });
  }

  const skillEntries = Array.isArray(skillMetadataIndex?.entries) ? skillMetadataIndex.entries : [];
  const skillEntry = skillEntries.find((entry) => entry && entry.skill === requiredInstalledSkill);
  if (!requiredInstalledSkill) {
    errors.push('setup-profiles.compatibility.requiredInstalledSkill must be a non-empty string');
  } else if (!skillEntry) {
    errors.push(`engine-assets/skills/skill-metadata-index.json is missing required installed skill '${requiredInstalledSkill}'`);
  } else if (requiredLoadMode && skillEntry?.manifest?.loadMode !== requiredLoadMode) {
    errors.push(
      `skill metadata entry '${requiredInstalledSkill}' must report loadMode '${requiredLoadMode}'`
    );
  }

  validateProfileAuthorityBoundary({
    profilesDocument: expectedSetupProfiles || committedSetupProfiles,
    baselineDefinition,
    errors,
  });

  return {
    gateName,
    setupProfilesPath,
    errors,
  };
}

async function main() {
  const result = await validateRepoSetupProfiles();

  if (result.errors.length > 0) {
    for (const message of result.errors) {
      console.error(`${gateName} failed: ${message}`);
    }
    process.exit(1);
  }

  console.log(`${gateName} ok (${path.relative(defaultRepoRoot, result.setupProfilesPath).replace(/\\/g, '/')})`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${gateName} failed: ${error.message || String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  gateName,
  loadGeneratedSetupProfiles,
  validateRepoSetupProfiles,
};
