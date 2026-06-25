#!/usr/bin/env node
'use strict';

/**
 * CLI orchestrator for the full session analytics pipeline.
 *
 * Runs: schema discovery → extraction → pattern detection → output.
 *
 * Usage:
 *   node scripts/session-analytics/run-analytics.mjs
 *   node scripts/session-analytics/run-analytics.mjs --skip-extract
 *   node scripts/session-analytics/run-analytics.mjs --skip-patterns
 *   node scripts/session-analytics/run-analytics.mjs --output ./report.json
 *   node scripts/session-analytics/run-analytics.mjs --harness opencode --since 2026-06-01
 *
 * @module run-analytics
 */

import { extractAll } from './extract-fingerprints.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load CJS modules via createRequire for reliable interop
const require = createRequire(import.meta.url);
const { detectAll } = require('./detect-patterns.js');
const { getDbPath, openDb, ensureSchema } = require('./db/schema.js');

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full analytics pipeline: extraction → pattern detection → summary.
 *
 * @param {object} [options]
 * @param {string}  [options.dbPath]       — Override analytics DB path.
 * @param {string}  [options.since]        — ISO timestamp filter for extraction.
 * @param {string[]} [options.harnesses]   — Harness list. Default: all.
 * @param {boolean} [options.skipExtract]  — Skip extraction step.
 * @param {boolean} [options.skipPatterns] — Skip pattern detection step.
 * @param {string}  [options.outputPath]   — Write full JSON report to file.
 * @returns {Promise<object>} Pipeline result with extraction + detection + summary.
 */
