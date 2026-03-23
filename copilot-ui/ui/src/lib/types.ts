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
}

export interface SessionSummary {
  id: string;
  source?: 'cli' | 'vscode' | 'sandbox' | string;
  sandbox?: string | null;
  active?: boolean;
  startedAtMs?: number;
  updatedAtMs?: number;
  [key: string]: unknown;
}

export interface SessionsListResponse {
  sessions: SessionSummary[];
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
  validationEvidence?: string[];
  followUps?: SessionClosureFollowUps;
  blockers?: string[];
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
  cliVersion?: string;
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
  [key: string]: unknown;
}

export interface SdkSessionsResponse {
  sessions: SdkSessionSummary[];
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

export interface CatalogBundleMember {
  assetId: string;
  assetKey?: string;
  kind?: string;
  title?: string;
  available?: boolean;
  installed?: boolean;
  enabled?: boolean;
  selectedLayer?: string | null;
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
  assetIds?: string[];
  installTarget?: string;
  activationScope?: string;
  materialization?: string;
  classification?: string | null;
  targeting?: Record<string, unknown>;
  tags?: string[];
  defaultRecommended?: boolean;
  dependsOn?: string[];
  defaultMemberLoadMode?: string | null;
  uninstallPolicy?: Record<string, unknown>;
  activationStatus?: string;
  activationSource?: string | null;
  selected?: boolean;
  status?: string;
  stats?: CatalogBundleStats;
  members?: CatalogBundleMember[];
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

export interface CatalogBundlesResponse {
  kind?: string;
  deterministic?: boolean;
  filters?: Record<string, unknown>;
  count: number;
  snapshot?: CatalogSnapshotEnvelope;
  bundles: CatalogBundle[];
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
  conflictCount?: number;
  appliedCount?: number;
  deletedCount?: number;
  skippedCount?: number;
  cursor?: string;
  updatedAt?: string;
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
  cliManualCommand?: {
    exitCode?: number | null;
    durationMs?: number;
  } | null;
}

export interface ObsidianPlanningSyncResponse extends ObsidianPlanningStatusResponse {
  result: ObsidianPlanningSyncResult | null;
}

export interface PlanningRepoSummary {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  [key: string]: unknown;
}

export interface PlanningRepositoryBacklogRef {
  canonicalName: 'Repository Backlog';
  repo: PlanningRepoSummary;
  filePath: string;
  repoRelativePath: 'docs/backlog.md';
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
  repoRelativePath: 'docs/roadmaps';
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

export interface PlanningBacklogSummary {
  backlogPath?: string | null;
  repoRelativePath?: string;
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
  repo: PlanningRepoSummary | null;
  backlog: PlanningBacklogSummary;
  [key: string]: unknown;
}

export interface PlanningBacklogMutationResponse extends PlanningBacklogResponse {
  item?: PlanningBacklogItem | null;
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
