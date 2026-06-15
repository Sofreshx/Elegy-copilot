'use strict';

const path = require('path');
const os = require('os');

/**
 * Elegy Copilot SQLite database module.
 * Provides session, worktree, hook event, and repo asset persistence
 * using better-sqlite3 (synchronous API).
 *
 * @module elegyDb
 */

const Database = require('better-sqlite3');
const sqliteVec = require('@photostructure/sqlite-vec');

const SCHEMA_VERSION = 2;

const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'copilot',
    harness TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    title TEXT,
    repo_path TEXT,
    repo_id TEXT,
    branch TEXT,
    worktree_path TEXT,
    model TEXT,
    plan_id TEXT,
    goal_id TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL,
    metadata_json TEXT
  )
`;

const CREATE_WORKTREES_TABLE = `
  CREATE TABLE IF NOT EXISTS worktrees (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    repo_path TEXT,
    repo_id TEXT,
    branch TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    status TEXT NOT NULL DEFAULT 'ready',
    head_sha TEXT,
    detached INTEGER DEFAULT 0,
    locked TEXT,
    session_count INTEGER DEFAULT 0,
    last_activity_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT
  )
`;

const CREATE_SESSION_WORKTREES_TABLE = `
  CREATE TABLE IF NOT EXISTS session_worktrees (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    worktree_id TEXT NOT NULL REFERENCES worktrees(id),
    assigned_at TEXT NOT NULL,
    released_at TEXT,
    PRIMARY KEY (session_id, worktree_id)
  )
`;

const CREATE_HOOK_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS hook_events (
    id TEXT PRIMARY KEY,
    hook_type TEXT NOT NULL,
    harness TEXT,
    session_id TEXT,
    worktree_id TEXT,
    repo_path TEXT,
    event_data_json TEXT,
    created_at TEXT NOT NULL
  )
`;

const CREATE_REPO_ASSETS_TABLE = `
  CREATE TABLE IF NOT EXISTS repo_assets (
    repo_path TEXT NOT NULL,
    repo_id TEXT,
    asset_id TEXT NOT NULL,
    asset_kind TEXT NOT NULL,
    harness TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    source_path TEXT,
    PRIMARY KEY (repo_path, asset_id, harness)
  )
`;

const CREATE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_repo_path ON sessions(repo_path)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_worktree_path ON sessions(worktree_path)',
  'CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status)',
  'CREATE INDEX IF NOT EXISTS idx_worktrees_repo_path ON worktrees(repo_path)',
  'CREATE INDEX IF NOT EXISTS idx_worktrees_source ON worktrees(source)',
  'CREATE INDEX IF NOT EXISTS idx_hook_events_session ON hook_events(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_hook_events_type ON hook_events(hook_type)',
  'CREATE INDEX IF NOT EXISTS idx_repo_assets_repo ON repo_assets(repo_path)',
  'CREATE INDEX IF NOT EXISTS idx_repo_assets_harness ON repo_assets(harness)',
];

/**
 * Run migrations up to the target schema version.
 * @param {import('better-sqlite3').Database} db
 * @param {number} targetVersion
 */
