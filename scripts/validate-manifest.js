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

const REQUIRED_ASSETS = [
	{ id: 'copilot-instructions', type: 'instructions' },
	{ id: 'skill-core-guardrails', type: 'skill' },
	{ id: 'skill-discovery', type: 'skill' },
];

const VALID_LOAD_MODES = ['always', 'on-demand'];
const VALID_BUNDLE_INSTALL_TARGETS = ['user-global', 'repo-local'];
const VALID_BUNDLE_ACTIVATION_SCOPES = ['global', 'user', 'repo', 'workspace'];
const VALID_BUNDLE_MATERIALIZATION = ['always', 'on-demand'];

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
		return { checked: 0, assetIds: new Set() };
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

		// Vault-ref must never appear as a source or destination in manifests
		if (source.includes('skills-vault') || destination.includes('skills-vault')) {
			fail(`${manifestRelPath}: asset ${id} must not reference skills-vault path`);
			continue;
		}

		// Validate loadMode if present (skills only)
		if (asset.loadMode !== undefined) {
			if (type !== 'skill') {
				fail(`${manifestRelPath}: asset ${id} has loadMode but type is '${type}' (only skills support loadMode)`);
			} else if (!VALID_LOAD_MODES.includes(asset.loadMode)) {
				fail(`${manifestRelPath}: asset ${id} has invalid loadMode '${asset.loadMode}' (must be: ${VALID_LOAD_MODES.join(', ')})`);
			}
		}

		if (enforceSourceExists) {
			const sourceAbs = path.join(root, source);
			if (!fs.existsSync(sourceAbs)) {
				fail(`${manifestRelPath}: asset ${id} source missing: ${source}`);
				continue;
			}
		}
	}

	return { checked, assetIds: seenIds };
}

function validateBundles(manifest, manifestRelPath, assetIds) {
	if (manifest.bundles === undefined) {
		return;
	}

	if (!Array.isArray(manifest.bundles)) {
		fail(`${manifestRelPath}: bundles must be an array when present`);
		return;
	}

	const seenIds = new Set();
	for (let i = 0; i < manifest.bundles.length; i++) {
		const bundle = manifest.bundles[i];
		if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
			fail(`${manifestRelPath}: bundles[${i}] must be an object`);
			continue;
		}

		const id = typeof bundle.id === 'string' ? bundle.id.trim() : '';
		const title = typeof bundle.title === 'string' ? bundle.title.trim() : '';
		if (!id) {
			fail(`${manifestRelPath}: bundles[${i}] missing non-empty id`);
			continue;
		}
		if (seenIds.has(id)) {
			fail(`${manifestRelPath}: duplicate bundle id: ${id}`);
			continue;
		}
		seenIds.add(id);

		if (!title) {
			fail(`${manifestRelPath}: bundle ${id} missing non-empty title`);
		}

		if (!Array.isArray(bundle.assetIds) || bundle.assetIds.length === 0) {
			fail(`${manifestRelPath}: bundle ${id} must declare a non-empty assetIds array`);
		} else {
			for (let assetIndex = 0; assetIndex < bundle.assetIds.length; assetIndex++) {
				const assetId = typeof bundle.assetIds[assetIndex] === 'string'
					? bundle.assetIds[assetIndex].trim()
					: '';
				if (!assetId) {
					fail(`${manifestRelPath}: bundle ${id} has empty assetIds[${assetIndex}]`);
					continue;
				}
				if (!assetIds.has(assetId)) {
					fail(`${manifestRelPath}: bundle ${id} references unknown assetId '${assetId}'`);
				}
			}
		}

		if (
			bundle.installTarget !== undefined
			&& !VALID_BUNDLE_INSTALL_TARGETS.includes(bundle.installTarget)
		) {
			fail(
				`${manifestRelPath}: bundle ${id} has invalid installTarget '${bundle.installTarget}' (must be: ${VALID_BUNDLE_INSTALL_TARGETS.join(', ')})`,
			);
		}

		if (
			bundle.activationScope !== undefined
			&& !VALID_BUNDLE_ACTIVATION_SCOPES.includes(bundle.activationScope)
		) {
			fail(
				`${manifestRelPath}: bundle ${id} has invalid activationScope '${bundle.activationScope}' (must be: ${VALID_BUNDLE_ACTIVATION_SCOPES.join(', ')})`,
			);
		}

		if (
			bundle.materialization !== undefined
			&& !VALID_BUNDLE_MATERIALIZATION.includes(bundle.materialization)
		) {
			fail(
				`${manifestRelPath}: bundle ${id} has invalid materialization '${bundle.materialization}' (must be: ${VALID_BUNDLE_MATERIALIZATION.join(', ')})`,
			);
		}

		if (bundle.dependsOn !== undefined && !Array.isArray(bundle.dependsOn)) {
			fail(`${manifestRelPath}: bundle ${id} dependsOn must be an array when present`);
		}
	}

	for (const bundle of manifest.bundles) {
		if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
			continue;
		}
		const id = typeof bundle.id === 'string' ? bundle.id.trim() : '';
		if (!id || !Array.isArray(bundle.dependsOn)) {
			continue;
		}
		for (let dependencyIndex = 0; dependencyIndex < bundle.dependsOn.length; dependencyIndex++) {
			const dependencyId = typeof bundle.dependsOn[dependencyIndex] === 'string'
				? bundle.dependsOn[dependencyIndex].trim()
				: '';
			if (!dependencyId) {
				fail(`${manifestRelPath}: bundle ${id} has empty dependsOn[${dependencyIndex}]`);
				continue;
			}
			if (!seenIds.has(dependencyId)) {
				fail(`${manifestRelPath}: bundle ${id} dependsOn unknown bundle '${dependencyId}'`);
			}
		}
	}
}

function validateRequiredAssets(manifest, manifestRelPath) {
	if (!Array.isArray(manifest.assets)) return;

	for (const required of REQUIRED_ASSETS) {
		const match = manifest.assets.find((asset) => asset && asset.id === required.id);
		if (!match) {
			fail(`${manifestRelPath}: missing required asset id '${required.id}'`);
			continue;
		}

		if (required.type && match.type !== required.type) {
			fail(`${manifestRelPath}: required asset '${required.id}' must have type '${required.type}'`);
		}
	}
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
	const { checked, assetIds } = validateAssets(manifest, manifestRelPath, target.enforceSourceExists);
	validateBundles(manifest, manifestRelPath, assetIds);
	validateRequiredAssets(manifest, manifestRelPath);
	checkedByManifest.push(`${manifestRelPath}=${checked}`);
}

if (hasFailures) {
	process.exit(1);
}

console.log(`manifest ok (${checkedByManifest.join(', ')})`);
