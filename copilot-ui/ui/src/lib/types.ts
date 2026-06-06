export interface VersionResponse {
  version: number;
  lastChangedMs: number | null;
}

export interface HealthResponse {
  ok: boolean;
  now: number;
  engineRoot: string;
  copilotHome: string;
  vscodeHome: string;
  changes: VersionResponse | null;
  runtime: Record<string, unknown>;
  policy: Record<string, unknown>;
  planningPersistence: Record<string, unknown>;
  planningDurabilityDependencyGate?: Record<string, unknown> | string | null;
  startupManagedAssetSync?: Record<string, unknown> | null;
  autonomousDecisionLog?: Record<string, unknown> | null;
}

export interface SessionSummary {
  id: string;
  source?: 'cli' | 'vscode' | 'sandbox' | string;
  sandbox?: string | null;
  active?: boolean;
  startedAtMs?: number;
  updatedAtMs?: number;
  orchestration?: SessionOrchestrationProjection | Record<string, unknown> | null;
  worktree?: WorktreeBinding | null;
  isRemote?: boolean;
  remoteUrl?: string | null;
  [key: string]: unknown;
}

export interface SessionOrchestrationRepoContext {
  repoId?: string | null;
  repoPath?: string | null;
  repoLabel?: string | null;
  branch?: string | null;
  source?: string | null;
  [key: string]: unknown;
}

export interface SessionOrchestrationIsolationContext {
  mode?: string | null;
  contextType?: string | null;
  sandboxId?: string | null;
  worktreeId?: string | null;
  worktreePath?: string | null;
  worktreeStatus?: string | null;
  launchBlocked?: boolean;
  launchBlockedReason?: string | null;
  worktree?: WorktreeBinding | null;
  [key: string]: unknown;
}

export interface SessionOrchestrationActor {
  actorId: string;
  label?: string | null;
  role?: string | null;
  kind?: string | null;
  status?: string | null;
  source?: string | null;
  taskId?: string | null;
  taskIds?: string[];
  invocationCount?: number | null;
  [key: string]: unknown;
}

