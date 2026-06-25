'use strict';

/**
 * Pattern detection algorithms for session fingerprints.
 *
 * Runs deterministic detectors over session fingerprints to surface:
 *  - Title similarity clusters (skill opportunities)
 *  - Cost outliers (cost optimization opportunities)
 *  - Error clusters (recurring failure patterns)
 *  - Agent usage patterns (workflow skill opportunities)
 *
 * @module detect-patterns
 */

const crypto = require('crypto');
const { getDbPath, openDb } = require('./db/schema.js');
const {
	getFingerprintsByCompleteness,
	getPatternsByCategory,
	upsertPattern,
	clearPatternCache,
} = require('./db/queries.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum sessions to compare pairwise in title clustering (prevents O(n²) blowup). */
const MAX_TITLE_COMPARISONS = 2000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic pattern ID from category, harness, and pattern name.
 *
 * @param {string} category
 * @param {string} harness
 * @param {string} pattern
 * @returns {string} Short hex digest (16 chars).
 */
function patternId(category, harness, pattern) {
	return crypto
		.createHash('sha256')
		.update(`${category}:${harness}:${pattern}`)
		.digest('hex')
		.substring(0, 16);
}

/**
 * Compute the set of character bigrams for a string.
 *
 * Normalises to lowercase, strips non-alphanumeric (preserving spaces),
 * then extracts all overlapping 2-character substrings.
 *
 * @param {string} str
 * @returns {Set<string>}
 */
function bigrams(str) {
	const s = str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
	const bg = new Set();
	for (let i = 0; i < s.length - 1; i++) {
		bg.add(s.substring(i, i + 2));
	}
	return bg;
}

/**
 * Dice coefficient for two strings based on character bigrams.
 *
 * Dice = 2 * |intersection| / (|A| + |B|)
 *
 * Returns 0 when either string has fewer than 2 characters after sanitisation
 * (making bigram sets empty).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} 0.0 – 1.0
 */
function dice(a, b) {
	const setA = bigrams(a);
	const setB = bigrams(b);

	if (setA.size === 0 && setB.size === 0) {
		// Both empty after sanitisation — treat as exact match only when
		// the original strings were identical (allowing empty/whitespace-only).
		return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1.0 : 0.0;
	}
	if (setA.size === 0 || setB.size === 0) {
		return 0.0;
	}

	let intersection = 0;
	for (const item of setA) {
		if (setB.has(item)) {
			intersection++;
		}
	}

	return (2 * intersection) / (setA.size + setB.size);
}

/**
 * Safely parse a JSON string field, returning a fallback on failure.
 *
 * @param {string|null|undefined} raw — JSON string from DB column.
 * @param {*} fallback — Default value when null, undefined, or invalid.
 * @returns {*}
 */
function safeJsonParse(raw, fallback) {
	if (raw === null || raw === undefined || raw === '') {
		return fallback;
	}
	try {
		return JSON.parse(raw);
	} catch {
		return fallback;
	}
}

/**
 * Create a pattern object ready for upsertPattern() and return.
 *
 * @param {object} params
 * @param {string} params.category
 * @param {string} params.harness
 * @param {string} params.pattern
 * @param {number} params.frequency
 * @param {string[]} params.sessionIds
 * @param {number} params.confidence
 * @param {object} params.evidence
 * @returns {object}
 */
function makePattern({ category, harness, pattern, frequency, sessionIds, confidence, evidence }) {
	return {
		id: patternId(category, harness, pattern),
		category,
		harness,
		pattern,
		frequency,
		session_ids_json: JSON.stringify(sessionIds),
		confidence,
		evidence_json: JSON.stringify(evidence),
		generated_at: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// 1. Title Similarity Clustering
// ---------------------------------------------------------------------------

/**
 * Detect clusters of sessions with similar titles.
 *
 * Uses Dice coefficient on character bigrams, grouped by harness.
 * A cluster is "interesting" when it has >= 3 sessions and at least one
 * pair within it reaches similarity >= 0.8.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [threshold=0.6] — Minimum average Dice similarity for a cluster.
 * @returns {object[]} Array of pattern objects.
 */
function detectTitleClusters(db, threshold = 0.6) {
	const fps = getFingerprintsByCompleteness(db, 0.1);
	const withTitles = fps.filter((fp) => fp.title && fp.title.length > 3);

	if (withTitles.length < 3) {
		return [];
	}

	// Group by harness
	const byHarness = {};
	for (const fp of withTitles) {
		const h = fp.source || 'unknown';
		if (!byHarness[h]) {
			byHarness[h] = [];
		}
		byHarness[h].push(fp);
	}

	const patterns = [];

	for (const [harness, group] of Object.entries(byHarness)) {
		// Sample if too large (priority: keep most recent)
		const sampled = group.length > MAX_TITLE_COMPARISONS
			? group.slice(0, MAX_TITLE_COMPARISONS)
			: group;

		const n = sampled.length;
		if (n < 3) continue;

		// Compute pairwise similarity edges (dice > 0.5 to limit connections)
		const edges = []; // { i, j, sim }
		const adj = new Map(); // i -> Set of j

		for (let i = 0; i < n; i++) {
			adj.set(i, new Set());
		}

		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const sim = dice(sampled[i].title, sampled[j].title);
				if (sim > 0.5) {
					edges.push({ i, j, sim });
					adj.get(i).add(j);
					adj.get(j).add(i);
				}
			}
		}

		// Find connected components (BFS)
		const visited = new Set();
		for (let start = 0; start < n; start++) {
			if (visited.has(start)) continue;

			// BFS to find the component
			const component = [];
			const queue = [start];
			visited.add(start);

			while (queue.length > 0) {
				const v = queue.shift();
				component.push(v);
				for (const nb of adj.get(v)) {
					if (!visited.has(nb)) {
						visited.add(nb);
						queue.push(nb);
					}
				}
			}

			if (component.length < 3) continue;

			// Compute max similarity within the component
			let maxSim = 0;
			for (const { i, j, sim } of edges) {
				if (component.includes(i) && component.includes(j)) {
					if (sim > maxSim) maxSim = sim;
				}
			}

			if (maxSim < 0.8) continue;

			// Calculate average dice similarity
			let totalSim = 0;
			let pairCount = 0;
			for (const { i, j, sim } of edges) {
				if (component.includes(i) && component.includes(j)) {
					totalSim += sim;
					pairCount++;
				}
			}
			const avgSim = pairCount > 0 ? totalSim / pairCount : 0;

			if (avgSim < threshold) continue;

			// Build cluster data
			const clusterSessions = component.map((idx) => sampled[idx]);
			const sessionIds = clusterSessions.map((fp) => fp.id);
			const sampleTitles = clusterSessions.slice(0, 5).map((fp) => fp.title);

			const confidence = maxSim * Math.min(1, clusterSessions.length / 10);

			patterns.push(
				makePattern({
					category: 'skill-opportunity',
					harness,
					pattern: 'repeated-similar-title',
					frequency: clusterSessions.length,
					sessionIds,
					confidence,
					evidence: {
						sampleTitles,
						harness,
						totalInCluster: clusterSessions.length,
						averageSimilarity: Math.round(avgSim * 100) / 100,
						maxSimilarity: Math.round(maxSim * 100) / 100,
						suggestion: 'Create a skill for this repeated workflow',
					},
				})
			);
		}
	}

	return patterns;
}

// ---------------------------------------------------------------------------
// 2. Cost Outlier Detection
// ---------------------------------------------------------------------------

/**
 * Detect sessions that cost significantly more than typical for their harness.
 *
 * Uses the interquartile range (IQR) method per harness.
 * Also flags cross-harness sessions using expensive models for simple tasks
 * (high cost but low duration_ms or event_count).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [iqrMultiplier=1.5] — IQR multiplier for the upper fence.
 * @returns {object[]} Array of pattern objects.
 */
function detectCostOutliers(db, iqrMultiplier = 1.5) {
	const fps = getFingerprintsByCompleteness(db, 0.3);
	const withCost = fps.filter((fp) => fp.cost_usd > 0);

	if (withCost.length < 4) {
		return [];
	}

	// Group costs by harness
	const byHarness = {};
	for (const fp of withCost) {
		const h = fp.source || 'unknown';
		if (!byHarness[h]) {
			byHarness[h] = [];
		}
		byHarness[h].push(fp);
	}

	const patterns = [];

	for (const [harness, group] of Object.entries(byHarness)) {
		const costs = group.map((fp) => fp.cost_usd).sort((a, b) => a - b);
		const n = costs.length;

		if (n < 4) continue;

		// Compute quartiles
		const q1Idx = Math.floor(n * 0.25);
		const q3Idx = Math.floor(n * 0.75);
		const q1 = costs[q1Idx];
		const q3 = costs[q3Idx];
		const iqr = q3 - q1;
		const upperFence = q3 + iqrMultiplier * iqr;
		const median = n % 2 === 0
			? (costs[n / 2 - 1] + costs[n / 2]) / 2
			: costs[Math.floor(n / 2)];

		if (iqr === 0) continue; // No meaningful outliers

		const outliers = group.filter((fp) => fp.cost_usd > upperFence);

		if (outliers.length === 0) continue;

		const outlierSessions = outliers.map((fp) => fp.id);
		const totalOutlierCost = outliers.reduce((sum, fp) => sum + fp.cost_usd, 0);
		const potentialSavings = `~$${totalOutlierCost.toFixed(2)} across ${outliers.length} sessions`;

		const confidence = Math.min(0.95, 0.5 + (outliers.length / n) * 0.5);

		patterns.push(
			makePattern({
				category: 'cost-optimization',
				harness,
				pattern: 'cost-outlier',
				frequency: outliers.length,
				sessionIds: outlierSessions,
				confidence,
				evidence: {
					medianCost: Math.round(median * 10000) / 10000,
					outlierThreshold: Math.round(upperFence * 10000) / 10000,
					outlierSessions,
					outlierCount: outliers.length,
					totalOutlierCost: Math.round(totalOutlierCost * 10000) / 10000,
					potentialSavings,
					harness,
				},
			})
		);
	}

	// Cross-harness: expensive model for simple task
	// Flag sessions with high cost but low duration_ms or low event_count
	if (withCost.length >= 10) {
		const allCosts = withCost.map((fp) => fp.cost_usd).sort((a, b) => a - b);
		const medCost = allCosts.length % 2 === 0
			? (allCosts[allCosts.length / 2 - 1] + allCosts[allCosts.length / 2]) / 2
			: allCosts[Math.floor(allCosts.length / 2)];

		const durations = withCost
			.filter((fp) => fp.duration_ms > 0)
			.map((fp) => fp.duration_ms)
			.sort((a, b) => a - b);
		const medDuration = durations.length > 0
			? (durations.length % 2 === 0
				? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
				: durations[Math.floor(durations.length / 2)])
			: 0;

		const eventCounts = withCost
			.filter((fp) => fp.event_count > 0)
			.map((fp) => fp.event_count)
			.sort((a, b) => a - b);
		const medEventCount = eventCounts.length > 0
			? (eventCounts.length % 2 === 0
				? (eventCounts[eventCounts.length / 2 - 1] + eventCounts[eventCounts.length / 2]) / 2
				: eventCounts[Math.floor(eventCounts.length / 2)])
			: 0;

		const inefficient = withCost.filter((fp) => {
			if (fp.cost_usd <= medCost) return false;
			// High cost but low duration or low event count
			if (fp.duration_ms > 0 && fp.duration_ms < medDuration * 0.5) return true;
			if (fp.event_count > 0 && fp.event_count < medEventCount * 0.5) return true;
			return false;
		});

		if (inefficient.length >= 2) {
			const ineffSessions = inefficient.map((fp) => fp.id);
			const totalIneffCost = inefficient.reduce((sum, fp) => sum + fp.cost_usd, 0);

			patterns.push(
				makePattern({
					category: 'cost-optimization',
					harness: 'cross-harness',
					pattern: 'expensive-model-exploration',
					frequency: inefficient.length,
					sessionIds: ineffSessions,
					confidence: Math.min(0.9, 0.5 + (inefficient.length / withCost.length) * 0.4),
					evidence: {
						medianCost: Math.round(medCost * 10000) / 10000,
						medianDurationMs: medDuration,
						medianEventCount: medEventCount,
						inefficientSessions: ineffSessions,
						totalWastedCost: Math.round(totalIneffCost * 10000) / 10000,
						potentialSavings: `~$${totalIneffCost.toFixed(2)} across ${inefficient.length} sessions by routing to cheaper models`,
						harness: 'cross-harness',
					},
				})
			);
		}
	}

	return patterns;
}

// ---------------------------------------------------------------------------
// 3. Error Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Detect recurring error patterns across sessions.
 *
 * Parses errors_json, normalises error messages (strips session-specific
 * IDs, truncates to 80 chars), groups by normalised message, and clusters
 * similar messages via prefix matching.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} [minFrequency=2] — Minimum occurrence count to report.
 * @returns {object[]} Array of pattern objects.
 */
