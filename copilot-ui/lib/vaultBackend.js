'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const vaultConfig = require('./vaultConfig');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((e) => normalizeString(e)).filter(Boolean);
}

function slugify(text) {
  return normalizeString(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

// ── Frontmatter parsing (no YAML lib dependency) ──

function parseFrontmatter(content) {
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  const attrs = {};

  if (!normalized.startsWith('---\n')) {
    return { attrs, body: normalized };
  }

  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) {
    return { attrs, body: normalized };
  }

  const fmLines = normalized.slice(4, endIndex).split('\n');
  const body = normalized.slice(endIndex + 5).replace(/^\n+/, '');

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valueRaw = trimmed.slice(colonIdx + 1).trim();

    if (!key) continue;

    // YAML array: [item1, item2] or [tag1, tag2]
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      const inner = valueRaw.slice(1, -1);
      attrs[key] = inner.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
      continue;
    }

    // YAML scalar
    const cleaned = valueRaw.replace(/^['"]|['"]$/g, '');
    attrs[key] = cleaned || null;
  }

  return { attrs, body };
}

function buildFrontmatter(attrs) {
  let fm = '---\n';
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      fm += `${key}: [${value.map((v) => String(v).includes(' ') ? `"${v}"` : v).join(', ')}]\n`;
    } else {
      fm += `${key}: ${String(value)}\n`;
    }
  }
  fm += '---\n\n';
  return fm;
}

// ── vaultPath resolution ──

function ensureVaultPath() {
  const config = vaultConfig.readConfig();
  if (!config.vaultPath) {
    throw new Error('Obsidian vault path not configured. Set vaultPath in ~/.elegy/obsidian-vault.json or IE_OBSIDIAN_VAULT_PATH env var.');
  }
  if (!fs.existsSync(config.vaultPath)) {
    throw new Error(`Obsidian vault path does not exist: ${config.vaultPath}`);
  }
  if (!fs.statSync(config.vaultPath).isDirectory()) {
    throw new Error(`Obsidian vault path is not a directory: ${config.vaultPath}`);
  }
  return config;
}

function getConfig() {
  return vaultConfig.readConfig();
}

// ── File walking ──

function walkMdFiles(dir, excludeDirs) {
  const results = [];
  const exclude = new Set(excludeDirs || ['.obsidian', '.git', '.trash', '_elegy-copilot', 'node_modules']);

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!exclude.has(entry.name)) {
          walk(abs);
        }
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(abs);
      }
    }
  }

  walk(dir);
  return results.sort((a, b) => a.localeCompare(b));
}

// ── Note object construction ──

