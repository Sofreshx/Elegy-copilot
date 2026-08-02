import { createHash } from 'node:crypto';

export const SESSION_RETROSPECTIVE_V1_SCHEMA_VERSION = '1' as const;
export const SESSION_RETROSPECTIVE_SCHEMA_VERSION = '2' as const;
export const SESSION_RETROSPECTIVE_SCHEMA_VERSIONS = [
	SESSION_RETROSPECTIVE_V1_SCHEMA_VERSION,
	SESSION_RETROSPECTIVE_SCHEMA_VERSION,
] as const;
export const SESSION_RETROSPECTIVE_V1_CONTRACT_VERSION = 'session-retrospective-v1' as const;
export const SESSION_RETROSPECTIVE_CONTRACT_VERSION = 'session-retrospective-v2' as const;
export const SESSION_RETROSPECTIVE_ARTIFACT_SCHEMA_VERSION = SESSION_RETROSPECTIVE_SCHEMA_VERSION;

export const SESSION_RETROSPECTIVE_KINDS = [
	'session.retrospective.single',
	'session.retrospective.aggregate',
] as const;
export type SessionRetrospectiveKind = typeof SESSION_RETROSPECTIVE_KINDS[number];

export const SESSION_RETROSPECTIVE_COMPLETENESS = ['complete', 'partial', 'unavailable'] as const;
export type SessionRetrospectiveCompleteness = typeof SESSION_RETROSPECTIVE_COMPLETENESS[number];

export const SESSION_RETROSPECTIVE_PERSPECTIVES = ['self_report', 'observed'] as const;
export type SessionRetrospectivePerspective = typeof SESSION_RETROSPECTIVE_PERSPECTIVES[number];

export const SESSION_RETROSPECTIVE_CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;
export type SessionRetrospectiveConfidence = typeof SESSION_RETROSPECTIVE_CONFIDENCE[number];

export const SESSION_RETROSPECTIVE_SIGNAL_KEYS = [
	'planning_overhead',
	'authority_duplication',
	'context_loss',
	'tool_friction',
	'handoff_friction',
	'validation_friction',
	'coordination_friction',
	'scope_drift',
	'feedback_gap',
	'other',
] as const;
export type SessionRetrospectiveSignalKey = typeof SESSION_RETROSPECTIVE_SIGNAL_KEYS[number];

export const SESSION_RETROSPECTIVE_CUSTOMIZATION_STATUSES = [
	'active',
	'available',
	'policy_blocked',
	'unsupported',
	'unavailable',
	'unknown',
] as const;
export type SessionRetrospectiveCustomizationStatus = typeof SESSION_RETROSPECTIVE_CUSTOMIZATION_STATUSES[number];

export const SESSION_RETROSPECTIVE_CUSTOMIZATION_SCOPES = [
	'turn',
	'global',
	'repo',
	'subtree',
	'user_local',
	'workspace_managed',
	'product',
] as const;
export type SessionRetrospectiveCustomizationScope = typeof SESSION_RETROSPECTIVE_CUSTOMIZATION_SCOPES[number];

export const SESSION_RETROSPECTIVE_CUSTOMIZATION_OWNERS = [
	'user',
	'repo',
	'workspace_admin',
	'host_integration',
	'openai',
] as const;
export type SessionRetrospectiveCustomizationOwner = typeof SESSION_RETROSPECTIVE_CUSTOMIZATION_OWNERS[number];

export const SESSION_RETROSPECTIVE_IMPROVEMENT_ACTIONS = [
	'add',
	'modify',
	'remove',
	'configure',
	'enable',
	'disable',
	'observe',
	'escalate',
] as const;
export type SessionRetrospectiveImprovementAction = typeof SESSION_RETROSPECTIVE_IMPROVEMENT_ACTIONS[number];

export const SESSION_RETROSPECTIVE_IMPROVEMENT_AUTOMATION = [
	'manual',
	'advisory',
	'enforced',
	'scheduled',
] as const;
export type SessionRetrospectiveImprovementAutomation = typeof SESSION_RETROSPECTIVE_IMPROVEMENT_AUTOMATION[number];

