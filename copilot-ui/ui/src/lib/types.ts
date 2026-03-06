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
  name: string;
  fileName: string;
  absPath: string;
}

export interface InstalledSkill {
  name: string;
  absPath: string;
  kind: 'pointer' | 'full' | string;
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
  name: string;
  kind: 'pointer' | 'full' | string;
  triggers?: string;
  absPath?: string;
  vaultPath?: string | null;
  [key: string]: unknown;
}

export interface SkillsPreviewResponse {
  skills: SkillPreviewItem[];
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
