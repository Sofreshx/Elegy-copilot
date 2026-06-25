#!/usr/bin/env node
'use strict';

/**
 * Session Fingerprint Extraction Orchestrator.
 *
 * Runs all three harness backends (codex, opencode, copilot) in sequence and
 * aggregates their results into a single extraction run record.
 *
 * Usage:
 *   node scripts/session-analytics/extract-fingerprints.mjs
 *   node scripts/session-analytics/extract-fingerprints.mjs --harness opencode --harness codex --since 2026-06-01
 *
 * @module extract-fingerprints
 */

import { getDbPath, openDb, ensureSchema } from './db/schema.js';
import { startExtractionRun, completeExtractionRun } from './db/queries.js';
import { extract as extractCodex } from './backends/codex-backend.mjs';
import { extract as extractOpenCode } from './backends/opencode-backend.mjs';
import { extract as extractCopilot } from './backends/copilot-backend.mjs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run extraction across the specified harness backends.
 *
 * Opens the analytics database once, passes the handle to each backend (so
 * they don't manage their own connection lifetime), runs backends sequentially
 * to avoid SQLite write contention, and records an aggregate extraction run.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath]    — Override path to the analytics DB.
 *                                       Defaults to getDbPath() (~/.elegy/session-analytics.db).
 * @param {string} [options.since]     — ISO timestamp; only sessions with
 *                                       updated_at newer than this are processed.
 *                                       When omitted, uses persisted watermarks.
 * @param {string[]} [options.harnesses] — Harness list to run.
 *                                         Default: ['copilot', 'opencode', 'codex'].
 * @returns {Promise<object>} Aggregate result with per-harness breakdown.
 */
export async function extractAll(options = {}) {
	const dbPath = options.dbPath || getDbPath();
	const db = openDb(dbPath);
	ensureSchema(db);

	const runId = randomUUID();
	const harnesses = options.harnesses || ['copilot', 'opencode', 'codex'];

	// Record the orchestrator-level extraction run
	startExtractionRun(db, runId);

	const results = {};
	let aggregate;

	try {
		// ---- Run harnesses sequentially (no parallel — avoid SQLite write contention) ----

		if (harnesses.includes('codex')) {
			try {
				results.codex = extractCodex({
					db,
					runId,
					codexHome: path.join(os.homedir(), '.codex'),
					since: options.since,
				});
			} catch (err) {
				results.codex = {
					sessionsProcessed: 0,
					sessionsNew: 0,
					sessionsUpdated: 0,
					errors: [`codex backend crashed: ${err.message}`],
				};
			}
		}

		if (harnesses.includes('opencode')) {
			try {
				// OpenCode backend expects `since` as epoch seconds, not ISO
				const opencodeSince = options.since
					? Math.floor(new Date(options.since).getTime() / 1000)
					: undefined;

				results.opencode = extractOpenCode({
					db,
					runId,
					opencodeHome: path.join(os.homedir(), '.local', 'share', 'opencode'),
					since: opencodeSince,
				});
			} catch (err) {
				results.opencode = {
					sessionsProcessed: 0,
					sessionsNew: 0,
					sessionsUpdated: 0,
					errors: [`opencode backend crashed: ${err.message}`],
				};
			}
		}

		if (harnesses.includes('copilot')) {
			try {
				results.copilot = extractCopilot({
					db,
					runId,
					elegyHome: path.join(os.homedir(), '.elegy'),
					since: options.since,
				});
			} catch (err) {
				results.copilot = {
					sessionsProcessed: 0,
					sessionsNew: 0,
					sessionsUpdated: 0,
					errors: [`copilot backend crashed: ${err.message}`],
				};
			}
		}
	} finally {
		// ---- Aggregate and record ----

		aggregate = {
			runId,
			totalProcessed: Object.values(results).reduce(
				(sum, r) => sum + (r.sessionsProcessed || 0),
				0,
			),
			totalNew: Object.values(results).reduce(
				(sum, r) => sum + (r.sessionsNew || 0),
				0,
			),
			totalUpdated: Object.values(results).reduce(
				(sum, r) => sum + (r.sessionsUpdated || 0),
				0,
			),
			byHarness: results,
		};

		// Record aggregate stats (overwrites per-backend stats that backends may
		// have written via their own internal completeExtractionRun calls).
		try {
			completeExtractionRun(db, runId, 'completed', {
				sessions_processed: aggregate.totalProcessed,
				sessions_new: aggregate.totalNew,
				sessions_updated: aggregate.totalUpdated,
			});
		} catch (err) {
			// Last-resort — swallow so we still return the aggregate
			console.error(`completeExtractionRun error: ${err.message}`);
		}

		try {
			db.close();
		} catch (_) {
			// best-effort close
		}
	}

	return aggregate;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments and run extraction, printing JSON to stdout.
 *
 * Arguments:
 *   --harness <name>   — Repeatable. Default: all three.
 *   --since <ISO>      — ISO timestamp filter.
 *
 * Exits 0 on success, 1 on failure.
 */
function main() {
	const args = process.argv.slice(2);
	const harnesses = [];
	let since;

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--harness':
				if (i + 1 < args.length) {
					harnesses.push(args[++i]);
				}
				break;
			case '--since':
				if (i + 1 < args.length) {
					since = args[++i];
				}
				break;
			default:
				// Skip unknown flags — don't crash on future additions
				break;
		}
	}

	const options = {};
	if (harnesses.length > 0) options.harnesses = harnesses;
	if (since) options.since = since;

	extractAll(options)
		.then((result) => {
			process.stdout.write(JSON.stringify(result, null, 2) + '\n');
			// Exit 0 even if individual backends reported errors — those are
			// per-harness operational issues, not orchestrator failures.
			// Exit 1 only on unhandled rejection (caught below).
			process.exit(0);
		})
		.catch((err) => {
			process.stderr.write(
				JSON.stringify({ error: `Orchestrator failed: ${err.message}` }, null, 2) + '\n',
			);
			process.exit(1);
		});
}

// Run when executed directly (not imported)
// Use fileURLToPath for cross-platform Windows/Unix path comparison
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
	main();
}
