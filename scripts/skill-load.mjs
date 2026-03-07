#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'engine-assets', 'skills');

// --- Path security (mirrors RannIA/src/utils/pathSecurity.ts) ---

function containsTraversalSegment(pathStr) {
	const normalized = pathStr.replace(/\\/g, '/');
	const segments = normalized.split('/');
	return segments.some((seg) => seg === '..' || seg === '.');
}

function isConfinedToRoot(candidatePath, rootDir) {
	const resolvedCandidate = path.resolve(candidatePath);
	const resolvedRoot = path.resolve(rootDir);
	return (
		resolvedCandidate === resolvedRoot ||
		resolvedCandidate.startsWith(resolvedRoot + path.sep)
	);
}

function isSymlink(targetPath) {
	try {
		const stat = fs.lstatSync(targetPath);
		return stat.isSymbolicLink();
	} catch {
		return true; // Fail-closed
	}
}

// --- Core ---

function loadSkill(skillName, vaultRoot) {
	if (!skillName || typeof skillName !== 'string') {
		return { success: false, error: 'Skill name is required.' };
	}

	if (containsTraversalSegment(skillName)) {
		return { success: false, error: `Path traversal detected in skill name: "${skillName}"` };
	}

	const skillDir = path.join(vaultRoot, skillName);
	const skillMd = path.join(skillDir, 'SKILL.md');

	if (!isConfinedToRoot(skillDir, vaultRoot)) {
		return { success: false, error: 'Resolved path escapes vault root.' };
	}

	if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
		return { success: false, error: `Skill not found: "${skillName}"` };
	}

	if (isSymlink(skillDir) || isSymlink(skillMd)) {
		return { success: false, error: 'Symlink detected — access denied.' };
	}

	if (!fs.existsSync(skillMd)) {
		return { success: false, error: `SKILL.md not found in "${skillName}"` };
	}

	const content = fs.readFileSync(skillMd, 'utf8');
	return { success: true, content, resolvedPath: skillMd };
}

// --- CLI ---
const args = process.argv.slice(2);
const skillName = args[0];

if (!skillName) {
	console.error('Usage: skill-load.mjs <skill-name>');
	process.exit(1);
}

const result = loadSkill(skillName, skillsRoot);

if (!result.success) {
	console.error(result.error);
	process.exit(1);
}

process.stdout.write(result.content);

export { loadSkill, containsTraversalSegment, isConfinedToRoot };