function detectErrorClusters(db, minFrequency = 2) {
	const fps = getFingerprintsByCompleteness(db, 0.1);

	// Collect all errors with their session IDs
	const allErrors = []; // { sessionId, harness, type, message, count }

	for (const fp of fps) {
		const errors = safeJsonParse(fp.errors_json, []);
		if (!Array.isArray(errors) || errors.length === 0) continue;

		for (const err of errors) {
			if (!err.message && !err.type) continue;
			allErrors.push({
				sessionId: fp.id,
				harness: fp.source || 'unknown',
				type: err.type || '',
				message: err.message || '',
				count: typeof err.count === 'number' ? err.count : 1,
			});
		}
	}

	if (allErrors.length === 0) {
		return [];
	}

	// Normalise error messages: strip session-specific IDs, truncate to 80 chars
	function normalise(msg) {
		return msg
			.replace(/ses_[a-z0-9]+/gi, '<SESSION>')
			.replace(/[0-9a-f]{8,}/gi, '<HEX>')
			.replace(/run_[a-z0-9]+/gi, '<RUN>')
			.replace(/[\\"']/g, '')
			.substring(0, 80)
			.trim();
	}

	// Group by normalised message
	const byMessage = {};
	for (const err of allErrors) {
		const key = normalise(err.message || err.type);
		if (!key) continue;
		if (!byMessage[key]) {
			byMessage[key] = {
				key,
				originalMessages: new Set(),
				sessionIds: new Set(),
				totalOccurrences: 0,
				harnesses: new Set(),
			};
		}
		byMessage[key].harnesses.add(err.harness);
		byMessage[key].originalMessages.add((err.message || err.type).substring(0, 120));
		byMessage[key].sessionIds.add(err.sessionId);
		byMessage[key].totalOccurrences += err.count;
	}

	// Cluster similar messages using prefix matching (first 30 chars)
	const grouped = Object.values(byMessage);
	const prefixClusters = {}; // prefix -> aggregated group

	for (const g of grouped) {
		const prefix = g.key.substring(0, 30);
		if (!prefixClusters[prefix]) {
			prefixClusters[prefix] = {
				prefix,
				keys: [],
				allMessages: new Set(),
				allSessionIds: new Set(),
				totalOccurrences: 0,
				harnesses: new Set(),
			};
		}
		prefixClusters[prefix].keys.push(g.key);
		for (const m of g.originalMessages) {
			prefixClusters[prefix].allMessages.add(m);
		}
		for (const sid of g.sessionIds) {
			prefixClusters[prefix].allSessionIds.add(sid);
		}
		prefixClusters[prefix].totalOccurrences += g.totalOccurrences;
		for (const h of g.harnesses) {
			prefixClusters[prefix].harnesses.add(h);
		}
	}

	const patterns = [];

	for (const cluster of Object.values(prefixClusters)) {
		const frequency = cluster.allSessionIds.size;
		if (frequency < minFrequency) continue;

		const mainHarness = cluster.harnesses.size === 1
			? [...cluster.harnesses][0]
			: 'cross-harness';

		// Determine the most common error type from the messages
		const errorType = cluster.keys
			.sort((a, b) => b.length - a.length)[0] // longest normalised message
			.substring(0, 50);

		// Confidence: higher when errors are frequent and consistent
		const consistency = cluster.keys.length === 1 ? 1 : 1 / cluster.keys.length;
		const confidence = Math.min(0.99, 0.3 + (frequency / 20) * 0.6 + consistency * 0.1);

		patterns.push(
			makePattern({
				category: 'error-pattern',
				harness: mainHarness,
				pattern: errorType,
				frequency,
				sessionIds: [...cluster.allSessionIds],
				confidence: Math.round(confidence * 100) / 100,
				evidence: {
					errorMessages: [...cluster.allMessages].slice(0, 10),
					totalOccurrences: cluster.totalOccurrences,
					affectedSessions: frequency,
					normalisedPrefix: cluster.prefix,
					suggestion: getErrorSuggestion(errorType),
				},
			})
		);
	}

	return patterns;
}

/**
 * Generate a human-readable suggestion for a given error pattern.
 *
 * @param {string} errorType
 * @returns {string}
 */
function getErrorSuggestion(errorType) {
	const lower = errorType.toLowerCase();
	if (lower.includes('rate_limit') || lower.includes('rate limit') || lower.includes('429')) {
		return 'Add rate limit retry backoff instruction to agent prompts';
	}
	if (lower.includes('timeout') || lower.includes('timed out')) {
		return 'Increase timeout limits or add retry logic for long-running operations';
	}
	if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('401') || lower.includes('403')) {
		return 'Review auth token refresh flow or credential configuration';
	}
	if (lower.includes('not found') || lower.includes('404')) {
		return 'Verify resource paths and availability before access';
	}
	if (lower.includes('token') || lower.includes('context length') || lower.includes('max length')) {
		return 'Optimise prompt length — truncate or summarise context';
	}
	if (lower.includes('permission') || lower.includes('access')) {
		return 'Review permission configuration for file system or API access';
	}
	if (lower.includes('parse') || lower.includes('syntax') || lower.includes('invalid')) {
		return 'Add input validation or format enforcement to agent workflow';
	}
	return 'Investigate recurring error and consider adding defensive handling';
}

// ---------------------------------------------------------------------------
// 4. Agent Usage Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Detect patterns in agent usage that suggest skill creation opportunities.
 *
 * Analyses:
 *  - Sessions using explorer + impl + reviewer together (full workflow skill)
 *  - Sessions with high agent turnover (fragmented work → skill)
 *  - Sessions switching models frequently (cost optimisation)
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]} Array of pattern objects.
 */
