'use strict';

const fs = require('fs');
const path = require('path');

const PLANNING_INTAKE_ARTIFACT_KIND = 'planning.intake.artifact';
const PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION = 1;
const PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH = 'docs/planning/intake';
const PLANNING_INTAKE_DIRECTORY_RELATIVE_PATH = path.join('docs', 'planning', 'intake');
const PLANNING_INTAKE_ARTIFACT_ID_PATTERN = /^PI-(\d{3,})$/;
const PLANNING_INTAKE_CATEGORIES = Object.freeze([
  'idea',
  'research',
  'refactor-candidate',
  'design-complaint',
  'audit-request',
  'roadmap-request',
  'commit-prep',
]);
const PLANNING_INTAKE_DEFAULT_CATEGORY = 'idea';
const PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN = 'PI-###';

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTextBlock(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, ''));

  while (normalized.length > 0 && !normalized[0].trim()) {
    normalized.shift();
  }
  while (normalized.length > 0 && !normalized[normalized.length - 1].trim()) {
    normalized.pop();
  }

  return normalized.join('\n');
}

function normalizeListInput(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',');
  }
  return [];
}

function normalizeOrderedStringList(value) {
  const seen = new Set();
  const normalized = [];

  for (const entry of normalizeListInput(value)) {
    const token = normalizeString(entry);
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function normalizeDeterministicStringList(value) {
  return [...new Set(normalizeListInput(value)
    .map((entry) => normalizeString(entry))
    .filter(Boolean))]
    .sort(deterministicStringCompare);
}

function normalizeAcceptanceCriteria(value) {
  if (typeof value === 'string') {
    return normalizeOrderedStringList(
      value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((entry) => entry.replace(/^\s*[-*]\s*/, ''))
    );
  }

  return normalizeOrderedStringList(value);
}

function buildError(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    reason: code,
    ...extra,
  });
}

function assertRepoRoot(repoRoot) {
  const normalized = normalizeString(repoRoot);
  if (!normalized) {
    throw buildError('repository root is required', 400, 'planning_intake_repo_root_required');
  }
  return path.resolve(normalized);
}

function resolvePlanningIntakeDirectoryPath(repoRoot) {
  return path.join(assertRepoRoot(repoRoot), PLANNING_INTAKE_DIRECTORY_RELATIVE_PATH);
}

function isPlanningIntakeArtifactId(value) {
  return PLANNING_INTAKE_ARTIFACT_ID_PATTERN.test(normalizeString(value).toUpperCase());
}

function parsePlanningIntakeArtifactIdNumber(value) {
  const match = normalizeString(value).toUpperCase().match(PLANNING_INTAKE_ARTIFACT_ID_PATTERN);
  if (!match) {
    throw buildError(
      `planning intake artifact id must use format ${PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN}`,
      400,
      'invalid_planning_intake_artifact_id',
    );
  }
  return Number.parseInt(match[1], 10);
}

function formatPlanningIntakeArtifactId(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw buildError('planning intake artifact number must be a positive integer', 400, 'invalid_planning_intake_artifact_number');
  }
  return `PI-${String(numeric).padStart(3, '0')}`;
}

function buildNextPlanningIntakeArtifactId(existingArtifacts) {
  let max = 0;
  for (const artifact of Array.isArray(existingArtifacts) ? existingArtifacts : []) {
    const id = normalizeString(artifact && artifact.id).toUpperCase();
    const match = id.match(PLANNING_INTAKE_ARTIFACT_ID_PATTERN);
    if (!match) {
      continue;
    }
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > max) {
      max = numeric;
    }
  }
  return formatPlanningIntakeArtifactId(max + 1);
}

function normalizePlanningIntakeCategory(value, fallback = PLANNING_INTAKE_DEFAULT_CATEGORY) {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (!PLANNING_INTAKE_CATEGORIES.includes(normalized)) {
    throw buildError(
      `unsupported planning intake category: ${value}`,
      400,
      'invalid_planning_intake_category',
    );
  }
  return normalized;
}

function normalizeIso(value, fallbackIso) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) {
    return fallbackIso;
  }
  return new Date(ms).toISOString();
}

