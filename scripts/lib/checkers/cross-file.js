'use strict';

/**
 * checkers/cross-file.js — Detect contradictions across scaffold files.
 *
 * Checks:
 *   1. Same dependency with different versions in different files.
 *   2. Same npm script referenced with different package managers across files.
 *
 * Exports:
 *   checkCrossFile(allClaims) — Returns DriftIssue[] for detected conflicts.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Group version claims by normalized package name.
 *
 * A "version claim" is a dependency claim whose value includes a version suffix
 * (e.g. "react@18.2.0", "@scope/pkg@^2.0"). Claims without versions are skipped.
 *
 * @param {Array} claims
 * @returns {Map<string, Array>}
 */
function groupVersionClaims(claims) {
	const map = new Map();

	for (let i = 0; i < claims.length; i++) {
		const claim = claims[i];
		if (claim.type !== 'dependency' || claim.negated) continue;

		const value = claim.value;
		let depName, version;

		// Scoped package: @scope/name@version
		if (value.startsWith('@')) {
			const atIdx = value.indexOf('@', 1);
			if (atIdx === -1) continue; // No version suffix
			depName = value.slice(0, atIdx);
			version = value.slice(atIdx + 1);
		} else {
			const atIdx = value.indexOf('@');
			if (atIdx === -1) continue; // No version suffix
			depName = value.slice(0, atIdx);
			version = value.slice(atIdx + 1);
		}

		if (!depName || !version) continue;

		const key = depName.toLowerCase();
		if (!map.has(key)) map.set(key, []);
		map.get(key).push({ claim: claim, depName: depName, version: version });
	}

	return map;
}

/**
 * Group command claims by the script they reference (stripping the package manager prefix).
 *
 * @param {Array} claims
 * @returns {Map<string, Array>}
 */
function groupCommandClaims(claims) {
	const map = new Map();

	for (let i = 0; i < claims.length; i++) {
		const claim = claims[i];
		if (claim.type !== 'command' || claim.negated) continue;

		const value = claim.value;
		// Match npm run/yarn/pnpm/bun — all support optional `run` subcommand
		const cmdMatch = value.match(/^(?:npm\s+run|yarn(?:\s+run)?|pnpm(?:\s+run)?|bun(?:\s+run)?)\s+(\S+)/);
		if (!cmdMatch) continue;

		// Normalize the script name: strip extra args and flags
		const scriptRaw = cmdMatch[1];
		// Skip flag-looking tokens (e.g., --watch, --silent)
		if (/^--/.test(scriptRaw)) continue;
		const scriptName = scriptRaw;
		if (!scriptName) continue;

		const packageManager = value.split(/\s+/)[0];

		const key = scriptName.toLowerCase();
		if (!map.has(key)) map.set(key, []);
		map.get(key).push({ claim: claim, packageManager: packageManager });
	}

	return map;
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * @param {Array} allClaims — all extracted claims from scaffold files
 * @returns {Array<{code: string, severity: string, claim: object|null, file: string, line: number, message: string, suggestion: string|null}>}
 */
function checkCrossFile(allClaims) {
	const issues = [];

	// 1. Version conflicts
	const byDep = groupVersionClaims(allClaims);
	for (const [depName, entries] of byDep) {
		if (entries.length < 2) continue;

		// Gather unique version strings
		const uniqueVersions = new Set();
		const uniqueFiles = new Set();
		for (let i = 0; i < entries.length; i++) {
			uniqueVersions.add(entries[i].version);
			if (entries[i].claim.source && entries[i].claim.source.file) {
				uniqueFiles.add(entries[i].claim.source.file);
			}
		}

		// Only flag if versions differ AND come from different files
		if (uniqueVersions.size > 1 && uniqueFiles.size > 1) {
			const detailLines = [];
			for (let i = 0; i < entries.length; i++) {
				const e = entries[i];
				const src = e.claim.source || {};
				detailLines.push(src.file + ':' + src.line + ' says "' + e.claim.value + '"');
			}

			issues.push({
				code: 'cross_file_conflict',
				severity: 'error',
				claim: entries[0].claim,
				file: entries[0].claim.source ? entries[0].claim.source.file : null,
				line: entries[0].claim.source ? entries[0].claim.source.line : null,
				message: 'Conflicting versions for "' + depName + '": ' + detailLines.join(', '),
				suggestion: 'Align the version across all scaffold files.',
			});
		}
	}

	// 2. Package manager conflicts
	const byScript = groupCommandClaims(allClaims);
	for (const [scriptName, entries] of byScript) {
		if (entries.length < 2) continue;

		const managers = new Set();
		const files = new Set();
		for (let i = 0; i < entries.length; i++) {
			managers.add(entries[i].packageManager);
			if (entries[i].claim.source && entries[i].claim.source.file) {
				files.add(entries[i].claim.source.file);
			}
		}

		if (managers.size > 1 && files.size > 1) {
			const detailLines = [];
			for (let i = 0; i < entries.length; i++) {
				const e = entries[i];
				const src = e.claim.source || {};
				detailLines.push(src.file + ':' + src.line + ' uses ' + e.packageManager);
			}

			issues.push({
				code: 'cross_file_conflict',
				severity: 'warning',
				claim: entries[0].claim,
				file: entries[0].claim.source ? entries[0].claim.source.file : null,
				line: entries[0].claim.source ? entries[0].claim.source.line : null,
				message: 'Script "' + scriptName + '" referenced with different package managers: ' + detailLines.join(', '),
				suggestion: 'Pick one package manager and update all references.',
			});
		}
	}

	return issues;
}

module.exports = { checkCrossFile };
