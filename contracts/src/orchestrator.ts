export type OrchestratorAdapterId = 'opencode-acp' | 'codex-exec' | 'native';

export interface ExecutionIdentity {
  repoId: string;
  goalId: string;
  roadmapId: string;
  workPointId: string;
  runId: string;
}

export interface RepositoryState {
  baseHeadSha: string;
  resultTreeSha: string;
  diffHash: string;
  targetHeadSha: string;
}

export interface DispatchRequest {
  schemaVersion: 'orchestrator-dispatch/v1';
  kind: 'dispatch-request';
  identity: ExecutionIdentity;
  adapterId: OrchestratorAdapterId;
  fencingToken: number;
  idempotencyKey: string;
  worktreePath: string;
  fileScopes: string[];
  prompt?: string;
  resumeSessionId?: string | null;
}

export interface EvidenceClaim {
  schemaVersion: 'orchestrator-evidence-claim/v1';
  kind: 'evidence-claim';
  claimId: string;
  claimType: 'worker-reported' | 'orchestrator-observed';
  source: string;
  summary: string;
  command?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

export interface WorkerResult {
  schemaVersion: 'orchestrator-worker-result/v1';
  kind: 'worker-result';
  identity: ExecutionIdentity;
  adapterId: OrchestratorAdapterId;
  status: 'completed' | 'failed' | 'cancelled' | 'timed-out' | 'malformed';
  logicalSessionId?: string | null;
  summary?: string | null;
  observedOutputBytes: number;
  claims: EvidenceClaim[];
}

export interface AdapterCapabilities {
  schemaVersion: 'orchestrator-adapter-capabilities/v1';
  kind: 'adapter-capabilities';
  adapterId: OrchestratorAdapterId;
  available: boolean;
  supportsCancellation: boolean;
  supportsResume: boolean;
  supportsStructuredResult: boolean;
  maxConcurrent: number;
  unavailableReason?: string | null;
}

export interface ExecutionEvent {
  schemaVersion: 'orchestrator-execution-event/v1';
  kind: 'execution-event';
  eventId: string;
  sequence: number;
  identity: ExecutionIdentity;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface ApprovalToken {
  schemaVersion: 'orchestrator-approval/v1';
  kind: 'approval-token';
  tokenId: string;
  identity: ExecutionIdentity;
  repositoryState: RepositoryState;
  expiresAtUnixMs: number;
  idempotencyKey: string;
  binding: string;
  consumedAtUnixMs?: number | null;
}

export interface IdempotencyRecord {
  schemaVersion: 'orchestrator-idempotency/v1';
  kind: 'idempotency-record';
  idempotencyKey: string;
  operation: string;
  payloadHash: string;
  createdAtUnixMs: number;
  response?: unknown;
}

export interface OrchestratorApiError {
  schemaVersion: 'orchestrator-api-error/v1';
  kind: 'api-error';
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown> | null;
}
