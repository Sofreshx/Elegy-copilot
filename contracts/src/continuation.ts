export const CONTINUATION_PACKAGE_CONTRACT_VERSION = 'continuation_package_v1';

export const CONTINUATION_TARGET_HARNESSES = [
	'copilot',
	'codex',
	'opencode',
	'antigravity',
] as const;

export type ContinuationTargetHarness = typeof CONTINUATION_TARGET_HARNESSES[number];

export type ContinuationSourceKind = 'session' | 'planning.workflow-artifact';

export interface ContinuationPackageSource {
	kind: ContinuationSourceKind;
	sessionId?: string | null;
	artifactId?: string | null;
	harness?: string | null;
	model?: string | null;
	sessionSource?: string | null;
}

export interface ContinuationPackageRepoContext {
	repoId?: string | null;
	repoPath?: string | null;
	repoLabel?: string | null;
	branch?: string | null;
}

export interface ContinuationPackageRoadmapContext {
	roadmapId?: string | null;
	roadmapIds?: string[];
	sliceId?: string | null;
	planRef?: string | null;
	linkedBacklogIds?: string[];
}

export interface ContinuationPackageTranscriptEntry {
	role: 'user' | 'assistant';
	content: string;
	createdAt?: string | null;
}

export interface ContinuationPackagePrompt {
	title: string;
	text: string;
}

export interface ContinuationPackage {
	contractVersion: typeof CONTINUATION_PACKAGE_CONTRACT_VERSION;
	kind: 'session.continuation-package' | 'planning.workflow-artifact.continuation-package';
	deterministic: true;
	targetHarness: ContinuationTargetHarness;
	source: ContinuationPackageSource;
	repo: ContinuationPackageRepoContext | null;
	roadmap: ContinuationPackageRoadmapContext | null;
	objective?: string | null;
	summary?: string | null;
	constraints: string[];
	openQuestions: string[];
	nextActions: string[];
	carryover: string[];
	skillsRequired: string[];
	sourceArtifacts: string[];
	transcriptExcerpt: ContinuationPackageTranscriptEntry[];
	prompt: ContinuationPackagePrompt;
}