function buildNote(filePath, vaultBase, config) {
  const content = fs.readFileSync(filePath, 'utf8');
  const { attrs, body } = parseFrontmatter(content);
  const stat = fs.statSync(filePath);

  const relativeToVault = path.relative(vaultBase, filePath).replace(/\\/g, '/');
  const fileName = path.basename(filePath, '.md');
  const slug = slugify(normalizeString(attrs.title) || fileName);

  const firstHeading = body.split('\n').map((l) => l.trim()).find((l) => /^#\s+/.test(l));
  const title = normalizeString(attrs.title) || (firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : fileName);
  const theme = normalizeString(attrs.theme) || deriveTheme(filePath, vaultBase);
  const tagsRaw = Array.isArray(attrs.tags) ? attrs.tags : (attrs.tags ? [String(attrs.tags)] : []);
  const tagsJson = JSON.stringify(tagsRaw);

  return {
    id: normalizeString(attrs.id) || slug || fileName,
    title,
    content: body,
    theme: theme || null,
    tags_json: tagsJson,
    created_at: normalizeString(attrs.created) || stat.birthtime?.toISOString() || new Date(stat.mtimeMs).toISOString(),
    updated_at: normalizeString(attrs.updated) || stat.mtime.toISOString(),
    archived: attrs.archived === true || attrs.archived === 'true' || attrs.archived === 1 || attrs.archived === '1' ? 1 : 0,
    repo_path: normalizeString(attrs.repo_path) || null,
    session_id: normalizeString(attrs.session_id) || null,
    filePath,
    relativePath: relativeToVault,
  };
}

function deriveTheme(filePath, vaultBase) {
  const rel = path.relative(vaultBase, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  if (parts.length >= 2) {
    return parts[0];
  }
  return null;
}

// ── CRUD operations ──

function listNotes(filter = {}) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath || !fs.existsSync(vaultPath)) return [];

  const files = walkMdFiles(vaultPath, config.excludeDirs);
  const notes = files
    .map((fp) => buildNote(fp, vaultPath, config))
    .filter((n) => {
      if (filter.theme && n.theme !== filter.theme) return false;
      if (filter.archived !== undefined) {
        const archived = filter.archived === true || filter.archived === 1 || filter.archived === 'true' || filter.archived === '1';
        if (n.archived ? !archived : archived) return false;
      }
      if (filter.tag) {
        const tags = parseTagsJson(n.tags_json);
        if (!tags.some((t) => t.toLowerCase().includes(filter.tag.toLowerCase()))) return false;
      }
      return true;
    });

  const limit = filter.limit || 10000;
  const offset = filter.offset || 0;
  const order = filter.order || 'updated_at DESC';

  const [orderField, orderDir] = order.split(/\s+/);
  const desc = orderDir?.toUpperCase() === 'DESC';

  notes.sort((a, b) => {
    let cmp = 0;
    if (orderField === 'title') cmp = a.title.localeCompare(b.title);
    else if (orderField === 'created_at') cmp = a.created_at.localeCompare(b.created_at);
    else cmp = a.updated_at.localeCompare(b.updated_at);
    return desc ? -cmp : cmp;
  });

  return notes.slice(offset, offset + limit);
}

function getNote(noteId) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath || !fs.existsSync(vaultPath)) return null;

  const files = walkMdFiles(vaultPath, config.excludeDirs);

  // Try matching by id in frontmatter, then by filename
  for (const fp of files) {
    const note = buildNote(fp, vaultPath, config);
    if (note.id === noteId) return note;
  }

  // Fallback: match by filename (without .md)
  for (const fp of files) {
    const fileName = path.basename(fp, '.md');
    if (fileName === noteId) {
      return buildNote(fp, vaultPath, config);
    }
  }

  return null;
}

function createNote(data) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath) {
    throw new Error('Vault path not configured');
  }

  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }

  const now = new Date().toISOString();
  const title = normalizeString(data.title) || 'Untitled';
  const slug = slugify(title);
  const id = normalizeString(data.id) || (slug + '-' + crypto.randomUUID().slice(0, 8));

  const attrs = {
    id,
    title,
    created: now,
    updated: now,
  };
  if (data.theme) attrs.theme = data.theme;
  if (Array.isArray(data.tags) && data.tags.length > 0) attrs.tags = data.tags;
  if (data.repo_path) attrs.repo_path = data.repo_path;
  if (data.session_id) attrs.session_id = data.session_id;

  // Place note in theme subdirectory if set
  let noteDir = vaultPath;
  if (data.theme) {
    noteDir = path.join(vaultPath, slugify(String(data.theme)));
    if (!fs.existsSync(noteDir)) {
      fs.mkdirSync(noteDir, { recursive: true });
    }
  }

  const fileName = slug + '.md';
  const filePath = path.join(noteDir, fileName);

  if (fs.existsSync(filePath)) {
    // Avoid overwrite: append UUID
    const uniqueName = slug + '-' + crypto.randomUUID().slice(0, 8) + '.md';
    const uniquePath = path.join(noteDir, uniqueName);
    const fm = buildFrontmatter(attrs);
    fs.writeFileSync(uniquePath, fm + (data.content || ''), 'utf8');
    return buildNote(uniquePath, vaultPath, config);
  }

  const fm = buildFrontmatter(attrs);
  fs.writeFileSync(filePath, fm + (data.content || ''), 'utf8');
  return buildNote(filePath, vaultPath, config);
}

