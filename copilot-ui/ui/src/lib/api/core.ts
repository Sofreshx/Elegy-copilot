import type {
  CatalogActivationMutationResponse,
  CatalogAssetMutationResponse,
  CatalogAssetDetailResponse,
  CatalogAssetAuditAnalyticsResponse,
  CatalogAssetsResponse,
  CatalogBundleUninstallResponse,
  CatalogBundlesResponse,
  CatalogAuditEventsResponse,
  CatalogProviderInstallResponse,
  CatalogRepoMutationResponse,
  CatalogRepoScanRootsMutationResponse,
  CatalogReposListResponse,
  CatalogRefreshResponse,
  CatalogSearchRequest,
  CodexProviderStatusResponse,
  CatalogSearchSelectionPayload,
  CatalogSearchSelectionResponse,
  CatalogSearchResponse,
  CatalogSummaryResponse,
  CancelExecutorJobResponse,
  CreateExecutorJobPayload,
  CreateExecutorJobResponse,
  CreateUiRuntimeOverlayAnnotationPayload,
  CreateUiRuntimeOverlayChangeRequestPayload,
  CreateUiRuntimeOverlayObservationPayload,
  CreateUiRuntimeOverlaySessionPayload,
  ExecutorHealthResponse,
  ExecutorJob,
  ExecutorJobsResponse,
  ExecutorRetryPolicy,
  ExecutorRun,
  ExecutorRunEvent,
  ExecutorRunsResponse,
  ExecutorWorktreeRecord,
  ExecutorWorktreesResponse,
  GatewayConfig,
  GatewayConfigResponse,
  GatewaySaveConfigResponse,
  GatewayScanReposResponse,
  GatewayStateError,
  GatewayStateResponse,
  HealthResponse,
  InstalledAssetsResponse,
  LspConfigResponse,
  LspInstallResponse,
  ManagedAssetsResponse,
  ObsidianPlanningNoteDetail,
  ObsidianPlanningNoteResponse,
  ObsidianPlanningNotesResponse,
  ObsidianPlanningRepresentationSummary,
  ObsidianPlanningRepresentationsRefreshResponse,
  ObsidianPlanningRepresentationsResponse,
  ObsidianPlanningRepresentationsStatusResponse,
  ObsidianPlanningNoteSummary,
  ObsidianPlanningSyncResponse,
  ObsidianPlanningSyncResult,
  ObsidianPlanningSourceSelectionResponse,
  ObsidianPlanningStatus,
  ObsidianPlanningStatusResponse,
  PlanningBacklogResponse,
  PlanningBullet,
  PlanningBulletsResponse,
  PlanningBulletsSummary,
  PlanningBulletFileRef,
  PlanningBulletState,
  PlanningDiagram,
  PlanningDiagramsResponse,
  PlanningCompareReceipt,
  PlanningCompareResponse,
  PlanningCreateResponse,
  PlanningLiveGoal,
  PlanningLiveGoalResponse,
  PlanningLivePlanResponse,
  PlanningLivePlanSummary,
  PlanningLivePlansResponse,
  PlanningLiveReviewPoint,
  PlanningLiveRoadmapResponse,
  PlanningLiveRoadmapSection,
  PlanningLiveRoadmapsResponse,
  PlanningLiveRoadmapSummary,
  PlanningLiveTodo,
  PlanningLiveTodosResponse,
  PlanningLiveValidationFinding,
  PlanningLiveValidationSummary,
  PlanningLiveWorkPoint,
  PlanningMergeIntentResponse,
  PlanningMergeIntentToken,
  PlanningMergeResponse,
  PlanningPersistenceInitResponse,
  PlanningIntakeArtifact,
  PlanningIntakeArtifactsResponse,
  PlanningIntakeCategory,
  PlanningIntakeDirectoryRef,
  PlanningRecordItem,
  PlanningRepositoryBacklogRef,
  PlanningRoadmap,
  PlanningRoadmapDirectoryRef,
  PlanningRoadmapItem,
  PlanningResearchNote,
  PlanningResearchNotesResponse,
  PlanningRecordsResponse,
  PlanningSearchResponse,
  PlanningSearchResultItem,
  PlanningTaskBoardResponse,
  PolicyPreflightResponse,
  RuntimeCatalogHealthResponse,
  SandboxLifecycleAction,
  SandboxLifecyclePayload,
  SandboxLifecycleResponse,
  SdkHealthResponse,
  SdkSendResponse,
  SdkSessionSummary,
  SdkSessionsResponse,
  ResolveExecutorWorktreePayload,
  ResolveExecutorWorktreeResponse,
  SessionPlansResponse,
  SessionAgentUsageResponse,
  SessionPlanMutationResponse,
  SessionStructuredStateResponse,
  SessionTextArtifactResponse,
  SessionsWorkspaceResponse,
  SyncedNoteSourceDeleteResponse,
  SyncedNoteSourceLocator,
  SyncedNoteSourceRecord,
  SkillsPreviewResponse,
  SessionsListResponse,
  TrackerPermissionsResponse,
  TrackerSessionsResponse,
  TriggerExecutorJobResponse,
  UiRuntimeOverlayAnnotationMutationResponse,
  UiRuntimeOverlayChangeRequestMutationResponse,
  UiRuntimeOverlayObservationMutationResponse,
  UiRuntimeOverlayQueueChangeRequestResponse,
  UiRuntimeOverlaySessionMutationResponse,
  UiRuntimeOverlaySessionsResponse,
  VersionResponse,
  WorktreeBinding,
} from '../types';
import { runtimeHealthStore } from '../../stores/runtimeHealthStore';

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly code?: string;

  constructor(message: string, status: number, payload: unknown, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.code = code;
  }
}

export type PrimitiveQueryValue = string | number | boolean;

export interface ApiRequestOptions extends RequestInit {
  baseUrl?: string;
  query?: Record<string, PrimitiveQueryValue | null | undefined>;
}

export interface ListSessionsOptions {
  activeWindowMinutes?: number;
  source?: string;
  dedupe?: string;
}

export interface SessionArtifactQueryOptions {
  source?: string;
  sandbox?: string;
  planId?: string;
}

export interface SessionPlanSeedArtifactPayload {
  id: string;
  kind?: string;
  category?: PlanningIntakeCategory | string;
  title: string;
  summary?: string;
  targetRepoIds?: string[];
  state?: string;
  repoId?: string;
  originKind?: string;
  promotedPlanRefs?: string[];
  promotedBacklogRefs?: string[];
  promotedRoadmapRefs?: string[];
  provider?: string;
  notePath?: string;
  vaultName?: string;
  external?: boolean;
  canonicalAuthority?: boolean;
}

export interface SessionPlanMutationPayload {
  sessionId?: string;
  source?: string;
  title?: string;
  content: string;
  repoId?: string;
  repoPath?: string;
  seedArtifact?: SessionPlanSeedArtifactPayload;
}

export interface SessionAgentUsageQueryOptions {
  source?: string;
  sandbox?: string;
  limit?: number;
}

export interface PlanningContextQuery {
  userId?: string;
  repoId?: string;
  scopes?: string[];
}

export interface PlanningSearchQuery extends PlanningContextQuery {
  query?: string;
  limit?: number;
}

export interface PlanningCreatePayload {
  userId?: string;
  repoId?: string;
  scope: string;
  title: string;
  summary?: string;
  acceptanceCriteria?: string[];
  acceptanceCriteriaText?: string;
  targetRepoIds?: string[];
  state?: string;
  idempotencyKey?: string;
}

export interface PlanningUpdatePayload {
  userId?: string;
  repoId?: string;
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
  acceptanceCriteriaText?: string;
  targetRepoIds?: string[];
  state?: string;
  score?: number | null;
}

export interface PlanningBacklogKeyPointPayload {
  date: string;
  text: string;
}

export interface PlanningBacklogItemPayload {
  title: string;
  summary?: string;
  status?: string;
  roadmapIds?: string[];
  planRefs?: string[];
  satisfiedByPlanRef?: string | null;
  supersededByPlanRef?: string | null;
  abandonedByPlanRef?: string | null;
  importance?: number | null;
  keyPoints?: PlanningBacklogKeyPointPayload[];
}

export interface PlanningBacklogCreatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  item?: PlanningBacklogItemPayload;
  title?: string;
  summary?: string;
  status?: string;
  roadmapIds?: string[];
  planRefs?: string[];
  satisfiedByPlanRef?: string | null;
  supersededByPlanRef?: string | null;
  abandonedByPlanRef?: string | null;
  importance?: number | null;
  keyPoints?: PlanningBacklogKeyPointPayload[];
}

export interface PlanningBacklogUpdatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  item?: Partial<PlanningBacklogItemPayload>;
  patch?: Partial<PlanningBacklogItemPayload>;
  title?: string;
  summary?: string;
  status?: string;
  roadmapIds?: string[];
  planRefs?: string[];
  satisfiedByPlanRef?: string | null;
  supersededByPlanRef?: string | null;
  abandonedByPlanRef?: string | null;
  importance?: number | null;
  keyPoints?: PlanningBacklogKeyPointPayload[];
}

export interface PlanningRoadmapItemPayload {
  id?: string;
  itemId?: string;
  title?: string;
  phase?: string;
  status?: string;
  summary?: string;
  backlogIds?: string[];
  planRefs?: string[];
  satisfiedByPlanRef?: string | null;
  supersededByPlanRef?: string | null;
  abandonedByPlanRef?: string | null;
}

export interface PlanningRoadmapUpdatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  repoLabel?: string;
  title?: string;
  overview?: string;
  replaceItems?: boolean;
  item?: PlanningRoadmapItemPayload;
  items?: PlanningRoadmapItemPayload[];
}

export interface PlanningComparePayload {
  userId?: string;
  repoId?: string;
  scopes: string[];
  query?: string;
  sessionId?: string;
  idempotencyKey?: string;
}

export interface PlanningMergeIntentPayload {
  userId?: string;
  repoId?: string;
  compareReceiptId: string;
  targetId: string;
  sourceIds: string[];
  ttlMs?: number;
}

export interface PlanningMergePayload {
  userId?: string;
  repoId?: string;
  idempotencyKey?: string;
  compareReceiptId: string;
  tokenId: string;
  targetId: string;
  compareHash: string;
  sourceIdsHash: string;
  sourceIds: string[];
  versionVector?: Record<string, unknown> | null;
  conflictSummary?: string;
}

export interface SdkCreateSessionPayload {
  sessionId?: string;
  model?: string;
  contextType?: 'regular' | 'sandbox' | string;
  sandboxId?: string;
  remote?: boolean;
  orchestration?: Record<string, unknown>;
}

export interface SdkSendPayload {
  sessionId: string;
  prompt: string;
  attachments?: unknown[];
  mode?: 'enqueue' | 'immediate';
}

export interface PlanningResearchNoteInput {
  id?: string;
  noteId?: string;
  phase?: string;
  title: string;
  content: string;
  summary?: string;
  source?: string;
  sources?: string[];
}

export interface GatewaySaveConfigPayload {
  mode?: string;
  acp?: {
    host?: string;
    port?: number;
  };
  discord?: {
    allowlistedUserIds?: string[];
    guildId?: string;
    channelId?: string;
    permissionsChannelId?: string;
  };
  telegram?: {
    allowlistedUserIds?: string[];
  };
  workspaces: {
    allowedRoots: string[];
    activeRoot: string;
  };
}

export interface CatalogSelectorQuery {
  repoId?: string;
  repoPath?: string;
}

export interface CatalogAssetsQuery extends CatalogSelectorQuery {
  assetId?: string;
  assetKey?: string;
  kind?: string;
  scopeKind?: string;
  layer?: string;
  q?: string;
  installed?: boolean;
  enabled?: boolean;
  recommended?: boolean;
  available?: boolean;
}

export interface CatalogBundlesQuery extends CatalogSelectorQuery {
  bundleId?: string;
  classification?: string;
  scopeKind?: string;
  language?: string;
  framework?: string;
  stack?: string;
  tag?: string;
  q?: string;
}

export interface CatalogAuditEventsQuery extends CatalogSelectorQuery {
  eventType?: string;
  assetId?: string;
  sessionId?: string;
  correlationId?: string;
  limit?: number;
}

export interface CatalogAuditAssetsQuery extends CatalogAuditEventsQuery {}

