'use strict';

/**
 * checkers/todo-fixme.js — Scan scaffold markdown for unresolved TODO/FIXME markers.
 *
 * Exports:
 *   checkTodoFixme(scaffoldFiles, target) — Returns DriftIssue[] for each marker found.
 */

const fs = require('fs');
const path = require('path');

/** Pattern matching TODO or FIXME (case-sensitive, whole-word). */
const MARKER_RE = /\b(TODO|FIXME)\b/g;

/**
 * @param {string[]} scaffoldFiles — relative POSIX paths
 * @param {string} target — repo root
 * @returns {Array<{code: string, severity: string, claim: null, file: string, line: number, message: string, suggestion: string | null}>}
 */
function checkTodoFixme(scaffoldFiles, target) {
	const issues = [];

	for (let i = 0; i < scaffoldFiles.length; i++) {
		const file = scaffoldFiles[i];
		const absPath = path.join(target, file);

		let content;
		try {
			content = fs.readFileSync(absPath, 'utf8');
		} catch (_) {
			continue;
		}

		const lines = content.split(/\r?\n/);

		// Skip lines inside fenced code blocks, HTML comments, and inline code spans
		const excluded = new Array(lines.length).fill(false);
		let inFence = false;
		let inComment = false;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			const line = lines[lineIdx];

			// Fenced code block tracking
			if (/^```/.test(line)) {
				excluded[lineIdx] = true;
				inFence = !inFence;
				continue;
			}
			if (inFence) {
				excluded[lineIdx] = true;
				continue;
			}

			// HTML comment tracking
			const ci = line.indexOf('<!--');
			const ce = line.indexOf('-->');

			if (inComment) {
				excluded[lineIdx] = true;
				if (ce !== -1 && (ci === -1 || ce < ci)) {
					inComment = false;
				}
				continue;
			}

			if (ci !== -1) {
				excluded[lineIdx] = true;
				if (ce === -1 || ce < ci) {
					inComment = true;
				}
			}
		}

		// Scan for markers on non-excluded lines
		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			if (excluded[lineIdx]) {
				continue;
			}

			const line = lines[lineIdx];

			// Build a set of character positions that fall inside inline code spans
			const inlineCodeExcluded = new Set();
			const tickRe = /`/g;
			let tickMatch;
			const tickPositions = [];
			while ((tickMatch = tickRe.exec(line)) !== null) {
				tickPositions.push(tickMatch.index);
			}
			// Pair up ticks: even indices are opening, odd indices are closing
			for (let t = 0; t + 1 < tickPositions.length; t += 2) {
				for (let pos = tickPositions[t]; pos <= tickPositions[t + 1]; pos++) {
					inlineCodeExcluded.add(pos);
				}
			}

			MARKER_RE.lastIndex = 0;
			let match;

			while ((match = MARKER_RE.exec(line)) !== null) {
				// Skip if the match falls inside an inline code span
				if (inlineCodeExcluded.has(match.index)) {
					continue;
				}

				const marker = match[1];
				issues.push({
					code: 'todo_fixme_marker',
					severity: 'warning',
					claim: null,
					file: file,
					line: lineIdx + 1,
					message: 'Unresolved ' + marker + ' marker in scaffold file.',
					suggestion: 'Resolve the ' + marker + ' or convert it to a tracked issue.',
				});
			}
		}
	}

	return issues;
}

module.exports = { checkTodoFixme };
