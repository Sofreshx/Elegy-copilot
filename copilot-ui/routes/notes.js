'use strict';

const fs = require('fs');
const path = require('path');

const vaultBackend = require('../lib/vaultBackend');
const vaultGit = require('../lib/vaultGit');
const vaultDriveSync = require('../lib/vaultDriveSync');
const vaultConfig = require('../lib/vaultConfig');

const { sendJson: defaultSendJson, readJsonBody: defaultReadJsonBody } = require('./_helpers');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (isNonEmptyString(tags)) {
    try { return JSON.parse(tags); } catch { return [tags]; }
  }
  return [];
}

function getElegyHome(ctx) {
  return ctx.elegyHomeAbs || vaultConfig.resolveElegyHome();
}

function getDriveOptions(ctx) {
  return { elegyHome: getElegyHome(ctx) };
}

function makeExportFileName(format, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `elegy-notes-${stamp}.${format === 'markdown' ? 'md' : 'json'}`;
}

function writeNotesExport(ctx, fileName, content) {
  const exportDir = path.join(getElegyHome(ctx), 'notes-exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const exportPath = path.join(exportDir, fileName);
  fs.writeFileSync(exportPath, content, 'utf8');
  return { exportDir, exportPath };
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
    const filter = { limit, offset, order };
    if (theme) filter.theme = theme;
    if (tag) filter.tag = tag;
    if (archived !== null && archived !== undefined) {
      filter.archived = archived === 'true' || archived === '1';
    }
    const notes = vaultBackend.listNotes(filter);
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
    const note = vaultBackend.getNote(id.trim());
    if (!note) {
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }
    const blocks = vaultBackend.listBlocksByNote(note.id);
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

  try {
    const note = vaultBackend.createNote({
      title: title || '',
      content,
      theme: theme || null,
      tags: parseTags(tags),
      repo_path: repo_path || null,
      session_id: session_id || null,
    });
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

  try {
    const existing = vaultBackend.getNote(id.trim());
    if (!existing) {
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }

    const updated = vaultBackend.updateNote({
      id: id.trim(),
      title: title !== undefined ? title : existing.title,
      content,
      theme: theme !== undefined ? theme : existing.theme,
      tags: tags !== undefined ? parseTags(tags) : vaultBackend.parseTagsJson(existing.tags_json),
      archived: archived !== undefined ? archived : Boolean(existing.archived),
      repo_path: repo_path !== undefined ? repo_path : existing.repo_path,
      session_id: session_id !== undefined ? session_id : existing.session_id,
    });
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
    const deleted = vaultBackend.deleteNote(id.trim());
    if (!deleted) {
      sendJson(res, 404, { error: 'Note not found' });
      return;
    }
    sendJson(res, 200, { deleted: true, id: id.trim() });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Search notes ──
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
    const results = vaultBackend.searchNotes(query.trim(), { limit });
    sendJson(res, 200, { results, query: query.trim(), count: results.length });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Export notes ──
async function handleNotesExport(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  const format = (body && body.format) || 'json';

  try {
    const notes = vaultBackend.listNotes({ limit: 10000, order: 'updated_at DESC' });

    if (format === 'json') {
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: notes.map((n) => ({
          ...n,
          blocks: vaultBackend.listBlocksByNote(n.id),
        })),
      };
      const fileName = makeExportFileName('json', new Date(exportData.exportedAt));
      const { exportDir, exportPath } = writeNotesExport(ctx, fileName, JSON.stringify(exportData, null, 2));
      sendJson(res, 200, {
        ...exportData,
        fileName,
        exportDir,
        exportPath,
        importCompatibility: 'Import this JSON through Elegy Copilot Notes on another Obsidian-backed vault.',
      });
      return;
    }

    if (format === 'markdown') {
      const config = vaultBackend.getConfig();
      const files = notes.map((n) => {
        let frontMatter = '---\n';
        frontMatter += `id: ${n.id}\n`;
        frontMatter += `title: ${n.title || 'Untitled'}\n`;
        if (n.theme) frontMatter += `theme: ${n.theme}\n`;
        frontMatter += `tags: ${n.tags_json}\n`;
        frontMatter += `created_at: ${n.created_at}\n`;
        frontMatter += `updated_at: ${n.updated_at}\n`;
        frontMatter += `archived: ${n.archived}\n`;
        frontMatter += '---\n\n';

        let md = frontMatter + n.content + '\n';
        const blocks = vaultBackend.listBlocksByNote(n.id);
        for (const block of blocks) {
          md += '\n--- block:' + block.block_kind + ' ---\n';
          md += block.body + '\n';
        }
        return { filename: `${n.id}.md`, content: md };
      });
      const exportedAt = new Date().toISOString();
      const combined = files
        .map((file) => `<!-- ${file.filename} -->\n\n${file.content.trim()}\n`)
        .join('\n---\n\n');
      const fileName = makeExportFileName('markdown', new Date(exportedAt));
      const { exportDir, exportPath } = writeNotesExport(ctx, fileName, combined);
      sendJson(res, 200, {
        format: 'markdown',
        exportedAt,
        files,
        count: files.length,
        fileName,
        exportDir,
        exportPath,
        importCompatibility: 'Markdown exports are plain Obsidian-readable notes for inspection or manual vault copy.',
      });
      return;
    }

    sendJson(res, 400, { error: 'Unsupported format. Use "json" or "markdown".' });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Import notes ──
async function handleNotesImport(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  if (!body || !Array.isArray(body.notes)) {
    sendJson(res, 400, { error: 'Request body must contain a "notes" array' });
    return;
  }

  const version = body.version || 1;
  if (version !== 1) {
    sendJson(res, 400, { error: `Unsupported export version: ${version}` });
    return;
  }

  try {
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (const note of body.notes) {
      if (!note.id || !note.content) {
        errors.push({ error: 'Missing id or content', note });
        continue;
      }

      const existing = vaultBackend.getNote(note.id);
      const now = new Date().toISOString();

      if (existing) {
        vaultBackend.updateNote({
          id: note.id,
          title: note.title || '',
          content: note.content,
          theme: note.theme || null,
          tags: parseTags(note.tags || note.tags_json),
          archived: note.archived ? 1 : 0,
          repo_path: note.repo_path || null,
          session_id: note.session_id || null,
        });
        updated++;
      } else {
        vaultBackend.createNote({
          id: note.id,
          title: note.title || '',
          content: note.content,
          theme: note.theme || null,
          tags: parseTags(note.tags || note.tags_json),
          repo_path: note.repo_path || null,
          session_id: note.session_id || null,
        });
        imported++;
      }
    }

    sendJson(res, 200, {
      imported,
      updated,
      errors: errors.length > 0 ? errors : undefined,
      total: body.notes.length,
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Settings list ──
function handleNotesSettingsList(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const settings = vaultBackend.listSettings();
    sendJson(res, 200, { settings });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Settings get ──
function handleNotesSettingsGet(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const key = u.searchParams.get('key');
  if (!isNonEmptyString(key)) {
    sendJson(res, 400, { error: 'key query parameter is required' });
    return;
  }
  try {
    const value = vaultBackend.getSetting(key.trim());
    sendJson(res, 200, { key: key.trim(), value });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Settings set ──
async function handleNotesSettingsSet(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;
  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }
  const { key, value } = body;
  if (!isNonEmptyString(key)) {
    sendJson(res, 400, { error: 'key is required' });
    return;
  }
  try {
    const ok = vaultBackend.setSetting(key.trim(), value);
    sendJson(res, 200, { key: key.trim(), value, ok });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Settings delete ──
function handleNotesSettingsDelete(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const key = u.searchParams.get('key');
  if (!isNonEmptyString(key)) {
    sendJson(res, 400, { error: 'key query parameter is required' });
    return;
  }
  try {
    const deleted = vaultBackend.deleteSetting(key.trim());
    sendJson(res, 200, { deleted, key: key.trim() });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Vault status ──
function handleVaultStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  try {
    const config = vaultBackend.getConfig();
    const vaultPath = config.vaultPath || '';
    const vaultExists = Boolean(vaultPath && require('fs').existsSync(vaultPath));

    let fileCount = 0;
    if (vaultExists) {
      try {
        fileCount = vaultBackend.listNotes({ limit: 100000 }).length;
      } catch {}
    }

    sendJson(res, 200, {
      ok: true,
      vaultPath,
      vaultExists,
      fileCount,
      configured: Boolean(vaultPath),
      gitEnabled: config.git?.enabled || false,
      gdriveEnabled: config.gdrive?.enabled || false,
      gdriveFolderName: config.gdrive?.remoteFolderName || 'Dev-Vault-Backup',
    });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      error: String(err.message || err),
      configured: false,
    });
  }
}

// ── Git status ──
function handleGitStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = vaultGit.status();
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Git diff ──
function handleGitDiff(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const file = u.searchParams.get('file') || undefined;
  try {
    const result = vaultGit.diff(file);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Git commit ──
async function handleGitCommit(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;
  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }
  const message = body && body.message ? String(body.message).trim() : '';
  try {
    const result = vaultGit.commit(message);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Git log ──
function handleGitLog(ctx, deps) {
  const { res, u } = ctx;
  const { sendJson } = deps;
  const maxCount = parseInt(u.searchParams.get('max') || '20', 10);
  try {
    const result = vaultGit.log(maxCount);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Git init ──
function handleGitInit(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const config = vaultBackend.getConfig();
    if (!config.vaultPath) {
      sendJson(res, 400, { ok: false, error: 'Vault path not configured' });
      return;
    }
    const result = vaultGit.initGit(config.vaultPath);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive sync push ──
async function handleDriveSyncPush(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.push(getDriveOptions(ctx));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive sync pull ──
async function handleDriveSyncPull(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.pull(getDriveOptions(ctx));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive sync status ──
async function handleDriveSyncStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.syncStatus(getDriveOptions(ctx));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive authenticate ──
async function handleDriveAuth(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.authenticate(getDriveOptions(ctx));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive check auth status ──
async function handleDriveCheckAuth(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.checkAuth(getDriveOptions(ctx));
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive cancel auth ──
async function handleDriveCancelAuth(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const result = await vaultDriveSync.cancelAuth();
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Drive managed rclone install ──
async function handleDriveInstallRclone(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;
  try {
    const options = getDriveOptions(ctx);
    const result = await vaultDriveSync.installRclone(options);
    const status = await vaultDriveSync.syncStatus(options);
    sendJson(res, 200, { ...result, status });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: String(err.message || err) });
  }
}

// ── Register ──
function register(context = {}) {
  const sendJson = context.sendJson || defaultSendJson;
  const readJsonBody = context.readJsonBody || defaultReadJsonBody;
  const deps = { sendJson, readJsonBody };

  return [
    // Original notes CRUD (now vault-backed)
    { method: 'GET',    path: '/api/notes/list',      handler: (ctx) => handleNotesList(ctx, deps) },
    { method: 'GET',    path: '/api/notes/get',       handler: (ctx) => handleNotesGet(ctx, deps) },
    { method: 'POST',   path: '/api/notes/create',    handler: (ctx) => handleNotesCreate(ctx, deps) },
    { method: 'POST',   path: '/api/notes/update',    handler: (ctx) => handleNotesUpdate(ctx, deps) },
    { method: 'DELETE', path: '/api/notes/delete',    handler: (ctx) => handleNotesDelete(ctx, deps) },
    { method: 'GET',    path: '/api/notes/search',    handler: (ctx) => handleNotesSearch(ctx, deps) },
    { method: 'POST',   path: '/api/notes/export',    handler: (ctx) => handleNotesExport(ctx, deps) },
    { method: 'POST',   path: '/api/notes/import',    handler: (ctx) => handleNotesImport(ctx, deps) },

    // Settings
    { method: 'GET',    path: '/api/notes/settings',     handler: (ctx) => handleNotesSettingsList(ctx, deps) },
    { method: 'GET',    path: '/api/notes/settings/get',  handler: (ctx) => handleNotesSettingsGet(ctx, deps) },
    { method: 'POST',   path: '/api/notes/settings/set',  handler: (ctx) => handleNotesSettingsSet(ctx, deps) },
    { method: 'DELETE', path: '/api/notes/settings/delete', handler: (ctx) => handleNotesSettingsDelete(ctx, deps) },

    // Vault status
    { method: 'GET',    path: '/api/notes/vault/status', handler: (ctx) => handleVaultStatus(ctx, deps) },

    // Git operations
    { method: 'GET',    path: '/api/notes/git/status', handler: (ctx) => handleGitStatus(ctx, deps) },
    { method: 'GET',    path: '/api/notes/git/diff',   handler: (ctx) => handleGitDiff(ctx, deps) },
    { method: 'POST',   path: '/api/notes/git/commit', handler: (ctx) => handleGitCommit(ctx, deps) },
    { method: 'GET',    path: '/api/notes/git/log',    handler: (ctx) => handleGitLog(ctx, deps) },
    { method: 'POST',   path: '/api/notes/git/init',   handler: (ctx) => handleGitInit(ctx, deps) },

    // Drive sync operations
    { method: 'POST',   path: '/api/notes/drive/push',        handler: (ctx) => handleDriveSyncPush(ctx, deps) },
    { method: 'POST',   path: '/api/notes/drive/pull',        handler: (ctx) => handleDriveSyncPull(ctx, deps) },
    { method: 'GET',    path: '/api/notes/drive/status',      handler: (ctx) => handleDriveSyncStatus(ctx, deps) },
    { method: 'POST',   path: '/api/notes/drive/install-rclone', handler: (ctx) => handleDriveInstallRclone(ctx, deps) },
    { method: 'POST',   path: '/api/notes/drive/auth',        handler: (ctx) => handleDriveAuth(ctx, deps) },
    { method: 'GET',    path: '/api/notes/drive/auth/status', handler: (ctx) => handleDriveCheckAuth(ctx, deps) },
    { method: 'POST',   path: '/api/notes/drive/auth/cancel', handler: (ctx) => handleDriveCancelAuth(ctx, deps) },

    // Legacy sync routes (repurposed for vault)
    { method: 'POST',   path: '/api/notes/sync/push',   handler: (ctx) => handleDriveSyncPush(ctx, deps) },
    { method: 'POST',   path: '/api/notes/sync/pull',   handler: (ctx) => handleDriveSyncPull(ctx, deps) },
    { method: 'GET',    path: '/api/notes/sync/status', handler: (ctx) => handleDriveSyncStatus(ctx, deps) },
  ];
}

module.exports = { register };
