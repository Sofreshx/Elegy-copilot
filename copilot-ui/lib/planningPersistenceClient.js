'use strict';

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

module.exports = {
  createPostgresPlanningPersistenceClient,
};
