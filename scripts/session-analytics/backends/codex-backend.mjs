#!/usr/bin/env node
'use strict';

/**
 * Codex Session Fingerprint Extraction Backend.
 *
 * Extracts session fingerprints from Codex data sources:
 *   1. ~/.codex/session_index.jsonl  — primary session index (id, thread_name, updated_at)
 *   2. ~/.codex/logs_2.sqlite        — rich log data with aggregated stats (optional enrichment)
 *
 * Exports an `extract(options)` function that reads both sources, merges them into
 * session fingerprint records, and upserts them into the session-analytics database.
 *
 * @module backends/codex-backend
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// Bridge CommonJS analytics db modules into this ES module
const require = createRequire(import.meta.url);
const { getDbPath, openDb } = require('../db/schema.js');
const {
	upsertFingerprint,
	getFingerprint,
	getWatermark,
	setWatermark,
	completeExtractionRun,
} = require('../db/queries.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOURCE = 'codex';
const HARNESS = 'codex';

/** Default completeness when both JSONL index and SQLite logs are available. */
const COMPLETENESS_FULL = 0.3;

/** Lower completeness when only the JSONL index is available. */
const COMPLETENESS_INDEX_ONLY = 0.15;

const DEFAULT_CODEX_HOME = path.join(os.homedir(), '.codex');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract session fingerprints from Codex data sources.
 *
 * @param {object} [options]
 * @param {string} [options.codexHome]    — Override path to the Codex data directory.
 *                                          Defaults to ~/.codex.
 * @param {import('better-sqlite3').Database} [options.db] — Reusable database handle.
 *                                          When omitted, a new connection is opened and
 *                                          closed within the call.
 * @param {string} [options.runId]        — Extraction run ID for tracking in extraction_runs.
 * @param {string} [options.since]        — ISO date string; only sessions with
 *                                          updated_at newer than this are processed.
 * @returns {{ sessionsProcessed: number, sessionsNew: number, sessionsUpdated: number, errors: string[] }}
 */
