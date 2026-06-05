import type {
  ObsidianPlanningNoteResponse,
  ObsidianPlanningNotesResponse,
  ObsidianPlanningRepresentationsRefreshResponse,
  ObsidianPlanningRepresentationsResponse,
  ObsidianPlanningRepresentationsStatusResponse,
  ObsidianPlanningSourceSelectionResponse,
  ObsidianPlanningStatusResponse,
  ObsidianPlanningSyncResponse,
  PlanningCompareResponse,
  PlanningCreateResponse,
  PlanningLiveGoal,
  PlanningLiveGoalResponse,
  PlanningLivePlanResponse,
  PlanningLivePlansResponse,
  PlanningLivePlanSummary,
  PlanningLiveReviewPoint,
  PlanningLiveRoadmapResponse,
  PlanningLiveRoadmapsResponse,
  PlanningLiveRoadmapSection,
  PlanningLiveRoadmapSummary,
  PlanningLiveTodo,
  PlanningLiveTodosResponse,
  PlanningLiveValidationFinding,
  PlanningLiveValidationSummary,
  PlanningLiveWorkPoint,
  PlanningMergeIntentResponse,
  PlanningMergeResponse,
  PlanningPersistenceInitResponse,
  PlanningRecordsResponse,
  PlanningSearchResponse,
  PlanningRepoSummary,
} from '../types';
import {
  apiRequest,
  appendPlanningQuery,
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asStringList,
  asTrimmedString,
  normalizeObsidianPlanningNoteResponse,
  normalizeObsidianPlanningNotesResponse,
  normalizeObsidianPlanningRepresentationsRefreshResponse,
  normalizeObsidianPlanningRepresentationsResponse,
  normalizeObsidianPlanningRepresentationsStatusResponse,
  normalizeObsidianPlanningSourceSelectionResponse,
  normalizeObsidianPlanningStatusResponse,
  normalizeObsidianPlanningSyncResponse,
  normalizePlanningCompareResponse,
  normalizePlanningCreateResponse,
  normalizePlanningMergeIntentResponse,
  normalizePlanningMergeResponse,
  normalizePlanningPersistenceInitResponse,
  normalizePlanningRecordsResponse,
  normalizePlanningSearchResponse,
} from './core';

export interface PlanningWorkflowArtifactContinuationPackageResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  continuationContractVersion?: string;
  continuationPackage: Record<string, unknown>;
}
import type {
  PlanningComparePayload,
  PlanningContextQuery,
  PlanningCreatePayload,
  PlanningMergeIntentPayload,
  PlanningMergePayload,
  PlanningRepoDocRefOptions,
  PlanningSearchQuery,
  PlanningUpdatePayload,
} from './core';

export interface PlanningLiveRoadmapsQuery extends PlanningRepoDocRefOptions {
  includeUnscoped?: boolean;
}

export interface PlanningLiveGoalQuery extends PlanningRepoDocRefOptions {}

export interface PlanningLivePlansQuery extends PlanningRepoDocRefOptions {
  goalId?: string;
  roadmapId?: string;
}

export interface PlanningLiveTodosQuery extends PlanningRepoDocRefOptions {
  roadmapId?: string;
  planId?: string;
  workPointId?: string;
}

function normalizePlanningLiveRepoSummary(value: unknown): PlanningRepoSummary | null {
  const record = asRecord(value);
  const repoId = asTrimmedString(record.repoId);
  const repoPath = asTrimmedString(record.repoPath);
  const repoLabel = asTrimmedString(record.repoLabel);

  if (!repoId && !repoPath && !repoLabel) {
    return null;
  }

  return {
    ...record,
    repoId,
    repoPath,
    repoLabel,
  };
}

