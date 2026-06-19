import { ApiError, apiRequest } from './core';

export type OrchestratorAdapterId = 'opencode-acp' | 'codex-exec' | 'native';

export interface OrchestratorEvent {
  schemaVersion: string;
  eventId: number;
  sessionId: string;
  eventType: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface OrchestratorSession {
  schemaVersion: string;
  sessionId: string;
  repoId: string;
  title: string;
  adapterId: OrchestratorAdapterId;
  state: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  planning: Record<string, unknown> | null;
  workPoints: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  inputRequests: Array<Record<string, unknown>>;
  events: OrchestratorEvent[];
}

export interface OrchestratorHealth {
  schemaVersion: string;
  ok: boolean;
  planning: {
    compatible: boolean;
    negotiated: boolean;
    cliPath?: string | null;
  };
  adapters: Array<{
    adapterId: OrchestratorAdapterId;
    available: boolean;
    unavailableReason?: string | null;
  }>;
  journal: { ready: boolean; journalCount: number };
  orphanRecovery: { ready: boolean; recoverableJournalCount: number };
}

function idempotencyKey(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function commandHeaders(prefix: string): HeadersInit {
  return {
    'content-type': 'application/json',
    'idempotency-key': idempotencyKey(prefix),
  };
}

export async function getOrchestratorHealth(): Promise<OrchestratorHealth> {
  return apiRequest('/api/orchestrator/health');
}

export async function listOrchestratorSessions(): Promise<OrchestratorSession[]> {
  const response = await apiRequest<{ sessions?: OrchestratorSession[] }>('/api/orchestrator/sessions');
  return response.sessions ?? [];
}

export async function getOrchestratorSession(sessionId: string): Promise<OrchestratorSession> {
  return apiRequest(`/api/orchestrator/sessions/${encodeURIComponent(sessionId)}`);
}

export async function createOrchestratorSession(input: {
  repoId: string;
  title: string;
  adapterId: OrchestratorAdapterId;
  planning?: Record<string, unknown>;
}): Promise<OrchestratorSession> {
  return apiRequest('/api/orchestrator/sessions', {
    method: 'POST',
    headers: commandHeaders('create-session'),
    body: JSON.stringify(input),
  });
}

export async function mutateOrchestratorSession(
  session: OrchestratorSession,
  action: 'retry' | 'resume' | 'cancel' | 'approvals' | 'input' | 'work-points',
  payload: Record<string, unknown> = {},
): Promise<OrchestratorSession> {
  return apiRequest(
    `/api/orchestrator/sessions/${encodeURIComponent(session.sessionId)}/${action}`,
    {
      method: 'POST',
      headers: commandHeaders(action),
      body: JSON.stringify({ ...payload, expectedRevision: session.revision }),
    },
  );
}

export function readOrchestratorError(error: unknown): {
  code: string | null;
  message: string;
  details: Record<string, unknown> | null;
} {
  if (error instanceof ApiError && error.payload && typeof error.payload === 'object') {
    const payload = error.payload as Record<string, unknown>;
    return {
      code: typeof payload.code === 'string' ? payload.code : error.code ?? null,
      message: typeof payload.message === 'string' ? payload.message : error.message,
      details: payload.details && typeof payload.details === 'object'
        ? payload.details as Record<string, unknown>
        : null,
    };
  }
  return {
    code: null,
    message: error instanceof Error ? error.message : 'Orchestrator request failed',
    details: null,
  };
}

export function openOrchestratorEventStream(
  sessionId: string,
  handlers: {
    onOpen: () => void;
    onEvent: (event: OrchestratorEvent) => void;
    onError: () => void;
  },
): () => void {
  const source = new EventSource(
    `/api/orchestrator/sessions/${encodeURIComponent(sessionId)}/events`,
  );
  source.onopen = handlers.onOpen;
  source.onerror = handlers.onError;
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as OrchestratorEvent);
    } catch {
      handlers.onError();
    }
  };
  const eventTypes = [
    'session-created',
    'work-point-added',
    'approval-recorded',
    'input-recorded',
    'retry-requested',
    'resume-requested',
    'cancel-requested',
  ];
  for (const eventType of eventTypes) {
    source.addEventListener(eventType, (message) => {
      try {
        handlers.onEvent(JSON.parse((message as MessageEvent).data) as OrchestratorEvent);
      } catch {
        handlers.onError();
      }
    });
  }
  return () => source.close();
}
