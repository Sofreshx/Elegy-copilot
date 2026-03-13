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
	normalizeCatalogAssetKey,
	resolveCatalogState,
} from './catalogAdapter';
import { getRepoDisabledSet } from './enablementStore';
import { getSkillVaultDir, getUserSkillsDir, resolveStateRoot } from './enginePaths';
import { parseVaultRef } from './skillResolver';
import { discoverSkillArtifacts, resolveVaultSkillArtifact } from './skillDiscovery';
import { isPointerSkill } from './skillPointer';
import { RepoSkills, SkillDiscoverySnapshot, SkillEntry } from './types';
import { existsDir, existsFile } from './utils/fs';

const DEFAULT_HANDLED_SKILLS = new Set(['debug', 'docs', 'refactor', 'design']);

export interface SkillCatalogCandidate {
	name: string;
	assetKey: string;
	path: string;
	openPath: string;
	source: 'instruction-engine' | 'target-repo';
	repoPath: string;
	kind: 'full' | 'pointer';
	layer: 'user-installed' | 'vault-only' | 'repo-local';
	installState: NonNullable<AssetCatalogEntry['installState']>;
	metadata?: Record<string, unknown>;
	provenance?: AssetCatalogEntry['provenance'];
	activation?: AssetCatalogEntry['activation'];
}

function normalizeSkillNameFromFile(filename: string): string {
	return filename.replace(/\.md$/i, '');
}

