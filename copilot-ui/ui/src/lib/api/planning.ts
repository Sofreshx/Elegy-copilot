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
  PlanningMergeIntentResponse,
  PlanningMergeResponse,
  PlanningPersistenceInitResponse,
  PlanningRecordsResponse,
  PlanningSearchResponse,
} from '../types';
import {
  apiRequest,
  appendPlanningQuery,
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
