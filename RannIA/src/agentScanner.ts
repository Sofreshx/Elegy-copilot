import * as fs from 'fs';
import * as path from 'path';
import {
	type AssetCatalogEntry,
	DEFAULT_PROVIDER_CATALOG,
	buildProviderQualifiedAssetKey,
	inferAssetProvenance,
} from '@instruction-engine/contracts';
import * as vscode from 'vscode';
import {
	createCatalogEntry,
	createCatalogScope,
	createRepoOverlayEntry,
	groupEntriesByAssetKey,
	resolveCatalogState,
} from './catalogAdapter';
import { getRepoDisabledSet } from './enablementStore';
import { getUserAgentsDir, resolveStateRoot } from './enginePaths';
import { AgentDiscoverySnapshot, AgentEntry, RepoAgents } from './types';
import { existsDir, existsFile } from './utils/fs';
import { normalizeString } from './utils/strings';
import { tryParseYamlFrontMatter } from './utils/yaml';

interface ParsedAgentCandidate {
	path: string;
	openPath: string;
	fileName: string;
	name: string;
	assetKey: string;
	description?: string;
	role?: string;
	visibility?: string;
	infer?: boolean;
	userInvocable?: boolean;
	disableModelInvocation?: boolean;
	source: 'instruction-engine' | 'target-repo';
	repoPath: string;
	layer: 'user-installed' | 'repo-local';
	installState: NonNullable<AssetCatalogEntry['installState']>;
	provenance?: AssetCatalogEntry['provenance'];
	activation?: AssetCatalogEntry['activation'];
}

function isInstructionEngineFolder(folder: vscode.WorkspaceFolder): boolean {
	const name = folder.name.toLowerCase();
	if (name === 'instruction-engine') {
		return true;
	}

	const folderPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	return folderPath.endsWith('/instruction-engine');
}

function readFileStart(filePath: string, maxBytes = 64_000): string {
	const fd = fs.openSync(filePath, 'r');
	try {
		const buffer = Buffer.allocUnsafe(maxBytes);
		const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
		return buffer.subarray(0, bytesRead).toString('utf8');
	} finally {
		fs.closeSync(fd);
	}
}

function normalizeBoolean(value: unknown): boolean | undefined {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value !== 'string') {
		return undefined;
	}
	const s = value.trim().toLowerCase();
	if (s === 'true') {
		return true;
	}
	if (s === 'false') {
		return false;
	}
	return undefined;
}

function normalizeKey(value: string): string {
	return value.trim().toLowerCase();
}

function safeRealpath(absPath: string): string {
	try {
		if (typeof fs.realpathSync.native === 'function') {
			return fs.realpathSync.native(absPath);
		}
		return fs.realpathSync(absPath);
	} catch {
		return path.resolve(absPath);
	}
}

function toPosixPath(inputPath: string): string {
	return String(inputPath || '').replace(/\\/g, '/');
}

function buildProviderActivation(provenance: AssetCatalogEntry['provenance']): AssetCatalogEntry['activation'] {
	const provider = DEFAULT_PROVIDER_CATALOG.providers.find(
		(candidate) => candidate.id === provenance?.providerId
	);
	if (!provider?.activationDefaults) {
		return undefined;
	}
	const defaults = provider.activationDefaults;
	return {
		eligible: true,
		scope: defaults.scope,
		repoOverrides: defaults.repoOverrides,
		plannerProfile: defaults.plannerProfile,
		orchestrationPolicy: defaults.orchestrationPolicy,
		defaultBundles:
			Array.isArray(defaults.defaultBundles) && defaults.defaultBundles.length > 0
				? defaults.defaultBundles
				: Array.isArray(provider.defaultBundles)
					? provider.defaultBundles
					: undefined,
		preferredLoadMode: defaults.preferredLoadMode
	};
}

function extractImportedProviderNamespace(fileName: string): string | undefined {
	const match = fileName.match(/^providers--(.+?)--.+(?:\.agent)?\.md$/i);
	return match?.[1]?.trim().toLowerCase() || undefined;
}

function listAgentFiles(agentsDir: string): string[] {
	if (!existsDir(agentsDir)) {
		return [];
	}

	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		const lower = entry.name.toLowerCase();
		if (!lower.endsWith('.md') || lower.endsWith('.prompt.md')) {
			continue;
		}
		files.push(path.join(agentsDir, entry.name));
	}

	files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
	return files;
}

