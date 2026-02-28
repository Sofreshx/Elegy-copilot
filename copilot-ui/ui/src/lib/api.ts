import type {
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
  PlanningCompareReceipt,
  PlanningCompareResponse,
  PlanningCreateResponse,
  PlanningMergeIntentResponse,
  PlanningMergeIntentToken,
  PlanningMergeResponse,
  PlanningPersistenceInitResponse,
  PlanningRecordItem,
  PlanningRecordsResponse,
  PlanningSearchResponse,
  PlanningSearchResultItem,
  PolicyPreflightResponse,
  SandboxLifecycleAction,
  SandboxLifecyclePayload,
  SandboxLifecycleResponse,
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
  state?: string;
  idempotencyKey?: string;
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

function normalizePlanningRecord(value: unknown): PlanningRecordItem | null {
  const record = asRecord(value);
  const recordId = asTrimmedString(record.recordId) || asTrimmedString(record.id);
  if (!recordId) {
    return null;
  }

  return {
    ...record,
    recordId,
    scope: asTrimmedString(record.scope) || 'global',
    ownerId: asTrimmedString(record.ownerId),
    repoId: typeof record.repoId === 'string' || record.repoId === null ? (record.repoId as string | null) : null,
    title: asString(record.title),
    summary: asString(record.summary),
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

export function getManagedAssets(baseUrl?: string): Promise<ManagedAssetsResponse> {
  return apiRequest<ManagedAssetsResponse>('/api/assets/managed', { baseUrl });
}

export function getInstalledAssets(baseUrl?: string): Promise<InstalledAssetsResponse> {
  return apiRequest<InstalledAssetsResponse>('/api/assets/installed', { baseUrl });
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

export async function getPolicyPreflight(baseUrl?: string, forceRefresh = false): Promise<PolicyPreflightResponse> {
  const payload = await apiRequest<unknown>('/api/policy/preflight', {
    baseUrl,
    query: {
      refresh: forceRefresh ? 1 : undefined,
    },
  });

  return normalizePolicyPreflight(payload);
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