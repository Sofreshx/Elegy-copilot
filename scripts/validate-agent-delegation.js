#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'engine-assets', 'agents');
const gateName = 'Agent Delegation Topology Gate';

const writeCapableImplementationLanes = new Set([
	'impl',
]);

const reviewerLanes = new Set([
	'code-reviewer',
]);

const leafOnlyAgents = new Set([
	'search',
	'execute',
	'impl',
	'code-explorer',
	'code-reviewer',
	'test-runner',
]);

function toPosix(relativePath) {
	return relativePath.split(path.sep).join('/');
}

function walkAgentFiles(dirPath) {
	const results = [];
	const entries = fs.readdirSync(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkAgentFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.agent.md')) {
			results.push(fullPath);
		}
	}

	return results.sort((left, right) => left.localeCompare(right));
}

function matchFrontmatter(text) {
	if (!text.startsWith('---')) {
		return null;
	}

	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) {
		return null;
	}

	return { full: match[0], yaml: match[1] };
}

function stripQuotes(value) {
	return value.replace(/^['"]|['"]$/g, '');
}

function parseInlineList(value) {
	const trimmed = value.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
		return null;
	}

	const inner = trimmed.slice(1, -1).trim();
	if (!inner) {
		return [];
	}

	return inner
		.split(',')
		.map((part) => stripQuotes(part.trim()))
		.filter(Boolean);
}

function parseFrontmatter(yamlText) {
	const meta = {};
	const lines = yamlText.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const rawLine = lines[index];
		const trimmed = rawLine.trim();

		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}

		if (/^\s/.test(rawLine)) {
			continue;
		}

		const match = rawLine.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
		if (!match) {
			throw new Error(`invalid frontmatter line: ${rawLine}`);
		}

		const key = match[1];
		const rawValue = match[2].trim();

		if (Object.prototype.hasOwnProperty.call(meta, key)) {
			throw new Error(`duplicate frontmatter key: ${key}`);
		}

		if (rawValue === '') {
			const items = [];
			while (index + 1 < lines.length) {
				const nextRawLine = lines[index + 1];
				const nextTrimmed = nextRawLine.trim();

				if (!nextTrimmed) {
					index++;
					continue;
				}

				const itemMatch = nextRawLine.match(/^\s+-\s*(.*)$/);
				if (!itemMatch) {
					break;
				}

				items.push(stripQuotes(itemMatch[1].trim()));
				index++;
			}

			meta[key] = items;
			continue;
		}

		const inlineList = parseInlineList(rawValue);
		if (inlineList !== null) {
			meta[key] = inlineList;
			continue;
		}

		meta[key] = stripQuotes(rawValue);
	}

	return meta;
}

function normalizeStringList(value) {
	if (!Array.isArray(value)) {
		return null;
	}

	return value.map((item) => String(item).trim()).filter(Boolean);
}

function hasAgentTool(tools) {
	return Array.isArray(tools) && tools.some((tool) => {
		const normalized = String(tool).trim();
		return normalized === 'agent' || normalized.startsWith('agent/');
	});
}

function validateAgentDelegation(options = {}) {
	const currentRepoRoot = options.repoRoot || repoRoot;
	const currentAgentsDir = options.agentsDir || path.join(currentRepoRoot, 'engine-assets', 'agents');
	const errors = [];

	if (!fs.existsSync(currentAgentsDir) || !fs.statSync(currentAgentsDir).isDirectory()) {
		return {
			gateName,
			errors: [`missing agents directory: ${path.relative(currentRepoRoot, currentAgentsDir)}`],
		};
	}

	const agentFiles = walkAgentFiles(currentAgentsDir);
	const agentDefinitions = new Map();

	for (const filePath of agentFiles) {
		const relPath = toPosix(path.relative(currentRepoRoot, filePath));
		const content = fs.readFileSync(filePath, 'utf8');
		const frontmatter = matchFrontmatter(content);

		if (!frontmatter) {
			errors.push(`${relPath}: missing YAML frontmatter.`);
			continue;
		}

		let meta;
		try {
			meta = parseFrontmatter(frontmatter.yaml);
		} catch (error) {
			errors.push(`${relPath}: failed to parse frontmatter: ${error.message}`);
			continue;
		}

		const name = String(meta.name || path.basename(filePath, '.agent.md')).trim();
		const tools = normalizeStringList(meta.tools) || [];
		const agents = meta.agents === undefined ? undefined : normalizeStringList(meta.agents);

		agentDefinitions.set(name, {
			name,
			filePath,
			relPath,
			tools,
			agents,
			hasAgentTool: hasAgentTool(tools),
			hasAgentsField: Object.prototype.hasOwnProperty.call(meta, 'agents'),
		});
	}

	for (const definition of agentDefinitions.values()) {
		if (leafOnlyAgents.has(definition.name)) {
			if (definition.hasAgentTool) {
				let suffix = '';
				if (writeCapableImplementationLanes.has(definition.name)) {
					suffix = ' Write-capable implementation lanes must remain leaf-only.';
				} else if (reviewerLanes.has(definition.name)) {
					suffix = ' Reviewer lanes must remain leaf-only.';
				}
				errors.push(
					`${definition.relPath}: leaf agent '${definition.name}' must not declare agent tools.${suffix}`
				);
			}

			if (definition.hasAgentsField) {
				errors.push(
					`${definition.relPath}: leaf agent '${definition.name}' must not declare an agents allowlist.`
				);
			}
		}
	}

	return { gateName, errors };
}

function main() {
	const result = validateAgentDelegation();

	if (result.errors.length > 0) {
		for (const error of result.errors) {
			console.error(`${gateName} failed: ${error}`);
		}
		process.exit(1);
	}

	console.log(`${gateName} ok (${toPosix(path.relative(repoRoot, agentsDir))})`);
}

if (require.main === module) {
	main();
}

module.exports = {
	gateName,
	parseFrontmatter,
	validateAgentDelegation,
};
