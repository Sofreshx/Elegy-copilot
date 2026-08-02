export const GOAL_SESSION_FRAME_SCHEMA_VERSION = '1' as const;
export const GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION = '2' as const;

export const GOAL_SESSION_PLANNING_SURFACES = ['none', 'plan-pack', 'roadmap', 'both'] as const;
export type GoalSessionPlanningSurface = typeof GOAL_SESSION_PLANNING_SURFACES[number];
export const GOAL_SESSION_AUTHORITY_STATUSES = ['resolved', 'manual', 'required', 'unavailable'] as const;
export type GoalSessionAuthorityStatus = typeof GOAL_SESSION_AUTHORITY_STATUSES[number];
export const GOAL_SESSION_WORKTREE_STATES = ['clean', 'dirty', 'unknown'] as const;
export type GoalSessionWorktreeState = typeof GOAL_SESSION_WORKTREE_STATES[number];
export const GOAL_SESSION_WAVE_STATUSES = ['pending', 'active', 'completed', 'blocked', 'skipped'] as const;
export type GoalSessionWaveStatus = typeof GOAL_SESSION_WAVE_STATUSES[number];
export const GOAL_SESSION_PHASES = ['planning', 'implementation', 'review', 'deployment'] as const;
export type GoalSessionPhase = typeof GOAL_SESSION_PHASES[number];
export const GOAL_SESSION_RESUME_STATUSES = ['fresh', 'reconciled', 'drifted', 'blocked'] as const;
export type GoalSessionResumeStatus = typeof GOAL_SESSION_RESUME_STATUSES[number];
export const GOAL_SESSION_GIT_CHECKPOINT_STATUSES = ['not-applicable', 'committed', 'clean-no-commit', 'blocked-uncommitted'] as const;
export type GoalSessionGitCheckpointStatus = typeof GOAL_SESSION_GIT_CHECKPOINT_STATUSES[number];
export const GOAL_SESSION_ASSURANCE_MODES = ['normal', 'advisory', 'strict'] as const;
export type GoalSessionAssuranceMode = typeof GOAL_SESSION_ASSURANCE_MODES[number];
export const GOAL_SESSION_ASSURANCE_STATUSES = ['not-requested', 'suggested', 'requested', 'passed', 'blocked', 'stale'] as const;
export type GoalSessionAssuranceStatus = typeof GOAL_SESSION_ASSURANCE_STATUSES[number];
export const GOAL_SESSION_ATTENTION_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type GoalSessionAttentionSeverity = typeof GOAL_SESSION_ATTENTION_SEVERITIES[number];
export const GOAL_SESSION_ATTENTION_STATUSES = ['open', 'accepted', 'resolved', 'stale'] as const;
export const GOAL_SESSION_VALIDATION_RECEIPT_KINDS = ['command', 'test', 'build', 'lint', 'manual', 'other'] as const;
export const GOAL_SESSION_VALIDATION_RECEIPT_STATUSES = ['pending', 'passed', 'failed', 'blocked', 'skipped'] as const;
export const GOAL_SESSION_BLOCKER_STATUSES = ['open', 'accepted', 'resolved'] as const;
export const GOAL_SESSION_EXTERNAL_GATE_STATUSES = ['pending', 'passed', 'failed', 'waived', 'unavailable'] as const;
export type GoalSessionAttentionStatus = typeof GOAL_SESSION_ATTENTION_STATUSES[number];
export const GOAL_SESSION_MAX_ATTENTION_SIGNALS = 12 as const;
export const GOAL_SESSION_MAX_SIGNAL_ID_LENGTH = 96 as const;
export const GOAL_SESSION_MAX_SIGNAL_KEY_LENGTH = 96 as const;
export const GOAL_SESSION_MAX_SIGNAL_TEXT_LENGTH = 512 as const;
export const GOAL_SESSION_MAX_SIGNAL_EVIDENCE_REFS = 8 as const;
export const GOAL_SESSION_MAX_SIGNAL_EVIDENCE_REF_LENGTH = 256 as const;
export const GOAL_SESSION_MAX_FRAME_BYTES = 16 * 1024;
export const GOAL_SESSION_MAX_CHECKPOINT_V1_BYTES = 6 * 1024;
export const GOAL_SESSION_MAX_CHECKPOINT_V2_BYTES = 18 * 1024;