export const SESSION_RETROSPECTIVE_IMPROVEMENT_FEASIBILITY = [
	'direct',
	'requires_approval',
	'requires_integration',
	'unsupported',
] as const;
export type SessionRetrospectiveImprovementFeasibility = typeof SESSION_RETROSPECTIVE_IMPROVEMENT_FEASIBILITY[number];

export interface SessionRetrospectiveSource {
	harness: 'codex';
	taskIds: string[];
	repoIds: string[];
	completeness: SessionRetrospectiveCompleteness;
}

export interface SessionRetrospectiveAssessment {
	signalKey: SessionRetrospectiveSignalKey;
	summary: string;
	perspective: SessionRetrospectivePerspective;
	confidence: SessionRetrospectiveConfidence;
	evidenceRefs: string[];
}

export interface SessionRetrospectiveImprovementCandidate {
	candidateId: string;
	signalKey: SessionRetrospectiveSignalKey;
	proposal: string;
	rationale: string;
	targetSurface: string;
	confidence: SessionRetrospectiveConfidence;
	evidenceRefs: string[];
	status: 'proposed';
}

export interface SessionRetrospectiveCustomizationInventoryEntry {
	surface: string;
	status: SessionRetrospectiveCustomizationStatus;
	scope: SessionRetrospectiveCustomizationScope;
	owner: SessionRetrospectiveCustomizationOwner;
	evidenceRefs: string[];
	limitations: string[];
}

export interface SessionRetrospectiveImprovementTarget {
	surface: string;
	scope: SessionRetrospectiveCustomizationScope;
	owner: SessionRetrospectiveCustomizationOwner;
	action: SessionRetrospectiveImprovementAction;
	automation: SessionRetrospectiveImprovementAutomation;
	feasibility: SessionRetrospectiveImprovementFeasibility;
}

export interface SessionRetrospectiveV2ImprovementCandidate {
	candidateId: string;
	signalKey: SessionRetrospectiveSignalKey;
	proposal: string;
	target: SessionRetrospectiveImprovementTarget;
	whyThisSurface: string;
	alternativesRejected: string[];
	expectedImpact: string;
	risks: string[];
	validation: string[];
	confidence: SessionRetrospectiveConfidence;
	evidenceRefs: string[];
	status: 'proposed';
}

export interface SessionRetrospectiveUncertainty {
	biggestMissing: string | null;
	leastConfident: string | null;
}

export interface SessionRetrospectiveChild {
	retrospectiveId: string;
	taskId: string;
	checksum: string;
}

export interface SessionRetrospectiveRepeatedSignal {
	signalKey: SessionRetrospectiveSignalKey;
	count: number;
	taskIds: string[];
}

export interface SessionRetrospectiveStructuredArtifactBase {
	schemaVersion: typeof SESSION_RETROSPECTIVE_V1_SCHEMA_VERSION;
	kind: SessionRetrospectiveKind;
	retrospectiveId: string;
	generatedAt: string;
	source: SessionRetrospectiveSource;
	recap: {
		summary: string;
		delivered: string[];
		requested: string[];
	};
	strengths: SessionRetrospectiveAssessment[];
	frictions: SessionRetrospectiveAssessment[];
	improvementCandidates: SessionRetrospectiveImprovementCandidate[];
	uncertainty: SessionRetrospectiveUncertainty;
	requiresUserDecision: boolean;
}

export interface SessionRetrospectiveV2StructuredArtifactBase extends Omit<
	SessionRetrospectiveStructuredArtifactBase,
	'schemaVersion' | 'improvementCandidates'
> {
	schemaVersion: typeof SESSION_RETROSPECTIVE_SCHEMA_VERSION;
	customizationInventory: SessionRetrospectiveCustomizationInventoryEntry[];
	improvementCandidates: SessionRetrospectiveV2ImprovementCandidate[];
}

export interface SessionRetrospectiveSingleArtifact extends SessionRetrospectiveStructuredArtifactBase {
	kind: 'session.retrospective.single';
}

