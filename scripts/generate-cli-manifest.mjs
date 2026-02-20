#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'fs';
import path from 'path';

function repoRoot() {
	return path.resolve(new URL('..', import.meta.url).pathname);
}

function listFiles(dirAbs, predicate) {
	let entries;
	try {
		entries = fs.readdirSync(dirAbs, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter((e) => e.isFile() && (!predicate || predicate(e.name)))
		.map((e) => path.join(dirAbs, e.name));
}

function listDirs(dirAbs) {
	let entries;
	try {
		entries = fs.readdirSync(dirAbs, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((e) => e.isDirectory()).map((e) => path.join(dirAbs, e.name));
}

function stableSort(a, b) {
	return a.localeCompare(b);
}

function parseArgs(argv) {
	const args = { all: false };
	for (const a of argv || []) {
		if (a === '--all') args.all = true;
	}
	return args;
}

function loadAllowlist(engineRoot, args) {
	if (args && args.all) return null;
	const allowPath = path.join(engineRoot, '.cli', 'manifest.allowlist.json');
	if (!fs.existsSync(allowPath)) return null;

	const parsed = JSON.parse(fs.readFileSync(allowPath, 'utf8'));
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Invalid manifest.allowlist.json (expected JSON object)');
	}
	const agents = Array.isArray(parsed.agents) ? parsed.agents : [];
	const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
	const prompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];

	return {
		allowPath,
		agents: new Set(agents.map((x) => String(x))),
		skills: new Set(skills.map((x) => String(x))),
		prompts: new Set(prompts.map((x) => String(x)))
	};
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const engineRoot = path.resolve(process.cwd());
	const manifestPath = path.join(engineRoot, '.cli', 'manifest.json');
	const assetsRoot = path.join(engineRoot, 'engine-assets');
	const assetsAgents = path.join(assetsRoot, 'agents');
	const assetsSkills = path.join(assetsRoot, 'skills');
	const assetsPrompts = path.join(assetsRoot, 'prompts');
	const cliInstructions = path.join(engineRoot, '.cli', 'instructions', 'copilot-instructions.md');
	const allow = loadAllowlist(engineRoot, args);

	if (!fs.existsSync(manifestPath)) {
		console.error(`Missing manifest: ${manifestPath}`);
		process.exit(1);
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest JSON');

	const assets = [];
	const matched = {
		agents: new Set(),
		skills: new Set(),
		prompts: new Set()
	};

	// Agents (files)
	for (const fileAbs of listFiles(assetsAgents, (n) => n.toLowerCase().endsWith('.agent.md')).sort(stableSort)) {
		const fileName = path.basename(fileAbs);
		const base = fileName.replace(/\.agent\.md$/i, '');
		if (allow && !allow.agents.has(base)) continue;
		matched.agents.add(base);
		const id = base.startsWith('agent-') ? base : `agent-${base}`;
		assets.push({
			id,
			type: 'agent',
			source: `engine-assets/agents/${fileName}`,
			destination: `agents/${fileName}`
		});
	}

	// Skills (directory assets)
	for (const dirAbs of listDirs(assetsSkills).sort(stableSort)) {
		const name = path.basename(dirAbs);
		if (allow && !allow.skills.has(name)) continue;
		const skillFile = path.join(dirAbs, 'SKILL.md');
		if (!fs.existsSync(skillFile)) continue;
		matched.skills.add(name);
		assets.push({
			id: `skill-${name}`,
			type: 'skill',
			source: `engine-assets/skills/${name}`,
			destination: `skills/${name}`
		});
	}

	// Prompts (files)
	if (fs.existsSync(assetsPrompts)) {
		for (const fileAbs of listFiles(assetsPrompts, (n) => n.toLowerCase().endsWith('.prompt.md')).sort(stableSort)) {
			const fileName = path.basename(fileAbs);
			const base = fileName.replace(/\.prompt\.md$/i, '');
			if (allow && !allow.prompts.has(base)) continue;
			matched.prompts.add(base);
			assets.push({
				id: `prompt-${base}`,
				type: 'prompt',
				source: `engine-assets/prompts/${fileName}`,
				destination: `prompts/${fileName}`
			});
		}
	}

	// Global CLI-first instructions (file)
	if (fs.existsSync(cliInstructions)) {
		assets.push({
			id: 'copilot-instructions',
			type: 'instructions',
			source: '.cli/instructions/copilot-instructions.md',
			destination: 'copilot-instructions.md'
		});
	}

	assets.sort((a, b) => (a.type || '').localeCompare(b.type || '') || (a.id || '').localeCompare(b.id || ''));

	if (allow) {
		const missingAgents = [...allow.agents].filter((x) => !matched.agents.has(x));
		const missingSkills = [...allow.skills].filter((x) => !matched.skills.has(x));
		const missingPrompts = [...allow.prompts].filter((x) => !matched.prompts.has(x));
		const missing = [...missingAgents, ...missingSkills, ...missingPrompts];
		if (missing.length > 0) {
			throw new Error(
				`Allowlist contains items not found in repo. Check ${allow.allowPath}: ${missing.join(', ')}`
			);
		}
	}

	manifest.assets = assets;
	manifest.sourcePatterns = [
		{ type: 'agent', sourceGlob: 'engine-assets/agents/*.agent.md', destinationDir: 'agents' },
		{ type: 'skill', sourceGlob: 'engine-assets/skills/*', destinationDir: 'skills' },
		{ type: 'prompt', sourceGlob: 'engine-assets/prompts/*.prompt.md', destinationDir: 'prompts' }
	];

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
	const suffix = allow ? ` (allowlist: ${allow.allowPath})` : '';
	console.log(`Wrote ${manifestPath} (${assets.length} assets)${suffix}`);
}

main();
