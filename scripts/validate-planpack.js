#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || path.join(process.cwd(), 'plan.md');

if (!fs.existsSync(filePath)) {
	console.error(`planpack invalid:\n  file not found: ${filePath}`);
	process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

// Stop parsing at progress tracker heading
const stopMarker = '# Plan-Pack Progress Tracker';
const stopIdx = content.indexOf(stopMarker);
const body = stopIdx !== -1 ? content.slice(0, stopIdx) : content;

// Version marker check
const versionRe = /<!--\s*IE_PLAN_PACK_VERSION:\s*(\d+)\s*-->/;
const versionMatch = body.match(versionRe);
if (!versionMatch) {
	console.log('planpack warning: no version marker found (v0 best-effort, skipping validation)');
	process.exit(0);
}

const lines = body.split(/\r?\n/);
const errors = [];

// --- 1. Required H2 headings ---
const requiredH2 = [
	'Goal + Success Criteria',
	'Context Loaded',
	'Assumptions + Constraints',
	'Decisions',
	'Dropped / Deferred',
	'Work Unit Groups',
	'Work Unit Graph',
	'Work Unit Index',
	'Work Unit Specs',
	'Execution Notes',
	'Risks / Rollback',
	'Validation',
];

const h2Re = /^##\s+(.+)/;
const foundH2 = [];
for (const line of lines) {
	const m = line.match(h2Re);
	if (m) foundH2.push(m[1].trim());
}

for (const req of requiredH2) {
	if (!foundH2.some(h => h === req || h.startsWith(req + ' '))) {
		errors.push(`missing required heading: ## ${req}`);
	}
}

// --- 2. Parse WU specs ---
const wuSpecRe = /^###\s+(WU-\d{3})\s+—\s+/;
const h4Re = /^####\s+(.+)/;
const requiredWuSubs = ['Context', 'Acceptance Criteria', 'Plan / Approach', 'Validation'];

const specWUs = [];
const seenWuIds = new Set();
let currentWU = null;
const wuSubs = new Map(); // wuId -> Set of h4 titles

for (const line of lines) {
	const wuMatch = line.match(wuSpecRe);
	if (wuMatch) {
		currentWU = wuMatch[1];
		specWUs.push(currentWU);

		// Duplicate check
		if (seenWuIds.has(currentWU)) {
			errors.push(`duplicate WU-ID in specs: ${currentWU}`);
		}
		seenWuIds.add(currentWU);
		wuSubs.set(currentWU, new Set());
		continue;
	}

	// Reset current WU on next H2 or H3 that isn't a WU spec
	if (/^##\s+/.test(line) || (/^###\s+/.test(line) && !wuSpecRe.test(line))) {
		currentWU = null;
		continue;
	}

	if (currentWU) {
		const h4Match = line.match(h4Re);
		if (h4Match) {
			wuSubs.get(currentWU).add(h4Match[1].trim());
		}
	}
}

// --- 3. WU-ID format check ---
const wuIdFormatRe = /^WU-\d{3}$/;
for (const id of specWUs) {
	if (!wuIdFormatRe.test(id)) {
		errors.push(`invalid WU-ID format: ${id} (expected WU-NNN)`);
	}
}

// --- 4. Required WU subsections ---
for (const [wuId, subs] of wuSubs) {
	for (const req of requiredWuSubs) {
		if (!subs.has(req)) {
			errors.push(`${wuId} missing required subsection: #### ${req}`);
		}
	}
}

// --- 5. Parse Work Unit Graph table for group IDs and WU IDs ---
const graphWUs = [];
const groupIds = new Set();
let inGraphSection = false;
let graphTableStarted = false;

for (const line of lines) {
	if (/^##\s+Work Unit Graph/.test(line)) {
		inGraphSection = true;
		graphTableStarted = false;
		continue;
	}
	if (inGraphSection && /^##\s+/.test(line)) {
		inGraphSection = false;
		continue;
	}
	if (!inGraphSection) continue;

	// Skip header row and separator
	if (/^\|\s*Group\s*\|/.test(line)) { graphTableStarted = true; continue; }
	if (/^\|\s*-+/.test(line)) continue;
	if (!graphTableStarted) continue;

	const cells = line.split('|').map(c => c.trim()).filter(Boolean);
	if (cells.length < 2) continue;

	const groupId = cells[0];
	const wuId = cells[1];

	groupIds.add(groupId);

	if (wuIdFormatRe.test(wuId)) {
		graphWUs.push(wuId);
	}
}

// --- 6. Group-ID format check ---
const groupIdFormatRe = /^G-\d{2}-[a-z0-9-]+$/;
for (const gid of groupIds) {
	if (!groupIdFormatRe.test(gid)) {
		errors.push(`invalid Group-ID format: ${gid} (expected G-NN-slug)`);
	}
}

// --- 7. No orphan WUs ---
const graphWUSet = new Set(graphWUs);
for (const wuId of specWUs) {
	if (!graphWUSet.has(wuId)) {
		errors.push(`orphan WU spec (not in graph): ${wuId}`);
	}
}
for (const wuId of graphWUs) {
	if (!seenWuIds.has(wuId)) {
		errors.push(`orphan WU in graph (no spec heading): ${wuId}`);
	}
}

// --- Result ---
if (errors.length > 0) {
	console.error(`planpack invalid:\n${errors.map(e => '  ' + e).join('\n')}`);
	process.exit(1);
}

console.log(`planpack ok (${specWUs.length} work units)`);
