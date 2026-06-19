'use strict';

/**
 * Read-only SQLite reader for Kimaki's discord-sessions.db.
 * Uses better-sqlite3 (already a dep) in readonly + WAL mode.
 */

const Database = require('better-sqlite3');

/**
 * Open Kimaki's database in read-only mode.
 * @param {string} dbPath - Path to discord-sessions.db
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

/**
 * List all projects (directories mapped to Discord channels).
 * @param {string} dbPath
 * @returns {Array<{ directory: string, guildId?: string, channelId?: string, lastActivity?: string }>}
 */
function listProjects(dbPath) {
  const db = openDb(dbPath);
  try {
    const rows = db.prepare(`
      SELECT directory, channel_id, created_at
      FROM channel_directories
      WHERE channel_type = 'text'
      ORDER BY created_at DESC
    `).all();

    return rows.map((row) => ({
      directory: row.directory,
      channelId: row.channel_id || undefined,
      lastActivity: row.created_at || undefined,
    }));
  } finally {
    db.close();
  }
}

/**
 * List sessions (threads) with optional filters.
 * @param {string} dbPath
 * @param {Object} [filters]
 * @param {string} [filters.projectDir] - Filter by project directory
 * @param {string} [filters.status] - Filter by status
 * @param {number} [filters.limit] - Max results
 * @returns {Array<Object>}
 */
function listSessions(dbPath, filters = {}) {
  const db = openDb(dbPath);
  try {
    let sql = `
      SELECT t.thread_id, t.session_id, t.source, t.last_synced_name, t.created_at,
             w.project_directory,
             MAX(e.timestamp) AS updated_at
      FROM thread_sessions t
      LEFT JOIN thread_worktrees w ON t.thread_id = w.thread_id
      LEFT JOIN session_events e ON t.thread_id = e.thread_id
      WHERE 1=1
    `;
    const params = {};

    if (filters.projectDir) {
      sql += ` AND w.project_directory = @projectDir`;
      params.projectDir = filters.projectDir;
    }

    sql += `
      GROUP BY t.thread_id, t.session_id, t.source, t.last_synced_name, t.created_at, w.project_directory
      ORDER BY COALESCE(MAX(e.timestamp), t.created_at) DESC
    `;

    if (filters.limit) {
      sql += ` LIMIT @limit`;
      params.limit = filters.limit;
    }

    const rows = db.prepare(sql).all(params);

    return rows.map((row) => ({
      threadId: row.thread_id,
      sessionId: row.session_id,
      threadName: row.last_synced_name,
      status: row.source || 'kimaki',
      project: row.project_directory,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  } finally {
    db.close();
  }
}

/**
 * Get a single session by ID.
 * @param {string} dbPath
 * @param {string} sessionId
 * @returns {Object|null}
 */
function getSession(dbPath, sessionId) {
  const db = openDb(dbPath);
  try {
    const row = db.prepare(`
      SELECT t.thread_id, t.session_id, t.source, t.last_synced_name, t.created_at,
             w.project_directory,
             MAX(e.timestamp) AS updated_at
      FROM thread_sessions t
      LEFT JOIN thread_worktrees w ON t.thread_id = w.thread_id
      LEFT JOIN session_events e ON t.thread_id = e.thread_id
      WHERE t.thread_id = ?
      GROUP BY t.thread_id, t.session_id, t.source, t.last_synced_name, t.created_at, w.project_directory
    `).get(sessionId);

    if (!row) return null;

    return {
      threadId: row.thread_id,
      sessionId: row.session_id,
      threadName: row.last_synced_name,
      status: row.source || 'kimaki',
      project: row.project_directory,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

module.exports = { listProjects, listSessions, getSession };
