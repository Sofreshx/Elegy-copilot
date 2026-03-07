#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'engine-assets', 'skills');
const schemaPath = path.join(repoRoot, 'contracts', 'elegy', 'skill-forge-request.schema.json');
const generatorPath = path.join(__dirname, 'generate-skill-metadata-index.mjs');

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--dry-run') {
			args.dryRun = true;
		} else if (arg === '--name' && argv[i + 1]) {
			args.name = argv[++i];
		} else if (arg === '--description' && argv[i + 1]) {
			args.description = argv[++i];
		} else if (arg === '--triggers' && argv[i + 1]) {
			args.triggers = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		} else if (arg === '--constraints' && argv[i + 1]) {
			args.constraints = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		} else if (arg === '--keywords' && argv[i + 1]) {
			args.keywords = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		}
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