function runMigrations(db, targetVersion) {
  const currentVersion = db.pragma('user_version', { simple: true });

  if (currentVersion >= targetVersion) {
    return;
  }

  if (currentVersion < 1) {
    db.exec(CREATE_SESSIONS_TABLE);
    db.exec(CREATE_WORKTREES_TABLE);
    db.exec(CREATE_SESSION_WORKTREES_TABLE);
    db.exec(CREATE_HOOK_EVENTS_TABLE);
    db.exec(CREATE_REPO_ASSETS_TABLE);
    for (const sql of CREATE_INDEXES) {
      db.exec(sql);
    }
    db.pragma('user_version = 1');
  }

  if (currentVersion < 2) {
    // notes — core table
    db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL DEFAULT '',
      content      TEXT NOT NULL DEFAULT '',
      theme        TEXT,
      tags_json    TEXT NOT NULL DEFAULT '[]',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      archived     INTEGER NOT NULL DEFAULT 0,
      repo_path    TEXT,
      session_id   TEXT
    )`);

    // FTS5 — full-text search on title, content, tags
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title, content, tags_json,
      content=notes, content_rowid=rowid
    )`);

    // Triggers to keep FTS5 in sync
    db.exec(`CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content, tags_json)
      VALUES (new.rowid, new.title, new.content, new.tags_json);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags_json);
    END`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content, tags_json)
      VALUES ('delete', old.rowid, old.title, old.content, old.tags_json);
      INSERT INTO notes_fts(rowid, title, content, tags_json)
      VALUES (new.rowid, new.title, new.content, new.tags_json);
    END`);

    // note_settings — key-value store
    db.exec(`CREATE TABLE IF NOT EXISTS note_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    // note_blocks — structured content blocks within a note
    db.exec(`CREATE TABLE IF NOT EXISTS note_blocks (
      id            TEXT PRIMARY KEY,
      note_id       TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      block_kind    TEXT NOT NULL,
      position      INTEGER NOT NULL,
      body          TEXT NOT NULL,
      source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )`);

    // agent_runs — agent invocation tracking
    db.exec(`CREATE TABLE IF NOT EXISTS agent_runs (
      id                  TEXT PRIMARY KEY,
      session_id          TEXT,
      parent_kind         TEXT NOT NULL,
      parent_id           TEXT,
      note_id             TEXT,
      action              TEXT NOT NULL,
      agent_name          TEXT NOT NULL,
      provider_id         TEXT,
      model_id            TEXT,
      model_id_original   TEXT,
      prompt_summary      TEXT,
      extra_instructions  TEXT,
      repo_access_enabled INTEGER NOT NULL DEFAULT 0,
      status              TEXT NOT NULL,
      started_at          TEXT NOT NULL,
      ended_at            TEXT,
      duration_ms         INTEGER,
      prompt_tokens       INTEGER,
      output_tokens       INTEGER,
      reasoning_tokens    INTEGER,
      cache_read          INTEGER,
      cache_write         INTEGER,
      cost_usd            REAL,
      error_code          TEXT,
      error_message       TEXT,
      output_text         TEXT,
      result_block_id     TEXT,
      metadata_json       TEXT,
      created_by          TEXT NOT NULL DEFAULT 'user',
      workspace_id        TEXT
    )`);

    // vec0 — vector embeddings for semantic search
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(
      embedding float[384]
    )`);

    // Indexes
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_theme     ON notes(theme)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_updated    ON notes(updated_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_notes_archived   ON notes(archived)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_blocks_note ON note_blocks(note_id, position)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_note_blocks_kind ON note_blocks(block_kind)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_note  ON agent_runs(note_id, started_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_kind, parent_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at DESC)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_action ON agent_runs(action, started_at DESC)');

    db.pragma('user_version = 2');
  }
}

/**
 * Safely parse a JSON string, returning null on failure.
 * @param {string} str
 * @returns {object|null}
 */
function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Build a filter clause and params array for list queries.
 * @param {object} filter - Filter criteria
 * @param {string} [filter.status]
 * @param {string} [filter.source]
 * @param {string} [filter.repoPath]
 * @param {string} [filter.worktreePath]
 * @param {string} [filter.hookType]
 * @param {string} [filter.sessionId]
 * @param {string} [filter.worktreeId]
 * @param {number} [filter.limit]
 * @param {number} [filter.offset]
 * @param {string} tableAlias - Table alias for column references
 * @param {Array<string>} extraColumns - Additional columns to filter on (e.g. 'hook_type', 'session_id')
 * @returns {{ whereClause: string, params: object, limitClause: string, offsetClause: string }}
 */
function buildFilterQuery(filter = {}, tableAlias = '', extraColumns = []) {
  const conditions = [];
  const params = {};
  const prefix = tableAlias ? tableAlias + '.' : '';

  const filterMap = {
    status: 'status',
    source: 'source',
    repoPath: 'repo_path',
    worktreePath: 'worktree_path',
    hookType: 'hook_type',
    sessionId: 'session_id',
    worktreeId: 'worktree_id',
  };

  // Merge extra columns into filter map
  for (const col of extraColumns) {
    if (!Object.values(filterMap).includes(col)) {
      // No-op, extra columns are handled separately
    }
  }

  for (const [key, col] of Object.entries(filterMap)) {
    if (filter[key] !== undefined && filter[key] !== null && filter[key] !== '') {
      conditions.push(`${prefix}${col} = @${key}`);
      params[key] = filter[key];
    }
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limitClause = Number.isFinite(filter.limit) && filter.limit > 0
    ? ' LIMIT ' + Math.floor(filter.limit)
    : '';
  const offsetClause = Number.isFinite(filter.offset) && filter.offset > 0
    ? ' OFFSET ' + Math.floor(filter.offset)
    : '';

  return { whereClause, params, limitClause, offsetClause };
}

/**
 * Create or open the Elegy Copilot SQLite database.
 * @param {object} [opts]
 * @param {string} [opts.dbPath] - Override database path (default: ~/.elegy/elegy-copilot.db)
 * @param {boolean} [opts.readonly] - Open in read-only mode
 * @returns {object} db instance with helper methods
 */
function createElegyDb(opts = {}) {
  const dbPath = opts.dbPath && typeof opts.dbPath === 'string' && opts.dbPath.trim()
    ? opts.dbPath.trim()
    : path.join(os.homedir(), '.elegy', 'elegy-copilot.db');
  const readonly = opts.readonly === true;

  // Ensure parent directory exists for default path
  const dir = path.dirname(dbPath);
  try {
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {
    // Best effort - let better-sqlite3 handle it
  }

  const db = new Database(dbPath, {
    readonly,
    fileMustExist: readonly,
  });

  // Enable WAL mode for better concurrent read performance
  if (!readonly) {
    db.pragma('journal_mode = WAL');
  }

  // Load sqlite-vec extension for vector search
  if (!readonly) {
    sqliteVec.load(db);
  }

  // Run migrations
  if (!readonly) {
    runMigrations(db, SCHEMA_VERSION);
  }

  /**
   * Get database health information.
   * @returns {{ ok: boolean, dbPath: string, tableCount: number, userVersion: number, readonly: boolean }}
   */
  function getHealth() {
    let tableCount = 0;
    try {
      const rows = db.prepare(
        "SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table'",
      ).get();
      tableCount = rows ? rows.cnt : 0;
    } catch {
      tableCount = -1;
    }

    return {
      ok: true,
      dbPath,
      tableCount,
      userVersion: db.pragma('user_version', { simple: true }),
      readonly,
    };
  }

  /**
   * Close the database connection.
   */
  function close() {
    db.close();
  }

  // ── Session Methods ──────────────────────────────────────────────

  /**
   * Get a session by ID.
   * @param {string} sessionId
   * @returns {object|null}
   */
  function getSession(sessionId) {
    try {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
      return row || null;
    } catch {
      return null;
    }
  }

  /**
   * List sessions with optional filters.
   * @param {object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.source]
   * @param {string} [filter.repoPath]
   * @param {string} [filter.worktreePath]
   * @param {number} [filter.limit]
   * @param {number} [filter.offset]
   * @returns {Array<object>}
   */
  function listSessions(filter = {}) {
    try {
      const { whereClause, params, limitClause, offsetClause } = buildFilterQuery(filter, 's');
      const sql = `SELECT * FROM sessions s ${whereClause} ORDER BY s.updated_at DESC${limitClause}${offsetClause}`;
      return db.prepare(sql).all(params);
    } catch {
      return [];
    }
  }

  /**
   * Insert or update a session record.
   * @param {object} session
   * @returns {object} The upserted session on success, null on error
   */
  function upsertSession(session) {
    try {
      const stmt = db.prepare(`
        INSERT INTO sessions (id, source, harness, status, title, repo_path, repo_id, branch, worktree_path, model, plan_id, goal_id, started_at, ended_at, updated_at, metadata_json)
        VALUES (@id, @source, @harness, @status, @title, @repo_path, @repo_id, @branch, @worktree_path, @model, @plan_id, @goal_id, @started_at, @ended_at, @updated_at, @metadata_json)
        ON CONFLICT(id) DO UPDATE SET
          source = COALESCE(@source, source),
          harness = COALESCE(@harness, harness),
          status = COALESCE(@status, status),
          title = COALESCE(@title, title),
          repo_path = COALESCE(@repo_path, repo_path),
          repo_id = COALESCE(@repo_id, repo_id),
          branch = COALESCE(@branch, branch),
          worktree_path = COALESCE(@worktree_path, worktree_path),
          model = COALESCE(@model, model),
          plan_id = COALESCE(@plan_id, plan_id),
          goal_id = COALESCE(@goal_id, goal_id),
          ended_at = COALESCE(@ended_at, ended_at),
          updated_at = @updated_at,
          metadata_json = COALESCE(@metadata_json, metadata_json)
      `);
      const result = stmt.run(session);
      return result.changes > 0 ? getSession(session.id) : null;
    } catch {
      return null;
    }
  }

  // ── Worktree Methods ─────────────────────────────────────────────

  /**
   * Get a worktree by ID.
   * @param {string} worktreeId
   * @returns {object|null}
   */
  function getWorktree(worktreeId) {
    try {
      const row = db.prepare('SELECT * FROM worktrees WHERE id = ?').get(worktreeId);
      return row || null;
    } catch {
      return null;
    }
  }

  /**
   * Get a worktree by path.
   * @param {string} worktreePath
   * @returns {object|null}
   */
  function getWorktreeByPath(worktreePath) {
    try {
      const row = db.prepare('SELECT * FROM worktrees WHERE path = ?').get(worktreePath);
      return row || null;
    } catch {
      return null;
    }
  }

  /**
   * Insert or update a worktree record.
   * @param {object} worktree
   * @returns {object} The upserted worktree on success, null on error
   */
  function upsertWorktree(worktree) {
    try {
      const stmt = db.prepare(`
        INSERT INTO worktrees (id, path, repo_path, repo_id, branch, source, status, head_sha, detached, locked, session_count, last_activity_at, created_at, updated_at, metadata_json)
        VALUES (@id, @path, @repo_path, @repo_id, @branch, @source, @status, @head_sha, @detached, @locked, @session_count, @last_activity_at, @created_at, @updated_at, @metadata_json)
        ON CONFLICT(id) DO UPDATE SET
          path = COALESCE(@path, path),
          repo_path = COALESCE(@repo_path, repo_path),
          repo_id = COALESCE(@repo_id, repo_id),
          branch = COALESCE(@branch, branch),
          source = COALESCE(@source, source),
          status = COALESCE(@status, status),
          head_sha = COALESCE(@head_sha, head_sha),
          detached = COALESCE(@detached, detached),
          locked = COALESCE(@locked, locked),
          session_count = COALESCE(@session_count, session_count),
          last_activity_at = COALESCE(@last_activity_at, last_activity_at),
          updated_at = @updated_at,
          metadata_json = COALESCE(@metadata_json, metadata_json)
      `);
      const result = stmt.run(worktree);
      return result.changes > 0 ? getWorktree(worktree.id) : null;
    } catch {
      return null;
    }
  }

  /**
   * List worktrees with optional filters.
   * @param {object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.source]
   * @param {string} [filter.repoPath]
   * @param {number} [filter.limit]
   * @returns {Array<object>}
   */
  function listWorktrees(filter = {}) {
    try {
      const { whereClause, params, limitClause, offsetClause } = buildFilterQuery(filter, 'w');
      const sql = `SELECT * FROM worktrees w ${whereClause} ORDER BY w.updated_at DESC${limitClause}${offsetClause}`;
      return db.prepare(sql).all(params);
    } catch {
      return [];
    }
  }

  /**
   * List worktrees for a specific repo path.
   * @param {string} repoPath
   * @returns {Array<object>}
   */
  function listWorktreesByRepo(repoPath) {
    return listWorktrees({ repoPath });
  }

  // ── Session-Worktree Junction Methods ────────────────────────────

  /**
   * Link a session to a worktree.
   * @param {string} sessionId
   * @param {string} worktreeId
   * @returns {boolean}
   */
  function linkSessionWorktree(sessionId, worktreeId) {
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO session_worktrees (session_id, worktree_id, assigned_at)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(sessionId, worktreeId, new Date().toISOString());
      return result.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * Unlink (release) a session-worktree link.
   * @param {string} sessionId
   * @param {string} worktreeId
   * @returns {boolean}
   */
  function unlinkSessionWorktree(sessionId, worktreeId) {
    try {
      const stmt = db.prepare(`
        UPDATE session_worktrees SET released_at = ?
        WHERE session_id = ? AND worktree_id = ?
      `);
      const result = stmt.run(new Date().toISOString(), sessionId, worktreeId);
      return result.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * List sessions linked to a worktree.
   * @param {string} worktreePath
   * @returns {Array<object>}
   */
  function listSessionsByWorktree(worktreePath) {
    try {
      const sql = `
        SELECT s.*
        FROM sessions s
        INNER JOIN session_worktrees sw ON sw.session_id = s.id
        INNER JOIN worktrees w ON w.id = sw.worktree_id
        WHERE w.path = ? AND sw.released_at IS NULL
        ORDER BY sw.assigned_at DESC
      `;
      return db.prepare(sql).all(worktreePath);
    } catch {
      return [];
    }
  }

  // ── Hook Event Methods ────────────────────────────────────────────

  /**
   * Record a hook event.
   * @param {object} event
   * @returns {object|null} The inserted event record, or null on error
   */
  function recordHookEvent(event) {
    try {
      const stmt = db.prepare(`
        INSERT INTO hook_events (id, hook_type, harness, session_id, worktree_id, repo_path, event_data_json, created_at)
        VALUES (@id, @hook_type, @harness, @session_id, @worktree_id, @repo_path, @event_data_json, @created_at)
      `);
      stmt.run(event);
      return db.prepare('SELECT * FROM hook_events WHERE id = ?').get(event.id) || null;
    } catch {
      return null;
    }
  }

  /**
   * List hook events with optional filters.
   * @param {object} [filter]
   * @param {string} [filter.hookType]
   * @param {string} [filter.sessionId]
   * @param {string} [filter.worktreeId]
   * @param {number} [filter.limit]
   * @returns {Array<object>}
   */
  function listHookEvents(filter = {}) {
    try {
      const { whereClause, params, limitClause, offsetClause } = buildFilterQuery(filter, 'he');
      const sql = `SELECT * FROM hook_events he ${whereClause} ORDER BY he.created_at DESC${limitClause}${offsetClause}`;
      return db.prepare(sql).all(params);
    } catch {
      return [];
    }
  }

  // ── Repo Asset Methods ────────────────────────────────────────────

  /**
   * Get all repo assets for a given repo path.
   * @param {string} repoPath
   * @returns {Array<object>}
   */
  function getRepoAssets(repoPath) {
    try {
      return db.prepare('SELECT * FROM repo_assets WHERE repo_path = ? ORDER BY asset_kind, asset_id').all(repoPath);
    } catch {
      return [];
    }
  }

  /**
   * Insert or update a repo asset install record.
   * @param {object} asset
   * @returns {object|null} The upserted asset record, or null on error
   */
  function upsertRepoAsset(asset) {
    try {
      const stmt = db.prepare(`
        INSERT INTO repo_assets (repo_path, repo_id, asset_id, asset_kind, harness, installed_at, updated_at, source_path)
        VALUES (@repo_path, @repo_id, @asset_id, @asset_kind, @harness, @installed_at, @updated_at, @source_path)
        ON CONFLICT(repo_path, asset_id, harness) DO UPDATE SET
          repo_id = COALESCE(@repo_id, repo_id),
          asset_kind = COALESCE(@asset_kind, asset_kind),
          installed_at = COALESCE(@installed_at, installed_at),
          updated_at = @updated_at,
          source_path = COALESCE(@source_path, source_path)
      `);
      const result = stmt.run(asset);
      if (result.changes > 0) {
        return db.prepare(
          'SELECT * FROM repo_assets WHERE repo_path = ? AND asset_id = ? AND harness = ?',
        ).get(asset.repo_path, asset.asset_id, asset.harness) || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Remove a repo asset record.
   * @param {string} repoPath
   * @param {string} assetId
   * @param {string} harness
   * @returns {boolean}
   */
  function removeRepoAsset(repoPath, assetId, harness) {
    try {
      const result = db.prepare(
        'DELETE FROM repo_assets WHERE repo_path = ? AND asset_id = ? AND harness = ?',
      ).run(repoPath, assetId, harness);
      return result.changes > 0;
    } catch {
      return false;
    }
  }

  // ── Notes Methods ────────────────────────────────────────────────

  // ── Notes CRUD ──

  /**
   * Create a new note.
   * @param {object} note
   * @returns {object|null} The created note, or null on error
   */
  function createNote(note) {
    try {
      const stmt = db.prepare(`
        INSERT INTO notes (id, title, content, theme, tags_json, created_at, updated_at, archived, repo_path, session_id)
        VALUES (@id, @title, @content, @theme, @tags_json, @created_at, @updated_at, @archived, @repo_path, @session_id)
      `);
      stmt.run(note);
      return getNote(note.id);
    } catch { return null; }
  }

  /**
   * Get a note by ID.
   * @param {string} noteId
   * @returns {object|null}
   */
  function getNote(noteId) {
    try {
      return db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) || null;
    } catch { return null; }
  }

  /**
   * Update a note.
   * @param {object} note
   * @returns {object|null} The updated note, or null on error
   */
  function updateNote(note) {
    try {
      const stmt = db.prepare(`
        UPDATE notes SET
          title = @title, content = @content, theme = @theme, tags_json = @tags_json,
          updated_at = @updated_at, archived = @archived, repo_path = @repo_path, session_id = @session_id
        WHERE id = @id
      `);
      stmt.run(note);
      return getNote(note.id);
    } catch { return null; }
  }

  /**
   * List notes with optional filters.
   * @param {object} [filter]
   * @param {string} [filter.theme]
   * @param {boolean} [filter.archived]
   * @param {string} [filter.tag]
   * @param {number} [filter.limit]
   * @param {number} [filter.offset]
   * @param {string} [filter.order]
   * @returns {Array<object>}
   */
  function listNotes(filter = {}) {
    try {
      const conditions = [];
      const params = {};
      if (filter.theme) { conditions.push('theme = @theme'); params.theme = filter.theme; }
      if (filter.archived !== undefined) { conditions.push('archived = @archived'); params.archived = filter.archived ? 1 : 0; }
      if (filter.tag) { conditions.push("tags_json LIKE '%' || @tag || '%'"); params.tag = filter.tag; }
      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      const limit = filter.limit ? ' LIMIT ' + Math.floor(filter.limit) : '';
      const offset = filter.offset ? ' OFFSET ' + Math.floor(filter.offset) : '';
      const order = filter.order || 'updated_at DESC';
      return db.prepare(`SELECT * FROM notes ${where} ORDER BY ${order}${limit}${offset}`).all(params);
    } catch { return []; }
  }

  /**
   * Full-text search notes using FTS5.
   * @param {string} query
   * @param {object} [filter]
   * @param {number} [filter.limit]
   * @returns {Array<object>}
   */
  function searchNotes(query, filter = {}) {
    try {
      // Use FTS5 MATCH for full-text search
      const ftsQuery = query.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean).map(w => `"${w}"`).join(' ');
      const rows = db.prepare(`
        SELECT n.* FROM notes n
        JOIN notes_fts fts ON n.rowid = fts.rowid
        WHERE notes_fts MATCH @query
        ORDER BY rank
        LIMIT @limit
      `).all({ query: ftsQuery, limit: filter.limit || 50 });
      return rows;
    } catch { return []; }
  }

  /**
   * Delete a note by ID.
   * @param {string} noteId
   * @returns {boolean}
   */
  function deleteNote(noteId) {
    try {
      return db.prepare('DELETE FROM notes WHERE id = ?').run(noteId).changes > 0;
    } catch { return false; }
  }

  // ── Note Settings ──

  /**
   * Get a note setting value by key.
   * @param {string} key
   * @returns {*|null}
   */
  function getNoteSetting(key) {
    try {
      const row = db.prepare('SELECT value FROM note_settings WHERE key = ?').get(key);
      if (!row) return null;
      try { return JSON.parse(row.value); } catch { return row.value; }
    } catch { return null; }
  }

  /**
   * Set a note setting (upsert).
   * @param {string} key
   * @param {*} value
   * @returns {boolean}
   */
  function setNoteSetting(key, value) {
    try {
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      db.prepare('INSERT INTO note_settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value').run({ key, value: val });
      return true;
    } catch { return false; }
  }

  /**
   * Delete a note setting by key.
   * @param {string} key
   * @returns {boolean}
   */
  function deleteNoteSetting(key) {
    try {
      return db.prepare('DELETE FROM note_settings WHERE key = ?').run(key).changes > 0;
    } catch { return false; }
  }

  /**
   * List all note settings.
   * @returns {Array<object>}
   */
  function listNoteSettings() {
    try {
      return db.prepare('SELECT key, value FROM note_settings ORDER BY key').all();
    } catch { return []; }
  }

  // ── Note Blocks ──

  /**
   * Create a new note block.
   * @param {object} block
   * @returns {object|null} The created block, or null on error
   */
  function createBlock(block) {
    try {
      db.prepare(`
        INSERT INTO note_blocks (id, note_id, block_kind, position, body, source_run_id, created_at, updated_at)
        VALUES (@id, @note_id, @block_kind, @position, @body, @source_run_id, @created_at, @updated_at)
      `).run(block);
      return db.prepare('SELECT * FROM note_blocks WHERE id = ?').get(block.id) || null;
    } catch { return null; }
  }

  /**
   * List blocks for a note, ordered by position.
   * @param {string} noteId
   * @returns {Array<object>}
   */
  function listBlocksByNote(noteId) {
    try {
      return db.prepare('SELECT * FROM note_blocks WHERE note_id = ? ORDER BY position').all(noteId);
    } catch { return []; }
  }

  /**
   * Delete a block by ID.
   * @param {string} blockId
   * @returns {boolean}
   */
  function deleteBlock(blockId) {
    try {
      return db.prepare('DELETE FROM note_blocks WHERE id = ?').run(blockId).changes > 0;
    } catch { return false; }
  }

  // ── Agent Runs ──

  /**
   * Create a new agent run record.
   * @param {object} run
   * @returns {object|null} The created run, or null on error
   */
  function createRun(run) {
    try {
      db.prepare(`
        INSERT INTO agent_runs (id, session_id, parent_kind, parent_id, note_id, action, agent_name,
          provider_id, model_id, model_id_original, prompt_summary, extra_instructions,
          repo_access_enabled, status, started_at, ended_at, duration_ms, prompt_tokens,
          output_tokens, reasoning_tokens, cache_read, cache_write, cost_usd,
          error_code, error_message, output_text, result_block_id, metadata_json, created_by, workspace_id)
        VALUES (@id, @session_id, @parent_kind, @parent_id, @note_id, @action, @agent_name,
          @provider_id, @model_id, @model_id_original, @prompt_summary, @extra_instructions,
          @repo_access_enabled, @status, @started_at, @ended_at, @duration_ms, @prompt_tokens,
          @output_tokens, @reasoning_tokens, @cache_read, @cache_write, @cost_usd,
          @error_code, @error_message, @output_text, @result_block_id, @metadata_json, @created_by, @workspace_id)
      `).run(run);
      return getRun(run.id);
    } catch { return null; }
  }

  /**
   * Get an agent run by ID.
   * @param {string} runId
   * @returns {object|null}
   */
  function getRun(runId) {
    try {
      return db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) || null;
    } catch { return null; }
  }

  /**
   * Update an agent run record.
   * @param {object} run
   * @returns {object|null} The updated run, or null on error
   */
  function updateRun(run) {
    try {
      db.prepare(`
        UPDATE agent_runs SET
          session_id = @session_id, status = @status, ended_at = @ended_at, duration_ms = @duration_ms,
          prompt_tokens = @prompt_tokens, output_tokens = @output_tokens, reasoning_tokens = @reasoning_tokens,
          cache_read = @cache_read, cache_write = @cache_write, cost_usd = @cost_usd,
          error_code = @error_code, error_message = @error_message, output_text = @output_text,
          result_block_id = @result_block_id, metadata_json = @metadata_json
        WHERE id = @id
      `).run(run);
      return getRun(run.id);
    } catch { return null; }
  }

  /**
   * List runs by parent kind and ID.
   * @param {string} parentKind
   * @param {string} parentId
   * @param {object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.action]
   * @param {number} [filter.limit]
   * @returns {Array<object>}
   */
  function listRunsByParent(parentKind, parentId, filter = {}) {
    try {
      const conditions = ['parent_kind = @kind', 'parent_id = @pid'];
      const params = { kind: parentKind, pid: parentId };
      if (filter.status) { conditions.push('status = @status'); params.status = filter.status; }
      if (filter.action) { conditions.push('action = @action'); params.action = filter.action; }
      const limit = filter.limit ? ' LIMIT ' + Math.floor(filter.limit) : '';
      return db.prepare(`SELECT * FROM agent_runs WHERE ${conditions.join(' AND ')} ORDER BY started_at DESC${limit}`).all(params);
    } catch { return []; }
  }

  /**
   * List agent runs with optional filters.
   * @param {object} [filter]
   * @param {string} [filter.status]
   * @param {string} [filter.action]
   * @param {string} [filter.note_id]
   * @param {number} [filter.limit]
   * @returns {Array<object>}
   */
  function listRuns(filter = {}) {
    try {
      const conditions = [];
      const params = {};
      if (filter.status) { conditions.push('status = @status'); params.status = filter.status; }
      if (filter.action) { conditions.push('action = @action'); params.action = filter.action; }
      if (filter.note_id) { conditions.push('note_id = @note_id'); params.note_id = filter.note_id; }
      const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
      const limit = filter.limit ? ' LIMIT ' + Math.floor(filter.limit) : '';
      return db.prepare(`SELECT * FROM agent_runs ${where} ORDER BY started_at DESC${limit}`).all(params);
    } catch { return []; }
  }

  // ── Exposed API ───────────────────────────────────────────────────

  return {
    // Core
    close,
    getHealth,
    _db: db, // Exposed for sessionHooks internal use

    // Sessions
    getSession,
    listSessions,
    upsertSession,

    // Worktrees
    getWorktree,
    getWorktreeByPath,
    upsertWorktree,
    listWorktrees,
    listWorktreesByRepo,

    // Junction
    linkSessionWorktree,
    unlinkSessionWorktree,
    listSessionsByWorktree,

    // Hook events
    recordHookEvent,
    listHookEvents,

    // Repo assets
    getRepoAssets,
    upsertRepoAsset,
    removeRepoAsset,

    // Notes
    createNote,
    getNote,
    updateNote,
    listNotes,
    searchNotes,
    deleteNote,

    // Note Settings
    getNoteSetting,
    setNoteSetting,
    deleteNoteSetting,
    listNoteSettings,

    // Note Blocks
    createBlock,
    listBlocksByNote,
    deleteBlock,

    // Agent Runs
    createRun,
    getRun,
    updateRun,
    listRunsByParent,
    listRuns,
  };
}

module.exports = { createElegyDb };