export interface SessionOrchestrationTaskBoardItem {
  taskId: string;
  title?: string | null;
  status?: string | null;
  ownerSessionId?: string | null;
  activeActorId?: string | null;
  activeActorLabel?: string | null;
  workflow?: Record<string, unknown> | null;
  worktree?: WorktreeBinding | null;
  linkedPlanning?: Record<string, unknown> | null;
  durablePath?: string | null;
  projection?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SessionOrchestrationWorkflowRun {
  runId?: string | null;
  jobId?: string | null;
  repoId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  nextRetryAt?: string | null;
  summary?: string | null;
  error?: string | null;
  createdSession?: boolean;
  workflow?: Record<string, unknown> | null;
  taskRefs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface SessionOrchestrationProjection {
  contractVersion?: string | null;
  sessionId?: string | null;
  objective?: string | null;
  authority?: Record<string, unknown> | null;
  repo?: SessionOrchestrationRepoContext | null;
  isolation?: SessionOrchestrationIsolationContext | null;
  actors?: {
    items?: SessionOrchestrationActor[];
    activeActorId?: string | null;
    [key: string]: unknown;
  } | null;
  taskBoard?: {
    durableStore?: string | null;
    repoId?: string | null;
    items?: SessionOrchestrationTaskBoardItem[];
    [key: string]: unknown;
  } | null;
  workflow?: {
    workflowKind?: string | null;
    trigger?: string | null;
    mode?: string | null;
    runId?: string | null;
    jobId?: string | null;
    status?: string | null;
    runs?: SessionOrchestrationWorkflowRun[];
    [key: string]: unknown;
  } | null;
  overlays?: {
    sessions?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface PlanningTaskBoardResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  projection: SessionOrchestrationProjection;
}

export interface PlanningLiveValidationFinding {
  findingId?: string;
  entityType?: string;
  entityId?: string;
  severity?: string;
  code?: string;
  message?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PlanningLiveValidationSummary {
  status?: string | null;
  findings: PlanningLiveValidationFinding[];
  [key: string]: unknown;
}

export interface PlanningLiveGoal {
  id: string;
  correlationId?: string | null;
  title?: string | null;
  description?: string | null;
  acceptanceCriteria: string[];
  rejectionCriteria: string[];
  status?: string | null;
  tags: string[];
  revision?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningLiveRoadmapSummary {
  id: string;
  goalId?: string | null;
  correlationId?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  tags: string[];
  revision?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningLiveRoadmapSection {
  id?: string | null;
  roadmapId?: string | null;
  title?: string | null;
  summary?: string | null;
  ordering?: number | null;
  [key: string]: unknown;
}

export interface PlanningLiveWorkPoint {
  id: string;
  roadmapId?: string | null;
  sectionId?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  ordering?: number | null;
  dependencyIds: string[];
  validationExpectations: string[];
  tags: string[];
  revision?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningLivePlanSummary {
  id: string;
  goalId?: string | null;
  roadmapId?: string | null;
  correlationId?: string | null;
  title?: string | null;
  summary?: string | null;
  scope?: string | null;
  assumptions: string[];
  stopConditions: string[];
  validationSteps: string[];
  targetedWorkPointIds: string[];
  status?: string | null;
  tags: string[];
  revision?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningLiveTodo {
  id: string;
  planId?: string | null;
  workPointId?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  priority?: string | null;
  evidenceRefs: string[];
  tags: string[];
  ordering?: number | null;
  revision?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningLiveReviewPoint {
  id: string;
  [key: string]: unknown;
}

export interface PlanningLiveRoadmapsResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  count: number;
  roadmaps: PlanningLiveRoadmapSummary[];
  [key: string]: unknown;
}

export interface PlanningLiveRoadmapResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  roadmap: PlanningLiveRoadmapSummary | null;
  sections: PlanningLiveRoadmapSection[];
  workPoints: PlanningLiveWorkPoint[];
  validation: PlanningLiveValidationSummary | null;
  [key: string]: unknown;
}

export interface PlanningLiveGoalResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  goal: PlanningLiveGoal | null;
  roadmaps: PlanningLiveRoadmapSummary[];
  validation: PlanningLiveValidationSummary | null;
  [key: string]: unknown;
}

export interface PlanningLivePlansResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  filters?: {
    goalId?: string;
    roadmapId?: string;
    [key: string]: unknown;
  } | null;
  count: number;
  plans: PlanningLivePlanSummary[];
  [key: string]: unknown;
}

export interface PlanningLivePlanResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  plan: PlanningLivePlanSummary | null;
  todos: PlanningLiveTodo[];
  reviewPoints: PlanningLiveReviewPoint[];
  validation: PlanningLiveValidationSummary | null;
  [key: string]: unknown;
}

export interface PlanningLiveTodosResponse {
  contractVersion?: string | null;
  kind?: string | null;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  filters?: {
    roadmapId?: string;
    planId?: string;
    workPointId?: string;
    [key: string]: unknown;
  } | null;
  count: number;
  todos: PlanningLiveTodo[];
  [key: string]: unknown;
}

export interface SessionsListResponse {
  sessions: SessionSummary[];
}

export interface SessionsWorkspaceRepoSummary {
  repoId?: string | null;
  repoPath?: string | null;
  repoLabel?: string | null;
}

export interface SessionsWorkspaceRepoModel {
  primaryRepo: SessionsWorkspaceRepoSummary | null;
  linkedRepos: SessionsWorkspaceRepoSummary[];
}

export interface SessionsWorkspaceEntryDetail {
  source?: string | null;
  sandbox?: string | null;
  canOpenArtifacts?: boolean;
  handoffTarget?: string | null;
}

export interface SessionsWorkspaceEntry {
  entryId: string;
  sessionId?: string | null;
  linkedSessionId?: string | null;
  kind: 'artifact' | 'archive' | 'sdk' | 'overlay' | string;
  title: string;
  status: string;
  source: string;
  sourceLabel?: string | null;
  startedAt?: number | string | null;
  updatedAt?: number | string | null;
  workspace: SessionsWorkspaceRepoModel;
  detail: SessionsWorkspaceEntryDetail;
  runtimeAuthority?: boolean;
  durable?: boolean;
  archive?: boolean;
  archiveId?: string | null;
}

export interface SessionsWorkspaceResponse {
  active: SessionsWorkspaceEntry[];
  history: SessionsWorkspaceEntry[];
  authorityModel?: Record<string, unknown>;
}

export interface WorktreeLaunchState {
  blocked: boolean;
  reason: string | null;
}

export interface WorktreeBinding {
  contractVersion?: string | null;
  worktreeId?: string | null;
  mode?: string | null;
  path?: string | null;
  worktreePath?: string | null;
  status?: string | null;
  branch?: string | null;
  launch?: WorktreeLaunchState | null;
  launchBlocked?: boolean;
  launchBlockedReason?: string | null;
  assignment?: Record<string, unknown> | null;
  cleanup?: Record<string, unknown> | null;
  recovery?: Record<string, unknown> | null;
  lifecycle?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export type UiRuntimeOverlayObservationKind = 'snapshot' | 'interaction' | 'state' | 'locator' | 'note' | string;

export type UiRuntimeOverlayAnnotationStatus = 'open' | 'resolved' | 'dismissed' | string;

export type UiRuntimeOverlayChangeRequestStatus = 'draft' | 'reserved' | 'queued' | 'completed' | 'dismissed' | string;

export type UiRuntimeOverlayQualitySignalSeverity = 'info' | 'warning' | 'error' | string;

export interface UiRuntimeOverlayLocator {
  selector: string | null;
  role: string | null;
  label: string | null;
  text: string | null;
  testId: string | null;
  componentName: string | null;
}

export interface UiRuntimeOverlayInteraction {
  action: string | null;
  outcome: string | null;
  latencyMs: number | null;
}

export interface UiRuntimeOverlayObservationState {
  kind: string | null;
  detail: string | null;
}

export interface UiRuntimeOverlayObservation {
  id: string;
  kind: UiRuntimeOverlayObservationKind;
  summary: string;
  locator: UiRuntimeOverlayLocator | null;
  snapshotSummary: string | null;
  interaction: UiRuntimeOverlayInteraction | null;
  state: UiRuntimeOverlayObservationState | null;
  createdAt: string;
  updatedAt: string;
}

export interface UiRuntimeOverlayAnnotation {
  id: string;
  observationId: string | null;
  title: string;
  message: string;
  status: UiRuntimeOverlayAnnotationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UiRuntimeOverlayChangeRequest {
  id: string;
  observationId: string | null;
  annotationId: string | null;
  title: string;
  request: string;
  prompt: string | null;
  status: UiRuntimeOverlayChangeRequestStatus;
  executorJobId: string | null;
  executorRunId: string | null;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
}

export interface UiRuntimeOverlayQualitySignal {
  id: string;
  observationId: string;
  kind: string;
  severity: UiRuntimeOverlayQualitySignalSeverity;
  summary: string;
  createdAt: string;
}

export interface UiRuntimeOverlaySession {
  id: string;
  status: 'attached' | 'closed' | string;
  runtimeUrl: string;
  runtimeOrigin?: string | null;
  repoId: string;
  repoPath: string;
  repoLabel: string;
  packageRoot: string;
  linkedSessionId?: string | null;
  worktree?: WorktreeBinding | null;
  phase?: string | null;
  evidence?: Record<string, unknown> | null;
  observations: UiRuntimeOverlayObservation[];
  annotations: UiRuntimeOverlayAnnotation[];
  changeRequests: UiRuntimeOverlayChangeRequest[];
  qualitySignals: UiRuntimeOverlayQualitySignal[];
  lastAnalyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  [key: string]: unknown;
}

export interface UiRuntimeOverlaySessionsResponse {
  sessions: UiRuntimeOverlaySession[];
}

export interface CreateUiRuntimeOverlaySessionPayload {
  runtimeUrl: string;
  packageRoot?: string;
  linkedSessionId?: string;
  worktree?: WorktreeBinding | null;
}

export interface CreateUiRuntimeOverlayObservationPayload {
  kind: UiRuntimeOverlayObservationKind;
  summary: string;
  locator?: Partial<UiRuntimeOverlayLocator>;
  snapshotSummary?: string;
  interaction?: Partial<UiRuntimeOverlayInteraction>;
  state?: Partial<UiRuntimeOverlayObservationState>;
}

export interface CreateUiRuntimeOverlayAnnotationPayload {
  observationId?: string;
  title?: string;
  message: string;
  status?: UiRuntimeOverlayAnnotationStatus;
}

export interface CreateUiRuntimeOverlayChangeRequestPayload {
  observationId?: string;
  annotationId?: string;
  title?: string;
  request: string;
  prompt?: string;
  status?: UiRuntimeOverlayChangeRequestStatus;
}

export interface UiRuntimeOverlaySessionMutationResponse {
  session: UiRuntimeOverlaySession;
}

export interface UiRuntimeOverlayObservationMutationResponse {
  session: UiRuntimeOverlaySession;
  observation: UiRuntimeOverlayObservation;
  qualitySignals: UiRuntimeOverlayQualitySignal[];
}

export interface UiRuntimeOverlayAnnotationMutationResponse {
  session: UiRuntimeOverlaySession;
  annotation: UiRuntimeOverlayAnnotation;
}

export interface UiRuntimeOverlayChangeRequestMutationResponse {
  session: UiRuntimeOverlaySession;
  changeRequest: UiRuntimeOverlayChangeRequest;
}

export interface UiRuntimeOverlayQueueChangeRequestResponse {
  session: UiRuntimeOverlaySession;
  changeRequest: UiRuntimeOverlayChangeRequest;
  job: ExecutorJob | null;
  run: ExecutorRun | null;
}

export interface SessionPlanArtifact {
  id: string;
  kind?: string;
  status?: string | null;
  verdict?: string | null;
  source?: string;
  bytes?: number;
  updatedMs?: number | null;
  sessionStatus?: string | null;
  [key: string]: unknown;
}

export interface SessionPlansResponse {
  id: string;
  source: string;
  plans: SessionPlanArtifact[];
}

export interface SessionEvent {
  type?: string;
  event?: string;
  name?: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  time?: string;
  ts?: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SessionEventsResponse {
  id: string;
  source: string;
  events: SessionEvent[];
}

export interface SessionStructuredNextUnit {
  workUnitId?: string;
  workUnitIds?: string[];
  parallelCandidate?: boolean;
  rationale?: string;
  [key: string]: unknown;
}

export interface SessionExecutionStateRef {
  id?: string | null;
  label?: string | null;
  status?: string | null;
  summary?: string | null;
  [key: string]: unknown;
}

export interface SessionExecutionStateBlocker {
  label: string;
  details?: string | null;
  severity?: string | null;
  [key: string]: unknown;
}

export interface SessionExecutionStateNode {
  id: string;
  kind?: string | null;
  label?: string | null;
  status?: string | null;
  summary?: string | null;
  active?: boolean;
  current?: boolean;
  next?: boolean;
  blocked?: boolean;
  children?: SessionExecutionStateNode[];
  [key: string]: unknown;
}

export interface SessionExecutionState {
  schemaVersion?: string | null;
  updatedAt?: string | null;
  lifecycle?: string | null;
  status?: string | null;
  mode?: string | null;
  summary?: string | null;
  activeGroup?: SessionExecutionStateRef | null;
  activeWorkUnit?: SessionExecutionStateRef | null;
  lastCompletedUnit?: SessionExecutionStateRef | null;
  nextUnit?: SessionStructuredNextUnit | null;
  blockers?: SessionExecutionStateBlocker[];
  replanCount?: number | null;
  tree?: SessionExecutionStateNode[];
  [key: string]: unknown;
}

export interface SessionStructuredExecutionOverlay {
  present?: boolean;
  applied?: boolean;
  warnings?: string[];
  diagnostics?: SessionExecutionOverlayDiagnostics | null;
  [key: string]: unknown;
}

export interface SessionExecutionOverlayRecoveryDiagnostics {
  status?: string | null;
  resumable?: boolean | null;
  reason?: string | null;
  [key: string]: unknown;
}

export interface SessionExecutionOverlayIntegrityDiagnostics {
  status?: string | null;
  warningCount?: number | null;
  duplicateNodeIdCount?: number | null;
  conflictingCurrentCount?: number | null;
  [key: string]: unknown;
}

export interface SessionExecutionOverlayQueueDiagnostics {
  depth?: number | null;
  nextUnitCount?: number | null;
  nextUnitIds?: string[];
  [key: string]: unknown;
}

export interface SessionExecutionOverlayOverlapDiagnostics {
  boundedPreviewIds?: string[];
  parallelCandidateCount?: number | null;
  [key: string]: unknown;
}

export interface SessionExecutionOverlayDiagnostics {
  recovery?: SessionExecutionOverlayRecoveryDiagnostics | null;
  integrity?: SessionExecutionOverlayIntegrityDiagnostics | null;
  queue?: SessionExecutionOverlayQueueDiagnostics | null;
  blockedNodeCount?: number | null;
  overlap?: SessionExecutionOverlayOverlapDiagnostics | null;
  [key: string]: unknown;
}

export interface SessionArtifactSection {
  title: string;
  key?: string;
  content: string;
  items?: string[];
  [key: string]: unknown;
}

export interface SessionPropositionEntry {
  heading: string;
  occurredAt?: string | null;
  phase?: string | null;
  agent?: string | null;
  sections: SessionArtifactSection[];
  [key: string]: unknown;
}

export interface SessionHandoffManifest {
  session?: string | null;
  plan?: string | null;
  planStatus?: string | null;
  reviewer?: string | null;
  [key: string]: unknown;
}

export interface SessionParsedHandoff {
  manifest?: SessionHandoffManifest | null;
  sections?: SessionArtifactSection[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface SessionStructuredReviewLedgerRow {
  round?: string;
  reviewer?: string;
  verdict?: string;
  requiredRevisions?: string;
  resolution?: string;
  [key: string]: unknown;
}

export interface SessionStructuredReviewLedger {
  rows?: SessionStructuredReviewLedgerRow[];
  approved?: boolean;
  warnings?: string[];
  [key: string]: unknown;
}

export interface SessionStructuredResume {
  ready?: boolean;
  blockers?: string[];
  [key: string]: unknown;
}

export interface SessionIntentFrame {
  summary?: string | null;
  inScope?: string[];
  outOfScope?: string[];
  successSignals?: string[];
  validationRequirements?: string[];
  constraints?: string[];
  risks?: string[];
  watchOuts?: string[];
  carryoverSignals?: string[];
  keyDecisions?: string[];
  contextSignals?: string[];
  nextSuggestedUnits?: string[];
  resumeReady?: boolean | null;
  resumeBlockers?: string[];
  reviewApproved?: boolean | null;
  planStatus?: string | null;
  sourceArtifacts?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface SessionClosureFollowUps {
  activeContinuation?: string[];
  durableCarryover?: string[];
  [key: string]: unknown;
}

export interface SessionClosureSummary {
  summary?: string | null;
  outcome?: string | null;
  delivered?: string[];
  requested?: string[];
  changedFiles?: string[];
  whereToVerify?: string[];
  validationRequirements?: string[];
  validationCoverage?: string[];
  validationEvidence?: string[];
  followUps?: SessionClosureFollowUps;
  blockers?: string[];
  coverageGaps?: string[];
  limitations?: string[];
  confidence?: string | null;
  reviewApproved?: boolean | null;
  reviewVerdict?: string | null;
  sourceArtifacts?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface SessionStructuredMeta {
  reviewLedger?: SessionStructuredReviewLedger;
  handoff?: SessionParsedHandoff | null;
  resume?: SessionStructuredResume;
  intentFrame?: SessionIntentFrame | null;
  closureSummary?: SessionClosureSummary | null;
  executionState?: SessionExecutionState | null;
  executionOverlay?: SessionStructuredExecutionOverlay | null;
  [key: string]: unknown;
}

export interface SessionStructuredStateResponse {
  id: string;
  source: string;
  planId?: string;
  nextUnit?: SessionStructuredNextUnit | null;
  warnings?: string[];
  meta?: SessionStructuredMeta;
  orchestration?: SessionOrchestrationProjection | Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface SessionTextArtifactResponse {
  id: string;
  source: string;
  content: string;
  [key: string]: unknown;
}

export interface SessionAgentUsageResponse {
  id: string;
  source: string;
  usage: Record<string, number>;
  skillUsage?: SessionSkillUsageSummary | null;
  [key: string]: unknown;
}

export interface SessionSkillUsageEntry {
  assetId: string;
  assetKey?: string | null;
  assetKind?: string | null;
  invocationCount: number;
  lastInvokedAt?: string | null;
  toolNames?: string[];
  [key: string]: unknown;
}

export interface SessionSkillUsageSummary {
  contractVersion?: string;
  sessionId?: string | null;
  totalInvocations: number;
  uniqueSkillCount: number;
  skills: SessionSkillUsageEntry[];
  [key: string]: unknown;
}

export interface SessionPropositionResponse extends SessionTextArtifactResponse {
  entries?: SessionPropositionEntry[];
  latestEntry?: SessionPropositionEntry | null;
}

export interface SessionHandoffResponse extends SessionTextArtifactResponse {
  parsed?: SessionParsedHandoff;
}

export interface SdkHealthResponse {
  connected: boolean;
  enabled?: boolean;
  state: string;
  reason?: string;
  mode?: string;
  sessionCount?: number;
  error?: string;
  [key: string]: unknown;
}

export type DesktopUpdaterStatus =
  | 'idle'
  | 'checking'
  | 'blocked'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export interface DesktopUpdaterState {
  supported: boolean;
  status: DesktopUpdaterStatus;
  channel: string;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  transferredBytes: number | null;
  totalBytes: number | null;
  message: string | null;
  reason: string | null;
  lastUpdatedAtMs: number | null;
  canCheckForUpdates: boolean;
  canDownload: boolean;
  canRestartToUpdate: boolean;
}

export interface SdkSessionSummary {
  sessionId: string;
  model?: string | null;
  createdAt?: string;
  sseClientCount?: number;
  contextType?: string;
  sandboxId?: string | null;
  cwd?: string | null;
  isRemote?: boolean;
  remoteUrl?: string | null;
  orchestration?: SessionOrchestrationProjection | Record<string, unknown> | null;
  worktree?: WorktreeBinding | null;
  [key: string]: unknown;
}

export interface SdkSessionsResponse {
  sessions: SdkSessionSummary[];
}

export interface SdkModelsResponse {
  models: string[];
}

export interface SdkSendResponse {
  messageId: string;
}

export interface ExecutorRetryPolicy {
  enabled: boolean;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterRatio: number;
}

export interface ExecutorHealthResponse {
  enabled: boolean;
  state: string;
  jobCount: number;
  runCount: number;
  activeRunCount: number;
  scheduledJobCount: number;
  openedSessionCount: number;
  worktreeCount?: number;
  activeWorktreeCount?: number;
  pendingWorktreeCount?: number;
  lastError?: string | null;
  statePath?: string;
  [key: string]: unknown;
}

export interface ExecutorRunEvent {
  at: string;
  type: string;
  level?: 'debug' | 'info' | 'warn' | 'error' | 'success' | string;
  message: string;
  data?: Record<string, unknown> | null;
}

export interface ExecutorRun {
  id: string;
  jobId: string;
  repoId?: string | null;
  repoPath?: string | null;
  orchestration?: Record<string, unknown> | null;
  worktree?: WorktreeBinding | null;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  nextRetryAt?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  error?: string | null;
  summary?: string | null;
  createdSession?: boolean;
  events: ExecutorRunEvent[];
}

export interface ExecutorJob {
  id: string;
  title: string;
  prompt: string;
  repoId?: string | null;
  repoPath?: string | null;
  orchestration?: Record<string, unknown> | null;
  worktree?: WorktreeBinding | null;
  targetType: 'create-session' | 'existing-session' | string;
  existingSessionId?: string | null;
  model?: string | null;
  contextType?: string | null;
  sandboxId?: string | null;
  scheduleAt?: string | null;
  retryPolicy: ExecutorRetryPolicy;
  createdAt: string;
  updatedAt: string;
  lastRunId?: string | null;
  activeRunId?: string | null;
  status: string;
}

export interface ExecutorJobsResponse {
  jobs: ExecutorJob[];
}

export interface ExecutorRunsResponse {
  runs: ExecutorRun[];
}

export interface CreateExecutorJobPayload {
  title?: string;
  prompt: string;
  targetType?: 'create-session' | 'existing-session';
  existingSessionId?: string;
  model?: string;
  contextType?: string;
  sandboxId?: string;
  scheduleAt?: string;
  retryPolicy?: Partial<ExecutorRetryPolicy>;
  repoId?: string;
  repoPath?: string;
  orchestration?: Record<string, unknown>;
  worktree?: WorktreeBinding | null;
}

export interface CreateExecutorJobResponse {
  job: ExecutorJob;
  run?: ExecutorRun | null;
}

export interface TriggerExecutorJobResponse {
  run: ExecutorRun;
}

export interface CancelExecutorJobResponse {
  job: ExecutorJob;
  run?: ExecutorRun | null;
}

export interface ExecutorWorktreeRecord extends WorktreeBinding {
  repoId?: string | null;
  repoPath?: string | null;
  repoLabel?: string | null;
  updatedAt?: string | null;
  path?: string | null;
  worktreePath?: string | null;
  source?: string | null;
  mode?: string | null;
  branch?: string | null;
  status?: string | null;
  head?: string | null;
  detached?: boolean | null;
  git?: ExecutorWorktreeGitSnapshot | null;
  discovery?: string | null;
  lifecycle?: Record<string, unknown> | null;
  validation?: Record<string, unknown> | null;
  _discovered?: boolean;
  _discoveredOnly?: boolean;
  _merged?: 'persisted' | 'discovered' | 'both' | null;
  _stableOrder?: number | null;
}

export interface ExecutorWorktreeGitSnapshot {
  head?: string | null;
  detached?: boolean;
  bare?: boolean;
  locked?: string | null;
  prunable?: string | null;
  guid?: string | null;
  branch?: string | null;
  ahead?: number;
  behind?: number;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  changed?: number;
  probeError?: string | null;
  mtimeMs?: number | null;
}

export interface ExecutorWorktreeDiscovery {
  contractVersion: string;
  repoId: string | null;
  repoPath: string | null;
  gitListOk: boolean | null;
  gitListError: string | null;
  persistedCount: number;
  discoveredCount: number;
}

export interface ExecutorWorktreesResponse {
  worktrees: ExecutorWorktreeRecord[];
  worktreeDiscovery?: ExecutorWorktreeDiscovery | null;
}

export interface ResolveExecutorWorktreePayload {
  repoId?: string;
  repoPath?: string;
  repoLabel?: string;
  mode?: string;
  worktree?: WorktreeBinding | null;
}

export interface ResolveExecutorWorktreeResponse {
  repo?: Record<string, unknown> | null;
  cwd?: string | null;
  worktree?: ExecutorWorktreeRecord | null;
}

export interface SdkRelayEvent {
  sessionId: string;
  type: string;
  event: {
    type?: string;
    data?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type SdkStreamStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'paused'
  | 'error'
  | 'unsupported';

export interface SdkMessageEntry {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'unknown';
  content: string;
  reasoning?: string;
  createdAtMs: number;
  status: 'streaming' | 'complete' | 'error';
  eventType?: string;
}

export interface ManagedAssetStatus {
  id: string;
  type: 'agent' | 'skill' | 'prompt' | string;
  source: string;
  destination: string;
  sourceAbs?: string;
  destinationAbs?: string;
  managed: boolean;
  installed: boolean;
  upToDate: boolean;
  sourceHash?: string | null;
  destinationHash?: string | null;
  [key: string]: unknown;
}

export interface ManagedAssetsResponse {
  managed: ManagedAssetStatus[];
}

export interface ToolingManagedSkillAsset {
  id: string;
  upToDate: boolean;
  installed: boolean;
  source: string;
  destination: string;
  destinationPath?: string | null;
}

export interface ToolingPlanningCliStatus {
  cliPath: string | null;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  canUpdate: boolean;
  lastError: string | null;
  features?: {
    required: string[];
    missing: string[];
    complete: boolean;
  };
  managedSource?: {
    repoRoot: string | null;
    gitHead: string | null;
    installedGitHead: string | null;
    updateAvailable: boolean;
    kind?: string | null;
    remote?: string | null;
  };
  installMetadata?: Record<string, unknown> | null;
}

export interface ToolingSkillsAssetsStatus {
  trackedCount: number;
  outdatedCount: number;
  updateAvailable: boolean;
  canUpdate: boolean;
  source?: string | null;
  sourceRemote?: string | null;
  managedSource?: {
    repoRoot: string | null;
    gitHead: string | null;
    installedGitHead: string | null;
    updateAvailable: boolean;
    kind?: string | null;
    remote?: string | null;
  };
  assets: ToolingManagedSkillAsset[];
  lastError: string | null;
}

export interface ToolingUpdatesStatusResponse {
  checkedAtMs: number;
  elegyPlanningCli: ToolingPlanningCliStatus;
  elegySkillsAssets: ToolingSkillsAssetsStatus;
  codexSkillsAssets?: ToolingSkillsAssetsStatus | { error: string } | null;
}

export interface ToolingUpdateActionResponse {
  ok: boolean;
  status?: ToolingUpdatesStatusResponse;
  downloadedPath?: string;
  installMetadata?: unknown;
  syncResult?: unknown;
  surfaceResults?: unknown[];
  error?: string;
}

export interface CliToolingTool {
  id: string;
  title: string | null;
  installed: boolean;
  path: string | null;
  version: string | null;
  lastError: string | null;
  error?: string;
}

export interface CliToolingStatusResponse {
  ok: boolean;
  tools: CliToolingTool[];
  checkedAt: string;
}

export interface CliToolingInstallResponse {
  ok: boolean;
  toolId: string;
  title: string;
  npmPackage: string;
  command?: string;
  output?: string;
  dryRun?: boolean;
  error?: string;
}

export interface InstalledAgent {
  assetId?: string;
  name: string;
  fileName: string;
  absPath: string;
  provider?: string;
  sourcePackage?: string;
  namespace?: string;
  readOnly?: boolean;
}

export interface InstalledSkill {
  assetId?: string;
  name: string;
  absPath: string;
  kind: 'pointer' | 'full' | string;
  viewPath?: string;
  provider?: string;
  sourcePackage?: string;
  namespace?: string;
  readOnly?: boolean;
}

export interface InstalledPrompt {
  name: string;
  fileName: string;
  absPath: string;
}

export interface InstalledInstructions {
  installed: boolean;
  absPath: string;
}

export interface InstalledAssetsResponse {
  agents: InstalledAgent[];
  skills: InstalledSkill[];
  prompts: InstalledPrompt[];
  instructions: InstalledInstructions;
}

export type InstallSurfaceTarget = 'codex' | 'antigravity' | 'opencode' | 'all';

export interface InstallSurfaceRunSummary {
  homeKind?: string;
  home?: string;
  result?: unknown;
  [key: string]: unknown;
}

export interface InstallSurfaceSummary {
  surface: string;
  ok?: boolean;
  dryRun?: boolean;
  force?: boolean;
  runs?: InstallSurfaceRunSummary[];
  settingsPatch?: Record<string, unknown> | null;
  homes?: Record<string, unknown>;
  counts?: Record<string, number>;
  instructions?: Record<string, unknown> | null;
  assets?: unknown[];
  [key: string]: unknown;
}

export interface InstallSurfacesResponse {
  target: InstallSurfaceTarget;
  dryRun: boolean;
  force: boolean;
  surfaces: InstallSurfaceSummary[];
}

export type SandboxLifecycleAction =
  | 'create'
  | 'start'
  | 'stop'
  | 'open-terminal'
  | 'pr-open'
  | string;

export interface SandboxLifecyclePayload {
  sandboxId?: string;
  baseBranch?: string;
  headBranch?: string;
  [key: string]: unknown;
}

export interface SandboxLifecycleResponse {
  ok?: boolean;
  sandboxId?: string;
  result?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LspConfigResponse {
  config: Record<string, unknown>;
}

export interface LspInstallResponse {
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  error?: string | null;
  [key: string]: unknown;
}

export interface TrackerPermission {
  id?: string;
  callbackId?: string;
  summary?: string;
  description?: string;
  title?: string;
  sessionId?: string;
  sandboxId?: string;
  [key: string]: unknown;
}

export interface TrackerPermissionsResponse {
  permissions: TrackerPermission[];
}

export interface TrackerSession {
  id?: string;
  sessionId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface TrackerSessionsResponse {
  sessions: TrackerSession[];
}

export interface SyncedNoteSourceLocator {
  provider: string;
  host: string;
  owner: string;
  repo: string;
  branch: string;
  notesPath: string;
}

export interface SyncedNoteSourceRecord extends SyncedNoteSourceLocator {
  id: string;
  localCheckoutPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncedNoteSourceDeleteResponse {
  ok: boolean;
  id: string;
}

export interface SkillPreviewItem {
  assetId?: string;
  name: string;
  kind: 'pointer' | 'full' | string;
  loadMode?: 'always' | 'on-demand' | string;
  availability?: string;
  description?: string;
  triggers?: string;
  absPath?: string;
  vaultPath?: string | null;
  viewPath?: string;
  provider?: string;
  sourcePackage?: string;
  namespace?: string;
  readOnly?: boolean;
  [key: string]: unknown;
}

export interface SkillsPreviewResponse {
  skills: SkillPreviewItem[];
}

export interface CatalogFileDescription {
  path: string | null;
  exists: boolean;
  size: number | null;
  updatedAt: string | null;
  [key: string]: unknown;
}

export interface CatalogScope {
  kind: string;
  repoId?: string;
  repoPath?: string;
  displayName?: string;
  [key: string]: unknown;
}

export interface CatalogRepoContext {
  repoId?: string;
  repoPath?: string;
  repoLabel?: string;
  [key: string]: unknown;
}

export interface CatalogInstallState {
  availability?: string;
  isInstalled?: boolean;
  isAutoLoaded?: boolean;
  materialization?: string;
  contentHash?: string;
  sourcePath?: string;
  installedPaths?: Record<string, string>;
  [key: string]: unknown;
}

export interface CatalogEntry {
  assetId: string;
  assetKey?: string;
  kind: string;
  title?: string;
  description?: string;
  layer?: string;
  scope?: CatalogScope;
  contentPath?: string;
  installState?: CatalogInstallState;
  lifecycle?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  targeting?: Record<string, unknown>;
  overlay?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogReason {
  code?: string;
  layer?: string | null;
  message?: string;
  [key: string]: unknown;
}

export interface CatalogEffectiveAsset {
  assetId: string;
  assetKey: string;
  kind: string;
  scope?: CatalogScope;
  selectedEntry?: CatalogEntry | null;
  selectedLayer?: string;
  installState?: CatalogInstallState;
  recommendations?: unknown[];
  contributingEntries?: CatalogEntry[];
  suppressedEntries?: CatalogEntry[];
  available?: boolean;
  installed?: boolean;
  enabled?: boolean;
  recommended?: boolean;
  deprecated?: boolean;
  overridden?: boolean;
  hiddenFromAutoLoad?: boolean;
  labels?: string[];
  reasons?: CatalogReason[];
  [key: string]: unknown;
}

export interface CatalogBundleMember {
  assetId: string;
  assetKey?: string;
  kind?: string;
  title?: string;
  description?: string;
  available?: boolean;
  installed?: boolean;
  enabled?: boolean;
  loadMode?: string | null;
  defaultLoadMode?: string | null;
  missing?: boolean;
  [key: string]: unknown;
}

export interface CatalogBundleStats {
  memberCount?: number;
  availableCount?: number;
  installedCount?: number;
  enabledCount?: number;
  missingCount?: number;
  [key: string]: unknown;
}

export interface CatalogBundle {
  bundleId: string;
  title?: string;
  description?: string;
  installTarget?: string;
  activationScope?: string;
  activationStatus?: string;
  activationSource?: string | null;
  materialization?: string;
  classification?: string | null;
  targeting?: Record<string, unknown>;
  defaultRecommended?: boolean;
  dependsOn?: string[];
  defaultMemberLoadMode?: string | null;
  uninstallPolicy?: Record<string, unknown>;
  status?: string;
  selected?: boolean;
  members?: CatalogBundleMember[];
  stats?: CatalogBundleStats;
  [key: string]: unknown;
}

export interface CatalogActivationLayerState {
  exists?: boolean;
  active?: boolean;
  path?: string | null;
  plannerProfile?: string | null;
  orchestrationPolicy?: string | null;
  activeBundleIds?: string[] | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface CatalogActivationState {
  schemaVersion?: number;
  plannerProfile: string;
  plannerProfileSource?: string;
  orchestrationPolicy: string;
  orchestrationPolicySource?: string;
  activeBundleIds: string[];
  bundleSource?: string;
  availableBundleIds?: string[];
  availablePlannerProfiles?: string[];
  managedImportProviderIds?: string[];
  globalDefaults?: CatalogActivationLayerState;
  repoOverride?: CatalogActivationLayerState | null;
  [key: string]: unknown;
}

export interface CatalogProviderProjection {
  providerId: string;
  title?: string | null;
  description?: string | null;
  sourceType?: string | null;
  installStrategy?: string | null;
  bridgeStrategy?: string | null;
  activationDefaults?: Record<string, unknown> | null;
  defaultBundles?: string[];
  state?: Record<string, unknown> | null;
  discoveredAssets?: {
    count?: number;
    assetIds?: string[];
    byKind?: Record<string, number>;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CatalogExternalSourceInstallable {
  installableId: string;
  kind: string;
  name?: string;
  title?: string;
  description?: string | null;
  relativePath?: string;
  sourcePath?: string;
  status?: string;
  hiddenByDefault?: boolean;
  deprecated?: boolean;
  setupHints?: string[];
  targetSupport?: string[];
   installCommand?: string;
   verifyCommand?: string;
   bootstrapCommand?: string;
   runtimeChecks?: string[];
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CatalogExternalSourceActivationState {
  installables?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface CatalogExternalSourceProjection {
  sourceId: string;
  title: string;
  description?: string | null;
  url?: string | null;
  sourceType?: string | null;
  owner?: string | null;
  repo?: string | null;
  defaultRef?: string | null;
  editable?: boolean;
  sync?: {
    status?: string | null;
    lastSyncedAt?: string | null;
    lastError?: string | null;
    resolvedRef?: string | null;
    lastVerifiedAt?: string | null;
    verificationStatus?: string | null;
    verificationWarnings?: string[];
    verificationErrors?: string[];
    [key: string]: unknown;
  } | null;
  installables?: CatalogExternalSourceInstallable[];
  activation?: Record<string, CatalogExternalSourceActivationState>;
  [key: string]: unknown;
}

export interface CatalogExternalSourceCheck {
  type?: string;
  name?: string;
  status?: string;
  detail?: string | null;
  target?: string | null;
  command?: string | null;
  installedPath?: string | null;
  repoPath?: string | null;
  url?: string | null;
  exitCode?: number | null;
  [key: string]: unknown;
}

export interface CatalogExternalSourceTargetResult {
  sourceId?: string;
  installableId?: string;
  target?: string;
  overallStatus?: string;
  sourceStatus?: string;
  checks?: CatalogExternalSourceCheck[];
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
}

export interface CatalogExternalSourceInstallableResult {
  installableId?: string;
  kind?: string;
  overallStatus?: string;
  sourceStatus?: string;
  targets?: CatalogExternalSourceTargetResult[];
  checks?: CatalogExternalSourceCheck[];
  warnings?: string[];
  errors?: string[];
  [key: string]: unknown;
}

export interface CatalogGlobalHarness {
  harnessId: string;
  title: string;
  homePath?: string | null;
  skillsHomePath?: string | null;
  supportsMcp?: boolean;
  [key: string]: unknown;
}

export interface CatalogGlobalHarnessActions {
  canInstall?: boolean;
  canActivate?: boolean;
  canDeactivate?: boolean;
  canSync?: boolean;
  [key: string]: unknown;
}

export interface CatalogGlobalHarnessState {
  harnessId: string;
  title: string;
  supported: boolean;
  expected?: boolean;
  installed?: boolean;
  active?: boolean;
  syncStatus?: 'synced' | 'missing' | 'installed' | 'active' | 'available' | 'unsupported' | string;
  installPath?: string | null;
  actions?: CatalogGlobalHarnessActions;
  detail?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CatalogGlobalItemActions {
  kind?: 'catalog-asset' | 'install-surface' | 'external-source' | string;
  installAssetId?: string | null;
  installSurfaceTargets?: string[];
  [key: string]: unknown;
}

export interface CatalogGlobalItemDetail {
  itemType?: string | null;
  readPath?: string | null;
  scopeKind?: string | null;
  scopeKinds?: string[];
  [key: string]: unknown;
}

export interface CatalogGlobalItem {
  itemId: string;
  conceptualKey?: string;
  itemKey: string;
  kind: 'skill' | 'agent' | 'mcp' | string;
  title: string;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  providerId?: string | null;
  readPath?: string | null;
  detail?: CatalogGlobalItemDetail | Record<string, unknown> | null;
  actions?: CatalogGlobalItemActions | null;
  central?: boolean;
  keyFeature?: boolean;
  keyFeatureLabel?: string | null;
  keyFeatureOrder?: number | null;
  scopeKinds?: string[];
  syncStatus?: string | null;
  expectedHarnessCount?: number;
  missingHarnessCount?: number;
  installedHarnessCount?: number;
  supportedHarnessCount?: number;
  harnessStates?: CatalogGlobalHarnessState[];
  [key: string]: unknown;
}

export interface CatalogGlobalSection {
  kind: 'skill' | 'agent' | 'mcp' | string;
  title: string;
  count: number;
  items: CatalogGlobalItem[];
  [key: string]: unknown;
}

export interface CatalogGlobalInventory {
  harnesses: CatalogGlobalHarness[];
  sections: CatalogGlobalSection[];
  [key: string]: unknown;
}

export interface CatalogSnapshotWarningSummary {
  count: number;
  items: unknown[];
  [key: string]: unknown;
}

export interface CatalogSnapshotFreshness {
  status: string;
  ageMs: number | null;
  latestInputAt: string | null;
  reasons: string[];
  [key: string]: unknown;
}

export interface CatalogRuntimeRebuildState {
  status: string;
  refreshCount: number;
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessfulAt: string | null;
  lastDurationMs: number | null;
  lastReason: string | null;
  lastError: string | null;
  lastSnapshotPath: string | null;
  [key: string]: unknown;
}

export interface CatalogSnapshotStats {
  entryCount?: number;
  effectiveCount?: number;
  byLayer?: Record<string, number>;
  byKind?: Record<string, number>;
  enabledCount?: number;
  installedCount?: number;
  recommendedCount?: number;
  overriddenCount?: number;
  bundles?: {
    totalCount?: number;
    defaultRecommendedCount?: number;
    activeCount?: number;
    installedCount?: number;
    availableCount?: number;
    partialCount?: number;
    missingCount?: number;
    memberCount?: number;
    availableMemberCount?: number;
    installedMemberCount?: number;
    enabledMemberCount?: number;
    missingMemberCount?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CatalogSnapshotEnvelope {
  schemaVersion: number | null;
  generatedAt: string | null;
  readMode?: string;
  repoContext?: CatalogRepoContext | null;
  activation?: CatalogActivationState;
  providers?: CatalogProviderProjection[];
  externalSources?: CatalogExternalSourceProjection[];
  globalInventory?: CatalogGlobalInventory;
  storage?: {
    catalogRoot?: string;
    snapshotPath?: string;
    snapshotExists?: boolean;
    [key: string]: unknown;
  };
  stats?: CatalogSnapshotStats | null;
  warnings?: CatalogSnapshotWarningSummary;
  inputs?: {
    manifest?: CatalogFileDescription;
    metadataIndex?: CatalogFileDescription;
    registry?: CatalogFileDescription;
    snapshot?: CatalogFileDescription;
    [key: string]: CatalogFileDescription | undefined;
  };
  freshness?: CatalogSnapshotFreshness;
  rebuild?: CatalogRuntimeRebuildState;
  [key: string]: unknown;
}

export interface CatalogSummaryResponse {
  kind?: string;
  deterministic?: boolean;
  summary: CatalogSnapshotEnvelope;
  [key: string]: unknown;
}

export interface CatalogAssetsResponse {
  kind?: string;
  deterministic?: boolean;
  filters?: Record<string, unknown>;
  count: number;
  snapshot?: CatalogSnapshotEnvelope;
  assets: CatalogEffectiveAsset[];
  [key: string]: unknown;
}

export interface CatalogBundlesResponse {
  kind?: string;
  deterministic?: boolean;
  filters?: Record<string, unknown>;
  count: number;
  snapshot?: CatalogSnapshotEnvelope;
  bundles: CatalogBundle[];
  [key: string]: unknown;
}

export interface CatalogAssetDetailResponse {
  kind?: string;
  deterministic?: boolean;
  asset?: CatalogEffectiveAsset;
  entries?: CatalogEntry[];
  snapshot?: CatalogSnapshotEnvelope;
  [key: string]: unknown;
}

export interface CatalogRefreshResponse {
  kind?: string;
  deterministic?: boolean;
  refreshed?: boolean;
  audit?: {
    logged?: boolean;
    path?: string;
    eventId?: string;
    error?: string | null;
    [key: string]: unknown;
  };
  snapshot?: CatalogSnapshotEnvelope;
  [key: string]: unknown;
}

export interface CatalogSearchExplanation {
  code?: string;
  weight?: number;
  message?: string;
  layer?: string | null;
  [key: string]: unknown;
}

export interface CatalogSearchResult {
  rank: number;
  assetId: string;
  entry?: CatalogEntry | null;
  effectiveState?: CatalogEffectiveAsset | null;
  score: number;
  explanations: CatalogSearchExplanation[];
  [key: string]: unknown;
}

export interface CatalogSearchRequest {
  query: string;
  kind?: string;
  repoId?: string;
  repoPath?: string;
  frameworks?: string[];
  stacks?: string[];
  tags?: string[];
  limit?: number;
  includeVaultOnly?: boolean;
  includeDisabled?: boolean;
  includeDeprecated?: boolean;
  preferLoadMode?: string;
  sessionId?: string;
  correlationId?: string;
}

export interface CatalogSearchResponse {
  kind?: string;
  deterministic?: boolean;
  query?: Record<string, unknown>;
  count: number;
  results: CatalogSearchResult[];
  snapshot?: CatalogSnapshotEnvelope;
  audit?: {
    logged?: boolean;
    path?: string;
    eventIds?: string[];
    errors?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CatalogSearchSelectionResult {
  assetId?: string;
  score?: number;
  rank?: number;
  explanations?: CatalogSearchExplanation[];
  effectiveState?: {
    assetKey?: string;
    kind?: string;
    scope?: {
      repoId?: string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  entry?: {
    assetKey?: string;
    kind?: string;
    scope?: {
      repoId?: string | null;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CatalogSearchSelectionPayload {
  query?: Partial<CatalogSearchRequest> | Record<string, unknown>;
  searchQuery?: Partial<CatalogSearchRequest> | Record<string, unknown>;
  result?: CatalogSearchSelectionResult | null;
  resultCount?: number;
  assetId?: string;
  assetKey?: string;
  [key: string]: unknown;
}

export interface CatalogSearchSelectionResponse {
  kind?: string;
  deterministic?: boolean;
  recorded?: boolean;
  telemetry?: {
    path?: string;
    eventId?: string;
    [key: string]: unknown;
  };
  audit?: {
    logged?: boolean;
    path?: string;
    eventId?: string;
    error?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CatalogAuditEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor?: Record<string, unknown>;
  assetId?: string;
  assetKey?: string;
  assetKind?: string;
  scope?: CatalogScope;
  repoId?: string;
  sessionId?: string;
  correlationId?: string;
  search?: Record<string, unknown>;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogAuditEventsResponse {
  kind?: string;
  deterministic?: boolean;
  filters?: Record<string, unknown>;
  count: number;
  storage?: {
    path?: string;
    exists?: boolean;
    [key: string]: unknown;
  };
  events: CatalogAuditEvent[];
  [key: string]: unknown;
}

export interface CatalogAuditSearchSummary {
  queryCount?: number;
  searchedCount?: number;
  resultCount?: number;
  selectedCount?: number;
  missCount?: number;
  [key: string]: unknown;
}

export interface CatalogAuditAssetSearchSummary {
  sampled?: CatalogAuditSearchSummary | null;
  lastEventAt?: string | null;
  [key: string]: unknown;
}

export interface CatalogAuditUsageSummary {
  invocationCount?: number;
  explicitInvocationCount?: number;
  proxyInvocationCount?: number;
  proxyInferredCount?: number;
  sessionCount?: number;
  repoCount?: number;
  evidence?: string;
  [key: string]: unknown;
}

export interface CatalogAuditAssetSummary {
  assetId: string;
  assetKey?: string | null;
  kind?: string | null;
  current?: {
    enabled?: boolean;
    installed?: boolean;
    available?: boolean;
    recommended?: boolean;
    selectedLayer?: string | null;
    scope?: CatalogScope | null;
    title?: string | null;
    description?: string | null;
    [key: string]: unknown;
  };
  lifecycle?: {
    counts?: Record<string, number>;
    lastEventAt?: string | null;
    [key: string]: unknown;
  };
  search?: CatalogAuditAssetSearchSummary | null;
  usage?: CatalogAuditUsageSummary | null;
  activity?: {
    repoIds?: string[];
    sessionIds?: string[];
    [key: string]: unknown;
  };
  recentEvents?: CatalogAuditEvent[];
  [key: string]: unknown;
}

export interface CatalogAuditRepoSummary {
  repoId?: string | null;
  repoLabel?: string | null;
  assetIds?: string[];
  sessionIds?: string[];
  lifecycle?: Record<string, number>;
  search?: CatalogAuditSearchSummary | null;
  usage?: CatalogAuditUsageSummary | null;
  lastEventAt?: string | null;
  [key: string]: unknown;
}

export interface CatalogAuditSessionSummary {
  sessionId?: string | null;
  status?: string | null;
  startTime?: string | null;
  lastEventTime?: string | null;
  repoId?: string | null;
  repoLabel?: string | null;
  assetIds?: string[];
  search?: CatalogAuditSearchSummary | null;
  usage?: CatalogAuditUsageSummary | null;
  [key: string]: unknown;
}

export interface CatalogAssetAuditAnalytics {
  contractVersion?: string;
  generatedAt?: string;
  deterministic?: boolean;
  filters?: Record<string, unknown>;
  telemetry?: {
    contractVersion?: string | null;
    sample?: Record<string, unknown> | null;
    countersByEventType?: Record<string, number>;
    countersByMissReason?: Record<string, number>;
    [key: string]: unknown;
  };
  stats?: {
    assetCount?: number;
    repoCount?: number;
    sessionCount?: number;
    auditEventCount?: number;
    sampledSearchEventCount?: number;
    [key: string]: unknown;
  };
  assets: CatalogAuditAssetSummary[];
  repos: CatalogAuditRepoSummary[];
  sessions: CatalogAuditSessionSummary[];
  recentEvents: CatalogAuditEvent[];
  [key: string]: unknown;
}

export interface CatalogAssetAuditAnalyticsResponse {
  kind?: string;
  deterministic?: boolean;
  snapshot?: CatalogSnapshotEnvelope | null;
  analytics?: CatalogAssetAuditAnalytics | null;
  [key: string]: unknown;
}

export interface RuntimeCatalogHealthResponse {
  kind?: string;
  deterministic?: boolean;
  ok: boolean;
  error?: string;
  projection?: CatalogSnapshotEnvelope | null;
  audit?: {
    path?: string;
    exists?: boolean;
    updatedAt?: string | null;
    size?: number | null;
    [key: string]: unknown;
  };
  changes?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CatalogMutationAuditResult {
  logged?: boolean;
  path?: string;
  eventId?: string;
  lifecycleEventIds?: string[];
  lifecycleErrors?: string[];
  error?: string | null;
  [key: string]: unknown;
}

export interface CatalogMutationRefreshResult {
  selector?: {
    repoId?: string | null;
    repoPath?: string | null;
    [key: string]: unknown;
  };
  snapshot?: CatalogSnapshotEnvelope | null;
  [key: string]: unknown;
}

export interface CatalogAssetMutationResponse {
  kind?: string;
  deterministic?: boolean;
  action?: string;
  authoringScope?: string;
  assetId?: string;
  assetKey?: string;
  assetKind?: string;
  scope?: CatalogScope;
  loadMode?: string | null;
  contentHash?: string | null;
  sourceHash?: string | null;
  registryHash?: string | null;
  repoId?: string | null;
  installedPaths?: string[];
  refreshes?: CatalogMutationRefreshResult[];
  audit?: CatalogMutationAuditResult;
  [key: string]: unknown;
}

export interface CatalogProviderInstallResponse {
  kind?: string;
  deterministic?: boolean;
  action?: string;
  providerId?: string;
  provider?: Record<string, unknown>;
  state?: Record<string, unknown>;
  commands?: Array<Record<string, unknown>>;
  snapshot?: CatalogSnapshotEnvelope;
  error?: string;
  [key: string]: unknown;
}

export interface CatalogContentQuery {
  mode: 'absolute' | 'engine' | 'external-source';
  path: string;
  sourceId?: string;
}

export interface CatalogSourcesListResponse {
  kind?: string;
  deterministic?: boolean;
  count: number;
  sources: CatalogExternalSourceProjection[];
  storage?: {
    catalogPath?: string;
    userSourcesPath?: string;
    statePath?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CatalogSourceDetailResponse {
  kind?: string;
  deterministic?: boolean;
  source?: CatalogExternalSourceProjection;
  storage?: {
    catalogPath?: string;
    userSourcesPath?: string;
    statePath?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CatalogSourceMutationResponse {
  kind?: string;
  deterministic?: boolean;
  source?: CatalogExternalSourceProjection | Record<string, unknown>;
  snapshot?: Record<string, unknown>;
   overallStatus?: string;
   sourceStatus?: string;
   installables?: CatalogExternalSourceInstallableResult[];
   targets?: CatalogExternalSourceTargetResult[];
   checks?: CatalogExternalSourceCheck[];
   warnings?: string[];
   errors?: string[];
  userSourcesPath?: string;
  sourceId?: string;
  removed?: boolean;
  [key: string]: unknown;
}

export interface CatalogSourceInstallableMutationResponse {
  kind?: string;
  deterministic?: boolean;
  source?: CatalogExternalSourceProjection | Record<string, unknown>;
  installable?: CatalogExternalSourceInstallable | Record<string, unknown>;
  target?: string;
  materialized?: Record<string, unknown>;
  removed?: Record<string, unknown>;
  state?: Record<string, unknown>;
   overallStatus?: string;
   sourceStatus?: string;
   checks?: CatalogExternalSourceCheck[];
   warnings?: string[];
   errors?: string[];
   bootstrap?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogActivationMutationResponse {
  kind?: string;
  deterministic?: boolean;
  action?: string;
  bundleId?: string;
  plannerProfile?: string;
  orchestrationPolicy?: string;
  activeBundleIds?: string[];
  scope?: CatalogScope;
  repoId?: string | null;
  refreshes?: CatalogMutationRefreshResult[];
  audit?: CatalogMutationAuditResult;
  [key: string]: unknown;
}

export interface CatalogBundleUninstallResponse {
  kind?: string;
  deterministic?: boolean;
  action?: string;
  bundleId?: string;
  scope?: CatalogScope;
  repoId?: string | null;
  removedAssetIds?: string[];
  removedPaths?: string[];
  removedCount?: number;
  skippedAssetIds?: string[];
  activationStateCleared?: boolean;
  repoActivationCleared?: boolean;
  overlayStateCleared?: boolean;
  preserveExternalPackages?: boolean;
  refreshes?: CatalogMutationRefreshResult[];
  audit?: CatalogMutationAuditResult;
  [key: string]: unknown;
}

export interface CatalogRepoAssetSummary {
  hasRepoAssets?: boolean;
  hasSkills?: boolean;
  hasAgents?: boolean;
  skillCount?: number;
  agentCount?: number;
  overlayEnabledCount?: number;
  overlayDisabledCount?: number;
  skillsPath?: string | null;
  agentsPath?: string | null;
  [key: string]: unknown;
}

export interface CatalogRepoHints {
  stacks?: string[];
  frameworks?: string[];
  languages?: string[];
  targets?: string[];
  [key: string]: unknown;
}

export interface CatalogRepoInventoryEntry {
  repoId?: string | null;
  repoPath?: string | null;
  repoLabel?: string | null;
  selected?: boolean;
  registered?: boolean;
  sources?: string[];
  exists?: boolean;
  gitRootPresent?: boolean;
  scanStatus?: string;
  lastSeenAt?: string | null;
  lastRefreshAt?: string | null;
  assets?: CatalogRepoAssetSummary;
  hints?: CatalogRepoHints;
  snapshot?: Record<string, unknown>;
  repoState?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CatalogRepoInventoryStorage {
  path?: string;
  exists?: boolean;
  [key: string]: unknown;
}

export interface CatalogRepoInventoryWorkspaceScan {
  storage?: CatalogRepoInventoryStorage;
  defaultRoots?: string[];
  customScanRoots?: string[];
  scanRoots?: string[];
  [key: string]: unknown;
}

export interface CatalogReposListResponse {
  kind?: string;
  deterministic?: boolean;
  count?: number;
  selectedRepo?: CatalogRepoInventoryEntry | null;
  storage?: CatalogRepoInventoryStorage;
  workspaceScan?: CatalogRepoInventoryWorkspaceScan | null;
  repos: CatalogRepoInventoryEntry[];
  [key: string]: unknown;
}

export interface CatalogRepoMutationResponse {
  kind?: string;
  deterministic?: boolean;
  registered?: boolean;
  removed?: boolean;
  refreshed?: boolean;
  selected?: boolean;
  selectionCleared?: boolean;
  repo?: CatalogRepoInventoryEntry | null;
  selectedRepo?: CatalogRepoInventoryEntry | null;
  storage?: CatalogRepoInventoryStorage;
  workspaceScan?: CatalogRepoInventoryWorkspaceScan | null;
  snapshot?: CatalogSnapshotEnvelope | null;
  audit?: CatalogMutationAuditResult;
  [key: string]: unknown;
}

export interface CatalogRepoScanRootsMutationResponse extends CatalogReposListResponse {
  updated?: boolean;
}

export interface PolicyPreflightResponse {
  ok: boolean;
  status: string;
  reason: string;
  message: string;
  checkedAt?: string;
  validatorPath?: string;
  exitCode?: number;
  [key: string]: unknown;
}

export interface PlanningRepoSummary {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  [key: string]: unknown;
}

export interface PlanningBacklogKeyPoint {
  date: string;
  text: string;
  [key: string]: unknown;
}

export interface PlanningBacklogItem {
  id: string;
  title: string;
  status: string;
  summary?: string;
  roadmapIds: string[];
  planRefs: string[];
  satisfiedByPlanRef?: string | null;
  supersededByPlanRef?: string | null;
  abandonedByPlanRef?: string | null;
  importance?: number | null;
  keyPoints: PlanningBacklogKeyPoint[];
  [key: string]: unknown;
}

export interface PlanningBacklogDocument {
  backlogPath?: string | null;
  repoRelativePath?: string;
  primaryDirectoryPath?: string | null;
  primaryRepoRelativePath?: string;
  primaryFamilyRepoRelativePath?: string;
  legacyBacklogPath?: string | null;
  legacyRepoRelativePath?: string;
  resolvedBacklogPaths?: string[];
  resolvedRepoRelativePaths?: string[];
  exists: boolean;
  formatVersion?: string;
  title?: string;
  description?: string;
  itemCount: number;
  items: PlanningBacklogItem[];
  [key: string]: unknown;
}

export interface PlanningBacklogResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo?: PlanningRepoSummary | null;
  backlog: PlanningBacklogDocument;
  item?: PlanningBacklogItem | null;
  [key: string]: unknown;
}

export interface PlanningRecordItem {
  recordId: string;
  scope: string;
  ownerId?: string;
  repoId?: string | null;
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
  acceptanceCriteriaText?: string;
  targetRepoIds?: string[];
  state?: string;
  score?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningDraftItem {
  draftId: string;
  title: string;
  summary?: string;
  acceptanceCriteria?: string[];
  acceptanceCriteriaText?: string;
  targetRepoIds?: string[];
  saveRepoId?: string | null;
  state?: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface PlanningLinkedSdkSession {
  sessionId: string;
  repoId?: string | null;
  source: 'compile-selected-ideas';
  createdAt: string;
  selectedIdeaIds: string[];
  selectedIdeaTitles: string[];
  targetRepoIds: string[];
  promptPreview?: string;
}

export type PlanningPlanOriginKind = 'direct' | 'intake' | 'bullet' | 'backlog' | 'roadmap' | 'synced-note';

export interface PlanningLinkedPlanSession {
  sessionId: string;
  repoId?: string | null;
  planPath?: string;
  source:
    | 'create-plan'
    | 'seed-from-intake'
    | 'seed-from-bullet'
    | 'seed-from-backlog'
    | 'seed-from-roadmap'
    | 'seed-from-synced-note';
  originKind?: PlanningPlanOriginKind;
  originArtifactId?: string;
  createdAt: string;
  updatedAt?: string;
  seedArtifactId?: string;
  seedArtifactCategory?: PlanningIntakeCategory;
  seedArtifactTitle?: string;
}

export type ObsidianPlanningSyncState =
  | 'ready'
  | 'not-configured'
  | 'vault-unavailable'
  | 'notes-unavailable';

export type ObsidianPlanningRepresentationKind = 'bullets' | 'roadmap';
export type ObsidianPlanningRepresentationFreshness =
  | 'current'
  | 'stale'
  | 'missing'
  | 'invalid'
  | 'source-missing';

export type ObsidianCliState =
  | 'not-configured'
  | 'configured'
  | 'ready'
  | 'unavailable'
  | 'error';

export type ObsidianRemoteSyncState =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'success'
  | 'error'
  | 'conflict';

export interface ObsidianCliStatus {
  state: ObsidianCliState;
  message: string;
  checkedAt?: string;
  probeConfigured?: boolean;
  syncStatusConfigured?: boolean;
  refreshInventoryConfigured?: boolean;
  manualSyncConfigured?: boolean;
  lastError?: string;
}

export interface ObsidianRemoteSyncStatus {
  state: ObsidianRemoteSyncState;
  configured: boolean;
  pollEnabled: boolean;
  pollIntervalMs?: number;
  syncing?: boolean;
  message: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastManualSyncAt?: string;
  lastError?: string;
  reason?: string;
  nextAttemptAt?: string;
  cooldownUntil?: string;
  retryCount?: number;
  retryLimit?: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  leaseAcquiredAt?: string;
  leaseExpiresAt?: string;
  leaseTrigger?: string;
  lastStaleLeaseRecoveredAt?: string;
  conflictCount?: number;
  appliedCount?: number;
  deletedCount?: number;
  skippedCount?: number;
  cursor?: string;
  updatedAt?: string;
}

export interface ObsidianSyncedNoteSourceRef {
  id: string;
  provider: string;
  host: string;
  owner: string;
  repo: string;
  branch: string;
  notesPath: string;
}

export interface ObsidianSourceResolutionStatus {
  availableSources: ObsidianSyncedNoteSourceRef[];
  activeSourceConfigured: boolean;
  activeSourceId?: string;
  activeSourceMatched?: boolean;
  effectiveSource?: ObsidianSyncedNoteSourceRef | null;
  requiresSource: boolean;
  resolved: boolean;
  reason?: string;
  message: string;
}

export interface ObsidianPlanningStatus {
  state: ObsidianPlanningSyncState;
  configured: boolean;
  readAvailable: boolean;
  syncAvailable: boolean;
  external: true;
  canonicalAuthority: false;
  message: string;
  code?: string;
  configPath?: string;
  vaultName?: string;
  vaultPath?: string;
  notesPathTemplate?: string;
  notesDirectoryPath?: string;
  cliPath?: string;
  syncCommand?: string[];
  cli?: ObsidianCliStatus;
  remoteSync?: ObsidianRemoteSyncStatus;
  sourceResolution?: ObsidianSourceResolutionStatus;
}

export interface ObsidianPlanningNoteSummary {
  kind: 'synced-note';
  provider: 'obsidian';
  id: string;
  title: string;
  summary: string;
  repoId?: string;
  targetRepoIds: string[];
  vaultName: string;
  notePath: string;
  filePath?: string;
  lastModifiedAt?: string;
  external: true;
  canonicalAuthority: false;
}

export interface ObsidianPlanningNoteDetail extends ObsidianPlanningNoteSummary {
  content: string;
  headings: string[];
}

export interface ObsidianPlanningRepresentationSummary {
  kind: 'planning-representation';
  provider: 'obsidian';
  id: string;
  representationKind: ObsidianPlanningRepresentationKind;
  title: string;
  summary: string;
  repoId?: string;
  targetRepoIds: string[];
  roadmapSlug?: string;
  sourceExists: boolean;
  sourceFilePath?: string;
  sourceRepoRelativePath: string;
  sourceUpdatedAt?: string;
  sourceContentHash?: string;
  notePath: string;
  filePath?: string;
  noteExists: boolean;
  noteUpdatedAt?: string;
  generatedAt?: string;
  freshness: ObsidianPlanningRepresentationFreshness;
  metadataValid: boolean;
  external: true;
  canonicalAuthority: false;
  message: string;
  bulletCount?: number;
  itemCount?: number;
}

export interface ObsidianPlanningRepresentationsStatus {
  totalCount: number;
  writeAvailable: boolean;
  currentCount: number;
  staleCount: number;
  missingCount: number;
  invalidCount: number;
  sourceMissingCount: number;
  message: string;
}

export interface ObsidianPlanningStatusResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  status: ObsidianPlanningStatus;
  [key: string]: unknown;
}

export interface ObsidianPlanningRepresentationsStatusResponse extends ObsidianPlanningStatusResponse {
  representationsStatus: ObsidianPlanningRepresentationsStatus;
}

export interface ObsidianPlanningRepresentationsResponse extends ObsidianPlanningRepresentationsStatusResponse {
  count?: number;
  representations: ObsidianPlanningRepresentationSummary[];
}

export interface ObsidianPlanningRepresentationsRefreshResult {
  refreshedCount: number;
  skippedCount: number;
  skippedIds?: string[];
}

export interface ObsidianPlanningRepresentationsRefreshResponse extends ObsidianPlanningRepresentationsResponse {
  result: ObsidianPlanningRepresentationsRefreshResult | null;
}

export interface ObsidianPlanningNotesResponse extends ObsidianPlanningStatusResponse {
  count?: number;
  notes: ObsidianPlanningNoteSummary[];
}

export interface ObsidianPlanningNoteResponse extends ObsidianPlanningStatusResponse {
  note: ObsidianPlanningNoteDetail | null;
}

export interface ObsidianPlanningSyncResult {
  trigger?: string;
  state: ObsidianRemoteSyncState;
  appliedCount: number;
  deletedCount: number;
  skippedCount: number;
  conflictCount: number;
  conflicts?: string[];
  cursor?: string;
  message?: string;
  reason?: string;
  nextAttemptAt?: string;
  cooldownUntil?: string;
  retryCount?: number;
  retryLimit?: number;
  lastFailureAt?: string;
  lastFailureReason?: string;
  leaseAcquiredAt?: string;
  leaseExpiresAt?: string;
  leaseTrigger?: string;
  lastStaleLeaseRecoveredAt?: string;
  cliManualCommand?: {
    exitCode?: number | null;
    durationMs?: number;
  } | null;
}

export interface ObsidianPlanningSyncResponse extends ObsidianPlanningStatusResponse {
  result: ObsidianPlanningSyncResult | null;
}

export interface ObsidianPlanningSourceSelectionResponse extends ObsidianPlanningStatusResponse {
  sourceSelection?: ObsidianSourceResolutionStatus;
}

export interface PlanningRepositoryBacklogRef {
  canonicalName: 'Repository Backlog';
  repo: PlanningRepoSummary;
  filePath: string;
  repoRelativePath: string;
  primaryDirectoryPath?: string;
  primaryRepoRelativePath?: string;
  primaryFamilyRepoRelativePath?: string;
  legacyFilePath?: string;
  legacyRepoRelativePath?: string;
  stableIdPattern: 'RB-###';
}

export type PlanningBulletState = 'idea' | 'research' | 'pre-plan';

export type PlanningIntakeCategory =
  | 'idea'
  | 'research'
  | 'refactor-candidate'
  | 'design-complaint'
  | 'audit-request'
  | 'roadmap-request'
  | 'review-prep'
  | 'commit-prep';

export interface PlanningIntakeDirectoryRef {
  canonicalName: 'Planning Intake';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/planning/intake';
  stableIdPattern: 'PI-###';
  supportedCategories: PlanningIntakeCategory[];
}

export interface PlanningBulletFileRef {
  canonicalName: 'Planning Bullets';
  repo: PlanningRepoSummary;
  filePath: string;
  repoRelativePath: 'docs/planning/bullets.md';
  stableIdPattern: 'PB-###';
  supportedStates: PlanningBulletState[];
}

export interface PlanningRoadmapDirectoryRef {
  canonicalName: 'Roadmap';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/planning';
  stableIdPattern: 'RM-<roadmap-slug>-###';
}

export interface PlanningBullet {
  kind: 'planning.bullet.artifact';
  schemaVersion: number;
  id: string;
  title: string;
  state: PlanningBulletState;
  repoId: string;
  summary: string;
  notes: string[];
  promotedPlanRefs: string[];
  promotedBacklogRefs: string[];
  promotedRoadmapRefs: string[];
  filePath: string;
  repoRelativePath: string;
}

export interface PlanningIntakeArtifact {
  kind: 'planning.intake.artifact';
  schemaVersion: number;
  id: string;
  category: PlanningIntakeCategory;
  title: string;
  summary: string;
  acceptanceCriteria: string[];
  targetRepoIds: string[];
  planningState?: string;
  createdAt: string;
  updatedAt: string;
  filePath: string;
  repoRelativePath: string;
}

export type PlanningIntakeTrackerFilterValue = '__all__' | '__none__';

export interface PlanningIntakeTrackerFilters {
  category: PlanningIntakeCategory | '__all__';
  planningState: string | PlanningIntakeTrackerFilterValue;
  targetRepoId: string | PlanningIntakeTrackerFilterValue;
}

export interface PlanningIntakeSummary {
  directoryPath?: string | null;
  repoRelativePath?: string;
  exists: boolean;
  artifactCount: number;
  stableIdPattern?: string;
  supportedCategories: PlanningIntakeCategory[];
  [key: string]: unknown;
}

export interface PlanningBulletsSummary {
  filePath?: string | null;
  repoRelativePath?: string;
  exists: boolean;
  bulletCount: number;
  stableIdPattern?: string;
  supportedStates: PlanningBulletState[];
  [key: string]: unknown;
}

export interface PlanningIntakeArtifactsResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  count?: number;
  intake: PlanningIntakeSummary;
  artifacts: PlanningIntakeArtifact[];
  artifact?: PlanningIntakeArtifact | null;
  [key: string]: unknown;
}

export interface PlanningBulletsResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  count?: number;
  bullets: PlanningBulletsSummary;
  artifacts: PlanningBullet[];
  artifact?: PlanningBullet | null;
  [key: string]: unknown;
}

export interface SessionPlanMutationResponse {
  sessionId: string;
  source: string;
  planPath: string;
  created: boolean;
  updatedAt: string;
  content: string;
  linkedRepoId?: string;
  linkedRepoPath?: string;
  seededFromArtifactId?: string | null;
  [key: string]: unknown;
}

export interface PlanningRoadmapItem {
  id: string;
  title: string;
  phase: string;
  status: string;
  summary?: string;
  backlogIds: string[];
  planRefs: string[];
  workflowProjection?: PlanningRoadmapWorkflowSliceProjection;
  desync?: PlanningRoadmapWorkflowDesync;
}

export interface PlanningRoadmap {
  slug: string;
  title: string;
  overview?: string;
  filePath: string;
  repoRelativePath: string;
  itemCount: number;
  statusCounts: Record<string, number>;
  items: PlanningRoadmapItem[];
  workflowProjection?: PlanningRoadmapWorkflowProjection;
}

export interface PlanningRoadmapWorkflowArtifactSummary {
  artifactId: string;
  kind: string;
  phase: string;
  status: string;
  normalizedStatus?: string;
  sourceHarness?: string | null;
  sourceModel?: string | null;
  sessionId?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  requiresUserDecision: boolean;
  suggestedNextAction?: string | null;
  acceptance?: {
    allPassed: boolean;
    failedChecks: string[];
    passedChecks?: string[];
  } | null;
}

export interface PlanningRoadmapWorkflowSliceProjection {
  latest: PlanningRoadmapWorkflowArtifactSummary | null;
  history: PlanningRoadmapWorkflowArtifactSummary[];
}

export interface PlanningRoadmapWorkflowDesync {
  statusMismatch: boolean;
  roadmapStatus: string;
  workflowStatus?: string | null;
  reasons: string[];
}

export interface PlanningRoadmapWorkflowProjection {
  artifactCount: number;
  projectedItemCount: number;
  desyncCount: number;
  synced: boolean;
  unmatchedWorkflowArtifacts: Array<{
    sliceId: string;
    history: PlanningRoadmapWorkflowArtifactSummary[];
    reasons: string[];
  }>;
}

export interface PlanningResearchNote {
  id: string;
  phase: string;
  title: string;
  content: string;
  createdAt: string;
  noteId?: string;
  summary?: string;
  sources?: string[];
  source?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PlanningResearchNotesResponse {
  recordId: string;
  researchNotes: PlanningResearchNote[];
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  [key: string]: unknown;
}

export interface PlanningDiagram {
  id: string;
  type: string;
  title: string;
  content: string;
  format: string;
  createdAt: string;
  diagramId?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PlanningDiagramsResponse {
  recordId: string;
  diagrams: PlanningDiagram[];
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  [key: string]: unknown;
}

export interface PlanningSearchResultItem {
  rank: number;
  recordId: string;
  score: number;
  semanticScore?: number;
  lexicalScore?: number;
  scope?: string;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: unknown;
}

export interface PlanningCompareReceipt {
  receiptId?: string;
  gateState?: string;
  reason?: string;
  mergeEligible?: boolean;
  compareHash?: string;
  sourceIdsHash?: string;
  versionVector?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface PlanningMergeIntentToken {
  tokenId: string;
  actorId?: string;
  repoId?: string;
  sourceIdsHash?: string;
  targetId?: string;
  compareHash?: string;
  compareReceiptId?: string;
  issuedAt?: string;
  expiresAt?: string;
  consumedAt?: string | null;
  versionVector?: Record<string, unknown> | null;
  versionVectorHash?: string | null;
  [key: string]: unknown;
}

export interface PlanningRecordsResponse {
  records: PlanningRecordItem[];
  requestedScopes: string[];
  deniedScopes: string[];
  versionVector?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanningSearchResponse {
  results: PlanningSearchResultItem[];
  requestedScopes: string[];
  deniedScopes: string[];
  query?: string;
  versionVector?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanningCreateResponse {
  record?: PlanningRecordItem;
  idempotency?: Record<string, unknown>;
  versionVector?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanningCompareResponse {
  requestedScopes: string[];
  deniedScopes: string[];
  planningRecords: PlanningRecordItem[];
  matches: PlanningSearchResultItem[];
  compareReceipt?: PlanningCompareReceipt | null;
  gateState?: string;
  reason?: string;
  mergeEligible?: boolean;
  downgrade?: Record<string, unknown> | null;
  versionVector?: Record<string, unknown>;
  newerDataAvailable?: boolean;
  implementedOutcomes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanningMergeIntentResponse {
  intentToken?: PlanningMergeIntentToken | null;
  ttlMs?: number;
  gateState?: string;
  downgrade?: Record<string, unknown> | null;
  error?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanningMergeResponse {
  mergeAccepted?: boolean;
  mergeEvent?: Record<string, unknown>;
  mergeRecord?: PlanningRecordItem | null;
  idempotency?: Record<string, unknown>;
  gateState?: string;
  downgrade?: Record<string, unknown> | null;
  error?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayConfig {
  mode?: string;
  acp?: {
    host?: string;
    port?: number;
    [key: string]: unknown;
  };
  discord?: {
    allowlistedUserIds?: string[];
    guildId?: string;
    channelId?: string;
    permissionsChannelId?: string;
    [key: string]: unknown;
  };
  telegram?: {
    allowlistedUserIds?: string[];
    [key: string]: unknown;
  };
  workspaces?: {
    allowedRoots?: string[];
    activeRoot?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GatewayConfigResponse {
  exists: boolean;
  configPath: string;
  config: GatewayConfig | null;
  [key: string]: unknown;
}

export interface CodexProviderGatewayConfig {
  providerId: string;
  model: string;
  baseUrl: string;
  [key: string]: unknown;
}

export interface CodexProviderDeepseekStatus {
  bridgePath: string | null;
  bridgeConfigPath: string | null;
  bridgeUrl: string;
  keyConfigured: boolean;
  bridgeReachable: boolean;
  modelsVisible: boolean;
  bridgeBinaryAvailable: boolean;
  bridgeCheckoutAvailable: boolean;
  bridgeRunning?: boolean;
  probeError?: string | null;
  modelIds?: string[];
  bootstrap?: MoonBridgeBootstrapStatus | null;
}

export interface MoonBridgeBootstrapStatus {
  installRoot: string;
  sourceUrl: string;
  binaryPath: string;
  configPath: string;
  metadataPath: string;
  gitAvailable: boolean;
  goAvailable: boolean;
  installed: boolean;
  built: boolean;
  bundledInstalled: boolean;
  bundledSourceAvailable: boolean;
  lastBootstrapAt: string | null;
  lastError: string | null;
}

export interface CodexProviderStatusResponse {
  codexHome: string;
  configPath: string;
  statePath: string;
  backupPath: string;
  exists: boolean;
  activeMode: 'native' | 'deepseek-bridge' | string;
  providerId: string;
  hasManagedBlock: boolean;
  hasLegacyBlock?: boolean;
  hasBackup: boolean;
  lastAppliedAt?: string | null;
  lastResetAt?: string | null;
  backupCreatedAt?: string | null;
  gateway: CodexProviderGatewayConfig;
  deepseek?: CodexProviderDeepseekStatus;
  changed?: boolean;
  action?: string;
  [key: string]: unknown;
}

export interface GatewaySaveConfigResponse {
  ok?: boolean;
  configPath?: string;
  error?: string;
  [key: string]: unknown;
}

export interface GatewayStateError {
  code?: string;
  reason?: string;
  message?: string;
  statusCode?: number | null;
  [key: string]: unknown;
}

export interface GatewayStateSegment {
  ready?: boolean;
  status?: string;
  statusCode?: number | null;
  error?: GatewayStateError | null;
  [key: string]: unknown;
}

export interface GatewayStateResponse {
  ready?: boolean;
  checkedAt?: string;
  error?: GatewayStateError | null;
  errors?: GatewayStateError[];
  gateway?: GatewayStateSegment & {
    config?: {
      exists?: boolean;
      path?: string;
      mode?: string | null;
      activeRoot?: string | null;
      allowedRootCount?: number;
      [key: string]: unknown;
    };
  };
  tracker?: GatewayStateSegment;
  planningPersistence?: GatewayStateSegment & {
    required?: boolean;
    configured?: boolean;
    usable?: boolean;
    initSupported?: boolean;
    initRequired?: boolean;
  };
  planningAuthority?: GatewayStateSegment & {
    enabled?: boolean;
    configured?: boolean;
    cliPath?: string | null;
    dbPath?: string | null;
    diagnostics?: Record<string, unknown>;
  } | null;
  [key: string]: unknown;
}

export interface GatewayScannedRepo {
  absPath: string;
  name: string;
  isGit?: boolean;
  [key: string]: unknown;
}

export interface GatewayScanRoot {
  scanRoot: string;
  repos: GatewayScannedRepo[];
  [key: string]: unknown;
}

export interface GatewayScanReposResponse {
  roots: GatewayScanRoot[];
  [key: string]: unknown;
}

export interface PlanningPersistenceInitResponse {
  ready?: boolean;
  initialized?: boolean;
  planningPersistence?: Record<string, unknown>;
  error?: Record<string, unknown> | string;
  errors?: unknown[];
  [key: string]: unknown;
}

export interface ToolCallBlock {
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  output?: string;
  status: 'executing' | 'completed' | 'error';
  startedAtMs: number;
  completedAtMs?: number;
}

export interface PendingQuestion {
  questionId: string;
  toolCallId: string;
  question: string;
  options?: Array<{ label: string; value: string; recommended?: boolean }>;
  askedAtMs: number;
  answered: boolean;
  answeredValue?: string;
}

export interface ActivityStreamEntry {
  id: string;
  kind: 'message' | 'tool-call' | 'pending' | 'question';
  timestamp: number;
  message?: SdkMessageEntry;
  toolCall?: ToolCallBlock;
  pendingContent?: string;
  pendingReasoning?: string;
  question?: PendingQuestion;
}

export interface OpenCodeLaneNode {
  id: string;
  label: string;
  kind: 'start' | 'decision' | 'action' | 'gate' | 'optional' | 'escalation';
}

export interface OpenCodeLaneEdge {
  from: string;
  to: string;
  label: string;
}

export interface OpenCodeLane {
  id: string;
  label: string;
  description: string;
  nodes: OpenCodeLaneNode[];
  edges: OpenCodeLaneEdge[];
  modelPolicy: {
    small: string | null;
    big: string | null;
    review: string | null;
  };
  requiredSetup: string[];
  clarificationGates: string[];
  worktreeBehavior: string | null;
  escalationTriggers: string[];
}

export interface OpenCodeProfile {
  id: string;
  label: string;
  description: string;
  route: string;
  smallModel: string;
  bigModel: string;
  reviewModel: string;
}

export interface OpenCodeSetupCheck {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'blocked';
  detail: string;
  action: {
    kind: string;
    label: string;
    target?: string;
  } | null;
}

export interface OpenCodeWarning {
  id: string;
  severity: 'warning' | 'critical';
  title: string;
  detail: string;
  action: OpenCodeSetupCheck['action'];
}

export interface OpenCodeElegyPlanningCli {
  cliPath: string | null;
  currentVersion: string | null;
  canUpdate: boolean;
}

export interface OpenCodeElegySkillsAssets {
  trackedCount: number;
  outdatedCount: number;
  updateAvailable: boolean;
  canUpdate: boolean;
  assets: Array<{
    id: string;
    upToDate: boolean;
    installed: boolean;
    source: string;
    destination: string;
  }>;
}

export interface OpenCodePlanningLiveAuthority {
  ready: boolean;
  state: Record<string, unknown> | null;
}

export interface OpenCodeStatusResponse {
  overallStatus: 'ready' | 'degraded' | 'blocked';
  warnings: OpenCodeWarning[];
  setupChecks: OpenCodeSetupCheck[];
  activeProfileId: string;
  profiles: OpenCodeProfile[];
  availableRoutes: string[];
  lanes: OpenCodeLane[];
  configPreview: Record<string, unknown> | null;
  opencodeHome: string;
  configPath: string;
  smallModel: string;
  bigModel: string;
  isCustomConfig: boolean;
  elegyPlanningCli: OpenCodeElegyPlanningCli;
  elegySkillsAssets: OpenCodeElegySkillsAssets;
  planningLiveAuthority: OpenCodePlanningLiveAuthority;
  opencodeCli?: {
    installed: boolean;
    version: string | null;
    installCommand: string;
    lastError: string | null;
  };
}

export interface OpenCodeConfigPayload {
  profileRoute?: string;
  smallModel?: string;
  bigModel?: string;
}

export interface OpenCodeConfigResponse {
  ok: boolean;
  status: OpenCodeStatusResponse;
}

export interface OpenCodeAssetsInstallResponse {
  ok: boolean;
  syncResult?: unknown;
  status?: OpenCodeStatusResponse;
  error?: string;
}

export type OpenCodeToolingInstallKind = 'elegy-planning-cli' | 'elegy-skills' | 'install-codex-planning';

export interface OpenCodeToolingInstallPayload {
  kind: OpenCodeToolingInstallKind;
  force?: boolean;
}

export interface OpenCodeGoWorkspace {
  id: string;
  label: string;
  workspaceId: string;
  keySource: string;
  keyPresent: boolean;
  active: boolean;
  lastValidatedAt: string | null;
  lastValidatedStatus: string | null;
  lastValidatedMessage: string | null;
}

export interface OpenCodeGoWorkspacesResponse {
  detected: OpenCodeGoWorkspace[];
  registered: OpenCodeGoWorkspace[];
  activeId: string | null;
}

export interface OpenCodeGoWorkspaceCreatePayload {
  label: string;
  workspaceId: string;
  apiKey: string;
  activate?: boolean;
}

export interface OpenCodeGoWorkspaceCreateFlowPayload {
  label: string;
  workspaceId: string;
}

export interface OpenCodeGoWorkspaceActionResponse {
  ok: boolean;
  error?: string;
}

export interface OpenCodeGoWorkspaceCreateFlowResponse {
  ok: boolean;
  draft: OpenCodeGoWorkspace;
  consoleUrl: string;
  authUrl: string;
}

export interface OpenCodeGoWorkspaceValidateResponse {
  status: string;
  message?: string;
}

export interface OpenCodeToolingInstallResponse {
  ok: boolean;
  kind?: OpenCodeToolingInstallKind;
  downloadedPath?: string;
  syncResult?: unknown;
  status?: OpenCodeStatusResponse;
  error?: string;
}

export type OpenCodeTabSectionId = 'overview' | 'lanes' | 'profiles' | 'setup' | 'logs' | 'go-workspaces';

export interface OpenCodeRequestLogEntry {
  timestamp: string;
  level: string;
  provider: string;
  model: string;
  agent: string;
  mode: string;
  sessionId: string;
  small: boolean;
}

export interface OpenCodeRequestLogsResponse {
  requests: OpenCodeRequestLogEntry[];
  total: number;
  logFiles: number;
}

export interface ClaudeCodeCliStatus {
  installed: boolean;
  version: string | null;
  installCommand: string;
  lastError: string | null;
}

export interface ClaudeCodeStatusResponse {
  overallStatus: 'ready' | 'degraded' | 'blocked';
  claudeHome: string;
  claudeConfigPath: string | null;
  cli: ClaudeCodeCliStatus;
}

export interface ClaudeCodeCliInstallResponse {
  ok: boolean;
  version: string | null;
  error: string | null;
  status?: ClaudeCodeStatusResponse;
}
