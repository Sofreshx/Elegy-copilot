#!/usr/bin/env node

/**
 * obsidian-docs-preflight — Read-only preflight check before opening
 * a repo as an Obsidian vault.
 *
 * Usage: node scripts/obsidian-docs-preflight.js [target-repo-path]
 *
 * Checks Obsidian CLI, repo docs layout, .obsidian config state,
 * validator availability, and symlink hazards.
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetRepo = path.resolve(process.argv[2] || '.');

const results = {
	status: 'ok',
	targetRepo,
	checks: {},
	warnings: [],
	errors: [],
};

function addCheck(name, passed, detail) {
	results.checks[name] = { passed, detail };
}

function warn(message) {
	results.warnings.push(message);
}

function fail(message) {
	results.errors.push(message);
	results.status = 'error';
}

// ---- Helpers ----

function fileExists(filePath) {
	try {
		fs.accessSync(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function dirExists(dirPath) {
	try {
		const stat = fs.statSync(dirPath);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

function isGitRepo(dir) {
	const gitDir = path.join(dir, '.git');
	return dirExists(gitDir) || fileExists(gitDir);
}

// ---- 1. Target repo exists ----

if (!dirExists(targetRepo)) {
	fail(`Target repo does not exist or is not a directory: ${targetRepo}`);
	console.log(JSON.stringify(results, null, 2));
	process.exit(1);
}
addCheck('target-exists', true, targetRepo);

// ---- 2. Git availability ----

const isRepo = isGitRepo(targetRepo);
addCheck('is-git-repo', isRepo, isRepo ? 'Git repository detected' : 'Not a Git repository (non-blocking)');
if (!isRepo) {
	warn('Target is not a Git repository. Repo-backed docs assume Git for canonical tracking.');
}

// ---- 3. Obsidian CLI ----

try {
	const cliVersion = execSync('obsidian version', { encoding: 'utf8', stdio: 'pipe', timeout: 5000 }).trim();
	addCheck('obsidian-cli', true, `Available: ${cliVersion}`);
} catch {
	addCheck('obsidian-cli', false, 'obsidian CLI not found on PATH');
	warn('Obsidian CLI not available on PATH. The CLI is optional for v1 authoring (required only for automated vault operations). Install Obsidian Desktop 1.12+ and enable CLI in Settings → General.');
}

// ---- 4. Docs layout ----

const docsDir = path.join(targetRepo, 'docs');
const systemDir = path.join(docsDir, 'system');
const researchDir = path.join(docsDir, 'research');
const specsDir = path.join(targetRepo, 'specs');

const layout = {
	'docs/': dirExists(docsDir),
	'docs/system/': dirExists(systemDir),
	'docs/research/': dirExists(researchDir),
	'specs/': dirExists(specsDir),
};

addCheck('docs-layout', layout['docs/'] || layout['specs/'], JSON.stringify(layout));

if (!layout['docs/'] && !layout['specs/']) {
	warn('No docs/ or specs/ directory found. This repo may not have a documentation convention yet. Run obsidian-docs-init to set up.');
}

// ---- 5. .obsidian/ config state ----

const obsidianDir = path.join(targetRepo, '.obsidian');
const hasObsidianConfig = dirExists(obsidianDir);

if (hasObsidianConfig) {
	const obsidianFiles = fs.readdirSync(obsidianDir);
	const workspaceFiles = obsidianFiles.filter(f => f.startsWith('workspace'));
	const hasGitignore = fileExists(path.join(targetRepo, '.gitignore'));

	let gitignoreCoversWorkspace = false;
	if (hasGitignore) {
		const gitignoreContent = fs.readFileSync(path.join(targetRepo, '.gitignore'), 'utf8');
		gitignoreCoversWorkspace = workspaceFiles.every(f =>
			gitignoreContent.includes(`.obsidian/${f}`) || gitignoreContent.includes('.obsidian/workspace')
		);
	}

	addCheck('obsidian-config', true, `Found .obsidian/ with ${obsidianFiles.length} files`);

	if (workspaceFiles.length > 0 && !gitignoreCoversWorkspace) {
		warn(`.obsidian/ contains workspace state files (${workspaceFiles.join(', ')}) that are not in .gitignore. Run obsidian-docs-init to fix.`);
	}
} else {
	addCheck('obsidian-config', true, 'No .obsidian/ config found (will be created when Obsidian opens this folder)');
}

// ---- 6. Validator availability ----

const validatorPath = path.join(targetRepo, 'scripts', 'validate-doc-graph.js');
const hasValidator = fileExists(validatorPath);
addCheck('doc-validator', hasValidator, hasValidator ? validatorPath : 'No doc-graph validator found');
if (!hasValidator) {
	warn('No scripts/validate-doc-graph.js found. Doc validation will not be available. Consider copying the validator from the instruction-engine repo.');
}

// ---- 7. Symlink hazard check ----

const obsidianRealPath = hasObsidianConfig ? fs.realpathSync(obsidianDir) : null;
const targetRealPath = fs.realpathSync(targetRepo);
const hasSymlinks = obsidianRealPath && obsidianRealPath !== path.join(targetRealPath, '.obsidian');

addCheck('symlink-hazards', !hasSymlinks, hasSymlinks ? `Symlink detected: .obsidian/ resolves to ${obsidianRealPath}` : 'No symlinks detected');

if (hasSymlinks) {
	fail('Symlink detected in .obsidian/ path. Obsidian explicitly warns against symlinked vaults due to sync corruption, file-watch failures, and potential data loss. See https://obsidian.md/help/symlinks');
}

// ---- 8. Vault scope auto-detection ----

function detectVaultScope(repoRoot) {
	const obsidianAtRoot = dirExists(path.join(repoRoot, '.obsidian'));
	const obsidianInDocs = dirExists(path.join(repoRoot, 'docs', '.obsidian'));

	if (obsidianInDocs) return 'docs';
	if (obsidianAtRoot) return 'root';
	return 'undetermined';
}

const vaultScope = detectVaultScope(targetRepo);
results.vaultScope = vaultScope;

if (vaultScope === 'root') {
	addCheck('vault-scope', true, 'Vault is open at repo root (entire repo visible in Obsidian)');
} else if (vaultScope === 'docs') {
	addCheck('vault-scope', true, 'Vault is scoped to docs/ only');
} else {
	addCheck('vault-scope', true, 'Vault scope undetermined (no .obsidian/ yet)');
}

// ---- Output ----

console.log(JSON.stringify(results, null, 2));

if (results.status === 'error') {
	process.exit(1);
} else if (results.warnings.length > 0) {
	process.exit(0); // Warnings are non-fatal
} else {
	process.exit(0);
}