function updateNote(data) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath) return null;

  const existing = getNote(data.id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const content = data.content !== undefined ? data.content : existing.content;
  const title = data.title !== undefined ? data.title : existing.title;

  // Read existing frontmatter to preserve unknown fields
  const raw = fs.readFileSync(existing.filePath, 'utf8');
  const { attrs: existingAttrs } = parseFrontmatter(raw);

  const tagsRaw = data.tags !== undefined ? data.tags : parseTagsJson(existing.tags_json);

  const attrs = {
    ...existingAttrs,
    id: existing.id,
    title,
    updated: now,
  };
  if (data.theme !== undefined) attrs.theme = data.theme;
  else if (existingAttrs.theme) attrs.theme = existingAttrs.theme;
  if (tagsRaw.length > 0) attrs.tags = tagsRaw;
  else delete attrs.tags;
  if (data.archived !== undefined) attrs.archived = data.archived === true || data.archived === 1 || data.archived === 'true';
  if (data.repo_path !== undefined) attrs.repo_path = data.repo_path;
  if (data.session_id !== undefined) attrs.session_id = data.session_id;

  // Preserve created
  if (existingAttrs.created) attrs.created = existingAttrs.created;

  const fm = buildFrontmatter(attrs);
  fs.writeFileSync(existing.filePath, fm + content, 'utf8');

  return buildNote(existing.filePath, vaultPath, config);
}

function deleteNote(noteId) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath) return false;

  const existing = getNote(noteId);
  if (!existing) return false;

  try {
    fs.unlinkSync(existing.filePath);
    return true;
  } catch {
    return false;
  }
}

function searchNotes(query, filter = {}) {
  const config = getConfig();
  const vaultPath = config.vaultPath;
  if (!vaultPath || !query) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const files = walkMdFiles(vaultPath, config.excludeDirs);
  const results = [];

  for (const fp of files) {
    try {
      const content = fs.readFileSync(fp, 'utf8');
      const lower = content.toLowerCase();
      if (terms.every((t) => lower.includes(t))) {
        results.push(buildNote(fp, vaultPath, config));
      }
    } catch {
      // skip unreadable files
    }
  }

  const limit = filter.limit || 50;
  // Sort by updated_at descending
  results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return results.slice(0, limit);
}

// ── Settings (stored in vault config file) ──

function getSetting(key) {
  const config = getConfig();
  if (key === 'git_sync_config') {
    const gdrive = config.gdrive || {};
    return JSON.stringify({
      enabled: config.git?.enabled || false,
      repoUrl: '',
      localClonePath: config.vaultPath || '',
      branch: 'main',
      commitAuthor: config.git?.authorName || 'user',
      gdriveCredsPath: gdrive.credsPath || '',
      gdriveTokenPath: gdrive.tokenPath || '',
      gdriveEnabled: gdrive.enabled || false,
      gdriveRemoteFolderName: gdrive.remoteFolderName || 'Dev-Vault-Backup',
    });
  }
  return null;
}

function setSetting(key, value) {
  if (key === 'git_sync_config') {
    // Vault config is managed via config file, not via settings API
    return true;
  }
  return false;
}

function listSettings() {
  const config = getConfig();
  return [
    { key: 'git_sync_config', value: getSetting('git_sync_config') },
    { key: 'vault_path', value: config.vaultPath || '' },
    { key: 'vault_configured', value: String(Boolean(config.vaultPath)) },
  ];
}

function deleteSetting(key) {
  return false;
}

// ── Utility ──

function parseTagsJson(tagsJson) {
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Block operations (deferred — return empty) ──

function listBlocksByNote(noteId) {
  return [];
}

function createBlock(block) {
  return null;
}

function deleteBlock(blockId) {
  return false;
}

module.exports = {
  listNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote,
  searchNotes,
  getSetting,
  setSetting,
  listSettings,
  deleteSetting,
  listBlocksByNote,
  createBlock,
  deleteBlock,
  parseFrontmatter,
  buildFrontmatter,
  parseTagsJson,
  getConfig,
};