function normalizePlanningLiveValidationFinding(value: unknown): PlanningLiveValidationFinding | null {
  const record = asRecord(value);
  const code = asTrimmedString(record.code);
  const message = asTrimmedString(record.message);
  const findingId = asTrimmedString(record.findingId);
  if (!findingId && !code && !message) {
    return null;
  }

  return {
    ...record,
    findingId: findingId || undefined,
    entityType: asTrimmedString(record.entityType) || undefined,
    entityId: asTrimmedString(record.entityId) || undefined,
    severity: asTrimmedString(record.severity) || undefined,
    code: code || undefined,
    message: message || undefined,
    createdAt: asTrimmedString(record.createdAt) || undefined,
  };
}

function normalizePlanningLiveValidationSummary(value: unknown): PlanningLiveValidationSummary | null {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return null;
  }

  return {
    ...record,
    status: asTrimmedString(record.status) || null,
    findings: asArray(record.findings)
      .map((entry) => normalizePlanningLiveValidationFinding(entry))
      .filter((entry): entry is PlanningLiveValidationFinding => entry !== null),
  };
}

function normalizePlanningLiveGoal(value: unknown): PlanningLiveGoal | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    correlationId: asTrimmedString(record.correlationId) || null,
    title: asTrimmedString(record.title) || null,
    description: asTrimmedString(record.description) || null,
    acceptanceCriteria: asStringList(record.acceptanceCriteria),
    rejectionCriteria: asStringList(record.rejectionCriteria),
    status: asTrimmedString(record.status) || null,
    tags: asStringList(record.tags),
    revision: Number.isFinite(Number(record.revision)) ? asNumber(record.revision) : null,
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function normalizePlanningLiveRoadmapSummary(value: unknown): PlanningLiveRoadmapSummary | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    goalId: asTrimmedString(record.goalId) || null,
    correlationId: asTrimmedString(record.correlationId) || null,
    title: asTrimmedString(record.title) || null,
    summary: asTrimmedString(record.summary) || null,
    status: asTrimmedString(record.status) || null,
    tags: asStringList(record.tags),
    revision: Number.isFinite(Number(record.revision)) ? asNumber(record.revision) : null,
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function normalizePlanningLiveRoadmapSection(value: unknown): PlanningLiveRoadmapSection | null {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return null;
  }

  return {
    ...record,
    id: asTrimmedString(record.id) || null,
    roadmapId: asTrimmedString(record.roadmapId) || null,
    title: asTrimmedString(record.title) || null,
    summary: asTrimmedString(record.summary) || null,
    ordering: Number.isFinite(Number(record.ordering)) ? asNumber(record.ordering) : null,
  };
}

function normalizePlanningLiveWorkPoint(value: unknown): PlanningLiveWorkPoint | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    roadmapId: asTrimmedString(record.roadmapId) || null,
    sectionId: asTrimmedString(record.sectionId) || null,
    title: asTrimmedString(record.title) || null,
    summary: asTrimmedString(record.summary) || null,
    status: asTrimmedString(record.status) || null,
    ordering: Number.isFinite(Number(record.ordering)) ? asNumber(record.ordering) : null,
    dependencyIds: asStringList(record.dependencyIds),
    validationExpectations: asStringList(record.validationExpectations),
    tags: asStringList(record.tags),
    revision: Number.isFinite(Number(record.revision)) ? asNumber(record.revision) : null,
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function normalizePlanningLivePlanSummary(value: unknown): PlanningLivePlanSummary | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    goalId: asTrimmedString(record.goalId) || null,
    roadmapId: asTrimmedString(record.roadmapId) || null,
    correlationId: asTrimmedString(record.correlationId) || null,
    title: asTrimmedString(record.title) || null,
    summary: asTrimmedString(record.summary) || null,
    scope: asTrimmedString(record.scope) || null,
    assumptions: asStringList(record.assumptions),
    stopConditions: asStringList(record.stopConditions),
    validationSteps: asStringList(record.validationSteps),
    targetedWorkPointIds: asStringList(record.targetedWorkPointIds),
    status: asTrimmedString(record.status) || null,
    tags: asStringList(record.tags),
    revision: Number.isFinite(Number(record.revision)) ? asNumber(record.revision) : null,
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function normalizePlanningLiveTodo(value: unknown): PlanningLiveTodo | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    planId: asTrimmedString(record.planId) || null,
    workPointId: asTrimmedString(record.workPointId) || null,
    title: asTrimmedString(record.title) || null,
    summary: asTrimmedString(record.summary) || null,
    status: asTrimmedString(record.status) || null,
    priority: asTrimmedString(record.priority) || null,
    evidenceRefs: asStringList(record.evidenceRefs),
    tags: asStringList(record.tags),
    ordering: Number.isFinite(Number(record.ordering)) ? asNumber(record.ordering) : null,
    revision: Number.isFinite(Number(record.revision)) ? asNumber(record.revision) : null,
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

