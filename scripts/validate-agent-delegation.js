#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const agentsDir = path.join(repoRoot, 'engine-assets', 'agents');
const gateName = 'Agent Delegation Topology Gate';

const approvedCoordinatorConfigs = new Map([
	[
		'orchestrator',
		{
			optional: false,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
	[
		'orchestrator-cli',
		{
			optional: true,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
	[
		'orchestrator-claude',
		{
			optional: true,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
	[
		'orchestrator-claude-cli',
		{
			optional: true,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
	[
		'orchestrator-gpt',
		{
			optional: true,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
	[
		'orchestrator-gpt-cli',
		{
			optional: true,
			allowedDelegates: null,
			allowedApprovedDelegates: new Set(),
		},
	],
]);

const writeCapableImplementationLanes = new Set([
	'impl',
]);

const reviewerLanes = new Set([
	'code-reviewer',
	'reviewer-gpt-5-4',
	'reviewer-sonnet-4-6',
]);

const manifestValidationTargets = [
	'.cli/manifest.json',
	'engine-assets/manifest.json',
];
const rootCoordinatorNamesForManifestValidation = ['orchestrator', 'orchestrator-cli', 'orchestrator-claude', 'orchestrator-claude-cli', 'orchestrator-gpt', 'orchestrator-gpt-cli'];

const requiredDefaultOrchestratorBaseAssetIds = [
	'agent-orchestrator',
	'skill-planning-feature',
	'skill-planpack-authoring',
];

const requiredOrchestratorSupportAssetIdsByDelegate = new Map([
	['test-runner', ['skill-e2e-workflow']],
]);

const sharedUserGlobalOrchestratorBundleId = 'repo-setup-governance-global';
const sharedUserGlobalOrchestratorAssetIds = new Set([
	'skill-repo-setup-governance',
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

function hasWildcardDelegate(agents) {
	return Array.isArray(agents) && agents.some((agent) => String(agent).includes('*'));
}

function formatAgentList(agents) {
	return agents.slice().sort().join(', ');
}

function readJsonFile(filePath) {
	return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toAgentAssetId(agentName) {
	return agentName.startsWith('agent-') ? agentName : `agent-${agentName}`;
}

function collectRequiredDefaultOrchestratorAssetIds(agentDefinitions, errors) {
	const requiredAssetIds = new Set(requiredDefaultOrchestratorBaseAssetIds);

	for (const coordinatorName of rootCoordinatorNamesForManifestValidation) {
		const coordinatorDefinition = agentDefinitions.get(coordinatorName);
		const coordinatorConfig = approvedCoordinatorConfigs.get(coordinatorName);

		if (!coordinatorDefinition) {
			if (!coordinatorConfig?.optional) {
				errors.push(`engine-assets/agents: missing required ${coordinatorName}.agent.md definition.`);
			}
			continue;
		}

		requiredAssetIds.add(toAgentAssetId(coordinatorName));

		if (!Array.isArray(coordinatorDefinition.agents) || coordinatorDefinition.agents.length === 0) {
			errors.push(
				`${coordinatorDefinition.relPath}: root coordinator '${coordinatorName}' must declare a non-empty agents allowlist for manifest validation.`
			);
			continue;
		}

		for (const delegateName of coordinatorDefinition.agents) {
			requiredAssetIds.add(toAgentAssetId(delegateName));

			for (const supportAssetId of requiredOrchestratorSupportAssetIdsByDelegate.get(delegateName) || []) {
				requiredAssetIds.add(supportAssetId);
			}
		}
	}

	return requiredAssetIds;
}

function collectReachableBundleAssetIds(bundleId, bundlesById, manifestRelPath, errors, activeBundleIds = new Set()) {
	if (activeBundleIds.has(bundleId)) {
		errors.push(`${manifestRelPath}: bundle dependency cycle detected while resolving '${bundleId}'.`);
		return new Set();
	}

	const bundle = bundlesById.get(bundleId);
	if (!bundle) {
		errors.push(`${manifestRelPath}: missing bundle '${bundleId}'.`);
		return new Set();
	}

	const reachableAssetIds = new Set(Array.isArray(bundle.assetIds) ? bundle.assetIds : []);
	const nextActiveBundleIds = new Set(activeBundleIds);
	nextActiveBundleIds.add(bundleId);

	for (const dependencyId of Array.isArray(bundle.dependsOn) ? bundle.dependsOn : []) {
		const dependencyAssetIds = collectReachableBundleAssetIds(
			dependencyId,
			bundlesById,
			manifestRelPath,
			errors,
			nextActiveBundleIds
		);
		for (const assetId of dependencyAssetIds) {
			reachableAssetIds.add(assetId);
		}
	}

	return reachableAssetIds;
}

function validateDefaultOrchestratorBundleReachability(currentRepoRoot, agentDefinitions, errors) {
	const requiredDefaultOrchestratorAssetIds = collectRequiredDefaultOrchestratorAssetIds(agentDefinitions, errors);

	for (const manifestRelPath of manifestValidationTargets) {
		const manifestPath = path.join(currentRepoRoot, ...manifestRelPath.split('/'));
		if (!fs.existsSync(manifestPath)) {
			errors.push(`${manifestRelPath}: missing manifest file.`);
			continue;
		}

		let manifest;
		try {
			manifest = readJsonFile(manifestPath);
		} catch (error) {
			errors.push(`${manifestRelPath}: failed to parse JSON: ${error.message}`);
			continue;
		}

		const bundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
		const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
		const bundlesById = new Map(bundles.map((bundle) => [bundle.id, bundle]));
		const assetIds = new Set(assets.map((asset) => asset.id));
		const reachableAssetIds = collectReachableBundleAssetIds(
			'orchestrator-workflow',
			bundlesById,
			manifestRelPath,
			errors
		);
		const sharedReachableAssetIds = Array.from(requiredDefaultOrchestratorAssetIds).some((assetId) => sharedUserGlobalOrchestratorAssetIds.has(assetId))
			? collectReachableBundleAssetIds(
				sharedUserGlobalOrchestratorBundleId,
				bundlesById,
				manifestRelPath,
				errors
			)
			: new Set();

		for (const assetId of requiredDefaultOrchestratorAssetIds) {
			if (!assetIds.has(assetId)) {
				errors.push(`${manifestRelPath}: missing required asset definition '${assetId}'.`);
				continue;
			}

			const isNarrowSharedException = sharedUserGlobalOrchestratorAssetIds.has(assetId);
			const isReachable = isNarrowSharedException
				? reachableAssetIds.has(assetId) || sharedReachableAssetIds.has(assetId)
				: reachableAssetIds.has(assetId);

			if (!isReachable) {
				errors.push(
					isNarrowSharedException
						? `${manifestRelPath}: required shared exception asset '${assetId}' must be reachable from 'orchestrator-workflow' or '${sharedUserGlobalOrchestratorBundleId}'.`
						: `${manifestRelPath}: bundle 'orchestrator-workflow' must reach required default orchestrator asset '${assetId}'.`
				);
			}
		}
	}
}

function validateAllowedDelegates(agentDefinition, config, knownCoordinatorNames, errors) {
	const { name, relPath, agents } = agentDefinition;

	if (!Array.isArray(agents)) {
		errors.push(`${relPath}: approved coordinator '${name}' must declare an explicit agents allowlist.`);
		return;
	}

	if (agents.length === 0) {
		errors.push(`${relPath}: approved coordinator '${name}' must not declare an empty agents allowlist.`);
	}

	if (hasWildcardDelegate(agents)) {
		errors.push(`${relPath}: approved coordinator '${name}' must not use wildcard delegates.`);
	}

	const uniqueAgents = new Set(agents);
	if (uniqueAgents.size !== agents.length) {
		errors.push(`${relPath}: approved coordinator '${name}' must not repeat delegate names in agents.`);
	}

	if (config.allowedDelegates) {
		const actualDelegates = new Set(agents);
		for (const delegate of actualDelegates) {
			if (!config.allowedDelegates.has(delegate)) {
				errors.push(
					`${relPath}: approved coordinator '${name}' may only delegate to ${formatAgentList([...config.allowedDelegates])}; found '${delegate}'.`
				);
			}
		}

		for (const requiredDelegate of config.allowedDelegates) {
			if (!actualDelegates.has(requiredDelegate)) {
				errors.push(
					`${relPath}: approved coordinator '${name}' must include delegate '${requiredDelegate}' in its explicit allowlist.`
				);
			}
		}
	}

	for (const delegate of agents) {
		if (delegate === name) {
			errors.push(`${relPath}: approved coordinator '${name}' must not delegate to itself.`);
			continue;
		}

		if (name === 'orchestrator' || name === 'orchestrator-cli' || name === 'orchestrator-claude' || name === 'orchestrator-claude-cli' || name === 'orchestrator-gpt' || name === 'orchestrator-gpt-cli') {
			if (knownCoordinatorNames.has(delegate) && !config.allowedApprovedDelegates.has(delegate)) {
				errors.push(
					`${relPath}: root coordinator '${name}' may only delegate to approved coordinators ${formatAgentList([...config.allowedApprovedDelegates])}; found '${delegate}'.`
				);
			}
			continue;
		}

		if (knownCoordinatorNames.has(delegate)) {
			errors.push(
				`${relPath}: approved coordinator '${name}' must delegate only to leaf agents in V1; found coordinator '${delegate}'.`
			);
		}
	}
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

	const knownCoordinatorNames = new Set(approvedCoordinatorConfigs.keys());

	for (const [coordinatorName, config] of approvedCoordinatorConfigs.entries()) {
		if (!agentDefinitions.has(coordinatorName)) {
			if (!config.optional) {
				errors.push(`engine-assets/agents: missing required approved coordinator file '${coordinatorName}.agent.md'.`);
			}
			continue;
		}

		const definition = agentDefinitions.get(coordinatorName);
		if (!definition.hasAgentTool) {
			errors.push(`${definition.relPath}: approved coordinator '${coordinatorName}' must declare an agent tool.`);
		}

		if (!definition.hasAgentsField) {
			errors.push(`${definition.relPath}: approved coordinator '${coordinatorName}' must declare an explicit agents allowlist.`);
		}

		validateAllowedDelegates(definition, config, knownCoordinatorNames, errors);
	}

	for (const definition of agentDefinitions.values()) {
		if (approvedCoordinatorConfigs.has(definition.name)) {
			continue;
		}

		if (definition.hasAgentTool) {
			let suffix = '';
			if (writeCapableImplementationLanes.has(definition.name)) {
				suffix = ' Write-capable implementation lanes must remain leaf-only in V1.';
			} else if (reviewerLanes.has(definition.name)) {
				suffix = ' Reviewer lanes must remain leaf-only in V1.';
			}

			errors.push(
				`${definition.relPath}: '${definition.name}' is not an approved coordinator and must not declare agent tools.${suffix}`
			);
		}

		if (definition.hasAgentsField) {
			errors.push(
				`${definition.relPath}: '${definition.name}' is not an approved coordinator and must not declare an agents allowlist.`
			);
		}
	}

	validateDefaultOrchestratorBundleReachability(currentRepoRoot, agentDefinitions, errors);

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
