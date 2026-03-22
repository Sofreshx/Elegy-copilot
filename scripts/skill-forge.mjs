#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { repoRoot } from './lib/cli-utils.mjs';

const skillsRoot = path.join(repoRoot, 'engine-assets', 'skills');
const generatorPath = path.join(repoRoot, 'scripts', 'generate-skill-metadata-index.mjs');

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') {
			args.dryRun = true;
			continue;
		}
		if (arg === '--name') {
			args.name = argv[++i] ?? null;
			if (!args.name) throw new Error('Missing value for --name');
			continue;
		}
		if (arg.startsWith('--name=')) {
			args.name = arg.slice('--name='.length);
			if (!args.name) throw new Error('Missing value for --name');
			continue;
		}
		if (arg === '--description') {
			args.description = argv[++i] ?? null;
			if (!args.description) throw new Error('Missing value for --description');
			continue;
		}
		if (arg.startsWith('--description=')) {
			args.description = arg.slice('--description='.length);
			if (!args.description) throw new Error('Missing value for --description');
			continue;
		}
		if (arg === '--triggers') {
			const raw = argv[++i] ?? null;
			if (!raw) throw new Error('Missing value for --triggers');
			args.triggers = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		if (arg.startsWith('--triggers=')) {
			const raw = arg.slice('--triggers='.length);
			if (!raw) throw new Error('Missing value for --triggers');
			args.triggers = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		if (arg === '--constraints') {
			const raw = argv[++i] ?? null;
			if (!raw) throw new Error('Missing value for --constraints');
			args.constraints = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		if (arg.startsWith('--constraints=')) {
			const raw = arg.slice('--constraints='.length);
			if (!raw) throw new Error('Missing value for --constraints');
			args.constraints = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		if (arg === '--keywords') {
			const raw = argv[++i] ?? null;
			if (!raw) throw new Error('Missing value for --keywords');
			args.keywords = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		if (arg.startsWith('--keywords=')) {
			const raw = arg.slice('--keywords='.length);
			if (!raw) throw new Error('Missing value for --keywords');
			args.keywords = raw.split(',').map((s) => s.trim()).filter(Boolean);
			continue;
		}
		throw new Error(
			`Unknown arg: ${arg} (supported: --dry-run, --name, --description, --triggers, --constraints, --keywords)`
		);
	}
	return args;
}

function validate(args) {
	const errors = [];

	if (!args.name) {
		errors.push('--name is required.');
	} else if (!KEBAB_CASE.test(args.name)) {
		errors.push(`Name "${args.name}" does not match kebab-case pattern: ${KEBAB_CASE.source}`);
	}

	if (!args.triggers || args.triggers.length === 0) {
		errors.push('--triggers is required (comma-separated, at least one).');
	}

	if (!args.description) {
		errors.push('--description is required.');
	}

	return errors;
}

function buildSkillMd(args) {
	const triggersOn = (args.triggers || []).join(', ');
	const lines = [
		'---',
		`name: ${args.name}`,
		`description: "${(args.description || '').replace(/"/g, '\\"')}. Triggers on: ${triggersOn}."`,
		'---',
		'',
		`# ${args.name}`,
		'',
		'## Purpose',
		'',
		args.description || '(no description provided)',
		'',
		'## When to Use',
		'',
		'Trigger signals:',
	];

	for (const trigger of args.triggers || []) {
		lines.push(`- ${trigger}`);
	}

	if (args.constraints && args.constraints.length > 0) {
		lines.push('', '## Constraints', '');
		for (const constraint of args.constraints) {
			lines.push(`- ${constraint}`);
		}
	}

	if (args.keywords && args.keywords.length > 0) {
		lines.push('', '## Discovery Keywords', '');
		lines.push(args.keywords.join(', '));
	}

	lines.push('');
	return lines.join('\n');
}

function regenerateIndex() {
	execSync(`"${process.execPath}" "${generatorPath}"`, {
		cwd: repoRoot,
		stdio: 'pipe',
	});
}

// --- CLI ---
const args = parseArgs(process.argv.slice(2));
const errors = validate(args);

if (errors.length > 0) {
	console.error('Validation errors:');
	for (const e of errors) {
		console.error(`  - ${e}`);
	}
	process.exit(1);
}

const skillDir = path.join(skillsRoot, args.name);
const skillMd = path.join(skillDir, 'SKILL.md');
const content = buildSkillMd(args);

if (args.dryRun) {
	console.log(`[dry-run] Would create: ${path.relative(repoRoot, skillMd)}`);
	console.log('---');
	console.log(content);
	process.exit(0);
}

// Fail-closed: refuse to overwrite
if (fs.existsSync(skillMd)) {
	console.error(`Skill already exists: ${path.relative(repoRoot, skillMd)}`);
	console.error('Use a different name or delete the existing skill first.');
	process.exit(1);
}

fs.mkdirSync(skillDir, { recursive: true });
fs.writeFileSync(skillMd, content, 'utf8');
console.log(`Created: ${path.relative(repoRoot, skillMd)}`);

// Regenerate index from source
regenerateIndex();
console.log('Regenerated skill-metadata-index.json');

export { parseArgs, validate, buildSkillMd, KEBAB_CASE };