export function extract(options = {}) {
	const codexHome = options.codexHome || DEFAULT_CODEX_HOME;
	const runId = options.runId || null;
	const since = options.since || null;

	// ----- Database connection -----
	let db = options.db || null;
	let closeDb = false;

	if (!db) {
		db = openDb();
		closeDb = true;
	}

	// ----- Accumulators -----
	let sessionsProcessed = 0;
	let sessionsNew = 0;
	let sessionsUpdated = 0;
	const errors = [];

	try {
		// ===================================================================
		// 1. Read session_index.jsonl — primary session source
		// ===================================================================
		const indexPath = path.join(codexHome, 'session_index.jsonl');

		if (!fs.existsSync(indexPath)) {
			const msg = 'session_index.jsonl not found';
			errors.push(msg);
			return finalize({ sessionsProcessed: 0, sessionsNew: 0, sessionsUpdated: 0, errors });
		}

		const rawContent = fs.readFileSync(indexPath, 'utf-8');
		const rawLines = rawContent.split('\n').filter((line) => line.trim().length > 0);

		// Parse each JSONL line and deduplicate by id (keep newest updated_at)
		const sessionMap = new Map();

		for (const line of rawLines) {
			let obj;
			try {
				obj = JSON.parse(line);
			} catch (parseErr) {
				errors.push(`Skipped malformed JSONL line: ${parseErr.message}`);
				continue;
			}

			if (!obj.id) {
				errors.push('Skipped JSONL line without id field');
				continue;
			}

			const existing = sessionMap.get(obj.id);
			if (!existing || new Date(obj.updated_at) > new Date(existing.updated_at)) {
				sessionMap.set(obj.id, obj);
			}
		}

		// ===================================================================
		// 2. Read logs_2.sqlite — enrichment source (optional)
		// ===================================================================
		const sqlitePath = path.join(codexHome, 'logs_2.sqlite');
		let hasSqlite = false;
		const logStats = new Map();

		if (fs.existsSync(sqlitePath)) {
			let logDb;
			try {
				logDb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
				hasSqlite = true;
			} catch (dbErr) {
				errors.push(`Cannot open logs_2.sqlite: ${dbErr.message}`);
			}

			if (logDb) {
				try {
					const rows = logDb.prepare(`
						SELECT thread_id,
						       COUNT(*)                              AS log_count,
						       MIN(ts)                               AS min_ts,
						       MAX(ts)                               AS max_ts,
						       SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) AS error_count,
						       SUM(CASE WHEN level = 'WARN'  THEN 1 ELSE 0 END) AS warn_count
						FROM logs
						WHERE thread_id IS NOT NULL
						GROUP BY thread_id
					`).all();

					for (const row of rows) {
						logStats.set(row.thread_id, {
							log_count: row.log_count,
							min_ts: row.min_ts,
							max_ts: row.max_ts,
							error_count: row.error_count,
							warn_count: row.warn_count,
						});
					}
				} catch (queryErr) {
					errors.push(`SQLite query failed on logs_2.sqlite: ${queryErr.message}`);
					// Continue with whatever rows we might have (none if query failed fully)
				} finally {
					logDb.close();
				}
			}
		}

		const completeness = hasSqlite ? COMPLETENESS_FULL : COMPLETENESS_INDEX_ONLY;

		// ===================================================================
		// 3. Apply incremental filters (since / watermark)
		// ===================================================================
		let cutoffDate = null;

		if (since) {
			cutoffDate = new Date(since);
		} else {
			try {
				const watermark = getWatermark(db, HARNESS);
				if (watermark && watermark.last_ended_at) {
					cutoffDate = new Date(watermark.last_ended_at);
				}
			} catch (wmErr) {
				errors.push(`getWatermark: ${wmErr.message}`);
			}
		}

		// Flatten sessions from map to sorted array
		let sessions = Array.from(sessionMap.values());

		if (cutoffDate && !isNaN(cutoffDate.getTime())) {
			const cutoffMs = cutoffDate.getTime();
			sessions = sessions.filter((s) => {
				if (!s.updated_at) return true;
				return new Date(s.updated_at).getTime() > cutoffMs;
			});
		}

		// Sort by updated_at ascending — deterministic order for watermark tracking
		sessions.sort((a, b) => {
			const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
			const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;
			return aMs - bMs;
		});

		// ===================================================================
		// 4. Build fingerprints and upsert
		// ===================================================================
		let lastSessionId = null;
		let lastEndedAt = null;
		const nowISO = new Date().toISOString();

		// Codex data completeness limitations:
		// - repo, branch: not available in session_index.jsonl nor logs table
		// - tool_calls_json, agents_json: Codex logs_2.sqlite doesn't track tool/agent invocations
		// - cost_usd, model: Codex doesn't track per-session cost/model
		// - prompt/output/reasoning_tokens: not available
		// - messages_json: message counts not trackable
		// Overall completeness: 0.15 (index-only) or 0.3 (index + logs)

		for (const session of sessions) {
			sessionsProcessed++;

			const stats = logStats.get(session.id) || {};

			// Derive timestamps
			const startedAt = stats.min_ts || session.updated_at || null;
			const endedAt = stats.max_ts || session.updated_at || null;

			let durationMs = null;
			if (stats.max_ts && stats.min_ts) {
				durationMs = new Date(stats.max_ts).getTime() - new Date(stats.min_ts).getTime();
			}

			// Build errors_json only when there are logged errors
			let errorsJson = '{}';
			if (stats.error_count && stats.error_count > 0) {
				errorsJson = JSON.stringify([{ type: 'log_error', count: stats.error_count }]);
			}

			const title = session.thread_name || session.id;

			// Compute deterministic fingerprint hash
			const fingerprintHash = crypto
				.createHash('sha256')
				.update(`${session.id}:${SOURCE}:${title}`)
				.digest('hex');

			const fingerprint = {
				id: session.id,
				source: SOURCE,
				harness: HARNESS,
				title,
				repo: null,
				branch: null,
				started_at: startedAt,
				ended_at: endedAt,
				duration_ms: durationMs,
				event_count: stats.log_count || null,
				tool_calls_json: '[]',
				agents_json: '{}',
				errors_json: errorsJson,
				messages_json: '{}',
				prompt_tokens: null,
				output_tokens: null,
				reasoning_tokens: null,
				cost_usd: null,
				model: null,
				extraction_completeness: completeness,
				extraction_run_id: runId,
				extracted_at: nowISO,
				fingerprint_hash: fingerprintHash,
			};

			// Classify as new or update
			const existing = getFingerprint(db, session.id);
			if (existing) {
				sessionsUpdated++;
			} else {
				sessionsNew++;
			}

			upsertFingerprint(db, fingerprint);

			lastSessionId = session.id;
			lastEndedAt = endedAt;
		}

		// ===================================================================
		// 5. Update watermark
		// ===================================================================
		if (lastSessionId && lastEndedAt) {
			try {
				setWatermark(db, HARNESS, lastSessionId, lastEndedAt);
			} catch (wmErr) {
				errors.push(`setWatermark: ${wmErr.message}`);
			}
		}

		return finalize({ sessionsProcessed, sessionsNew, sessionsUpdated, errors });
	} catch (err) {
		errors.push(`Unhandled error during extraction: ${err.message}`);
		return finalize({ sessionsProcessed, sessionsNew, sessionsUpdated, errors });
	} finally {
		if (runId && db) {
			const isFailed = errors.length > 0;
			try {
				completeExtractionRun(db, runId, isFailed ? 'failed' : 'completed', {
					sessions_processed: sessionsProcessed,
					sessions_new: sessionsNew,
					sessions_updated: sessionsUpdated,
					error: isFailed ? errors.join('; ') : null,
				});
			} catch (runErr) {
				// Swallow so we don't mask the original result
				console.error(`completeExtractionRun error: ${runErr.message}`);
			}
		}

		if (closeDb && db) {
			try {
				db.close();
			} catch (_) {
				// Best-effort close
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the canonical result shape and close resources.
 * Extracted to keep the return path consistent.
 *
 * @param {{ sessionsProcessed: number, sessionsNew: number, sessionsUpdated: number, errors: string[] }} result
 * @returns {{ sessionsProcessed: number, sessionsNew: number, sessionsUpdated: number, errors: string[] }}
 */
function finalize(result) {
	return {
		sessionsProcessed: result.sessionsProcessed,
		sessionsNew: result.sessionsNew,
		sessionsUpdated: result.sessionsUpdated,
		errors: result.errors,
	};
}
