#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolvePermissionLocations } = require('../copilot-ui/lib/permissionLocationsResolver');

function parseArgs(argv) {
	const args = {
		settings: null,
		copilotHome: null,
		vscodeHome: null,
		dryRun: false
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--dry-run') {
			args.dryRun = true;
			continue;
		}
		if (a === '--settings') {
			args.settings = argv[++i] ?? null;
			if (!args.settings) throw new Error('Missing value for --settings');
			continue;
		}
		if (a.startsWith('--settings=')) {
			args.settings = a.slice('--settings='.length);
			if (!args.settings) throw new Error('Missing value for --settings');
			continue;
		}
		if (a === '--copilot-home') {
			args.copilotHome = argv[++i] ?? null;
			if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
			continue;
		}
		if (a.startsWith('--copilot-home=')) {
			args.copilotHome = a.slice('--copilot-home='.length);
			if (!args.copilotHome) throw new Error('Missing value for --copilot-home');
			continue;
		}
		if (a === '--vscode-home') {
			args.vscodeHome = argv[++i] ?? null;
			if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
			continue;
		}
		if (a.startsWith('--vscode-home=')) {
			args.vscodeHome = a.slice('--vscode-home='.length);
			if (!args.vscodeHome) throw new Error('Missing value for --vscode-home');
			continue;
		}
		throw new Error(
			`Unknown arg: ${a} (supported: --dry-run, --settings <path>, --vscode-home <path>, --copilot-home <path> (legacy))`
		);
	}

	return args;
}

function stripJsonComments(text) {
	let out = '';
	let i = 0;
	let inString = false;
	let stringQuote = '"';
	let inLineComment = false;
	let inBlockComment = false;
	let escaped = false;

	while (i < text.length) {
		const ch = text[i];
		const next = i + 1 < text.length ? text[i + 1] : '';

		if (inLineComment) {
			if (ch === '\n') {
				inLineComment = false;
				out += ch;
			}
			i++;
			continue;
		}
		if (inBlockComment) {
			if (ch === '*' && next === '/') {
				inBlockComment = false;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (inString) {
			out += ch;
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === stringQuote) {
				inString = false;
			}
			i++;
			continue;
		}

		if ((ch === '"' || ch === "'") && !inString) {
			inString = true;
			stringQuote = ch;
			out += ch;
			i++;
			continue;
		}

		if (ch === '/' && next === '/') {
			inLineComment = true;
			i += 2;
			continue;
		}
		if (ch === '/' && next === '*') {
			inBlockComment = true;
			i += 2;
			continue;
		}

		out += ch;
		i++;
	}

	return out;
}

function removeTrailingCommas(text) {
	let prev;
	let cur = text;
	do {
		prev = cur;
		cur = cur.replace(/,\s*([}\]])/g, '$1');
	} while (cur !== prev);
	return cur;
}

function readJsonc(filePath) {
	const raw = fs.readFileSync(filePath, 'utf8');
	const noComments = stripJsonComments(raw);
	const noTrailing = removeTrailingCommas(noComments);
	const parsed = JSON.parse(noTrailing);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('settings.json root must be an object');
	}
	return parsed;
}

function toLocationsObject(value) {
	// VS Code (1.109+) expects location settings in the form:
	// { "path-or-folder": true, "other": false }
	// This helper upgrades older formats (string/array) to the object form.
	// Additionally, VS Code requires keys to be relative or start with '~/' and use '/' separators.
	// We normalize keys accordingly.
	if (value == null) {
		return { locations: {}, changed: false };
	}

	const normalizeKey = (k) => normalizeSettingsLocationKey(k);

	if (Array.isArray(value)) {
		const out = {};
		let changed = false;
		for (const item of value) {
			if (typeof item === 'string' && item.trim()) {
				const nk = normalizeKey(item);
				if (nk) {
					out[nk] = true;
					changed = true;
				}
				continue;
			}
			if (item && typeof item === 'object' && !Array.isArray(item)) {
				for (const [k, v] of Object.entries(item)) {
					if (typeof k === 'string' && k.trim()) {
						const nk = normalizeKey(k);
						if (nk) {
							out[nk] = v === false ? false : true;
							changed = true;
						}
					}
				}
			}
		}
		return { locations: out, changed };
	}

	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (!trimmed) {
			return { locations: {}, changed: true };
		}
		const nk = normalizeKey(trimmed);
		return { locations: nk ? { [nk]: true } : {}, changed: true };
	}

	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const out = {};
		let changed = false;
		for (const [k, v] of Object.entries(value)) {
			if (typeof k !== 'string' || !k.trim()) {
				changed = true;
				continue;
			}
			const nk = normalizeKey(k);
			if (!nk) {
				// Drop unsupported absolute paths (VS Code requires relative or '~/' keys)
				changed = true;
				continue;
			}
			if (nk !== k) {
				changed = true;
			}
			out[nk] = v === false ? false : true;
		}
		return { locations: out, changed };
	}

	// Unknown type - reset to object.
	return { locations: {}, changed: true };
}

