#!/usr/bin/env node
'use strict';

/**
 * OpenCode Session Fingerprint Extraction Backend.
 *
 * Reads session data from ~/.local/share/opencode/opencode.db (readonly)
 * and upserts structured fingerprints into the session-analytics database.
 *
 * Primary data: session table (3,575 rows, 29 columns).
 * Ancillary: message table for message counts only (no content parsing).
 *
 * Privacy: Does NOT read raw message data content. Error detection is
 * disabled by design — conversation content is never extracted.
 *
 * @module backends/opencode-backend
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { getDbPath, openDb } from '../db/schema.js';
import {
	upsertFingerprint,
	getWatermark,
	setWatermark,
	completeExtractionRun,
} from '../db/queries.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default completeness score for OpenCode extractions. */
const DEFAULT_COMPLETENESS = 0.7;

/** Default OpenCode data directory relative to user home. */
const DEFAULT_OPENCODE_DIR = path.join(os.homedir(), '.local', 'share', 'opencode');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert epoch seconds (INTEGER) to ISO 8601 string.
 *
 * @param {number|null|undefined} epochSeconds — Epoch seconds value.
 * @returns {string|null} ISO 8601 string or null if input is null/undefined/0.
 */
function epochToISO(epochSeconds) {
	if (epochSeconds == null || epochSeconds === 0) return null;
	return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Resolve the absolute path to opencode.db.
 *
 * Resolution order:
 * 1. `opencodeHome` option parameter (base directory override).
 * 2. `OPENCODE_DB_PATH` environment variable (direct path override).
 * 3. Default: ~/.local/share/opencode/opencode.db.
 *
 * @param {string} [opencodeHome] — Override for ~/.local/share/opencode.
 * @returns {string}
 */
function resolveOpencodeDbPath(opencodeHome) {
	if (opencodeHome) return path.join(opencodeHome, 'opencode.db');
	if (process.env.OPENCODE_DB_PATH) return process.env.OPENCODE_DB_PATH;
	return path.join(DEFAULT_OPENCODE_DIR, 'opencode.db');
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract session fingerprints from the OpenCode SQLite database.
 *
 * Opens opencode.db in readonly mode, queries top-level non-archived sessions
 * updated after the watermark (or `since` threshold), builds structured
 * fingerprint records, and upserts them into the analytics database.
 *
 * Privacy: Does NOT read message data content. Error detection from
 * conversation data is intentionally disabled.
 *
 * @param {object} [options]
 * @param {string} [options.opencodeHome] — Override path to OpenCode data dir.
 * @param {import('better-sqlite3').Database} [options.db] — Analytics db handle.
 *        When omitted, opens the default session-analytics database via schema.openDb().
 * @param {string} [options.runId] — Extraction run identifier.
 *        Auto-generated when omitted: "opencode-<timestamp>-<random>".
 * @param {number} [options.since] — Epoch-seconds threshold. Overrides the
 *        persisted watermark when provided.
 * @returns {{ sessionsProcessed: number, sessionsNew: number, sessionsUpdated: number, errors: string[] }}
 */
export function extract(options = {}) {
	const { opencodeHome, db: externalDb, runId, since } = options;
	const errors = [];

	// -----------------------------------------------------------------------
	// Database connections
	// -----------------------------------------------------------------------

	/** @type {import('better-sqlite3').Database} */
	const analyticsDb = externalDb || openDb();
	const shouldCloseAnalyticsDb = !externalDb;

	let opencodeDb;
	try {
		const dbPath = resolveOpencodeDbPath(opencodeHome);
		opencodeDb = new Database(dbPath, { readonly: true, fileMustExist: true });
	} catch (err) {
		if (shouldCloseAnalyticsDb) analyticsDb.close();
		throw new Error(
			`Cannot open opencode.db${opencodeHome ? ` at ${opencodeHome}` : ''}: ${err.message}`,
		);
	}

	// -----------------------------------------------------------------------
	// Watermark / since threshold
	// -----------------------------------------------------------------------

	/** @type {number} Epoch-seconds threshold for filtering sessions. */
	let watermarkEpoch;
	if (since != null) {
		watermarkEpoch = since;
	} else {
		const watermark = getWatermark(analyticsDb, 'opencode');
		if (watermark && watermark.last_ended_at) {
			watermarkEpoch = Math.floor(new Date(watermark.last_ended_at).getTime() / 1000);
		} else {
			watermarkEpoch = 0; // No prior run — extract everything
		}
	}

	// -----------------------------------------------------------------------
	// Extraction run tracking
	// -----------------------------------------------------------------------

	const resolvedRunId =
		runId || `opencode-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

	// -----------------------------------------------------------------------
	// Query: sessions from opencode.db
	// -----------------------------------------------------------------------

	/** Fetch top-level, non-archived sessions updated after the watermark. */
	const sessionStmt = opencodeDb.prepare(`
		SELECT
			s.id,
			s.title,
			s.directory,
			s.project_id,
			s.agent,
			s.model,
			s.cost,
			s.tokens_input,
			s.tokens_output,
			s.tokens_reasoning,
			s.tokens_cache_read,
			s.tokens_cache_write,
			s.time_created,
			s.time_updated,
			s.summary_additions,
			s.summary_deletions,
			s.summary_files,
			pd.directory AS project_directory
		FROM session s
		LEFT JOIN project_directory pd ON s.project_id = pd.project_id
		WHERE s.parent_id IS NULL
			AND s.time_archived IS NULL
			AND s.time_updated > ?
		ORDER BY s.time_updated DESC
	`);

	/** Count messages for a given session. */
	const msgCountStmt = opencodeDb.prepare(
		'SELECT COUNT(*) AS msg_count FROM message WHERE session_id = ?',
	);

	/** Check if a fingerprint already exists in the analytics db. */
	const fingerprintExistsStmt = analyticsDb.prepare(
		'SELECT id FROM session_fingerprints WHERE id = ?',
	);

	// -----------------------------------------------------------------------
	// Process each session
	// -----------------------------------------------------------------------

	const rows = sessionStmt.all(watermarkEpoch);
	let sessionsProcessed = 0;
	let sessionsNew = 0;
	let sessionsUpdated = 0;
	let latestSessionId = null;
	let latestEndedAt = null;

	for (const row of rows) {
		sessionsProcessed++;

		// -- Message count ---------------------------------------------------
		let msgCount = 0;
		try {
			const result = msgCountStmt.get(row.id);
			msgCount = result ? result.msg_count : 0;
		} catch (err) {
			errors.push(`msgCount(${row.id}): ${err.message}`);
		}

		// -- New vs updated detection ----------------------------------------
		let isNew = true;
		try {
			const existing = fingerprintExistsStmt.get(row.id);
			if (existing) isNew = false;
		} catch {
			// fingerprint table may not exist yet on first run
		}
		if (isNew) sessionsNew++;
		else sessionsUpdated++;

		// -- Agent tracking --------------------------------------------------
		const agentsObj = {};
		if (row.agent) agentsObj[row.agent] = 1;

		// -- Build fingerprint record ----------------------------------------
		const durationMs = row.time_updated != null && row.time_created != null
			? (row.time_updated - row.time_created) * 1000
			: 0;

		const fp = {
			id: row.id,
			source: 'opencode',
			harness: 'opencode',
			title: row.title || row.id,
			repo: row.directory || row.project_directory || null,
			branch: null,
			started_at: epochToISO(row.time_created),
			ended_at: epochToISO(row.time_updated),
			duration_ms: Math.max(0, durationMs),
			event_count: msgCount,
			tool_calls_json: '[]',  // Not extracted from part table (613K rows — too expensive for batch extraction)
			agents_json: JSON.stringify(agentsObj),
			errors_json: '[]',  // Not parsed from message data for privacy reasons
			messages_json: JSON.stringify({ user: null, assistant: msgCount }),
			prompt_tokens: row.tokens_input,
			output_tokens: row.tokens_output,
			reasoning_tokens: row.tokens_reasoning,
			cost_usd: row.cost,
			model: row.model,
			extraction_completeness: DEFAULT_COMPLETENESS,
			extraction_run_id: resolvedRunId,
			extracted_at: new Date().toISOString(),
			fingerprint_hash: crypto
				.createHash('sha256')
				.update(`${row.id}:opencode:${row.title || ''}`)
				.digest('hex'),
		};

		// -- Upsert fingerprint ----------------------------------------------
		try {
			upsertFingerprint(analyticsDb, fp);
		} catch (err) {
			errors.push(`upsertFingerprint(${row.id}): ${err.message}`);
		}

		// -- Track latest for watermark ---------------------------------------
		if (row.time_updated) {
			if (!latestEndedAt || row.time_updated > new Date(latestEndedAt).getTime() / 1000) {
				latestEndedAt = epochToISO(row.time_updated);
				latestSessionId = row.id;
			}
		}
	}

	// -----------------------------------------------------------------------
	// Update watermark (once after all sessions)
	// -----------------------------------------------------------------------

	if (latestSessionId && latestEndedAt) {
		try {
			setWatermark(analyticsDb, 'opencode', latestSessionId, latestEndedAt);
		} catch (err) {
			errors.push(`setWatermark: ${err.message}`);
		}
	}

	// -----------------------------------------------------------------------
	// Mark extraction run complete
	// -----------------------------------------------------------------------

	const runStatus = errors.length > 0 ? 'failed' : 'completed';
	try {
		completeExtractionRun(analyticsDb, resolvedRunId, runStatus, {
			sessions_processed: sessionsProcessed,
			sessions_new: sessionsNew,
			sessions_updated: sessionsUpdated,
		});
	} catch (err) {
		errors.push(`completeExtractionRun: ${err.message}`);
	}

	// -----------------------------------------------------------------------
	// Cleanup
	// -----------------------------------------------------------------------

	opencodeDb.close();
	if (shouldCloseAnalyticsDb) analyticsDb.close();

	return {
		sessionsProcessed,
		sessionsNew,
		sessionsUpdated,
		errors,
	};
}
