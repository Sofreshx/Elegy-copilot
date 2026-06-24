'use strict';

/**
 * checkers/tool-config-sync.js — Detect drift between agent instruction files.
 *
 * Two modes:
 *   1. Link-based (default): Compare the set of internal doc references and key
 *      sections across instruction files. Catch semantic drift.
 *   2. Content hash (opt-in via { useHash: true }): Compare exact SHA256 of file
 *      pairs. Useful when files are expected to be identical copies of a shared
 *      template (e.g., AGENTS.md and a home-copied CLAUDE.md in the same repo).
 *
 * Exports:
 *   checkToolConfigSync(target, options) — Returns DriftIssue[] for detected drifts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Files to cross-compare via link-based analysis. */
const INSTRUCTION_FILES = [
	'AGENTS.md',
	'CLAUDE.md',
	'GEMINI.md',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract internal markdown links from file content.
 *
 * @param {string} content
 * @returns {string[]}
 */
function extractLinkTargets(content) {
	const targets = [];
	const linkRe = /\[([^\]]*)\]\(((?!https?:\/\/)(?!mailto:)(?!#)[^)]+)\)/g;
	let match;
	while ((match = linkRe.exec(content)) !== null) {
		targets.push(match[2].trim());
	}
	return targets.sort();
}

/**
 * Compute SHA256 hex digest of a string.
 *
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
	return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build a fingerprint object from instruction file content.
 *
 * @param {string} content
 * @returns {{ links: string[], hash: string }}
 */
function fingerprint(content) {
	return {
		links: extractLinkTargets(content),
		hash: sha256(content),
	};
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * @param {string} target — repo root
 * @param {object} [options]
 * @param {boolean} [options.useHash] — if true, also run byte-hash comparison
 * @returns {Array<{code: string, severity: string, claim: null, file: string, line: number|null, message: string, suggestion: string|null}>}
 */
function checkToolConfigSync(target, options) {
	options = options || { useHash: false };
	const issues = [];

	// Collect present files and their fingerprints
	const present = [];
	for (let i = 0; i < INSTRUCTION_FILES.length; i++) {
		const rel = INSTRUCTION_FILES[i];
		const absPath = path.join(target, rel);
		if (!fs.existsSync(absPath)) continue;

		let content;
		try {
			content = fs.readFileSync(absPath, 'utf8');
		} catch (_) {
			continue;
		}

		present.push({
			file: rel,
			content: content,
			fp: fingerprint(content),
		});
	}

	// Nothing to compare with fewer than 2 files
	if (present.length < 2) return issues;

	// 1. Link-based: compare internal doc references
	const reference = present[0];
	const refLinkSet = new Set(reference.fp.links);

	for (let i = 1; i < present.length; i++) {
		const other = present[i];
		const otherLinkSet = new Set(other.fp.links);

		// Links in reference but missing in other
		const missingInOther = [];
		for (const link of refLinkSet) {
			if (!otherLinkSet.has(link)) {
				missingInOther.push(link);
			}
		}

		// Links in other but missing in reference
		const missingInRef = [];
		for (const link of otherLinkSet) {
			if (!refLinkSet.has(link)) {
				missingInRef.push(link);
			}
		}

		const driftCount = missingInOther.length + missingInRef.length;
		if (driftCount > 0) {
			const detailParts = [];
			if (missingInOther.length > 0) {
				detailParts.push(missingInOther.length + ' link(s) present in ' + reference.file + ' but missing from ' + other.file);
			}
			if (missingInRef.length > 0) {
				detailParts.push(missingInRef.length + ' link(s) present in ' + other.file + ' but missing from ' + reference.file);
			}

			issues.push({
				code: 'tool_config_drift',
				severity: 'warning',
				claim: null,
				file: other.file,
				line: null,
				message: 'Doc references have drifted between ' + reference.file + ' and ' + other.file + ': ' + detailParts.join('; '),
				suggestion: 'Review both files and align their referenced documentation.',
			});
		}
	}

	// 2. Content hash: compare byte-level identity
	if (options.useHash) {
		const hashPairs = [];
		for (let i = 0; i < present.length; i++) {
			hashPairs.push(present[i]);
		}

		const hashRef = hashPairs[0];
		for (let i = 1; i < hashPairs.length; i++) {
			const other = hashPairs[i];
			if (hashRef.fp.hash !== other.fp.hash) {
				issues.push({
					code: 'tool_config_drift',
					severity: 'warning',
					claim: null,
					file: other.file,
					line: null,
					message: 'Byte-level content has drifted between ' + hashRef.file + ' and ' + other.file + ' — SHA256 differs.',
					suggestion: 'If these files are meant to be identical copies, re-sync from the shared source.',
				});
			}
		}
	}

	return issues;
}

module.exports = { checkToolConfigSync };
