'use strict';

const planningIntakeArtifactsLib = require('../lib/planningIntakeArtifacts');
const planningBulletsLib = require('../lib/planningBullets');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');
const {
  DEFAULT_PLANNING_API_CONTRACT_VERSION,
  buildRouteError,
  sendRouteError,
  normalizeRepoSelector,
  summarizeRepo,
  resolveReadRepoContext,
  resolveMutationRepoContext,
  repoInventoryLib,
} = require('./_planningRepoContext');

const ID_TOKEN_RE = /^[A-Za-z0-9._-]{1,256}$/;

function deterministicStringCompare(a, b) {
  const left = String(a == null ? '' : a);
  const right = String(b == null ? '' : b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isValidIdToken(value) {
  return typeof value === 'string' && ID_TOKEN_RE.test(value);
}

function normalizeIso(value, fallbackIso) {
  const ms = Date.parse(String(value || ''));
  if (!Number.isFinite(ms)) return fallbackIso;
  return new Date(ms).toISOString();
}

function resolveRecordId(match, index = 1) {
  return decodeURIComponent((match && match[index]) || '').trim();
}

function getRecordFromState(planningApiState, recordId) {
  if (!planningApiState || typeof planningApiState !== 'object') {
    return null;
  }

  if (!(planningApiState.recordsById instanceof Map)) {
    return null;
  }

  return planningApiState.recordsById.get(recordId) || null;
}

function normalizeTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readResearchNoteId(entry) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeTrimmedString(entry.id) || normalizeTrimmedString(entry.noteId);
}

function readDiagramId(entry) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeTrimmedString(entry.id) || normalizeTrimmedString(entry.diagramId);
}

function normalizeSourcesList(value) {
  const rawList = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? [value] : []);

  const normalized = rawList
    .map((entry) => normalizeTrimmedString(entry))
    .filter(Boolean);

  if (!normalized.length) {
    return undefined;
  }

  return [...new Set(normalized)].sort(deterministicStringCompare);
}

function resolveSources(inputSources, inputSource, fallbackSources) {
  if (Array.isArray(inputSources) || typeof inputSources === 'string') {
    return normalizeSourcesList(inputSources);
  }

  if (typeof inputSource === 'string') {
    return normalizeSourcesList(inputSource);
  }

  return normalizeSourcesList(fallbackSources);
}

function normalizeResearchNoteEntry(entry, fallbackIso = new Date(0).toISOString()) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = readResearchNoteId(entry);
  if (!isValidIdToken(id)) {
    return null;
  }

  const createdAt = normalizeIso(entry.createdAt, fallbackIso);
  const updatedAt = normalizeIso(entry.updatedAt, createdAt);
  const content = typeof entry.content === 'string'
    ? entry.content
    : (typeof entry.summary === 'string' ? entry.summary : '');
  const sources = resolveSources(entry.sources, entry.source, undefined);

  const normalized = {
    id,
    phase: normalizeTrimmedString(entry.phase) || 'research',
    title: typeof entry.title === 'string' ? entry.title : '',
    content,
    createdAt,

    // Legacy aliases are preserved so older clients can still read payloads.
    noteId: id,
    summary: content,
    updatedAt,
  };

  if (sources && sources.length) {
    normalized.sources = sources;
    if (sources.length === 1) {
      normalized.source = sources[0];
    }
  }

  return normalized;
}

function normalizePlanningDiagramEntry(entry, fallbackIso = new Date(0).toISOString()) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = readDiagramId(entry);
  if (!isValidIdToken(id)) {
    return null;
  }

  const createdAt = normalizeIso(entry.createdAt, fallbackIso);
  const updatedAt = normalizeIso(entry.updatedAt, createdAt);

  return {
    id,
    type: normalizeTrimmedString(entry.type) || 'diagram',
    title: typeof entry.title === 'string' ? entry.title : '',
    content: typeof entry.content === 'string' ? entry.content : '',
    format: typeof entry.format === 'string' ? entry.format : '',
    createdAt,

    // Legacy alias is preserved for backward compatibility.
    diagramId: id,
    updatedAt,
  };
}

