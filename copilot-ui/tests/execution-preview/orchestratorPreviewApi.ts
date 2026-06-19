type PreviewState =
  | 'normal'
  | 'waiting-input'
  | 'validation-failed'
  | 'stale-approval'
  | 'disconnected'
  | 'completed';

const state = (new URLSearchParams(window.location.search).get('state') || 'normal') as PreviewState;

const session = {
  schemaVersion: 'orchestrator-session/v1',
  sessionId: 'session-preview',
  repoId: 'repo-1',
  title: 'Implement approval-safe execution',
  adapterId: 'codex-exec',
  state: state === 'completed' ? 'completed' : 'running',
  revision: 8,
  createdAt: '2026-06-19T08:00:00Z',
  updatedAt: '2026-06-19T08:18:00Z',
  planning: {
    goalId: 'harness-execution-orchestrator-v1',
    roadmapId: 'harness-execution-orchestrator-roadmap',
    workPointId: 'ORCH-014-execution-workspace-ui',
  },
  workPoints: [{
    workPointId: 'ORCH-014-execution-workspace-ui',
    lease: { status: 'healthy' },
    validation: { status: state === 'validation-failed' ? 'failed' : 'passed' },
    evidence: {
      changedPaths: [
        'copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx',
        'copilot-ui/ui/src/lib/api/orchestrator.ts',
      ],
      diffHash: '43dcd8f2e495f4dc',
      resultTreeSha: 'cb28c227cd2a38ab',
    },
  }],
  approvals: state === 'stale-approval'
    ? [{ status: 'stale', summary: 'Target HEAD moved after approval issuance.' }]
    : [{ status: 'pending', summary: 'Approve the verified local commit.' }],
  inputRequests: state === 'waiting-input'
    ? [{ status: 'pending', prompt: 'Choose whether to retry the failed validation lane.' }]
    : [],
  events: [
    { schemaVersion: 'orchestrator-api-event/v1', eventId: 1, sessionId: 'session-preview', eventType: 'session-created', occurredAt: '2026-06-19T08:00:00Z', data: {} },
    { schemaVersion: 'orchestrator-api-event/v1', eventId: 2, sessionId: 'session-preview', eventType: 'work-point-added', occurredAt: '2026-06-19T08:05:00Z', data: {} },
    { schemaVersion: 'orchestrator-api-event/v1', eventId: 3, sessionId: 'session-preview', eventType: 'approval-recorded', occurredAt: '2026-06-19T08:18:00Z', data: {} },
  ],
};

export async function getOrchestratorHealth() {
  return {
    schemaVersion: 'orchestrator-health/v1',
    ok: state !== 'disconnected',
    planning: { compatible: true, negotiated: false },
    adapters: [
      { adapterId: 'native', available: true },
      { adapterId: 'codex-exec', available: true },
      { adapterId: 'opencode-acp', available: true },
    ],
    journal: { ready: true, journalCount: 1 },
    orphanRecovery: { ready: true, recoverableJournalCount: 0 },
  };
}

export async function listOrchestratorSessions() {
  return [session];
}

export async function getOrchestratorSession() {
  return session;
}

export async function createOrchestratorSession() {
  return session;
}

export async function mutateOrchestratorSession() {
  return session;
}

export function openOrchestratorEventStream(_sessionId: string, handlers: {
  onOpen: () => void;
  onError: () => void;
}) {
  queueMicrotask(() => {
    if (state === 'disconnected') handlers.onError();
    else handlers.onOpen();
  });
  return () => {};
}

export function readOrchestratorError(error: unknown) {
  return {
    code: null,
    message: error instanceof Error ? error.message : 'Preview error',
    details: null,
  };
}
