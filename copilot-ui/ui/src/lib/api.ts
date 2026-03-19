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
  CatalogBundlesResponse,
  CatalogRepoMutationResponse,
  CatalogRepoScanRootsMutationResponse,
  CatalogReposListResponse,
  CatalogRefreshResponse,
  CatalogSearchRequest,
  CatalogSearchSelectionPayload,
  CatalogSearchSelectionResponse,
  CatalogSearchResponse,
  CatalogSummaryResponse,
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
  PlanningBacklogMutationResponse,
  PlanningBacklogResponse,
  PlanningDiagram,
  PlanningDiagramsResponse,
  PlanningCompareReceipt,
  PlanningCompareResponse,
  PlanningCreateResponse,
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
  PolicyPreflightResponse,
  RuntimeCatalogHealthResponse,
  SandboxLifecycleAction,
  SandboxLifecyclePayload,
  SandboxLifecycleResponse,
  SdkHealthResponse,
  SdkSendResponse,
  SdkSessionSummary,
  SdkSessionsResponse,
  SessionPlansResponse,
  SessionAgentUsageResponse,
  SessionPlanMutationResponse,
  SessionStructuredStateResponse,
  SessionTextArtifactResponse,
  SkillsPreviewResponse,
  SessionsListResponse,
  TrackerPermissionsResponse,
  TrackerSessionsResponse,
  VersionResponse,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type PrimitiveQueryValue = string | number | boolean;

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
  planId?: string;
}

