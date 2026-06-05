#!/usr/bin/env node

/**
 * obsidian-docs-validate — Combined validator that runs repo doc-graph
 * validation plus Obsidian metadata sanity checks.
 *
 * Usage: node scripts/obsidian-docs-validate.js [target-repo-path]
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

function readYamlFrontmatter(content) {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	return match[1];
}

function parseYamlSimple(yamlString) {
	const result = {};
	const lines = yamlString.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) continue;

		const key = trimmed.substring(0, colonIndex).trim();
		const value = trimmed.substring(colonIndex + 1).trim();

		if (value.startsWith('[') && value.endsWith(']')) {
			result[key] = value.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
		} else {
			result[key] = value.replace(/^['"]|['"]$/g, '');
		}
	}
	return result;
}

function walkDocs(dir, basePath = dir) {
	const files = [];
	const skipDirs = new Set(['.obsidian', '.git', 'node_modules', '.trash']);
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory() && !entry.name.startsWith('.') && !skipDirs.has(entry.name)) {
				files.push(...walkDocs(fullPath, basePath));
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				files.push(fullPath);
			}
		}
	} catch {
		// Directory doesn't exist or can't be read — skip
	}
	return files;
}

function detectVaultScope(repoRoot) {
	const obsidianInDocs = dirExists(path.join(repoRoot, 'docs', '.obsidian'));
	if (obsidianInDocs) return 'docs';
	const obsidianAtRoot = dirExists(path.join(repoRoot, '.obsidian'));
	if (obsidianAtRoot) return 'root';
	return 'docs';
}

// ---- 1. Run doc-graph validator ----

const docGraphValidator = path.join(targetRepo, 'scripts', 'validate-doc-graph.js');
if (fileExists(docGraphValidator)) {
	try {
		execSync(`node "${docGraphValidator}"`, {
			cwd: targetRepo,
			encoding: 'utf8',
			stdio: 'pipe',
			timeout: 30000,
		});
		addCheck('doc-graph-validator', true, 'Passed');
	} catch (err) {
		const stderr = (err.stderr || err.stdout || err.message || '').toString();
		// Only show last few lines of error output
		const errorLines = stderr.split('\n').filter(Boolean);
		const summary = errorLines.slice(-5).join('; ');
		addCheck('doc-graph-validator', false, `Failed: ${summary}`);
		fail(`Doc-graph validation failed. Fix errors before committing. Details: ${summary}`);
	}
} else {
	addCheck('doc-graph-validator', false, 'Validator not found');
	warn('No scripts/validate-doc-graph.js found. Skipping structural doc validation.');
}

// ---- 2. Obsidian metadata checks ----

const vaultScope = detectVaultScope(targetRepo);
addCheck('vault-scope', true, `Detected vault scope: ${vaultScope}`);

const docsDir = path.join(targetRepo, 'docs');
const docFiles = vaultScope === 'root'
	? walkDocs(targetRepo)
	: (dirExists(docsDir) ? walkDocs(docsDir) : []);
addCheck('doc-file-count', true, `Found ${docFiles.length} markdown files`);

let yamlErrors = 0;
let wikilinkErrors = 0;
let asciiIdErrors = 0;

for (const filePath of docFiles) {
	try {
		const content = fs.readFileSync(filePath, 'utf8');
		const frontmatter = readYamlFrontmatter(content);

		if (frontmatter === null) {
			// Not all docs require frontmatter in Obsidian; only validate those that have it
			continue;
		}

		// Check YAML parseability (basic)
		try {
			const parsed = parseYamlSimple(frontmatter);
			// Check doc ID is ASCII
			if (parsed.id && !/^[a-z0-9-]+$/.test(parsed.id)) {
				asciiIdErrors++;
				if (asciiIdErrors <= 5) {
					warn(`Non-ASCII or invalid characters in doc ID "${parsed.id}" in ${path.relative(targetRepo, filePath)}`);
				}
			}
		} catch {
			yamlErrors++;
			if (yamlErrors <= 5) {
				warn(`YAML parse error in frontmatter of ${path.relative(targetRepo, filePath)}`);
			}
		}

		// Check wikilinks
		const wikilinks = content.match(/\[\[([^\]]+)\]\]/g);
		if (wikilinks) {
			for (const link of wikilinks) {
				const target = link.slice(2, -2);
				if (target.includes('/') || target.includes('\\')) {
					wikilinkErrors++;
					if (wikilinkErrors <= 5) {
						warn(`Wikilink with path separator in ${path.relative(targetRepo, filePath)}: ${link}. Use [[id]] format only.`);
					}
				}
			}
		}
	} catch {
		// Skip unreadable files
	}
}

addCheck('yaml-frontmatter', yamlErrors === 0, yamlErrors > 0 ? `${yamlErrors} file(s) with YAML parse errors` : 'All frontmatter parseable');
addCheck('ascii-doc-ids', asciiIdErrors === 0, asciiIdErrors > 0 ? `${asciiIdErrors} doc(s) with non-ASCII IDs` : 'All doc IDs are ASCII');
addCheck('wikilink-format', wikilinkErrors === 0, wikilinkErrors > 0 ? `${wikilinkErrors} wikilink(s) with path separators` : 'All wikilinks use [[id]] format');

if (yamlErrors > 0 || asciiIdErrors > 0) {
	fail('Obsidian metadata checks found issues. Review warnings above.');
}

// ---- Output ----

console.log(JSON.stringify(results, null, 2));

if (results.status === 'error') {
	process.exit(1);
} else if (results.warnings.length > 0) {
	console.log('\n⚠ Warnings found (non-fatal):');
	results.warnings.forEach(w => console.log(`  - ${w}`));
	process.exit(0);
} else {
	console.log('\n✓ All checks passed');
	process.exit(0);
}
