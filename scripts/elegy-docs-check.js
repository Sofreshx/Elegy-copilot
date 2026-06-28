/* eslint-disable no-console */

'use strict';

const fs = require('fs');
const path = require('path');
const { matchFrontmatter } = require('./lib/spec-headings.js');
const { parseFrontmatterYaml } = require('./lib/spec-yaml.js');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const defaultRepoRoot = path.resolve(__dirname, '..');
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Scaffold file patterns relative to repo root. */
const SCAFFOLD_FILES = [
	'AGENTS.md',
	'CLAUDE.md',
	'GEMINI.md',
	'ROUTER.md',
	'SETUP.md',
	'SYNC.md',
	'README.md',
	'SECURITY.md',
	'SUPPORT.md',
	'CODE_OF_CONDUCT.md',
];

/** Directories to scan for *.md files. */
const SCAFFOLD_DIRS = [
	'context',
	'patterns',
	'docs',
];

/** Config files. */
const CONFIG_FILES = [
	'.opencode/opencode.jsonc',
];

/** Directories to scan recursively for all files (not just .md). */
const RECURSIVE_DIRS = [
	'.opencode',
];

/** Default staleness thresholds. Overridable via .elegy/repo-check-config.json. */
const DEFAULT_STALENESS_CONFIG = {
	warnDays: 90,
	errorDays: null,
	warnCommits: 50,
	errorCommits: 200,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(filePath) {
	return filePath.split(path.sep).join('/');
}

/**
 * Parse an ISO date string (YYYY-MM-DD) into a Date object.
 * Returns null for invalid dates.
 */
function parseIsoDate(value) {
	if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null;
	const [yearText, monthText, dayText] = value.split('-');
	const year = Number.parseInt(yearText, 10);
	const month = Number.parseInt(monthText, 10);
	const day = Number.parseInt(dayText, 10);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		return null;
	}
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Create a DriftIssue object without a source claim.
 */
function makeStructuralIssue(code, severity, file, line, message, suggestion) {
	return {
		code: code,
		severity: severity,
		claim: null,
		file: file,
		line: line || null,
		message: message,
		suggestion: suggestion || null,
	};
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

/**
 * Parse command-line arguments.
 *
 * @param {string[]} argv — process.argv slice
 * @returns {{ target: string, json: boolean, verbose: boolean, check: string }}
 */
function parseArgs(argv) {
	const args = {
		target: defaultRepoRoot,
		json: false,
		verbose: false,
		check: 'all',
	};

	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];

		if (flag === '--target' && i + 1 < argv.length) {
			args.target = path.resolve(argv[++i]);
		} else if (flag === '--json') {
			args.json = true;
		} else if (flag === '--verbose') {
			args.verbose = true;
		} else if (flag === '--check' && i + 1 < argv.length) {
			const value = argv[++i];
			const validChecks = ['claims', 'frontmatter', 'staleness', 'links', 'scripts', 'cross-file', 'todo-fixme', 'tool-config-sync', 'all'];
			if (validChecks.indexOf(value) !== -1) {
				args.check = value;
			} else {
				console.error('Invalid --check value "%s". Valid values: %s', value, validChecks.join(', '));
				process.exitCode = 1;
			}
		} else if (flag === '--help') {
			printUsage();
			process.exit(0);
		}
	}

	return args;
}