export interface GoalSessionPlanningRefs {
	surface: GoalSessionPlanningSurface;
	scopeKey: string | null;
	goalRef: string | null;
	roadmapRef: string | null;
	planRef: string | null;
	workPointRefs: string[];
	projectRunRef: string | null;
	authorityStatus: GoalSessionAuthorityStatus;
}

export interface GoalSessionRepositoryState {
	repositoryId: string;
	branch: string;
	baseRef: string;
	headRef: string;
	worktreeStatus: GoalSessionWorktreeState;
	ownedPaths: string[];
	changedPaths: string[];
	commitRef: string | null;
}

export interface GoalSessionWave {
	waveId: string;
	dependsOn: string[];
	status: GoalSessionWaveStatus;
	workPointRef: string | null;
	planRef: string | null;
	projectRunRef: string | null;
}

export interface GoalSessionValidationExpectation {
	waveId: string | null;
	owner: string;
	expectedEvidence: string[];
	status: 'pending' | 'passed' | 'failed' | 'blocked';
}

export interface GoalSessionAssurancePolicy {
	mode: GoalSessionAssuranceMode;
	verificationStatus: GoalSessionAssuranceStatus;
	gateRef: string | null;
	evidenceRefs: string[];
	decisionRef: string | null;
}

export interface GoalSessionAttentionSignal {
	signalId: string;
	signalKey: string;
	severity: GoalSessionAttentionSeverity;
	summary: string;
	evidenceRefs: string[];
	whyItMatters: string;
	whenToRevisit: string;
	status: GoalSessionAttentionStatus;
}

export interface GoalSessionValidationReceipt {
	receiptId: string;
	check: string;
	kind: typeof GOAL_SESSION_VALIDATION_RECEIPT_KINDS[number];
	status: typeof GOAL_SESSION_VALIDATION_RECEIPT_STATUSES[number];
	command: string | null;
	exitCode: number | null;
	durationMs: number | null;
	artifactRef: string | null;
	observedAt: string;
	headRef: string | null;
}

export interface GoalSessionBlockerRecord {
	blockerId: string;
	code: string;
	severity: GoalSessionAttentionSeverity;
	owner: string;
	blocking: boolean;
	status: typeof GOAL_SESSION_BLOCKER_STATUSES[number];
	evidenceRefs: string[];
	nextDecision: string | null;
}

export interface GoalSessionExternalGateRecord {
	gateId: string;
	owner: string;
	blocking: boolean;
	status: typeof GOAL_SESSION_EXTERNAL_GATE_STATUSES[number];
	evidenceRefs: string[];
	continueWhen: string | null;
}

export interface GoalSessionFrame {
	schemaVersion: typeof GOAL_SESSION_FRAME_SCHEMA_VERSION;
	kind: 'goal-session.frame';
	goalId: string;
	successCriteria: string[];
	canonicalAuthority: string;
	planning: GoalSessionPlanningRefs;
	repositories: GoalSessionRepositoryState[];
	dependencyWaves: GoalSessionWave[];
	integrationOwner: string;
	readiness: { codeReadiness: string[]; environmentReadiness: string[] };
	validation: GoalSessionValidationExpectation[];
	stopEscalationContinuation: { stop: string[]; escalate: string[]; continueWhen: string[] };
	checkpointPolicy: { beforeFanOut: boolean; afterEachWave: boolean; beforePhaseTransition: boolean };
	retrospectiveEligibility: 'manual_after_closure' | 'not_eligible';
	assurancePolicy: GoalSessionAssurancePolicy;
	attentionSignals: GoalSessionAttentionSignal[];
}

export interface GoalSessionResumeState {
	status: GoalSessionResumeStatus;
	checkedAt: string | null;
	drift: string[];
}

export interface GoalSessionGitCheckpoint {
	status: GoalSessionGitCheckpointStatus;
	commitSha: string | null;
	reason: string | null;
	validationRefs: string[];
}