export interface SessionRetrospectiveAggregateArtifact extends SessionRetrospectiveStructuredArtifactBase {
	kind: 'session.retrospective.aggregate';
	children: SessionRetrospectiveChild[];
	repeatedSignals: SessionRetrospectiveRepeatedSignal[];
}

export interface SessionRetrospectiveV2SingleArtifact extends SessionRetrospectiveV2StructuredArtifactBase {
	kind: 'session.retrospective.single';
}

export interface SessionRetrospectiveV2AggregateArtifact extends SessionRetrospectiveV2StructuredArtifactBase {
	kind: 'session.retrospective.aggregate';
	children: SessionRetrospectiveChild[];
	repeatedSignals: SessionRetrospectiveRepeatedSignal[];
}

export type SessionRetrospectiveStructuredArtifact =
	| SessionRetrospectiveSingleArtifact
	| SessionRetrospectiveAggregateArtifact
	| SessionRetrospectiveV2SingleArtifact
	| SessionRetrospectiveV2AggregateArtifact;

export interface ParsedSessionRetrospectiveArtifact {
	artifact: SessionRetrospectiveStructuredArtifact;
	body: string;
	structuredBlock: string;
	checksum: string;
}

export type SessionRetrospectiveContractErrorCode =
	| 'invalid_markdown'
	| 'missing_structured_state'
	| 'invalid_json'
	| 'invalid_artifact_kind'
	| 'invalid_artifact_shape';

export class SessionRetrospectiveContractError extends Error {
	readonly code: SessionRetrospectiveContractErrorCode;

	constructor(message: string, code: SessionRetrospectiveContractErrorCode) {
		super(message);
		this.name = 'SessionRetrospectiveContractError';
		this.code = code;
	}
}

/** Compatibility alias following the roadmap artifact error naming convention. */
export { SessionRetrospectiveContractError as SessionRetrospectiveArtifactError };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, fieldName: string): string {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (!normalized) throw new SessionRetrospectiveContractError(`${fieldName} is required`, 'invalid_artifact_shape');
	return normalized;
}

function optionalNullableString(value: unknown, fieldName: string): string | null {
	if (value === null) return null;
	if (typeof value === 'string') return value.trim() || null;
	throw new SessionRetrospectiveContractError(`${fieldName} must be a string or null`, 'invalid_artifact_shape');
}

function sortedStrings(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value)) throw new SessionRetrospectiveContractError(`${fieldName} must be an array`, 'invalid_artifact_shape');
	const result = [...new Set(value.map((entry) => {
		if (typeof entry !== 'string') throw new SessionRetrospectiveContractError(`${fieldName} must contain strings`, 'invalid_artifact_shape');
		return entry.trim();
	}).filter(Boolean))];
	return result.sort((left, right) => left.localeCompare(right));
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fieldName: string): T[number] {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (!values.includes(normalized)) throw new SessionRetrospectiveContractError(`${fieldName} is invalid`, 'invalid_artifact_shape');
	return normalized as T[number];
}

function dedupeSort<T>(entries: T[], key: (entry: T) => string): T[] {
	const unique = new Map<string, T>();
	for (const entry of entries) unique.set(key(entry), entry);
	return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry);
}

function normalizeAssessment(value: unknown, fieldName: string): SessionRetrospectiveAssessment {
	if (!isRecord(value)) throw new SessionRetrospectiveContractError(`${fieldName} must be an object`, 'invalid_artifact_shape');
	const result: SessionRetrospectiveAssessment = {
		signalKey: enumValue(value.signalKey, SESSION_RETROSPECTIVE_SIGNAL_KEYS, `${fieldName}.signalKey`),
		summary: requiredString(value.summary, `${fieldName}.summary`),
		perspective: enumValue(value.perspective, SESSION_RETROSPECTIVE_PERSPECTIVES, `${fieldName}.perspective`),
		confidence: enumValue(value.confidence, SESSION_RETROSPECTIVE_CONFIDENCE, `${fieldName}.confidence`),
		evidenceRefs: sortedStrings(value.evidenceRefs, `${fieldName}.evidenceRefs`),
	};
	return result;
}