function printUsage() {
	console.log([
		'Usage: node scripts/elegy-docs-check.js [options]',
		'',
		'Options:',
		'  --target <path>    Repo root directory (default: parent of scripts/)',
		'  --json             Output machine-readable JSON DriftReport to stdout',
		'  --verbose          Include verbose detail in JSON; show successful claims in human mode',
		'  --check <name>     Run only a specific check: claims, frontmatter, staleness, links, scripts, cross-file, todo-fixme, tool-config-sync, all (default)',
		'  --help             Print this usage message',
		'',
	].join('\n'));
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

/**
 * Collect all scaffold files in the repo.
 * Checks existence of each pattern; returns relative POSIX paths.
 *
 * @param {string} target — repo root path
 * @returns {string[]} relative file paths
 */
function collectScaffoldFiles(target) {
	/** @type {string[]} */
	const files = [];

	// Check root-level scaffold markdown files
	for (let i = 0; i < SCAFFOLD_FILES.length; i++) {
		const file = SCAFFOLD_FILES[i];
		const absPath = path.join(target, file);
		if (fs.existsSync(absPath)) {
			files.push(toPosix(file));
		}
	}

	// Check scaffold directories for *.md
	for (let i = 0; i < SCAFFOLD_DIRS.length; i++) {
		const dir = SCAFFOLD_DIRS[i];
		const absDir = path.join(target, dir);
		if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
			collectMarkdownFiles(absDir, dir, files);
		}
	}

	// Check config files
	for (let i = 0; i < CONFIG_FILES.length; i++) {
		const file = CONFIG_FILES[i];
		const absPath = path.join(target, file);
		if (fs.existsSync(absPath)) {
			files.push(toPosix(file));
		}
	}

	// Recursive dirs: scan all files, not just .md
	for (let i = 0; i < RECURSIVE_DIRS.length; i++) {
		const dir = RECURSIVE_DIRS[i];
		const absDir = path.join(target, dir);
		if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
			collectAllFiles(absDir, dir, files);
		}
	}

	return files.sort(function (a, b) { return a.localeCompare(b); });
}

/**
 * Recursively collect *.md files from a directory.
 * Skips node_modules and .git directories.
 *
 * @param {string} absDir — absolute path to directory
 * @param {string} relDir — relative POSIX path prefix
 * @param {string[]} files — output array (mutated)
 */
function collectMarkdownFiles(absDir, relDir, files) {
	let entries;
	try {
		entries = fs.readdirSync(absDir, { withFileTypes: true });
	} catch (_) {
		return;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];

		// Skip node_modules, .git, and _templates directories
		if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '_templates') {
			continue;
		}

		const absPath = path.join(absDir, entry.name);
		const relPath = toPosix(path.join(relDir, entry.name));

		if (entry.isDirectory()) {
			collectMarkdownFiles(absPath, relPath, files);
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			files.push(relPath);
		}
	}
}

/**
 * Recursively collect all files (no extension filter) from a directory.
 * Skips node_modules and .git directories.
 *
 * @param {string} absDir — absolute path to directory
 * @param {string} relDir — relative POSIX path prefix
 * @param {string[]} files — output array (mutated)
 */
function collectAllFiles(absDir, relDir, files) {
	let entries;
	try {
		entries = fs.readdirSync(absDir, { withFileTypes: true });
	} catch (_) {
		return;
	}

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];

		// Skip node_modules, .git, and _templates directories
		if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '_templates') {
			continue;
		}

		const absPath = path.join(absDir, entry.name);
		const relPath = toPosix(path.join(relDir, entry.name));

		if (entry.isDirectory()) {
			collectAllFiles(absPath, relPath, files);
		} else if (entry.isFile()) {
			files.push(relPath);
		}
	}
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a file.
 *
 * @param {string} file — relative path from target
 * @param {string} target — repo root
 * @returns {{ raw: string, parsed: object } | null}
 */
function parseFileFrontmatter(file, target) {
	const absPath = path.join(target, file);
	let content;
	try {
		content = fs.readFileSync(absPath, 'utf8');
	} catch (_) {
		return null;
	}

	const fm = matchFrontmatter(content);
	if (!fm) {
		return null;
	}

	let parsed;
	try {
		parsed = parseFrontmatterYaml(fm.yaml);
	} catch (_) {
		return null;
	}

	return {
		raw: fm.yaml,
		parsed: parsed,
	};
}

// ---------------------------------------------------------------------------
// Frontmatter validation
// ---------------------------------------------------------------------------

/**
 * Check frontmatter validity for scaffold files.
 *
 * Scaffold files are not required to have frontmatter. If they do,
 * validate date values (created, updated) and ordering (updated >= created).
 *
 * @param {string[]} scaffoldFiles — relative file paths
 * @param {Object<string, {raw: string, parsed: object}|null>} fileFrontmatters
 * @param {string} target — repo root
 * @returns {Array<{code: string, severity: string, claim: null, file: string, line: number|null, message: string, suggestion: string|null}>}
 */
