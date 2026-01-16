export type SkillSourceKind = 'instruction-engine' | 'target-repo';

export interface SkillEntry {
	name: string;
	path: string;
	source: SkillSourceKind;
	repoPath?: string;
	enabled?: boolean;
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

export interface AgentEntry {
	path: string;
	fileName: string;
	name: string;
	description?: string;
	role?: string;
	visibility?: string;
	infer?: boolean;
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
