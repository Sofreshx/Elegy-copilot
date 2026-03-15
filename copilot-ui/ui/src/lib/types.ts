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
  rationale?: string;
  [key: string]: unknown;
}

export interface SessionStructuredStateResponse {
  id: string;
  source: string;
  planId?: string;
  nextUnit?: SessionStructuredNextUnit | null;
  warnings?: string[];
  [key: string]: unknown;
}

export interface SessionTextArtifactResponse {
  id: string;
  source: string;
  content: string;
  [key: string]: unknown;
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
  defaultRecommended?: boolean;
  dependsOn?: string[];
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

export interface CatalogReposListResponse {
  kind?: string;
  deterministic?: boolean;
  count?: number;
  selectedRepo?: CatalogRepoInventoryEntry | null;
  storage?: CatalogRepoInventoryStorage;
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
  snapshot?: CatalogSnapshotEnvelope | null;
  audit?: CatalogMutationAuditResult;
  [key: string]: unknown;
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