export interface GoalSessionCheckpoint {
	schemaVersion: typeof GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION;
	goalId: string;
	phase: GoalSessionPhase;
	planning: GoalSessionPlanningRefs;
	completedWaveIds: string[];
	activeWaveId: string | null;
	decisions: string[];
	repositories: GoalSessionRepositoryState[];
	validationEvidence: string[];
	blockers: string[];
	externalGates: string[];
	validationReceipts: GoalSessionValidationReceipt[];
	blockerRecords: GoalSessionBlockerRecord[];
	externalGateRecords: GoalSessionExternalGateRecord[];
	nextAction: string;
	resume: GoalSessionResumeState;
	gitCheckpoint: GoalSessionGitCheckpoint;
	assurancePolicy: GoalSessionAssurancePolicy;
	attentionSignals: GoalSessionAttentionSignal[];
	updatedAt: string;
}

export class GoalSessionContractError extends Error {
	readonly code = 'invalid_goal_session_shape' as const;
	constructor(message: string) {
		super(message);
		this.name = 'GoalSessionContractError';
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[], fieldName: string, optionalKeys: readonly string[] = []): asserts value is Record<string, unknown> {
	const actualKeys = isRecord(value) ? Object.keys(value) : [];
	const allowedKeys = new Set([...keys, ...optionalKeys]);
	if (!isRecord(value)
		|| actualKeys.some((key) => !allowedKeys.has(key))
		|| keys.some((key) => !actualKeys.includes(key))) {
		throw new GoalSessionContractError(`${fieldName} contains unsupported or missing fields`);
	}
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new GoalSessionContractError(`${fieldName} is required`);
	return value.trim();
}

function nullableString(value: unknown, fieldName: string): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') throw new GoalSessionContractError(`${fieldName} must be a string or null`);
	return value.trim() || null;
}

function stringList(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value)) throw new GoalSessionContractError(`${fieldName} must be an array`);
	return [...new Set(value.map((entry) => requiredString(entry, `${fieldName}[]`)))];
}

function nonEmptyStringList(value: unknown, fieldName: string): string[] {
	const list = stringList(value, fieldName);
	if (list.length === 0) throw new GoalSessionContractError(`${fieldName} must contain at least one item`);
	return list;
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fieldName: string): T[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new GoalSessionContractError(`${fieldName} is invalid`);
	return value as T[number];
}

function boundedString(value: unknown, fieldName: string, maximumLength: number): string {
	const normalized = requiredString(value, fieldName);
	if (normalized.length > maximumLength) throw new GoalSessionContractError(`${fieldName} exceeds ${maximumLength} characters`);
	return normalized;
}

function boundedStringList(value: unknown, fieldName: string, maximumItems: number, maximumLength: number): string[] {
	const list = stringList(value, fieldName);
	if (list.length === 0) throw new GoalSessionContractError(`${fieldName} must contain at least one item`);
	if (list.length > maximumItems) throw new GoalSessionContractError(`${fieldName} must contain at most ${maximumItems} items`);
	if (list.some((entry) => entry.length > maximumLength)) throw new GoalSessionContractError(`${fieldName} entries exceed ${maximumLength} characters`);
	return list;
}