function normalizePlanningLiveReviewPoint(value: unknown): PlanningLiveReviewPoint | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
  };
}

function normalizePlanningLiveRoadmapsResponse(payload: unknown): PlanningLiveRoadmapsResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    count: asNumber(record.count, 0),
    roadmaps: asArray(record.roadmaps)
      .map((entry) => normalizePlanningLiveRoadmapSummary(entry))
      .filter((entry): entry is PlanningLiveRoadmapSummary => entry !== null),
  };
}

function normalizePlanningLiveRoadmapResponse(payload: unknown): PlanningLiveRoadmapResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    roadmap: normalizePlanningLiveRoadmapSummary(record.roadmap),
    sections: asArray(record.sections)
      .map((entry) => normalizePlanningLiveRoadmapSection(entry))
      .filter((entry): entry is PlanningLiveRoadmapSection => entry !== null),
    workPoints: asArray(record.workPoints)
      .map((entry) => normalizePlanningLiveWorkPoint(entry))
      .filter((entry): entry is PlanningLiveWorkPoint => entry !== null),
    validation: normalizePlanningLiveValidationSummary(record.validation),
  };
}

function normalizePlanningLiveGoalResponse(payload: unknown): PlanningLiveGoalResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    goal: normalizePlanningLiveGoal(record.goal),
    roadmaps: asArray(record.roadmaps)
      .map((entry) => normalizePlanningLiveRoadmapSummary(entry))
      .filter((entry): entry is PlanningLiveRoadmapSummary => entry !== null),
    validation: normalizePlanningLiveValidationSummary(record.validation),
  };
}

function normalizePlanningLivePlansResponse(payload: unknown): PlanningLivePlansResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    filters: asRecord(record.filters),
    count: asNumber(record.count, 0),
    plans: asArray(record.plans)
      .map((entry) => normalizePlanningLivePlanSummary(entry))
      .filter((entry): entry is PlanningLivePlanSummary => entry !== null),
  };
}

function normalizePlanningLivePlanResponse(payload: unknown): PlanningLivePlanResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    plan: normalizePlanningLivePlanSummary(record.plan),
    todos: asArray(record.todos)
      .map((entry) => normalizePlanningLiveTodo(entry))
      .filter((entry): entry is PlanningLiveTodo => entry !== null),
    reviewPoints: asArray(record.reviewPoints)
      .map((entry) => normalizePlanningLiveReviewPoint(entry))
      .filter((entry): entry is PlanningLiveReviewPoint => entry !== null),
    validation: normalizePlanningLiveValidationSummary(record.validation),
  };
}

function normalizePlanningLiveTodosResponse(payload: unknown): PlanningLiveTodosResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningLiveRepoSummary(record.repo),
    filters: asRecord(record.filters),
    count: asNumber(record.count, 0),
    todos: asArray(record.todos)
      .map((entry) => normalizePlanningLiveTodo(entry))
      .filter((entry): entry is PlanningLiveTodo => entry !== null),
  };
}

export async function getPlanningObsidianStatus(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningStatusResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/status', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningStatusResponse(payload);
}