function normalizeCandidate(value: unknown, fieldName: string): SessionRetrospectiveImprovementCandidate {
	if (!isRecord(value)) throw new SessionRetrospectiveContractError(`${fieldName} must be an object`, 'invalid_artifact_shape');
	return {
		candidateId: requiredString(value.candidateId, `${fieldName}.candidateId`),
		signalKey: enumValue(value.signalKey, SESSION_RETROSPECTIVE_SIGNAL_KEYS, `${fieldName}.signalKey`),
		proposal: requiredString(value.proposal, `${fieldName}.proposal`),
		rationale: requiredString(value.rationale, `${fieldName}.rationale`),
		targetSurface: requiredString(value.targetSurface, `${fieldName}.targetSurface`),
		confidence: enumValue(value.confidence, SESSION_RETROSPECTIVE_CONFIDENCE, `${fieldName}.confidence`),
		evidenceRefs: sortedStrings(value.evidenceRefs, `${fieldName}.evidenceRefs`),
		status: enumValue(value.status, ['proposed'] as const, `${fieldName}.status`),
	};
}

function normalizeCustomizationInventoryEntry(value: unknown, fieldName: string): SessionRetrospectiveCustomizationInventoryEntry {
	if (!isRecord(value)) throw new SessionRetrospectiveContractError(`${fieldName} must be an object`, 'invalid_artifact_shape');
	return {
		surface: requiredString(value.surface, `${fieldName}.surface`),
		status: enumValue(value.status, SESSION_RETROSPECTIVE_CUSTOMIZATION_STATUSES, `${fieldName}.status`),
		scope: enumValue(value.scope, SESSION_RETROSPECTIVE_CUSTOMIZATION_SCOPES, `${fieldName}.scope`),
		owner: enumValue(value.owner, SESSION_RETROSPECTIVE_CUSTOMIZATION_OWNERS, `${fieldName}.owner`),
		evidenceRefs: sortedStrings(value.evidenceRefs, `${fieldName}.evidenceRefs`),
		limitations: sortedStrings(value.limitations, `${fieldName}.limitations`),
	};
}

function normalizeV2Candidate(value: unknown, fieldName: string): SessionRetrospectiveV2ImprovementCandidate {
	if (!isRecord(value)) throw new SessionRetrospectiveContractError(`${fieldName} must be an object`, 'invalid_artifact_shape');
	if (!isRecord(value.target)) throw new SessionRetrospectiveContractError(`${fieldName}.target must be an object`, 'invalid_artifact_shape');
	const target = value.target;
	return {
		candidateId: requiredString(value.candidateId, `${fieldName}.candidateId`),
		signalKey: enumValue(value.signalKey, SESSION_RETROSPECTIVE_SIGNAL_KEYS, `${fieldName}.signalKey`),
		proposal: requiredString(value.proposal, `${fieldName}.proposal`),
		target: {
			surface: requiredString(target.surface, `${fieldName}.target.surface`),
			scope: enumValue(target.scope, SESSION_RETROSPECTIVE_CUSTOMIZATION_SCOPES, `${fieldName}.target.scope`),
			owner: enumValue(target.owner, SESSION_RETROSPECTIVE_CUSTOMIZATION_OWNERS, `${fieldName}.target.owner`),
			action: enumValue(target.action, SESSION_RETROSPECTIVE_IMPROVEMENT_ACTIONS, `${fieldName}.target.action`),
			automation: enumValue(target.automation, SESSION_RETROSPECTIVE_IMPROVEMENT_AUTOMATION, `${fieldName}.target.automation`),
			feasibility: enumValue(target.feasibility, SESSION_RETROSPECTIVE_IMPROVEMENT_FEASIBILITY, `${fieldName}.target.feasibility`),
		},
		whyThisSurface: requiredString(value.whyThisSurface, `${fieldName}.whyThisSurface`),
		alternativesRejected: sortedStrings(value.alternativesRejected, `${fieldName}.alternativesRejected`),
		expectedImpact: requiredString(value.expectedImpact, `${fieldName}.expectedImpact`),
		risks: sortedStrings(value.risks, `${fieldName}.risks`),
		validation: sortedStrings(value.validation, `${fieldName}.validation`),
		confidence: enumValue(value.confidence, SESSION_RETROSPECTIVE_CONFIDENCE, `${fieldName}.confidence`),
		evidenceRefs: sortedStrings(value.evidenceRefs, `${fieldName}.evidenceRefs`),
		status: enumValue(value.status, ['proposed'] as const, `${fieldName}.status`),
	};
}