export interface CatalogRepoInventoryQuery {
  repoPath?: string;
}

export interface CatalogRepoMutationPayload {
  repoId?: string;
  repoPath?: string;
  repoLabel?: string;
  label?: string;
  select?: boolean;
  clear?: boolean;
  repoPaths?: string[];
}

export interface CatalogRepoScanRootsPayload {
  customScanRoots?: string[];
  scanRoots?: string[];
}

export interface CatalogAssetCreatePayload {
  authoringScope: 'shared' | 'user-global' | 'repo-local' | string;
  kind: 'agent' | 'skill' | string;
  assetKey: string;
  title?: string;
  description?: string;
  content: string;
  loadMode?: 'always' | 'on-demand' | string;
  triggersOn?: string[];
  repoPath?: string;
  authoringRepoPath?: string;
}

export interface CatalogProviderInstallPayload {
  providerId: string;
  action?: 'install' | 'update' | string;
}

export interface CatalogSourceAddPayload {
  sourceId?: string;
  title?: string;
  description?: string;
  url: string;
  ref?: string;
  defaultRef?: string;
  includeSkills?: boolean;
  includeMcp?: boolean;
  preferredSkillPathPrefixes?: string[];
  hiddenPathPrefixes?: string[];
  deprecatedPathPrefixes?: string[];
  mcpManifestPath?: string;
}

export interface CatalogSourceIdPayload {
  sourceId: string;
}

export interface CatalogSourceInstallableMutationPayload {
  sourceId: string;
  installableId: string;
  target: 'copilot' | 'codex' | 'opencode' | 'antigravity' | 'gemini-cli' | 'antigravity-cli' | string;
}

export interface CatalogSourceSyncInstallVerifyPayload {
  sourceId: string;
  targets?: string[];
  installableIds?: string[];
  force?: boolean;
  repoPath?: string;
}

export interface CatalogSpecKitBootstrapPayload {
  repoPath: string;
  integration?: 'copilot' | 'codex' | 'gemini' | string;
  script?: 'ps' | 'sh' | string;
  force?: boolean;
  ignoreAgentTools?: boolean;
}

export interface CatalogAssetUpdatePayload extends Omit<CatalogAssetCreatePayload, 'content'> {
  assetId?: string;
  expectedHash?: string;
  content: string;
}

export interface CatalogAssetDeletePayload {
  authoringScope: 'shared' | 'user-global' | 'repo-local' | string;
  kind?: 'agent' | 'skill' | string;
  assetId?: string;
  assetKey?: string;
  loadMode?: 'always' | 'on-demand' | string;
  expectedHash?: string;
  repoPath?: string;
  authoringRepoPath?: string;
}

export interface CatalogAssetInstallPayload {
  assetId: string;
  force?: boolean;
}

export interface CatalogBundleUninstallPayload extends CatalogSelectorQuery {
  bundleId: string;
}

export interface CatalogAssetEnablementPayload {
  kind?: 'agent' | 'skill' | string;
  assetId?: string;
  assetKey?: string;
  repoPath: string;
  expectedRegistryHash?: string;
}

export interface CatalogActivationMutationPayload {
  action: 'activate-bundle' | 'deactivate-bundle' | 'set-profile' | 'clear-repo-override' | string;
  bundleId?: string;
  plannerProfile?: string;
  repoPath?: string;
}

export function buildCatalogSelectorQuery(query: CatalogSelectorQuery = {}): ApiRequestOptions['query'] {
  return {
    repoId: query.repoId,
    repoPath: query.repoPath,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asTrimmedString(value: unknown, fallback = ''): string {
  const raw = asString(value, fallback);
  return raw.trim() || fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function asNullableNumber(value: unknown): number | null {
  const numeric = asNumber(value, Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeWorktreeBinding(value: unknown): WorktreeBinding | null {
  const record = asRecord(value);
  const worktreeId = asTrimmedString(record.worktreeId || record.id);
  const mode = asTrimmedString(record.mode) || null;
  const pathValue = asTrimmedString(record.path || record.worktreePath) || null;
  const status = asTrimmedString(record.status) || null;
  if (!worktreeId && !mode && !pathValue && !status) {
    return null;
  }

  const launchRecord = asRecord(record.launch);
  return {
    ...record,
    worktreeId: worktreeId || null,
    mode,
    path: pathValue,
    worktreePath: pathValue,
    status,
    branch: asTrimmedString(record.branch) || null,
    launch: record.launch || record.launchBlocked != null || record.launchBlockedReason != null
      ? {
        blocked: asBoolean(launchRecord.blocked, asBoolean(record.launchBlocked, false)),
        reason: asTrimmedString(launchRecord.reason || record.launchBlockedReason) || null,
      }
      : null,
    launchBlocked: asBoolean(record.launchBlocked, asBoolean(launchRecord.blocked, false)),
    launchBlockedReason: asTrimmedString(record.launchBlockedReason || launchRecord.reason) || null,
  };
}

export function asStringList(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asTrimmedString(entry))
    .filter((entry) => entry.length > 0);
}

export interface PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  repoLabel?: string;
}

export interface PlanningIntakeArtifactPayload {
  category?: PlanningIntakeCategory;
  title: string;
  summary?: string;
  acceptanceCriteria?: string[];
  targetRepoIds?: string[];
  planningState?: string;
}

export interface PlanningIntakeCreatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  artifact?: PlanningIntakeArtifactPayload;
  category?: PlanningIntakeCategory;
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
  targetRepoIds?: string[];
  planningState?: string;
}

export interface PlanningIntakeUpdatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  artifact?: Partial<PlanningIntakeArtifactPayload>;
  patch?: Partial<PlanningIntakeArtifactPayload>;
  category?: PlanningIntakeCategory;
  title?: string;
  summary?: string;
  acceptanceCriteria?: string[];
  targetRepoIds?: string[];
  planningState?: string;
}

export interface PlanningBulletPayload {
  title: string;
  state?: PlanningBulletState;
  repoId?: string;
  summary?: string;
  notes?: string[];
  promotedPlanRefs?: string[];
  promotedBacklogRefs?: string[];
  promotedRoadmapRefs?: string[];
}

export interface PlanningBulletCreatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  bullet?: PlanningBulletPayload;
  title?: string;
  state?: PlanningBulletState;
  summary?: string;
  notes?: string[];
  promotedPlanRefs?: string[];
  promotedBacklogRefs?: string[];
  promotedRoadmapRefs?: string[];
}

export interface PlanningBulletUpdatePayload extends PlanningRepoDocRefOptions {
  repoId?: string;
  repoPath?: string;
  bullet?: Partial<PlanningBulletPayload>;
  patch?: Partial<PlanningBulletPayload>;
  title?: string;
  state?: PlanningBulletState;
  summary?: string;
  notes?: string[];
  promotedPlanRefs?: string[];
  promotedBacklogRefs?: string[];
  promotedRoadmapRefs?: string[];
}

export interface PlanningRepoSummary {
  repoId: string;
  repoPath: string;
  repoLabel: string;
  [key: string]: unknown;
}

export interface PlanningRepositoryBacklogRefApi extends PlanningRepositoryBacklogRef {
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

export interface PlanningRoadmapDirectoryRefApi extends PlanningRoadmapDirectoryRef {
  canonicalName: 'Roadmap';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/planning';
  stableIdPattern: 'RM-<roadmap-slug>-###';
}

export interface PlanningRoadmapItemApi extends PlanningRoadmapItem {
  id: string;
  title: string;
  phase: string;
  status: string;
  summary?: string;
  backlogIds: string[];
  planRefs: string[];
}

export interface PlanningRoadmapApi extends PlanningRoadmap {
  slug: string;
  title: string;
  overview?: string;
  filePath: string;
  repoRelativePath: string;
  itemCount: number;
  statusCounts: Record<string, number>;
  items: PlanningRoadmapItemApi[];
}

function normalizePlanningRoadmapWorkflowArtifactSummary(value: unknown) {
  const record = asRecord(value);
  const artifactId = asTrimmedString(record.artifactId);
  if (!artifactId) {
    return null;
  }

  const acceptanceRecord = asRecord(record.acceptance);
  const failedChecks = asStringList(acceptanceRecord.failedChecks);
  const passedChecks = asStringList(acceptanceRecord.passedChecks);

  return {
    artifactId,
    kind: asTrimmedString(record.kind),
    phase: asTrimmedString(record.phase),
    status: asTrimmedString(record.status),
    normalizedStatus: asTrimmedString(record.normalizedStatus) || undefined,
    sourceHarness: typeof record.sourceHarness === 'string' || record.sourceHarness === null
      ? (record.sourceHarness as string | null)
      : undefined,
    sourceModel: typeof record.sourceModel === 'string' || record.sourceModel === null
      ? (record.sourceModel as string | null)
      : undefined,
    sessionId: typeof record.sessionId === 'string' || record.sessionId === null
      ? (record.sessionId as string | null)
      : undefined,
    updatedAt: typeof record.updatedAt === 'string' || record.updatedAt === null
      ? (record.updatedAt as string | null)
      : undefined,
    createdAt: typeof record.createdAt === 'string' || record.createdAt === null
      ? (record.createdAt as string | null)
      : undefined,
    requiresUserDecision: asBoolean(record.requiresUserDecision, false),
    suggestedNextAction: typeof record.suggestedNextAction === 'string' || record.suggestedNextAction === null
      ? (record.suggestedNextAction as string | null)
      : undefined,
    acceptance: Object.keys(acceptanceRecord).length > 0
      ? {
        allPassed: asBoolean(acceptanceRecord.allPassed, false),
        failedChecks,
        ...(passedChecks.length ? { passedChecks } : {}),
      }
      : null,
  };
}

function normalizePlanningRoadmapWorkflowSliceProjection(value: unknown) {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return undefined;
  }
  return {
    latest: normalizePlanningRoadmapWorkflowArtifactSummary(record.latest),
    history: asArray(record.history)
      .map((entry) => normalizePlanningRoadmapWorkflowArtifactSummary(entry))
      .filter((entry): entry is NonNullable<ReturnType<typeof normalizePlanningRoadmapWorkflowArtifactSummary>> => entry !== null),
  };
}

function normalizePlanningRoadmapWorkflowDesync(value: unknown) {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return undefined;
  }
  return {
    statusMismatch: asBoolean(record.statusMismatch, false),
    roadmapStatus: asTrimmedString(record.roadmapStatus),
    workflowStatus: typeof record.workflowStatus === 'string' || record.workflowStatus === null
      ? (record.workflowStatus as string | null)
      : undefined,
    reasons: asStringList(record.reasons),
  };
}

function normalizePlanningRoadmapWorkflowProjection(value: unknown) {
  const record = asRecord(value);
  if (!Object.keys(record).length) {
    return undefined;
  }
  return {
    artifactCount: asNumber(record.artifactCount, 0),
    projectedItemCount: asNumber(record.projectedItemCount, 0),
    desyncCount: asNumber(record.desyncCount, 0),
    synced: asBoolean(record.synced, false),
    unmatchedWorkflowArtifacts: asArray(record.unmatchedWorkflowArtifacts).map((entry) => {
      const unmatched = asRecord(entry);
      return {
        sliceId: asTrimmedString(unmatched.sliceId),
        history: asArray(unmatched.history)
          .map((historyEntry) => normalizePlanningRoadmapWorkflowArtifactSummary(historyEntry))
          .filter((historyEntry): historyEntry is NonNullable<ReturnType<typeof normalizePlanningRoadmapWorkflowArtifactSummary>> => historyEntry !== null),
        reasons: asStringList(unmatched.reasons),
      };
    }).filter((entry) => entry.sliceId),
  };
}

export interface PlanningRoadmapsResponseApi {
  count: number;
  roadmaps: PlanningRoadmapApi[];
  repo: PlanningRepoSummary | null;
}

export interface PlanningRoadmapMutationResponseApi {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  roadmap: PlanningRoadmapApi | null;
  [key: string]: unknown;
}

export interface PlanningBacklogKeyPointApi {
  date: string;
  text: string;
  [key: string]: unknown;
}

export interface PlanningBacklogItemApi {
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
  keyPoints: PlanningBacklogKeyPointApi[];
  [key: string]: unknown;
}

export interface PlanningBacklogSummaryApi {
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
  items: PlanningBacklogItemApi[];
  [key: string]: unknown;
}