function normalizeResearchNotes(record) {
  const notes = Array.isArray(record && record.researchNotes) ? record.researchNotes : [];
  return notes
    .map((entry) => normalizeResearchNoteEntry(entry))
    .filter(Boolean)
    .sort((a, b) => {
      const createdDiff = deterministicStringCompare(a.createdAt, b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return deterministicStringCompare(a.id, b.id);
    });
}

function normalizeDiagrams(record) {
  const diagrams = Array.isArray(record && record.diagrams) ? record.diagrams : [];
  return diagrams
    .map((entry) => normalizePlanningDiagramEntry(entry))
    .filter(Boolean)
    .sort((a, b) => {
      const createdDiff = deterministicStringCompare(a.createdAt, b.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return deterministicStringCompare(a.id, b.id);
    });
}

function summarizePlanningIntakeState(state) {
  const intake = state && typeof state === 'object' ? state : {};
  return {
    directoryPath: intake.directoryPath || null,
    repoRelativePath:
      intake.repoRelativePath
      || planningIntakeArtifactsLib.PLANNING_INTAKE_DIRECTORY_REPO_RELATIVE_PATH,
    exists: Boolean(intake.exists),
    artifactCount: Array.isArray(intake.artifacts) ? intake.artifacts.length : Number(intake.artifactCount || 0),
    stableIdPattern:
      intake.stableIdPattern
      || planningIntakeArtifactsLib.PLANNING_INTAKE_DEFAULT_STABLE_ID_PATTERN,
    supportedCategories: Array.isArray(intake.supportedCategories)
      ? intake.supportedCategories.slice()
      : planningIntakeArtifactsLib.PLANNING_INTAKE_CATEGORIES.slice(),
  };
}

function summarizePlanningBulletsState(state) {
  const bulletsState = state && typeof state === 'object' ? state : {};
  return {
    filePath: bulletsState.filePath || null,
    repoRelativePath:
      bulletsState.repoRelativePath
      || planningBulletsLib.PLANNING_BULLETS_FILE_REPO_RELATIVE_PATH,
    exists: Boolean(bulletsState.exists),
    bulletCount: Array.isArray(bulletsState.bullets) ? bulletsState.bullets.length : Number(bulletsState.bulletCount || 0),
    stableIdPattern: bulletsState.stableIdPattern || 'PB-###',
    supportedStates: Array.isArray(bulletsState.supportedStates)
      ? bulletsState.supportedStates.slice()
      : planningBulletsLib.PLANNING_BULLET_STATES.slice(),
  };
}

function summarizePlanningBullet(artifact) {
  const record = artifact && typeof artifact === 'object' ? artifact : {};
  return {
    kind: 'planning.bullet.artifact',
    schemaVersion: 1,
    id: normalizeTrimmedString(record.id),
    title: typeof record.title === 'string' ? record.title : '',
    state: normalizeTrimmedString(record.state) || 'idea',
    repoId: normalizeTrimmedString(record.repoId),
    summary: typeof record.summary === 'string' ? record.summary : '',
    notes: Array.isArray(record.notes)
      ? record.notes.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    promotedPlanRefs: Array.isArray(record.promotedPlanRefs)
      ? record.promotedPlanRefs.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    promotedBacklogRefs: Array.isArray(record.promotedBacklogRefs)
      ? record.promotedBacklogRefs.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    promotedRoadmapRefs: Array.isArray(record.promotedRoadmapRefs)
      ? record.promotedRoadmapRefs.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    filePath: normalizeTrimmedString(record.filePath),
    repoRelativePath: normalizeTrimmedString(record.repoRelativePath),
  };
}

function summarizePlanningIntakeArtifact(artifact) {
  const record = artifact && typeof artifact === 'object' ? artifact : {};
  return {
    kind: record.kind || planningIntakeArtifactsLib.PLANNING_INTAKE_ARTIFACT_KIND,
    schemaVersion:
      Number(record.schemaVersion) || planningIntakeArtifactsLib.PLANNING_INTAKE_ARTIFACT_SCHEMA_VERSION,
    id: normalizeTrimmedString(record.id),
    category: normalizeTrimmedString(record.category),
    title: typeof record.title === 'string' ? record.title : '',
    summary: typeof record.summary === 'string' ? record.summary : '',
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    targetRepoIds: Array.isArray(record.targetRepoIds)
      ? record.targetRepoIds.map((entry) => normalizeTrimmedString(entry)).filter(Boolean)
      : [],
    planningState: normalizeTrimmedString(record.planningState) || undefined,
    createdAt: normalizeIso(record.createdAt, new Date(0).toISOString()),
    updatedAt: normalizeIso(record.updatedAt, normalizeIso(record.createdAt, new Date(0).toISOString())),
    filePath: normalizeTrimmedString(record.filePath),
    repoRelativePath: normalizeTrimmedString(record.repoRelativePath),
  };
}

function buildResearchNoteId(notes) {
  let max = 0;
  for (const note of notes) {
    const noteId = readResearchNoteId(note);
    const match = noteId.match(/^note-(\d{4})$/);
    if (!match) continue;
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isFinite(numeric) && numeric > max) {
      max = numeric;
    }
  }
  return `note-${String(max + 1).padStart(4, '0')}`;
}

function handleGetResearch(ctx, deps) {
  const { res, match, planningApiState } = ctx;
  const { sendJson, contractVersion } = deps;

  const recordId = resolveRecordId(match, 1);
  if (!isValidIdToken(recordId)) {
    sendJson(res, 400, { error: 'Invalid record id' });
    return;
  }

  const record = getRecordFromState(planningApiState, recordId);
  if (!record) {
    sendJson(res, 404, { error: 'Planning record not found', recordId });
    return;
  }

  sendJson(res, 200, {
    contractVersion,
    kind: 'planning.artifacts.research.list',
    deterministic: true,
    recordId,
    researchNotes: normalizeResearchNotes(record),
  });
}

function handlePostResearch(ctx, deps) {
  const { req, res, match, planningApiState } = ctx;
  const { sendJson, readJsonBody, contractVersion } = deps;

  const recordId = resolveRecordId(match, 1);
  if (!isValidIdToken(recordId)) {
    sendJson(res, 400, { error: 'Invalid record id' });
    return;
  }

  const record = getRecordFromState(planningApiState, recordId);
  if (!record) {
    sendJson(res, 404, { error: 'Planning record not found', recordId });
    return;
  }

  readJsonBody(req)
    .then((body) => {
      const payload = body && typeof body === 'object'
        ? (body.note && typeof body.note === 'object' ? body.note : body)
        : {};

      const explicitNoteId = normalizeTrimmedString(payload.id) || normalizeTrimmedString(payload.noteId);
      if (explicitNoteId && !isValidIdToken(explicitNoteId)) {
        throw Object.assign(new Error('Invalid note id'), { statusCode: 400 });
      }

      const existingNotes = Array.isArray(record.researchNotes) ? record.researchNotes : [];
      const existingIndex = explicitNoteId
        ? existingNotes.findIndex((entry) => readResearchNoteId(entry) === explicitNoteId)
        : -1;

      const nowIso = new Date().toISOString();
      const existing = existingIndex >= 0
        ? normalizeResearchNoteEntry(existingNotes[existingIndex], nowIso)
        : null;

      const title = normalizeTrimmedString(payload.title) || (existing ? existing.title : '');
      const contentInput = normalizeTrimmedString(payload.content) || normalizeTrimmedString(payload.summary);
      const content = contentInput || (existing ? existing.content : '');
      const phase = normalizeTrimmedString(payload.phase) || (existing ? existing.phase : 'research');

      if (!title) {
        throw Object.assign(new Error('title is required'), { statusCode: 400 });
      }
      if (!content) {
        throw Object.assign(new Error('content is required'), { statusCode: 400 });
      }

      const nextNoteId = explicitNoteId || buildResearchNoteId(existingNotes);
      const createdAt = normalizeIso(payload.createdAt, existing ? existing.createdAt : nowIso);
      const sources = resolveSources(payload.sources, payload.source, existing ? existing.sources : undefined);
      const note = {
        id: nextNoteId,
        phase,
        title,
        content,
        createdAt,

        // Legacy aliases are preserved for backward compatibility.
        noteId: nextNoteId,
        summary: content,
        updatedAt: nowIso,
      };

      if (sources && sources.length) {
        note.sources = sources;
        if (sources.length === 1) {
          note.source = sources[0];
        }
      }

      if (existingIndex >= 0) {
        const nextNotes = existingNotes.slice();
        nextNotes[existingIndex] = note;
        record.researchNotes = nextNotes;
      } else {
        record.researchNotes = [...existingNotes, note];
      }

      record.updatedAt = nowIso;

      sendJson(res, existingIndex >= 0 ? 200 : 201, {
        contractVersion,
        kind: existingIndex >= 0
          ? 'planning.artifacts.research.update'
          : 'planning.artifacts.research.create',
        deterministic: true,
        recordId,
        note,
      });
    })
    .catch((error) => {
      sendJson(res, error.statusCode || 400, {
        error: String(error && error.message ? error.message : error),
        recordId,
      });
    });
}

function handleDeleteResearch(ctx, deps) {
  const { res, match, planningApiState } = ctx;
  const { sendJson, contractVersion } = deps;

  const recordId = resolveRecordId(match, 1);
  const noteId = resolveRecordId(match, 2);

  if (!isValidIdToken(recordId)) {
    sendJson(res, 400, { error: 'Invalid record id' });
    return;
  }
  if (!isValidIdToken(noteId)) {
    sendJson(res, 400, { error: 'Invalid note id' });
    return;
  }

  const record = getRecordFromState(planningApiState, recordId);
  if (!record) {
    sendJson(res, 404, { error: 'Planning record not found', recordId });
    return;
  }

  const existingNotes = Array.isArray(record.researchNotes) ? record.researchNotes : [];
  const before = existingNotes.length;
  const remaining = existingNotes.filter((entry) => readResearchNoteId(entry) !== noteId);

  if (remaining.length === before) {
    sendJson(res, 404, { error: 'Research note not found', recordId, noteId });
    return;
  }

  record.researchNotes = remaining;
  record.updatedAt = new Date().toISOString();

  sendJson(res, 200, {
    contractVersion,
    kind: 'planning.artifacts.research.delete',
    deterministic: true,
    ok: true,
    recordId,
    noteId,
  });
}

function handleGetDiagrams(ctx, deps) {
  const { res, match, planningApiState } = ctx;
  const { sendJson, contractVersion } = deps;

  const recordId = resolveRecordId(match, 1);
  if (!isValidIdToken(recordId)) {
    sendJson(res, 400, { error: 'Invalid record id' });
    return;
  }

  const record = getRecordFromState(planningApiState, recordId);
  if (!record) {
    sendJson(res, 404, { error: 'Planning record not found', recordId });
    return;
  }

  sendJson(res, 200, {
    contractVersion,
    kind: 'planning.artifacts.diagrams.list',
    deterministic: true,
    recordId,
    diagrams: normalizeDiagrams(record),
  });
}

function readRequestBody(req, deps) {
  return deps.readJsonBody(req).then((body) => (body && typeof body === 'object' ? body : {}));
}

function mapPlanningIntakeError(error) {
  if (error && error.statusCode) {
    return error;
  }

  const message = normalizeTrimmedString(error && error.message ? error.message : error);
  if (!message) {
    return buildRouteError('planning intake route failed', 500, 'planning_intake_route_failed');
  }

  return buildRouteError(message, 400, 'planning_intake_validation_failed');
}

function mapPlanningBulletsError(error) {
  if (error && error.statusCode) {
    return error;
  }

  const message = normalizeTrimmedString(error && error.message ? error.message : error);
  if (!message) {
    return buildRouteError('planning bullets route failed', 500, 'planning_bullets_route_failed');
  }

  if (
    message.includes('planning bullets document must begin with "# Planning Bullets"')
    || message.includes('duplicate planning bullet id:')
    || message.includes('invalid planning bullet heading:')
  ) {
    return buildRouteError(message, 409, 'planning_bullets_file_invalid');
  }

  if (message.includes('planning bullet not found:')) {
    return buildRouteError(message, 404, 'planning_bullet_not_found');
  }

  return buildRouteError(message, 400, 'planning_bullets_validation_failed');
}

function handleListPlanningBullets(ctx, deps) {
  try {
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveReadRepoContext(ctx, deps, selector);
    const bulletsState = deps.planningBullets.listPlanningBullets(repo.repoPath);
    const bullets = Array.isArray(bulletsState.bullets)
      ? bulletsState.bullets.map((entry) => summarizePlanningBullet(entry))
      : [];

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.bullets.list',
      deterministic: true,
      repo: summarizeRepo(repo),
      count: bullets.length,
      bullets: summarizePlanningBulletsState(bulletsState),
      artifacts: bullets,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.bullets.list', mapPlanningBulletsError(error));
  }
}

function handleCreatePlanningBullet(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const payload = body.bullet && typeof body.bullet === 'object' ? body.bullet : body;
      const bullet = deps.planningBullets.createPlanningBullet(repo.repoPath, payload);
      const bulletsState = deps.planningBullets.listPlanningBullets(repo.repoPath);

      deps.sendJson(ctx.res, 201, {
        contractVersion: deps.contractVersion,
        kind: 'planning.bullets.create',
        deterministic: true,
        repo: summarizeRepo(repo),
        count: bulletsState.bullets.length,
        bullets: summarizePlanningBulletsState(bulletsState),
        artifact: summarizePlanningBullet({
          ...bullet,
          filePath: bulletsState.filePath,
          repoRelativePath: bulletsState.repoRelativePath,
        }),
        artifacts: bulletsState.bullets.map((entry) => summarizePlanningBullet(entry)),
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.bullets.create',
      mapPlanningBulletsError(error),
    ));
}

function handleUpdatePlanningBullet(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const bulletId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
      const payload = body.bullet && typeof body.bullet === 'object'
        ? body.bullet
        : (body.patch && typeof body.patch === 'object' ? body.patch : body);
      const bullet = deps.planningBullets.updatePlanningBullet(repo.repoPath, bulletId, payload);
      const bulletsState = deps.planningBullets.listPlanningBullets(repo.repoPath);

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.bullets.update',
        deterministic: true,
        repo: summarizeRepo(repo),
        count: bulletsState.bullets.length,
        bullets: summarizePlanningBulletsState(bulletsState),
        artifact: summarizePlanningBullet({
          ...bullet,
          filePath: bulletsState.filePath,
          repoRelativePath: bulletsState.repoRelativePath,
        }),
        artifacts: bulletsState.bullets.map((entry) => summarizePlanningBullet(entry)),
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.bullets.update',
      mapPlanningBulletsError(error),
    ));
}