export async function listPlanningObsidianNotes(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningNotesResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/notes', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningNotesResponse(payload);
}

export async function getPlanningObsidianNote(
  noteId: string,
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningNoteResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/obsidian/notes/${encodeURIComponent(noteId)}`, {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningNoteResponse(payload);
}

export async function triggerPlanningObsidianSync(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningSyncResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/sync', {
    baseUrl,
    method: 'POST',
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningSyncResponse(payload);
}

export async function setPlanningObsidianSourceSelection(
  sourceId: string | null | undefined,
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string,
): Promise<ObsidianPlanningSourceSelectionResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/source-selection', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceId: asTrimmedString(sourceId) || undefined,
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    }),
  });

  return normalizeObsidianPlanningSourceSelectionResponse(payload);
}

export async function getPlanningObsidianRepresentationsStatus(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningRepresentationsStatusResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/representations/status', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningRepresentationsStatusResponse(payload);
}

export async function listPlanningObsidianRepresentations(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningRepresentationsResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/representations', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningRepresentationsResponse(payload);
}

export async function refreshPlanningObsidianRepresentations(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<ObsidianPlanningRepresentationsRefreshResponse> {
  const payload = await apiRequest<unknown>('/api/planning/obsidian/representations/refresh', {
    baseUrl,
    method: 'POST',
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizeObsidianPlanningRepresentationsRefreshResponse(payload);
}

export async function listPlanningLiveRoadmaps(
  query: PlanningLiveRoadmapsQuery = {},
  baseUrl?: string,
): Promise<PlanningLiveRoadmapsResponse> {
  const payload = await apiRequest<unknown>('/api/planning/live/roadmaps', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
      includeUnscoped: query.includeUnscoped ? 'true' : undefined,
    },
  });

  return normalizePlanningLiveRoadmapsResponse(payload);
}

export async function getPlanningLiveRoadmap(
  roadmapId: string,
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string,
): Promise<PlanningLiveRoadmapResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/live/roadmaps/${encodeURIComponent(roadmapId)}`, {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningLiveRoadmapResponse(payload);
}

export async function getPlanningLiveGoal(
  goalId: string,
  query: PlanningLiveGoalQuery = {},
  baseUrl?: string,
): Promise<PlanningLiveGoalResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/live/goals/${encodeURIComponent(goalId)}`, {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningLiveGoalResponse(payload);
}

export async function listPlanningLivePlans(
  query: PlanningLivePlansQuery = {},
  baseUrl?: string,
): Promise<PlanningLivePlansResponse> {
  const payload = await apiRequest<unknown>('/api/planning/live/plans', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
      goalId: asTrimmedString(query.goalId) || undefined,
      roadmapId: asTrimmedString(query.roadmapId) || undefined,
    },
  });

  return normalizePlanningLivePlansResponse(payload);
}

export async function getPlanningLivePlan(
  planId: string,
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string,
): Promise<PlanningLivePlanResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/live/plans/${encodeURIComponent(planId)}`, {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningLivePlanResponse(payload);
}

export async function listPlanningLiveTodos(
  query: PlanningLiveTodosQuery = {},
  baseUrl?: string,
): Promise<PlanningLiveTodosResponse> {
  const payload = await apiRequest<unknown>('/api/planning/live/todos', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
      roadmapId: asTrimmedString(query.roadmapId) || undefined,
      planId: asTrimmedString(query.planId) || undefined,
      workPointId: asTrimmedString(query.workPointId) || undefined,
    },
  });

  return normalizePlanningLiveTodosResponse(payload);
}

export async function getPlanningRecords(query: PlanningContextQuery = {}, baseUrl?: string): Promise<PlanningRecordsResponse> {
  const endpoint = appendPlanningQuery('/api/planning/records', query);
  const payload = await apiRequest<unknown>(endpoint, { baseUrl });
  return normalizePlanningRecordsResponse(payload);
}