function finalizePlanningIntakeArtifact(input, options = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const nowIso = normalizeIso(options.now || new Date().toISOString(), new Date().toISOString());
  const explicitId = normalizeString(source.id).toUpperCase();
  const id = explicitId
    ? (() => {
      if (!isPlanningIntakeArtifactId(explicitId)) {
        throw buildError(
          `planning intake artifact id must use format ${PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN}`,
          400,
          'invalid_planning_intake_artifact_id',
        );
      }
      return explicitId;
    })()
    : (
      typeof options.generateId === 'function'
        ? normalizeString(options.generateId(source)).toUpperCase()
        : ''
    );

  if (!id) {
    throw buildError('planning intake artifact id is required', 400, 'planning_intake_artifact_id_required');
  }

  const inputKind = normalizeString(source.kind);
  if (inputKind && inputKind !== PLANNING_INTAKE_ARTIFACT_KIND) {
    throw buildError(
      `planning intake artifact kind must be ${PLANNING_INTAKE_ARTIFACT_KIND}`,
      400,
      'invalid_planning_intake_artifact_kind',
    );
  }

  const inputSchemaVersion = source.schemaVersion;
  if (
    inputSchemaVersion != null
    && Number(inputSchemaVersion) !== PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION
  ) {
    throw buildError(
      `planning intake artifact schemaVersion must be ${PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION}`,
      400,
      'invalid_planning_intake_artifact_schema_version',
    );
  }

  const title = normalizeTextBlock(source.title);
  if (!title) {
    throw buildError('planning intake artifact title is required', 400, 'planning_intake_artifact_title_required');
  }

  const summary = normalizeTextBlock(source.summary);
  const acceptanceCriteria = normalizeAcceptanceCriteria(source.acceptanceCriteria);
  const targetRepoIds = normalizeDeterministicStringList(source.targetRepoIds);
  const planningState = normalizeString(source.planningState || source.state);
  const createdAt = normalizeIso(source.createdAt, options.existingCreatedAt || nowIso);
  const updatedAt = normalizeIso(source.updatedAt, nowIso);

  return {
    kind: PLANNING_INTAKE_ARTIFACT_KIND,
    schemaVersion: PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION,
    id,
    category: normalizePlanningIntakeCategory(source.category),
    title,
    summary,
    acceptanceCriteria,
    targetRepoIds,
    ...(planningState ? { planningState } : {}),
    createdAt,
    updatedAt: updatedAt < createdAt ? createdAt : updatedAt,
  };
}

function serializePlanningIntakeArtifact(input, options = {}) {
  const artifact = finalizePlanningIntakeArtifact(input, options);
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

function parsePlanningIntakeArtifactDocument(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (error) {
    throw buildError(
      `planning intake artifact must be valid JSON: ${error.message}`,
      400,
      'planning_intake_artifact_invalid_json',
    );
  }

  return finalizePlanningIntakeArtifact(parsed);
}

function buildArtifactSummary(artifact, repoRoot) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const id = normalizeString(artifact && artifact.id).toUpperCase();
  const filePath = path.join(resolvePlanningIntakeDirectoryPath(resolvedRepoRoot), `${id}.json`);
  return {
    ...artifact,
    filePath,
    repoRelativePath: `${PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH}/${id}.json`,
  };
}

function readPlanningIntakeArtifact(repoRoot, artifactId) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const normalizedArtifactId = normalizeString(artifactId).toUpperCase();
  if (!isPlanningIntakeArtifactId(normalizedArtifactId)) {
    throw buildError(
      `planning intake artifact id must use format ${PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN}`,
      400,
      'invalid_planning_intake_artifact_id',
    );
  }

  const filePath = path.join(resolvePlanningIntakeDirectoryPath(resolvedRepoRoot), `${normalizedArtifactId}.json`);
  if (!fs.existsSync(filePath)) {
    throw buildError('planning intake artifact not found', 404, 'planning_intake_artifact_not_found', {
      artifactId: normalizedArtifactId,
    });
  }

  const artifact = parsePlanningIntakeArtifactDocument(fs.readFileSync(filePath, 'utf8'));
  return buildArtifactSummary(artifact, resolvedRepoRoot);
}