function handleListPlanningIntake(ctx, deps) {
  try {
    const selector = normalizeRepoSelector(ctx.u.searchParams);
    const { repo } = resolveReadRepoContext(ctx, deps, selector);
    const intakeState = deps.planningIntakeArtifacts.listPlanningIntakeArtifacts(repo.repoPath);
    const artifacts = Array.isArray(intakeState.artifacts)
      ? intakeState.artifacts.map((entry) => summarizePlanningIntakeArtifact(entry))
      : [];

    deps.sendJson(ctx.res, 200, {
      contractVersion: deps.contractVersion,
      kind: 'planning.intake.list',
      deterministic: true,
      repo: summarizeRepo(repo),
      count: artifacts.length,
      intake: summarizePlanningIntakeState(intakeState),
      artifacts,
    });
  } catch (error) {
    sendRouteError(ctx.res, deps, 'planning.intake.list', mapPlanningIntakeError(error));
  }
}

function handleCreatePlanningIntake(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const payload = body.artifact && typeof body.artifact === 'object' ? body.artifact : body;
      const artifact = deps.planningIntakeArtifacts.createPlanningIntakeArtifact(repo.repoPath, payload);
      const intakeState = deps.planningIntakeArtifacts.listPlanningIntakeArtifacts(repo.repoPath);

      deps.sendJson(ctx.res, 201, {
        contractVersion: deps.contractVersion,
        kind: 'planning.intake.create',
        deterministic: true,
        repo: summarizeRepo(repo),
        count: intakeState.artifacts.length,
        intake: summarizePlanningIntakeState(intakeState),
        artifact: summarizePlanningIntakeArtifact(artifact),
        artifacts: intakeState.artifacts.map((entry) => summarizePlanningIntakeArtifact(entry)),
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.intake.create',
      mapPlanningIntakeError(error),
    ));
}