export interface SessionPlanSeedArtifactPayload {
  id: string;
  category: PlanningIntakeCategory;
  title: string;
  summary?: string;
  targetRepoIds?: string[];
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

function buildCatalogSelectorQuery(query: CatalogSelectorQuery = {}): ApiRequestOptions['query'] {
  return {
    repoId: query.repoId,
    repoPath: query.repoPath,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }

  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asTrimmedString(value: unknown, fallback = ''): string {
  const raw = asString(value, fallback);
  return raw.trim() || fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asNullableNumber(value: unknown): number | null {
  const numeric = asNumber(value, Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function asStringList(value: unknown): string[] {
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

export interface PlanningRepoSummary {
  repoId: string;
  repoPath: string;
  repoLabel: string;
}

export interface PlanningRepositoryBacklogRefApi extends PlanningRepositoryBacklogRef {
  canonicalName: 'Repository Backlog';
  repo: PlanningRepoSummary;
  filePath: string;
  repoRelativePath: 'docs/backlog.md';
  stableIdPattern: 'RB-###';
}

export interface PlanningRoadmapDirectoryRefApi extends PlanningRoadmapDirectoryRef {
  canonicalName: 'Roadmap';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/roadmaps';
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

export interface PlanningRoadmapsResponseApi {
  count: number;
  roadmaps: PlanningRoadmapApi[];
  repo: PlanningRepoSummary | null;
}

export interface PlanningBacklogKeyPointApi {
  date: string;
  text: string;
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
}

export interface PlanningBacklogSummaryApi {
  backlogPath?: string | null;
  repoRelativePath?: string;
  exists: boolean;
  formatVersion?: string;
  title?: string;
  description?: string;
  itemCount: number;
  items: PlanningBacklogItemApi[];
}

export interface PlanningBacklogResponseApi extends PlanningBacklogResponse {
  contractVersion?: string;
  kind?: string;
  deterministic?: boolean;
  repo: PlanningRepoSummary | null;
  backlog: PlanningBacklogSummaryApi;
}

export interface PlanningBacklogMutationResponseApi extends PlanningBacklogMutationResponse {
  item?: PlanningBacklogItemApi | null;
}

export interface PlanningIntakeDirectoryRefApi extends PlanningIntakeDirectoryRef {
  canonicalName: 'Planning Intake';
  repo: PlanningRepoSummary;
  directoryPath: string;
  repoRelativePath: 'docs/planning/intake';
  stableIdPattern: 'PI-###';
  supportedCategories: PlanningIntakeCategory[];
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

function trimTrailingPathSeparator(value: string): string {
  return value.replace(/[\\/]+$/g, '');
}

function detectPathSeparator(value: string): '\\' | '/' {
  return value.includes('\\') ? '\\' : '/';
}

function buildRepoPath(value: string, ...segments: string[]): string {
  const normalizedBase = trimTrailingPathSeparator(value.trim());
  const separator = detectPathSeparator(normalizedBase);
  const normalizedSegments = segments
    .map((segment) => String(segment || '').replace(/[\\/]+/g, separator))
    .filter((segment) => segment.length > 0);

  return [normalizedBase, ...normalizedSegments].join(separator);
}

function normalizePlanningRepoSummary(input: unknown): PlanningRepoSummary | null {
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

function normalizePlanningRoadmapItem(value: unknown): PlanningRoadmapItemApi | null {
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
  };
}

function normalizePlanningRoadmap(value: unknown): PlanningRoadmapApi | null {
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
  };
}

function normalizePlanningRoadmapsResponse(payload: unknown): PlanningRoadmapsResponseApi {
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

function normalizePlanningBacklogKeyPoint(value: unknown): PlanningBacklogKeyPointApi | null {
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

function normalizePlanningBacklogItem(value: unknown): PlanningBacklogItemApi | null {
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

function normalizePlanningBacklogSummary(value: unknown): PlanningBacklogSummaryApi {
  const record = asRecord(value);
  const items = asArray(record.items)
    .map((entry) => normalizePlanningBacklogItem(entry))
    .filter((entry): entry is PlanningBacklogItemApi => entry !== null);

  return {
    backlogPath: asTrimmedString(record.backlogPath) || null,
    repoRelativePath: asTrimmedString(record.repoRelativePath) || undefined,
    exists: asBoolean(record.exists, false),
    formatVersion: asTrimmedString(record.formatVersion) || undefined,
    title: asTrimmedString(record.title) || undefined,
    description: asTrimmedString(record.description) || undefined,
    itemCount: asNumber(record.itemCount, items.length),
    items,
  };
}

function normalizePlanningBacklogResponse(payload: unknown): PlanningBacklogResponseApi {
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

function normalizePlanningBacklogMutationResponse(payload: unknown): PlanningBacklogMutationResponseApi {
  const record = asRecord(payload);
  const response = normalizePlanningBacklogResponse(payload);
  return {
    ...response,
    ...record,
    item: normalizePlanningBacklogItem(record.item),
  };
}

const PLANNING_INTAKE_CATEGORIES = [
  'idea',
  'research',
  'refactor-candidate',
  'design-complaint',
  'audit-request',
  'roadmap-request',
  'review-prep',
  'commit-prep',
] as const;

function normalizePlanningIntakeCategory(value: unknown): PlanningIntakeCategory {
  const normalized = asTrimmedString(value).toLowerCase();
  if (PLANNING_INTAKE_CATEGORIES.includes(normalized as PlanningIntakeCategory)) {
    return normalized as PlanningIntakeCategory;
  }
  return 'idea';
}

function normalizePlanningIntakeArtifact(value: unknown): PlanningIntakeArtifactApi | null {
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

function normalizePlanningIntakeSummary(value: unknown): PlanningIntakeSummaryApi {
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

function normalizePlanningIntakeArtifactsResponse(payload: unknown): PlanningIntakeArtifactsResponseApi {
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
    filePath: buildRepoPath(normalizedRepoPath, 'docs', 'backlog.md'),
    repoRelativePath: 'docs/backlog.md',
    stableIdPattern: 'RB-###',
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
    directoryPath: buildRepoPath(normalizedRepoPath, 'docs', 'roadmaps'),
    repoRelativePath: 'docs/roadmaps',
    stableIdPattern: 'RM-<roadmap-slug>-###',
  };
}

export const SANDBOX_TOKEN_CANONICAL_STATE = 'token_missing';
export const SANDBOX_TOKEN_CANONICAL_CODE = 'MISSING_SANDBOX_TOKEN';
export const SANDBOX_TOKEN_REMEDIATION_GUIDANCE =
  'Provide tracker auth via --tracker-token or INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN.';

const LEGACY_SANDBOX_TOKEN_STATE = `${'missing'}_token`;
const LEGACY_SANDBOX_TOKEN_CODE = ['tracker', 'token', 'missing'].join('_');
const LEGACY_SANDBOX_TOKEN_MESSAGE_PREFIX = ['tracker', 'token', 'not', 'configured'].join(' ');

const SANDBOX_TOKEN_KNOWN_INDICATORS = new Set([
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

function normalizeIndicatorToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function collectSandboxTokenIndicators(payload: unknown, out: string[] = [], depth = 0): string[] {
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

function extractSandboxTokenMessage(payload: unknown): string {
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

function normalizePlanningRecord(value: unknown): PlanningRecordItem | null {
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

function normalizePlanningSearchResult(value: unknown): PlanningSearchResultItem | null {
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

function normalizePlanningCompareReceipt(value: unknown): PlanningCompareReceipt | null {
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

function normalizePlanningMergeIntentToken(value: unknown): PlanningMergeIntentToken | null {
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

function normalizePolicyPreflight(payload: unknown): PolicyPreflightResponse {
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

function normalizePlanningRecordsResponse(payload: unknown): PlanningRecordsResponse {
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

function normalizePlanningSearchResponse(payload: unknown): PlanningSearchResponse {
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

function normalizePlanningCreateResponse(payload: unknown): PlanningCreateResponse {
  const record = asRecord(payload);
  return {
    ...record,
    record: normalizePlanningRecord(record.record) ?? undefined,
    idempotency: asRecord(record.idempotency),
    versionVector: asRecord(record.versionVector),
  };
}

function normalizePlanningCompareResponse(payload: unknown): PlanningCompareResponse {
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

function normalizePlanningMergeIntentResponse(payload: unknown): PlanningMergeIntentResponse {
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

function normalizePlanningMergeResponse(payload: unknown): PlanningMergeResponse {
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

function normalizeSdkSessionSummary(value: unknown): SdkSessionSummary | null {
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

function normalizeSdkSessionsResponse(payload: unknown): SdkSessionsResponse {
  const record = asRecord(payload);

  return {
    sessions: asArray(record.sessions)
      .map((entry) => normalizeSdkSessionSummary(entry))
      .filter((entry): entry is SdkSessionSummary => entry !== null),
  };
}

function normalizeSdkHealthResponse(payload: unknown): SdkHealthResponse {
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

function normalizePlanningResearchNote(value: unknown): PlanningResearchNote | null {
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

function normalizePlanningResearchNotesResponse(payload: unknown): PlanningResearchNotesResponse {
  const record = asRecord(payload);

  return {
    ...record,
    recordId: asTrimmedString(record.recordId),
    researchNotes: asArray(record.researchNotes)
      .map((entry) => normalizePlanningResearchNote(entry))
      .filter((entry): entry is PlanningResearchNote => entry !== null),
  };
}

function normalizePlanningDiagram(value: unknown): PlanningDiagram | null {
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

function normalizePlanningDiagramsResponse(payload: unknown): PlanningDiagramsResponse {
  const record = asRecord(payload);

  return {
    ...record,
    recordId: asTrimmedString(record.recordId),
    diagrams: asArray(record.diagrams)
      .map((entry) => normalizePlanningDiagram(entry))
      .filter((entry): entry is PlanningDiagram => entry !== null),
  };
}

function normalizeGatewayConfig(value: unknown): GatewayConfig {
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

function normalizeGatewayConfigResponse(payload: unknown): GatewayConfigResponse {
  const record = asRecord(payload);

  return {
    ...record,
    exists: asBoolean(record.exists, false),
    configPath: asString(record.configPath),
    config: record.config && typeof record.config === 'object' ? normalizeGatewayConfig(record.config) : null,
  };
}

function normalizeGatewaySaveConfigResponse(payload: unknown): GatewaySaveConfigResponse {
  const record = asRecord(payload);

  return {
    ...record,
    ok: asBoolean(record.ok, false),
    configPath: asTrimmedString(record.configPath) || undefined,
    error: asTrimmedString(record.error) || undefined,
  };
}

function normalizeGatewayStateError(value: unknown): GatewayStateError {
  const error = asRecord(value);

  return {
    ...error,
    code: asTrimmedString(error.code) || undefined,
    reason: asTrimmedString(error.reason) || undefined,
    message: asTrimmedString(error.message) || undefined,
    statusCode: asNullableNumber(error.statusCode),
  };
}

function normalizeGatewayStateResponse(payload: unknown): GatewayStateResponse {
  const record = asRecord(payload);
  const gateway = asRecord(record.gateway);
  const tracker = asRecord(record.tracker);
  const planningPersistence = asRecord(record.planningPersistence);

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
  };
}

function normalizeGatewayScanReposResponse(payload: unknown): GatewayScanReposResponse {
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
      .filter((repo): repo is { absPath: string; name: string; isGit?: boolean; [key: string]: unknown } => repo !== null);

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

function normalizeCatalogRepoInventoryStorage(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  return {
    ...record,
    path: asTrimmedString(record.path) || undefined,
    exists: asBoolean(record.exists, false),
  };
}

function normalizeCatalogRepoInventoryEntry(payload: unknown): Record<string, unknown> | null {
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

function normalizeCatalogWorkspaceScan(payload: unknown): Record<string, unknown> | null {
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

function normalizeCatalogReposListResponse(payload: unknown): CatalogReposListResponse {
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

function normalizeCatalogRepoScanRootsMutationResponse(payload: unknown): CatalogRepoScanRootsMutationResponse {
  const normalized = normalizeCatalogReposListResponse(payload);
  const record = asRecord(payload);
  return {
    ...normalized,
    updated: asBoolean(record.updated, false),
  };
}

function normalizePlanningPersistenceInitResponse(payload: unknown): PlanningPersistenceInitResponse {
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

function appendPlanningQuery(endpoint: string, query: PlanningContextQuery, extra: Record<string, string> = {}): string {
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

function createUrl(endpoint: string, baseUrl?: string, query?: ApiRequestOptions['query']): URL {
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

async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/json')) {
    return response.json();
  }

  return response.text();
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
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new ApiError(message, 0, null);
  }

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    const fallbackMessage = `API request failed with status ${response.status}`;
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : fallbackMessage;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export function getHealth(baseUrl?: string): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/api/health', { baseUrl });
}

export function getVersion(baseUrl?: string): Promise<VersionResponse> {
  return apiRequest<VersionResponse>('/api/version', { baseUrl });
}

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

export function listSessionPlans(
  sessionId: string,
  options: SessionArtifactQueryOptions = {},
  baseUrl?: string
): Promise<SessionPlansResponse> {
  return apiRequest<SessionPlansResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/plans`, {
    baseUrl,
    query: {
      source: options.source,
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
      },
    }
  );
}

export async function getSdkHealth(baseUrl?: string): Promise<SdkHealthResponse> {
  const payload = await apiRequest<unknown>('/api/sdk/health', { baseUrl });
  return normalizeSdkHealthResponse(payload);
}

export async function createSdkSession(
  payload: SdkCreateSessionPayload = {},
  baseUrl?: string
): Promise<SdkSessionSummary> {
  const response = await apiRequest<unknown>('/api/sdk/session', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const normalized = normalizeSdkSessionSummary(response);
  if (!normalized) {
    throw new Error('invalid_sdk_session_response');
  }

  return normalized;
}

export async function listSdkSessions(baseUrl?: string): Promise<SdkSessionsResponse> {
  const payload = await apiRequest<unknown>('/api/sdk/sessions', { baseUrl });
  return normalizeSdkSessionsResponse(payload);
}

export function deleteSdkSession(
  sessionId: string,
  baseUrl?: string
): Promise<{ ok?: boolean; sessionId?: string; error?: string; [key: string]: unknown }> {
  return apiRequest<{ ok?: boolean; sessionId?: string; error?: string; [key: string]: unknown }>(
    `/api/sdk/session/${encodeURIComponent(sessionId)}`,
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

export async function sendSdkMessage(payload: SdkSendPayload, baseUrl?: string): Promise<SdkSendResponse> {
  const response = await apiRequest<unknown>('/api/sdk/send', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const record = asRecord(response);
  return {
    messageId: asTrimmedString(record.messageId),
  };
}

export function createSdkStreamUrl(sessionId: string, baseUrl?: string): string {
  const endpoint = `/api/sdk/stream/${encodeURIComponent(sessionId)}`;
  if (baseUrl) {
    return createUrl(endpoint, baseUrl).toString();
  }

  if (typeof window !== 'undefined') {
    return endpoint;
  }

  return createUrl(endpoint, 'http://127.0.0.1').toString();
}

export function getManagedAssets(baseUrl?: string): Promise<ManagedAssetsResponse> {
  return apiRequest<ManagedAssetsResponse>('/api/assets/managed', { baseUrl });
}

export function getInstalledAssets(baseUrl?: string): Promise<InstalledAssetsResponse> {
  return apiRequest<InstalledAssetsResponse>('/api/assets/installed', { baseUrl });
}

export function syncAllAssets(force = false, baseUrl?: string, pointerMode = true): Promise<{ result: unknown[] }> {
  return apiRequest<{ result: unknown[] }>('/api/assets/sync-all', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force, pointerMode }),
  });
}

export function patchVscodeSettings(baseUrl?: string): Promise<{ result: unknown }> {
  return apiRequest<{ result: unknown }>('/api/vscode/patch-settings', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: false }),
  });
}

export function authorizeCopilotFolders(baseUrl?: string): Promise<{ result: unknown }> {
  return apiRequest<{ result: unknown }>('/api/copilot/authorize', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ dryRun: false }),
  });
}

export function runSandboxLifecycleAction(
  action: SandboxLifecycleAction,
  payload: SandboxLifecyclePayload,
  baseUrl?: string
): Promise<SandboxLifecycleResponse> {
  return apiRequest<SandboxLifecycleResponse>(
    `/api/tracker/lifecycle/${encodeURIComponent(action)}`,
    {
      baseUrl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload ?? {}),
    }
  );
}

export function getLspConfig(baseUrl?: string): Promise<LspConfigResponse> {
  return apiRequest<LspConfigResponse>('/api/lsp/config', { baseUrl });
}

export function installLsp(baseUrl?: string): Promise<LspInstallResponse> {
  return apiRequest<LspInstallResponse>('/api/lsp/install', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function getTrackerPermissions(baseUrl?: string): Promise<TrackerPermissionsResponse> {
  return apiRequest<TrackerPermissionsResponse>('/api/tracker/permissions', { baseUrl });
}

export function approveTrackerPermission(permissionId: string, baseUrl?: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/tracker/permissions/${encodeURIComponent(permissionId)}/approve`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function denyTrackerPermission(permissionId: string, baseUrl?: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/tracker/permissions/${encodeURIComponent(permissionId)}/deny`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function getTrackerSessions(baseUrl?: string): Promise<TrackerSessionsResponse | unknown[]> {
  return apiRequest<TrackerSessionsResponse | unknown[]>('/api/tracker/sessions', { baseUrl });
}

export function getSkillsPreview(baseUrl?: string): Promise<SkillsPreviewResponse> {
  return apiRequest<SkillsPreviewResponse>('/api/skills/preview', { baseUrl });
}

export function getAssetView(path: string, baseUrl?: string): Promise<string> {
  return apiRequest<string>('/api/assets/view', {
    baseUrl,
    query: {
      path,
    },
  });
}

export function getCatalogSummary(query: CatalogSelectorQuery = {}, baseUrl?: string): Promise<CatalogSummaryResponse> {
  return apiRequest<CatalogSummaryResponse>('/api/catalog/summary', {
    baseUrl,
    query: buildCatalogSelectorQuery(query),
  });
}

export function getCatalogRepos(
  query: CatalogRepoInventoryQuery = {},
  baseUrl?: string
): Promise<CatalogReposListResponse> {
  return apiRequest<unknown>('/api/catalog/repos', {
    baseUrl,
    query: {
      repoPath: query.repoPath,
    },
  }).then((payload) => normalizeCatalogReposListResponse(payload));
}

export function registerCatalogRepo(
  payload: CatalogRepoMutationPayload,
  baseUrl?: string
): Promise<CatalogRepoMutationResponse> {
  return apiRequest<CatalogRepoMutationResponse>('/api/catalog/repos/register', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function unregisterCatalogRepo(
  payload: CatalogRepoMutationPayload,
  baseUrl?: string
): Promise<CatalogRepoMutationResponse> {
  return apiRequest<CatalogRepoMutationResponse>('/api/catalog/repos/unregister', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function selectCatalogRepo(
  payload: CatalogRepoMutationPayload,
  baseUrl?: string
): Promise<CatalogRepoMutationResponse> {
  return apiRequest<CatalogRepoMutationResponse>('/api/catalog/repos/select', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function refreshCatalogRepo(
  payload: CatalogRepoMutationPayload,
  baseUrl?: string
): Promise<CatalogRepoMutationResponse> {
  return apiRequest<CatalogRepoMutationResponse>('/api/catalog/repos/refresh', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function saveCatalogRepoScanRoots(
  payload: CatalogRepoScanRootsPayload,
  baseUrl?: string
): Promise<CatalogRepoScanRootsMutationResponse> {
  return apiRequest<unknown>('/api/catalog/repos/scan-roots', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).then((response) => normalizeCatalogRepoScanRootsMutationResponse(response));
}

export function getCatalogAssets(query: CatalogAssetsQuery = {}, baseUrl?: string): Promise<CatalogAssetsResponse> {
  return apiRequest<CatalogAssetsResponse>('/api/catalog/assets', {
    baseUrl,
    query: {
      ...buildCatalogSelectorQuery(query),
      assetId: query.assetId,
      assetKey: query.assetKey,
      kind: query.kind,
      scopeKind: query.scopeKind,
      layer: query.layer,
      q: query.q,
      installed: query.installed,
      enabled: query.enabled,
      recommended: query.recommended,
      available: query.available,
    },
  });
}

export function getCatalogBundles(
  query: CatalogBundlesQuery = {},
  baseUrl?: string
): Promise<CatalogBundlesResponse> {
  return apiRequest<CatalogBundlesResponse>('/api/catalog/bundles', {
    baseUrl,
    query: {
      ...buildCatalogSelectorQuery(query),
      bundleId: query.bundleId,
      classification: query.classification,
      scopeKind: query.scopeKind,
      language: query.language,
      framework: query.framework,
      stack: query.stack,
      tag: query.tag,
      q: query.q,
    },
  });
}

export function getCatalogAssetDetail(
  assetId: string,
  query: CatalogSelectorQuery = {},
  baseUrl?: string
): Promise<CatalogAssetDetailResponse> {
  return apiRequest<CatalogAssetDetailResponse>(`/api/catalog/assets/${encodeURIComponent(assetId)}`, {
    baseUrl,
    query: buildCatalogSelectorQuery(query),
  });
}

export function refreshCatalogProjection(
  query: CatalogSelectorQuery = {},
  baseUrl?: string
): Promise<CatalogRefreshResponse> {
  return apiRequest<CatalogRefreshResponse>('/api/catalog/refresh', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
  });
}

export function createCatalogAsset(
  payload: CatalogAssetCreatePayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/create', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function updateCatalogAsset(
  payload: CatalogAssetUpdatePayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/update', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function deleteCatalogAsset(
  payload: CatalogAssetDeletePayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/delete', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function installCatalogAsset(
  payload: CatalogAssetInstallPayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/install', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function uninstallCatalogBundle(
  payload: CatalogBundleUninstallPayload,
  baseUrl?: string
): Promise<CatalogBundleUninstallResponse> {
  return apiRequest<CatalogBundleUninstallResponse>('/api/catalog/bundles/uninstall', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function installCatalogProvider(
  payload: CatalogProviderInstallPayload,
  baseUrl?: string
): Promise<CatalogProviderInstallResponse> {
  return apiRequest<CatalogProviderInstallResponse>('/api/catalog/providers/install', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function enableCatalogAsset(
  payload: CatalogAssetEnablementPayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/enable', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function disableCatalogAsset(
  payload: CatalogAssetEnablementPayload,
  baseUrl?: string
): Promise<CatalogAssetMutationResponse> {
  return apiRequest<CatalogAssetMutationResponse>('/api/catalog/assets/disable', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function updateCatalogActivation(
  payload: CatalogActivationMutationPayload,
  baseUrl?: string
): Promise<CatalogActivationMutationResponse> {
  return apiRequest<CatalogActivationMutationResponse>('/api/catalog/activation', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function searchCatalogAssets(
  payload: CatalogSearchRequest,
  baseUrl?: string
): Promise<CatalogSearchResponse> {
  return apiRequest<CatalogSearchResponse>('/api/search/query', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function recordCatalogSearchSelection(
  payload: CatalogSearchSelectionPayload,
  baseUrl?: string
): Promise<CatalogSearchSelectionResponse> {
  return apiRequest<CatalogSearchSelectionResponse>('/api/search/selection', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function getCatalogAuditEvents(
  query: CatalogAuditEventsQuery = {},
  baseUrl?: string
): Promise<CatalogAuditEventsResponse> {
  return apiRequest<CatalogAuditEventsResponse>('/api/audit/events', {
    baseUrl,
    query: {
      ...buildCatalogSelectorQuery(query),
      eventType: query.eventType,
      assetId: query.assetId,
      sessionId: query.sessionId,
      correlationId: query.correlationId,
      limit: query.limit,
    },
  });
}

export function getCatalogAssetAnalytics(
  query: CatalogAuditAssetsQuery = {},
  baseUrl?: string
): Promise<CatalogAssetAuditAnalyticsResponse> {
  return apiRequest<CatalogAssetAuditAnalyticsResponse>('/api/audit/assets', {
    baseUrl,
    query: {
      ...buildCatalogSelectorQuery(query),
      eventType: query.eventType,
      assetId: query.assetId,
      sessionId: query.sessionId,
      correlationId: query.correlationId,
      limit: query.limit,
    },
  });
}

export function getRuntimeCatalogHealth(
  query: CatalogSelectorQuery = {},
  baseUrl?: string
): Promise<RuntimeCatalogHealthResponse> {
  return apiRequest<RuntimeCatalogHealthResponse>('/api/runtime/catalog-health', {
    baseUrl,
    query: buildCatalogSelectorQuery(query),
  });
}

export async function getPolicyPreflight(baseUrl?: string, forceRefresh = false): Promise<PolicyPreflightResponse> {
  const payload = await apiRequest<unknown>('/api/policy/preflight', {
    baseUrl,
    query: {
      refresh: forceRefresh ? 1 : undefined,
    },
  });

  return normalizePolicyPreflight(payload);
}

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

export async function getGatewayConfig(baseUrl?: string): Promise<GatewayConfigResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/config', { baseUrl });
  return normalizeGatewayConfigResponse(payload);
}

export async function saveGatewayConfig(payload: GatewaySaveConfigPayload, baseUrl?: string): Promise<GatewaySaveConfigResponse> {
  const response = await apiRequest<unknown>('/api/gateway/config', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return normalizeGatewaySaveConfigResponse(response);
}

export async function getGatewayState(baseUrl?: string): Promise<GatewayStateResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/state', { baseUrl });
  return normalizeGatewayStateResponse(payload);
}

export async function connectGateway(baseUrl?: string): Promise<GatewayStateResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/connect', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  return normalizeGatewayStateResponse(payload);
}

export async function scanGatewayRepos(extraPath?: string, baseUrl?: string): Promise<GatewayScanReposResponse> {
  const payload = await apiRequest<unknown>('/api/gateway/scan-repos', {
    baseUrl,
    query: {
      extra: extraPath && extraPath.trim() ? extraPath.trim() : undefined,
    },
  });

  return normalizeGatewayScanReposResponse(payload);
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
