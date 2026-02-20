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

function main() {
	const engineRoot = path.resolve(process.cwd());
	const manifestPath = path.join(engineRoot, '.cli', 'manifest.json');
	const githubAgents = path.join(engineRoot, '.github', 'agents');
	const githubSkills = path.join(engineRoot, '.github', 'skills');
	const githubPrompts = path.join(engineRoot, '.github', 'prompts');
	const cliInstructions = path.join(engineRoot, '.cli', 'instructions', 'copilot-instructions.md');

	if (!fs.existsSync(manifestPath)) {
		console.error(`Missing manifest: ${manifestPath}`);
		process.exit(1);
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	if (!manifest || typeof manifest !== 'object') throw new Error('Invalid manifest JSON');

	const assets = [];

	// Agents (files)
	for (const fileAbs of listFiles(githubAgents, (n) => n.toLowerCase().endsWith('.agent.md')).sort(stableSort)) {
		const fileName = path.basename(fileAbs);
		const base = fileName.replace(/\.agent\.md$/i, '');
		assets.push({
			id: `agent-${base}`,
			type: 'agent',
			source: `.github/agents/${fileName}`,
			destination: `agents/${fileName}`
		});
	}

	// Skills (directory assets)
	for (const dirAbs of listDirs(githubSkills).sort(stableSort)) {
		const name = path.basename(dirAbs);
		const skillFile = path.join(dirAbs, 'SKILL.md');
		if (!fs.existsSync(skillFile)) continue;
		assets.push({
			id: `skill-${name}`,
			type: 'skill',
			source: `.github/skills/${name}`,
			destination: `skills/${name}`
		});
	}

	// Prompts (files)
	if (fs.existsSync(githubPrompts)) {
		for (const fileAbs of listFiles(githubPrompts, (n) => n.toLowerCase().endsWith('.prompt.md')).sort(stableSort)) {
			const fileName = path.basename(fileAbs);
			const base = fileName.replace(/\.prompt\.md$/i, '');
			assets.push({
				id: `prompt-${base}`,
				type: 'prompt',
				source: `.github/prompts/${fileName}`,
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

	manifest.assets = assets;
	manifest.sourcePatterns = [
		{ type: 'agent', sourceGlob: '.github/agents/*.agent.md', destinationDir: 'agents' },
		{ type: 'skill', sourceGlob: '.github/skills/*', destinationDir: 'skills' },
		{ type: 'prompt', sourceGlob: '.github/prompts/*.prompt.md', destinationDir: 'prompts' }
	];

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
	console.log(`Wrote ${manifestPath} (${assets.length} assets)`);
}

main();
