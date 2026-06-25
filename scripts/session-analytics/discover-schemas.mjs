#!/usr/bin/env node
'use strict';

/**
 * Schema Discovery for Session-Analytics Databases.
 *
 * Discovers tables, columns, indexes, and row counts across
 * Codex, OpenCode, and Elegy Copilot SQLite databases.
 *
 * Output: scripts/session-analytics/schema-registry.json
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database definitions
const DB_DEFS = {
  codex: {
    label: 'Codex',
    path: path.join(os.homedir(), '.codex', 'logs_2.sqlite'),
  },
  opencode: {
    label: 'OpenCode',
    path: path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  },
  'elegy-copilot': {
    label: 'Elegy Copilot',
    path: path.join(os.homedir(), '.elegy', 'elegy-copilot.db'),
  },
};

const OUTPUT_PATH = path.resolve(__dirname, 'schema-registry.json');

/**
 * Discover schema information for a single database.
 *
 * @param {string} _id - Database identifier (codex/opencode/elegy-copilot)
 * @param {{ label: string, path: string }} def - Database definition
 * @returns {{ path: string, exists: boolean, tables: Array<object>, error?: string }}
 */
function discoverDatabase(_id, def) {
  const result = {
    path: def.path,
    exists: false,
    tables: [],
  };

  if (!fs.existsSync(def.path)) {
    return result;
  }

  result.exists = true;

  let db;
  try {
    db = new Database(def.path, { readonly: true, fileMustExist: true });
  } catch (err) {
    result.error = err.message;
    return result;
  }

  try {
    // Get tables from sqlite_master
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    ).all();

    for (const { name } of tables) {
      const tableInfo = {
        name,
        columns: [],
        rowCount: 0,
      };

      // Get column info via PRAGMA (table names from sqlite_master are safe identifiers)
      try {
        tableInfo.columns = db.prepare(`PRAGMA table_info("${name}")`).all().map((col) => ({
          cid: col.cid,
          name: col.name,
          type: col.type,
          notnull: col.notnull,
          dflt_value: col.dflt_value,
          pk: col.pk,
        }));
      } catch {
        // Some virtual tables (e.g., vec0, FTS5) may not support PRAGMA table_info
        tableInfo.columns = [];
        tableInfo.error = 'Cannot introspect columns (virtual table)';
      }

      // Get row count
      try {
        const countRow = db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get();
        tableInfo.rowCount = countRow ? countRow.count : 0;
      } catch {
        // Virtual tables (e.g., FTS5, vec0) may not support COUNT(*)
        tableInfo.rowCount = -1;
      }

      result.tables.push(tableInfo);
    }
  } finally {
    db.close();
  }

  return result;
}

/**
 * Print a summary line for a table.
 */
function printTableInfo(table) {
  const colCount = Array.isArray(table.columns) ? table.columns.length : 0;
  const rowDisplay = table.rowCount >= 0 ? String(table.rowCount) : 'N/A (virtual)';
  console.log(`    - ${table.name} (${colCount} cols, ${rowDisplay} rows)`);
}

function main() {
  const registry = {
    generatedAt: new Date().toISOString(),
    databases: {},
  };

  console.log('Discovering session-analytics database schemas...\n');

  for (const [id, def] of Object.entries(DB_DEFS)) {
    const dbInfo = discoverDatabase(id, def);
    registry.databases[id] = dbInfo;

    // Print summary
    const status = dbInfo.exists ? '✓' : '✗';
    const label = status === '✓' ? `${def.label}` : `${def.label} (not found)`;
    console.log(`${status} ${label}`);
    console.log(`   Path: ${def.path}`);

    if (dbInfo.error) {
      console.log(`   Error: ${dbInfo.error}`);
    }

    if (Array.isArray(dbInfo.tables) && dbInfo.tables.length > 0) {
      console.log(`   Tables (${dbInfo.tables.length}):`);
      for (const table of dbInfo.tables) {
        printTableInfo(table);
      }
    } else if (dbInfo.exists && !dbInfo.error) {
      console.log('   (no tables)');
    }

    console.log();
  }

  // Write output
  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(registry, null, 2), 'utf-8');

  console.log(`Schema registry written to: ${OUTPUT_PATH}`);
}

main();
