import { createHash } from 'node:crypto';

export const ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION = '1';

export const ROADMAP_WORKFLOW_ARTIFACT_KINDS = [
	'roadmap.definition',
	'roadmap.plan.result',
	'roadmap.implementation.result',
	'roadmap.review.result',
	'roadmap.reevaluation.result',
	'roadmap.session.recap',
	'roadmap.completion.result',
] as const;

export type RoadmapWorkflowArtifactKind = typeof ROADMAP_WORKFLOW_ARTIFACT_KINDS[number];

export const ROADMAP_WORKFLOW_PHASES = [
	'definition',
	'plan',
	'implementation',
	'review',
	'reevaluation',
	'recap',
	'completion',
] as const;

export type RoadmapWorkflowPhase = typeof ROADMAP_WORKFLOW_PHASES[number];

export const ROADMAP_WORKFLOW_STATUSES = [
	'draft',
	'proposed',
	'in_progress',
	'pass',
	'fail',
	'blocked',
	'done',
	'completed',
	'cancelled',
] as const;

export type RoadmapWorkflowStatus = typeof ROADMAP_WORKFLOW_STATUSES[number];

export interface RoadmapWorkflowAcceptanceState {
	allPassed: boolean;
	failedChecks: string[];
	passedChecks?: string[];
}

export interface RoadmapWorkflowMemoryCandidate {
	kind: string;
	summary: string;
	tags?: string[];
	pathPrefixes?: string[];
	confidence?: number | null;
}

export interface RoadmapWorkflowStructuredArtifact {
	schemaVersion: typeof ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION;
	kind: RoadmapWorkflowArtifactKind;
	roadmapId: string;
	sliceId?: string;
	phase: RoadmapWorkflowPhase;
	status: RoadmapWorkflowStatus;
	repoId?: string;
	sourceHarness?: string;
	sourceModel?: string;
	sessionId?: string;
	followUps: string[];
	linkedEventIds?: string[];
	requiresUserDecision: boolean;
	suggestedNextAction?: string;
	roadmapImpact?: string;
	acceptance?: RoadmapWorkflowAcceptanceState;
	memoryCandidates?: RoadmapWorkflowMemoryCandidate[];
	metadata?: Record<string, unknown>;
}

export interface ParsedRoadmapWorkflowArtifact {
	artifact: RoadmapWorkflowStructuredArtifact;
	body: string;
	structuredBlock: string;
	checksum: string;
}

export class RoadmapWorkflowArtifactError extends Error {
	readonly code:
		| 'invalid_markdown'
		| 'missing_structured_state'
		| 'invalid_json'
		| 'invalid_artifact_kind'
		| 'invalid_artifact_shape';

	constructor(message: string, code: RoadmapWorkflowArtifactError['code']) {
		super(message);
		this.name = 'RoadmapWorkflowArtifactError';
		this.code = code;
	}
}

function normalizeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalString(value: unknown): string | undefined {
	const normalized = normalizeString(value);
	return normalized || undefined;
}

function normalizeStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.map((entry) => normalizeString(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeAcceptance(value: unknown): RoadmapWorkflowAcceptanceState | undefined {
	if (!isRecord(value)) return undefined;
	return {
		allPassed: value.allPassed === true,
		failedChecks: normalizeStringList(value.failedChecks),
		...(normalizeStringList(value.passedChecks).length > 0
			? { passedChecks: normalizeStringList(value.passedChecks) }
			: {}),
	};
}

function normalizeMemoryCandidates(value: unknown): RoadmapWorkflowMemoryCandidate[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value
		.map((entry) => {
			if (!isRecord(entry)) return null;
			const kind = normalizeString(entry.kind);
			const summary = normalizeString(entry.summary);
			if (!kind || !summary) return null;
			const confidence = entry.confidence == null ? null : Number(entry.confidence);
			return {
				kind,
				summary,
				...(normalizeStringList(entry.tags).length > 0 ? { tags: normalizeStringList(entry.tags) } : {}),
				...(normalizeStringList(entry.pathPrefixes).length > 0 ? { pathPrefixes: normalizeStringList(entry.pathPrefixes) } : {}),
				...(Number.isFinite(confidence) ? { confidence } : {}),
			};
		})
		.filter((entry): entry is RoadmapWorkflowMemoryCandidate => Boolean(entry));
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeRoadmapWorkflowStructuredArtifact(
	input: unknown,
): RoadmapWorkflowStructuredArtifact {
	if (!isRecord(input)) {
		throw new RoadmapWorkflowArtifactError('Structured state must be a JSON object', 'invalid_artifact_shape');
	}

	const kind = normalizeString(input.kind) as RoadmapWorkflowArtifactKind;
	if (!ROADMAP_WORKFLOW_ARTIFACT_KINDS.includes(kind)) {
		throw new RoadmapWorkflowArtifactError('Structured state kind is invalid', 'invalid_artifact_kind');
	}

	const phase = normalizeString(input.phase) as RoadmapWorkflowPhase;
	const status = normalizeString(input.status) as RoadmapWorkflowStatus;
	const roadmapId = normalizeString(input.roadmapId);
	const requiresUserDecision = input.requiresUserDecision === true;
	const followUps = normalizeStringList(input.followUps);

	if (!ROADMAP_WORKFLOW_PHASES.includes(phase) || !ROADMAP_WORKFLOW_STATUSES.includes(status) || !roadmapId) {
		throw new RoadmapWorkflowArtifactError('Structured state is missing required roadmap workflow fields', 'invalid_artifact_shape');
	}

	return {
		schemaVersion: ROADMAP_WORKFLOW_ARTIFACT_SCHEMA_VERSION,
		kind,
		roadmapId,
		...(normalizeOptionalString(input.sliceId) ? { sliceId: normalizeOptionalString(input.sliceId) } : {}),
		phase,
		status,
		...(normalizeOptionalString(input.repoId) ? { repoId: normalizeOptionalString(input.repoId) } : {}),
		...(normalizeOptionalString(input.sourceHarness) ? { sourceHarness: normalizeOptionalString(input.sourceHarness) } : {}),
		...(normalizeOptionalString(input.sourceModel) ? { sourceModel: normalizeOptionalString(input.sourceModel) } : {}),
		...(normalizeOptionalString(input.sessionId) ? { sessionId: normalizeOptionalString(input.sessionId) } : {}),
		followUps,
		...(normalizeStringList(input.linkedEventIds).length > 0 ? { linkedEventIds: normalizeStringList(input.linkedEventIds) } : {}),
		requiresUserDecision,
		...(normalizeOptionalString(input.suggestedNextAction) ? { suggestedNextAction: normalizeOptionalString(input.suggestedNextAction) } : {}),
		...(normalizeOptionalString(input.roadmapImpact) ? { roadmapImpact: normalizeOptionalString(input.roadmapImpact) } : {}),
		...(normalizeAcceptance(input.acceptance) ? { acceptance: normalizeAcceptance(input.acceptance) } : {}),
		...(normalizeMemoryCandidates(input.memoryCandidates) ? { memoryCandidates: normalizeMemoryCandidates(input.memoryCandidates) } : {}),
		...(isRecord(input.metadata) ? { metadata: input.metadata } : {}),
	};
}

export function computeRoadmapWorkflowArtifactChecksum(markdown: string): string {
	return createHash('sha256').update(String(markdown || ''), 'utf8').digest('hex');
}

export function parseRoadmapWorkflowMarkdownArtifact(markdown: string): ParsedRoadmapWorkflowArtifact {
	const source = String(markdown || '');
	if (!source.trim()) {
		throw new RoadmapWorkflowArtifactError('Artifact markdown is required', 'invalid_markdown');
	}

	const match = source.match(/##\s+Structured State\s*```json\s*([\s\S]*?)```/i);
	if (!match) {
		throw new RoadmapWorkflowArtifactError('Artifact is missing the Structured State JSON block', 'missing_structured_state');
	}

	const structuredBlock = String(match[1] || '').trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(structuredBlock);
	} catch {
		throw new RoadmapWorkflowArtifactError('Structured State JSON is invalid', 'invalid_json');
	}

	return {
		artifact: normalizeRoadmapWorkflowStructuredArtifact(parsed),
		body: source,
		structuredBlock,
		checksum: computeRoadmapWorkflowArtifactChecksum(source),
	};
}