export async function runPipeline(options = {}) {
	const dbPath = options.dbPath || getDbPath();

	// ---- Step 0: Open DB ----
	const db = openDb(dbPath);
	ensureSchema(db);

	const result = {
		pipelineStartedAt: new Date().toISOString(),
		extraction: null,
		detection: null,
		summary: null,
	};

	try {
		// ---- Step 1: Extraction ----
		if (options.skipExtract) {
			result.extraction = { skipped: true };
		} else {
			try {
				result.extraction = await extractAll({
					dbPath,
					since: options.since,
					harnesses: options.harnesses,
				});
			} catch (err) {
				result.extraction = {
					error: `Extraction failed: ${err.message}`,
					totalProcessed: 0,
					totalNew: 0,
					totalUpdated: 0,
					byHarness: {},
				};
			}
		}

		// ---- Step 2: Pattern Detection ----
		if (options.skipPatterns) {
			result.detection = { skipped: true };
		} else {
			try {
				result.detection = detectAll(db);
			} catch (err) {
				result.detection = {
					error: `Pattern detection failed: ${err.message}`,
					patterns: [],
					stats: { totalPatterns: 0, byCategory: {}, byHarness: {} },
				};
			}
		}

		// ---- Step 3: Aggregate Summary ----
		result.summary = buildSummary(db, result.detection);
		result.pipelineCompletedAt = new Date().toISOString();

		// ---- Step 4: Write output to file ----
		if (options.outputPath) {
			const outputFile = path.resolve(options.outputPath);
			const outputDir = path.dirname(outputFile);
			if (!fs.existsSync(outputDir)) {
				fs.mkdirSync(outputDir, { recursive: true });
			}
			fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), 'utf-8');
			result.summary._outputWritten = outputFile;
		}
	} finally {
		try {
			db.close();
		} catch (_) {
			// best-effort close
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

/**
 * Build an aggregate summary from the fingerprints DB and detection results.
 *
 * Queries are cheap aggregate queries (no full row scanning).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object|null} detection — Result from detectAll(), or { skipped: true } / error object.
 * @returns {object} Compact summary object (~200 tokens).
 */
function buildSummary(db, detection) {
	const summary = {
		generatedAt: new Date().toISOString(),
		sessions: { total: 0, byHarness: {}, dateRange: {} },
		costs: { totalUsd: 0, topModels: [], harnessBreakdown: {} },
		patterns: { totalFound: 0, highPriority: 0, top3: [] },
		dataQuality: { codexCompleteness: 0, opencodeCompleteness: 0, copilotCompleteness: 0 },
	};

	// ---- Sessions: total & byHarness ----
	try {
		const byHarness = db
			.prepare('SELECT source, COUNT(*) AS count FROM session_fingerprints GROUP BY source')
			.all();
		summary.sessions.byHarness = {};
		for (const row of byHarness) {
			summary.sessions.byHarness[row.source] = row.count;
		}
		summary.sessions.total = byHarness.reduce((sum, r) => sum + r.count, 0);
	} catch (_) {
		summary.sessions.byHarness = { codex: 0, opencode: 0, copilot: 0 };
	}

	// ---- Sessions: date range ----
	try {
		const range = db
			.prepare(
				'SELECT MIN(started_at) AS earliest, MAX(started_at) AS latest FROM session_fingerprints',
			)
			.get();
		summary.sessions.dateRange = {
			earliest: range.earliest || null,
			latest: range.latest || null,
		};
	} catch (_) {
		summary.sessions.dateRange = { earliest: null, latest: null };
	}

	// ---- Costs: total, topModels, harnessBreakdown ----
	try {
		const totalCost = db
			.prepare('SELECT SUM(cost_usd) AS total FROM session_fingerprints')
			.get();
		summary.costs.totalUsd = totalCost.total || 0;

		const models = db
			.prepare(
				`SELECT model, COUNT(*) AS count, SUM(cost_usd) AS totalCost
				 FROM session_fingerprints
				 WHERE model IS NOT NULL AND model != ''
				 GROUP BY model
				 ORDER BY count DESC
				 LIMIT 5`,
			)
			.all();
		summary.costs.topModels = models.map((m) => ({
			model: m.model,
			count: m.count,
			totalCost: Math.round((m.totalCost || 0) * 100) / 100,
		}));

		const harnessCosts = db
			.prepare(
				`SELECT source, SUM(cost_usd) AS totalCost
				 FROM session_fingerprints
				 WHERE cost_usd > 0
				 GROUP BY source`,
			)
			.all();
		summary.costs.harnessBreakdown = {};
		for (const row of harnessCosts) {
			summary.costs.harnessBreakdown[row.source] = Math.round((row.totalCost || 0) * 100) / 100;
		}
	} catch (_) {
		summary.costs.totalUsd = 0;
		summary.costs.topModels = [];
		summary.costs.harnessBreakdown = {};
	}

	// ---- Patterns ----
	if (detection && detection.patterns && Array.isArray(detection.patterns)) {
		const patterns = detection.patterns;
		summary.patterns.totalFound = patterns.length;
		summary.patterns.highPriority = patterns.filter(
			(p) => p.confidence > 0.7 && p.frequency >= 3,
		).length;
		summary.patterns.top3 = patterns.slice(0, 3).map((p) => ({
			category: p.category,
			pattern: p.pattern,
			frequency: p.frequency,
			recommendation: extractRecommendation(p),
		}));
	} else if (detection && detection.stats) {
		summary.patterns.totalFound = detection.stats.totalPatterns || 0;
	}

	// ---- Data quality: avg extraction_completeness per source ----
	try {
		const completeness = db
			.prepare(
				`SELECT source, AVG(extraction_completeness) AS avgComp
				 FROM session_fingerprints
				 WHERE extraction_completeness IS NOT NULL
				 GROUP BY source`,
			)
			.all();
		for (const row of completeness) {
			const key = row.source === 'opencode' ? 'opencodeCompleteness'
				: row.source === 'codex' ? 'codexCompleteness'
				: row.source === 'copilot' ? 'copilotCompleteness'
				: null;
			if (key) {
				summary.dataQuality[key] = Math.round((row.avgComp || 0) * 1000) / 1000;
			}
		}
	} catch (_) {
		// leave defaults (0)
	}

	return summary;
}

/**
 * Extract a human-readable recommendation from a pattern's evidence_json.
 *
 * @param {object} pattern
 * @returns {string}
 */
function extractRecommendation(pattern) {
	if (!pattern.evidence_json) return '';
	try {
		const ev =
			typeof pattern.evidence_json === 'string'
				? JSON.parse(pattern.evidence_json)
				: pattern.evidence_json;
		return ev.suggestion || ev.potentialSavings || '';
	} catch {
		return '';
	}
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Print the summary to stdout in mixed human-readable + structured JSON format.
 *
 * @param {object} summary
 */
function printSummary(summary) {
	const s = summary;
	const lines = [
		'========================================',
		'Session Analytics Report',
		`Generated: ${s.generatedAt}`,
		'========================================',
		'',
		`Sessions: ${(s.sessions.total || 0).toLocaleString()} total`,
		`  Codex:    ${s.sessions.byHarness.codex || 0}`,
		`  OpenCode: ${s.sessions.byHarness.opencode || 0}`,
		`  Copilot:  ${s.sessions.byHarness.copilot || 0}`,
		'',
		`Costs: $${(s.costs.totalUsd || 0).toFixed(2)} total`,
	];

	if (s.costs.topModels && s.costs.topModels.length > 0) {
		lines.push('  Top models:');
		for (const m of s.costs.topModels) {
			lines.push(`    ${m.model}: ${m.count} sessions, $${m.totalCost.toFixed(2)}`);
		}
	}

	lines.push('');
	lines.push(`Patterns Found: ${s.patterns.totalFound} (${s.patterns.highPriority} high priority)`);

	if (s.patterns.top3 && s.patterns.top3.length > 0) {
		lines.push('Top 3:');
		for (let i = 0; i < s.patterns.top3.length; i++) {
			const p = s.patterns.top3[i];
			const rec = p.recommendation ? `\n       → ${p.recommendation}` : '';
			lines.push(
				`  ${i + 1}. [${p.category}] ${p.pattern} (${p.frequency} sessions)${rec}`,
			);
		}
	}

	if (s._outputWritten) {
		lines.push('');
		lines.push(`Report written to: ${s._outputWritten}`);
	}

	lines.push('');
	lines.push('--- JSON OUTPUT (for AI consumption) ---');
	lines.push(JSON.stringify(summary, null, 2));

	process.stdout.write(lines.join('\n') + '\n');
}

/**
 * Parse CLI arguments and run the pipeline.
 *
 * Supported flags:
 *   --skip-extract    — Skip extraction, run detection on existing data
 *   --skip-patterns   — Skip pattern detection, run extraction only
 *   --output <path>   — Write full JSON report to file
 *   --since   <ISO>   — ISO timestamp filter for extraction
 *   --harness <name>  — Repeatable, filter to specific harness(es)
 *
 * @returns {object} Parsed flags.
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const flags = {};

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--skip-extract':
				flags.skipExtract = true;
				break;
			case '--skip-patterns':
				flags.skipPatterns = true;
				break;
			case '--output':
				if (i + 1 < args.length) {
					flags.outputPath = args[++i];
				}
				break;
			case '--since':
				if (i + 1 < args.length) {
					flags.since = args[++i];
				}
				break;
			case '--harness':
				if (i + 1 < args.length) {
					flags.harnesses = flags.harnesses || [];
					flags.harnesses.push(args[++i]);
				}
				break;
			default:
				// Silently skip unknown flags — forward-compat
				break;
		}
	}

	return flags;
}

function main() {
	const flags = parseArgs();

	runPipeline(flags)
		.then((result) => {
			printSummary(result.summary);
			process.exit(0);
		})
		.catch((err) => {
			process.stderr.write(`Pipeline failed: ${err.message}\n`);
			process.exit(1);
		});
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
	main();
}