function listPlanningIntakeArtifacts(repoRoot) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const directoryPath = resolvePlanningIntakeDirectoryPath(resolvedRepoRoot);
  const exists = fs.existsSync(directoryPath);
  if (!exists) {
    return {
      directoryPath,
      repoRelativePath: PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH,
      exists: false,
      stableIdPattern: PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN,
      supportedCategories: PLANNING_INTAKE_CATEGORIES.slice(),
      artifactCount: 0,
      artifacts: [],
    };
  }

  const artifacts = fs.readdirSync(directoryPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name)
    .sort(deterministicStringCompare)
    .map((fileName) => {
      const filePath = path.join(directoryPath, fileName);
      try {
        return buildArtifactSummary(
          parsePlanningIntakeArtifactDocument(fs.readFileSync(filePath, 'utf8')),
          resolvedRepoRoot,
        );
      } catch (error) {
        throw buildError(
          `planning intake artifact file invalid: ${fileName}: ${error.message}`,
          error.statusCode === 404 ? 404 : 409,
          'planning_intake_artifact_file_invalid',
        );
      }
    })
    .sort((left, right) => deterministicStringCompare(left.id, right.id));

  return {
    directoryPath,
    repoRelativePath: PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH,
    exists: true,
    stableIdPattern: PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN,
    supportedCategories: PLANNING_INTAKE_CATEGORIES.slice(),
    artifactCount: artifacts.length,
    artifacts,
  };
}

function ensurePlanningIntakeDirectory(repoRoot) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const directoryPath = resolvePlanningIntakeDirectoryPath(resolvedRepoRoot);
  const created = !fs.existsSync(directoryPath);
  fs.mkdirSync(directoryPath, { recursive: true });
  return {
    created,
    directoryPath,
    repoRelativePath: PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH,
  };
}

function createPlanningIntakeArtifact(repoRoot, input, options = {}) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const current = listPlanningIntakeArtifacts(resolvedRepoRoot);
  const artifact = finalizePlanningIntakeArtifact(input, {
    now: options.now,
    generateId: () => buildNextPlanningIntakeArtifactId(current.artifacts),
  });

  const filePath = path.join(resolvePlanningIntakeDirectoryPath(resolvedRepoRoot), `${artifact.id}.json`);
  if (fs.existsSync(filePath)) {
    throw buildError(
      `planning intake artifact already exists: ${artifact.id}`,
      409,
      'planning_intake_artifact_already_exists',
    );
  }

  ensurePlanningIntakeDirectory(resolvedRepoRoot);
  fs.writeFileSync(filePath, serializePlanningIntakeArtifact(artifact, { now: options.now }), 'utf8');
  return buildArtifactSummary(artifact, resolvedRepoRoot);
}

function updatePlanningIntakeArtifact(repoRoot, artifactId, patch, options = {}) {
  const resolvedRepoRoot = assertRepoRoot(repoRoot);
  const existing = readPlanningIntakeArtifact(resolvedRepoRoot, artifactId);
  const normalizedPatch = patch && typeof patch === 'object' ? patch : {};
  const patchId = normalizeString(normalizedPatch.id).toUpperCase();
  if (patchId && patchId !== existing.id) {
    throw buildError('planning intake artifact id cannot be changed', 400, 'planning_intake_artifact_id_immutable');
  }

  const artifact = finalizePlanningIntakeArtifact({
    ...existing,
    ...normalizedPatch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: options.now || new Date().toISOString(),
  }, {
    now: options.now,
    existingCreatedAt: existing.createdAt,
  });

  const filePath = path.join(resolvePlanningIntakeDirectoryPath(resolvedRepoRoot), `${existing.id}.json`);
  fs.writeFileSync(filePath, serializePlanningIntakeArtifact(artifact, { now: options.now }), 'utf8');
  return buildArtifactSummary(artifact, resolvedRepoRoot);
}

module.exports = {
  PLANNING_INTAKE_ARTIFACT_KIND,
  PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION,
  PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH,
  PLANNING_INTAKE_DIRECTORY_RELATIVE_PATH,
  PLANNING_INTAKE_ARTIFACT_ID_PATTERN,
  PLANNING_INTAKE_CATEGORIES,
  PLANNING_INTAKE_DEFAULT_CATEGORY,
  PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN,
  resolvePlanningIntakeDirectoryPath,
  isPlanningIntakeArtifactId,
  parsePlanningIntakeArtifactIdNumber,
  formatPlanningIntakeArtifactId,
  buildNextPlanningIntakeArtifactId,
  normalizePlanningIntakeCategory,
  finalizePlanningIntakeArtifact,
  serializePlanningIntakeArtifact,
  parsePlanningIntakeArtifactDocument,
  readPlanningIntakeArtifact,
  listPlanningIntakeArtifacts,
  ensurePlanningIntakeDirectory,
  createPlanningIntakeArtifact,
  updatePlanningIntakeArtifact,
};
