#!/usr/bin/env node
import { createRequire } from 'module';
import { repoRoot } from './lib/cli-utils.mjs';

const require = createRequire(import.meta.url);
const { searchSkills } = require('../copilot-ui/lib/skillSearchService');

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
	// Normalize --flag=value to separate --flag value entries so both forms work uniformly.
	const args = [];
	for (const a of argv) {
		if (a.startsWith('--') && a.includes('=')) {
			const eqIdx = a.indexOf('=');
			args.push(a.slice(0, eqIdx), a.slice(eqIdx + 1));
		} else {
			args.push(a);
		}
	}

	const jsonFlag = args.includes('--json');
	const noTelemetry = args.includes('--no-telemetry');
	const showHelp = args.includes('--help');
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
			value === '--help' ||
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
		showHelp,
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

	if (parsed.showHelp) {
		console.log(`Usage: skill-search.mjs [flags] [query...]

Flags:
  --json                      Output results as JSON
  --no-telemetry              Skip telemetry persistence
  --repo <path>               Path to the target repository
  --workspace <id>            Workspace ID
  --workspace-path <path>     Workspace path
  --prefer-load-mode <mode>   Preferred load mode
  --limit <n>                 Maximum number of results
  --framework <name>          Filter by framework (repeatable)
  --stack <name>              Filter by stack (repeatable)
  --language <name>           Filter by language (repeatable)
  --tag <name>                Filter by tag (repeatable)
  --help                      Show this help message

Both --flag value and --flag=value forms are supported.`);
		process.exit(0);
	}

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
