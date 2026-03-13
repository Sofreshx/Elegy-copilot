import type {
  AssetCatalogLayer,
  AssetProvenance,
  AssetRepoStateOverlay,
  AssetActivationEligibility,
  EffectiveAssetState,
  InstallState
} from '@instruction-engine/contracts';

export type SkillSourceKind = 'instruction-engine' | 'target-repo';

export type SkillEntryKind = 'full' | 'pointer';

export interface CatalogBackedAssetEntry {
	assetId?: string;
	assetKey?: string;
	catalogLayer?: AssetCatalogLayer;
	installState?: InstallState;
	overlay?: AssetRepoStateOverlay;
  effectiveState?: EffectiveAssetState;
  provenance?: AssetProvenance;
  activation?: AssetActivationEligibility;
  contributingLayers?: AssetCatalogLayer[];
  hiddenFromAutoLoad?: boolean;
  overridden?: boolean;
  openPath?: string;
  provider?: string;
  sourcePackage?: string;
  namespace?: string;
  readOnly?: boolean;
}

export interface SkillEntry extends CatalogBackedAssetEntry {
	name: string;
	path: string;
	source: SkillSourceKind;
	repoPath?: string;
	enabled?: boolean;
	kind?: SkillEntryKind;
}

export interface RepoSkills {
	repoName: string;
	repoPath: string;
	skillsDirPath?: string;
	skills: SkillEntry[];
}

export interface SkillDiscoverySnapshot {
	engineRoot?: string;
	engineSkillsRoots: string[];
	availableSkills: SkillEntry[];
	targetRepos: RepoSkills[];
}

export interface TaskEntry {
	path: string;
	fileName: string;
	label: string;
	id?: string;
	type?: string;
	status?: string;
	priority?: string;
	owner?: string;
	skills?: string[];
	created?: string;
	updated?: string;
}

export interface RepoTasks {
	repoName: string;
	repoPath: string;
	isInstructionEngine: boolean;
	tasksDirPath?: string;
	tasks: TaskEntry[];
}

export interface TaskDiscoverySnapshot {
	onlyOwner: boolean;
	desiredOwner?: string;
	repos: RepoTasks[];
}

export interface AgentEntry extends CatalogBackedAssetEntry {
	path: string;
	fileName: string;
	name: string;
	description?: string;
	role?: string;
	visibility?: string;
	/** Deprecated: use `userInvocable` and `disableModelInvocation` */
	infer?: boolean;
	/** Whether the agent is visible/invocable by users (front-end). Mirrors `user-invocable` front-matter */
	userInvocable?: boolean;
	/** Deprecated alias for backward compatibility */
	userInvokable?: boolean;
	/** Whether model-level invocation is disabled. Mirrors `disable-model-invocation` front-matter */
	disableModelInvocation?: boolean;
	repoPath?: string;
	enabled?: boolean;
}

export interface RepoAgents {
	repoName: string;
	repoPath: string;
	isInstructionEngine: boolean;
	agentsDirPath?: string;
	agents: AgentEntry[];
}

export interface AgentDiscoverySnapshot {
	repos: RepoAgents[];
}

// Audit types
export type AuditType = 'deploy' | 'stack' | 'test' | 'e2e' | 'security';

export interface AuditStats {
	pass: number;
	warn: number;
	fail: number;
}

export interface AuditReport {
	type: AuditType;
	path: string;
	timestamp?: string;
	durationMs?: number;
	stats?: AuditStats;
	exists: boolean;
}
