'use strict';

const fs = require('fs');
const path = require('path');

const EMBEDDED_DESKTOP_PLANNING_DB_URL = 'postgresql://desktop-local/planning';

function createPostgresPlanningPersistenceClient(options = {}) {
  const connectionString = typeof options.connectionString === 'string'
    ? options.connectionString.trim()
    : '';

  if (!connectionString) {
    throw new Error('Planning persistence connection string is required');
  }

  // Load lazily so optional/no-DB startup paths do not fail unless a DB client is actually needed.
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 3_000,
  });

  let closed = false;
  return {
    query(sql, params) {
      if (closed) {
        throw new Error('Planning persistence client is closed');
      }

      return pool.query(sql, params);
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await pool.end();
    },
  };
}

function normalizeEmbeddedQueryResult(result) {
  const rows = Array.isArray(result && result.rows) ? result.rows : [];
  const affectedRows = Number(result && result.affectedRows);
  const fields = Array.isArray(result && result.fields) ? result.fields : [];
  const hasResultSet = fields.length > 0 || rows.length > 0;

  return {
    rows,
    rowCount: hasResultSet
      ? rows.length
      : (Number.isFinite(affectedRows) ? affectedRows : 0),
  };
}

function createEmbeddedPGlitePlanningPersistenceClient(options = {}) {
  const dataDir = typeof options.dataDir === 'string'
    ? options.dataDir.trim()
    : '';

  if (!dataDir) {
    throw new Error('Embedded planning persistence data directory is required');
  }

  const resolvedDataDir = path.resolve(dataDir);
  fs.mkdirSync(resolvedDataDir, { recursive: true });

  const { PGlite } = require('@electric-sql/pglite');
  const database = new PGlite(resolvedDataDir);

  let closed = false;
  return {
    async query(sql, params) {
      if (closed) {
        throw new Error('Planning persistence client is closed');
      }

      const result = await database.query(
        String(sql || ''),
        Array.isArray(params) ? params : [],
      );
      return normalizeEmbeddedQueryResult(result);
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      await database.close();
    },
  };
}

module.exports = {
  EMBEDDED_DESKTOP_PLANNING_DB_URL,
  createEmbeddedPGlitePlanningPersistenceClient,
  createPostgresPlanningPersistenceClient,
};
