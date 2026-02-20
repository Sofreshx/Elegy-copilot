#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '.cli', 'manifest.json');

function fail(msg) {
	console.error(`manifest invalid: ${msg}`);
	process.exitCode = 1;
}

function isSafeRelPath(p) {
	if (typeof p !== 'string' || !p.trim()) return false;
	if (path.isAbsolute(p)) return false;
	const norm = p.replace(/\\/g, '/');
	if (norm.startsWith('../') || norm.includes('/../')) return false;
	return true;
}

const raw = fs.readFileSync(manifestPath, 'utf8');
let manifest;
try {
	manifest = JSON.parse(raw);
} catch (e) {
	fail(`JSON parse failed: ${String(e && e.message ? e.message : e)}`);
	process.exit(1);
}

if (!manifest || typeof manifest !== 'object') {
	fail('Top-level manifest must be an object');
	process.exit(1);
}

if (!Array.isArray(manifest.assets)) {
	fail('Manifest missing assets[]');
	process.exit(1);
}

const seenIds = new Set();
let checked = 0;

for (const asset of manifest.assets) {
	checked++;
	if (!asset || typeof asset !== 'object') {
		fail(`assets[${checked - 1}] is not an object`);
		continue;
	}
	const { id, type, source, destination } = asset;
	if (typeof id !== 'string' || !id) {
		fail(`assets[${checked - 1}] missing string id`);
		continue;
	}
	if (seenIds.has(id)) {
		fail(`Duplicate asset id: ${id}`);
		continue;
	}
	seenIds.add(id);

	if (typeof type !== 'string' || !type) {
		fail(`Asset ${id} missing string type`);
		continue;
	}
	if (typeof source !== 'string' || !source) {
		fail(`Asset ${id} missing string source`);
		continue;
	}
	if (typeof destination !== 'string' || !destination) {
		fail(`Asset ${id} missing string destination`);
		continue;
	}
	if (!isSafeRelPath(source)) {
		fail(`Asset ${id} has unsafe source path: ${source}`);
		continue;
	}
	if (!isSafeRelPath(destination)) {
		fail(`Asset ${id} has unsafe destination path: ${destination}`);
		continue;
	}

	const sourceAbs = path.join(root, source);
	if (!fs.existsSync(sourceAbs)) {
		fail(`Asset ${id} source missing: ${source}`);
		continue;
	}
}

if (process.exitCode && process.exitCode !== 0) {
	process.exit(process.exitCode);
}

console.log(`manifest ok (${checked} assets)`);