function ensureLocationEnabled(obj, key, location) {
	const { locations, changed: upgraded } = toLocationsObject(obj[key]);
	let changed = upgraded;

	const normalized = normalizeSettingsLocationKey(location);
	if (!normalized) {
		// VS Code does not accept absolute paths outside ~/, so do not add invalid entries.
		return changed;
	}

	if (typeof locations[normalized] !== 'boolean' || locations[normalized] !== true) {
		locations[normalized] = true;
		changed = true;
	}

	if (changed) {
		obj[key] = locations;
	}

	return changed;
}

function normalizeSettingsLocationKey(input) {
	if (typeof input !== 'string') return null;
	const raw = input.trim();
	if (!raw) return null;

	// Already relative or tilde-rooted (VS Code schema requirement)
	if (raw.startsWith('~/')) {
		return raw.replace(/\\/g, '/');
	}
	if (!path.isAbsolute(raw)) {
		// Relative key: only normalize slashes.
		return raw.replace(/\\/g, '/');
	}

	// Absolute: only allowed if it can be expressed under the user's home as ~/
	const home = path.resolve(os.homedir());
	const abs = path.resolve(raw);

	const isWin = process.platform === 'win32';
	const homeCmp = isWin ? home.toLowerCase() : home;
	const absCmp = isWin ? abs.toLowerCase() : abs;

	if (absCmp === homeCmp) {
		return '~/';
	}

	const homePrefix = homeCmp.endsWith(path.sep) ? homeCmp : homeCmp + path.sep;
	if (!absCmp.startsWith(homePrefix)) {
		return null;
	}

	const rel = path.relative(home, abs);
	const relPosix = rel.split(path.sep).join('/');
	return `~/${relPosix}`;
}

function writeJson(filePath, obj, { dryRun }) {
	const json = JSON.stringify(obj, null, 2) + '\n';
	if (dryRun) {
		console.log(`[DRY-RUN] Would write ${filePath}`);
		return;
	}
	fs.writeFileSync(filePath, json, 'utf8');
}