function normalizeKey(value: string): string {
	return normalizeCatalogAssetKey(value);
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

function getSkillOpenPath(skillPath: string): string {
	if (existsFile(skillPath)) {
		return skillPath;
	}

	const skillFile = path.join(skillPath, 'SKILL.md');
	if (existsFile(skillFile)) {
		return skillFile;
	}

	const indexFile = path.join(skillPath, 'index.md');
	if (existsFile(indexFile)) {
		return indexFile;
	}

	return skillPath;
}

function createSkillCandidate(
	name: string,
	assetKey: string,
	skillPath: string,
	source: 'instruction-engine' | 'target-repo',
	repoPath: string,
	layer: 'user-installed' | 'vault-only' | 'repo-local',
	kind: 'full' | 'pointer',
	installState: NonNullable<AssetCatalogEntry['installState']>,
	metadata?: Record<string, unknown>,
	provenance?: AssetCatalogEntry['provenance'],
	activation?: AssetCatalogEntry['activation']
): SkillCatalogCandidate {
	return {
		name,
		assetKey,
		path: skillPath,
		openPath: getSkillOpenPath(skillPath),
		source,
		repoPath,
		kind,
		layer,
		installState,
		metadata,
		provenance,
		activation
	};
}

export function listSkillsInDir(
	skillsRoot: string,
	source: 'instruction-engine' | 'target-repo',
	repoPath: string,
	layer: 'user-installed' | 'vault-only' | 'repo-local',
	options?: { vaultRoot?: string }
): SkillCatalogCandidate[] {
	if (!existsDir(skillsRoot)) {
		return [];
	}

	const results: SkillCatalogCandidate[] = [];
	const discovered = discoverSkillArtifacts(skillsRoot, path.basename(skillsRoot));

	for (const candidate of discovered) {
		const skillLocation = candidate.rootPath;
		const kind = isPointerSkill(skillLocation) ? ('pointer' as const) : ('full' as const);
		const resolvedVaultArtifact =
			layer === 'user-installed' && kind === 'pointer' && options?.vaultRoot
				? resolveVaultSkillArtifact(options.vaultRoot, parseVaultRef(skillLocation) ?? '')
				: undefined;
		const identityCandidate = resolvedVaultArtifact ?? candidate;
		const provenance = inferAssetProvenance({
			kind: 'skill',
			resolvedPath: toPosixPath(safeRealpath(identityCandidate.contentPath)),
			namespace: identityCandidate.namespace,
			providers: DEFAULT_PROVIDER_CATALOG
		});
		const activation = buildProviderActivation(provenance);
		const assetKey = provenance.providerId
			? buildProviderQualifiedAssetKey('skill', identityCandidate.name, provenance)
			: identityCandidate.name;
		const installState: NonNullable<AssetCatalogEntry['installState']> = {
			availability: layer === 'repo-local' ? 'repo-local' : layer === 'vault-only' ? 'vault-only' : 'installed',
			materialization:
				layer === 'vault-only'
					? 'vault-only'
					: kind === 'pointer'
						? 'pointer'
						: 'materialized',
			loadMode: layer === 'vault-only' || kind === 'pointer' ? 'on-demand' : 'always',
			isInstalled: true,
			isAutoLoaded: layer !== 'vault-only' && kind !== 'pointer',
			sourcePath: skillLocation,
			installedPaths:
				layer === 'repo-local'
					? { 'repo-local': skillLocation }
					: layer === 'vault-only'
						? { 'vault-only': skillLocation }
						: { 'user-installed': skillLocation }
		};

		results.push(
			createSkillCandidate(
				identityCandidate.name,
				assetKey,
				skillLocation,
				source,
				repoPath,
				layer,
				kind,
				installState,
				{
					entryPath: skillLocation,
					openPath: getSkillOpenPath(skillLocation),
					kind,
					namespace: identityCandidate.namespace,
					provider: provenance.providerId,
					sourcePackage: provenance.sourcePackage,
					readOnly: provenance.readOnly,
					viewPath: candidate.viewPath
				},
				provenance,
				activation
			)
		);
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

function isInstructionEngineFolder(folder: vscode.WorkspaceFolder): boolean {
	const name = folder.name.toLowerCase();
	if (name === 'instruction-engine') {
		return true;
	}

	const folderPath = folder.uri.fsPath.replace(/\\/g, '/').toLowerCase();
	return folderPath.endsWith('/instruction-engine');
}

function getEngineSkillsRootsFromUserHome(): string[] {
	const roots: string[] = [];
	const userSkills = getUserSkillsDir();
	if (existsDir(userSkills)) {
		roots.push(userSkills);
	}

	const vaultSkills = getSkillVaultDir();
	if (existsDir(vaultSkills)) {
		roots.push(vaultSkills);
	}

	return roots;
}

function preferCandidate(
	existing: SkillCatalogCandidate,
	next: SkillCatalogCandidate
): SkillCatalogCandidate {
	const existingIsFile = existing.path.toLowerCase().endsWith('.md');
	const nextIsFile = next.path.toLowerCase().endsWith('.md');
	if (existingIsFile && !nextIsFile) {
		return next;
	}

	return existing;
}

function dedupeCandidates(entries: SkillCatalogCandidate[]): SkillCatalogCandidate[] {
	const byKey = new Map<string, SkillCatalogCandidate>();
	for (const entry of entries) {
		const key = `${normalizeKey(entry.assetKey)}::${entry.layer}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, entry);
			continue;
		}

		byKey.set(key, preferCandidate(existing, entry));
	}

	return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function toCatalogEntry(
	candidate: SkillCatalogCandidate,
	scope: ReturnType<typeof createCatalogScope>
): AssetCatalogEntry {
	return createCatalogEntry({
		kind: 'skill',
		assetKey: candidate.assetKey,
		title: candidate.name,
		layer: candidate.layer,
		scope,
		contentPath: candidate.path,
		installState: candidate.installState,
		provenance: candidate.provenance,
		activation: candidate.activation,
		metadata: {
			...candidate.metadata,
			entryPath: candidate.path,
			openPath: candidate.openPath,
			kind: candidate.kind,
			source: candidate.source
		}
	});
}

function getMetadataString(entry: AssetCatalogEntry | undefined, key: string): string | undefined {
	const value = entry?.metadata?.[key];
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function getMetadataKind(entry: AssetCatalogEntry | undefined): 'full' | 'pointer' | undefined {
	const value = entry?.metadata?.kind;
	return value === 'pointer' || value === 'full' ? value : undefined;
}

function buildSkillEntry(
	effectiveState: ReturnType<typeof resolveCatalogState>,
	fallbackSource: 'instruction-engine' | 'target-repo',
	repoPath: string | undefined
): SkillEntry | undefined {
	const selected = effectiveState.selectedEntry;
	if (!selected?.contentPath) {
		return undefined;
	}

	const pointerMaterialization = effectiveState.contributingEntries.some(
		(entry) => entry.installState?.materialization === 'pointer'
	);
	const kind = pointerMaterialization
		? 'pointer'
		: getMetadataKind(selected) ?? (effectiveState.hiddenFromAutoLoad ? 'pointer' : 'full');
	const contributingLayers = Array.from(
		new Set(effectiveState.contributingEntries.map((entry) => entry.layer))
	);

	return {
		name: selected.title,
		path: selected.contentPath,
		openPath: getMetadataString(selected, 'openPath') ?? getSkillOpenPath(selected.contentPath),
		source: selected.layer === 'repo-local' ? 'target-repo' : fallbackSource,
		repoPath,
		enabled: effectiveState.enabled,
		kind,
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

function buildEffectiveSkills(
	contentEntries: AssetCatalogEntry[],
	scope: ReturnType<typeof createCatalogScope>,
	disabledSet: Set<string>,
	fallbackSource: 'instruction-engine' | 'target-repo',
	repoPath: string | undefined
): SkillEntry[] {
	const results: SkillEntry[] = [];
	const grouped = groupEntriesByAssetKey(contentEntries);

	for (const [assetKey, entries] of grouped) {
		const catalogEntries = [...entries];
		if (disabledSet.has(assetKey)) {
			catalogEntries.push(createRepoOverlayEntry('skill', assetKey, scope, false));
		}

		const skill = buildSkillEntry(resolveCatalogState(catalogEntries), fallbackSource, repoPath);
		if (skill) {
			results.push(skill);
		}
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export function buildRepoSkills(
	globalEntriesByKey: Map<string, AssetCatalogEntry[]>,
	repoEntries: AssetCatalogEntry[],
	repoScope: ReturnType<typeof createCatalogScope>,
	disabledSet: Set<string>,
	fallbackSource: 'instruction-engine' | 'target-repo',
	repoPath: string | undefined
): SkillEntry[] {
	const results: SkillEntry[] = [];
	const repoEntriesByKey = groupEntriesByAssetKey(repoEntries);
	const assetKeys = new Set<string>([
		...globalEntriesByKey.keys(),
		...repoEntriesByKey.keys()
	]);

	for (const assetKey of assetKeys) {
		const catalogEntries = [
			...(globalEntriesByKey.get(assetKey) ?? []),
			...(repoEntriesByKey.get(assetKey) ?? [])
		];
		if (disabledSet.has(assetKey)) {
			catalogEntries.push(createRepoOverlayEntry('skill', assetKey, repoScope, false));
		}

		const skill = buildSkillEntry(resolveCatalogState(catalogEntries), fallbackSource, repoPath);
		if (skill) {
			results.push(skill);
		}
	}

	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

export async function scanSkills(): Promise<SkillDiscoverySnapshot> {
	const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
	const showDefaultHandled = vscode.workspace
		.getConfiguration()
		.get<boolean>('skillInstaller.skills.showDefaultHandled', false);
	const includeSkill = (skill: SkillEntry): boolean =>
		showDefaultHandled || !DEFAULT_HANDLED_SKILLS.has(normalizeKey(skill.name));

	const engineRoot = resolveStateRoot();
	const engineSkillsRoots = getEngineSkillsRootsFromUserHome();
	const userScope = createCatalogScope('user', engineRoot);
	const globalDisabled = getRepoDisabledSet('skills', engineRoot);
	const userSkillsRoot = getUserSkillsDir();
	const vaultSkillsRoot = getSkillVaultDir();
	const globalCandidates = dedupeCandidates(
		[
			...listSkillsInDir(userSkillsRoot, 'instruction-engine', engineRoot, 'user-installed', {
				vaultRoot: vaultSkillsRoot
			}),
			...listSkillsInDir(vaultSkillsRoot, 'instruction-engine', engineRoot, 'vault-only')
		]
	);
	const globalContentEntries = globalCandidates.map((candidate) =>
		toCatalogEntry(candidate, userScope)
	);
	const globalEntriesByKey = groupEntriesByAssetKey(globalContentEntries);
	const availableSkills = buildEffectiveSkills(
		globalContentEntries,
		userScope,
		globalDisabled,
		'instruction-engine',
		engineRoot
	).filter(includeSkill);

	const targetRepos: RepoSkills[] = [];

	for (const folder of workspaceFolders) {
		if (isInstructionEngineFolder(folder)) {
			continue;
		}

		const repoPath = folder.uri.fsPath;
		const skillsDir = path.join(repoPath, '.github', 'skills');
		const disabledSet = getRepoDisabledSet('skills', repoPath);
		const repoScope = createCatalogScope('repo', repoPath, folder.name);
		const repoCandidates = dedupeCandidates(
			listSkillsInDir(skillsDir, 'target-repo', repoPath, 'repo-local')
		);
		const repoEntries = repoCandidates.map((candidate) => toCatalogEntry(candidate, repoScope));
		targetRepos.push({
			repoName: folder.name,
			repoPath,
			skillsDirPath: existsDir(skillsDir) ? skillsDir : undefined,
			skills: buildRepoSkills(
				globalEntriesByKey,
				repoEntries,
				repoScope,
				disabledSet,
				'target-repo',
				repoPath
			).filter(includeSkill)
		});
	}

	targetRepos.sort((a, b) => a.repoName.localeCompare(b.repoName));

	return {
		engineRoot,
		engineSkillsRoots,
		availableSkills,
		targetRepos
	};
}