function normalizeChildren(value: unknown): SessionRetrospectiveChild[] {
	if (!Array.isArray(value)) throw new SessionRetrospectiveContractError('children must be an array', 'invalid_artifact_shape');
	return dedupeSort(value.map((entry, index) => {
		if (!isRecord(entry)) throw new SessionRetrospectiveContractError(`children[${index}] must be an object`, 'invalid_artifact_shape');
		return {
			retrospectiveId: requiredString(entry.retrospectiveId, `children[${index}].retrospectiveId`),
			taskId: requiredString(entry.taskId, `children[${index}].taskId`),
			checksum: requiredString(entry.checksum, `children[${index}].checksum`),
		};
	}), (entry) => `${entry.retrospectiveId}\u0000${entry.taskId}\u0000${entry.checksum}`);
}

function assertAggregateReferences(
	children: SessionRetrospectiveChild[],
	repeatedSignals: SessionRetrospectiveRepeatedSignal[],
	taskIds: string[],
): void {
	const selectedTaskIds = new Set(taskIds);
	const childTaskIds = children.map((child) => child.taskId);
	if (new Set(childTaskIds).size !== childTaskIds.length) {
		throw new SessionRetrospectiveContractError('Aggregate children must reference distinct task ids', 'invalid_artifact_shape');
	}
	if (children.length !== taskIds.length || childTaskIds.some((taskId) => !selectedTaskIds.has(taskId))) {
		throw new SessionRetrospectiveContractError('Aggregate children must cover exactly source.taskIds', 'invalid_artifact_shape');
	}
	const childRetrospectiveIds = children.map((child) => child.retrospectiveId);
	if (new Set(childRetrospectiveIds).size !== childRetrospectiveIds.length) {
		throw new SessionRetrospectiveContractError('Aggregate children must reference distinct retrospective ids', 'invalid_artifact_shape');
	}
	for (const repeatedSignal of repeatedSignals) {
		if (repeatedSignal.taskIds.some((taskId) => !selectedTaskIds.has(taskId))) {
			throw new SessionRetrospectiveContractError('Repeated signal task ids must be selected aggregate task ids', 'invalid_artifact_shape');
		}
	}
}

function normalizeRepeatedSignals(value: unknown): SessionRetrospectiveRepeatedSignal[] {
	if (!Array.isArray(value)) throw new SessionRetrospectiveContractError('repeatedSignals must be an array', 'invalid_artifact_shape');
	return dedupeSort(value.map((entry, index) => {
		if (!isRecord(entry)) throw new SessionRetrospectiveContractError(`repeatedSignals[${index}] must be an object`, 'invalid_artifact_shape');
		const count = entry.count;
		if (typeof count !== 'number' || !Number.isInteger(count) || count < 2) {
			throw new SessionRetrospectiveContractError(`repeatedSignals[${index}].count must be an integer >= 2`, 'invalid_artifact_shape');
		}
		const taskIds = sortedStrings(entry.taskIds, `repeatedSignals[${index}].taskIds`);
		if (taskIds.length < 2) {
			throw new SessionRetrospectiveContractError(`repeatedSignals[${index}].taskIds must contain at least two task ids`, 'invalid_artifact_shape');
		}
		if (count !== taskIds.length) {
			throw new SessionRetrospectiveContractError(`repeatedSignals[${index}].count must match taskIds length`, 'invalid_artifact_shape');
		}
		return {
			signalKey: enumValue(entry.signalKey, SESSION_RETROSPECTIVE_SIGNAL_KEYS, `repeatedSignals[${index}].signalKey`),
			count,
			taskIds,
		};
	}), (entry) => `${entry.signalKey}\u0000${entry.count}\u0000${entry.taskIds.join('\u0000')}`);
}

