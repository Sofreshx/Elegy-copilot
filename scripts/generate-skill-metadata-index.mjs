#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');
const defaultSkillsRoot = path.join(defaultRepoRoot, 'engine-assets', 'skills');
const defaultManifestPath = path.join(defaultRepoRoot, 'engine-assets', 'manifest.json');
const defaultOutputPath = path.join(defaultSkillsRoot, 'skill-metadata-index.json');

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
	return fs.readFileSync(filePath, 'utf8');
}

function isDirectory(filePath) {
	return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory();
}

function extractFrontmatter(content) {
	if (!content.startsWith('---')) return '';
	const lines = content.split(/\r?\n/);
	if (lines.length < 3) return '';
	if (lines[0].trim() !== '---') return '';

	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '---') {
			return lines.slice(1, i).join('\n');
		}
	}

	return '';
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readFrontmatterValue(frontmatter, keys) {
	for (const key of keys) {
		const regex = new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm');
		const match = frontmatter.match(regex);
		if (!match) continue;
		return match[1].trim();
	}
	return '';
}

function unquoteValue(value) {
	const trimmed = String(value || '').trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function parseFrontmatterValue(frontmatter, key) {
	return unquoteValue(readFrontmatterValue(frontmatter, [key]));
}

function normalizeListValues(values) {
	const normalized = new Set();
	for (const value of Array.isArray(values) ? values : [values]) {
		for (const candidate of splitInlineList(value)) {
			const cleaned = normalizeListValue(candidate);
			if (cleaned) normalized.add(cleaned);
		}
	}
	return Array.from(normalized).sort((a, b) => a.localeCompare(b));
}

function parseFrontmatterMetadata(frontmatter, skillPath) {
	const metadataMatch = frontmatter.match(/^metadata:(.*)$/m);
	if (!metadataMatch) return {};

	const rawValue = metadataMatch[1].trim();
	const supportedFormat = 'metadata must be a same-line JSON object, for example metadata: {"aliasKeys":["x"]}';
	if (!rawValue) {
		throw new Error(`${skillPath}: ${supportedFormat}`);
	}

	let parsed;
	try {
		parsed = JSON.parse(rawValue);
	} catch (error) {
		throw new Error(`${skillPath}: invalid metadata JSON: ${error.message}. ${supportedFormat}`);
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${skillPath}: ${supportedFormat}`);
	}

	return parsed;
}

function splitInlineList(rawValue) {
	const trimmed = String(rawValue || '').trim();
	if (!trimmed) return [];

	const source = trimmed.startsWith('[') && trimmed.endsWith(']')
		? trimmed.slice(1, -1)
		: trimmed;

	const values = [];
	let current = '';
	let quote = '';

	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (quote) {
			if (char === quote) {
				quote = '';
				continue;
			}
			current += char;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === ',') {
			values.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	values.push(current);
	return values;
}

function normalizeListValue(value) {
	return unquoteValue(value)
		.replace(/\s+/g, ' ')
		.toLowerCase();
}

function parseFrontmatterList(frontmatter, key, fallbackKeys = []) {
	const rawValue = readFrontmatterValue(frontmatter, [key, ...fallbackKeys]);
	if (!rawValue) return [];
	return normalizeListValues(rawValue);
}

function normalizeTrigger(raw) {
	const cleaned = raw
		.trim()
		.replace(/^[-*]\s*/, '')
		.replace(/^["'`]+/, '')
		.replace(/["'`]+$/, '');

	const sentenceBoundary = cleaned.indexOf('. ');
	const trimmedSentence = sentenceBoundary >= 0 ? cleaned.slice(0, sentenceBoundary) : cleaned;

	return trimmedSentence.replace(/\.$/, '').toLowerCase();
}

function extractTriggers(content, description) {
	const result = new Set();
	const scanTargets = [content, description].filter(Boolean);

	for (const target of scanTargets) {
		const pattern = /Triggers on:\s*([^\n]+)/gi;
		let match;
		while ((match = pattern.exec(target)) !== null) {
			const line = match[1];
			for (const token of line.split(',')) {
				const normalized = normalizeTrigger(token);
				if (normalized) result.add(normalized);
			}
		}
	}

	return Array.from(result).sort((a, b) => a.localeCompare(b));
}

function readNonEmptyManifestValue(asset, fieldName, skillKey) {
	const value = String(asset?.[fieldName] ?? '').trim();
	if (!value) {
		throw new Error(`skill manifest entry '${skillKey}' has empty ${fieldName}`);
	}
	return value;
}

export function collectManifestSkillMetadata(manifest) {
	const map = new Map();
	const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];

	for (const asset of assets) {
		if (!asset || asset.type !== 'skill') continue;
		const source = String(asset.source || '').replace(/\\/g, '/');
		const match = source.match(/^engine-assets\/skills\/([^/]+)$/);
		if (!match) continue;

		const skillKey = match[1];
		map.set(skillKey, {
			id: readNonEmptyManifestValue(asset, 'id', skillKey),
			loadMode: readNonEmptyManifestValue(asset, 'loadMode', skillKey),
		});
	}

	return map;
}

export function generateIndex(options = {}) {
	const {
		write = true,
		repoRoot = defaultRepoRoot,
		skillsRoot = path.join(repoRoot, 'engine-assets', 'skills'),
		manifestPath = path.join(repoRoot, 'engine-assets', 'manifest.json'),
		outputPath = path.join(skillsRoot, 'skill-metadata-index.json'),
	} = options;
	const manifest = readJson(manifestPath);
	const manifestSkills = collectManifestSkillMetadata(manifest);

	const skillDirs = fs
		.readdirSync(skillsRoot)
		.filter((entry) => isDirectory(path.join(skillsRoot, entry)))
		.filter((entry) => fs.existsSync(path.join(skillsRoot, entry, 'SKILL.md')))
		.sort((a, b) => a.localeCompare(b));

	const skills = skillDirs.map((skillKey) => {
		const skillPath = path.join(skillsRoot, skillKey, 'SKILL.md');
		const displaySkillPath = path.relative(repoRoot, skillPath).replace(/\\/g, '/');
		const content = readText(skillPath);
		const frontmatter = extractFrontmatter(content);
		const metadata = parseFrontmatterMetadata(frontmatter, displaySkillPath);
		const name = parseFrontmatterValue(frontmatter, 'name') || skillKey;
		const description = parseFrontmatterValue(frontmatter, 'description');
		const triggersOn = extractTriggers(content, description);
		const aliasKeys = normalizeListValues(metadata.aliasKeys || parseFrontmatterList(frontmatter, 'aliasKeys', ['aliases']));
		const frameworks = normalizeListValues(metadata.frameworks || parseFrontmatterList(frontmatter, 'frameworks'));
		const stacks = normalizeListValues(metadata.stacks || parseFrontmatterList(frontmatter, 'stacks'));
		const languages = normalizeListValues(metadata.languages || parseFrontmatterList(frontmatter, 'languages'));
		const tags = normalizeListValues(metadata.tags || metadata.keywords || parseFrontmatterList(frontmatter, 'tags', ['keywords']));
		const manifestMeta = manifestSkills.get(skillKey);

		return {
			skill: skillKey,
			name,
			description,
			triggersOn,
			...(aliasKeys.length ? { aliasKeys } : {}),
			...(frameworks.length ? { frameworks } : {}),
			...(stacks.length ? { stacks } : {}),
			...(languages.length ? { languages } : {}),
			...(tags.length ? { tags } : {}),
			...(manifestMeta ? { manifest: manifestMeta } : {}),
		};
	});

	const index = {
		schemaVersion: 1,
		entries: skills,
	};

	if (write) {
		fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
	}
	return index;
}

const isMainModule = process.argv[1]
	? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
	: false;

if (isMainModule) {
	const index = generateIndex();
	console.log(`Generated skill metadata index: ${path.relative(defaultRepoRoot, defaultOutputPath)} (skills=${index.entries.length})`);
}