export interface PlanningBacklogResponseApi extends PlanningBacklogResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  backlog: PlanningBacklogSummaryApi;
}

export interface PlanningBacklogMutationResponseApi {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo?: PlanningRepoSummary | null;
  backlog?: PlanningBacklogSummaryApi;
  item?: PlanningBacklogItemApi | null;
  [key: string]: unknown;
}

export interface PlanningIntakeDirectoryRefApi extends PlanningIntakeDirectoryRef {
  canonicalName: 'Planning Intake';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/planning/intake';
  stableIdPattern: 'PI-###';
  supportedCategories: PlanningIntakeCategory[];
}

export interface PlanningBulletFileRefApi extends PlanningBulletFileRef {
  canonicalName: 'Planning Bullets';
  repo: PlanningRepoSummary;
  filePath: string;
  repoRelativePath: 'docs/planning/bullets.md';
  stableIdPattern: 'PB-###';
  supportedStates: PlanningBulletState[];
}

export interface PlanningBulletApi extends PlanningBullet {
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

export interface PlanningBulletsSummaryApi extends PlanningBulletsSummary {
  filePath?: string | null;
  repoRelativePath?: string;
  exists: boolean;
  bulletCount: number;
  stableIdPattern?: string;
  supportedStates: PlanningBulletState[];
}

export interface PlanningBulletsResponseApi extends PlanningBulletsResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  count?: number;
  bullets: PlanningBulletsSummaryApi;
  artifacts: PlanningBulletApi[];
  artifact?: PlanningBulletApi | null;
}

export interface PlanningIntakeArtifactApi extends PlanningIntakeArtifact {
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

export interface PlanningIntakeSummaryApi {
  directoryPath?: string | null;
  repoRelativePath?: string;
  exists: boolean;
  artifactCount: number;
  stableIdPattern?: string;
  supportedCategories: PlanningIntakeCategory[];
  [key: string]: unknown;
}

export interface PlanningIntakeArtifactsResponseApi extends PlanningIntakeArtifactsResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  count?: number;
  intake: PlanningIntakeSummaryApi;
  artifacts: PlanningIntakeArtifactApi[];
  artifact?: PlanningIntakeArtifactApi | null;
}

export function trimTrailingPathSeparator(value: string): string {
  return value.replace(/[\\/]+$/g, '');
}

export function detectPathSeparator(value: string): '\\' | '/' {
  return value.includes('\\') ? '\\' : '/';
}

export function buildRepoPath(value: string, ...segments: string[]): string {
  const normalizedBase = trimTrailingPathSeparator(value.trim());
  const separator = detectPathSeparator(normalizedBase);
  const normalizedSegments = segments
    .map((segment) => String(segment || '').replace(/[\\/]+/g, separator))
    .filter((segment) => segment.length > 0);

  return [normalizedBase, ...normalizedSegments].join(separator);
}

export function normalizePlanningRepoSummary(input: unknown): PlanningRepoSummary | null {
  const record = asRecord(input);
  const repoId = asTrimmedString(record.repoId);
  const repoPath = asTrimmedString(record.repoPath);
  const repoLabel = asTrimmedString(record.repoLabel);

  if (!repoId && !repoPath && !repoLabel) {
    return null;
  }

  return {
    repoId,
    repoPath,
    repoLabel,
  };
}

export function normalizePlanningRoadmapItem(value: unknown): PlanningRoadmapItemApi | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    id,
    title: asTrimmedString(record.title) || id,
    phase: asTrimmedString(record.phase) || 'unscheduled',
    status: asTrimmedString(record.status) || 'planned',
    summary: asTrimmedString(record.summary) || undefined,
    backlogIds: asStringList(record.backlogIds),
    planRefs: asStringList(record.planRefs),
    workflowProjection: normalizePlanningRoadmapWorkflowSliceProjection(record.workflowProjection),
    desync: normalizePlanningRoadmapWorkflowDesync(record.desync),
  };
}

export function normalizePlanningRoadmap(value: unknown): PlanningRoadmapApi | null {
  const record = asRecord(value);
  const slug = asTrimmedString(record.slug);
  if (!slug) {
    return null;
  }

  const items = asArray(record.items)
    .map((entry) => normalizePlanningRoadmapItem(entry))
    .filter((entry): entry is PlanningRoadmapItemApi => entry !== null);
  const rawStatusCounts = asRecord(record.statusCounts);
  const statusCounts = Object.entries(rawStatusCounts).reduce<Record<string, number>>((acc, [key, count]) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return acc;
    }
    acc[normalizedKey] = asNumber(count, 0);
    return acc;
  }, {});

  return {
    slug,
    title: asTrimmedString(record.title) || slug,
    overview: asTrimmedString(record.overview) || undefined,
    filePath: asTrimmedString(record.filePath),
    repoRelativePath: asTrimmedString(record.repoRelativePath),
    itemCount: asNumber(record.itemCount, items.length),
    statusCounts,
    items,
    workflowProjection: normalizePlanningRoadmapWorkflowProjection(record.workflowProjection),
  };
}

export function normalizePlanningRoadmapsResponse(payload: unknown): PlanningRoadmapsResponseApi {
  const record = asRecord(payload);
  const roadmaps = asArray(record.roadmaps)
    .map((entry) => normalizePlanningRoadmap(entry))
    .filter((entry): entry is PlanningRoadmapApi => entry !== null);

  return {
    count: asNumber(record.count, roadmaps.length),
    roadmaps,
    repo: normalizePlanningRepoSummary(record.repo),
  };
}

export function normalizePlanningRoadmapMutationResponse(payload: unknown): PlanningRoadmapMutationResponseApi {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningRepoSummary(record.repo),
    roadmap: normalizePlanningRoadmap(record.roadmap),
  };
}

export function normalizePlanningBacklogKeyPoint(value: unknown): PlanningBacklogKeyPointApi | null {
  const record = asRecord(value);
  const date = asTrimmedString(record.date);
  const text = asTrimmedString(record.text);
  if (!date || !text) {
    return null;
  }

  return {
    date,
    text,
  };
}

export function normalizePlanningBacklogItem(value: unknown): PlanningBacklogItemApi | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  const title = asTrimmedString(record.title);
  if (!id || !title) {
    return null;
  }

  return {
    id,
    title,
    status: asTrimmedString(record.status, 'proposed') || 'proposed',
    summary: asTrimmedString(record.summary) || undefined,
    roadmapIds: asStringList(record.roadmapIds),
    planRefs: asStringList(record.planRefs),
    satisfiedByPlanRef: asTrimmedString(record.satisfiedByPlanRef) || null,
    supersededByPlanRef: asTrimmedString(record.supersededByPlanRef) || null,
    abandonedByPlanRef: asTrimmedString(record.abandonedByPlanRef) || null,
    importance: asNullableNumber(record.importance),
    keyPoints: asArray(record.keyPoints)
      .map((entry) => normalizePlanningBacklogKeyPoint(entry))
      .filter((entry): entry is PlanningBacklogKeyPointApi => entry !== null),
  };
}

export function normalizePlanningBacklogSummary(value: unknown): PlanningBacklogSummaryApi {
  const record = asRecord(value);
  const items = asArray(record.items)
    .map((entry) => normalizePlanningBacklogItem(entry))
    .filter((entry): entry is PlanningBacklogItemApi => entry !== null);

  return {
    backlogPath: asTrimmedString(record.backlogPath) || null,
    repoRelativePath: asTrimmedString(record.repoRelativePath) || undefined,
    primaryDirectoryPath: asTrimmedString(record.primaryDirectoryPath) || null,
    primaryRepoRelativePath: asTrimmedString(record.primaryRepoRelativePath) || undefined,
    primaryFamilyRepoRelativePath: asTrimmedString(record.primaryFamilyRepoRelativePath) || undefined,
    legacyBacklogPath: asTrimmedString(record.legacyBacklogPath) || null,
    legacyRepoRelativePath: asTrimmedString(record.legacyRepoRelativePath) || undefined,
    resolvedBacklogPaths: asStringList(record.resolvedBacklogPaths),
    resolvedRepoRelativePaths: asStringList(record.resolvedRepoRelativePaths),
    exists: asBoolean(record.exists, false),
    formatVersion: asTrimmedString(record.formatVersion) || undefined,
    title: asTrimmedString(record.title) || undefined,
    description: asTrimmedString(record.description) || undefined,
    itemCount: asNumber(record.itemCount, items.length),
    items,
  };
}

export function normalizePlanningBacklogResponse(payload: unknown): PlanningBacklogResponseApi {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningRepoSummary(record.repo),
    backlog: normalizePlanningBacklogSummary(record.backlog),
  };
}

export function normalizePlanningBacklogMutationResponse(payload: unknown): PlanningBacklogMutationResponseApi {
  const record = asRecord(payload);
  const response = normalizePlanningBacklogResponse(payload);
  return {
    ...response,
    ...record,
    item: normalizePlanningBacklogItem(record.item),
  };
}

export const PLANNING_INTAKE_CATEGORIES = [
  'idea',
  'research',
  'refactor-candidate',
  'design-complaint',
  'audit-request',
  'roadmap-request',
  'review-prep',
  'commit-prep',
] as const;

export const PLANNING_BULLET_STATES = [
  'idea',
  'research',
  'pre-plan',
] as const;

export function normalizePlanningIntakeCategory(value: unknown): PlanningIntakeCategory {
  const normalized = asTrimmedString(value).toLowerCase();
  if (PLANNING_INTAKE_CATEGORIES.includes(normalized as PlanningIntakeCategory)) {
    return normalized as PlanningIntakeCategory;
  }
  return 'idea';
}

export function normalizePlanningBulletState(value: unknown): PlanningBulletState {
  const normalized = asTrimmedString(value).toLowerCase();
  if (PLANNING_BULLET_STATES.includes(normalized as PlanningBulletState)) {
    return normalized as PlanningBulletState;
  }
  return 'idea';
}

export function normalizePlanningBullet(value: unknown): PlanningBulletApi | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    kind: 'planning.bullet.artifact',
    schemaVersion: asNumber(record.schemaVersion, 1),
    id,
    title: asTrimmedString(record.title) || id,
    state: normalizePlanningBulletState(record.state),
    repoId: asTrimmedString(record.repoId),
    summary: asTrimmedString(record.summary),
    notes: asStringList(record.notes),
    promotedPlanRefs: asStringList(record.promotedPlanRefs),
    promotedBacklogRefs: asStringList(record.promotedBacklogRefs),
    promotedRoadmapRefs: asStringList(record.promotedRoadmapRefs),
    filePath: asTrimmedString(record.filePath),
    repoRelativePath: asTrimmedString(record.repoRelativePath),
  };
}

export function normalizePlanningBulletsSummary(value: unknown): PlanningBulletsSummaryApi {
  const record = asRecord(value);
  return {
    filePath: asTrimmedString(record.filePath) || null,
    repoRelativePath: asTrimmedString(record.repoRelativePath) || 'docs/planning/bullets.md',
    exists: asBoolean(record.exists, false),
    bulletCount: asNumber(record.bulletCount, 0),
    stableIdPattern: asTrimmedString(record.stableIdPattern) || 'PB-###',
    supportedStates: asArray(record.supportedStates)
      .map((entry) => normalizePlanningBulletState(entry))
      .filter((entry, index, list) => list.indexOf(entry) === index),
  };
}

export function normalizePlanningBulletsResponse(payload: unknown): PlanningBulletsResponseApi {
  const record = asRecord(payload);
  const artifacts = asArray(record.artifacts)
    .map((entry) => normalizePlanningBullet(entry))
    .filter((entry): entry is PlanningBulletApi => entry !== null);

  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningRepoSummary(record.repo),
    count: asNumber(record.count, artifacts.length),
    bullets: normalizePlanningBulletsSummary(record.bullets),
    artifacts,
    artifact: normalizePlanningBullet(record.artifact),
  };
}

export function normalizePlanningIntakeArtifact(value: unknown): PlanningIntakeArtifactApi | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    kind: 'planning.intake.artifact',
    schemaVersion: asNumber(record.schemaVersion, 1),
    id,
    category: normalizePlanningIntakeCategory(record.category),
    title: asTrimmedString(record.title) || id,
    summary: asTrimmedString(record.summary),
    acceptanceCriteria: asStringList(record.acceptanceCriteria),
    targetRepoIds: asStringList(record.targetRepoIds),
    planningState: asTrimmedString(record.planningState) || undefined,
    createdAt: asTrimmedString(record.createdAt),
    updatedAt: asTrimmedString(record.updatedAt),
    filePath: asTrimmedString(record.filePath),
    repoRelativePath: asTrimmedString(record.repoRelativePath),
  };
}