export function normalizeSessionRetrospectiveStructuredArtifact(input: unknown): SessionRetrospectiveStructuredArtifact {
	if (!isRecord(input)) throw new SessionRetrospectiveContractError('Structured state must be a JSON object', 'invalid_artifact_shape');
	const rawKind = typeof input.kind === 'string' ? input.kind.trim() : '';
	if (!SESSION_RETROSPECTIVE_KINDS.includes(rawKind as SessionRetrospectiveKind)) {
		throw new SessionRetrospectiveContractError('kind is invalid', 'invalid_artifact_kind');
	}
	const kind = rawKind as SessionRetrospectiveKind;
	const schemaVersion = enumValue(input.schemaVersion, SESSION_RETROSPECTIVE_SCHEMA_VERSIONS, 'schemaVersion');
	if (!isRecord(input.source)) throw new SessionRetrospectiveContractError('source must be an object', 'invalid_artifact_shape');
	if (!isRecord(input.recap)) throw new SessionRetrospectiveContractError('recap must be an object', 'invalid_artifact_shape');
	if (!isRecord(input.uncertainty)) throw new SessionRetrospectiveContractError('uncertainty must be an object', 'invalid_artifact_shape');
	if (typeof input.requiresUserDecision !== 'boolean') throw new SessionRetrospectiveContractError('requiresUserDecision must be a boolean', 'invalid_artifact_shape');
	if (!Array.isArray(input.strengths)) throw new SessionRetrospectiveContractError('strengths must be an array', 'invalid_artifact_shape');
	if (!Array.isArray(input.frictions)) throw new SessionRetrospectiveContractError('frictions must be an array', 'invalid_artifact_shape');
	if (!Array.isArray(input.improvementCandidates)) throw new SessionRetrospectiveContractError('improvementCandidates must be an array', 'invalid_artifact_shape');

	const common = {
		kind,
		retrospectiveId: requiredString(input.retrospectiveId, 'retrospectiveId'),
		generatedAt: requiredString(input.generatedAt, 'generatedAt'),
		source: {
			harness: enumValue(input.source.harness, ['codex'] as const, 'source.harness'),
			taskIds: sortedStrings(input.source.taskIds, 'source.taskIds'),
			repoIds: sortedStrings(input.source.repoIds, 'source.repoIds'),
			completeness: enumValue(input.source.completeness, SESSION_RETROSPECTIVE_COMPLETENESS, 'source.completeness'),
		},
		recap: {
			summary: requiredString(input.recap.summary, 'recap.summary'),
			delivered: sortedStrings(input.recap.delivered, 'recap.delivered'),
			requested: sortedStrings(input.recap.requested, 'recap.requested'),
		},
		strengths: dedupeSort(input.strengths.map((entry, index) => normalizeAssessment(entry, `strengths[${index}]`)), (entry) => JSON.stringify(entry)),
		frictions: dedupeSort(input.frictions.map((entry, index) => normalizeAssessment(entry, `frictions[${index}]`)), (entry) => JSON.stringify(entry)),
		uncertainty: {
			biggestMissing: optionalNullableString(input.uncertainty.biggestMissing, 'uncertainty.biggestMissing'),
			leastConfident: optionalNullableString(input.uncertainty.leastConfident, 'uncertainty.leastConfident'),
		},
		requiresUserDecision: input.requiresUserDecision,
	};

	if (schemaVersion === SESSION_RETROSPECTIVE_V1_SCHEMA_VERSION) {
		const base: SessionRetrospectiveStructuredArtifactBase = {
			schemaVersion,
			...common,
			improvementCandidates: dedupeSort(input.improvementCandidates.map((entry, index) => normalizeCandidate(entry, `improvementCandidates[${index}]`)), (entry) => JSON.stringify(entry)),
		};
		if (kind === 'session.retrospective.aggregate') {
			if (base.source.taskIds.length < 2) {
				throw new SessionRetrospectiveContractError('Aggregate source.taskIds must contain at least two task ids', 'invalid_artifact_shape');
			}
			if (base.source.repoIds.length !== 1) {
				throw new SessionRetrospectiveContractError('Aggregate source.repoIds must identify exactly one repository', 'invalid_artifact_shape');
			}
			const children = normalizeChildren(input.children);
			if (children.length < 2) {
				throw new SessionRetrospectiveContractError('Aggregate children must contain at least two entries', 'invalid_artifact_shape');
			}
			const repeatedSignals = normalizeRepeatedSignals(input.repeatedSignals);
			assertAggregateReferences(children, repeatedSignals, base.source.taskIds);
			return { ...base, kind, children, repeatedSignals };
		}
		if (base.source.taskIds.length !== 1) {
			throw new SessionRetrospectiveContractError('Single source.taskIds must contain exactly one task id', 'invalid_artifact_shape');
		}
		return { ...base, kind };
	}

	if (!Array.isArray(input.customizationInventory)) {
		throw new SessionRetrospectiveContractError('customizationInventory must be an array', 'invalid_artifact_shape');
	}
	const base: SessionRetrospectiveV2StructuredArtifactBase = {
		schemaVersion,
		...common,
		customizationInventory: dedupeSort(input.customizationInventory.map((entry, index) => normalizeCustomizationInventoryEntry(entry, `customizationInventory[${index}]`)), (entry) => JSON.stringify(entry)),
		improvementCandidates: dedupeSort(input.improvementCandidates.map((entry, index) => normalizeV2Candidate(entry, `improvementCandidates[${index}]`)), (entry) => JSON.stringify(entry)),
	};
	if (kind === 'session.retrospective.aggregate') {
		if (base.source.taskIds.length < 2) {
			throw new SessionRetrospectiveContractError('Aggregate source.taskIds must contain at least two task ids', 'invalid_artifact_shape');
		}
		if (base.source.repoIds.length !== 1) {
			throw new SessionRetrospectiveContractError('Aggregate source.repoIds must identify exactly one repository', 'invalid_artifact_shape');
		}
		const children = normalizeChildren(input.children);
		if (children.length < 2) {
			throw new SessionRetrospectiveContractError('Aggregate children must contain at least two entries', 'invalid_artifact_shape');
		}
		const repeatedSignals = normalizeRepeatedSignals(input.repeatedSignals);
		assertAggregateReferences(children, repeatedSignals, base.source.taskIds);
		return { ...base, kind, children, repeatedSignals };
	}
	if (base.source.taskIds.length !== 1) {
		throw new SessionRetrospectiveContractError('Single source.taskIds must contain exactly one task id', 'invalid_artifact_shape');
	}
	return { ...base, kind };
}

