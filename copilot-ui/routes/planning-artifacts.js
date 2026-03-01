'use strict';

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

const ID_TOKEN_RE = /^[A-Za-z0-9._-]{1,256}$/;
const DEFAULT_PLANNING_API_CONTRACT_VERSION = 'planning_api_v1';

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

function register(deps = {}) {
  const resolvedDeps = {
    sendJson: deps.sendJson || defaultSendJson,
    readJsonBody: deps.readJsonBody || defaultReadJsonBody,
    contractVersion: deps.PLANNING_API_CONTRACT_VERSION || DEFAULT_PLANNING_API_CONTRACT_VERSION,
  };

  return [
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