export function normalizePlanningIntakeSummary(value: unknown): PlanningIntakeSummaryApi {
  const record = asRecord(value);
  return {
    directoryPath: asTrimmedString(record.directoryPath) || null,
    repoRelativePath: asTrimmedString(record.repoRelativePath) || 'docs/planning/intake',
    exists: asBoolean(record.exists, false),
    artifactCount: asNumber(record.artifactCount, 0),
    stableIdPattern: asTrimmedString(record.stableIdPattern) || 'PI-###',
    supportedCategories: asArray(record.supportedCategories)
      .map((entry) => normalizePlanningIntakeCategory(entry))
      .filter((entry, index, list) => list.indexOf(entry) === index),
  };
}

export function normalizePlanningIntakeArtifactsResponse(payload: unknown): PlanningIntakeArtifactsResponseApi {
  const record = asRecord(payload);
  const artifacts = asArray(record.artifacts)
    .map((entry) => normalizePlanningIntakeArtifact(entry))
    .filter((entry): entry is PlanningIntakeArtifactApi => entry !== null);

  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningRepoSummary(record.repo),
    count: asNumber(record.count, artifacts.length),
    intake: normalizePlanningIntakeSummary(record.intake),
    artifacts,
    artifact: normalizePlanningIntakeArtifact(record.artifact),
  };
}

export function normalizeObsidianPlanningStatus(value: unknown): ObsidianPlanningStatus {
  const record = asRecord(value);
  const state = asTrimmedString(record.state).toLowerCase();
  return {
    state:
      state === 'ready'
      || state === 'vault-unavailable'
      || state === 'notes-unavailable'
      || state === 'not-configured'
        ? state
        : 'not-configured',
    configured: asBoolean(record.configured, false),
    readAvailable: asBoolean(record.readAvailable, false),
    syncAvailable: asBoolean(record.syncAvailable, false),
    external: true,
    canonicalAuthority: false,
    message: asTrimmedString(record.message) || 'External Obsidian notes are unavailable.',
    code: asTrimmedString(record.code) || undefined,
    configPath: asTrimmedString(record.configPath) || undefined,
    vaultName: asTrimmedString(record.vaultName) || undefined,
    vaultPath: asTrimmedString(record.vaultPath) || undefined,
    notesPathTemplate: asTrimmedString(record.notesPathTemplate) || undefined,
    notesDirectoryPath: asTrimmedString(record.notesDirectoryPath) || undefined,
    cliPath: asTrimmedString(record.cliPath) || undefined,
    syncCommand: asStringList(record.syncCommand),
    cli: normalizeObsidianCliStatus(record.cli),
    remoteSync: normalizeObsidianRemoteSyncStatus(record.remoteSync),
    sourceResolution: normalizeObsidianSourceResolutionStatus(record.sourceResolution),
  };
}

export function normalizeObsidianSyncedNoteSourceRef(value: unknown) {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }
  return {
    id,
    provider: asTrimmedString(record.provider),
    host: asTrimmedString(record.host),
    owner: asTrimmedString(record.owner),
    repo: asTrimmedString(record.repo),
    branch: asTrimmedString(record.branch),
    notesPath: asTrimmedString(record.notesPath),
  };
}

export function normalizeObsidianSourceResolutionStatus(value: unknown): ObsidianPlanningStatus['sourceResolution'] {
  const record = asRecord(value);
  const availableSources = asArray(record.availableSources)
    .map((entry) => normalizeObsidianSyncedNoteSourceRef(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof normalizeObsidianSyncedNoteSourceRef>> => entry !== null);
  const effectiveSource = normalizeObsidianSyncedNoteSourceRef(record.effectiveSource);
  return {
    availableSources,
    activeSourceConfigured: asBoolean(record.activeSourceConfigured, false),
    activeSourceId: asTrimmedString(record.activeSourceId) || undefined,
    activeSourceMatched: asBoolean(record.activeSourceMatched, false),
    effectiveSource,
    requiresSource: asBoolean(record.requiresSource, false),
    resolved: asBoolean(record.resolved, false),
    reason: asTrimmedString(record.reason) || undefined,
    message: asTrimmedString(record.message) || 'No synced-note source is resolved for the selected repo.',
  };
}

export function normalizeObsidianCliStatus(value: unknown): ObsidianPlanningStatus['cli'] {
  const record = asRecord(value);
  const state = asTrimmedString(record.state).toLowerCase();
  return {
    state:
      state === 'configured'
      || state === 'ready'
      || state === 'unavailable'
      || state === 'error'
      || state === 'not-configured'
        ? state
        : 'not-configured',
    message: asTrimmedString(record.message) || 'No Obsidian CLI command contract is configured.',
    checkedAt: asTrimmedString(record.checkedAt) || undefined,
    probeConfigured: asBoolean(record.probeConfigured, false),
    syncStatusConfigured: asBoolean(record.syncStatusConfigured, false),
    refreshInventoryConfigured: asBoolean(record.refreshInventoryConfigured, false),
    manualSyncConfigured: asBoolean(record.manualSyncConfigured, false),
    lastError: asTrimmedString(record.lastError) || undefined,
  };
}

export function normalizeObsidianRemoteSyncStatus(value: unknown): ObsidianPlanningStatus['remoteSync'] {
  const record = asRecord(value);
  const state = asTrimmedString(record.state).toLowerCase();
  const pollIntervalRaw = typeof record.pollIntervalMs === 'number' ? record.pollIntervalMs : Number(record.pollIntervalMs);
  return {
    state:
      state === 'idle'
      || state === 'syncing'
      || state === 'success'
      || state === 'error'
      || state === 'conflict'
      || state === 'disabled'
        ? state
        : 'disabled',
    configured: asBoolean(record.configured, false),
    pollEnabled: asBoolean(record.pollEnabled, false),
    pollIntervalMs: Number.isFinite(pollIntervalRaw) ? pollIntervalRaw : undefined,
    syncing: asBoolean(record.syncing, false),
    message: asTrimmedString(record.message) || 'Remote pull sync is not configured.',
    lastAttemptAt: asTrimmedString(record.lastAttemptAt) || undefined,
    lastSuccessAt: asTrimmedString(record.lastSuccessAt) || undefined,
    lastManualSyncAt: asTrimmedString(record.lastManualSyncAt) || undefined,
    lastError: asTrimmedString(record.lastError) || undefined,
    reason: asTrimmedString(record.reason) || undefined,
    nextAttemptAt: asTrimmedString(record.nextAttemptAt) || undefined,
    cooldownUntil: asTrimmedString(record.cooldownUntil) || undefined,
    retryCount: asNumber(record.retryCount, 0),
    retryLimit: asNumber(record.retryLimit, 0),
    lastFailureAt: asTrimmedString(record.lastFailureAt) || undefined,
    lastFailureReason: asTrimmedString(record.lastFailureReason) || undefined,
    leaseAcquiredAt: asTrimmedString(record.leaseAcquiredAt) || undefined,
    leaseExpiresAt: asTrimmedString(record.leaseExpiresAt) || undefined,
    leaseTrigger: asTrimmedString(record.leaseTrigger) || undefined,
    lastStaleLeaseRecoveredAt: asTrimmedString(record.lastStaleLeaseRecoveredAt) || undefined,
    conflictCount: asNumber(record.conflictCount, 0),
    appliedCount: asNumber(record.appliedCount, 0),
    deletedCount: asNumber(record.deletedCount, 0),
    skippedCount: asNumber(record.skippedCount, 0),
    cursor: asTrimmedString(record.cursor) || undefined,
    updatedAt: asTrimmedString(record.updatedAt) || undefined,
  };
}

export function normalizeObsidianPlanningNoteSummary(value: unknown): ObsidianPlanningNoteSummary | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  const title = asTrimmedString(record.title);
  if (!id || !title) {
    return null;
  }

  return {
    kind: 'synced-note',
    provider: 'obsidian',
    id,
    title,
    summary: asTrimmedString(record.summary) || '',
    repoId: asTrimmedString(record.repoId) || undefined,
    targetRepoIds: asStringList(record.targetRepoIds),
    vaultName: asTrimmedString(record.vaultName) || '',
    notePath: asTrimmedString(record.notePath) || '',
    filePath: asTrimmedString(record.filePath) || undefined,
    lastModifiedAt: asTrimmedString(record.lastModifiedAt) || undefined,
    external: true,
    canonicalAuthority: false,
  };
}

export function normalizeObsidianPlanningNoteDetail(value: unknown): ObsidianPlanningNoteDetail | null {
  const summary = normalizeObsidianPlanningNoteSummary(value);
  if (!summary) {
    return null;
  }
  const record = asRecord(value);
  return {
    ...summary,
    content: asTrimmedString(record.content),
    headings: asStringList(record.headings),
  };
}

export function normalizeObsidianPlanningRepresentationSummary(value: unknown): ObsidianPlanningRepresentationSummary | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  const title = asTrimmedString(record.title);
  const representationKind = asTrimmedString(record.representationKind).toLowerCase();
  if (!id || !title || (representationKind !== 'bullets' && representationKind !== 'roadmap')) {
    return null;
  }

  const freshness = asTrimmedString(record.freshness).toLowerCase();
  return {
    kind: 'planning-representation',
    provider: 'obsidian',
    id,
    representationKind,
    title,
    summary: asTrimmedString(record.summary) || '',
    repoId: asTrimmedString(record.repoId) || undefined,
    targetRepoIds: asStringList(record.targetRepoIds),
    roadmapSlug: asTrimmedString(record.roadmapSlug) || undefined,
    sourceExists: asBoolean(record.sourceExists, false),
    sourceFilePath: asTrimmedString(record.sourceFilePath) || undefined,
    sourceRepoRelativePath: asTrimmedString(record.sourceRepoRelativePath) || '',
    sourceUpdatedAt: asTrimmedString(record.sourceUpdatedAt) || undefined,
    sourceContentHash: asTrimmedString(record.sourceContentHash) || undefined,
    notePath: asTrimmedString(record.notePath) || '',
    filePath: asTrimmedString(record.filePath) || undefined,
    noteExists: asBoolean(record.noteExists, false),
    noteUpdatedAt: asTrimmedString(record.noteUpdatedAt) || undefined,
    generatedAt: asTrimmedString(record.generatedAt) || undefined,
    freshness:
      freshness === 'current'
      || freshness === 'stale'
      || freshness === 'missing'
      || freshness === 'invalid'
      || freshness === 'source-missing'
        ? freshness
        : 'missing',
    metadataValid: asBoolean(record.metadataValid, false),
    external: true,
    canonicalAuthority: false,
    message: asTrimmedString(record.message) || 'Deterministic planning mirror metadata is unavailable.',
    bulletCount: typeof record.bulletCount === 'number' ? record.bulletCount : undefined,
    itemCount: typeof record.itemCount === 'number' ? record.itemCount : undefined,
  };
}

export function normalizeObsidianPlanningRepresentationsStatus(value: unknown): ObsidianPlanningRepresentationsStatusResponse['representationsStatus'] {
  const record = asRecord(value);
  return {
    totalCount: asNumber(record.totalCount, 0),
    writeAvailable: asBoolean(record.writeAvailable, false),
    currentCount: asNumber(record.currentCount, 0),
    staleCount: asNumber(record.staleCount, 0),
    missingCount: asNumber(record.missingCount, 0),
    invalidCount: asNumber(record.invalidCount, 0),
    sourceMissingCount: asNumber(record.sourceMissingCount, 0),
    message: asTrimmedString(record.message) || 'Deterministic Obsidian planning mirrors are unavailable.',
  };
}

export function normalizeObsidianPlanningStatusResponse(payload: unknown): ObsidianPlanningStatusResponse {
  const record = asRecord(payload);
  return {
    ...record,
    contractVersion: asTrimmedString(record.contractVersion) || undefined,
    kind: asTrimmedString(record.kind) || undefined,
    deterministic: asBoolean(record.deterministic, true),
    repo: normalizePlanningRepoSummary(record.repo),
    status: normalizeObsidianPlanningStatus(record.status),
  };
}