export function computeSessionRetrospectiveArtifactChecksum(markdown: string): string {
	return createHash('sha256').update(String(markdown || ''), 'utf8').digest('hex');
}

/** Alias matching the shorter checksum naming used by older contract consumers. */
export const computeSessionRetrospectiveChecksum = computeSessionRetrospectiveArtifactChecksum;

export function parseSessionRetrospectiveMarkdownArtifact(markdown: string): ParsedSessionRetrospectiveArtifact {
	const source = String(markdown || '');
	if (!source.trim()) throw new SessionRetrospectiveContractError('Artifact markdown is required', 'invalid_markdown');
	const match = source.match(/##\s+Structured State\s*```json\s*([\s\S]*?)```/i);
	if (!match) throw new SessionRetrospectiveContractError('Artifact is missing the Structured State JSON block', 'missing_structured_state');
	const structuredBlock = String(match[1] || '').trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(structuredBlock);
	} catch {
		throw new SessionRetrospectiveContractError('Structured State JSON is invalid', 'invalid_json');
	}
	return {
		artifact: normalizeSessionRetrospectiveStructuredArtifact(parsed),
		body: source,
		structuredBlock,
		checksum: computeSessionRetrospectiveArtifactChecksum(source),
	};
}

/** Compatibility alias for consumers that omit the artifact suffix. */
export const parseSessionRetrospectiveMarkdown = parseSessionRetrospectiveMarkdownArtifact;
