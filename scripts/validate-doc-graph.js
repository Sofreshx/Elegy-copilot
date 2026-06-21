/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { parseFrontmatterYaml: parseFrontmatterYamlShared } = require('./lib/spec-yaml.js');
const { matchFrontmatter } = require('./lib/spec-headings.js');

const defaultRepoRoot = path.resolve(__dirname, '..');

const allowedCategory = new Set(['system', 'research', 'adr', 'meta', 'lexicon']);
const allowedStatus = new Set(['current', 'stale', 'draft', 'archived']);
const allowedDocKind = new Set(['index', 'moc', 'node', 'redirect']);

const requiredKeys = ['created', 'updated', 'category', 'status', 'doc_kind'];
const allowlistedNonRedirectKeys = new Set([
	...requiredKeys,
	'id',
	'summary',
	'tags',
	'related',
	'applies_to',
	'keywords',
	'last_validated',
	'expires_after_days',
	'schema_version',
	'aliases',
	'publish',
	'cssclasses',
]);
const allowlistedRedirectKeys = new Set([...requiredKeys, 'redirect_to']);

const idRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

function toPosix(filePath) {
	return filePath.split(path.sep).join('/');
}

function isAsciiOnly(text) {
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) > 0x7f) return false;
	}
	return true;
}

function parseIsoDate(value) {
	if (typeof value !== 'string' || !isoDateRegex.test(value)) return null;
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

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMarkdownHeading(lines, headingText, level = 2) {
	const hashes = '#'.repeat(level);
	const headingPattern = new RegExp(`^\\s{0,3}${escapeRegExp(hashes)}\\s+${escapeRegExp(headingText)}(?:\\s+#+)?\\s*$`);
	return lines.some((line) => headingPattern.test(line));
}

function walkDir(dir) {
	/** @type {string[]} */
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			results.push(fullPath);
		}
	}
	return results;
}