export function normalizeObsidianPlanningNotesResponse(payload: unknown): ObsidianPlanningNotesResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningStatusResponse(payload);
  const notes = asArray(record.notes)
    .map((entry) => normalizeObsidianPlanningNoteSummary(entry))
    .filter((entry): entry is ObsidianPlanningNoteSummary => entry !== null);
  return {
    ...base,
    ...record,
    count: asNumber(record.count, notes.length),
    notes,
  };
}

export function normalizeObsidianPlanningNoteResponse(payload: unknown): ObsidianPlanningNoteResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningStatusResponse(payload);
  return {
    ...base,
    ...record,
    note: normalizeObsidianPlanningNoteDetail(record.note),
  };
}

export function normalizeObsidianPlanningSyncResult(value: unknown): ObsidianPlanningSyncResult | null {
  const record = asRecord(value);
  const state = asTrimmedString(record.state).toLowerCase();
  if (!state) {
    return null;
  }
  const cliManualCommandRecord = asRecord(record.cliManualCommand);
  const cliManualCommand =
    record.cliManualCommand && typeof record.cliManualCommand === 'object'
      ? {
        exitCode: typeof cliManualCommandRecord.exitCode === 'number' ? cliManualCommandRecord.exitCode : null,
        durationMs: typeof cliManualCommandRecord.durationMs === 'number' ? cliManualCommandRecord.durationMs : undefined,
      }
      : null;
  return {
    trigger: asTrimmedString(record.trigger) || undefined,
    state:
      state === 'idle'
      || state === 'syncing'
      || state === 'success'
      || state === 'error'
      || state === 'conflict'
      || state === 'disabled'
        ? state
        : 'disabled',
    appliedCount: asNumber(record.appliedCount, 0),
    deletedCount: asNumber(record.deletedCount, 0),
    skippedCount: asNumber(record.skippedCount, 0),
    conflictCount: asNumber(record.conflictCount, 0),
    conflicts: asStringList(record.conflicts),
    cursor: asTrimmedString(record.cursor) || undefined,
    message: asTrimmedString(record.message) || undefined,
    reason: asTrimmedString(record.reason) || undefined,
    nextAttemptAt: asTrimmedString(record.nextAttemptAt) || undefined,
    cooldownUntil: asTrimmedString(record.cooldownUntil) || undefined,
    retryCount: asNumber(record.retryCount, 0),
    retryLimit: asNumber(record.retryLimit, 0),
    lastFailureAt: asTrimmedString(record.lastFailureAt) || undefined,
    lastFailureReason: asTrimmedString(record.lastFailureReason) || undefined,
    leaseAcquiredAt: asTrimmedString(record.leaseAcquiredAt) || undefined,
    leaseExpiresAt: asTrimmedString(record.leaseExpiresAt) || undefined,
    leaseTrigger: asTrimmedString(record.leaseTrigger) || undefined,
    lastStaleLeaseRecoveredAt: asTrimmedString(record.lastStaleLeaseRecoveredAt) || undefined,
    cliManualCommand,
  };
}

export function normalizeObsidianPlanningSyncResponse(payload: unknown): ObsidianPlanningSyncResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningStatusResponse(payload);
  return {
    ...base,
    ...record,
    result: normalizeObsidianPlanningSyncResult(record.result),
  };
}

export function normalizeObsidianPlanningSourceSelectionResponse(payload: unknown): ObsidianPlanningSourceSelectionResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningStatusResponse(payload);
  return {
    ...base,
    ...record,
    sourceSelection: normalizeObsidianSourceResolutionStatus(record.sourceSelection),
  };
}

export function normalizeObsidianPlanningRepresentationsStatusResponse(payload: unknown): ObsidianPlanningRepresentationsStatusResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningStatusResponse(payload);
  return {
    ...base,
    ...record,
    representationsStatus: normalizeObsidianPlanningRepresentationsStatus(record.representationsStatus),
  };
}

export function normalizeObsidianPlanningRepresentationsResponse(payload: unknown): ObsidianPlanningRepresentationsResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningRepresentationsStatusResponse(payload);
  const representations = asArray(record.representations)
    .map((entry) => normalizeObsidianPlanningRepresentationSummary(entry))
    .filter((entry): entry is ObsidianPlanningRepresentationSummary => entry !== null);
  return {
    ...base,
    ...record,
    count: asNumber(record.count, representations.length),
    representations,
  };
}

export function normalizeObsidianPlanningRepresentationsRefreshResponse(payload: unknown): ObsidianPlanningRepresentationsRefreshResponse {
  const record = asRecord(payload);
  const base = normalizeObsidianPlanningRepresentationsResponse(payload);
  const resultRecord = asRecord(record.result);
  const result = record.result
    ? {
      refreshedCount: asNumber(resultRecord.refreshedCount, 0),
      skippedCount: asNumber(resultRecord.skippedCount, 0),
      skippedIds: asStringList(resultRecord.skippedIds),
    }
    : null;
  return {
    ...base,
    ...record,
    result,
  };
}

export function buildPlanningRepositoryBacklogRef(
  repo: PlanningRepoDocRefOptions = {}
): PlanningRepositoryBacklogRefApi | null {
  const repoPath = asTrimmedString(repo.repoPath);
  if (!repoPath) {
    return null;
  }

  const normalizedRepoPath = trimTrailingPathSeparator(repoPath);
  const repoId = asTrimmedString(repo.repoId);
  const repoPathSegments = normalizedRepoPath.split(/[\\/]/).filter(Boolean);
  const repoLabel = asTrimmedString(repo.repoLabel)
    || repoPathSegments[repoPathSegments.length - 1]
    || repoId;

  return {
    canonicalName: 'Repository Backlog',
    repo: {
      repoId,
      repoPath: normalizedRepoPath,
      repoLabel,
    },
    filePath: buildRepoPath(normalizedRepoPath, 'docs', 'backlogs'),
    repoRelativePath: 'docs/backlogs',
    primaryDirectoryPath: buildRepoPath(normalizedRepoPath, 'docs', 'backlogs'),
    primaryRepoRelativePath: 'docs/backlogs',
    primaryFamilyRepoRelativePath: 'docs/backlogs/*.md',
    legacyFilePath: buildRepoPath(normalizedRepoPath, 'docs', 'backlog.md'),
    legacyRepoRelativePath: 'docs/backlog.md',
    stableIdPattern: 'RB-###',
  };
}

export function buildPlanningBulletsFileRef(
  repo: PlanningRepoDocRefOptions = {}
): PlanningBulletFileRefApi | null {
  const repoPath = asTrimmedString(repo.repoPath);
  if (!repoPath) {
    return null;
  }

  const normalizedRepoPath = trimTrailingPathSeparator(repoPath);
  const repoId = asTrimmedString(repo.repoId);
  const repoPathSegments = normalizedRepoPath.split(/[\\/]/).filter(Boolean);
  const repoLabel = asTrimmedString(repo.repoLabel)
    || repoPathSegments[repoPathSegments.length - 1]
    || repoId;

  return {
    canonicalName: 'Planning Bullets',
    repo: {
      repoId,
      repoPath: normalizedRepoPath,
      repoLabel,
    },
    filePath: buildRepoPath(normalizedRepoPath, 'docs', 'planning', 'bullets.md'),
    repoRelativePath: 'docs/planning/bullets.md',
    stableIdPattern: 'PB-###',
    supportedStates: [...PLANNING_BULLET_STATES],
  };
}

export function buildPlanningIntakeDirectoryRef(
  repo: PlanningRepoDocRefOptions = {}
): PlanningIntakeDirectoryRefApi | null {
  const repoPath = asTrimmedString(repo.repoPath);
  if (!repoPath) {
    return null;
  }

  const normalizedRepoPath = trimTrailingPathSeparator(repoPath);
  const repoId = asTrimmedString(repo.repoId);
  const repoPathSegments = normalizedRepoPath.split(/[\\/]/).filter(Boolean);
  const repoLabel = asTrimmedString(repo.repoLabel)
    || repoPathSegments[repoPathSegments.length - 1]
    || repoId;

  return {
    canonicalName: 'Planning Intake',
    repo: {
      repoId,
      repoPath: normalizedRepoPath,
      repoLabel,
    },
    directoryPath: buildRepoPath(normalizedRepoPath, 'docs', 'planning', 'intake'),
    repoRelativePath: 'docs/planning/intake',
    stableIdPattern: 'PI-###',
    supportedCategories: [...PLANNING_INTAKE_CATEGORIES],
  };
}

export function buildPlanningRoadmapDirectoryRef(
  repo: PlanningRepoDocRefOptions = {}
): PlanningRoadmapDirectoryRefApi | null {
  const repoPath = asTrimmedString(repo.repoPath);
  if (!repoPath) {
    return null;
  }

  const normalizedRepoPath = trimTrailingPathSeparator(repoPath);
  const repoId = asTrimmedString(repo.repoId);
  const repoPathSegments = normalizedRepoPath.split(/[\\/]/).filter(Boolean);
  const repoLabel = asTrimmedString(repo.repoLabel)
    || repoPathSegments[repoPathSegments.length - 1]
    || repoId;

  return {
    canonicalName: 'Roadmap',
    repo: {
      repoId,
      repoPath: normalizedRepoPath,
      repoLabel,
    },
    directoryPath: buildRepoPath(normalizedRepoPath, 'docs', 'planning'),
    repoRelativePath: 'docs/planning',
    stableIdPattern: 'RM-<roadmap-slug>-###',
  };
}

export const SANDBOX_TOKEN_CANONICAL_STATE = 'token_missing';
export const SANDBOX_TOKEN_CANONICAL_CODE = 'MISSING_SANDBOX_TOKEN';
export const SANDBOX_TOKEN_REMEDIATION_GUIDANCE =
  'Provide tracker auth via --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.';

export const LEGACY_SANDBOX_TOKEN_STATE = `${'missing'}_token`;
export const LEGACY_SANDBOX_TOKEN_CODE = ['tracker', 'token', 'missing'].join('_');
export const LEGACY_SANDBOX_TOKEN_MESSAGE_PREFIX = ['tracker', 'token', 'not', 'configured'].join(' ');

export const SANDBOX_TOKEN_KNOWN_INDICATORS = new Set([
  SANDBOX_TOKEN_CANONICAL_STATE,
  SANDBOX_TOKEN_CANONICAL_CODE.toLowerCase(),
  LEGACY_SANDBOX_TOKEN_STATE,
  LEGACY_SANDBOX_TOKEN_CODE,
  LEGACY_SANDBOX_TOKEN_MESSAGE_PREFIX,
]);

export interface CanonicalSandboxMissingTokenError {
  status: typeof SANDBOX_TOKEN_CANONICAL_STATE;
  code: typeof SANDBOX_TOKEN_CANONICAL_CODE;
  reason: typeof SANDBOX_TOKEN_CANONICAL_STATE;
  message: string;
  legacyCode: string;
  legacyReason: string;
}

export function normalizeIndicatorToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function collectSandboxTokenIndicators(payload: unknown, out: string[] = [], depth = 0): string[] {
  if (payload == null || depth > 3) {
    return out;
  }

  if (typeof payload === 'string') {
    out.push(normalizeIndicatorToken(payload));
    return out;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload) {
      collectSandboxTokenIndicators(entry, out, depth + 1);
    }
    return out;
  }

  if (typeof payload !== 'object') {
    return out;
  }

  const source = payload as Record<string, unknown>;
  const fields = ['status', 'state', 'code', 'reason', 'message', 'error', 'errors', 'legacyCode', 'legacyReason'];

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      continue;
    }

    const value = source[field];
    if (typeof value === 'string') {
      out.push(normalizeIndicatorToken(value));
      continue;
    }

    collectSandboxTokenIndicators(value, out, depth + 1);
  }

  return out;
}

export function isSandboxMissingTokenIndicator(payload: unknown): boolean {
  const tokens = collectSandboxTokenIndicators(payload);
  return tokens.some((token) => {
    if (!token) {
      return false;
    }

    return SANDBOX_TOKEN_KNOWN_INDICATORS.has(token)
      || token.startsWith(LEGACY_SANDBOX_TOKEN_MESSAGE_PREFIX);
  });
}

