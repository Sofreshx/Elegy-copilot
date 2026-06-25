'use strict';

/**
 * Session-analytics SQLite database schema and initialization.
 *
 * Provides:
 *   - getDbPath()       — resolve the database file path
 *   - openDb(dbPath)    — open (or create) the DB in WAL mode
 *   - ensureSchema(db)  — create tables and indexes if they don't exist
 *
 * @module db/schema
 */

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

/** Default path when SESSION_ANALYTICS_DB_PATH is not set. */
const DEFAULT_DB_PATH = path.join(os.homedir(), '.elegy', 'session-analytics.db');

/**
 * Resolve the database file path.
 *
 * Respects the SESSION_ANALYTICS_DB_PATH environment variable as an override.
 * Falls back to ~/.elegy/session-analytics.db.
 *
 * @returns {string} Absolute path to the SQLite database file.
 */
function getDbPath() {
	return process.env.SESSION_ANALYTICS_DB_PATH || DEFAULT_DB_PATH;
}

/**
 * Open (or create) the SQLite database and enable WAL journal mode.
 *
 * @param {string} [dbPath] — Path to the SQLite database file.
 *                            Defaults to getDbPath().
 * @returns {import('better-sqlite3').Database} Open database handle.
 */
function openDb(dbPath) {
	const resolved = dbPath || getDbPath();
	const db = new Database(resolved);

	// Enable WAL mode for better concurrent read performance
	db.pragma('journal_mode = WAL');

	// Ensure schema is present
	ensureSchema(db);

	return db;
}

/**
 * Create all session-analytics tables and indexes if they do not exist.
 *
 * Safe to call multiple times — uses IF NOT EXISTS throughout.
 *
 * @param {import('better-sqlite3').Database} db — Open database handle.
 */
function ensureSchema(db) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS session_fingerprints (
			id TEXT PRIMARY KEY,
			source TEXT NOT NULL,
			harness TEXT,
			title TEXT,
			repo TEXT,
			branch TEXT,
			started_at TEXT,
			ended_at TEXT,
			duration_ms INTEGER,
			event_count INTEGER,
			tool_calls_json TEXT,
			agents_json TEXT,
			errors_json TEXT,
			messages_json TEXT,
			prompt_tokens INTEGER,
			output_tokens INTEGER,
			reasoning_tokens INTEGER,
			cost_usd REAL,
			model TEXT,
			extraction_completeness REAL,
			extracted_at TEXT,
			extraction_run_id TEXT,
			fingerprint_hash TEXT
		);

		CREATE TABLE IF NOT EXISTS extraction_runs (
			run_id TEXT PRIMARY KEY,
			started_at TEXT NOT NULL,
			ended_at TEXT,
			sessions_processed INTEGER DEFAULT 0,
			sessions_new INTEGER DEFAULT 0,
			sessions_updated INTEGER DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'running',
			error TEXT
		);

		CREATE TABLE IF NOT EXISTS extraction_watermark (
			harness TEXT PRIMARY KEY,
			last_session_id TEXT,
			last_ended_at TEXT
		);

		CREATE TABLE IF NOT EXISTS pattern_cache (
			id TEXT PRIMARY KEY,
			category TEXT NOT NULL,
			harness TEXT NOT NULL,
			pattern TEXT NOT NULL,
			frequency INTEGER,
			session_ids_json TEXT,
			confidence REAL,
			evidence_json TEXT,
			generated_at TEXT
		);

		CREATE INDEX IF NOT EXISTS idx_fingerprints_source ON session_fingerprints(source);
		CREATE INDEX IF NOT EXISTS idx_fingerprints_harness ON session_fingerprints(harness);
		CREATE INDEX IF NOT EXISTS idx_fingerprints_started ON session_fingerprints(started_at);
		CREATE INDEX IF NOT EXISTS idx_fingerprints_extracted ON session_fingerprints(extracted_at);
		CREATE INDEX IF NOT EXISTS idx_fingerprints_completeness ON session_fingerprints(extraction_completeness);
		CREATE INDEX IF NOT EXISTS idx_patterns_category ON pattern_cache(category);
		CREATE INDEX IF NOT EXISTS idx_patterns_harness ON pattern_cache(harness);
	`);
}

module.exports = {
	getDbPath,
	openDb,
	ensureSchema,
};
