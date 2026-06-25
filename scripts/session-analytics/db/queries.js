'use strict';

/**
 * Prepared-statement query module for session-analytics.
 *
 * Every function accepts an open better-sqlite3 Database instance as its
 * first argument and uses db.prepare() for parameterized queries.
 *
 * @module db/queries
 */

/**
 * Insert or replace a session fingerprint.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} fp — Fingerprint fields matching session_fingerprints columns.
 * @returns {import('better-sqlite3').RunResult}
 */
function upsertFingerprint(db, fp) {
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO session_fingerprints (
			id, source, harness, title, repo, branch,
			started_at, ended_at, duration_ms, event_count,
			tool_calls_json, agents_json, errors_json, messages_json,
			prompt_tokens, output_tokens, reasoning_tokens, cost_usd,
			model, extraction_completeness, extracted_at, extraction_run_id,
			fingerprint_hash
		) VALUES (
			@id, @source, @harness, @title, @repo, @branch,
			@started_at, @ended_at, @duration_ms, @event_count,
			@tool_calls_json, @agents_json, @errors_json, @messages_json,
			@prompt_tokens, @output_tokens, @reasoning_tokens, @cost_usd,
			@model, @extraction_completeness, @extracted_at, @extraction_run_id,
			@fingerprint_hash
		)
	`);

	return stmt.run(fp);
}

/**
 * Retrieve a single session fingerprint by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} id — Session fingerprint ID.
 * @returns {object|undefined}
 */
function getFingerprint(db, id) {
	const stmt = db.prepare('SELECT * FROM session_fingerprints WHERE id = ?');
	return stmt.get(id);
}

/**
 * Retrieve session fingerprints for a given source, with an optional limit.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} source — Harness source identifier (e.g. 'opencode').
 * @param {number} [limit] — Maximum number of rows to return.
 * @returns {object[]}
 */
function getFingerprintsBySource(db, source, limit) {
	let sql = 'SELECT * FROM session_fingerprints WHERE source = ? ORDER BY started_at DESC';

	if (limit !== undefined && limit !== null) {
		sql += ' LIMIT ?';
		const stmt = db.prepare(sql);
		return stmt.all(source, limit);
	}

	const stmt = db.prepare(sql);
	return stmt.all(source);
}

/**
 * Retrieve session fingerprints with extraction_completeness >= minCompleteness.
 *
 * Used to filter sessions ready for pattern detection.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} minCompleteness — Minimum completeness threshold (0.0 – 1.0).
 * @returns {object[]}
 */
function getFingerprintsByCompleteness(db, minCompleteness) {
	const stmt = db.prepare(
		'SELECT * FROM session_fingerprints WHERE extraction_completeness >= ? ORDER BY started_at DESC'
	);
	return stmt.all(minCompleteness);
}

/**
 * Record the start of a new extraction run.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} runId — Unique run identifier.
 * @returns {import('better-sqlite3').RunResult}
 */
function startExtractionRun(db, runId) {
	const stmt = db.prepare(`
		INSERT INTO extraction_runs (run_id, started_at, status)
		VALUES (?, datetime('now'), 'running')
	`);
	return stmt.run(runId);
}

/**
 * Mark an extraction run as completed or failed with aggregate statistics.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} runId
 * @param {string} status — 'completed' or 'failed'.
 * @param {object} stats — { sessions_processed, sessions_new, sessions_updated, error? }
 * @returns {import('better-sqlite3').RunResult}
 */
function completeExtractionRun(db, runId, status, stats) {
	const stmt = db.prepare(`
		UPDATE extraction_runs
		SET ended_at = datetime('now'),
			status = ?,
			sessions_processed = ?,
			sessions_new = ?,
			sessions_updated = ?,
			error = ?
		WHERE run_id = ?
	`);

	return stmt.run(
		status,
		stats.sessions_processed || 0,
		stats.sessions_new || 0,
		stats.sessions_updated || 0,
		stats.error || null,
		runId
	);
}

/**
 * Retrieve the extraction watermark for a given harness.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} harness — Harness identifier.
 * @returns {object|undefined}
 */
function getWatermark(db, harness) {
	const stmt = db.prepare('SELECT * FROM extraction_watermark WHERE harness = ?');
	return stmt.get(harness);
}

/**
 * Set (insert or replace) the extraction watermark for a harness.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} harness
 * @param {string} sessionId
 * @param {string} endedAt
 * @returns {import('better-sqlite3').RunResult}
 */
function setWatermark(db, harness, sessionId, endedAt) {
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO extraction_watermark (harness, last_session_id, last_ended_at)
		VALUES (?, ?, ?)
	`);
	return stmt.run(harness, sessionId, endedAt);
}

/**
 * Insert or replace a pattern in the pattern cache.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} pattern — Fields matching pattern_cache columns.
 * @returns {import('better-sqlite3').RunResult}
 */
function upsertPattern(db, pattern) {
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO pattern_cache (
			id, category, harness, pattern, frequency,
			session_ids_json, confidence, evidence_json, generated_at
		) VALUES (
			@id, @category, @harness, @pattern, @frequency,
			@session_ids_json, @confidence, @evidence_json, @generated_at
		)
	`);

	return stmt.run(pattern);
}

/**
 * Retrieve all cached patterns for a given category.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} category — Pattern category (e.g. 'skill-opportunity').
 * @returns {object[]}
 */
function getPatternsByCategory(db, category) {
	const stmt = db.prepare('SELECT * FROM pattern_cache WHERE category = ? ORDER BY frequency DESC');
	return stmt.all(category);
}

/**
 * Remove all entries from the pattern cache.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {import('better-sqlite3').RunResult}
 */
function clearPatternCache(db) {
	const stmt = db.prepare('DELETE FROM pattern_cache');
	return stmt.run();
}

module.exports = {
	upsertFingerprint,
	getFingerprint,
	getFingerprintsBySource,
	getFingerprintsByCompleteness,
	startExtractionRun,
	completeExtractionRun,
	getWatermark,
	setWatermark,
	upsertPattern,
	getPatternsByCategory,
	clearPatternCache,
};