function normalizePlanningRefs(value: unknown): GoalSessionPlanningRefs {
	exactKeys(value, ['surface', 'scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'workPointRefs', 'projectRunRef', 'authorityStatus'], 'planning');
	const surface = enumValue(value.surface, GOAL_SESSION_PLANNING_SURFACES, 'planning.surface');
	const refs = {
		surface,
		scopeKey: nullableString(value.scopeKey, 'planning.scopeKey'),
		goalRef: nullableString(value.goalRef, 'planning.goalRef'),
		roadmapRef: nullableString(value.roadmapRef, 'planning.roadmapRef'),
		planRef: nullableString(value.planRef, 'planning.planRef'),
		workPointRefs: stringList(value.workPointRefs, 'planning.workPointRefs'),
		projectRunRef: nullableString(value.projectRunRef, 'planning.projectRunRef'),
		authorityStatus: enumValue(value.authorityStatus, GOAL_SESSION_AUTHORITY_STATUSES, 'planning.authorityStatus'),
	};
	if (surface !== 'none' && !refs.scopeKey) throw new GoalSessionContractError('planning.scopeKey is required for a durable planning surface');
	if ((surface === 'roadmap' || surface === 'both') && (!refs.goalRef || !refs.roadmapRef || !refs.planRef)) {
		throw new GoalSessionContractError('planning.goalRef, planning.roadmapRef, and planning.planRef are required for roadmap planning');
	}
	return refs;
}

function normalizeRepositories(value: unknown): GoalSessionRepositoryState[] {
	if (!Array.isArray(value) || value.length === 0) throw new GoalSessionContractError('repositories must contain at least one repository');
	const repositories = value.map((entry, index) => {
		exactKeys(entry, ['repositoryId', 'branch', 'baseRef', 'headRef', 'worktreeStatus', 'ownedPaths', 'changedPaths', 'commitRef'], `repositories[${index}]`);
		return {
			repositoryId: requiredString(entry.repositoryId, `repositories[${index}].repositoryId`),
			branch: requiredString(entry.branch, `repositories[${index}].branch`),
			baseRef: requiredString(entry.baseRef, `repositories[${index}].baseRef`),
			headRef: requiredString(entry.headRef, `repositories[${index}].headRef`),
			worktreeStatus: enumValue(entry.worktreeStatus, GOAL_SESSION_WORKTREE_STATES, `repositories[${index}].worktreeStatus`),
			ownedPaths: stringList(entry.ownedPaths, `repositories[${index}].ownedPaths`),
			changedPaths: stringList(entry.changedPaths, `repositories[${index}].changedPaths`),
			commitRef: nullableString(entry.commitRef, `repositories[${index}].commitRef`),
		};
	});
	if (new Set(repositories.map((repository) => repository.repositoryId)).size !== repositories.length) throw new GoalSessionContractError('repositories must have unique repositoryId values');
	return repositories;
}

function normalizeWaves(value: unknown): GoalSessionWave[] {
	if (!Array.isArray(value) || value.length === 0) throw new GoalSessionContractError('dependencyWaves must contain at least one wave');
	const waves = value.map((entry, index) => {
		exactKeys(entry, ['waveId', 'dependsOn', 'status', 'workPointRef', 'planRef', 'projectRunRef'], `dependencyWaves[${index}]`);
		return {
			waveId: requiredString(entry.waveId, `dependencyWaves[${index}].waveId`),
			dependsOn: stringList(entry.dependsOn, `dependencyWaves[${index}].dependsOn`),
			status: enumValue(entry.status, GOAL_SESSION_WAVE_STATUSES, `dependencyWaves[${index}].status`),
			workPointRef: nullableString(entry.workPointRef, `dependencyWaves[${index}].workPointRef`),
			planRef: nullableString(entry.planRef, `dependencyWaves[${index}].planRef`),
			projectRunRef: nullableString(entry.projectRunRef, `dependencyWaves[${index}].projectRunRef`),
		};
	});
	if (new Set(waves.map((wave) => wave.waveId)).size !== waves.length) throw new GoalSessionContractError('dependencyWaves must have unique waveId values');
	const knownIds = new Set(waves.map((wave) => wave.waveId));
	for (const wave of waves) {
		if (wave.dependsOn.includes(wave.waveId)) throw new GoalSessionContractError(`dependencyWaves.${wave.waveId} cannot depend on itself`);
		if (wave.dependsOn.some((dependency) => !knownIds.has(dependency))) throw new GoalSessionContractError(`dependencyWaves.${wave.waveId} references an unknown dependency`);
	}
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const byId = new Map(waves.map((wave) => [wave.waveId, wave]));
	const visit = (waveId: string): void => {
		if (visiting.has(waveId)) throw new GoalSessionContractError(`dependencyWaves contains a cycle at ${waveId}`);
		if (visited.has(waveId)) return;
		visiting.add(waveId);
		for (const dependency of byId.get(waveId)?.dependsOn || []) visit(dependency);
		visiting.delete(waveId);
		visited.add(waveId);
	};
	for (const wave of waves) visit(wave.waveId);
	return waves;
}

function normalizeValidation(value: unknown): GoalSessionValidationExpectation[] {
	if (!Array.isArray(value)) throw new GoalSessionContractError('validation must be an array');
	return value.map((entry, index) => {
		exactKeys(entry, ['waveId', 'owner', 'expectedEvidence', 'status'], `validation[${index}]`);
		return {
			waveId: nullableString(entry.waveId, `validation[${index}].waveId`),
			owner: requiredString(entry.owner, `validation[${index}].owner`),
			expectedEvidence: stringList(entry.expectedEvidence, `validation[${index}].expectedEvidence`),
			status: enumValue(entry.status, ['pending', 'passed', 'failed', 'blocked'] as const, `validation[${index}].status`),
		};
	});
}

function normalizeAssurancePolicy(value: unknown): GoalSessionAssurancePolicy {
	if (value === undefined) return { mode: 'normal', verificationStatus: 'not-requested', gateRef: null, evidenceRefs: [], decisionRef: null };
	exactKeys(value, ['mode', 'verificationStatus'], 'assurancePolicy', ['gateRef', 'evidenceRefs', 'decisionRef']);
	const mode = enumValue(value.mode, GOAL_SESSION_ASSURANCE_MODES, 'assurancePolicy.mode');
	const verificationStatus = enumValue(value.verificationStatus, GOAL_SESSION_ASSURANCE_STATUSES, 'assurancePolicy.verificationStatus');
	const gateRef = nullableString(value.gateRef, 'assurancePolicy.gateRef');
	const evidenceRefs = value.evidenceRefs === undefined ? [] : stringList(value.evidenceRefs, 'assurancePolicy.evidenceRefs');
	const decisionRef = nullableString(value.decisionRef, 'assurancePolicy.decisionRef');
	if (mode === 'normal' && verificationStatus !== 'not-requested') throw new GoalSessionContractError('normal assurance must remain not-requested');
	if (mode === 'normal' && (gateRef || evidenceRefs.length || decisionRef)) throw new GoalSessionContractError('normal assurance cannot carry gate, evidence, or decision references');
	if (mode === 'strict' && !['requested', 'passed', 'blocked', 'stale'].includes(verificationStatus)) throw new GoalSessionContractError('strict assurance must be requested, passed, blocked, or stale');
	if (mode === 'strict' && !gateRef) throw new GoalSessionContractError('strict assurance requires a gateRef');
	if (mode === 'strict' && ['passed', 'blocked'].includes(verificationStatus) && evidenceRefs.length === 0) throw new GoalSessionContractError(`strict ${verificationStatus} assurance requires evidenceRefs`);
	if (mode === 'strict' && verificationStatus === 'blocked' && !decisionRef) throw new GoalSessionContractError('strict blocked assurance requires a decisionRef');
	return {
		mode,
		verificationStatus,
		gateRef,
		evidenceRefs,
		decisionRef,
	};
}

function normalizeAttentionSignals(value: unknown): GoalSessionAttentionSignal[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new GoalSessionContractError('attentionSignals must be an array');
	if (value.length > GOAL_SESSION_MAX_ATTENTION_SIGNALS) throw new GoalSessionContractError(`attentionSignals must contain at most ${GOAL_SESSION_MAX_ATTENTION_SIGNALS} items`);
	const signals = value.map((entry, index) => {
		exactKeys(entry, ['signalId', 'signalKey', 'severity', 'summary', 'evidenceRefs', 'whyItMatters', 'whenToRevisit', 'status'], `attentionSignals[${index}]`);
		return {
			signalId: boundedString(entry.signalId, `attentionSignals[${index}].signalId`, GOAL_SESSION_MAX_SIGNAL_ID_LENGTH),
			signalKey: boundedString(entry.signalKey, `attentionSignals[${index}].signalKey`, GOAL_SESSION_MAX_SIGNAL_KEY_LENGTH),
			severity: enumValue(entry.severity, GOAL_SESSION_ATTENTION_SEVERITIES, `attentionSignals[${index}].severity`),
			summary: boundedString(entry.summary, `attentionSignals[${index}].summary`, GOAL_SESSION_MAX_SIGNAL_TEXT_LENGTH),
			evidenceRefs: boundedStringList(entry.evidenceRefs, `attentionSignals[${index}].evidenceRefs`, GOAL_SESSION_MAX_SIGNAL_EVIDENCE_REFS, GOAL_SESSION_MAX_SIGNAL_EVIDENCE_REF_LENGTH),
			whyItMatters: boundedString(entry.whyItMatters, `attentionSignals[${index}].whyItMatters`, GOAL_SESSION_MAX_SIGNAL_TEXT_LENGTH),
			whenToRevisit: boundedString(entry.whenToRevisit, `attentionSignals[${index}].whenToRevisit`, GOAL_SESSION_MAX_SIGNAL_TEXT_LENGTH),
			status: enumValue(entry.status, GOAL_SESSION_ATTENTION_STATUSES, `attentionSignals[${index}].status`),
		};
	});
	if (new Set(signals.map((signal) => signal.signalId)).size !== signals.length) throw new GoalSessionContractError('attentionSignals must have unique signalId values');
	return signals;
}

function nullableInteger(value: unknown, fieldName: string, minimum?: number): number | null {
	if (value === null || value === undefined) return null;
	if (!Number.isInteger(value) || (minimum !== undefined && (value as number) < minimum)) {
		throw new GoalSessionContractError(`${fieldName} must be an integer${minimum !== undefined ? ` greater than or equal to ${minimum}` : ''} or null`);
	}
	return value as number;
}

function normalizeValidationReceipts(value: unknown): GoalSessionValidationReceipt[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new GoalSessionContractError('validationReceipts must be an array');
	const receipts = value.map((entry, index) => {
		exactKeys(entry, ['receiptId', 'check', 'kind', 'status', 'command', 'exitCode', 'durationMs', 'artifactRef', 'observedAt', 'headRef'], `validationReceipts[${index}]`);
		const observedAt = requiredString(entry.observedAt, `validationReceipts[${index}].observedAt`);
		if (Number.isNaN(Date.parse(observedAt))) throw new GoalSessionContractError(`validationReceipts[${index}].observedAt must be an ISO timestamp`);
		return {
			receiptId: requiredString(entry.receiptId, `validationReceipts[${index}].receiptId`),
			check: requiredString(entry.check, `validationReceipts[${index}].check`),
			kind: enumValue(entry.kind, GOAL_SESSION_VALIDATION_RECEIPT_KINDS, `validationReceipts[${index}].kind`),
			status: enumValue(entry.status, GOAL_SESSION_VALIDATION_RECEIPT_STATUSES, `validationReceipts[${index}].status`),
			command: nullableString(entry.command, `validationReceipts[${index}].command`),
			exitCode: nullableInteger(entry.exitCode, `validationReceipts[${index}].exitCode`),
			durationMs: nullableInteger(entry.durationMs, `validationReceipts[${index}].durationMs`, 0),
			artifactRef: nullableString(entry.artifactRef, `validationReceipts[${index}].artifactRef`),
			observedAt,
			headRef: nullableString(entry.headRef, `validationReceipts[${index}].headRef`),
		};
	});
	if (new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length) throw new GoalSessionContractError('validationReceipts must have unique receiptId values');
	return receipts;
}

function normalizeBlockerRecords(value: unknown): GoalSessionBlockerRecord[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new GoalSessionContractError('blockerRecords must be an array');
	const records = value.map((entry, index) => {
		exactKeys(entry, ['blockerId', 'code', 'severity', 'owner', 'blocking', 'status', 'evidenceRefs', 'nextDecision'], `blockerRecords[${index}]`);
		if (typeof entry.blocking !== 'boolean') throw new GoalSessionContractError(`blockerRecords[${index}].blocking must be a boolean`);
		return {
			blockerId: requiredString(entry.blockerId, `blockerRecords[${index}].blockerId`),
			code: requiredString(entry.code, `blockerRecords[${index}].code`),
			severity: enumValue(entry.severity, GOAL_SESSION_ATTENTION_SEVERITIES, `blockerRecords[${index}].severity`),
			owner: requiredString(entry.owner, `blockerRecords[${index}].owner`),
			blocking: entry.blocking,
			status: enumValue(entry.status, GOAL_SESSION_BLOCKER_STATUSES, `blockerRecords[${index}].status`),
			evidenceRefs: stringList(entry.evidenceRefs, `blockerRecords[${index}].evidenceRefs`),
			nextDecision: nullableString(entry.nextDecision, `blockerRecords[${index}].nextDecision`),
		};
	});
	if (new Set(records.map((record) => record.blockerId)).size !== records.length) throw new GoalSessionContractError('blockerRecords must have unique blockerId values');
	return records;
}

function normalizeExternalGateRecords(value: unknown): GoalSessionExternalGateRecord[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new GoalSessionContractError('externalGateRecords must be an array');
	const records = value.map((entry, index) => {
		exactKeys(entry, ['gateId', 'owner', 'blocking', 'status', 'evidenceRefs', 'continueWhen'], `externalGateRecords[${index}]`);
		if (typeof entry.blocking !== 'boolean') throw new GoalSessionContractError(`externalGateRecords[${index}].blocking must be a boolean`);
		return {
			gateId: requiredString(entry.gateId, `externalGateRecords[${index}].gateId`),
			owner: requiredString(entry.owner, `externalGateRecords[${index}].owner`),
			blocking: entry.blocking,
			status: enumValue(entry.status, GOAL_SESSION_EXTERNAL_GATE_STATUSES, `externalGateRecords[${index}].status`),
			evidenceRefs: stringList(entry.evidenceRefs, `externalGateRecords[${index}].evidenceRefs`),
			continueWhen: nullableString(entry.continueWhen, `externalGateRecords[${index}].continueWhen`),
		};
	});
	if (new Set(records.map((record) => record.gateId)).size !== records.length) throw new GoalSessionContractError('externalGateRecords must have unique gateId values');
	return records;
}

export function normalizeGoalSessionFrame(input: unknown): GoalSessionFrame {
	exactKeys(input, ['schemaVersion', 'kind', 'goalId', 'successCriteria', 'canonicalAuthority', 'planning', 'repositories', 'dependencyWaves', 'integrationOwner', 'readiness', 'validation', 'stopEscalationContinuation', 'checkpointPolicy', 'retrospectiveEligibility'], 'goal session frame', ['assurancePolicy', 'attentionSignals']);
	if (input.schemaVersion !== GOAL_SESSION_FRAME_SCHEMA_VERSION || input.kind !== 'goal-session.frame') throw new GoalSessionContractError('goal session frame schemaVersion or kind is invalid');
	exactKeys(input.readiness, ['codeReadiness', 'environmentReadiness'], 'readiness');
	exactKeys(input.stopEscalationContinuation, ['stop', 'escalate', 'continueWhen'], 'stopEscalationContinuation');
	exactKeys(input.checkpointPolicy, ['beforeFanOut', 'afterEachWave', 'beforePhaseTransition'], 'checkpointPolicy');
	if (input.checkpointPolicy.beforeFanOut !== true || input.checkpointPolicy.afterEachWave !== true || input.checkpointPolicy.beforePhaseTransition !== true) throw new GoalSessionContractError('checkpointPolicy must require every checkpoint boundary');
	const dependencyWaves = normalizeWaves(input.dependencyWaves);
	const knownWaveIds = new Set(dependencyWaves.map((wave) => wave.waveId));
	const validation = normalizeValidation(input.validation);
	if (validation.some((entry) => entry.waveId !== null && !knownWaveIds.has(entry.waveId))) throw new GoalSessionContractError('validation references an unknown wave');
	const normalized = {
		schemaVersion: GOAL_SESSION_FRAME_SCHEMA_VERSION,
		kind: 'goal-session.frame' as const,
		goalId: requiredString(input.goalId, 'goalId'),
		successCriteria: nonEmptyStringList(input.successCriteria, 'successCriteria'),
		canonicalAuthority: requiredString(input.canonicalAuthority, 'canonicalAuthority'),
		planning: normalizePlanningRefs(input.planning),
		repositories: normalizeRepositories(input.repositories),
		dependencyWaves,
		integrationOwner: requiredString(input.integrationOwner, 'integrationOwner'),
		readiness: {
			codeReadiness: stringList(input.readiness.codeReadiness, 'readiness.codeReadiness'),
			environmentReadiness: stringList(input.readiness.environmentReadiness, 'readiness.environmentReadiness'),
		},
		validation,
		stopEscalationContinuation: {
			stop: stringList(input.stopEscalationContinuation.stop, 'stopEscalationContinuation.stop'),
			escalate: stringList(input.stopEscalationContinuation.escalate, 'stopEscalationContinuation.escalate'),
			continueWhen: stringList(input.stopEscalationContinuation.continueWhen, 'stopEscalationContinuation.continueWhen'),
		},
		checkpointPolicy: {
			beforeFanOut: true,
			afterEachWave: true,
			beforePhaseTransition: true,
		},
		retrospectiveEligibility: enumValue(input.retrospectiveEligibility, ['manual_after_closure', 'not_eligible'] as const, 'retrospectiveEligibility'),
		assurancePolicy: normalizeAssurancePolicy(input.assurancePolicy),
		attentionSignals: normalizeAttentionSignals(input.attentionSignals),
	};
	if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > GOAL_SESSION_MAX_FRAME_BYTES) throw new GoalSessionContractError('goal session frame exceeds the size limit');
	return normalized;
}

function normalizeResume(value: unknown): GoalSessionResumeState {
	exactKeys(value, ['status', 'checkedAt', 'drift'], 'resume');
	const checkedAt = nullableString(value.checkedAt, 'resume.checkedAt');
	if (checkedAt && Number.isNaN(Date.parse(checkedAt))) throw new GoalSessionContractError('resume.checkedAt must be an ISO timestamp');
	return { status: enumValue(value.status, GOAL_SESSION_RESUME_STATUSES, 'resume.status'), checkedAt, drift: stringList(value.drift, 'resume.drift') };
}

function normalizeGitCheckpoint(value: unknown): GoalSessionGitCheckpoint {
	exactKeys(value, ['status', 'commitSha', 'reason', 'validationRefs'], 'gitCheckpoint');
	const status = enumValue(value.status, GOAL_SESSION_GIT_CHECKPOINT_STATUSES, 'gitCheckpoint.status');
	const commitSha = nullableString(value.commitSha, 'gitCheckpoint.commitSha');
	if (status === 'committed' && !commitSha) throw new GoalSessionContractError('gitCheckpoint.commitSha is required when status is committed');
	return { status, commitSha, reason: nullableString(value.reason, 'gitCheckpoint.reason'), validationRefs: stringList(value.validationRefs, 'gitCheckpoint.validationRefs') };
}

export function normalizeGoalSessionCheckpoint(input: unknown): GoalSessionCheckpoint {
	exactKeys(input, ['schemaVersion', 'goalId', 'phase', 'planning', 'completedWaveIds', 'activeWaveId', 'decisions', 'repositories', 'validationEvidence', 'blockers', 'externalGates', 'nextAction', 'resume', 'gitCheckpoint', 'updatedAt'], 'goal session checkpoint', ['assurancePolicy', 'attentionSignals', 'validationReceipts', 'blockerRecords', 'externalGateRecords']);
	if (input.schemaVersion !== GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION) throw new GoalSessionContractError('goal session checkpoint schemaVersion is invalid');
	const updatedAt = requiredString(input.updatedAt, 'updatedAt');
	if (Number.isNaN(Date.parse(updatedAt))) throw new GoalSessionContractError('updatedAt must be an ISO timestamp');
	const completedWaveIds = stringList(input.completedWaveIds, 'completedWaveIds');
	const activeWaveId = nullableString(input.activeWaveId, 'activeWaveId');
	if (activeWaveId && completedWaveIds.includes(activeWaveId)) throw new GoalSessionContractError('activeWaveId cannot be completed');
	const normalized = {
		schemaVersion: GOAL_SESSION_CHECKPOINT_SCHEMA_VERSION,
		goalId: requiredString(input.goalId, 'goalId'),
		phase: enumValue(input.phase, GOAL_SESSION_PHASES, 'phase'),
		planning: normalizePlanningRefs(input.planning),
		completedWaveIds,
		activeWaveId,
		decisions: stringList(input.decisions, 'decisions'),
		repositories: normalizeRepositories(input.repositories),
		validationEvidence: stringList(input.validationEvidence, 'validationEvidence'),
		blockers: stringList(input.blockers, 'blockers'),
		externalGates: stringList(input.externalGates, 'externalGates'),
		validationReceipts: normalizeValidationReceipts(input.validationReceipts),
		blockerRecords: normalizeBlockerRecords(input.blockerRecords),
		externalGateRecords: normalizeExternalGateRecords(input.externalGateRecords),
		nextAction: requiredString(input.nextAction, 'nextAction'),
		resume: normalizeResume(input.resume),
		gitCheckpoint: normalizeGitCheckpoint(input.gitCheckpoint),
		assurancePolicy: normalizeAssurancePolicy(input.assurancePolicy),
		attentionSignals: normalizeAttentionSignals(input.attentionSignals),
		updatedAt,
	};
	const maximumBytes = GOAL_SESSION_MAX_CHECKPOINT_V2_BYTES;
	if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > maximumBytes) throw new GoalSessionContractError('goal session checkpoint exceeds the size limit');
	return normalized;
}