function handleUpdatePlanningIntake(ctx, deps) {
  readRequestBody(ctx.req, deps)
    .then((body) => {
      const selector = normalizeRepoSelector(ctx.u.searchParams, body);
      const { repo } = resolveMutationRepoContext(ctx, deps, selector);
      const artifactId = decodeURIComponent((ctx.match && ctx.match[1]) || '').trim();
      const payload = body.artifact && typeof body.artifact === 'object'
        ? body.artifact
        : (body.patch && typeof body.patch === 'object' ? body.patch : body);
      const artifact = deps.planningIntakeArtifacts.updatePlanningIntakeArtifact(repo.repoPath, artifactId, payload);
      const intakeState = deps.planningIntakeArtifacts.listPlanningIntakeArtifacts(repo.repoPath);

      deps.sendJson(ctx.res, 200, {
        contractVersion: deps.contractVersion,
        kind: 'planning.intake.update',
        deterministic: true,
        repo: summarizeRepo(repo),
        count: intakeState.artifacts.length,
        intake: summarizePlanningIntakeState(intakeState),
        artifact: summarizePlanningIntakeArtifact(artifact),
        artifacts: intakeState.artifacts.map((entry) => summarizePlanningIntakeArtifact(entry)),
      });
    })
    .catch((error) => sendRouteError(
      ctx.res,
      deps,
      'planning.intake.update',
      mapPlanningIntakeError(error),
    ));
}