function parseInlineList(value) {
	const trimmed = value.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
	const inner = trimmed.slice(1, -1).trim();
	if (!inner) return [];
	return inner
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((item) => item.replace(/^['"]|['"]$/g, ''));
}

// Local wrapper: adds numeric-value handling on top of the shared parser
function parseFrontmatterYaml(yamlText) {
	// First try the shared parser
	const result = parseFrontmatterYamlShared(yamlText);
	// Apply numeric handling: convert numeric strings to numbers
	for (const [key, value] of Object.entries(result)) {
		if (typeof value === 'string' && /^-?\d+$/.test(value)) {
			result[key] = Number(value);
		}
	}
	return result;
}

function stripFencedAndInlineCode(lines) {
	/** @type {string[]} */
	const cleaned = [];
	let inFence = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('```')) {
			inFence = !inFence;
			cleaned.push('');
			continue;
		}
		if (inFence) {
			cleaned.push('');
			continue;
		}
		cleaned.push(line.replace(/`[^`]*`/g, ''));
	}
	return cleaned;
}

function findWikiLinksInLine(line) {
	/** @type {{ id: string; raw: string }[]} */
	const results = [];
	const regex = /\[\[([^\]]+)\]\]/g;
	let match;
	while ((match = regex.exec(line))) {
		const rawInner = match[1];
		const inner = rawInner.trim();
		results.push({ id: inner, raw: match[0] });
	}
	return results;
}

function ensure(condition, message, errors) {
	if (condition) return;
	errors.push(message);
}

function isRepoBackedPlanningArtifact(rel) {
	return rel === 'docs/backlog.md' || rel.startsWith('docs/backlogs/') || rel.startsWith('docs/roadmaps/');
}

function validateDocGraph({ repoRoot = defaultRepoRoot } = {}) {
	/** @type {string[]} */
	const errors = [];
	/** @type {string[]} */
	const warnings = [];
	const docsRoot = path.join(repoRoot, 'docs');

	if (!fs.existsSync(docsRoot)) {
		errors.push('docs/ folder not found');
		return { errors, warnings, docCount: 0 };
	}

	const docFiles = walkDir(docsRoot).filter(abs => !abs.includes(`docs${path.sep}specs${path.sep}`));

	/** @type {Map<string, { rel: string; abs: string; meta: any; body: string; lines: string[] }>} */
	const docsByRel = new Map();
	/** @type {Map<string, string>} */
	const idToRel = new Map();
	/** @type {Map<string, string>} */
	const caseFoldToId = new Map();

	for (const abs of docFiles) {
		const rel = toPosix(path.relative(repoRoot, abs));
		const text = fs.readFileSync(abs, 'utf8');
		const frontmatter = matchFrontmatter(text);
		if (!frontmatter) {
			errors.push(`${rel}: Missing YAML frontmatter (must start with --- and end with ---).`);
			continue;
		}
		const rawYaml = frontmatter.yaml;
		let meta;
		try {
			meta = parseFrontmatterYaml(rawYaml);
		} catch (error) {
			errors.push(`${rel}: Frontmatter YAML parse error: ${error.message}`);
			continue;
		}
		const body = text.slice(frontmatter.full.length);
		const lines = text.split(/\r?\n/);
		docsByRel.set(rel, { rel, abs, meta, body, lines });

		for (const key of requiredKeys) {
			ensure(meta[key] !== undefined && meta[key] !== '', `${rel}: Missing required frontmatter key: ${key}`, errors);
		}

		if (meta.created !== undefined) {
			const createdDate = parseIsoDate(meta.created);
			if (!createdDate) {
				errors.push(`${rel}: created must be a valid ISO date in YYYY-MM-DD format.`);
			}
			const updatedDate = parseIsoDate(meta.updated);
			if (meta.updated !== undefined && !updatedDate) {
				errors.push(`${rel}: updated must be a valid ISO date in YYYY-MM-DD format.`);
			}
			if (createdDate && updatedDate && updatedDate < createdDate) {
				errors.push(`${rel}: updated must be on or after created.`);
			}
		}

		if (meta.category && !allowedCategory.has(meta.category)) {
			errors.push(`${rel}: Invalid category '${meta.category}'.`);
		}
		if (meta.status && !allowedStatus.has(meta.status)) {
			errors.push(`${rel}: Invalid status '${meta.status}'.`);
		}
		if (meta.doc_kind && !allowedDocKind.has(meta.doc_kind)) {
			errors.push(`${rel}: Invalid doc_kind '${meta.doc_kind}'.`);
		}

		const docKind = meta.doc_kind;
		const allowedKeys = docKind === 'redirect' ? allowlistedRedirectKeys : allowlistedNonRedirectKeys;
		for (const key of Object.keys(meta)) {
			if (!allowedKeys.has(key)) {
				errors.push(`${rel}: Disallowed frontmatter key '${key}'.`);
			}
		}
	}

	for (const [rel, doc] of docsByRel) {
		const meta = doc.meta;
		const docKind = meta.doc_kind;

		if (rel.startsWith('docs/system/') && meta.category !== 'system') {
			errors.push(`${rel}: docs/system/** must have category: system.`);
		}
		if (rel.startsWith('docs/system/') && rel.endsWith('-adr.md')) {
			const headingLines = stripFencedAndInlineCode(doc.body.split(/\r?\n/));
			for (const headingText of ['Context', 'Decision', 'Consequences']) {
				if (!hasMarkdownHeading(headingLines, headingText, 2)) {
					errors.push(`${rel}: ADR docs must include required heading '## ${headingText}'.`);
				}
			}
		}
		if (rel.startsWith('docs/research/') && meta.category !== 'research') {
			errors.push(`${rel}: docs/research/** must have category: research.`);
		}
		if (rel.startsWith('docs/lexicon/') && meta.category !== 'lexicon') {
			errors.push(`${rel}: docs/lexicon/** must have category: lexicon.`);
		}
		const isTopLevelDocsFile = rel.startsWith('docs/') && !rel.slice('docs/'.length).includes('/');
		if (isTopLevelDocsFile && docKind !== 'redirect' && !isRepoBackedPlanningArtifact(rel)) {
			errors.push(`${rel}: Top-level docs/*.md must be doc_kind: redirect.`);
		}

		const isSystemOrResearch = rel.startsWith('docs/system/') || rel.startsWith('docs/research/');
		if (docKind !== 'redirect' && isSystemOrResearch) {
			if (!meta.id) {
				errors.push(`${rel}: Missing id (required for non-redirect docs under docs/system/** or docs/research/**).`);
			} else {
				const id = meta.id;
				if (typeof id !== 'string') {
					errors.push(`${rel}: id must be a string.`);
				} else {
					if (!isAsciiOnly(id) || !idRegex.test(id)) {
						errors.push(`${rel}: Invalid id '${id}' (must match ${idRegex}).`);
					}
					const fold = id.toLowerCase();
					if (caseFoldToId.has(fold)) {
						const existing = caseFoldToId.get(fold);
						errors.push(`${rel}: id '${id}' collides case-insensitively with '${existing}'.`);
					} else {
						caseFoldToId.set(fold, id);
					}
					if (idToRel.has(id)) {
						errors.push(`${rel}: Duplicate id '${id}' also used by ${idToRel.get(id)}.`);
					} else {
						idToRel.set(id, rel);
					}
				}
			}
		}

		if (docKind === 'redirect') {
			if (meta.id) {
				errors.push(`${rel}: Redirect docs must not have id.`);
			}
			if (!meta.redirect_to || typeof meta.redirect_to !== 'string') {
				errors.push(`${rel}: Redirect docs must have redirect_to: <repo-relative path>.`);
			} else {
				const redirectTo = meta.redirect_to;
				if (!redirectTo.startsWith('docs/')) {
					errors.push(`${rel}: redirect_to must start with 'docs/'. Got '${redirectTo}'.`);
				}
				if (redirectTo.includes('\\') || redirectTo.includes('elegy-copilot/')) {
					errors.push(`${rel}: redirect_to must be repo-relative (no backslashes, no elegy-copilot/ prefix).`);
				}
				const targetAbs = path.join(repoRoot, redirectTo);
				if (!fs.existsSync(targetAbs)) {
					errors.push(`${rel}: redirect_to target does not exist: ${redirectTo}`);
				} else {
					const targetRel = toPosix(path.relative(repoRoot, targetAbs));
					const targetDoc = docsByRel.get(targetRel);
					if (!targetDoc) {
						errors.push(`${rel}: redirect_to target is not in docs scan scope: ${redirectTo}`);
					} else if (targetDoc.meta.doc_kind === 'redirect') {
						errors.push(`${rel}: redirect_to target must not be doc_kind: redirect (no chains). Target: ${redirectTo}`);
					}
				}
			}
			if (doc.body.includes('[[')) {
				errors.push(`${rel}: Redirect docs must not contain wikilinks.`);
			}
		}

		if (docKind !== 'redirect' && !meta.summary) {
			warnings.push(`${rel}: Missing summary.`);
		}
	}

	// Validate related ids and wikilinks + dual-link rule
	for (const [rel, doc] of docsByRel) {
		const meta = doc.meta;
		const docKind = meta.doc_kind;
		if (docKind !== 'redirect' && meta.related) {
			if (!Array.isArray(meta.related)) {
				errors.push(`${rel}: related must be a YAML list.`);
			} else {
				for (const relatedId of meta.related) {
					if (typeof relatedId !== 'string') {
						errors.push(`${rel}: related contains a non-string id.`);
						continue;
					}
					if (!idToRel.has(relatedId)) {
						errors.push(`${rel}: related id does not resolve: ${relatedId}`);
					}
				}
			}
		}

		if (docKind === 'redirect') continue;

		const rawLines = doc.lines;
		const cleanedLines = stripFencedAndInlineCode(rawLines);
		for (let i = 0; i < cleanedLines.length; i++) {
			const line = cleanedLines[i];
			if (!line.includes('[[')) continue;
			const links = findWikiLinksInLine(line);
			if (links.length === 0) continue;

			const nextLine = i + 1 < cleanedLines.length ? cleanedLines[i + 1] : '';
			for (const link of links) {
				if (!idRegex.test(link.id)) {
					errors.push(`${rel}: Invalid wikilink syntax '${link.raw}' (must be [[id]] with kebab-case id).`);
					continue;
				}
				const targetRel = idToRel.get(link.id);
				if (!targetRel) {
					errors.push(`${rel}: Unresolved wikilink ${link.raw}`);
					continue;
				}
				const targetPath = targetRel;
				const hasMarkdownLink =
					line.includes(`(${targetPath}`) || nextLine.includes(`(${targetPath}`);
				if (!hasMarkdownLink) {
					errors.push(`${rel}: Dual-link rule violated for ${link.raw}. Missing Markdown link to (${targetPath}) on same/next line.`);
				}
			}
		}
	}

	return { errors, warnings, docCount: docsByRel.size };
}

function main() {
	const { errors, warnings, docCount } = validateDocGraph();

	if (warnings.length > 0) {
		console.warn('Warnings:');
		for (const warning of warnings) console.warn(`- ${warning}`);
		console.warn('');
	}

	if (errors.length > 0) {
		console.error('Errors:');
		for (const error of errors) console.error(`- ${error}`);
		process.exitCode = 1;
		return;
	}

	console.log(`OK: docs graph validation passed (${docCount} markdown files).`);
}

if (require.main === module) {
	main();
}

module.exports = {
	isRepoBackedPlanningArtifact,
	validateDocGraph,
};