function parseAgentCandidate(
	filePath: string,
	source: 'instruction-engine' | 'target-repo',
	repoPath: string,
	layer: 'user-installed' | 'repo-local'
): ParsedAgentCandidate | undefined {
	if (!existsFile(filePath)) {
		return undefined;
	}

	const contentStart = readFileStart(filePath);
	const fm = tryParseYamlFrontMatter(contentStart)?.fm ?? {};
	const fileName = path.basename(filePath);
	const lowerFileName = fileName.toLowerCase();
	const isAgentMarkdown = lowerFileName.endsWith('.agent.md');
	const bodyText = contentStart.replace(/^---[\s\S]*?\r?\n---\r?\n?/, '').trim();
	if (!isAgentMarkdown && !(normalizeString(fm['name']) && bodyText)) {
		return undefined;
	}

	const rawInfer = fm['infer'];
	let inferStr: string | undefined;
	if (typeof rawInfer === 'boolean') {
		inferStr = rawInfer ? 'true' : 'false';
	} else if (typeof rawInfer === 'string') {
		inferStr = rawInfer.trim().toLowerCase();
	}

	const userInvocable =
		normalizeBoolean(fm['user-invocable']) ??
		normalizeBoolean(fm['user-invokable']) ??
		(inferStr === 'true' || inferStr === 'user');

	let disableModelInvocation = normalizeBoolean(fm['disable-model-invocation']);
	if (disableModelInvocation === undefined) {
		disableModelInvocation = inferStr === 'agent' ? false : true;
	}

	const namespace = extractImportedProviderNamespace(fileName);
	const provenance = inferAssetProvenance({
		kind: 'agent',
		resolvedPath: toPosixPath(safeRealpath(filePath)),
		namespace,
		fileKind: isAgentMarkdown ? 'agent-md' : 'plain-md',
		providers: DEFAULT_PROVIDER_CATALOG
	});
	const assetKey = provenance.providerId
		? buildProviderQualifiedAssetKey('agent', normalizeString(fm['name']) ?? fileName, provenance)
		: fileName;
	const activation = buildProviderActivation(provenance);

	return {
		path: filePath,
		openPath: filePath,
		fileName,
		name: normalizeString(fm['name']) ?? fileName,
		assetKey,
		description: normalizeString(fm['description']),
		role: normalizeString(fm['role']),
		visibility: normalizeString(fm['visibility']),
		infer: normalizeBoolean(fm['infer']),
		userInvocable,
		disableModelInvocation,
		source,
		repoPath,
		layer,
		installState: {
			availability: layer === 'repo-local' ? 'repo-local' : 'installed',
			materialization: 'materialized',
			isInstalled: true,
			sourcePath: filePath,
			installedPaths:
				layer === 'repo-local'
					? { 'repo-local': filePath }
					: { 'user-installed': filePath }
		},
		provenance,
		activation
	};
}

function toCatalogEntry(
	candidate: ParsedAgentCandidate,
	scope: ReturnType<typeof createCatalogScope>
): AssetCatalogEntry {
	return createCatalogEntry({
		kind: 'agent',
		assetKey: candidate.assetKey,
		title: candidate.name,
		description: candidate.description,
		layer: candidate.layer,
		scope,
		contentPath: candidate.path,
		installState: candidate.installState,
		provenance: candidate.provenance,
		activation: candidate.activation,
		metadata: {
			fileName: candidate.fileName,
			path: candidate.path,
			openPath: candidate.openPath,
			role: candidate.role,
			visibility: candidate.visibility,
			infer: candidate.infer,
			userInvocable: candidate.userInvocable,
			disableModelInvocation: candidate.disableModelInvocation,
			source: candidate.source,
			provider: candidate.provenance?.providerId,
			sourcePackage: candidate.provenance?.sourcePackage,
			namespace: candidate.provenance?.namespace,
			readOnly: candidate.provenance?.readOnly
		}
	});
}