export function extractSandboxTokenMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const source = payload as Record<string, unknown>;
  if (typeof source.message === 'string' && source.message.trim()) {
    return source.message.trim();
  }
  if (typeof source.error === 'string' && source.error.trim()) {
    return source.error.trim();
  }

  if (source.error && typeof source.error === 'object') {
    const nestedError = source.error as Record<string, unknown>;
    if (typeof nestedError.message === 'string' && nestedError.message.trim()) {
      return nestedError.message.trim();
    }
  }

  if (Array.isArray(source.errors)) {
    for (const item of source.errors) {
      const candidate = extractSandboxTokenMessage(item);
      if (candidate) {
        return candidate;
      }
    }
  }

  return '';
}

export function toCanonicalSandboxMissingTokenError(payload: unknown): CanonicalSandboxMissingTokenError | null {
  if (!isSandboxMissingTokenIndicator(payload)) {
    return null;
  }

  return {
    status: SANDBOX_TOKEN_CANONICAL_STATE,
    code: SANDBOX_TOKEN_CANONICAL_CODE,
    reason: SANDBOX_TOKEN_CANONICAL_STATE,
    message: extractSandboxTokenMessage(payload) || 'Sandbox tracker token is missing',
    legacyCode: LEGACY_SANDBOX_TOKEN_CODE,
    legacyReason: LEGACY_SANDBOX_TOKEN_CODE,
  };
}

export function toCanonicalSandboxMissingTokenErrorFromUnknown(error: unknown): CanonicalSandboxMissingTokenError | null {
  const candidates: unknown[] = [error];

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (record.payload != null) {
      candidates.push(record.payload);
    }
    if (record.cause != null) {
      candidates.push(record.cause);
    }
  }

  for (const candidate of candidates) {
    const mapped = toCanonicalSandboxMissingTokenError(candidate);
    if (mapped) {
      return mapped;
    }
  }

  return null;
}

export function toSandboxTokenRemediationMessage(errorOrPayload?: unknown): string {
  const mapped = toCanonicalSandboxMissingTokenErrorFromUnknown(errorOrPayload)
    ?? toCanonicalSandboxMissingTokenError(errorOrPayload);

  const baseMessage = mapped?.message?.trim() || 'Sandbox tracker token is missing';
  const hasGuidance = baseMessage.includes('--tracker-token')
    && baseMessage.includes('INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN');

  if (hasGuidance) {
    return baseMessage;
  }

  const normalizedBase = /[.!?]$/.test(baseMessage) ? baseMessage : `${baseMessage}.`;
  return `${normalizedBase} ${SANDBOX_TOKEN_REMEDIATION_GUIDANCE}`;
}

export function normalizePlanningRecord(value: unknown): PlanningRecordItem | null {
  const record = asRecord(value);
  const recordId = asTrimmedString(record.recordId) || asTrimmedString(record.id);
  if (!recordId) {
    return null;
  }

  const acceptanceCriteria = asStringList(record.acceptanceCriteria);
  const acceptanceCriteriaText = asTrimmedString(record.acceptanceCriteriaText)
    || asTrimmedString(record.acceptanceCriteriaSummary)
    || '';

  return {
    ...record,
    recordId,
    scope: asTrimmedString(record.scope) || 'global',
    ownerId: asTrimmedString(record.ownerId),
    repoId: typeof record.repoId === 'string' || record.repoId === null ? (record.repoId as string | null) : null,
    title: asString(record.title),
    summary: asString(record.summary),
    acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    acceptanceCriteriaText: acceptanceCriteriaText || undefined,
    targetRepoIds: asStringList(record.targetRepoIds),
    state: asTrimmedString(record.state) || 'thought',
    score: asNullableNumber(record.score),
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

export function normalizePlanningSearchResult(value: unknown): PlanningSearchResultItem | null {
  const record = asRecord(value);
  const recordId = asTrimmedString(record.recordId) || asTrimmedString(record.id);
  if (!recordId) {
    return null;
  }

  return {
    ...record,
    rank: Math.max(1, Math.floor(asNumber(record.rank, 1))),
    recordId,
    score: asNumber(record.score, 0),
    semanticScore: asNullableNumber(record.semanticScore) ?? undefined,
    lexicalScore: asNullableNumber(record.lexicalScore) ?? undefined,
    scope: asTrimmedString(record.scope) || 'global',
    status: asTrimmedString(record.status) || 'unknown',
    createdAt: asTrimmedString(record.createdAt) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
  };
}

export function normalizePlanningCompareReceipt(value: unknown): PlanningCompareReceipt | null {
  const record = asRecord(value);
  const receiptId = asTrimmedString(record.receiptId);
  if (!receiptId) {
    return null;
  }

  return {
    ...record,
    receiptId,
    gateState: asTrimmedString(record.gateState) || undefined,
    reason: asTrimmedString(record.reason) || undefined,
    mergeEligible: asBoolean(record.mergeEligible, false),
    compareHash: asTrimmedString(record.compareHash) || undefined,
    sourceIdsHash: asTrimmedString(record.sourceIdsHash) || undefined,
    versionVector: record.versionVector && typeof record.versionVector === 'object'
      ? (record.versionVector as Record<string, unknown>)
      : null,
  };
}

export function normalizePlanningMergeIntentToken(value: unknown): PlanningMergeIntentToken | null {
  const record = asRecord(value);
  const tokenId = asTrimmedString(record.tokenId);
  if (!tokenId) {
    return null;
  }

  return {
    ...record,
    tokenId,
    actorId: asTrimmedString(record.actorId) || undefined,
    repoId: asTrimmedString(record.repoId) || undefined,
    sourceIdsHash: asTrimmedString(record.sourceIdsHash) || undefined,
    targetId: asTrimmedString(record.targetId) || undefined,
    compareHash: asTrimmedString(record.compareHash) || undefined,
    compareReceiptId: asTrimmedString(record.compareReceiptId) || undefined,
    issuedAt: asTrimmedString(record.issuedAt) || undefined,
    expiresAt: asTrimmedString(record.expiresAt) || undefined,
    consumedAt: typeof record.consumedAt === 'string' || record.consumedAt === null
      ? (record.consumedAt as string | null)
      : null,
    versionVector: record.versionVector && typeof record.versionVector === 'object'
      ? (record.versionVector as Record<string, unknown>)
      : null,
    versionVectorHash: asTrimmedString(record.versionVectorHash) || null,
  };
}

export function normalizePolicyPreflight(payload: unknown): PolicyPreflightResponse {
  const record = asRecord(payload);
  const reason = asTrimmedString(record.reason);
  const message = asTrimmedString(record.message) || reason;

  return {
    ...record,
    ok: asBoolean(record.ok, false),
    status: asTrimmedString(record.status) || 'unknown',
    reason,
    message,
    checkedAt: asTrimmedString(record.checkedAt) || undefined,
    validatorPath: asTrimmedString(record.validatorPath) || undefined,
    exitCode: asNullableNumber(record.exitCode) ?? undefined,
  };
}

export function normalizePlanningRecordsResponse(payload: unknown): PlanningRecordsResponse {
  const record = asRecord(payload);

  return {
    ...record,
    records: asArray(record.records)
      .map((entry) => normalizePlanningRecord(entry))
      .filter((entry): entry is PlanningRecordItem => entry !== null),
    requestedScopes: asStringList(record.requestedScopes),
    deniedScopes: asStringList(record.deniedScopes),
    versionVector: asRecord(record.versionVector),
  };
}

export function normalizePlanningSearchResponse(payload: unknown): PlanningSearchResponse {
  const record = asRecord(payload);

  return {
    ...record,
    results: asArray(record.results)
      .map((entry) => normalizePlanningSearchResult(entry))
      .filter((entry): entry is PlanningSearchResultItem => entry !== null),
    requestedScopes: asStringList(record.requestedScopes),
    deniedScopes: asStringList(record.deniedScopes),
    query: asTrimmedString(record.query) || undefined,
    versionVector: asRecord(record.versionVector),
  };
}

export function normalizePlanningCreateResponse(payload: unknown): PlanningCreateResponse {
  const record = asRecord(payload);
  return {
    ...record,
    record: normalizePlanningRecord(record.record) ?? undefined,
    idempotency: asRecord(record.idempotency),
    versionVector: asRecord(record.versionVector),
  };
}

export function normalizePlanningCompareResponse(payload: unknown): PlanningCompareResponse {
  const record = asRecord(payload);
  const compareReceipt = normalizePlanningCompareReceipt(record.compareReceipt);

  return {
    ...record,
    requestedScopes: asStringList(record.requestedScopes),
    deniedScopes: asStringList(record.deniedScopes),
    planningRecords: asArray(record.planningRecords)
      .map((entry) => normalizePlanningRecord(entry))
      .filter((entry): entry is PlanningRecordItem => entry !== null),
    matches: asArray(record.matches)
      .map((entry) => normalizePlanningSearchResult(entry))
      .filter((entry): entry is PlanningSearchResultItem => entry !== null),
    compareReceipt,
    gateState: asTrimmedString(record.gateState) || compareReceipt?.gateState,
    reason: asTrimmedString(record.reason) || compareReceipt?.reason,
    mergeEligible: asBoolean(record.mergeEligible, compareReceipt?.mergeEligible ?? false),
    downgrade: record.downgrade && typeof record.downgrade === 'object'
      ? (record.downgrade as Record<string, unknown>)
      : null,
    versionVector: asRecord(record.versionVector),
    newerDataAvailable: asBoolean(record.newerDataAvailable, false),
    implementedOutcomes: asRecord(record.implementedOutcomes),
  };
}

export function normalizePlanningMergeIntentResponse(payload: unknown): PlanningMergeIntentResponse {
  const record = asRecord(payload);
  return {
    ...record,
    intentToken: normalizePlanningMergeIntentToken(record.intentToken),
    ttlMs: asNullableNumber(record.ttlMs) ?? undefined,
    gateState: asTrimmedString(record.gateState) || undefined,
    downgrade: record.downgrade && typeof record.downgrade === 'object'
      ? (record.downgrade as Record<string, unknown>)
      : null,
    error: record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : undefined,
  };
}

export function normalizePlanningMergeResponse(payload: unknown): PlanningMergeResponse {
  const record = asRecord(payload);

  return {
    ...record,
    mergeAccepted: asBoolean(record.mergeAccepted, false),
    mergeEvent: asRecord(record.mergeEvent),
    mergeRecord: normalizePlanningRecord(record.mergeRecord),
    idempotency: asRecord(record.idempotency),
    gateState: asTrimmedString(record.gateState) || undefined,
    downgrade: record.downgrade && typeof record.downgrade === 'object'
      ? (record.downgrade as Record<string, unknown>)
      : null,
    error: record.error && typeof record.error === 'object'
      ? (record.error as Record<string, unknown>)
      : undefined,
  };
}

export function normalizeSdkSessionSummary(value: unknown): SdkSessionSummary | null {
  const record = asRecord(value);
  const sessionId = asTrimmedString(record.sessionId) || asTrimmedString(record.id);
  if (!sessionId) {
    return null;
  }

  return {
    ...record,
    sessionId,
    model: typeof record.model === 'string' || record.model == null
      ? (record.model as string | null | undefined)
      : undefined,
    createdAt: asTrimmedString(record.createdAt) || undefined,
    sseClientCount: asNumber(record.sseClientCount, 0),
  };
}

export function normalizeSdkSessionsResponse(payload: unknown): SdkSessionsResponse {
  const record = asRecord(payload);

  return {
    sessions: asArray(record.sessions)
      .map((entry) => normalizeSdkSessionSummary(entry))
      .filter((entry): entry is SdkSessionSummary => entry !== null),
  };
}

export function normalizeSdkHealthResponse(payload: unknown): SdkHealthResponse {
  const record = asRecord(payload);

  return {
    ...record,
    connected: asBoolean(record.connected, false),
    enabled: asBoolean(record.enabled, true),
    state: asTrimmedString(record.state) || 'unknown',
    reason: asTrimmedString(record.reason) || undefined,
    mode: asTrimmedString(record.mode) || undefined,
    sessionCount: asNumber(record.sessionCount, 0),
    cliVersion: asTrimmedString(record.cliVersion) || undefined,
    error: asTrimmedString(record.error) || undefined,
  };
}

export function normalizeExecutorRetryPolicy(value: unknown): ExecutorRetryPolicy {
  const record = asRecord(value);
  return {
    enabled: asBoolean(record.enabled, true),
    maxAttempts: asNumber(record.maxAttempts, 3),
    baseDelayMs: asNumber(record.baseDelayMs, 30_000),
    maxDelayMs: asNumber(record.maxDelayMs, 300_000),
    backoffMultiplier: asNumber(record.backoffMultiplier, 2),
    jitterRatio: asNumber(record.jitterRatio, 0.15),
  };
}

export function normalizeExecutorRunEvent(value: unknown): ExecutorRunEvent | null {
  const record = asRecord(value);
  const at = asTrimmedString(record.at);
  const type = asTrimmedString(record.type);
  if (!at || !type) {
    return null;
  }

  return {
    at,
    type,
    level: asTrimmedString(record.level) || undefined,
    message: asTrimmedString(record.message) || type,
    data: record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null,
  };
}

export function normalizeExecutorRun(value: unknown): ExecutorRun | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  const jobId = asTrimmedString(record.jobId);
  if (!id || !jobId) {
    return null;
  }

  return {
    ...record,
    id,
    jobId,
    repoId: asTrimmedString(record.repoId) || null,
    repoPath: asTrimmedString(record.repoPath) || null,
    orchestration: asRecord(record.orchestration),
    worktree: normalizeWorktreeBinding(record.worktree),
    status: asTrimmedString(record.status) || 'unknown',
    attemptCount: asNumber(record.attemptCount, 0),
    maxAttempts: asNumber(record.maxAttempts, 0),
    createdAt: asTrimmedString(record.createdAt),
    updatedAt: asTrimmedString(record.updatedAt),
    startedAt: asTrimmedString(record.startedAt) || null,
    finishedAt: asTrimmedString(record.finishedAt) || null,
    nextRetryAt: asTrimmedString(record.nextRetryAt) || null,
    sessionId: asTrimmedString(record.sessionId) || null,
    messageId: asTrimmedString(record.messageId) || null,
    error: asTrimmedString(record.error) || null,
    summary: asTrimmedString(record.summary) || null,
    createdSession: asBoolean(record.createdSession, false),
    events: asArray(record.events)
      .map((entry) => normalizeExecutorRunEvent(entry))
      .filter((entry): entry is ExecutorRunEvent => entry !== null),
  };
}

export function normalizeExecutorJob(value: unknown): ExecutorJob | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    title: asTrimmedString(record.title) || id,
    prompt: asString(record.prompt),
    repoId: asTrimmedString(record.repoId) || null,
    repoPath: asTrimmedString(record.repoPath) || null,
    orchestration: asRecord(record.orchestration),
    worktree: normalizeWorktreeBinding(record.worktree),
    targetType: (asTrimmedString(record.targetType) || 'create-session') as ExecutorJob['targetType'],
    existingSessionId: asTrimmedString(record.existingSessionId) || null,
    model: asTrimmedString(record.model) || null,
    contextType: asTrimmedString(record.contextType) || null,
    sandboxId: asTrimmedString(record.sandboxId) || null,
    scheduleAt: asTrimmedString(record.scheduleAt) || null,
    retryPolicy: normalizeExecutorRetryPolicy(record.retryPolicy),
    createdAt: asTrimmedString(record.createdAt),
    updatedAt: asTrimmedString(record.updatedAt),
    lastRunId: asTrimmedString(record.lastRunId) || null,
    activeRunId: asTrimmedString(record.activeRunId) || null,
    status: asTrimmedString(record.status) || 'idle',
  };
}

