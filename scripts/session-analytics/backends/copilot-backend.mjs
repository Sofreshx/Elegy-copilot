#!/usr/bin/env node
'use strict';

/**
 * Copilot/Elegy session fingerprint extraction backend.
 *
 * Extracts session fingerprints from two data sources:
 *   1. ~/.elegy/elegy-copilot.db — SQLite database (sessions + agent_runs)
 *   2. ~/.elegy/session-state/<ID>/events.jsonl — event stream files (best-effort)
 *
 * @module backends/copilot-backend
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { getDbPath, openDb } = require('../db/schema.js');
const {
	upsertFingerprint,
	getWatermark,
	setWatermark,
	completeExtractionRun,
} = require('../db/queries.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tail-reading chunk size (64 KB). */
const TAIL_CHUNK_SIZE = 64 * 1024;

/** Maximum bytes to read when tailing events (8 MB). */
const TAIL_MAX_BYTES = 8 * 1024 * 1024;

/** Maximum number of events to return from JSONL tail. */
const MAX_EVENTS = 500;

/** Maximum length for GROUP_CONCAT truncated strings. */
const MAX_GROUP_CONCAT_LENGTH = 500;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely stat a path, returning null on any error.
 *
 * @param {string} p — File or directory path.
 * @returns {import('fs').Stats|null}
 */
function safeStat(p) {
	try {
		return fs.statSync(p);
	} catch {
		return null;
	}
}

/**
 * Parse a timestamp value to ISO string or null.
 *
 * Accepts ISO strings, Unix millisecond numbers, or Date instances.
 *
 * @param {*} value
 * @returns {string|null}
 */
function parseTimeToISO(value) {
	if (value == null) return null;
	if (typeof value === 'number' && Number.isFinite(value)) {
		return new Date(value).toISOString();
	}
	if (typeof value === 'string') {
		// Already ISO or parseable
		const d = new Date(value);
		if (Number.isFinite(d.getTime())) return d.toISOString();
		const n = Number(value);
		if (Number.isFinite(n)) return new Date(n).toISOString();
		return null;
	}
	if (value instanceof Date && Number.isFinite(value.getTime())) {
		return value.toISOString();
	}
	return null;
}

/**
 * Compute duration in milliseconds between two timestamps.
 *
 * @param {string|null|number} startedAt — ISO string or Unix ms.
 * @param {string|null|number} endedAt — ISO string or Unix ms.
 * @returns {number|null}
 */
function computeDurationMs(startedAt, endedAt) {
	if (!startedAt || !endedAt) return null;
	const s = new Date(startedAt).getTime();
	const e = new Date(endedAt).getTime();
	if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
	return Math.max(0, e - s);
}

/**
 * Safely parse a JSON string, returning null on failure.
 *
 * @param {string} str
 * @returns {object|null}
 */
function safeJsonParse(str) {
	if (typeof str !== 'string') return null;
	try {
		return JSON.parse(str);
	} catch {
		return null;
	}
}

/**
 * Truncate a string to maxLength characters, appending '...' if truncated.
 *
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
	if (typeof str !== 'string') return '';
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen) + '...';
}

/**
 * Aggregate an array of items by a key function, returning counts.
 *
 * @param {Array} items
 * @param {Function} keyFn — Extracts the key from each item.
 * @returns {Array<{name: string, count: number}>} Sorted by count descending.
 */