function getMetadataString(entry: AssetCatalogEntry | undefined, key: string): string | undefined {
	const value = entry?.metadata?.[key];
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function getMetadataBoolean(entry: AssetCatalogEntry | undefined, key: string): boolean | undefined {
	const value = entry?.metadata?.[key];
	return typeof value === 'boolean' ? value : undefined;
}

function buildAgentEntry(
	effectiveState: ReturnType<typeof resolveCatalogState>,
	repoPath: string
): AgentEntry | undefined {
	const selected = effectiveState.selectedEntry;
	if (!selected?.contentPath) {
		return undefined;
	}

	const contributingLayers = Array.from(
		new Set(effectiveState.contributingEntries.map((entry) => entry.layer))
	);
	const fileName = getMetadataString(selected, 'fileName') ?? path.basename(selected.contentPath);

	return {
		path: selected.contentPath,
		openPath: getMetadataString(selected, 'openPath') ?? selected.contentPath,
		fileName,
		name: selected.title,
		description: selected.description,
		role: getMetadataString(selected, 'role'),
		visibility: getMetadataString(selected, 'visibility'),
		infer: getMetadataBoolean(selected, 'infer'),
		userInvocable: getMetadataBoolean(selected, 'userInvocable'),
		userInvokable: getMetadataBoolean(selected, 'userInvocable'),
		disableModelInvocation: getMetadataBoolean(selected, 'disableModelInvocation'),
		repoPath,
		enabled: effectiveState.enabled,
		assetId: effectiveState.assetId,
		assetKey: effectiveState.assetKey,
		catalogLayer: effectiveState.selectedLayer,
		installState: effectiveState.installState,
		provenance: effectiveState.provenance,
		activation: effectiveState.activation,
		overlay: effectiveState.overlay,
		effectiveState,
		contributingLayers,
		hiddenFromAutoLoad: effectiveState.hiddenFromAutoLoad,
		overridden: effectiveState.overridden,
		provider: effectiveState.provenance?.providerId,
		sourcePackage: effectiveState.provenance?.sourcePackage,
		namespace: effectiveState.provenance?.namespace,
		readOnly: effectiveState.provenance?.readOnly
	};
}

function buildEffectiveAgents(
	contentEntries: AssetCatalogEntry[],
	scope: ReturnType<typeof createCatalogScope>,
	disabledSet: Set<string>,
	repoPath: string
): AgentEntry[] {
	const results: AgentEntry[] = [];
	const grouped = groupEntriesByAssetKey(contentEntries);

	for (const [assetKey, entries] of grouped) {
		const catalogEntries = [...entries];
		if (disabledSet.has(assetKey)) {
			catalogEntries.push(createRepoOverlayEntry('agent', assetKey, scope, false));
		}

		const agent = buildAgentEntry(resolveCatalogState(catalogEntries), repoPath);
		if (agent) {
			results.push(agent);
		}
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export function buildRepoAgents(
	userEntriesByKey: Map<string, AssetCatalogEntry[]>,
	repoEntries: AssetCatalogEntry[],
	repoScope: ReturnType<typeof createCatalogScope>,
	disabledSet: Set<string>,
	repoPath: string
): AgentEntry[] {
	const repoEntriesByKey = groupEntriesByAssetKey(repoEntries);
	const assetKeys = new Set<string>([
		...userEntriesByKey.keys(),
		...repoEntriesByKey.keys()
	]);
	const agents: AgentEntry[] = [];

	for (const assetKey of assetKeys) {
		const catalogEntries = [
			...(userEntriesByKey.get(assetKey) ?? []),
			...(repoEntriesByKey.get(assetKey) ?? [])
		];
		if (disabledSet.has(assetKey)) {
			catalogEntries.push(createRepoOverlayEntry('agent', assetKey, repoScope, false));
		}

		const agent = buildAgentEntry(resolveCatalogState(catalogEntries), repoPath);
		if (agent) {
			agents.push(agent);
		}
	}

	agents.sort((a, b) => a.name.localeCompare(b.name));
	return agents;
}

export async function scanAgents(): Promise<AgentDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const repos: RepoAgents[] = [];

	const userRoot = resolveStateRoot();
	const userAgentsDir = getUserAgentsDir();
	const userAgentsDirPath = existsDir(userAgentsDir) ? userAgentsDir : undefined;
	const userDisabledSet = getRepoDisabledSet('agents', userRoot);
	const userScope = createCatalogScope('user', userRoot);
	const userCandidates = (userAgentsDirPath ? listAgentFiles(userAgentsDirPath) : [])
		.map((filePath) => parseAgentCandidate(filePath, 'instruction-engine', userRoot, 'user-installed'))
		.filter((candidate): candidate is ParsedAgentCandidate => Boolean(candidate));
	const userEntries = userCandidates.map((candidate) => toCatalogEntry(candidate, userScope));
	const userEntriesByKey = groupEntriesByAssetKey(userEntries);

	repos.push({
		repoName: 'User Asset Home',
		repoPath: userRoot,
		isInstructionEngine: false,
		agentsDirPath: userAgentsDirPath,
		agents: buildEffectiveAgents(userEntries, userScope, userDisabledSet, userRoot)
	});

	for (const folder of workspaceFolders) {
		const repoPath = folder.uri.fsPath;
		const agentsDir = path.join(repoPath, '.github', 'agents');
		const agentsDirPath = existsDir(agentsDir) ? agentsDir : undefined;
		const disabledSet = getRepoDisabledSet('agents', repoPath);
		const repoScope = createCatalogScope('repo', repoPath, folder.name);
		const repoCandidates = (agentsDirPath ? listAgentFiles(agentsDirPath) : [])
			.map((filePath) => parseAgentCandidate(filePath, 'target-repo', repoPath, 'repo-local'))
			.filter((candidate): candidate is ParsedAgentCandidate => Boolean(candidate));
		const repoEntries = repoCandidates.map((candidate) => toCatalogEntry(candidate, repoScope));
		repos.push({
			repoName: folder.name,
			repoPath,
			isInstructionEngine: isInstructionEngineFolder(folder),
			agentsDirPath,
			agents: buildRepoAgents(userEntriesByKey, repoEntries, repoScope, disabledSet, repoPath)
		});
	}

	repos.sort((a, b) => {
		if (a.repoPath === userRoot) return -1;
		if (b.repoPath === userRoot) return 1;
		return a.repoName.localeCompare(b.repoName);
	});
	return { repos };
}
