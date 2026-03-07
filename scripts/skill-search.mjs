#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'engine-assets', 'skills', 'skill-metadata-index.json');

function loadIndex() {
	if (!fs.existsSync(indexPath)) {
		console.error(`Index not found: ${indexPath}`);
		process.exit(1);
	}
	return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
}

function scoreEntry(entry, query) {
	const q = query.toLowerCase();

	if (entry.name.toLowerCase() === q) return { score: 100, reason: 'exact-name' };
	if (entry.skill.toLowerCase() === q) return { score: 100, reason: 'exact-skill' };
	if (entry.name.toLowerCase().includes(q)) return { score: 50, reason: 'name-contains' };
	if (entry.skill.toLowerCase().includes(q)) return { score: 50, reason: 'skill-contains' };

	for (const trigger of entry.triggersOn || []) {
		if (trigger.toLowerCase().includes(q)) return { score: 30, reason: 'trigger-contains' };
	}

	if (entry.description && entry.description.toLowerCase().includes(q)) {
		return { score: 10, reason: 'description-contains' };
	}

	return { score: 0, reason: '' };
}

function search(index, query) {
	if (!query) {
		return index.entries.map((e) => ({ ...e, score: 0, reason: 'all' }));
	}

	const results = [];
	for (const entry of index.entries) {
		const { score, reason } = scoreEntry(entry, query);
		if (score > 0) {
			results.push({ ...entry, score, reason });
		}
	}

	results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
	return results;
}

function formatHuman(results) {
	if (results.length === 0) {
		console.log('No matching skills found.');
		return;
	}
	for (const r of results) {
		const vaultRef = `${r.skill}/SKILL.md`;
		console.log(`${r.name}  ${vaultRef}  (${r.reason}, score=${r.score})`);
	}
}

function formatJson(results) {
	const output = results.map((r) => ({
		name: r.name,
		skill: r.skill,
		description: r.description,
		vaultRef: `${r.skill}/SKILL.md`,
		score: r.score,
		reason: r.reason,
	}));
	console.log(JSON.stringify(output, null, 2));
}

// --- CLI ---
const args = process.argv.slice(2);
const jsonFlag = args.includes('--json');
const queryArgs = args.filter((a) => a !== '--json');
const query = queryArgs.join(' ').trim();

const index = loadIndex();
const results = search(index, query);

if (jsonFlag) {
	formatJson(results);
} else {
	formatHuman(results);
}

export { search, scoreEntry, loadIndex };