function detectAgentPatterns(db) {
	const fps = getFingerprintsByCompleteness(db, 0.1);

	const withAgents = fps.filter((fp) => {
		const agents = safeJsonParse(fp.agents_json, null);
		return agents !== null;
	});

	if (withAgents.length < 3) {
		return [];
	}

	// Parse agent data for each session
	const parsed = withAgents.map((fp) => {
		const agents = safeJsonParse(fp.agents_json, {});
		const models = safeJsonParse(fp.messages_json, {});

		let agentCounts = {};
		let modelNames = new Set();

		// agents_json has two formats across backends:
		// - opencode: {"agentName": 1} (object with count as value)
		// - copilot: [{"name": "agentName", "count": N}] (array of objects)
		// This detector handles both. New backends should use the array format for extensibility.
		if (Array.isArray(agents)) {
			// Array format: count unique agent names
			for (const entry of agents) {
				const name = (entry.agent || entry.name || '').toLowerCase();
				if (name) {
					agentCounts[name] = (agentCounts[name] || 0) + 1;
				}
				if (entry.model) modelNames.add(entry.model);
			}
		} else if (typeof agents === 'object' && agents !== null) {
			// Object format: agent name -> count
			agentCounts = { ...agents };

			// Check for nested model info
			if (agents.models && typeof agents.models === 'object') {
				for (const m of Object.keys(agents.models)) {
					modelNames.add(m);
				}
			}
		}

		// Also try to derive models from the fingerprint model field
		if (fp.model) {
			modelNames.add(fp.model);
		}

		return {
			fp,
			agents: agentCounts,
			models: modelNames,
			uniqueAgentCount: Object.keys(agentCounts).length,
		};
	});

	const patterns = [];

	// --- Pattern A: Explorer + Impl + Reviewer together (full workflow) ---
	const workflowSessions = parsed.filter((p) => {
		const agentNames = Object.keys(p.agents);
		return (
			agentNames.includes('explorer') &&
			agentNames.includes('impl') &&
			agentNames.includes('reviewer')
		);
	});

	if (workflowSessions.length >= 2) {
		const byHarness = {};
		for (const ws of workflowSessions) {
			const h = ws.fp.source || 'unknown';
			if (!byHarness[h]) byHarness[h] = [];
			byHarness[h].push(ws);
		}

		for (const [harness, wsGroup] of Object.entries(byHarness)) {
			patterns.push(
				makePattern({
					category: 'skill-opportunity',
					harness,
					pattern: 'full-workflow-agent-chain',
					frequency: wsGroup.length,
					sessionIds: wsGroup.map((w) => w.fp.id),
					confidence: Math.min(0.95, 0.5 + wsGroup.length * 0.05),
					evidence: {
						agentChain: ['explorer', 'impl', 'reviewer'],
						affectedSessions: wsGroup.length,
						harness,
						suggestion:
							'Create a workflow skill that chains explorer → impl → reviewer for automated code change workflows',
					},
				})
			);
		}
	}

	// --- Pattern B: High agent turnover (fragmented work) ---
	const highTurnover = parsed.filter((p) => p.uniqueAgentCount >= 4);

	if (highTurnover.length >= 2) {
		const byHarness = {};
		for (const ht of highTurnover) {
			const h = ht.fp.source || 'unknown';
			if (!byHarness[h]) byHarness[h] = [];
			byHarness[h].push(ht);
		}

		for (const [harness, htGroup] of Object.entries(byHarness)) {
			const avgAgents =
				htGroup.reduce((sum, p) => sum + p.uniqueAgentCount, 0) / htGroup.length;

			patterns.push(
				makePattern({
					category: 'skill-opportunity',
					harness,
					pattern: 'high-agent-turnover',
					frequency: htGroup.length,
					sessionIds: htGroup.map((w) => w.fp.id),
					confidence: Math.min(0.9, 0.3 + avgAgents * 0.1),
					evidence: {
						averageUniqueAgents: Math.round(avgAgents * 10) / 10,
						affectedSessions: htGroup.length,
						harness,
						suggestion:
							'Create a consolidated skill to reduce agent churn and keep context across steps',
					},
				})
			);
		}
	}

	// --- Pattern C: Model diversity (cost optimisation) ---
	const multiModel = parsed.filter((p) => p.models.size >= 3);

	if (multiModel.length >= 2) {
		const byHarness = {};
		for (const mm of multiModel) {
			const h = mm.fp.source || 'unknown';
			if (!byHarness[h]) byHarness[h] = [];
			byHarness[h].push(mm);
		}

		for (const [harness, mmGroup] of Object.entries(byHarness)) {
			const allModels = new Set();
			for (const m of mmGroup) {
				for (const model of m.models) {
					allModels.add(model);
				}
			}

			patterns.push(
				makePattern({
					category: 'cost-optimization',
					harness,
					pattern: 'frequent-model-switching',
					frequency: mmGroup.length,
					sessionIds: mmGroup.map((w) => w.fp.id),
					confidence: Math.min(0.85, 0.3 + mmGroup.length * 0.05),
					evidence: {
						modelsUsed: [...allModels],
						affectedSessions: mmGroup.length,
						harness,
						suggestion:
							'Consider standardising on a primary model and routing only complex tasks to premium models',
					},
				})
			);
		}
	}

	return patterns;
}

