#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultDefinitionPath = path.join(defaultRepoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'profile-definitions.json');
const defaultOutputPath = path.join(defaultRepoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'setup-profiles.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = stableSortValue(value[key]);
      return result;
    }, {});
}

function stringifyDeterministic(value) {
  return JSON.stringify(stableSortValue(value), null, 2);
}

function normalizeStringList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeProfile(profile) {
  return {
    key: String(profile.key || '').trim(),
    label: String(profile.label || '').trim(),
    match: {
      canonicalDocEntrypointPath: String(profile.match?.canonicalDocEntrypointPath || '').trim(),
      requiredAssetKeys: normalizeStringList(profile.match?.requiredAssetKeys),
      workspaceRoots: String(profile.match?.workspaceRoots || '').trim(),
    },
    proposals: {
      preferredCanonicalDocEntrypointPath: String(profile.proposals?.preferredCanonicalDocEntrypointPath || '').trim(),
      requiredResourcePaths: normalizeStringList(profile.proposals?.requiredResourcePaths),
      recommendedResourcePaths: normalizeStringList(profile.proposals?.recommendedResourcePaths),
      planningMode: String(profile.proposals?.planningMode || '').trim(),
    },
  };
}

function normalizeProfiles(profiles) {
  return (Array.isArray(profiles) ? profiles : [])
    .map(normalizeProfile)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function formatValueForError(value) {
  return value ? `'${value}'` : "'<empty>'";
}

function validateNormalizedProfiles(profiles) {
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  const canonicalDocPathToProfileKeys = new Map();

  for (const profile of profiles) {
    const profileKey = String(profile?.key || '').trim();
    const canonicalDocEntrypointPath = String(profile?.match?.canonicalDocEntrypointPath || '').trim();

    if (seenKeys.has(profileKey)) {
      duplicateKeys.add(profileKey);
    } else {
      seenKeys.add(profileKey);
    }

    const profileKeys = canonicalDocPathToProfileKeys.get(canonicalDocEntrypointPath) || [];
    profileKeys.push(profileKey);
    canonicalDocPathToProfileKeys.set(canonicalDocEntrypointPath, profileKeys);
  }

  const errors = [];

  for (const duplicateKey of Array.from(duplicateKeys).sort((left, right) => left.localeCompare(right))) {
    errors.push(`duplicate normalized profile key ${formatValueForError(duplicateKey)}`);
  }

  for (const [canonicalDocEntrypointPath, profileKeys] of Array.from(canonicalDocPathToProfileKeys.entries())
    .sort(([left], [right]) => left.localeCompare(right))) {
    if (profileKeys.length > 1) {
      const sortedProfileKeys = [...profileKeys].sort((left, right) => left.localeCompare(right));
      errors.push(
        `duplicate normalized canonical doc entrypoint path ${formatValueForError(canonicalDocEntrypointPath)} used by profiles ${sortedProfileKeys.map(formatValueForError).join(', ')}`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

export function buildSetupProfilesProjection(definition, options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const definitionPath = options.definitionPath || defaultDefinitionPath;
  const definitionRelativePath = path.relative(repoRoot, definitionPath).replace(/\\/g, '/');
  const normalizedDefinition = {
    schemaVersion: Number(definition.schemaVersion || 0),
    profileSetKey: String(definition.profileSetKey || '').trim(),
    profileSetVersion: String(definition.profileSetVersion || '').trim(),
    slice: String(definition.slice || '').trim(),
    authority: {
      canonicalDocPath: String(definition.authority?.canonicalDocPath || '').trim(),
      definitionPath: String(definition.authority?.definitionPath || '').trim(),
      projectionPath: String(definition.authority?.projectionPath || '').trim(),
    },
    compatibility: {
      minIndexSchemaVersion: Number(definition.compatibility?.minIndexSchemaVersion || 0),
      requiredInstalledSkill: String(definition.compatibility?.requiredInstalledSkill || '').trim(),
      requiredManifestAssetId: String(definition.compatibility?.requiredManifestAssetId || '').trim(),
      requiredLoadMode: String(definition.compatibility?.requiredLoadMode || '').trim(),
      mutationAuthority: String(definition.compatibility?.mutationAuthority || '').trim(),
      updateExecution: String(definition.compatibility?.updateExecution || '').trim(),
    },
    profiles: normalizeProfiles(definition.profiles),
  };

  validateNormalizedProfiles(normalizedDefinition.profiles);

  const definitionJson = stringifyDeterministic(normalizedDefinition);
  const checksum = `sha256:${crypto.createHash('sha256').update(definitionJson).digest('hex')}`;
  const profileLookup = normalizedDefinition.profiles.reduce((result, profile) => {
    result[profile.match.canonicalDocEntrypointPath] = profile.key;
    return result;
  }, {});

  return {
    schemaVersion: 1,
    profileSetKey: normalizedDefinition.profileSetKey,
    profileSetVersion: normalizedDefinition.profileSetVersion,
    slice: normalizedDefinition.slice,
    authority: normalizedDefinition.authority,
    compatibility: normalizedDefinition.compatibility,
    source: {
      definitionPath: definitionRelativePath,
      sourceRevision: checksum,
      checksum,
    },
    profiles: normalizedDefinition.profiles,
    profileLookup: {
      byCanonicalDocEntrypoint: profileLookup,
    },
  };
}

export function generateSetupProfiles(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const definitionPath = options.definitionPath || defaultDefinitionPath;
  const outputPath = options.outputPath || defaultOutputPath;
  const write = options.write !== false;

  const definition = readJson(definitionPath);
  const projection = buildSetupProfilesProjection(definition, { repoRoot, definitionPath });

  if (write) {
    fs.writeFileSync(outputPath, `${JSON.stringify(projection, null, 2)}\n`, 'utf8');
  }

  return projection;
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  const projection = generateSetupProfiles();
  console.log(`Generated repo setup profiles: ${path.relative(defaultRepoRoot, defaultOutputPath).replace(/\\/g, '/')} (${projection.source.sourceRevision})`);
}