function checkFrontmatter(scaffoldFiles, fileFrontmatters, target) {
	/** @type {Array} */
	const issues = [];

	for (let i = 0; i < scaffoldFiles.length; i++) {
		const file = scaffoldFiles[i];
		const fm = fileFrontmatters[file];

		if (!fm || !fm.parsed) {
			continue; // scaffold files don't require frontmatter
		}

		const meta = fm.parsed;
		const hasCreated = meta.created !== undefined && meta.created !== '';
		const hasUpdated = meta.updated !== undefined && meta.updated !== '';

		if (hasCreated) {
			const createdDate = parseIsoDate(meta.created);
			if (!createdDate) {
				issues.push(makeStructuralIssue(
					'frontmatter_invalid',
					'warning',
					file,
					1,
					'Frontmatter `created` must be a valid ISO date in YYYY-MM-DD format.',
					'Update the created date to match YYYY-MM-DD format.'
				));
			}
		}

		if (hasUpdated) {
			const updatedDate = parseIsoDate(meta.updated);
			if (!updatedDate) {
				issues.push(makeStructuralIssue(
					'frontmatter_invalid',
					'warning',
					file,
					1,
					'Frontmatter `updated` must be a valid ISO date in YYYY-MM-DD format.',
					'Update the updated date to match YYYY-MM-DD format.'
				));
			}
		}

		if (hasCreated && hasUpdated) {
			const createdDate = parseIsoDate(meta.created);
			const updatedDate = parseIsoDate(meta.updated);
			if (createdDate && updatedDate && updatedDate < createdDate) {
				issues.push(makeStructuralIssue(
					'frontmatter_invalid',
					'error',
					file,
					1,
					'Frontmatter `updated` must be on or after `created`.',
					'Update the dates so updated >= created.'
				));
			}
		}
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Try to load repo-check config from .elegy/repo-check-config.json.
 * Returns both staleness config and exclusion config merged with defaults.
 *
 * @param {string} target — repo root
 * @returns {{ staleness: object, excludeClaimDirs: string[] }}
 */
function loadRepoCheckConfig(target) {
	const configPath = path.join(target, '.elegy', 'repo-check-config.json');
	const staleness = { ...DEFAULT_STALENESS_CONFIG };
	const excludeClaimDirs = [];

	if (!fs.existsSync(configPath)) {
		return { staleness, excludeClaimDirs };
	}

	let cfg;
	try {
		cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
	} catch (_) {
		return { staleness, excludeClaimDirs };
	}

	// Parse staleness section
	if (cfg && cfg.staleness) {
		if (typeof cfg.staleness.warnDays === 'number') staleness.warnDays = cfg.staleness.warnDays;
		if (typeof cfg.staleness.errorDays === 'number') staleness.errorDays = cfg.staleness.errorDays;
		if (typeof cfg.staleness.warnCommits === 'number') staleness.warnCommits = cfg.staleness.warnCommits;
		if (typeof cfg.staleness.errorCommits === 'number') staleness.errorCommits = cfg.staleness.errorCommits;
	}

	// Parse exclusion section
	if (cfg && Array.isArray(cfg.excludeClaimDirs)) {
		for (let i = 0; i < cfg.excludeClaimDirs.length; i++) {
			excludeClaimDirs.push(toPosix(cfg.excludeClaimDirs[i]));
		}
	}

	return { staleness, excludeClaimDirs };
}

/**
 * Backward-compatible wrapper returning only the staleness config.
 * Delegates to loadRepoCheckConfig.
 *
 * @param {string} target — repo root
 * @returns {object} — merged staleness config with defaults
 */
function loadStalenessConfig(target) {
	return loadRepoCheckConfig(target).staleness;
}

/**
 * Get the number of commits since a given ISO date in the repo.
 * Returns null if git is unavailable or the repo has no commits.
 *
 * @param {string} target — repo root
 * @param {Date} sinceDate
 * @returns {number|null}
 */
function getCommitCountSince(target, sinceDate) {
	try {
		const { spawnSync } = require('child_process');
		const sinceStr = sinceDate.toISOString().split('T')[0];
		const result = spawnSync('git', ['rev-list', '--count', 'HEAD', '--since=' + sinceStr], {
			cwd: target,
			encoding: 'utf8',
			timeout: 10_000,
			windowsHide: true,
		});

		if (result.error || result.status !== 0) {
			return null;
		}

		const count = parseInt(result.stdout.trim(), 10);
		return Number.isNaN(count) ? null : count;
	} catch (_) {
		return null;
	}
}

/**
 * Check if scaffold documents are stale based on their `updated` date
 * and optionally commit count.
 *
 * @param {string[]} scaffoldFiles
 * @param {Object<string, {raw: string, parsed: object}|null>} fileFrontmatters
 * @param {string} target
 * @returns {Array}
 */
function checkStaleness(scaffoldFiles, fileFrontmatters, target) {
	const issues = [];
	const now = new Date();
	const config = loadStalenessConfig(target);

	for (let i = 0; i < scaffoldFiles.length; i++) {
		const file = scaffoldFiles[i];
		const fm = fileFrontmatters[file];

		if (!fm || !fm.parsed) {
			continue;
		}

		const updated = fm.parsed.updated;
		if (updated === undefined || updated === '') {
			continue;
		}

		const updatedDate = parseIsoDate(updated);
		if (!updatedDate) {
			continue;
		}

		const diffMs = now.getTime() - updatedDate.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		// Wall-clock staleness
		let severity = null;
		let reason = '';

		if (diffDays > config.warnDays) {
			severity = 'warning';
			reason = diffDays + ' days ago (> ' + config.warnDays + ' day threshold)';
		}

		// Commit-based staleness (supplemental)
		const commitCount = getCommitCountSince(target, updatedDate);
		if (commitCount !== null) {
			if (config.errorCommits && commitCount > config.errorCommits) {
				severity = 'error';
				reason = diffDays + ' days ago, ' + commitCount + ' commits (> ' + config.errorCommits + ' commit threshold)';
			} else if (config.warnCommits && commitCount > config.warnCommits) {
				if (severity !== 'error') {
					severity = 'warning';
				}
				reason = diffDays + ' days ago, ' + commitCount + ' commits (> ' + config.warnCommits + ' commit threshold)';
			}
		}

		if (severity) {
			issues.push(makeStructuralIssue(
				'stale_doc',
				severity,
				file,
				1,
				'Document last updated ' + reason + '.',
				'Review and update the document, then bump the `updated` date.'
			));
		}
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Script coverage check
// ---------------------------------------------------------------------------

/**
 * Check for undocumented package.json scripts.
 *
 * For each script name in package.json, verifies it is referenced in
 * at least one claim across all scaffold files. Scripts that appear
 * nowhere in the documentation produce an `undocumented_script` info issue.
 *
 * @param {string} target — repo root
 * @param {string[]} scaffoldFiles
 * @param {Array} allClaims — all extracted claims from scaffold files
 * @returns {Array}
 */
function checkScriptCoverage(target, scaffoldFiles, allClaims) {
	/** @type {Array} */
	const issues = [];

	const pkgPath = path.join(target, 'package.json');
	if (!fs.existsSync(pkgPath)) {
		return issues;
	}

	let pkg;
	try {
		pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	} catch (_) {
		return issues;
	}

	if (!pkg.scripts || typeof pkg.scripts !== 'object') {
		return issues;
	}

	const scriptNames = Object.keys(pkg.scripts);
	if (scriptNames.length === 0) {
		return issues;
	}

	// Build a set of all claim values for quick lookup
	const claimedValues = new Set();
	for (let i = 0; i < allClaims.length; i++) {
		const claim = allClaims[i];
		if (claim && typeof claim.value === 'string') {
			claimedValues.add(claim.value);
		}
	}

	for (let i = 0; i < scriptNames.length; i++) {
		const scriptName = scriptNames[i];
		let isDocumented = false;

		// Check if the script name appears in any claim value
		for (const claimedValue of claimedValues) {
			if (claimedValue.indexOf(scriptName) !== -1) {
				isDocumented = true;
				break;
			}
		}

		if (!isDocumented) {
			issues.push(makeStructuralIssue(
				'undocumented_script',
				'info',
				'package.json',
				null,
				'Script `' + scriptName + '` in package.json is not documented in any scaffold file.',
				'Add a reference to `npm run ' + scriptName + '` in the relevant scaffold file.'
			));
		}
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Link validation
// ---------------------------------------------------------------------------

/**
 * Parse all internal markdown links from a file and verify each resolves.
 *
 * Similar to verifyLinkClaim but operates on raw file content rather than
 * extracted claims, catching link targets that may not have been extracted.
 *
 * @param {string[]} scaffoldFiles
 * @param {string} target — repo root
 * @returns {Array}
 */
/**
 * Check if a position in a line is inside inline code (backticks).
 */
function isInsideInlineCode(line, position) {
	let inInlineCode = false;
	for (let i = 0; i < position; i++) {
		if (line[i] === '`') {
			inInlineCode = !inInlineCode;
		}
	}
	return inInlineCode;
}

/**
 * Compute which lines are inside fenced code blocks.
 */
function computeFencedCodeBlockLines(lines) {
	const excluded = new Array(lines.length).fill(false);
	let inBlock = false;
	for (let i = 0; i < lines.length; i++) {
		if (/^```/.test(lines[i])) {
			excluded[i] = true;
			inBlock = !inBlock;
			continue;
		}
		if (inBlock) {
			excluded[i] = true;
		}
	}
	return excluded;
}

function checkAllLinks(scaffoldFiles, target) {
	/** @type {Array} */
	const issues = [];

	for (let i = 0; i < scaffoldFiles.length; i++) {
		const file = scaffoldFiles[i];
		const absPath = path.join(target, file);

		let content;
		try {
			content = fs.readFileSync(absPath, 'utf8');
		} catch (_) {
			continue;
		}

		const lines = content.split(/\r?\n/);
		const fencedExcluded = computeFencedCodeBlockLines(lines);
		const linkRe = /\[([^\]]*)\]\(((?!https?:\/\/)(?!mailto:)(?!#)[^)]+)\)/g;

		for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
			// Skip lines inside fenced code blocks
			if (fencedExcluded[lineIdx]) {
				continue;
			}
			const line = lines[lineIdx];
			let match;

			while ((match = linkRe.exec(line)) !== null) {
				const linkTarget = match[2];

				if (!linkTarget || linkTarget.trim().length === 0) {
					continue;
				}

				// Skip matches inside inline code (backticks)
				if (isInsideInlineCode(line, match.index)) {
					continue;
				}

				// Resolve link target
				let resolvedPath;
				const normalizedTarget = linkTarget.replace(/\\/g, '/');
				if (normalizedTarget.startsWith('docs/')) {
					// Path is relative to repo root
					resolvedPath = path.join(target, normalizedTarget);
				} else if (normalizedTarget.startsWith('/')) {
					// Absolute path — resolve relative to docs/ in repo root
					resolvedPath = path.join(target, 'docs', normalizedTarget.replace(/^\/+/, ''));
				} else {
					// Resolve relative to the source file's directory
					const sourceDir = path.dirname(absPath);
					resolvedPath = path.resolve(sourceDir, linkTarget);
				}

				if (!fs.existsSync(resolvedPath)) {
					issues.push(makeStructuralIssue(
						'broken_internal_link',
						'error',
						file,
						lineIdx + 1,
						'Linked file `' + linkTarget + '` does not exist.',
						'Check if the target file was moved or renamed.'
					));
				}
			}
		}
	}

	return issues;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

/**
 * Build a DriftReport object from all issues.
 *
 * Scoring:
 *   - No claims and no structural issues → score = 100
 *   - Base score = 100 * (verifiedCount / (verifiedCount + failedCount))
 *   - Deduct: -2 per error, -1 per warning, -0.5 per info
 *   - Floor at 0, ceiling at 100
 *
 * @param {Array} allIssues — combined claim and structural issues
 * @param {number} fileCount — number of scaffold files checked
 * @param {number} claimCount — total claims extracted
 * @param {boolean} verbose — include full claim detail in issues
 * @returns {{ score: number, timestamp: string, filesChecked: number, claimsExtracted: number, verifiedCount: number, failedCount: number, issues: Array, structuralIssues: number, severityCounts: { error: number, warning: number, info: number } }}
 */
function buildReport(allIssues, fileCount, claimCount, verbose) {
	const claimIssues = [];
	const structuralIssues = [];
	let errorCount = 0;
	let warningCount = 0;
	let infoCount = 0;

	for (let i = 0; i < allIssues.length; i++) {
		const issue = allIssues[i];
		if (issue.severity === 'error') errorCount++;
		else if (issue.severity === 'warning') warningCount++;
		else if (issue.severity === 'info') infoCount++;

		if (issue.claim) {
			claimIssues.push(issue);
		} else {
			structuralIssues.push(issue);
		}
	}

	// Separate claim issues into verified vs failed based on presence
	// (claim issues are only returned for failed verifications, so all
	//  claimIssues count as failed)
	const failedCount = claimIssues.length;
	const verifiedCount = claimCount - failedCount;

	// Compute score
	let score;
	if (claimCount === 0 && allIssues.length === 0) {
		score = 100;
	} else {
		let baseScore = 100;
		if (claimCount > 0) {
			baseScore = 100 * (verifiedCount / (verifiedCount + failedCount));
		}
		score = baseScore - (errorCount * 2) - (warningCount * 1) - (infoCount * 0.5);
		if (score < 0) score = 0;
		if (score > 100) score = 100;
	}

	return {
		score: Math.round(score),
		timestamp: new Date().toISOString(),
		filesChecked: fileCount,
		claimsExtracted: claimCount,
		verifiedCount: verifiedCount,
		failedCount: failedCount,
		issues: allIssues,
		severityCounts: {
			error: errorCount,
			warning: warningCount,
			info: infoCount,
		},
	};
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

/**
 * Print a human-readable DriftReport to stdout/stderr.
 *
 * @param {{ score: number, timestamp: string, filesChecked: number, claimsExtracted: number, verifiedCount: number, failedCount: number, issues: Array, severityCounts: { error: number, warning: number, info: number } }} report
 * @param {boolean} verbose — show successful claims too
 */
function printHumanReport(report, verbose) {
	const sev = report.severityCounts;
	const totalIssues = sev.error + sev.warning + sev.info;

	console.log('');
	console.log('Docs drift: ' + report.score + '/100');
	console.log(sev.error + ' errors, ' + sev.warning + ' warnings, ' + sev.info + ' info');
	console.log(
		report.filesChecked + ' files checked, ' +
		report.claimsExtracted + ' claims extracted (' +
		report.verifiedCount + ' verified, ' +
		report.failedCount + ' failed)'
	);
	console.log('');

	if (totalIssues === 0) {
		console.log('No drift issues found.');
		console.log('');
		return;
	}

	// Group issues by severity
	const errorIssues = [];
	const warningIssues = [];
	const infoIssues = [];

	for (let i = 0; i < report.issues.length; i++) {
		const issue = report.issues[i];
		if (issue.severity === 'error') errorIssues.push(issue);
		else if (issue.severity === 'warning') warningIssues.push(issue);
		else infoIssues.push(issue);
	}

	if (errorIssues.length > 0) {
		console.log('Errors:');
		for (let i = 0; i < errorIssues.length; i++) {
			const issue = errorIssues[i];
			printIssueLine(issue);
		}
		console.log('');
	}

	if (warningIssues.length > 0) {
		console.log('Warnings:');
		for (let i = 0; i < warningIssues.length; i++) {
			const issue = warningIssues[i];
			printIssueLine(issue);
		}
		console.log('');
	}

	if (infoIssues.length > 0) {
		console.log('Info:');
		for (let i = 0; i < infoIssues.length; i++) {
			const issue = infoIssues[i];
			printIssueLine(issue);
		}
		console.log('');
	}

	console.log('Run with --json for machine-readable output.');
	if (!verbose) {
		console.log('Run with --verbose for full claim-level detail.');
	}
	console.log('');
}

/**
 * Print a single issue as a human-readable line.
 */
function printIssueLine(issue) {
	let location = issue.file || 'unknown';
	if (issue.line !== null && issue.line !== undefined) {
		location += ':' + issue.line;
	}
	console.log('  ' + location + ' \u2014 ' + issue.code + ': ' + issue.message);
	if (issue.suggestion) {
		console.log('    Suggestion: ' + issue.suggestion);
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
	const args = parseArgs(process.argv.slice(2));
	if (process.exitCode) return; // parse error set exitCode to 1 (skip when exitCode is undefined/null/0)

	const target = args.target;

	if (!fs.existsSync(target)) {
		console.error('Target directory does not exist: ' + target);
		process.exitCode = 1;
		return;
	}

	// Phase 1: Collect scaffold files
	const scaffoldFiles = collectScaffoldFiles(target);

	// Load config for exclusion setup
	const config = loadRepoCheckConfig(target);

	// Filter files for claims extraction (excluded dirs still get structural checks)
	const claimFiles = scaffoldFiles.filter(function (f) {
		for (let di = 0; di < config.excludeClaimDirs.length; di++) {
			if (f.startsWith(config.excludeClaimDirs[di])) {
				return false;
			}
		}
		return true;
	});

	// Phase 2: Extract claims from claimFiles (not all scaffold files)
	// Excluded dirs (e.g. docs/research/) skip claims extraction to avoid
	// false positives from forward-looking references to planned files.
	const extractor = require('./lib/claim-extractor.js');
	/** @type {Array} */
	const allClaims = [];
	for (let i = 0; i < claimFiles.length; i++) {
		const file = claimFiles[i];
		const absPath = path.join(target, file);
		let content;
		try {
			content = fs.readFileSync(absPath, 'utf8');
		} catch (_) {
			continue;
		}
		const claims = extractor.extractClaims(content, file);
		for (let j = 0; j < claims.length; j++) {
			allClaims.push(claims[j]);
		}
	}

	// Phase 3: Verify claims
	const verifier = require('./lib/claim-verifier.js');
	/** @type {Array} */
	let claimIssues = [];
	if (args.check === 'all' || args.check === 'claims') {
		claimIssues = verifier.verifyClaims(allClaims, target);
	}

	// Phase 4: Structural checks
	const fileFrontmatters = {};
	for (let i = 0; i < scaffoldFiles.length; i++) {
		const file = scaffoldFiles[i];
		fileFrontmatters[file] = parseFileFrontmatter(file, target);
	}

	/** @type {Array} */
	let structuralIssues = [];
	if (args.check === 'all' || args.check === 'frontmatter') {
		structuralIssues = structuralIssues.concat(checkFrontmatter(scaffoldFiles, fileFrontmatters, target));
	}
	if (args.check === 'all' || args.check === 'staleness') {
		structuralIssues = structuralIssues.concat(checkStaleness(scaffoldFiles, fileFrontmatters, target));
	}
	if (args.check === 'all' || args.check === 'links') {
		structuralIssues = structuralIssues.concat(checkAllLinks(scaffoldFiles, target));
	}
	if (args.check === 'all' || args.check === 'scripts') {
		structuralIssues = structuralIssues.concat(checkScriptCoverage(target, scaffoldFiles, allClaims));
	}
	if (args.check === 'all' || args.check === 'cross-file') {
		const crossFileChecker = require('./lib/checkers/cross-file.js');
		structuralIssues = structuralIssues.concat(crossFileChecker.checkCrossFile(allClaims));
	}
	if (args.check === 'all' || args.check === 'todo-fixme') {
		const todoFixmeChecker = require('./lib/checkers/todo-fixme.js');
		structuralIssues = structuralIssues.concat(todoFixmeChecker.checkTodoFixme(scaffoldFiles, target));
	}
	if (args.check === 'all' || args.check === 'tool-config-sync') {
		const toolConfigChecker = require('./lib/checkers/tool-config-sync.js');
		structuralIssues = structuralIssues.concat(toolConfigChecker.checkToolConfigSync(target));
	}

	// Phase 5: Build report
	const allIssues = claimIssues.concat(structuralIssues);
	const report = buildReport(allIssues, scaffoldFiles.length, allClaims.length, args.verbose);

	// Phase 6: Output
	if (args.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printHumanReport(report, args.verbose);
	}

	// Exit code based on errors
	const hasErrors = allIssues.some(function (i) { return i.severity === 'error'; });
	if (hasErrors) {
		process.exitCode = 1;
	}
}

// ---------------------------------------------------------------------------
// Entry point guard
// ---------------------------------------------------------------------------

if (require.main === module) {
	main();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	parseArgs: parseArgs,
	collectScaffoldFiles: collectScaffoldFiles,
	collectMarkdownFiles: collectMarkdownFiles,
	collectAllFiles: collectAllFiles,
	parseFileFrontmatter: parseFileFrontmatter,
	checkFrontmatter: checkFrontmatter,
	checkStaleness: checkStaleness,
	checkScriptCoverage: checkScriptCoverage,
	checkAllLinks: checkAllLinks,
	loadRepoCheckConfig: loadRepoCheckConfig,
	loadStalenessConfig: loadStalenessConfig,
	getCommitCountSince: getCommitCountSince,
	buildReport: buildReport,
	printHumanReport: printHumanReport,
	main: main,
};
