#!/usr/bin/env node

/**
 * obsidian-docs-init — One-time setup to prepare a repo for use as
 * an Obsidian vault. Adds .gitignore rules and optional safe config.
 *
 * Usage: node scripts/obsidian-docs-init.js [target-repo-path] [--with-config]
 */

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const targetRepo = path.resolve(process.argv[2] || '.');
const withConfig = process.argv.includes('--with-config');
const vaultScopeArg = process.argv.find(arg => arg.startsWith('--vault-scope='));
const docsDir = path.join(targetRepo, 'docs');
const hasDocsDir = (() => { try { return fs.statSync(docsDir).isDirectory(); } catch { return false; } })();
const vaultScope = vaultScopeArg
	? vaultScopeArg.split('=')[1]
	: (hasDocsDir ? 'docs' : 'root');

const results = {
	status: 'ok',
	targetRepo,
	vaultScope,
	actions: [],
	warnings: [],
	errors: [],
};

function warn(message) {
	results.warnings.push(message);
}

function fail(message) {
	results.errors.push(message);
	results.status = 'error';
}

function dirExists(dirPath) {
	try {
		return fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function fileExists(filePath) {
	try {
		fs.accessSync(filePath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

// ---- Validate target ----

if (!dirExists(targetRepo)) {
	fail(`Target repo does not exist: ${targetRepo}`);
	console.log(JSON.stringify(results, null, 2));
	process.exit(1);
}

// ---- Ensure .obsidian/ directory exists ----

const vaultRoot = vaultScope === 'docs' ? docsDir : targetRepo;
const obsidianDir = path.join(vaultRoot, '.obsidian');
if (!dirExists(obsidianDir)) {
	fs.mkdirSync(obsidianDir, { recursive: true });
	results.actions.push(`Created .obsidian/ directory at ${path.relative(targetRepo, obsidianDir) || '.'}`);
}

// ---- Update .gitignore ----

const gitignorePath = path.join(vaultRoot, '.gitignore');
const requiredPatterns = [
	'.obsidian/workspace*.json',
	'.obsidian/workspace.json',
	'.trash/',
];

let gitignoreContent = '';
if (fileExists(gitignorePath)) {
	gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
}

const lines = gitignoreContent.split(/\r?\n/);
const missingPatterns = requiredPatterns.filter(pattern => {
	return !lines.some(line => line.trim() === pattern || line.trim().startsWith(pattern));
});

if (missingPatterns.length > 0) {
	let newContent = gitignoreContent;
	if (newContent && !newContent.endsWith('\n')) {
		newContent += '\n';
	}
	if (newContent && !newContent.endsWith('\n\n')) {
		newContent += '\n';
	}
	newContent += '# Obsidian — repo-backed vault (workspace state is personal, not shared)\n';
	for (const pattern of missingPatterns) {
		newContent += `${pattern}\n`;
	}
	fs.writeFileSync(gitignorePath, newContent, 'utf8');
	results.actions.push(`Added to .gitignore: ${missingPatterns.join(', ')}`);
} else {
	results.actions.push('.gitignore already contains required Obsidian patterns');
}

// ---- Write safe .obsidian/app.json (optional) ----

if (withConfig) {
	const appJsonPath = path.join(obsidianDir, 'app.json');

	const safeDefaults = {
		attachmentFolderPath: './assets',
		newLinkFormat: 'relative',
		useMarkdownLinks: true,
		showUnsupportedFiles: false,
	};

	let existingAppJson = {};
	if (fileExists(appJsonPath)) {
		try {
			existingAppJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
		} catch {
			warn('Existing .obsidian/app.json is invalid JSON; overwriting with safe defaults');
		}
	}

	const merged = { ...safeDefaults, ...existingAppJson };
	fs.writeFileSync(appJsonPath, JSON.stringify(merged, null, '\t') + '\n', 'utf8');
	results.actions.push('Wrote .obsidian/app.json with safe defaults (relative links, Markdown links)');
} else {
	results.actions.push('Skipped .obsidian/app.json (use --with-config to create)');
}

// ---- Output ----

console.log(JSON.stringify(results, null, 2));

if (results.status === 'error') {
	process.exit(1);
} else {
	process.exit(0);
}
