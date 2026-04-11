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
  PlanningDiagramsResponse,
  PlanningMergeIntentResponse,
  PlanningMergeResponse,
  PlanningPersistenceInitResponse,
  PlanningRecordsResponse,
  PlanningResearchNote,
  PlanningResearchNotesResponse,
  PlanningSearchResponse,
} from '../types';
import {
  apiRequest,
  appendPlanningQuery,
  asRecord,
  asTrimmedString,
  normalizeObsidianPlanningNoteResponse,
  normalizeObsidianPlanningNotesResponse,
  normalizeObsidianPlanningRepresentationsRefreshResponse,
  normalizeObsidianPlanningRepresentationsResponse,
  normalizeObsidianPlanningRepresentationsStatusResponse,
  normalizeObsidianPlanningSourceSelectionResponse,
  normalizeObsidianPlanningStatusResponse,
  normalizeObsidianPlanningSyncResponse,
  normalizePlanningBacklogMutationResponse,
  normalizePlanningBacklogResponse,
  normalizePlanningBulletsResponse,
  normalizePlanningCompareResponse,
  normalizePlanningCreateResponse,
  normalizePlanningDiagramsResponse,
  normalizePlanningIntakeArtifactsResponse,
  normalizePlanningMergeIntentResponse,
  normalizePlanningMergeResponse,
  normalizePlanningPersistenceInitResponse,
  normalizePlanningRecordsResponse,
  normalizePlanningResearchNote,
  normalizePlanningResearchNotesResponse,
  normalizePlanningRoadmapMutationResponse,
  normalizePlanningRoadmapsResponse,
  normalizePlanningSearchResponse,
} from './core';
import type {
  PlanningBacklogCreatePayload,
  PlanningBacklogMutationResponseApi,
  PlanningBacklogResponseApi,
  PlanningBacklogUpdatePayload,
  PlanningBulletCreatePayload,
  PlanningBulletUpdatePayload,
  PlanningBulletsResponseApi,
  PlanningComparePayload,
  PlanningContextQuery,
  PlanningCreatePayload,
  PlanningIntakeArtifactsResponseApi,
  PlanningIntakeCreatePayload,
  PlanningIntakeUpdatePayload,
  PlanningMergeIntentPayload,
  PlanningMergePayload,
  PlanningRepoDocRefOptions,
  PlanningResearchNoteInput,
  PlanningRoadmapMutationResponseApi,
  PlanningRoadmapUpdatePayload,
  PlanningRoadmapsResponseApi,
  PlanningSearchQuery,
  PlanningUpdatePayload,
} from './core';

export async function getPlanningRoadmaps(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<PlanningRoadmapsResponseApi> {
  const payload = await apiRequest<unknown>('/api/planning/roadmaps', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningRoadmapsResponse(payload);
}

export async function updatePlanningRoadmap(
  roadmapSlug: string,
  payload: PlanningRoadmapUpdatePayload,
  baseUrl?: string,
): Promise<PlanningRoadmapMutationResponseApi> {
  const response = await apiRequest<unknown>(`/api/planning/roadmaps/${encodeURIComponent(roadmapSlug)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningRoadmapMutationResponse(response);
}

export async function getPlanningIntakeArtifacts(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<PlanningIntakeArtifactsResponseApi> {
  const payload = await apiRequest<unknown>('/api/planning/artifacts/intake', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningIntakeArtifactsResponse(payload);
}

export async function getPlanningBullets(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<PlanningBulletsResponseApi> {
  const payload = await apiRequest<unknown>('/api/planning/artifacts/bullets', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
      repoLabel: asTrimmedString(query.repoLabel) || undefined,
    },
  });

  return normalizePlanningBulletsResponse(payload);
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

export async function getPlanningBacklog(
  query: PlanningRepoDocRefOptions = {},
  baseUrl?: string
): Promise<PlanningBacklogResponseApi> {
  const payload = await apiRequest<unknown>('/api/planning/backlog', {
    baseUrl,
    query: {
      repoId: asTrimmedString(query.repoId) || undefined,
      repoPath: asTrimmedString(query.repoPath) || undefined,
    },
  });

  return normalizePlanningBacklogResponse(payload);
}

export async function createPlanningBacklogItem(
  payload: PlanningBacklogCreatePayload,
  baseUrl?: string
): Promise<PlanningBacklogMutationResponseApi> {
  const response = await apiRequest<unknown>('/api/planning/backlog', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningBacklogMutationResponse(response);
}

export async function createPlanningBullet(
  payload: PlanningBulletCreatePayload,
  baseUrl?: string
): Promise<PlanningBulletsResponseApi> {
  const response = await apiRequest<unknown>('/api/planning/artifacts/bullets', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningBulletsResponse(response);
}

export async function createPlanningIntakeArtifact(
  payload: PlanningIntakeCreatePayload,
  baseUrl?: string
): Promise<PlanningIntakeArtifactsResponseApi> {
  const response = await apiRequest<unknown>('/api/planning/artifacts/intake', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningIntakeArtifactsResponse(response);
}

export async function updatePlanningBullet(
  bulletId: string,
  payload: PlanningBulletUpdatePayload,
  baseUrl?: string
): Promise<PlanningBulletsResponseApi> {
  const response = await apiRequest<unknown>(`/api/planning/artifacts/bullets/${encodeURIComponent(bulletId)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningBulletsResponse(response);
}

export async function updatePlanningIntakeArtifact(
  artifactId: string,
  payload: PlanningIntakeUpdatePayload,
  baseUrl?: string
): Promise<PlanningIntakeArtifactsResponseApi> {
  const response = await apiRequest<unknown>(`/api/planning/artifacts/intake/${encodeURIComponent(artifactId)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningIntakeArtifactsResponse(response);
}

export async function updatePlanningBacklogItem(
  itemId: string,
  payload: PlanningBacklogUpdatePayload,
  baseUrl?: string
): Promise<PlanningBacklogMutationResponseApi> {
  const response = await apiRequest<unknown>(`/api/planning/backlog/${encodeURIComponent(itemId)}`, {
    baseUrl,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizePlanningBacklogMutationResponse(response);
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

export async function getPlanningResearchNotes(
  recordId: string,
  baseUrl?: string
): Promise<PlanningResearchNotesResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/records/${encodeURIComponent(recordId)}/research`, {
    baseUrl,
  });
  return normalizePlanningResearchNotesResponse(payload);
}

export async function savePlanningResearchNote(
  recordId: string,
  note: PlanningResearchNoteInput,
  baseUrl?: string
): Promise<{ note?: PlanningResearchNote; [key: string]: unknown }> {
  const payload = await apiRequest<unknown>(`/api/planning/records/${encodeURIComponent(recordId)}/research`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(note),
  });

  const response = asRecord(payload);
  return {
    ...response,
    note: normalizePlanningResearchNote(response.note) ?? undefined,
  };
}

export async function deletePlanningResearchNote(
  recordId: string,
  noteId: string,
  baseUrl?: string
): Promise<{ ok?: boolean; [key: string]: unknown }> {
  return apiRequest<{ ok?: boolean; [key: string]: unknown }>(
    `/api/planning/records/${encodeURIComponent(recordId)}/research/${encodeURIComponent(noteId)}`,
    {
      baseUrl,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
}

export async function getPlanningDiagrams(recordId: string, baseUrl?: string): Promise<PlanningDiagramsResponse> {
  const payload = await apiRequest<unknown>(`/api/planning/records/${encodeURIComponent(recordId)}/diagrams`, {
    baseUrl,
  });
  return normalizePlanningDiagramsResponse(payload);
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
