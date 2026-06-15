'use strict';

const { createElegyDb } = require('../lib/elegyDb');
const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── List notes ──
function handleNotesList(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  
  const theme = u.searchParams.get('theme') || undefined;
  const tag = u.searchParams.get('tag') || undefined;
  const archived = u.searchParams.get('archived');
  const limit = parseInt(u.searchParams.get('limit') || '50', 10);
  const offset = parseInt(u.searchParams.get('offset') || '0', 10);
  const order = u.searchParams.get('order') || 'updated_at DESC';

  try {
    const db = createElegyDb();
    const filter = { limit, offset, order };
    if (theme) filter.theme = theme;
    if (tag) filter.tag = tag;
    if (archived !== null && archived !== undefined) filter.archived = archived === 'true' || archived === '1';
    const notes = db.listNotes(filter);
    db.close();
    sendJson(res, 200, { notes, count: notes.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Get single note ──
function handleNotesGet(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  
  const id = u.searchParams.get('id');
  if (!isNonEmptyString(id)) {
    sendJson(res, 400, { error: 'id query parameter is required' });
    return;
  }

  try {
    const db = createElegyDb();
    const note = db.getNote(id.trim());
    const blocks = note ? db.listBlocksByNote(id.trim()) : [];
    db.close();
    if (!note) {
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }
    sendJson(res, 200, { ...note, blocks });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Create note ──
async function handleNotesCreate(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  const { title, content, theme, tags, repo_path, session_id } = body;
  if (typeof content !== 'string') {
    sendJson(res, 400, { error: 'content is required' });
    return;
  }

  const crypto = require('crypto');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const tags_json = Array.isArray(tags) ? JSON.stringify(tags) : '[]';

  try {
    const db = createElegyDb();
    const note = db.createNote({
      id, title: title || '', content, theme: theme || null,
      tags_json, created_at: now, updated_at: now,
      archived: 0, repo_path: repo_path || null, session_id: session_id || null,
    });
    db.close();
    if (!note) {
      sendJson(res, 500, { error: 'Failed to create note' });
      return;
    }
    sendJson(res, 201, note);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Update note ──
async function handleNotesUpdate(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  const { id, title, content, theme, tags, archived, repo_path, session_id } = body;
  if (!isNonEmptyString(id)) {
    sendJson(res, 400, { error: 'id is required' });
    return;
  }
  if (typeof content !== 'string') {
    sendJson(res, 400, { error: 'content is required' });
    return;
  }

  const now = new Date().toISOString();
  const tags_json = Array.isArray(tags) ? JSON.stringify(tags) : undefined;

  try {
    const db = createElegyDb();
    const existing = db.getNote(id.trim());
    if (!existing) {
      db.close();
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }

    const updated = db.updateNote({
      id: id.trim(), title: title !== undefined ? title : existing.title,
      content, theme: theme !== undefined ? theme : existing.theme,
      tags_json: tags_json !== undefined ? tags_json : existing.tags_json,
      updated_at: now,
      archived: archived !== undefined ? (archived ? 1 : 0) : existing.archived,
      repo_path: repo_path !== undefined ? repo_path : existing.repo_path,
      session_id: session_id !== undefined ? session_id : existing.session_id,
    });
    db.close();
    sendJson(res, 200, updated);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Delete note ──
function handleNotesDelete(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  
  const id = u.searchParams.get('id');
  if (!isNonEmptyString(id)) {
    sendJson(res, 400, { error: 'id query parameter is required' });
    return;
  }

  try {
    const db = createElegyDb();
    const deleted = db.deleteNote(id.trim());
    db.close();
    if (!deleted) {
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }
    sendJson(res, 200, { deleted: true, id: id.trim() });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Search notes (FTS5) ──
function handleNotesSearch(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  
  const query = u.searchParams.get('q');
  if (!isNonEmptyString(query)) {
    sendJson(res, 400, { error: 'q query parameter is required' });
    return;
  }

  const limit = parseInt(u.searchParams.get('limit') || '20', 10);

  try {
    const db = createElegyDb();
    const results = db.searchNotes(query.trim(), { limit });
    db.close();
    sendJson(res, 200, { results, query: query.trim(), count: results.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Register ──
function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    { method: 'GET',  path: '/api/notes/list',   handler: (ctx) => handleNotesList(ctx, deps) },
    { method: 'GET',  path: '/api/notes/get',    handler: (ctx) => handleNotesGet(ctx, deps) },
    { method: 'POST', path: '/api/notes/create', handler: (ctx) => handleNotesCreate(ctx, deps) },
    { method: 'POST', path: '/api/notes/update', handler: (ctx) => handleNotesUpdate(ctx, deps) },
    { method: 'DELETE', path: '/api/notes/delete', handler: (ctx) => handleNotesDelete(ctx, deps) },
    { method: 'GET',  path: '/api/notes/search', handler: (ctx) => handleNotesSearch(ctx, deps) },
  ];
}

module.exports = { register };