function readJsonSafe(filePath) {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function ensureToolApprovalEntry(toolApprovals, entry) {
	if (!Array.isArray(toolApprovals)) return false;
	if (!entry || typeof entry !== 'object') return false;

	const kind = String(entry.kind || '').trim();
	if (!kind) return false;

	const canon = JSON.stringify({ ...entry, kind });
	for (const existing of toolApprovals) {
		if (!existing || typeof existing !== 'object') continue;
		const ek = String(existing.kind || '').trim();
		if (ek !== kind) continue;
		// For our default approvals, kind alone is enough (write/memory have no extra fields).
		if (canon === JSON.stringify({ ...existing, kind: ek })) return false;
		// If same kind and no extra fields, treat as present.
		if (Object.keys(existing).length === 1 && Object.keys(entry).length === 1) return false;
	}

	toolApprovals.push(entry);
	return true;
}

function ensureTerminalAutoApprove(settings) {
	const key = 'chat.tools.terminal.autoApprove';
	const defaults = {
		// Read-only git commands (safe to approve broadly)
		"/^git (status|log|rev-parse|ls-files)( .*)?$/": {
			approve: true,
			matchCommandLine: true
		},

		// Version/info commands
		'git --version': true,
		'node -v': true,
		'node --version': true,
		'npm -v': true,
		'npm --version': true,
		'python --version': true,
		'dotnet --info': true,

		// Common build/test commands (exact match only)
		'npm run compile': true,
		'npm run build': true,
		'npm run test': true,
		'npm run lint': true,
		'npx tsc': true,
		'dotnet build': true,
		'dotnet test': true
	};

	let changed = false;
	if (!settings[key] || typeof settings[key] !== 'object' || Array.isArray(settings[key])) {
		settings[key] = {};
		changed = true;
	}

	const target = settings[key];
	for (const [k, v] of Object.entries(defaults)) {
		if (Object.prototype.hasOwnProperty.call(target, k)) continue;
		target[k] = v;
		changed = true;
	}

	return changed;
}

function patchCopilotPermissionsConfig({ copilotHomeAbs, vscodeHomeAbs, dryRun }) {
	// Copilot tool approvals are stored under ~/.copilot/permissions-config.json.
	// The goal here is to avoid repeated VS Code agent prompts for file access.
	const filePath = path.join(path.resolve(copilotHomeAbs), 'permissions-config.json');

	const existing = readJsonSafe(filePath);
	const root = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
	if (!root.locations || typeof root.locations !== 'object' || Array.isArray(root.locations)) {
		root.locations = {};
	}

	const { locations: desiredLocations } = resolvePermissionLocations({
		baseRoots: [copilotHomeAbs, vscodeHomeAbs],
		includeDefaultSubdirs: true,
		scanExistingSubdirs: true
	});
	let changed = false;

	for (const loc of desiredLocations) {
		if (!root.locations[loc] || typeof root.locations[loc] !== 'object' || Array.isArray(root.locations[loc])) {
			root.locations[loc] = {};
			changed = true;
		}

		const slot = root.locations[loc];
		if (!Array.isArray(slot.tool_approvals)) {
			slot.tool_approvals = [];
			changed = true;
		}

		// Default: allow read/write + memory operations for these trusted roots.
		changed = ensureToolApprovalEntry(slot.tool_approvals, { kind: 'read' }) || changed;
		changed = ensureToolApprovalEntry(slot.tool_approvals, { kind: 'write' }) || changed;
		changed = ensureToolApprovalEntry(slot.tool_approvals, { kind: 'memory' }) || changed;
	}

	if (!changed) {
		console.log(`Copilot permissions: ${filePath} (no changes needed)`);
		return;
	}

	if (fs.existsSync(filePath)) {
		backupFile(filePath, { dryRun });
	}
	writeJson(filePath, root, { dryRun });
	console.log(`Copilot permissions: ${filePath} (patched)`);
}

function backupFile(filePath, { dryRun }) {
	const dir = path.dirname(filePath);
	const base = path.basename(filePath);
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const backup = path.join(dir, `${base}.bak.${stamp}`);
	if (dryRun) {
		console.log(`[DRY-RUN] Would backup ${filePath} -> ${backup}`);
		return backup;
	}
	fs.copyFileSync(filePath, backup);
	return backup;
}

function defaultSettingsPaths() {
	const home = os.homedir();
	const appData = process.env.APPDATA;
	const platform = process.platform;

	function profileSettingsUnder(userDir) {
		try {
			const profilesDir = path.join(userDir, 'profiles');
			if (!fs.existsSync(profilesDir) || !fs.statSync(profilesDir).isDirectory()) return [];
			const entries = fs.readdirSync(profilesDir, { withFileTypes: true });
			return entries
				.filter((e) => e.isDirectory())
				.map((e) => path.join(profilesDir, e.name, 'settings.json'));
		} catch {
			return [];
		}
	}

	if (platform === 'win32' && appData) {
		const codeUser = path.join(appData, 'Code', 'User');
		const insidersUser = path.join(appData, 'Code - Insiders', 'User');
		return [
			path.join(codeUser, 'settings.json'),
			...profileSettingsUnder(codeUser),
			path.join(insidersUser, 'settings.json'),
			...profileSettingsUnder(insidersUser)
		];
	}

	if (platform === 'darwin') {
		const base = path.join(home, 'Library', 'Application Support');
		const codeUser = path.join(base, 'Code', 'User');
		const insidersUser = path.join(base, 'Code - Insiders', 'User');
		return [
			path.join(codeUser, 'settings.json'),
			...profileSettingsUnder(codeUser),
			path.join(insidersUser, 'settings.json'),
			...profileSettingsUnder(insidersUser)
		];
	}

	// linux + everything else
	const base = path.join(home, '.config');
	const codeUser = path.join(base, 'Code', 'User');
	const insidersUser = path.join(base, 'Code - Insiders', 'User');
	return [
		path.join(codeUser, 'settings.json'),
		...profileSettingsUnder(codeUser),
		path.join(insidersUser, 'settings.json'),
		...profileSettingsUnder(insidersUser)
	];
}

function resolveCopilotHome(explicitCopilotHome) {
	if (explicitCopilotHome && explicitCopilotHome.trim()) {
		return path.resolve(explicitCopilotHome);
	}
	if (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()) {
		return path.resolve(process.env.XDG_CONFIG_HOME);
	}
	return path.join(os.homedir(), '.copilot');
}

function defaultVscodeHome() {
	return path.join(os.homedir(), '.copilot');
}

function resolveVscodeHome(explicitVscodeHome) {
	if (explicitVscodeHome && explicitVscodeHome.trim()) {
		return path.resolve(explicitVscodeHome);
	}
	if (process.env.INSTRUCTION_ENGINE_VSCODE_HOME && process.env.INSTRUCTION_ENGINE_VSCODE_HOME.trim()) {
		return path.resolve(process.env.INSTRUCTION_ENGINE_VSCODE_HOME);
	}
	return defaultVscodeHome();
}

function resolveAssetsHome(args) {
	// Assets always live under ~/.copilot (unified source for CLI and VS Code).
	// Explicit --vscode-home or --copilot-home args override the default.
	if (args.vscodeHome && args.vscodeHome.trim()) {
		return resolveVscodeHome(args.vscodeHome);
	}
	if (args.copilotHome && args.copilotHome.trim()) {
		return resolveCopilotHome(args.copilotHome);
	}
	return resolveVscodeHome(null);
}

// Keys that represent the old Documents/instruction-engine location (any variant).
function isStaleLocationKey(k) {
	const norm = k.replace(/\\/g, '/').toLowerCase();
	return norm.includes('documents/instruction-engine')
		|| norm.includes('.local/state/instruction-engine')
		|| (norm.includes('/instruction-engine/.tmp/') && norm.includes('/.copilot'))
		|| (norm.includes('/ie-api-contract-') && norm.includes('/.copilot'));
}

function removeStaleLocations(settings) {
	const keys = [
		'chat.agentFilesLocations',
		'chat.agentSkillsLocations',
		'chat.promptFilesLocations',
		'chat.instructionsFilesLocations'
	];
	let changed = false;
	for (const key of keys) {
		const val = settings[key];
		if (!val || typeof val !== 'object' || Array.isArray(val)) continue;
		for (const k of Object.keys(val)) {
			if (isStaleLocationKey(k)) {
				delete val[k];
				changed = true;
				console.log(`  (removed stale location: ${k})`);
			}
		}
	}
	return changed;
}

function removeVaultFromSkillLocations(settings) {
	const key = 'chat.agentSkillsLocations';
	const val = settings[key];
	if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
	let changed = false;
	for (const k of Object.keys(val)) {
		if (k.includes('skills-vault') || k.includes('skills_vault')) {
			delete val[k];
			changed = true;
			console.log(`  (removed vault path from skill locations: ${k})`);
		}
	}
	return changed;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const assetsHome = resolveAssetsHome(args);
	const copilotHome = resolveCopilotHome(args.copilotHome);

	const desired = {
		agents: path.join(assetsHome, 'agents'),
		skills: path.join(assetsHome, 'skills'),
		prompts: path.join(assetsHome, 'prompts'),
		instructions: assetsHome
	};

	const targets = args.settings ? [path.resolve(args.settings)] : defaultSettingsPaths();
	const existing = targets.filter((p) => {
		try {
			return fs.existsSync(p) && fs.statSync(p).isFile();
		} catch {
			return false;
		}
	});

	if (!existing.length) {
		console.log('No VS Code settings.json found to patch.');
		console.log('Pass --settings <path> to patch a specific settings.json.');
		// Still patch Copilot tool permissions below (permissions-config.json), as that
		// is independent from VS Code's chat.*Locations settings file discovery.
	}

	for (const settingsPath of existing) {
		console.log(`Patching ${settingsPath}`);
		backupFile(settingsPath, { dryRun: args.dryRun });

		const settings = readJsonc(settingsPath);
		let changed = false;

		// Remove stale Documents/instruction-engine entries before adding the correct ~/.copilot paths.
		changed = removeStaleLocations(settings) || changed;

		changed = ensureLocationEnabled(settings, 'chat.agentFilesLocations', desired.agents) || changed;
		changed = ensureLocationEnabled(settings, 'chat.agentSkillsLocations', desired.skills) || changed;
		changed = ensureLocationEnabled(settings, 'chat.promptFilesLocations', desired.prompts) || changed;
		changed = ensureLocationEnabled(settings, 'chat.instructionsFilesLocations', desired.instructions) || changed;

		// Guard: vault path must NEVER appear in skills scan locations
		changed = removeVaultFromSkillLocations(settings) || changed;

		// Add a conservative auto-approval list for common safe terminal commands.
		changed = ensureTerminalAutoApprove(settings) || changed;

		if (settings['chat.promptFiles'] !== true) {
			settings['chat.promptFiles'] = true;
			changed = true;
		}

		if (!changed) {
			console.log('  (no changes needed)');
			continue;
		}

		writeJson(settingsPath, settings, { dryRun: args.dryRun });
		console.log('  (patched)');
	}

	// Also ensure default tool permissions are set for the Copilot home and VS Code asset home.
	// This reduces repeated prompts when agent mode needs to read/write these folders.
	try {
		patchCopilotPermissionsConfig({
			copilotHomeAbs: copilotHome,
			vscodeHomeAbs: assetsHome,
			dryRun: args.dryRun
		});
	} catch (e) {
		console.log(`Copilot permissions: unable to patch (${String(e.message || e)})`);
	}
}

main();