export function normalizeExecutorHealthResponse(payload: unknown): ExecutorHealthResponse {
  const record = asRecord(payload);
  return {
    ...record,
    enabled: asBoolean(record.enabled, false),
    state: asTrimmedString(record.state) || 'unknown',
    jobCount: asNumber(record.jobCount, 0),
    runCount: asNumber(record.runCount, 0),
    activeRunCount: asNumber(record.activeRunCount, 0),
    scheduledJobCount: asNumber(record.scheduledJobCount, 0),
    openedSessionCount: asNumber(record.openedSessionCount, 0),
    lastError: asTrimmedString(record.lastError) || null,
    statePath: asTrimmedString(record.statePath) || undefined,
  };
}

export function normalizeExecutorJobsResponse(payload: unknown): ExecutorJobsResponse {
  const record = asRecord(payload);
  return {
    jobs: asArray(record.jobs)
      .map((entry) => normalizeExecutorJob(entry))
      .filter((entry): entry is ExecutorJob => entry !== null),
  };
}

export function normalizeExecutorRunsResponse(payload: unknown): ExecutorRunsResponse {
  const record = asRecord(payload);
  return {
    runs: asArray(record.runs)
      .map((entry) => normalizeExecutorRun(entry))
      .filter((entry): entry is ExecutorRun => entry !== null),
  };
}

export function normalizePlanningResearchNote(value: unknown): PlanningResearchNote | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id) || asTrimmedString(record.noteId);
  if (!id) {
    return null;
  }

  const sources = asStringList(record.sources);
  const source = asTrimmedString(record.source);

  return {
    ...record,
    id,
    phase: asTrimmedString(record.phase) || 'research',
    title: asString(record.title),
    content: asString(record.content) || asString(record.summary),
    createdAt: asTrimmedString(record.createdAt) || new Date(0).toISOString(),
    noteId: id,
    summary: asString(record.summary) || undefined,
    sources: sources.length > 0 ? sources : (source ? [source] : undefined),
    source: source || undefined,
    updatedAt: asTrimmedString(record.updatedAt) || undefined,
  };
}

export function normalizePlanningResearchNotesResponse(payload: unknown): PlanningResearchNotesResponse {
  const record = asRecord(payload);

  return {
    ...record,
    recordId: asTrimmedString(record.recordId),
    researchNotes: asArray(record.researchNotes)
      .map((entry) => normalizePlanningResearchNote(entry))
      .filter((entry): entry is PlanningResearchNote => entry !== null),
  };
}

export function normalizePlanningDiagram(value: unknown): PlanningDiagram | null {
  const record = asRecord(value);
  const id = asTrimmedString(record.id) || asTrimmedString(record.diagramId);
  if (!id) {
    return null;
  }

  return {
    ...record,
    id,
    type: asTrimmedString(record.type) || 'diagram',
    title: asString(record.title),
    content: asString(record.content),
    format: asTrimmedString(record.format) || 'mermaid',
    createdAt: asTrimmedString(record.createdAt) || new Date(0).toISOString(),
    diagramId: id,
    updatedAt: asTrimmedString(record.updatedAt) || undefined,
  };
}

export function normalizePlanningDiagramsResponse(payload: unknown): PlanningDiagramsResponse {
  const record = asRecord(payload);

  return {
    ...record,
    recordId: asTrimmedString(record.recordId),
    diagrams: asArray(record.diagrams)
      .map((entry) => normalizePlanningDiagram(entry))
      .filter((entry): entry is PlanningDiagram => entry !== null),
  };
}

export function normalizeGatewayConfig(value: unknown): GatewayConfig {
  const config = asRecord(value);
  const acp = asRecord(config.acp);
  const discord = asRecord(config.discord);
  const telegram = asRecord(config.telegram);
  const workspaces = asRecord(config.workspaces);

  return {
    ...config,
    mode: asTrimmedString(config.mode) || 'auto',
    acp: {
      ...acp,
      host: asTrimmedString(acp.host) || '127.0.0.1',
      port: asNumber(acp.port, 3000),
    },
    discord: Object.keys(discord).length
      ? {
        ...discord,
        allowlistedUserIds: asStringList(discord.allowlistedUserIds),
        guildId: asTrimmedString(discord.guildId) || undefined,
        channelId: asTrimmedString(discord.channelId) || undefined,
        permissionsChannelId: asTrimmedString(discord.permissionsChannelId) || undefined,
      }
      : undefined,
    telegram: Object.keys(telegram).length
      ? {
        ...telegram,
        allowlistedUserIds: asStringList(telegram.allowlistedUserIds),
      }
      : undefined,
    workspaces: {
      ...workspaces,
      allowedRoots: asStringList(workspaces.allowedRoots),
      activeRoot: asTrimmedString(workspaces.activeRoot),
    },
  };
}

export function normalizeGatewayConfigResponse(payload: unknown): GatewayConfigResponse {
  const record = asRecord(payload);

  return {
    ...record,
    exists: asBoolean(record.exists, false),
    configPath: asString(record.configPath),
    config: record.config && typeof record.config === 'object' ? normalizeGatewayConfig(record.config) : null,
  };
}

export function normalizeCodexProviderStatusResponse(payload: unknown): CodexProviderStatusResponse {
  const record = asRecord(payload);
  const gateway = asRecord(record.gateway);
  const providerId = asTrimmedString(record.providerId) || 'openai';
  const deepseek = asRecord(record.deepseek);

  return {
    ...record,
    codexHome: asString(record.codexHome),
    configPath: asString(record.configPath),
    statePath: asString(record.statePath),
    backupPath: asString(record.backupPath),
    exists: asBoolean(record.exists, false),
    activeMode: asTrimmedString(record.activeMode) || 'native',
    providerId,
    hasManagedBlock: asBoolean(record.hasManagedBlock, false),
    hasLegacyBlock: asBoolean(record.hasLegacyBlock, false),
    hasBackup: asBoolean(record.hasBackup, false),
    lastAppliedAt: asTrimmedString(record.lastAppliedAt) || null,
    lastResetAt: asTrimmedString(record.lastResetAt) || null,
    backupCreatedAt: asTrimmedString(record.backupCreatedAt) || null,
    changed: asBoolean(record.changed, false),
    action: asTrimmedString(record.action) || undefined,
    gateway: {
      ...gateway,
      providerId: asTrimmedString(gateway.providerId) || providerId,
      model: asTrimmedString(gateway.model) || '',
      baseUrl: asTrimmedString(gateway.baseUrl) || '',
    },
    deepseek: Object.keys(deepseek).length > 0 ? {
      bridgePath: typeof deepseek.bridgePath === 'string' ? deepseek.bridgePath : null,
      bridgeConfigPath: typeof deepseek.bridgeConfigPath === 'string' ? deepseek.bridgeConfigPath : null,
      bridgeUrl: asTrimmedString(deepseek.bridgeUrl) || '',
      keyConfigured: asBoolean(deepseek.keyConfigured, false),
      bridgeReachable: asBoolean(deepseek.bridgeReachable, false),
      modelsVisible: asBoolean(deepseek.modelsVisible, false),
      bridgeBinaryAvailable: asBoolean(deepseek.bridgeBinaryAvailable, false),
      bridgeCheckoutAvailable: asBoolean(deepseek.bridgeCheckoutAvailable, false),
      bridgeRunning: asBoolean(deepseek.bridgeRunning, false),
      modelIds: Array.isArray(deepseek.modelIds) ? deepseek.modelIds as string[] : undefined,
      probeError: typeof deepseek.probeError === 'string' ? deepseek.probeError : null,
    } : undefined,
  };
}


export function normalizeGatewaySaveConfigResponse(payload: unknown): GatewaySaveConfigResponse {
  const record = asRecord(payload);

  return {
    ...record,
    ok: asBoolean(record.ok, false),
    configPath: asTrimmedString(record.configPath) || undefined,
    error: asTrimmedString(record.error) || undefined,
  };
}

export function normalizeGatewayStateError(value: unknown): GatewayStateError {
  const error = asRecord(value);

  return {
    ...error,
    code: asTrimmedString(error.code) || undefined,
    reason: asTrimmedString(error.reason) || undefined,
    message: asTrimmedString(error.message) || undefined,
    statusCode: asNullableNumber(error.statusCode),
  };
}

