#!/usr/bin/env node
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { searchSkills } = require('../copilot-ui/lib/skillSearchService');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function takeValue(args, index, flag) {
	const value = args[index + 1];
	if (value == null || value.startsWith('--')) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

function collectRepeatedValues(args, flag) {
	const values = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== flag) {
			continue;
		}
		values.push(takeValue(args, index, flag));
		index += 1;
	}
	return values;
}

function parseArgs(argv) {
	const args = [...argv];
	const jsonFlag = args.includes('--json');
	const noTelemetry = args.includes('--no-telemetry');
	const frameworks = collectRepeatedValues(args, '--framework');
	const stacks = collectRepeatedValues(args, '--stack');
	const languages = collectRepeatedValues(args, '--language');
	const tags = collectRepeatedValues(args, '--tag');

	let repoPath;
	let workspaceId;
	let workspacePath;
	let preferLoadMode;
	let limit;
	const queryParts = [];

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (
			value === '--json' ||
			value === '--no-telemetry' ||
			value === '--framework' ||
			value === '--stack' ||
			value === '--language' ||
			value === '--tag'
		) {
			if (
				value === '--framework' ||
				value === '--stack' ||
				value === '--language' ||
				value === '--tag'
			) {
				index += 1;
			}
			continue;
		}
		if (value === '--repo') {
			repoPath = takeValue(args, index, value);
			index += 1;
			continue;
		}
		if (value === '--workspace') {
			workspaceId = takeValue(args, index, value);
			index += 1;
			continue;
		}
		if (value === '--workspace-path') {
			workspacePath = takeValue(args, index, value);
			index += 1;
			continue;
		}
		if (value === '--prefer-load-mode') {
			preferLoadMode = takeValue(args, index, value);
			index += 1;
			continue;
		}
		if (value === '--limit') {
			limit = Number.parseInt(takeValue(args, index, value), 10);
			index += 1;
			continue;
		}
		if (value.startsWith('--')) {
			throw new Error(`Unknown flag: ${value}`);
		}
		queryParts.push(value);
	}

	return {
		jsonFlag,
		noTelemetry,
		query: queryParts.join(' ').trim(),
		repoPath,
		workspaceId,
		workspacePath,
		frameworks,
		stacks,
		languages,
		tags,
		preferLoadMode,
		limit: Number.isFinite(limit) ? limit : undefined,
	};
}

function formatHuman(results) {
	if (results.length === 0) {
		console.log('No matching skills found.');
		return;
	}
	for (const result of results) {
		const vaultRef = `${result.skill}/SKILL.md`;
		const reasonSummary = result.reasons.length ? result.reasons.join(', ') : 'all';
		console.log(`${result.name}  ${vaultRef}  (${reasonSummary}, score=${result.score})`);
	}
}

function formatJson(results) {
	console.log(JSON.stringify(results, null, 2));
}

function serializeResult(result) {
	return {
		name: result.effectiveState.assetKey,
		skill: result.effectiveState.assetKey,
		description: result.entry.description,
		vaultRef: `${result.effectiveState.assetKey}/SKILL.md`,
		score: result.score,
		reason: result.explanations[0]?.code || '',
		reasons: result.explanations.map((item) => item.code),
		explanations: result.explanations,
		selectedLayer: result.effectiveState.selectedLayer,
		loadMode: result.effectiveState.installState?.loadMode,
	};
}

try {
	const parsed = parseArgs(process.argv.slice(2));
	const response = searchSkills(
		{
			query: parsed.query,
			repoPath: parsed.repoPath,
			workspaceId: parsed.workspaceId,
			workspacePath: parsed.workspacePath,
			frameworks: parsed.frameworks,
			stacks: parsed.stacks,
			languages: parsed.languages,
			tags: parsed.tags,
			preferLoadMode: parsed.preferLoadMode,
			limit: parsed.limit,
		},
		{
			engineRoot: repoRoot,
			repoPath: parsed.repoPath,
			persistTelemetry: !parsed.noTelemetry,
		},
	);
	const results = response.results.map(serializeResult);

	if (parsed.jsonFlag) {
		formatJson(results);
	} else {
		formatHuman(results);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}

export { parseArgs, serializeResult, searchSkills };
