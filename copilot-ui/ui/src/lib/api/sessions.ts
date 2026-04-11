import type {
  CreateUiRuntimeOverlayAnnotationPayload,
  CreateUiRuntimeOverlayChangeRequestPayload,
  CreateUiRuntimeOverlayObservationPayload,
  CreateUiRuntimeOverlaySessionPayload,
  PlanningTaskBoardResponse,
  SessionAgentUsageResponse,
  SessionPlansResponse,
  SessionPlanMutationResponse,
  SessionStructuredStateResponse,
  SessionTextArtifactResponse,
  SessionsListResponse,
  SessionsWorkspaceResponse,
  UiRuntimeOverlayAnnotationMutationResponse,
  UiRuntimeOverlayChangeRequestMutationResponse,
  UiRuntimeOverlayObservationMutationResponse,
  UiRuntimeOverlayQueueChangeRequestResponse,
  UiRuntimeOverlaySessionMutationResponse,
  UiRuntimeOverlaySessionsResponse,
} from '../types';
import { apiRequest } from './core';
import type {
  ListSessionsOptions,
  SessionArtifactQueryOptions,
  SessionAgentUsageQueryOptions,
  SessionPlanMutationPayload,
} from './core';

export function listSessions(baseUrl?: string, options: ListSessionsOptions = {}): Promise<SessionsListResponse> {
  return apiRequest<SessionsListResponse>('/api/sessions', {
    baseUrl,
    query: {
      activeWindowMinutes: options.activeWindowMinutes,
      source: options.source,
      dedupe: options.dedupe,
    },
  });
}

export function listSessionsWorkspace(baseUrl?: string): Promise<SessionsWorkspaceResponse> {
  return apiRequest<SessionsWorkspaceResponse>('/api/sessions/workspace', {
    baseUrl,
  });
}

export function getPlanningTaskBoard(
  repo: { repoId: string; repoPath?: string; repoLabel?: string },
  baseUrl?: string
): Promise<PlanningTaskBoardResponse> {
  return apiRequest<PlanningTaskBoardResponse>('/api/planning/task-board', {
    baseUrl,
    query: {
      repoId: repo.repoId,
      repoPath: repo.repoPath,
      repoLabel: repo.repoLabel,
    },
  });
}

export function listUiRuntimeOverlaySessions(baseUrl?: string): Promise<UiRuntimeOverlaySessionsResponse> {
  return apiRequest<UiRuntimeOverlaySessionsResponse>('/api/ui-runtime-overlay/sessions', {
    baseUrl,
  });
}

export function createUiRuntimeOverlaySession(
  payload: CreateUiRuntimeOverlaySessionPayload,
  baseUrl?: string
): Promise<UiRuntimeOverlaySessionMutationResponse> {
  return apiRequest<UiRuntimeOverlaySessionMutationResponse>('/api/ui-runtime-overlay/sessions', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function closeUiRuntimeOverlaySession(
  sessionId: string,
  baseUrl?: string
): Promise<UiRuntimeOverlaySessionMutationResponse> {
  return apiRequest<UiRuntimeOverlaySessionMutationResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/close`,
    {
      baseUrl,
      method: 'POST',
    }
  );
}

export function addUiRuntimeOverlayObservation(
  sessionId: string,
  payload: CreateUiRuntimeOverlayObservationPayload,
  baseUrl?: string
): Promise<UiRuntimeOverlayObservationMutationResponse> {
  return apiRequest<UiRuntimeOverlayObservationMutationResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/observations`,
    {
      baseUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
}

export function addUiRuntimeOverlayAnnotation(
  sessionId: string,
  payload: CreateUiRuntimeOverlayAnnotationPayload,
  baseUrl?: string
): Promise<UiRuntimeOverlayAnnotationMutationResponse> {
  return apiRequest<UiRuntimeOverlayAnnotationMutationResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/annotations`,
    {
      baseUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
}

export function addUiRuntimeOverlayChangeRequest(
  sessionId: string,
  payload: CreateUiRuntimeOverlayChangeRequestPayload,
  baseUrl?: string
): Promise<UiRuntimeOverlayChangeRequestMutationResponse> {
  return apiRequest<UiRuntimeOverlayChangeRequestMutationResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/change-requests`,
    {
      baseUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
}

export function releaseUiRuntimeOverlayChangeRequest(
  sessionId: string,
  changeRequestId: string,
  baseUrl?: string
): Promise<UiRuntimeOverlayChangeRequestMutationResponse> {
  return apiRequest<UiRuntimeOverlayChangeRequestMutationResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(changeRequestId)}/release`,
    {
      baseUrl,
      method: 'POST',
    }
  );
}

export function queueUiRuntimeOverlayChangeRequest(
  sessionId: string,
  changeRequestId: string,
  baseUrl?: string
): Promise<UiRuntimeOverlayQueueChangeRequestResponse> {
  return apiRequest<UiRuntimeOverlayQueueChangeRequestResponse>(
    `/api/ui-runtime-overlay/sessions/${encodeURIComponent(sessionId)}/change-requests/${encodeURIComponent(changeRequestId)}/executor-job`,
    {
      baseUrl,
      method: 'POST',
    }
  );
}

export function listSessionPlans(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionPlansResponse> {
  return apiRequest<SessionPlansResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/plans`, {
      baseUrl,
      query: {
        source: options.source,
        sandbox: options.sandbox,
      },
    });
}

export function getSessionPlanText(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<string> {
  return apiRequest<string>(`/api/sessions/${encodeURIComponent(sessionId)}/plan`, {
      baseUrl,
      query: {
        source: options.source,
        sandbox: options.sandbox,
      },
    });
}

export function upsertSessionPlan(
  payload: SessionPlanMutationPayload,
  baseUrl?: string
): Promise<SessionPlanMutationResponse> {
  return apiRequest<SessionPlanMutationResponse>('/api/sessions/plan', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function getSessionAgentUsage(
  sessionId: string,
  options: SessionAgentUsageQueryOptions = {},
  baseUrl?: string
): Promise<SessionAgentUsageResponse> {
  return apiRequest<SessionAgentUsageResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/agent-usage`, {
      baseUrl,
      query: {
        source: options.source,
        sandbox: options.sandbox,
        limit: options.limit,
      },
    });
}

export function getSessionStructuredState(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionStructuredStateResponse> {
  return apiRequest<SessionStructuredStateResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/structured-state`,
    {
        baseUrl,
        query: {
          source: options.source,
          sandbox: options.sandbox,
          planId: options.planId,
        },
      }
  );
}

export function getSessionProposition(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionPropositionResponse> {
  return apiRequest<SessionPropositionResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/proposition`, {
    baseUrl,
    query: {
      source: options.source,
      sandbox: options.sandbox,
    },
  });
}

export function getSessionHandoff(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionHandoffResponse> {
  return apiRequest<SessionHandoffResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/handoff`, {
    baseUrl,
    query: {
      source: options.source,
      sandbox: options.sandbox,
    },
  });
}

export function getSessionVerificationGuide(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionTextArtifactResponse> {
  return apiRequest<SessionTextArtifactResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/verification-guide`,
    {
      baseUrl,
      query: {
        source: options.source,
        sandbox: options.sandbox,
      },
    }
  );
}
