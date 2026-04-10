#!/usr/bin/env node
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultDefinitionPath = path.join(defaultRepoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'baseline.definition.json');
const defaultOutputPath = path.join(defaultRepoRoot, 'engine-assets', 'skills', 'repo-setup-governance', 'baseline.json');

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

function normalizePathList(paths) {
  return Array.from(new Set((Array.isArray(paths) ? paths : []).map((value) => String(value).trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeAsset(entry) {
  return {
    key: String(entry.key || '').trim(),
    kind: String(entry.kind || '').trim(),
    paths: normalizePathList(entry.paths),
    reason: String(entry.reason || '').trim(),
  };
}

function normalizeAssetList(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeAsset)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function buildBaselineProjection(definition, options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const definitionPath = options.definitionPath || defaultDefinitionPath;
  const definitionRelativePath = path.relative(repoRoot, definitionPath).replace(/\\/g, '/');
  const normalizedDefinition = {
    schemaVersion: Number(definition.schemaVersion || 0),
    baselineKey: String(definition.baselineKey || '').trim(),
    baselineVersion: String(definition.baselineVersion || '').trim(),
    slice: String(definition.slice || '').trim(),
    mode: String(definition.mode || '').trim(),
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
      updateExecution: String(definition.compatibility?.updateExecution || '').trim(),
    },
    targetRepoContract: {
      workspaceRoots: String(definition.targetRepoContract?.workspaceRoots || '').trim(),
      explicitRootSelectionRequiredWhenMultiple: Boolean(definition.targetRepoContract?.explicitRootSelectionRequiredWhenMultiple),
      cwdInference: Boolean(definition.targetRepoContract?.cwdInference),
    },
    auditOutcomePolicy: {
      defaultMode: String(definition.auditOutcomePolicy?.defaultMode || '').trim(),
      missing: String(definition.auditOutcomePolicy?.missing || '').trim(),
      stale: String(definition.auditOutcomePolicy?.stale || '').trim(),
      unknown: String(definition.auditOutcomePolicy?.unknown || '').trim(),
      conflict: String(definition.auditOutcomePolicy?.conflict || '').trim(),
    },
    minimumAssetSet: {
      required: normalizeAssetList(definition.minimumAssetSet?.required),
      recommended: normalizeAssetList(definition.minimumAssetSet?.recommended),
    },
  };

  const definitionJson = stringifyDeterministic(normalizedDefinition);
  const checksum = `sha256:${crypto.createHash('sha256').update(definitionJson).digest('hex')}`;

  return {
    schemaVersion: 1,
    baselineKey: normalizedDefinition.baselineKey,
    baselineVersion: normalizedDefinition.baselineVersion,
    slice: normalizedDefinition.slice,
    mode: normalizedDefinition.mode,
    authority: normalizedDefinition.authority,
    compatibility: normalizedDefinition.compatibility,
    source: {
      definitionPath: definitionRelativePath,
      sourceRevision: checksum,
      checksum,
    },
    targetRepoContract: normalizedDefinition.targetRepoContract,
    auditOutcomePolicy: normalizedDefinition.auditOutcomePolicy,
    minimumAssetSet: normalizedDefinition.minimumAssetSet,
  };
}

export function generateBaseline(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const definitionPath = options.definitionPath || defaultDefinitionPath;
  const outputPath = options.outputPath || defaultOutputPath;
  const write = options.write !== false;

  const definition = readJson(definitionPath);
  const projection = buildBaselineProjection(definition, { repoRoot, definitionPath });

  if (write) {
    fs.writeFileSync(outputPath, `${JSON.stringify(projection, null, 2)}\n`, 'utf8');
  }

  return projection;
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  const projection = generateBaseline();
  console.log(`Generated repo setup baseline: ${path.relative(defaultRepoRoot, defaultOutputPath).replace(/\\/g, '/')} (${projection.source.sourceRevision})`);
}