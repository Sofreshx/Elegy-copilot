'use strict';

/**
 * Read-only SQLite reader for Kimaki's discord-sessions.db.
 * Uses better-sqlite3 (already a dep) in readonly + WAL mode.
 */

const Database = require('better-sqlite3');
const path = require('path');

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
      SELECT directory, guild_id, channel_id, updated_at
      FROM directories
      ORDER BY updated_at DESC
    `).all();

    return rows.map((row) => ({
      directory: row.directory,
      guildId: row.guild_id || undefined,
      channelId: row.channel_id || undefined,
      lastActivity: row.updated_at || undefined,
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
      SELECT t.thread_id, t.thread_name, t.status, t.created_at, t.updated_at,
             d.directory, d.guild_id, d.channel_id
      FROM threads t
      LEFT JOIN directories d ON t.directory_id = d.id
      WHERE 1=1
    `;
    const params = {};

    if (filters.projectDir) {
      sql += ` AND d.directory = @projectDir`;
      params.projectDir = filters.projectDir;
    }

    if (filters.status) {
      sql += ` AND t.status = @status`;
      params.status = filters.status;
    }

    sql += ` ORDER BY t.updated_at DESC`;

    if (filters.limit) {
      sql += ` LIMIT @limit`;
      params.limit = filters.limit;
    }

    const rows = db.prepare(sql).all(params);

    return rows.map((row) => ({
      threadId: row.thread_id,
      threadName: row.thread_name,
      status: row.status,
      project: row.directory,
      guildId: row.guild_id,
      channelId: row.channel_id,
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
      SELECT t.thread_id, t.thread_name, t.status, t.created_at, t.updated_at,
             d.directory, d.guild_id, d.channel_id
      FROM threads t
      LEFT JOIN directories d ON t.directory_id = d.id
      WHERE t.thread_id = ?
    `).get(sessionId);

    if (!row) return null;

    return {
      threadId: row.thread_id,
      threadName: row.thread_name,
      status: row.status,
      project: row.directory,
      guildId: row.guild_id,
      channelId: row.channel_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } finally {
    db.close();
  }
}

module.exports = { listProjects, listSessions, getSession };