function aggregateCounts(items, keyFn) {
	const map = new Map();
	for (const item of items) {
		if (item == null) continue;
		const key = keyFn(item);
		if (key == null) continue;
		map.set(key, (map.get(key) || 0) + 1);
	}
	return Array.from(map.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// JSONL tail-reading (adapted from copilot-ui/lib/sessions.js)
// ---------------------------------------------------------------------------

/**
 * Extract the event type from an event object.
 *
 * @param {object} ev
 * @returns {string|null}
 */
function eventType(ev) {
	if (!ev || typeof ev !== 'object') return null;
	return ev.type || ev.event || ev.name || ev.kind || null;
}

/**
 * Extract the payload from an event object.
 *
 * @param {object} ev
 * @returns {object}
 */
function payloadOf(ev) {
	if (!ev || typeof ev !== 'object') return {};
	return ev.payload || ev.data || ev.session || ev.context || ev;
}

/**
 * Tail-read the last N lines from a JSONL file, reading backwards in chunks.
 *
 * Adapted from copilot-ui/lib/sessions.js (tailJsonlLines → readRecentEvents).
 *
 * @param {string} filePath — Absolute path to the JSONL file.
 * @param {number} [limit=500] — Maximum number of lines to return.
 * @returns {string[]} Parsed JSON event objects.
 */
function readRecentEvents(filePath, limit = MAX_EVENTS) {
	const stat = safeStat(filePath);
	if (!stat || !stat.isFile() || stat.size <= 0) return [];

	const fd = fs.openSync(filePath, 'r');
	try {
		const chunks = [];
		let bytesReadTotal = 0;
		let pos = stat.size;

		// Read backwards until we have enough newlines for the requested limit (+ buffer)
		const targetNewlines = Math.max(1, limit) + 5;
		let newlineCount = 0;

		while (pos > 0 && newlineCount < targetNewlines && bytesReadTotal < TAIL_MAX_BYTES) {
			const readSize = Math.min(TAIL_CHUNK_SIZE, pos);
			pos -= readSize;
			const buf = Buffer.allocUnsafe(readSize);
			fs.readSync(fd, buf, 0, readSize, pos);
			chunks.unshift(buf);
			bytesReadTotal += readSize;

			for (let i = 0; i < buf.length; i++) {
				if (buf[i] === 10) newlineCount++; // '\n'
			}
		}

		const text = Buffer.concat(chunks).toString('utf8');
		const lines = text.split(/\r?\n/).filter(Boolean);
		const selected = lines.slice(Math.max(0, lines.length - limit));

		const events = [];
		for (const line of selected) {
			try {
				events.push(JSON.parse(line));
			} catch {
				// skip malformed JSON lines (best-effort parsing)
			}
		}
		return events;
	} finally {
		try {
			fs.closeSync(fd);
		} catch {
			// ignore close errors
		}
	}
}

// ---------------------------------------------------------------------------
// JSONL event enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a session fingerprint with data parsed from events.jsonl.
 *
 * Extracts:
 *   - tool.execution_start events → tool calls
 *   - session.error events → errors
 *   - question.asked events → questions
 *   - message counts (user vs assistant)
 *
 * All enrichment is best-effort. Failures do not block fingerprint creation.
 *
 * @param {string} sessionDir — Path to session state directory.
 * @returns {object} { toolCalls, errors, messages, eventCount } or empty defaults.
 */
function enrichFromEvents(sessionDir) {
	const eventsPath = path.join(sessionDir, 'events.jsonl');
	const events = readRecentEvents(eventsPath, MAX_EVENTS);

	if (events.length === 0) {
		return { toolCalls: [], errors: [], messages: { user: 0, assistant: 0 }, eventCount: 0 };
	}

	const toolCalls = [];
	const errors = [];
	let userMsgCount = 0;
	let asstMsgCount = 0;

	for (const ev of events) {
		const t = (eventType(ev) || '').toLowerCase();
		const p = payloadOf(ev);

		if (t === 'tool.execution_start') {
			const toolName = p.toolName || p.name || null;
			if (toolName) {
				toolCalls.push({ toolName, agentName: p.agentName || p.agent || null });
			}
		} else if (t === 'session.error') {
			const message = p.message || p.text || null;
			if (message) {
				errors.push({ type: 'session.error', message, count: 1 });
			}
		} else if (t === 'question.asked') {
			// Track question asked events but do not store the question text (privacy)
			// Count only — no content capture.
		} else if (t === 'user.message') {
			userMsgCount++;
		} else if (t === 'assistant.message') {
			asstMsgCount++;
		}
	}

	// Aggregate tool calls by name
	const aggregatedTools = aggregateCounts(toolCalls, (tc) => tc.toolName);

	return {
		toolCalls: aggregatedTools,
		errors,
		messages: { user: userMsgCount, assistant: asstMsgCount },
		eventCount: events.length,
	};
}

// ---------------------------------------------------------------------------
// Agent run aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Build agent counts from a comma-separated agent names string.
 *
 * @param {string|null} agentsStr — e.g. "impl,build,impl,reviewer"
 * @returns {Array<{name: string, count: number}>}
 */
function buildAgentCounts(agentsStr) {
	if (!agentsStr) return [];
	const agents = agentsStr.split(',').map((a) => a.trim()).filter(Boolean);
	return aggregateCounts(agents, (a) => a);
}

/**
 * Build error entries from comma-separated error codes and messages.
 *
 * @param {string|null} errorCodesStr — Comma-separated error codes.
 * @param {string|null} errorMessagesStr — Comma-separated error messages.
 * @returns {Array<{code: string, message: string}>}
 */
function buildErrorEntries(errorCodesStr, errorMessagesStr) {
	const codes = errorCodesStr ? errorCodesStr.split(',').map((c) => c.trim()).filter(Boolean) : [];
	const messages = errorMessagesStr ? errorMessagesStr.split(',').map((m) => m.trim()).filter(Boolean) : [];

	const entries = [];
	const maxLen = Math.max(codes.length, messages.length, 0);
	for (let i = 0; i < maxLen; i++) {
		const entry = {};
		if (i < codes.length) entry.code = truncate(codes[i], MAX_GROUP_CONCAT_LENGTH);
		if (i < messages.length) entry.message = truncate(messages[i], MAX_GROUP_CONCAT_LENGTH);
		entries.push(entry);
	}
	return entries;
}

// ---------------------------------------------------------------------------
// Fingerprint building
// ---------------------------------------------------------------------------

/**
 * Build a complete fingerprint object from a SQL row and optional event enrichment.
 *
 * @param {object} row — Row from the aggregated sessions query.
 * @param {object} enrichment — Result from enrichFromEvents().
 * @param {string|null} runId — Current extraction run ID.
 * @param {boolean} hasEvents — Whether events.jsonl data was available.
 * @returns {object} Fingerprint object ready for upsertFingerprint().
 */
function buildFingerprint(row, enrichment, runId, hasEvents) {
	const startedAt = parseTimeToISO(row.started_at);
	const endedAt = parseTimeToISO(row.ended_at);
	const durationMs = computeDurationMs(row.started_at, row.ended_at);

	// Agent counts from agent_runs aggregation
	const agentCounts = buildAgentCounts(row.agents);

	// Errors from agent_runs aggregation
	const dbErrors = buildErrorEntries(row.error_codes, row.error_messages);

	// Combine DB errors with event enrichment errors
	const combinedErrors = [
		...dbErrors,
		...enrichment.errors.map((e) => ({ code: 'session.error', message: truncate(e.message, MAX_GROUP_CONCAT_LENGTH) })),
	];

	const model = row.models ? row.models.split(',')[0].trim() : (row.model || null);

	const fp = {
		id: row.id,
		source: row.source || 'copilot',
		harness: row.harness || 'copilot',
		title: row.title || row.id,
		repo: row.repo_path || null,
		branch: row.branch || null,
		started_at: startedAt,
		ended_at: endedAt,
		duration_ms: durationMs,
		event_count: hasEvents ? enrichment.eventCount : (row.total_agent_runs || 0),

		// Tool calls from JSONL events (enriched)
		tool_calls_json: JSON.stringify(enrichment.toolCalls),

		// Agents from agent_runs aggregation
		agents_json: JSON.stringify(agentCounts),

		// Errors from JSONL + agent_runs
		errors_json: JSON.stringify(combinedErrors),

		// Message counts from JSONL events
		messages_json: JSON.stringify(enrichment.messages),

		// Token/cost from agent_runs aggregation
		prompt_tokens: row.total_prompt_tokens || 0,
		output_tokens: row.total_output_tokens || 0,
		reasoning_tokens: row.total_reasoning_tokens || 0,
		cost_usd: row.total_cost_usd || 0,
		model,

		// Completeness: higher if we have events.jsonl data
		extraction_completeness: hasEvents ? 0.95 : 0.75,

		extraction_run_id: runId,
		extracted_at: new Date().toISOString(),
		fingerprint_hash: null,
	};

	// Compute fingerprint hash from stable fields
	const hashInput = [
		fp.id,
		fp.source,
		fp.harness,
		fp.title,
		fp.repo,
		fp.branch,
		fp.started_at,
		fp.ended_at,
		fp.duration_ms,
		fp.event_count,
		fp.prompt_tokens,
		fp.output_tokens,
		fp.reasoning_tokens,
		fp.cost_usd,
		fp.model,
		fp.extraction_completeness,
	].filter((v) => v != null).join('|');
	fp.fingerprint_hash = crypto.createHash('sha256').update(hashInput).digest('hex');

	return fp;
}

// ---------------------------------------------------------------------------
// Main query
// ---------------------------------------------------------------------------

/**
 * Build the SQL query to extract session data with aggregated agent_runs.
 *
 * @returns {{ sql: string, columns: string[] }} SQL string and column names.
 */
function buildSessionQuery() {
	const sql = `
		SELECT
			s.id, s.source, s.harness, s.title,
			s.repo_path, s.repo_id, s.branch, s.worktree_path,
			s.model, s.plan_id, s.goal_id,
			s.started_at, s.ended_at, s.updated_at,
			COUNT(ar.id) as total_agent_runs,
			SUM(CASE WHEN ar.status = 'completed' THEN 1 ELSE 0 END) as completed_runs,
			SUM(CASE WHEN ar.status = 'error' THEN 1 ELSE 0 END) as error_runs,
			SUM(ar.prompt_tokens) as total_prompt_tokens,
			SUM(ar.output_tokens) as total_output_tokens,
			SUM(ar.reasoning_tokens) as total_reasoning_tokens,
			SUM(ar.cost_usd) as total_cost_usd,
			AVG(ar.duration_ms) as avg_duration_ms,
			GROUP_CONCAT(DISTINCT ar.agent_name) as agents,
			GROUP_CONCAT(DISTINCT ar.model_id) as models,
			GROUP_CONCAT(DISTINCT CASE WHEN ar.error_code IS NOT NULL THEN ar.error_code END) as error_codes,
			GROUP_CONCAT(DISTINCT CASE WHEN ar.error_message IS NOT NULL THEN ar.error_message END) as error_messages
		FROM sessions s
		LEFT JOIN agent_runs ar ON s.id = ar.session_id
		WHERE s.updated_at > COALESCE(?, '1970-01-01')
		GROUP BY s.id
		ORDER BY s.updated_at DESC
	`;
	return sql;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Extract session fingerprints from the Copilot/Elegy data sources.
 *
 * @param {object} [options]
 * @param {string} [options.elegyHome] — Path to Elegy home (~/.elegy).
 * @param {import('better-sqlite3').Database} [options.db] — Open analytics DB handle.
 *                                                   If not provided, will open
 *                                                   default path via openDb().
 * @param {string} [options.runId] — Extraction run ID. Generated if not provided.
 * @param {string} [options.since] — ISO timestamp; only process sessions updated
 *                                   after this time. Overrides watermark.
 * @returns {{ sessionsProcessed: number, sessionsNew: number, sessionsUpdated: number, errors: string[] }}
 */
export function extract(options = {}) {
	const errors = [];
	let sessionsProcessed = 0;
	let sessionsNew = 0;
	let sessionsUpdated = 0;

	// Resolve paths
	const elegyHome = options.elegyHome || path.join(os.homedir(), '.elegy');
	const copilotDbPath = path.join(elegyHome, 'elegy-copilot.db');
	const sessionStateDir = path.join(elegyHome, 'session-state');

	// Run ID
	const runId = options.runId || `copilot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

	// Open analytics DB (target for fingerprints)
	let closeAnalyticsDb = false;
	let analyticsDb;
	try {
		if (options.db) {
			analyticsDb = options.db;
		} else {
			analyticsDb = openDb();
			closeAnalyticsDb = true;
		}
	} catch (err) {
		return { sessionsProcessed: 0, sessionsNew: 0, sessionsUpdated: 0, errors: [`Failed to open analytics database: ${err.message}`] };
	}

	try {
		// Check if elegy-copilot.db exists
		const copilotDbStat = safeStat(copilotDbPath);
		if (!copilotDbStat || !copilotDbStat.isFile()) {
			errors.push(`elegy-copilot.db not found at: ${copilotDbPath}`);
			try {
				completeExtractionRun(analyticsDb, runId, 'failed', {
					sessions_processed: 0,
					sessions_new: 0,
					sessions_updated: 0,
				});
			} catch { /* ignore */ }
			return { sessionsProcessed: 0, sessionsNew: 0, sessionsUpdated: 0, errors };
		}

		// Determine watermark
		let since = options.since || null;
		if (!since) {
			try {
				const watermark = getWatermark(analyticsDb, 'copilot');
				if (watermark && watermark.last_ended_at) {
					since = watermark.last_ended_at;
				}
			} catch (err) {
				errors.push(`Failed to read watermark: ${err.message}`);
			}
		}

		// Open copilot DB in readonly mode
		let copilotDb;
		try {
			copilotDb = new Database(copilotDbPath, { readonly: true, fileMustExist: true });
		} catch (err) {
			errors.push(`Failed to open elegy-copilot.db: ${err.message}`);
			try {
				completeExtractionRun(analyticsDb, runId, 'failed', {
					sessions_processed: 0,
					sessions_new: 0,
					sessions_updated: 0,
					error: errors[errors.length - 1],
				});
			} catch { /* ignore */ }
			return { sessionsProcessed: 0, sessionsNew: 0, sessionsUpdated: 0, errors };
		}

		try {
			// Query sessions with aggregated agent_runs
			const sql = buildSessionQuery();
			const stmt = copilotDb.prepare(sql);
			const rows = stmt.all(since || '1970-01-01');

			if (rows.length === 0) {
				// No new sessions to process
				try {
					completeExtractionRun(analyticsDb, runId, 'completed', {
						sessions_processed: 0,
						sessions_new: 0,
						sessions_updated: 0,
					});
				} catch { /* ignore */ }
				return { sessionsProcessed: 0, sessionsNew: 0, sessionsUpdated: 0, errors };
			}

			// Check if session-state directory exists for JSONL enrichment
			const hasSessionState = safeStat(sessionStateDir) !== null && safeStat(sessionStateDir).isDirectory();

			// Track latest session for watermark
			let latestSessionId = null;
			let latestEndedAt = null;

			// Prepared statement reused inside transaction loop
			const fingerprintExistsStmt = analyticsDb.prepare('SELECT id FROM session_fingerprints WHERE id = ?');

			// Process each session
			const insertBatch = analyticsDb.transaction(() => {
				for (const row of rows) {
					sessionsProcessed++;

					// Check if this is a new session or update
					const existing = fingerprintExistsStmt.get(row.id);
					const isNew = !existing;

					// Enrich from events.jsonl (best-effort)
					let enrichment = { toolCalls: [], errors: [], messages: { user: 0, assistant: 0 }, eventCount: 0 };
					let hasEvents = false;

					if (hasSessionState && row.id) {
						const sessionEventsDir = path.join(sessionStateDir, row.id);
						const eventsStat = safeStat(path.join(sessionEventsDir, 'events.jsonl'));
						if (eventsStat && eventsStat.isFile() && eventsStat.size > 0) {
							try {
								enrichment = enrichFromEvents(sessionEventsDir);
								hasEvents = enrichment.eventCount > 0;
							} catch (err) {
								errors.push(`Failed to enrich session ${row.id}: ${err.message}`);
								// Fall through — use DB-only data
							}
						}
					}

					// Build and upsert fingerprint
					const fp = buildFingerprint(row, enrichment, runId, hasEvents);
					upsertFingerprint(analyticsDb, fp);

					if (isNew) {
						sessionsNew++;
					} else {
						sessionsUpdated++;
					}

					// Track latest for watermark
					if (row.updated_at) {
						if (!latestEndedAt || row.updated_at > latestEndedAt) {
							latestEndedAt = row.updated_at;
							latestSessionId = row.id;
						}
					}
				}
			});

			insertBatch();

			// Update watermark
			if (latestSessionId && latestEndedAt) {
				try {
					setWatermark(analyticsDb, 'copilot', latestSessionId, latestEndedAt);
				} catch (err) {
					errors.push(`Failed to set watermark: ${err.message}`);
				}
			}

			// Complete extraction run
			const runStatus = errors.length > 0 ? 'failed' : 'completed';
			try {
				completeExtractionRun(analyticsDb, runId, runStatus, {
					sessions_processed: sessionsProcessed,
					sessions_new: sessionsNew,
					sessions_updated: sessionsUpdated,
				});
			} catch (err) {
				errors.push(`Failed to complete extraction run: ${err.message}`);
			}
		} finally {
			try {
				copilotDb.close();
			} catch { /* ignore */ }
		}
	} finally {
		if (closeAnalyticsDb) {
			try {
				analyticsDb.close();
			} catch { /* ignore */ }
		}
	}

	return { sessionsProcessed, sessionsNew, sessionsUpdated, errors };
}

export default { extract };
