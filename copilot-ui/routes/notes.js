'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

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

// ── Export notes ──
async function handleNotesExport(ctx, deps) {
  const { res, req } = ctx;
  const { sendJson, readJsonBody } = deps;

  let body;
  try { body = await readJsonBody(req); } catch (e) {
    sendJson(res, 400, { error: 'Invalid request body' });
    return;
  }

  const format = (body && body.format) || 'json'; // 'json' or 'markdown'

  try {
    const db = createElegyDb();
    const notes = db.listNotes({ limit: 10000, order: 'updated_at DESC' });
    
    if (format === 'json') {
      // JSON dump — lossless, includes blocks
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: notes.map(n => {
          const blocks = db.listBlocksByNote(n.id);
          return { ...n, blocks };
        }),
      };
      db.close();
      sendJson(res, 200, exportData);
      return;
    }

    if (format === 'markdown') {
      // Markdown bundle — one item per note with front-matter
      const files = notes.map(n => {
        const blocks = db.listBlocksByNote(n.id);
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
        // Append blocks
        for (const block of blocks) {
          md += '\n--- block:' + block.block_kind + ' ---\n';
          md += block.body + '\n';
        }
        return { filename: `${n.id}.md`, content: md };
      });
      db.close();
      sendJson(res, 200, { format: 'markdown', files, count: files.length });
      return;
    }

    db.close();
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
    const db = createElegyDb();
    let imported = 0;
    let updated = 0;
    const errors = [];

    for (const note of body.notes) {
      if (!note.id || !note.content) {
        errors.push({ error: 'Missing id or content', note });
        continue;
      }

      const existing = db.getNote(note.id);
      const now = new Date().toISOString();
      const noteData = {
        id: note.id,
        title: note.title || '',
        content: note.content,
        theme: note.theme || null,
        tags_json: note.tags_json || '[]',
        updated_at: note.updated_at || now,
        archived: note.archived ? 1 : 0,
        repo_path: note.repo_path || null,
        session_id: note.session_id || null,
      };

      if (existing) {
        db.updateNote(noteData);
        updated++;
      } else {
        noteData.created_at = note.created_at || now;
        db.createNote(noteData);
        imported++;
      }

      // Import blocks if present
      if (Array.isArray(note.blocks)) {
        // Remove existing blocks for this note
        const existingBlocks = db.listBlocksByNote(note.id);
        for (const eb of existingBlocks) {
          db.deleteBlock(eb.id);
        }
        for (const block of note.blocks) {
          if (block.id && block.body) {
            db.createBlock({
              id: block.id,
              note_id: note.id,
              block_kind: block.block_kind || 'text',
              position: block.position || 0,
              body: block.body,
              source_run_id: block.source_run_id || null,
              created_at: block.created_at || now,
              updated_at: block.updated_at || now,
            });
          }
        }
      }
    }

    db.close();
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
    const db = createElegyDb();
    const settings = db.listNoteSettings();
    db.close();
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
    const db = createElegyDb();
    const value = db.getNoteSetting(key.trim());
    db.close();
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
    const db = createElegyDb();
    db.setNoteSetting(key.trim(), value);
    db.close();
    sendJson(res, 200, { key: key.trim(), value });
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
    const db = createElegyDb();
    const deleted = db.deleteNoteSetting(key.trim());
    db.close();
    sendJson(res, 200, { deleted, key: key.trim() });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Git Sync Push ──
async function handleNotesSyncPush(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  try {
    const db = createElegyDb();
    const gitConfigRaw = db.getNoteSetting('git_sync_config');
    db.close();

    if (!gitConfigRaw) {
      sendJson(res, 400, { error: 'Git sync not configured. Configure in Settings > Notes.' });
      return;
    }

    const config = typeof gitConfigRaw === 'string' ? JSON.parse(gitConfigRaw) : gitConfigRaw;
    if (!config.enabled || !config.repoUrl) {
      sendJson(res, 400, { error: 'Git sync not enabled or missing repo URL.' });
      return;
    }

    const vaultPath = config.localClonePath || path.join(os.homedir(), '.elegy', 'notes-vault');
    if (!fs.existsSync(vaultPath)) {
      fs.mkdirSync(vaultPath, { recursive: true });
    }

    // Export notes as markdown files
    const db2 = createElegyDb();
    const notes = db2.listNotes({ limit: 10000, order: 'updated_at DESC' });
    db2.close();

    const results = [];
    for (const note of notes) {
      const fileName = `${note.id}.md`;
      const filePath = path.join(vaultPath, fileName);

      // Build front-matter
      let md = '---\n';
      md += `id: ${note.id}\n`;
      md += `title: ${note.title || 'Untitled'}\n`;
      if (note.theme) md += `theme: ${note.theme}\n`;
      md += `tags: ${note.tags_json}\n`;
      md += `created_at: ${note.created_at}\n`;
      md += `updated_at: ${note.updated_at}\n`;
      md += `archived: ${note.archived}\n`;
      md += '---\n\n';
      md += note.content + '\n';

      fs.writeFileSync(filePath, md, 'utf8');
      results.push({ id: note.id, file: fileName, updated: note.updated_at });
    }

    // Git operations
    const git = (args) => cp.execSync(`git ${args}`, { cwd: vaultPath, encoding: 'utf8', timeout: 30000 }).trim();

    // Init if needed
    if (!fs.existsSync(path.join(vaultPath, '.git'))) {
      cp.execSync(`git init`, { cwd: vaultPath });
      cp.execSync(`git remote add origin ${config.repoUrl}`, { cwd: vaultPath });
    }

    // Set author
    if (config.commitAuthor) {
      try { cp.execSync(`git config user.name "${config.commitAuthor.split('<')[0].trim()}"`, { cwd: vaultPath }); } catch {}
      const emailMatch = config.commitAuthor.match(/<([^>]+)>/);
      if (emailMatch) try { cp.execSync(`git config user.email "${emailMatch[1]}"`, { cwd: vaultPath }); } catch {}
    }

    git('add -A');
    try { git(`commit -m "notes: sync ${new Date().toISOString()}"`); } catch { /* no changes */ }
    git(`push origin ${config.branch || 'main'}`);

    sendJson(res, 200, { pushed: true, files: results.length, branch: config.branch || 'main' });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Git Sync Pull ──
async function handleNotesSyncPull(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  try {
    const db = createElegyDb();
    const gitConfigRaw = db.getNoteSetting('git_sync_config');
    db.close();

    if (!gitConfigRaw) {
      sendJson(res, 400, { error: 'Git sync not configured.' });
      return;
    }

    const config = typeof gitConfigRaw === 'string' ? JSON.parse(gitConfigRaw) : gitConfigRaw;
    if (!config.enabled || !config.repoUrl) {
      sendJson(res, 400, { error: 'Git sync not enabled or missing repo URL.' });
      return;
    }

    const vaultPath = config.localClonePath || path.join(os.homedir(), '.elegy', 'notes-vault');
    const git = (args) => cp.execSync(`git ${args}`, { cwd: vaultPath, encoding: 'utf8', timeout: 30000, stdio: 'pipe' }).trim();

    // Clone if not exists
    if (!fs.existsSync(path.join(vaultPath, '.git'))) {
      fs.mkdirSync(vaultPath, { recursive: true });
      git(`clone ${config.repoUrl} .`);
      git(`checkout ${config.branch || 'main'}`);
    }

    // Pull
    git('fetch origin');
    
    let pullResult;
    try {
      pullResult = git(`merge origin/${config.branch || 'main'}`);
    } catch (mergeErr) {
      // Check for conflicts
      const conflictFiles = git('diff --name-only --diff-filter=U');
      
      if (conflictFiles) {
        const db2 = createElegyDb();
        const conflicted = [];
        const now = new Date().toISOString();

        for (const file of conflictFiles.split('\n').filter(Boolean)) {
          const filePath = path.join(vaultPath, file);
          if (!fs.existsSync(filePath)) continue;

          const raw = fs.readFileSync(filePath, 'utf8');
          const parts = raw.split(/^=======\s*$/m);
          
          // Extract note id from filename
          const noteId = file.replace(/\.md$/, '');
          const existingNote = db2.getNote(noteId);

          if (existingNote && parts.length >= 2) {
            // Create conflict block with remote version
            const remoteContent = parts[1] ? parts[1].replace(/^>>>>>>>.*$/gm, '').trim() : raw;
            
            const blockId = crypto.randomUUID();
            db2.createBlock({
              id: blockId,
              note_id: noteId,
              block_kind: 'conflict',
              position: (db2.listBlocksByNote(noteId).length + 1),
              body: `Remote version:\n\n${remoteContent}`,
              source_run_id: null,
              created_at: now,
              updated_at: now,
            });

            // Tag the note
            let tags = [];
            try { tags = JSON.parse(existingNote.tags_json); } catch {}
            if (!tags.includes('conflict:needs-review')) {
              tags.push('conflict:needs-review');
            }

            db2.updateNote({
              id: noteId,
              title: existingNote.title,
              content: parts[0] ? parts[0].replace(/^<<<<<<<.*$/gm, '').trim() : existingNote.content,
              theme: existingNote.theme,
              tags_json: JSON.stringify(tags),
              updated_at: now,
              archived: existingNote.archived,
              repo_path: existingNote.repo_path,
              session_id: existingNote.session_id,
            });

            conflicted.push({ id: noteId, title: existingNote.title });
          }

          // Resolve conflict: accept ours
          try { git(`checkout --ours ${file}`); } catch {}
        }

        db2.close();
        git('add -A');
        try { git('commit -m "notes: resolve conflicts (ours)"'); } catch {}

        sendJson(res, 200, {
          pulled: true,
          conflicts: conflicted.length,
          conflictedNotes: conflicted.length > 0 ? conflicted : undefined,
          message: conflicted.length > 0 ? `${conflicted.length} note(s) had conflicts. Remote versions saved as conflict blocks. Review notes tagged "conflict:needs-review".` : 'No conflicts.',
        });
        return;
      }

      throw mergeErr;
    }

    sendJson(res, 200, { pulled: true, message: 'Pull complete, no conflicts.' });
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
}

// ── Git Sync Status ──
function handleNotesSyncStatus(ctx, deps) {
  const { res } = ctx;
  const { sendJson } = deps;

  try {
    const db = createElegyDb();
    const gitConfigRaw = db.getNoteSetting('git_sync_config');
    db.close();

    if (!gitConfigRaw) {
      sendJson(res, 200, { configured: false });
      return;
    }

    const config = typeof gitConfigRaw === 'string' ? JSON.parse(gitConfigRaw) : gitConfigRaw;
    const vaultPath = config.localClonePath || path.join(os.homedir(), '.elegy', 'notes-vault');

    let status = { configured: true, enabled: config.enabled, repoUrl: config.repoUrl, branch: config.branch || 'main', vaultExists: false };

    if (fs.existsSync(path.join(vaultPath, '.git'))) {
      status.vaultExists = true;
      try {
        const git = (args) => cp.execSync(`git ${args}`, { cwd: vaultPath, encoding: 'utf8', timeout: 10000, stdio: 'pipe' }).trim();
        status.currentBranch = git('branch --show-current');
        status.lastCommit = git('log -1 --format=%s');
        status.lastCommitDate = git('log -1 --format=%ci');
      } catch {}
    }

    sendJson(res, 200, status);
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
    { method: 'POST', path: '/api/notes/export', handler: (ctx) => handleNotesExport(ctx, deps) },
    { method: 'POST', path: '/api/notes/import', handler: (ctx) => handleNotesImport(ctx, deps) },
    { method: 'GET',  path: '/api/notes/settings', handler: (ctx) => handleNotesSettingsList(ctx, deps) },
    { method: 'GET',  path: '/api/notes/settings/get', handler: (ctx) => handleNotesSettingsGet(ctx, deps) },
    { method: 'POST', path: '/api/notes/settings/set', handler: (ctx) => handleNotesSettingsSet(ctx, deps) },
    { method: 'DELETE', path: '/api/notes/settings/delete', handler: (ctx) => handleNotesSettingsDelete(ctx, deps) },
    { method: 'POST', path: '/api/notes/sync/push',   handler: (ctx) => handleNotesSyncPush(ctx, deps) },
    { method: 'POST', path: '/api/notes/sync/pull',   handler: (ctx) => handleNotesSyncPull(ctx, deps) },
    { method: 'GET',  path: '/api/notes/sync/status', handler: (ctx) => handleNotesSyncStatus(ctx, deps) },
  ];
}

module.exports = { register };
