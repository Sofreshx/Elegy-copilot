#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

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

function parseFrontmatterValue(frontmatter, key) {
	const regex = new RegExp(`^${key}:\\s*(.+)$`, 'm');
	const match = frontmatter.match(regex);
	if (!match) return '';
	const value = match[1].trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1).trim();
	}
	return value;
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
		const name = parseFrontmatterValue(frontmatter, 'name') || skillKey;
		const description = parseFrontmatterValue(frontmatter, 'description');
		const triggersOn = extractTriggers(content, description);
		const manifestMeta = manifestSkills.get(skillKey);

		return {
			skill: skillKey,
			name,
			description,
			triggersOn,
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