function register(deps = {}) {
  const resolvedDeps = {
    contractVersion: deps.PLANNING_API_CONTRACT_VERSION || DEFAULT_PLANNING_API_CONTRACT_VERSION,
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    repoInventory: deps.repoInventory || repoInventoryLib,
    planningIntakeArtifacts: deps.planningIntakeArtifacts || planningIntakeArtifactsLib,
    planningBullets: deps.planningBullets || planningBulletsLib,
  };

  return [
    {
      method: 'GET',
      path: '/api/planning/artifacts/bullets',
      handler: (ctx) => handleListPlanningBullets(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/artifacts/bullets',
      handler: (ctx) => handleCreatePlanningBullet(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/planning\/artifacts\/bullets\/([^/]+)$/,
      handler: (ctx) => handleUpdatePlanningBullet(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: '/api/planning/artifacts/intake',
      handler: (ctx) => handleListPlanningIntake(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: '/api/planning/artifacts/intake',
      handler: (ctx) => handleCreatePlanningIntake(ctx, resolvedDeps),
    },
    {
      method: 'PATCH',
      path: /^\/api\/planning\/artifacts\/intake\/([^/]+)$/,
      handler: (ctx) => handleUpdatePlanningIntake(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/records\/([^/]+)\/research$/,
      handler: (ctx) => handleGetResearch(ctx, resolvedDeps),
    },
    {
      method: 'POST',
      path: /^\/api\/planning\/records\/([^/]+)\/research$/,
      handler: (ctx) => handlePostResearch(ctx, resolvedDeps),
    },
    {
      method: 'DELETE',
      path: /^\/api\/planning\/records\/([^/]+)\/research\/([^/]+)$/,
      handler: (ctx) => handleDeleteResearch(ctx, resolvedDeps),
    },
    {
      method: 'GET',
      path: /^\/api\/planning\/records\/([^/]+)\/diagrams$/,
      handler: (ctx) => handleGetDiagrams(ctx, resolvedDeps),
    },
  ];
}

module.exports = { register };
