#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestFiles = [
	{ path: '.cli/manifest.json', enforceSourceExists: true },
	{ path: 'engine-assets/manifest.json', enforceSourceExists: false },
];

const REQUIRED_G05_CONTROLS = {
	early: ['safetyTokenParity', 'hookEnforcement', 'telemetrySchemaValidation'],
	final: ['evidencePredicates', 'finalGateWaiverPrecedence', 'trustedEvidenceBindingRetention'],
};

let hasFailures = false;

function fail(msg) {
	console.error(`manifest invalid: ${msg}`);
	hasFailures = true;
}

function isSafeRelPath(p) {
	if (typeof p !== 'string' || !p.trim()) return false;
	if (path.isAbsolute(p)) return false;
	const norm = p.replace(/\\/g, '/');
	if (norm.startsWith('../') || norm.includes('/../')) return false;
	return true;
}

function readManifest(manifestRelPath) {
	const manifestAbsPath = path.join(root, manifestRelPath);
	let raw;
	try {
		raw = fs.readFileSync(manifestAbsPath, 'utf8');
	} catch (e) {
		fail(`${manifestRelPath}: read failed: ${String(e && e.message ? e.message : e)}`);
		return null;
	}

	try {
		return JSON.parse(raw);
	} catch (e) {
		fail(`${manifestRelPath}: JSON parse failed: ${String(e && e.message ? e.message : e)}`);
		return null;
	}
}

function validateGovernance(manifest, manifestRelPath) {
	const governance = manifest.governance;
	if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
		fail(`${manifestRelPath}: missing governance object`);
		return;
	}

	const g05 = governance.g05;
	if (!g05 || typeof g05 !== 'object' || Array.isArray(g05)) {
		fail(`${manifestRelPath}: missing governance.g05 object`);
		return;
	}

	if (typeof g05.schemaVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(g05.schemaVersion)) {
		fail(`${manifestRelPath}: governance.g05.schemaVersion must be semantic version x.y.z`);
	}

	const requiredControls = g05.requiredControls;
	if (!requiredControls || typeof requiredControls !== 'object' || Array.isArray(requiredControls)) {
		fail(`${manifestRelPath}: governance.g05.requiredControls must be an object`);
		return;
	}

	function validateControlStage(stageName) {
		const controls = requiredControls[stageName];
		if (!Array.isArray(controls)) {
			fail(`${manifestRelPath}: governance.g05.requiredControls.${stageName} must be an array`);
			return new Map();
		}

		const byId = new Map();
		for (let i = 0; i < controls.length; i++) {
			const control = controls[i];
			if (!control || typeof control !== 'object' || Array.isArray(control)) {
				fail(`${manifestRelPath}: governance.g05.requiredControls.${stageName}[${i}] must be an object`);
				continue;
			}

			const id = control.id;
			const owner = control.owner;

			if (typeof id !== 'string' || !id.trim()) {
				fail(`${manifestRelPath}: governance.g05.requiredControls.${stageName}[${i}] missing non-empty id`);
				continue;
			}
			if (typeof owner !== 'string' || !owner.trim()) {
				fail(`${manifestRelPath}: governance.g05.requiredControls.${stageName}[${i}] missing non-empty owner`);
				continue;
			}

			if (byId.has(id)) {
				fail(`${manifestRelPath}: duplicate governance.g05 required control id in ${stageName}: ${id}`);
				continue;
			}

			byId.set(id, owner);
		}

		return byId;
	}

	const earlyControls = validateControlStage('early');
	const finalControls = validateControlStage('final');

	for (const id of REQUIRED_G05_CONTROLS.early) {
		if (!earlyControls.has(id)) {
			fail(`${manifestRelPath}: missing governance.g05 early control '${id}'`);
		}
	}

	for (const id of REQUIRED_G05_CONTROLS.final) {
		if (!finalControls.has(id)) {
			fail(`${manifestRelPath}: missing governance.g05 final control '${id}'`);
		}
	}
}

function validateAssets(manifest, manifestRelPath, enforceSourceExists) {
	if (!Array.isArray(manifest.assets)) {
		fail(`${manifestRelPath}: missing assets[]`);
		return 0;
	}

	const seenIds = new Set();
	let checked = 0;

	for (const asset of manifest.assets) {
		checked++;
		if (!asset || typeof asset !== 'object') {
			fail(`${manifestRelPath}: assets[${checked - 1}] is not an object`);
			continue;
		}
		const { id, type, source, destination } = asset;
		if (typeof id !== 'string' || !id) {
			fail(`${manifestRelPath}: assets[${checked - 1}] missing string id`);
			continue;
		}
		if (seenIds.has(id)) {
			fail(`${manifestRelPath}: duplicate asset id: ${id}`);
			continue;
		}
		seenIds.add(id);

		if (typeof type !== 'string' || !type) {
			fail(`${manifestRelPath}: asset ${id} missing string type`);
			continue;
		}
		if (typeof source !== 'string' || !source) {
			fail(`${manifestRelPath}: asset ${id} missing string source`);
			continue;
		}
		if (typeof destination !== 'string' || !destination) {
			fail(`${manifestRelPath}: asset ${id} missing string destination`);
			continue;
		}
		if (!isSafeRelPath(source)) {
			fail(`${manifestRelPath}: asset ${id} has unsafe source path: ${source}`);
			continue;
		}
		if (!isSafeRelPath(destination)) {
			fail(`${manifestRelPath}: asset ${id} has unsafe destination path: ${destination}`);
			continue;
		}

		if (enforceSourceExists) {
			const sourceAbs = path.join(root, source);
			if (!fs.existsSync(sourceAbs)) {
				fail(`${manifestRelPath}: asset ${id} source missing: ${source}`);
				continue;
			}
		}
	}

	return checked;
}

const checkedByManifest = [];
for (const target of manifestFiles) {
	const manifestRelPath = target.path;
	const manifest = readManifest(manifestRelPath);
	if (!manifest) continue;

	if (!manifest || typeof manifest !== 'object') {
		fail(`${manifestRelPath}: top-level manifest must be an object`);
		continue;
	}

	validateGovernance(manifest, manifestRelPath);
	const checked = validateAssets(manifest, manifestRelPath, target.enforceSourceExists);
	checkedByManifest.push(`${manifestRelPath}=${checked}`);
}

if (hasFailures) {
	process.exit(1);
}

console.log(`manifest ok (${checkedByManifest.join(', ')})`);
