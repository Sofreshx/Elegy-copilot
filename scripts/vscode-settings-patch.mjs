#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'fs';
import os from 'os';
import path from 'path';

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

function ensureArrayIncludes(obj, key, value) {
	const existing = obj[key];
	if (existing == null) {
		obj[key] = [value];
		return true;
	}
	if (Array.isArray(existing)) {
		if (existing.includes(value)) return false;
		existing.push(value);
		return true;
	}
	// If user had a non-array, upgrade to array.
	obj[key] = [existing, value];
	return true;
}

function writeJson(filePath, obj, { dryRun }) {
	const json = JSON.stringify(obj, null, 2) + '\n';
	if (dryRun) {
		console.log(`[DRY-RUN] Would write ${filePath}`);
		return;
	}
	fs.writeFileSync(filePath, json, 'utf8');
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

	if (platform === 'win32' && appData) {
		return [
			path.join(appData, 'Code', 'User', 'settings.json'),
			path.join(appData, 'Code - Insiders', 'User', 'settings.json')
		];
	}

	if (platform === 'darwin') {
		const base = path.join(home, 'Library', 'Application Support');
		return [
			path.join(base, 'Code', 'User', 'settings.json'),
			path.join(base, 'Code - Insiders', 'User', 'settings.json')
		];
	}

	// linux + everything else
	const base = path.join(home, '.config');
	return [
		path.join(base, 'Code', 'User', 'settings.json'),
		path.join(base, 'Code - Insiders', 'User', 'settings.json')
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
	const home = os.homedir();
	if (process.platform === 'win32' || process.platform === 'darwin') {
		return path.join(home, 'Documents', 'instruction-engine');
	}
	return path.join(home, '.local', 'state', 'instruction-engine');
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
	// Prefer the explicit VS Code asset home.
	if (args.vscodeHome && args.vscodeHome.trim()) {
		return resolveVscodeHome(args.vscodeHome);
	}

	// Back-compat: if callers still pass --copilot-home, treat it as the asset root.
	// This is intentionally NOT the default anymore; ~/.copilot is CLI-only.
	if (args.copilotHome && args.copilotHome.trim()) {
		return resolveCopilotHome(args.copilotHome);
	}

	return resolveVscodeHome(null);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const assetsHome = resolveAssetsHome(args);

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
		process.exit(0);
	}

	for (const settingsPath of existing) {
		console.log(`Patching ${settingsPath}`);
		backupFile(settingsPath, { dryRun: args.dryRun });

		const settings = readJsonc(settingsPath);
		let changed = false;

		changed = ensureArrayIncludes(settings, 'chat.agentFilesLocations', desired.agents) || changed;
		changed = ensureArrayIncludes(settings, 'chat.agentSkillsLocations', desired.skills) || changed;
		changed = ensureArrayIncludes(settings, 'chat.promptFilesLocations', desired.prompts) || changed;
		changed = ensureArrayIncludes(settings, 'chat.instructionsFilesLocations', desired.instructions) || changed;

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
}

main();