// ---------------------------------------------------------------------------
// 5. Master Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all pattern detectors, persist results, and return sorted patterns.
 *
 * Steps:
 *  1. Clear previous pattern cache
 *  2. Run each detector
 *  3. Persist all patterns to `pattern_cache`
 *  4. Sort by impact score (confidence * frequency), descending
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ patterns: object[], stats: object }}
 */
function detectAll(db) {
	clearPatternCache(db);

	const allPatterns = [
		...detectTitleClusters(db),
		...detectCostOutliers(db),
		...detectErrorClusters(db),
		...detectAgentPatterns(db),
	];

	// Persist to cache
	for (const pattern of allPatterns) {
		upsertPattern(db, pattern);
	}

	// Sort by impact score: confidence * frequency (descending)
	const sorted = allPatterns.sort(
		(a, b) => b.confidence * b.frequency - a.confidence * a.frequency
	);

	return {
		patterns: sorted,
		stats: computeStats(sorted),
	};
}

/**
 * Compute aggregate statistics over detected patterns.
 *
 * @param {object[]} patterns
 * @returns {object}
 */
function computeStats(patterns) {
	return {
		totalPatterns: patterns.length,
		byCategory: {
			'skill-opportunity': patterns.filter((p) => p.category === 'skill-opportunity').length,
			'cost-optimization': patterns.filter((p) => p.category === 'cost-optimization').length,
			'error-pattern': patterns.filter((p) => p.category === 'error-pattern').length,
			'asset-improvement': patterns.filter((p) => p.category === 'asset-improvement').length,
		},
		byHarness: {
			opencode: patterns.filter((p) => p.harness === 'opencode').length,
			codex: patterns.filter((p) => p.harness === 'codex').length,
			copilot: patterns.filter((p) => p.harness === 'copilot').length,
			'cross-harness': patterns.filter((p) => p.harness === 'cross-harness').length,
		},
	};
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

/**
 * CLI entry point — runs all detectors and prints a JSON summary to stdout.
 *
 * Usage:
 *   node scripts/session-analytics/detect-patterns.js
 */
function main() {
	const dbPath = getDbPath();
	console.error(`Opening session analytics DB: ${dbPath}`);

	const db = openDb(dbPath);
	try {
		const result = detectAll(db);

		// Print compact JSON summary to stdout
		console.log(JSON.stringify({ stats: result.stats, patternCount: result.patterns.length }));

		// Print detailed summary to stderr
		console.error('\n=== Pattern Detection Summary ===');
		console.error(`Total patterns detected: ${result.patterns.length}`);
		console.error(
			`  skill-opportunity:  ${result.stats.byCategory['skill-opportunity']}`
		);
		console.error(
			`  cost-optimization:  ${result.stats.byCategory['cost-optimization']}`
		);
		console.error(
			`  error-pattern:      ${result.stats.byCategory['error-pattern']}`
		);
		console.error(
			`  asset-improvement:   ${result.stats.byCategory['asset-improvement']}`
		);
		console.error('');

		// Print top 5 patterns by impact
		const top5 = result.patterns.slice(0, 5);
		for (let i = 0; i < top5.length; i++) {
			const p = top5[i];
			console.error(
				`  #${i + 1} [${p.category}] ${p.pattern} — freq=${p.frequency}, conf=${p.confidence}, impact=${(p.confidence * p.frequency).toFixed(2)}`
			);
		}
	} finally {
		db.close();
	}
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	detectAll,
	detectTitleClusters,
	detectCostOutliers,
	detectErrorClusters,
	detectAgentPatterns,
	main,
};

// Run as CLI when invoked directly
if (require.main === module) {
	main();
}
