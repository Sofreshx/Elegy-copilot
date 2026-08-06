export const GOAL_SESSION_RECORD_SCHEMA_VERSION = '1' as const;
export const GOAL_SESSION_RECORD_KINDS = ['baseline', 'update'] as const;
export const GOAL_SESSION_UPDATE_EVENTS = ['wave-complete', 'blocked', 'decision', 'handoff', 'interrupted', 'closure'] as const;
export const GOAL_SESSION_GIT_STATUSES = ['committed', 'clean', 'uncommitted', 'not-applicable'] as const;
export const GOAL_SESSION_GATE_STATUSES = ['pending', 'passed', 'failed', 'waived', 'unavailable'] as const;
export const GOAL_SESSION_MAX_BASELINE_BYTES = 8 * 1024;
export const GOAL_SESSION_MAX_UPDATE_BYTES = 4 * 1024;

export type GoalSessionUpdateEvent = typeof GOAL_SESSION_UPDATE_EVENTS[number];
export type GoalSessionGitStatus = typeof GOAL_SESSION_GIT_STATUSES[number];

export interface GoalSessionPlanningRefs {
	scopeKey?: string;
	goalRef?: string;
	roadmapRef?: string;
	planRef?: string;
	workPointRefs?: string[];
	projectRunRef?: string;
}

export interface GoalSessionAssurance {
	mode: 'advisory' | 'strict';
	status: 'suggested' | 'requested' | 'passed' | 'blocked' | 'stale';
	gateRef?: string;
	evidenceRefs?: string[];
	decisionRef?: string;
}

export interface GoalSessionWave {
	waveId: string;
	dependsOn: string[];
	deliverable: string;
}

export interface GoalSessionRepository {
	repositoryId: string;
	root: string;
	ownedPaths: string[];
	protectedPaths: string[];
	preserveExistingChanges: boolean;
}

export interface GoalSessionBaseline {
	schemaVersion: typeof GOAL_SESSION_RECORD_SCHEMA_VERSION;
	kind: 'baseline';
	goalId: string;
	goal: string;
	successCriteria: string[];
	authority: string;
	scope: string[];
	protected: string[];
	dependencyWaves: GoalSessionWave[];
	current: { activeWave: string; nextAction: string };
	repositories: GoalSessionRepository[];
	planning?: GoalSessionPlanningRefs;
	assurance?: GoalSessionAssurance;
}

export interface GoalSessionBlocker {
	blockerId: string;
	owner: string;
	summary: string;
	blocking: boolean;
	nextDecision?: string;
}

export interface GoalSessionGate {
	gateId: string;
	owner: string;
	blocking: boolean;
	status: typeof GOAL_SESSION_GATE_STATUSES[number];
	continueWhen?: string;
}

export interface GoalSessionGitBoundary {
	status: GoalSessionGitStatus;
	commitRef?: string;
	reason?: string;
}

export interface GoalSessionUpdate {
	schemaVersion: typeof GOAL_SESSION_RECORD_SCHEMA_VERSION;
	kind: 'update';
	goalId: string;
	event: GoalSessionUpdateEvent;
	completedWaveIds?: string[];
	activeWave?: string | null;
	changed?: string[];
	validated?: string[];
	decisions?: string[];
	risks?: string[];
	blockers?: GoalSessionBlocker[];
	gates?: GoalSessionGate[];
	assurance?: GoalSessionAssurance;
	nextAction?: string;
	git?: GoalSessionGitBoundary;
}

export type GoalSessionRecord = GoalSessionBaseline | GoalSessionUpdate;

export interface GoalSessionMaterializedState extends GoalSessionBaseline {
	completedWaveIds: string[];
	activeWave: string | null;
	nextAction: string;
	changed: string[];
	validated: string[];
	decisions: string[];
	risks: string[];
	blockers: GoalSessionBlocker[];
	gates: GoalSessionGate[];
	git?: GoalSessionGitBoundary;
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

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = [], fieldName = 'record'): asserts value is Record<string, unknown> {
	if (!isRecord(value)) throw new GoalSessionContractError(`${fieldName} must be an object`);
	const keys = Object.keys(value);
	const allowed = new Set([...required, ...optional]);
	if (required.some((key) => !keys.includes(key)) || keys.some((key) => !allowed.has(key))) {
		throw new GoalSessionContractError(`${fieldName} contains unsupported or missing fields`);
	}
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new GoalSessionContractError(`${fieldName} is required`);
	return value.trim();
}

