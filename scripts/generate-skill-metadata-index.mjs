#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { repoRoot } from './lib/cli-utils.mjs';

const skillsRoot = path.join(repoRoot, 'engine-assets', 'skills');
const manifestPath = path.join(repoRoot, 'engine-assets', 'manifest.json');
const outputPath = path.join(skillsRoot, 'skill-metadata-index.json');

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

function parseFrontmatterMetadata(frontmatter) {
	const rawValue = readFrontmatterValue(frontmatter, ['metadata']);
	if (!rawValue) return {};

	try {
		const parsed = JSON.parse(rawValue);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
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

function collectManifestSkillMetadata(manifest) {
	const map = new Map();
	const assets = Array.isArray(manifest?.assets) ? manifest.assets : [];

	for (const asset of assets) {
		if (!asset || asset.type !== 'skill') continue;
		const source = String(asset.source || '').replace(/\\/g, '/');
		const match = source.match(/^engine-assets\/skills\/([^/]+)$/);
		if (!match) continue;

		const skillKey = match[1];
		map.set(skillKey, {
			id: String(asset.id || ''),
			loadMode: String(asset.loadMode || ''),
		});
	}

	return map;
}

function generateIndex() {
	const manifest = readJson(manifestPath);
	const manifestSkills = collectManifestSkillMetadata(manifest);

	const skillDirs = fs
		.readdirSync(skillsRoot)
		.filter((entry) => isDirectory(path.join(skillsRoot, entry)))
		.filter((entry) => fs.existsSync(path.join(skillsRoot, entry, 'SKILL.md')))
		.sort((a, b) => a.localeCompare(b));

	const skills = skillDirs.map((skillKey) => {
		const skillPath = path.join(skillsRoot, skillKey, 'SKILL.md');
		const content = readText(skillPath);
		const frontmatter = extractFrontmatter(content);
		const metadata = parseFrontmatterMetadata(frontmatter);
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

	fs.writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
	return index;
}

const index = generateIndex();
console.log(`Generated skill metadata index: ${path.relative(repoRoot, outputPath)} (skills=${index.entries.length})`);