export function normalizeGatewayStateResponse(payload: unknown): GatewayStateResponse {
  const record = asRecord(payload);
  const gateway = asRecord(record.gateway);
  const tracker = asRecord(record.tracker);
  const planningPersistence = asRecord(record.planningPersistence);
  const planningAuthority = asRecord(record.planningAuthority);

  return {
    ...record,
    ready: asBoolean(record.ready, false),
    checkedAt: asTrimmedString(record.checkedAt) || undefined,
    error: record.error && typeof record.error === 'object'
      ? normalizeGatewayStateError(record.error)
      : null,
    errors: asArray(record.errors)
      .map((entry) => normalizeGatewayStateError(entry))
      .filter((entry) => Boolean(entry.code || entry.reason || entry.message || entry.statusCode != null)),
    gateway: {
      ...gateway,
      ready: asBoolean(gateway.ready, false),
      status: asTrimmedString(gateway.status) || 'unknown',
      config: asRecord(gateway.config),
    },
    tracker: {
      ...tracker,
      ready: asBoolean(tracker.ready, false),
      status: asTrimmedString(tracker.status) || 'unknown',
      statusCode: asNullableNumber(tracker.statusCode),
      error: tracker.error && typeof tracker.error === 'object' ? normalizeGatewayStateError(tracker.error) : null,
    },
    planningPersistence: {
      ...planningPersistence,
      ready: asBoolean(planningPersistence.ready, false),
      status: asTrimmedString(planningPersistence.status) || 'unknown',
      required: asBoolean(planningPersistence.required, false),
      configured: asBoolean(planningPersistence.configured, false),
      usable: asBoolean(planningPersistence.usable, false),
      initSupported: asBoolean(planningPersistence.initSupported, false),
      initRequired: asBoolean(planningPersistence.initRequired, false),
      error: planningPersistence.error && typeof planningPersistence.error === 'object'
        ? normalizeGatewayStateError(planningPersistence.error)
        : null,
    },
    planningAuthority: Object.keys(planningAuthority).length > 0
      ? {
          ...planningAuthority,
          ready: asBoolean(planningAuthority.ready, false),
          enabled: asBoolean(planningAuthority.enabled, false),
          configured: asBoolean(planningAuthority.configured, false),
          status: asTrimmedString(planningAuthority.status) || 'unknown',
          cliPath: asTrimmedString(planningAuthority.cliPath) || null,
          dbPath: asTrimmedString(planningAuthority.dbPath) || null,
          diagnostics: asRecord(planningAuthority.diagnostics),
          error: planningAuthority.error && typeof planningAuthority.error === 'object'
            ? normalizeGatewayStateError(planningAuthority.error)
            : null,
        }
      : null,
  };
}

export function normalizeGatewayScanReposResponse(payload: unknown): GatewayScanReposResponse {
  const record = asRecord(payload);
  const roots = asArray(record.roots).map((entry) => {
    const rootRecord = asRecord(entry);
    const repos = asArray(rootRecord.repos)
      .map((repo) => {
        const repoRecord = asRecord(repo);
        const absPath = asTrimmedString(repoRecord.absPath);
        if (!absPath) {
          return null;
        }

        return {
          ...repoRecord,
          absPath,
          name: asTrimmedString(repoRecord.name) || absPath,
          isGit: asBoolean(repoRecord.isGit, true),
        };
      })
      .filter((repo): repo is { absPath: string; name: string; isGit: boolean; [key: string]: unknown } => repo !== null);

    return {
      ...rootRecord,
      scanRoot: asTrimmedString(rootRecord.scanRoot) || '(unknown root)',
      repos,
    };
  });

  return {
    ...record,
    roots,
  };
}

export function normalizeCatalogRepoInventoryStorage(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  return {
    ...record,
    path: asTrimmedString(record.path) || undefined,
    exists: asBoolean(record.exists, false),
  };
}

export function normalizeCatalogRepoInventoryEntry(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const repoId = asTrimmedString(record.repoId);
  const repoPath = asTrimmedString(record.repoPath);
  if (!repoId && !repoPath && !asTrimmedString(record.repoLabel)) {
    return null;
  }

  return {
    ...record,
    repoId: repoId || undefined,
    repoPath: repoPath || undefined,
    repoLabel: asTrimmedString(record.repoLabel) || undefined,
    sources: asStringList(record.sources),
  };
}

export function normalizeCatalogWorkspaceScan(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  const defaultRoots = asStringList(record.defaultRoots);
  const customScanRoots = asStringList(record.customScanRoots);
  const scanRoots = asStringList(record.scanRoots);
  if (!defaultRoots.length && !customScanRoots.length && !scanRoots.length && !Object.keys(record).length) {
    return null;
  }

  return {
    ...record,
    storage: normalizeCatalogRepoInventoryStorage(record.storage),
    defaultRoots,
    customScanRoots,
    scanRoots,
  };
}

export function normalizeCatalogReposListResponse(payload: unknown): CatalogReposListResponse {
  const record = asRecord(payload);
  const repos = asArray(record.repos)
    .map((entry) => normalizeCatalogRepoInventoryEntry(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  const selectedRepo = normalizeCatalogRepoInventoryEntry(record.selectedRepo);

  return {
    ...record,
    count: asNumber(record.count, repos.length),
    selectedRepo,
    storage: normalizeCatalogRepoInventoryStorage(record.storage),
    workspaceScan: normalizeCatalogWorkspaceScan(record.workspaceScan),
    repos,
  };
}

export function normalizeCatalogRepoScanRootsMutationResponse(payload: unknown): CatalogRepoScanRootsMutationResponse {
  const normalized = normalizeCatalogReposListResponse(payload);
  const record = asRecord(payload);
  return {
    ...normalized,
    updated: asBoolean(record.updated, false),
  };
}

export function normalizePlanningPersistenceInitResponse(payload: unknown): PlanningPersistenceInitResponse {
  const record = asRecord(payload);

  return {
    ...record,
    ready: asBoolean(record.ready, false),
    initialized: asBoolean(record.initialized, false),
    planningPersistence: asRecord(record.planningPersistence),
    error: record.error && typeof record.error === 'object' ? asRecord(record.error) : asTrimmedString(record.error),
    errors: asArray(record.errors),
  };
}

export function appendPlanningQuery(endpoint: string, query: PlanningContextQuery, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();

  if (query.userId && query.userId.trim()) {
    params.set('userId', query.userId.trim());
  }
  if (query.repoId && query.repoId.trim()) {
    params.set('repoId', query.repoId.trim());
  }
  for (const scope of query.scopes ?? []) {
    const normalizedScope = scope.trim().toLowerCase();
    if (normalizedScope) {
      params.append('scope', normalizedScope);
    }
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value.trim()) {
      params.set(key, value.trim());
    }
  }

  const suffix = params.toString();
  return suffix ? `${endpoint}?${suffix}` : endpoint;
}

export function createUrl(endpoint: string, baseUrl?: string, query?: ApiRequestOptions['query']): URL {
  const isAbsolute = /^https?:\/\//i.test(endpoint);

  let url: URL;
  if (isAbsolute) {
    url = new URL(endpoint);
  } else if (baseUrl) {
    url = new URL(endpoint, baseUrl);
  } else if (typeof window !== 'undefined' && window.location?.origin) {
    url = new URL(endpoint, window.location.origin);
  } else {
    throw new Error('Relative API endpoint requires baseUrl outside a browser environment.');
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

export async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  return response.text();
}

function classifyNetworkError(error: unknown): { code: string; message: string } {
  if (error && typeof error === 'object') {
    const name = (error as { name?: unknown }).name;
    if (name === 'AbortError') {
      return { code: 'aborted', message: error instanceof Error ? error.message : 'Request aborted' };
    }
  }
  const rawMessage = error instanceof Error ? error.message : 'Network request failed';
  const lower = rawMessage.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('fetch failed')) {
    return { code: 'connection_refused', message: rawMessage };
  }
  return { code: 'network', message: rawMessage };
}

export async function apiRequest<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T> {
  const { baseUrl, query, headers, ...init } = options;
  const url = createUrl(endpoint, baseUrl, query);

  const mergedHeaders = new Headers(headers || undefined);
  if (!mergedHeaders.has('Accept')) {
    mergedHeaders.set('Accept', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      ...init,
      headers: mergedHeaders,
    });
  } catch (error) {
    const { code, message } = classifyNetworkError(error);
    notifyApiRequestFailure(endpoint, code, message);
    throw new ApiError(message, 0, null, code);
  }

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const fallbackMessage = `API request failed with status ${response.status}`;
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : fallbackMessage;
    notifyApiRequestSuccess(endpoint);
    throw new ApiError(message, response.status, payload, 'http_error');
  }

  notifyApiRequestSuccess(endpoint);
  return payload as T;
}

function notifyApiRequestFailure(endpoint: string, code: string, message: string): void {
  if (isHealthEndpoint(endpoint)) {
    return;
  }
  runtimeHealthStore.recordConnectionFailure(endpoint, code as 'connection_refused' | 'aborted' | 'network' | 'http_error' | 'unknown', message);
}

function notifyApiRequestSuccess(endpoint: string): void {
  if (isHealthEndpoint(endpoint)) {
    return;
  }
  runtimeHealthStore.recordConnectionSuccess();
}

function isHealthEndpoint(endpoint: string): boolean {
  if (endpoint === '/api/health') return true;
  const queryIndex = endpoint.indexOf('?');
  const path = queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex);
  return path === '/api/health' || path.endsWith('/api/health');
}

export function normalizeExecutorWorktreeRecord(value: unknown): ExecutorWorktreeRecord | null {
  const worktree = normalizeWorktreeBinding(value);
  if (!worktree) {
    return null;
  }
  const record = asRecord(value);
  const gitRecord = asRecord(record.git);
  const pathValue = asTrimmedString(record.path || record.worktreePath) || null;
  const branchValue = asTrimmedString(record.branch) || null;
  const sourceValue = asTrimmedString(record.source) || null;
  const modeValue = asTrimmedString(record.mode) || null;
  const statusValue = asTrimmedString(record.status) || null;
  const headValue = asTrimmedString(record.head) || null;
  const git: ExecutorWorktreeRecord['git'] = Object.keys(gitRecord).length > 0
    ? {
        head: asTrimmedString(gitRecord.head) || null,
        detached: asBoolean(gitRecord.detached, false),
        bare: asBoolean(gitRecord.bare, false),
        locked: asTrimmedString(gitRecord.locked) || null,
        prunable: asTrimmedString(gitRecord.prunable) || null,
        guid: asTrimmedString(gitRecord.guid) || null,
        branch: asTrimmedString(gitRecord.branch) || null,
        ahead: asNumber(gitRecord.ahead, 0),
        behind: asNumber(gitRecord.behind, 0),
        staged: asNumber(gitRecord.staged, 0),
        unstaged: asNumber(gitRecord.unstaged, 0),
        untracked: asNumber(gitRecord.untracked, 0),
        changed: asNumber(gitRecord.changed, 0),
        probeError: asTrimmedString(gitRecord.probeError) || null,
        mtimeMs: typeof gitRecord.mtimeMs === 'number' && Number.isFinite(gitRecord.mtimeMs) ? gitRecord.mtimeMs : null,
      }
    : null;
  return {
    ...worktree,
    repoId: asTrimmedString(record.repoId) || null,
    repoPath: asTrimmedString(record.repoPath) || null,
    repoLabel: asTrimmedString(record.repoLabel) || null,
    updatedAt: asTrimmedString(record.updatedAt) || null,
    path: pathValue,
    worktreePath: pathValue,
    source: sourceValue,
    mode: modeValue,
    branch: branchValue,
    status: statusValue,
    head: headValue,
    detached: typeof record.detached === 'boolean' ? record.detached : (git ? git.detached : null),
    git,
    discovery: asTrimmedString(record.discovery) || null,
    lifecycle: asRecord(record.lifecycle),
    validation: asRecord(record.validation),
    _discovered: asBoolean(record._discovered, false),
    _discoveredOnly: asBoolean(record._discoveredOnly, false),
    _merged: asTrimmedString(record._merged) || null,
    _stableOrder: typeof record._stableOrder === 'number' && Number.isFinite(record._stableOrder) ? record._stableOrder : null,
  };
}

export function normalizeExecutorWorktreeDiscovery(value: unknown): ExecutorWorktreeDiscovery | null {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return null;
  }
  return {
    contractVersion: asTrimmedString(record.contractVersion) || '1',
    repoId: asTrimmedString(record.repoId) || null,
    repoPath: asTrimmedString(record.repoPath) || null,
    gitListOk: typeof record.gitListOk === 'boolean' ? record.gitListOk : null,
    gitListError: asTrimmedString(record.gitListError) || null,
    persistedCount: asNumber(record.persistedCount, 0),
    discoveredCount: asNumber(record.discoveredCount, 0),
  };
}
