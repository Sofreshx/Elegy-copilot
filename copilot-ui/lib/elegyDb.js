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

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  // better-sqlite3 may not be installed; module will throw on createElegyDb
  Database = null;
}

const SCHEMA_VERSION = 1;

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

  // Future migrations go here as else-if blocks:
  // if (currentVersion < 2) { ... db.pragma('user_version = 2'); }
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
 * @param {string} [opts.dbPath] - Override database path (default: ~/.copilot/elegy-copilot.db)
 * @param {boolean} [opts.readonly] - Open in read-only mode
 * @returns {object} db instance with helper methods
 */
function createElegyDb(opts = {}) {
  if (!Database) {
    throw new Error(
      'better-sqlite3 is not available. Install it with: npm install better-sqlite3',
    );
  }

  const dbPath = opts.dbPath && typeof opts.dbPath === 'string' && opts.dbPath.trim()
    ? opts.dbPath.trim()
    : path.join(os.homedir(), '.copilot', 'elegy-copilot.db');
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
  };
}

module.exports = { createElegyDb };