function stringList(value: unknown, fieldName: string, requireItem = false): string[] {
	if (!Array.isArray(value)) throw new GoalSessionContractError(`${fieldName} must be an array`);
	const result = [...new Set(value.map((entry) => requiredString(entry, `${fieldName}[]`)))];
	if (requireItem && result.length === 0) throw new GoalSessionContractError(`${fieldName} must contain at least one item`);
	return result;
}

function optionalStringList(value: unknown, fieldName: string): string[] | undefined {
	return value === undefined ? undefined : stringList(value, fieldName);
}

function enumValue<T extends readonly string[]>(value: unknown, values: T, fieldName: string): T[number] {
	if (typeof value !== 'string' || !values.includes(value)) throw new GoalSessionContractError(`${fieldName} is invalid`);
	return value as T[number];
}

function uniqueBy<T>(items: T[], key: (item: T) => string, fieldName: string): T[] {
	if (new Set(items.map(key)).size !== items.length) throw new GoalSessionContractError(`${fieldName} must have unique identifiers`);
	return items;
}

function normalizePlanning(value: unknown): GoalSessionPlanningRefs | undefined {
	if (value === undefined) return undefined;
	exactKeys(value, [], ['scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'workPointRefs', 'projectRunRef'], 'planning');
	const normalized: GoalSessionPlanningRefs = {};
	for (const field of ['scopeKey', 'goalRef', 'roadmapRef', 'planRef', 'projectRunRef'] as const) {
		if (value[field] !== undefined) normalized[field] = requiredString(value[field], `planning.${field}`);
	}
	if (value.workPointRefs !== undefined) normalized.workPointRefs = stringList(value.workPointRefs, 'planning.workPointRefs', true);
	if (Object.keys(normalized).length === 0) throw new GoalSessionContractError('planning must contain at least one durable reference');
	return normalized;
}

function normalizeAssurance(value: unknown): GoalSessionAssurance | undefined {
	if (value === undefined) return undefined;
	exactKeys(value, ['mode', 'status'], ['gateRef', 'evidenceRefs', 'decisionRef'], 'assurance');
	const mode = enumValue(value.mode, ['advisory', 'strict'] as const, 'assurance.mode');
	const status = enumValue(value.status, ['suggested', 'requested', 'passed', 'blocked', 'stale'] as const, 'assurance.status');
	const gateRef = value.gateRef === undefined ? undefined : requiredString(value.gateRef, 'assurance.gateRef');
	const evidenceRefs = optionalStringList(value.evidenceRefs, 'assurance.evidenceRefs');
	const decisionRef = value.decisionRef === undefined ? undefined : requiredString(value.decisionRef, 'assurance.decisionRef');
	if (mode === 'strict' && status === 'suggested') throw new GoalSessionContractError('strict assurance cannot be suggested');
	if (mode === 'strict' && !gateRef) throw new GoalSessionContractError('strict assurance requires gateRef');
	if (mode === 'strict' && ['passed', 'blocked'].includes(status) && !evidenceRefs?.length) throw new GoalSessionContractError(`strict ${status} assurance requires evidenceRefs`);
	if (mode === 'strict' && status === 'blocked' && !decisionRef) throw new GoalSessionContractError('strict blocked assurance requires decisionRef');
	return { mode, status, ...(gateRef ? { gateRef } : {}), ...(evidenceRefs ? { evidenceRefs } : {}), ...(decisionRef ? { decisionRef } : {}) };
}

function normalizeWaves(value: unknown): GoalSessionWave[] {
	if (!Array.isArray(value) || value.length === 0) throw new GoalSessionContractError('dependencyWaves must contain at least one wave');
	const waves = uniqueBy(value.map((entry, index) => {
		exactKeys(entry, ['waveId', 'dependsOn', 'deliverable'], [], `dependencyWaves[${index}]`);
		return {
			waveId: requiredString(entry.waveId, `dependencyWaves[${index}].waveId`),
			dependsOn: stringList(entry.dependsOn, `dependencyWaves[${index}].dependsOn`),
			deliverable: requiredString(entry.deliverable, `dependencyWaves[${index}].deliverable`),
		};
	}), (wave) => wave.waveId, 'dependencyWaves');
	const ids = new Set(waves.map((wave) => wave.waveId));
	for (const wave of waves) {
		if (wave.dependsOn.includes(wave.waveId)) throw new GoalSessionContractError(`${wave.waveId} cannot depend on itself`);
		if (wave.dependsOn.some((dependency) => !ids.has(dependency))) throw new GoalSessionContractError(`${wave.waveId} references an unknown dependency`);
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

function normalizeRepositories(value: unknown): GoalSessionRepository[] {
	if (!Array.isArray(value) || value.length === 0) throw new GoalSessionContractError('repositories must contain at least one repository');
	return uniqueBy(value.map((entry, index) => {
		exactKeys(entry, ['repositoryId', 'root', 'ownedPaths', 'protectedPaths', 'preserveExistingChanges'], [], `repositories[${index}]`);
		if (entry.preserveExistingChanges !== true && entry.preserveExistingChanges !== false) throw new GoalSessionContractError(`repositories[${index}].preserveExistingChanges must be boolean`);
		return {
			repositoryId: requiredString(entry.repositoryId, `repositories[${index}].repositoryId`),
			root: requiredString(entry.root, `repositories[${index}].root`),
			ownedPaths: stringList(entry.ownedPaths, `repositories[${index}].ownedPaths`, true),
			protectedPaths: stringList(entry.protectedPaths, `repositories[${index}].protectedPaths`),
			preserveExistingChanges: entry.preserveExistingChanges,
		};
	}), (repository) => repository.repositoryId, 'repositories');
}

function normalizeBlockers(value: unknown): GoalSessionBlocker[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new GoalSessionContractError('blockers must be an array');
	return uniqueBy(value.map((entry, index) => {
		exactKeys(entry, ['blockerId', 'owner', 'summary', 'blocking'], ['nextDecision'], `blockers[${index}]`);
		if (typeof entry.blocking !== 'boolean') throw new GoalSessionContractError(`blockers[${index}].blocking must be boolean`);
		return {
			blockerId: requiredString(entry.blockerId, `blockers[${index}].blockerId`),
			owner: requiredString(entry.owner, `blockers[${index}].owner`),
			summary: requiredString(entry.summary, `blockers[${index}].summary`),
			blocking: entry.blocking,
			...(entry.nextDecision === undefined ? {} : { nextDecision: requiredString(entry.nextDecision, `blockers[${index}].nextDecision`) }),
		};
	}), (blocker) => blocker.blockerId, 'blockers');
}

function normalizeGates(value: unknown): GoalSessionGate[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new GoalSessionContractError('gates must be an array');
	return uniqueBy(value.map((entry, index) => {
		exactKeys(entry, ['gateId', 'owner', 'blocking', 'status'], ['continueWhen'], `gates[${index}]`);
		if (typeof entry.blocking !== 'boolean') throw new GoalSessionContractError(`gates[${index}].blocking must be boolean`);
		return {
			gateId: requiredString(entry.gateId, `gates[${index}].gateId`),
			owner: requiredString(entry.owner, `gates[${index}].owner`),
			blocking: entry.blocking,
			status: enumValue(entry.status, GOAL_SESSION_GATE_STATUSES, `gates[${index}].status`),
			...(entry.continueWhen === undefined ? {} : { continueWhen: requiredString(entry.continueWhen, `gates[${index}].continueWhen`) }),
		};
	}), (gate) => gate.gateId, 'gates');
}

function normalizeGit(value: unknown): GoalSessionGitBoundary | undefined {
	if (value === undefined) return undefined;
	exactKeys(value, ['status'], ['commitRef', 'reason'], 'git');
	const status = enumValue(value.status, GOAL_SESSION_GIT_STATUSES, 'git.status');
	const commitRef = value.commitRef === undefined ? undefined : requiredString(value.commitRef, 'git.commitRef');
	const reason = value.reason === undefined ? undefined : requiredString(value.reason, 'git.reason');
	if (status === 'committed' && !commitRef) throw new GoalSessionContractError('git.commitRef is required when committed');
	return { status, ...(commitRef ? { commitRef } : {}), ...(reason ? { reason } : {}) };
}

export function normalizeGoalSessionBaseline(input: unknown): GoalSessionBaseline {
	exactKeys(input, ['schemaVersion', 'kind', 'goalId', 'goal', 'successCriteria', 'authority', 'scope', 'protected', 'dependencyWaves', 'current', 'repositories'], ['planning', 'assurance'], 'goal session baseline');
	if (input.schemaVersion !== GOAL_SESSION_RECORD_SCHEMA_VERSION || input.kind !== 'baseline') throw new GoalSessionContractError('goal session baseline schemaVersion or kind is invalid');
	const dependencyWaves = normalizeWaves(input.dependencyWaves);
	exactKeys(input.current, ['activeWave', 'nextAction'], [], 'current');
	const activeWave = requiredString(input.current.activeWave, 'current.activeWave');
	if (!dependencyWaves.some((wave) => wave.waveId === activeWave)) throw new GoalSessionContractError('current.activeWave references an unknown wave');
	const normalized: GoalSessionBaseline = {
		schemaVersion: GOAL_SESSION_RECORD_SCHEMA_VERSION,
		kind: 'baseline',
		goalId: requiredString(input.goalId, 'goalId'),
		goal: requiredString(input.goal, 'goal'),
		successCriteria: stringList(input.successCriteria, 'successCriteria', true),
		authority: requiredString(input.authority, 'authority'),
		scope: stringList(input.scope, 'scope', true),
		protected: stringList(input.protected, 'protected'),
		dependencyWaves,
		current: { activeWave, nextAction: requiredString(input.current.nextAction, 'current.nextAction') },
		repositories: normalizeRepositories(input.repositories),
		...(input.planning === undefined ? {} : { planning: normalizePlanning(input.planning) }),
		...(input.assurance === undefined ? {} : { assurance: normalizeAssurance(input.assurance) }),
	};
	if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > GOAL_SESSION_MAX_BASELINE_BYTES) throw new GoalSessionContractError('goal session baseline exceeds the size limit');
	return normalized;
}

export function normalizeGoalSessionUpdate(input: unknown): GoalSessionUpdate {
	exactKeys(input, ['schemaVersion', 'kind', 'goalId', 'event'], ['completedWaveIds', 'activeWave', 'changed', 'validated', 'decisions', 'risks', 'blockers', 'gates', 'assurance', 'nextAction', 'git'], 'goal session update');
	if (input.schemaVersion !== GOAL_SESSION_RECORD_SCHEMA_VERSION || input.kind !== 'update') throw new GoalSessionContractError('goal session update schemaVersion or kind is invalid');
	const optionalFields = ['completedWaveIds', 'activeWave', 'changed', 'validated', 'decisions', 'risks', 'blockers', 'gates', 'assurance', 'nextAction', 'git'];
	if (!optionalFields.some((field) => Object.prototype.hasOwnProperty.call(input, field))) throw new GoalSessionContractError('goal session update must contain a state change');
	const activeWave = input.activeWave === undefined ? undefined : input.activeWave === null ? null : requiredString(input.activeWave, 'activeWave');
	const nextAction = input.nextAction === undefined ? undefined : requiredString(input.nextAction, 'nextAction');
	const normalized: GoalSessionUpdate = {
		schemaVersion: GOAL_SESSION_RECORD_SCHEMA_VERSION,
		kind: 'update',
		goalId: requiredString(input.goalId, 'goalId'),
		event: enumValue(input.event, GOAL_SESSION_UPDATE_EVENTS, 'event'),
		...(input.completedWaveIds === undefined ? {} : { completedWaveIds: stringList(input.completedWaveIds, 'completedWaveIds', true) }),
		...(activeWave === undefined ? {} : { activeWave }),
		...(input.changed === undefined ? {} : { changed: stringList(input.changed, 'changed') }),
		...(input.validated === undefined ? {} : { validated: stringList(input.validated, 'validated') }),
		...(input.decisions === undefined ? {} : { decisions: stringList(input.decisions, 'decisions') }),
		...(input.risks === undefined ? {} : { risks: stringList(input.risks, 'risks') }),
		...(input.blockers === undefined ? {} : { blockers: normalizeBlockers(input.blockers) }),
		...(input.gates === undefined ? {} : { gates: normalizeGates(input.gates) }),
		...(input.assurance === undefined ? {} : { assurance: normalizeAssurance(input.assurance) }),
		...(nextAction === undefined ? {} : { nextAction }),
		...(input.git === undefined ? {} : { git: normalizeGit(input.git) }),
	};
	if (normalized.event === 'closure' && normalized.activeWave !== null) throw new GoalSessionContractError('closure must set activeWave to null');
	if (normalized.event !== 'closure' && normalized.activeWave === null) throw new GoalSessionContractError('activeWave may be null only for closure');
	if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > GOAL_SESSION_MAX_UPDATE_BYTES) throw new GoalSessionContractError('goal session update exceeds the size limit');
	return normalized;
}

export function normalizeGoalSessionRecord(input: unknown): GoalSessionRecord {
	if (!isRecord(input)) throw new GoalSessionContractError('goal session record must be an object');
	if (input.kind === 'baseline') return normalizeGoalSessionBaseline(input);
	if (input.kind === 'update') return normalizeGoalSessionUpdate(input);
	throw new GoalSessionContractError('goal session record kind is invalid');
}

export function materializeGoalSessionState(baselineInput: unknown, updateInputs: unknown[] = []): GoalSessionMaterializedState {
	const baseline = normalizeGoalSessionBaseline(baselineInput);
	const waveById = new Map(baseline.dependencyWaves.map((wave) => [wave.waveId, wave]));
	const completed = new Set<string>();
	const state: GoalSessionMaterializedState = {
		...baseline,
		completedWaveIds: [],
		activeWave: baseline.current.activeWave,
		nextAction: baseline.current.nextAction,
		changed: [],
		validated: [],
		decisions: [],
		risks: [],
		blockers: [],
		gates: [],
	};
	for (const input of updateInputs) {
		const update = normalizeGoalSessionUpdate(input);
		if (update.goalId !== baseline.goalId) throw new GoalSessionContractError('goal session update goalId does not match baseline');
		for (const waveId of update.completedWaveIds || []) {
			const wave = waveById.get(waveId);
			if (!wave) throw new GoalSessionContractError(`completedWaveIds references unknown wave ${waveId}`);
			if (wave.dependsOn.some((dependency) => !completed.has(dependency))) throw new GoalSessionContractError(`wave ${waveId} completed before its dependencies`);
			completed.add(waveId);
		}
		if (update.activeWave !== undefined && update.activeWave !== null && !waveById.has(update.activeWave)) throw new GoalSessionContractError(`activeWave references unknown wave ${update.activeWave}`);
		if (update.activeWave !== undefined) state.activeWave = update.activeWave;
		if (update.nextAction !== undefined) state.nextAction = update.nextAction;
		state.changed = [...new Set([...state.changed, ...(update.changed || [])])];
		state.validated = [...new Set([...state.validated, ...(update.validated || [])])];
		state.decisions = [...new Set([...state.decisions, ...(update.decisions || [])])];
		if (update.risks !== undefined) state.risks = update.risks;
		if (update.blockers !== undefined) state.blockers = update.blockers;
		if (update.gates !== undefined) state.gates = update.gates;
		if (update.assurance !== undefined) state.assurance = update.assurance;
		if (update.git !== undefined) state.git = update.git;
	}
	state.completedWaveIds = [...completed];
	return state;
}