export async function searchPlanningRecords(query: PlanningSearchQuery, baseUrl?: string): Promise<PlanningSearchResponse> {
  const endpoint = appendPlanningQuery('/api/planning/search', query, {
    q: query.query ?? '',
    limit: Number.isFinite(query.limit) ? String(Math.floor(query.limit as number)) : '',
  });
  const payload = await apiRequest<unknown>(endpoint, { baseUrl });
  return normalizePlanningSearchResponse(payload);
}

export async function createPlanningRecord(payload: PlanningCreatePayload, baseUrl?: string): Promise<PlanningCreateResponse> {
  const response = await apiRequest<unknown>('/api/planning/records', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningCreateResponse(response);
}

export async function updatePlanningRecord(
  recordId: string,
  payload: PlanningUpdatePayload,
  baseUrl?: string
): Promise<PlanningCreateResponse> {
  const response = await apiRequest<unknown>(`/api/planning/records/${encodeURIComponent(recordId)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningCreateResponse(response);
}

export async function comparePlanningRecords(payload: PlanningComparePayload, baseUrl?: string): Promise<PlanningCompareResponse> {
  const response = await apiRequest<unknown>('/api/planning/compare', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningCompareResponse(response);
}

export async function preparePlanningMergeIntent(
  payload: PlanningMergeIntentPayload,
  baseUrl?: string
): Promise<PlanningMergeIntentResponse> {
  const response = await apiRequest<unknown>('/api/planning/merge-intent', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningMergeIntentResponse(response);
}

export async function mergePlanningRecords(payload: PlanningMergePayload, baseUrl?: string): Promise<PlanningMergeResponse> {
  const response = await apiRequest<unknown>('/api/planning/merge', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningMergeResponse(response);
}

export async function initPlanningPersistence(baseUrl?: string): Promise<PlanningPersistenceInitResponse> {
  const payload = await apiRequest<unknown>('/api/planning/persistence/init', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return normalizePlanningPersistenceInitResponse(payload);
}

export async function getPlanningWorkflowArtifactContinuationPackage(
  artifactId: string,
  query: PlanningContextQuery & { targetHarness?: string } = {},
  baseUrl?: string,
): Promise<PlanningWorkflowArtifactContinuationPackageResponse> {
  return apiRequest<PlanningWorkflowArtifactContinuationPackageResponse>('/api/planning/workflow-artifacts/continuation-package', {
    baseUrl,
    query: {
      artifactId,
      userId: query.userId,
      repoId: query.repoId,
      targetHarness: query.targetHarness,
    },
  });
}

// ---------------------------------------------------------------------------
// Planning session
// ---------------------------------------------------------------------------

export interface PlanningSessionResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  ready: boolean;
  sidecarPath: string | null;
  exists: boolean;
  sidecar: Record<string, unknown> | null;
  lastChecked: string | null;
  correlationId: string | null;
  availableAt: Array<{ path: string; exists: boolean; priority: number }>;
}

export async function getPlanningSession(baseUrl?: string): Promise<PlanningSessionResponse> {
  const payload = await apiRequest<unknown>('/api/planning/session', { baseUrl });
  const record = asRecord(payload);
  return {
    ...record,
    ready: asBoolean(record.ready, false),
    sidecarPath: asTrimmedString(record.sidecarPath) || null,
    exists: asBoolean(record.exists, false),
    sidecar: record.sidecar && typeof record.sidecar === 'object' ? record.sidecar as Record<string, unknown> : null,
    lastChecked: asTrimmedString(record.lastChecked) || null,
    correlationId: asTrimmedString(record.correlationId) || null,
    availableAt: asArray(record.availableAt).map((entry: unknown) => {
      const r = asRecord(entry);
      return {
        path: asTrimmedString(r.path) || '',
        exists: asBoolean(r.exists, false),
        priority: asNumber(r.priority, 0),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Planning explorer
// ---------------------------------------------------------------------------

export interface PlanningExplorerQuery {
  entityType?: string;
  repoId?: string;
  repoLabel?: string;
  status?: string;
  tag?: string;
  source?: string;
  parentGoalId?: string;
  q?: string;
  includeUnscoped?: boolean;
  limit?: number;
}

export interface PlanningExplorerEntity {
  entityType: string;
  entityId: string;
  title: string;
  summary: string | null;
  status: string | null;
  tags: string[];
  repoScope: { direct: string[]; inherited: string[] };
  parentChain: { goalId: string | null; roadmapId: string | null; planId: string | null };
  createdAt: string | null;
  updatedAt: string | null;
  raw: Record<string, unknown>;
}

export interface PlanningExplorerResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  entities: PlanningExplorerEntity[];
  total: number;
  filterWarnings: Array<{ entityType: string; entityId: string; bucket: string; reason: string }>;
  summary: {
    byType: Record<string, number>;
    byRepoScope: { direct: number; inherited: number };
    byBucket: Record<string, number>;
  };
}

export async function searchPlanningExplorer(
  query: PlanningExplorerQuery = {},
  baseUrl?: string,
): Promise<PlanningExplorerResponse> {
  const queryParams: Record<string, string | undefined> = {
    entityType: asTrimmedString(query.entityType) || undefined,
    repoId: asTrimmedString(query.repoId) || undefined,
    repoLabel: asTrimmedString(query.repoLabel) || undefined,
    status: asTrimmedString(query.status) || undefined,
    tag: asTrimmedString(query.tag) || undefined,
    source: asTrimmedString(query.source) || undefined,
    parentGoalId: asTrimmedString(query.parentGoalId) || undefined,
    q: asTrimmedString(query.q) || undefined,
    includeUnscoped: query.includeUnscoped ? 'true' : undefined,
    limit: Number.isFinite(query.limit) ? String(query.limit) : undefined,
  };

  const payload = await apiRequest<unknown>('/api/planning/explorer', {
    baseUrl,
    query: queryParams,
  });

  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, false),
    entities: asArray(record.entities).map((entry: unknown) => {
      const e = asRecord(entry);
      return {
        entityType: asTrimmedString(e.entityType) || 'unknown',
        entityId: asTrimmedString(e.entityId) || '',
        title: asTrimmedString(e.title) || '',
        summary: asTrimmedString(e.summary) || null,
        status: asTrimmedString(e.status) || null,
        tags: asStringList(e.tags),
        repoScope: {
          direct: asStringList(asRecord(e.repoScope).direct),
          inherited: asStringList(asRecord(e.repoScope).inherited),
        },
        parentChain: {
          goalId: asTrimmedString(asRecord(e.parentChain).goalId) || null,
          roadmapId: asTrimmedString(asRecord(e.parentChain).roadmapId) || null,
          planId: asTrimmedString(asRecord(e.parentChain).planId) || null,
        },
        createdAt: asTrimmedString(e.createdAt) || null,
        updatedAt: asTrimmedString(e.updatedAt) || null,
        raw: e,
      };
    }),
    total: asNumber(record.total, 0),
    filterWarnings: asArray(record.filterWarnings).map((entry: unknown) => {
      const w = asRecord(entry);
      return {
        entityType: asTrimmedString(w.entityType) || '',
        entityId: asTrimmedString(w.entityId) || '',
        bucket: asTrimmedString(w.bucket) || '',
        reason: asTrimmedString(w.reason) || '',
      };
    }),
    summary: {
      byType: asRecord(asRecord(record.summary).byType) as Record<string, number>,
      byRepoScope: asRecord(asRecord(record.summary).byRepoScope) as unknown as { direct: number; inherited: number },
      byBucket: asRecord(asRecord(record.summary).byBucket) as Record<string, number>,
    },
  };
}
