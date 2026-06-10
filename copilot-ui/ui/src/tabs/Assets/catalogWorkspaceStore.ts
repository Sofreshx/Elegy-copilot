import {
  activateCatalogSourceInstallable,
  addCatalogSource,
  bootstrapCatalogSpecKit,
  updateCatalogActivation,
  createCatalogAsset,
  deactivateCatalogSourceInstallable,
  deleteCatalogAsset,
  disableCatalogAsset,
  enableCatalogAsset,
  getAssetView,
  getCatalogAssetAnalytics,
  getCatalogAssetDetail,
  getCatalogAssets,
  getCatalogAuditEvents,
  getCatalogBundles,
  getCatalogRepos,
  getCatalogSummary,
  getRuntimeCatalogHealth,
  installCatalogProvider,
  installCatalogAsset,
  refreshCatalogSource,
  uninstallCatalogBundle,
  removeCatalogSource,
  refreshCatalogProjection,
  refreshCatalogRepo,
  registerCatalogRepo,
  recordCatalogSearchSelection,
  saveCatalogRepoScanRoots,
  searchCatalogAssets,
  selectCatalogRepo,
  syncInstallVerifyCatalogSource,
  setHarnessOptIn,
  installSurfaces,
  unregisterCatalogRepo,
  updateCatalogAsset,
} from '../../lib/api';
import type {
  CatalogActivationMutationResponse,
  CatalogAssetAuditAnalytics,
  CatalogAssetDetailResponse,
  CatalogAssetMutationResponse,
  CatalogAuditEvent,
  CatalogBundle,
  CatalogBundleUninstallResponse,
  CatalogEffectiveAsset,
  CatalogEntry,
  CatalogExternalSourceProjection,
  CatalogRepoInventoryEntry,
  CatalogRepoInventoryStorage,
  CatalogRepoInventoryWorkspaceScan,
  CatalogReposListResponse,
  CatalogSearchResult,
  CatalogSearchSelectionPayload,
  CatalogSnapshotEnvelope,
  InstallSurfaceTarget,
  RuntimeCatalogHealthResponse,
} from '../../lib/types';
import { createStore } from '../../lib/store';

export interface CatalogWorkspaceFilters {
  text: string;
  kind: 'all' | 'skill' | 'agent' | 'prompt';
  scopeKind: 'all' | 'global' | 'user' | 'repo';
  installedOnly: boolean;
  enabledOnly: boolean;
  availableOnly: boolean;
  overriddenOnly: boolean;
}

export interface CatalogWorkspaceState {
  loading: boolean;
  refreshing: boolean;
  installing: boolean;
  mutating: boolean;
  error: string | null;
  summaryError: string | null;
  healthError: string | null;
  repoInventoryError: string | null;
  bundlesError: string | null;
  installMessage: string | null;
  installWarning: string | null;
  lastInstallResults: Array<{
    target: string;
    total: number;
    created: number;
    updated: number;
    skipped: number;
    skippedConflict: number;
  }>;
  repoPathInput: string;
  activeRepoPath: string;
  activeRepoId: string;
  filters: CatalogWorkspaceFilters;
  summary: CatalogSnapshotEnvelope | null;
  bundles: CatalogBundle[];
  assets: CatalogEffectiveAsset[];
  selectedBundleId: string | null;
  selectedAssetId: string | null;
  selectedAsset: CatalogEffectiveAsset | null;
  selectedEntries: CatalogEntry[];
  selectedAssetDetailLoading: boolean;
  selectedAssetDetailError: string | null;
  selectedAssetContent: string;
  selectedAssetContentStatus: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  selectedAssetContentLabel: string;
  runtimeHealth: RuntimeCatalogHealthResponse | null;
  auditEvents: CatalogAuditEvent[];
  auditLoading: boolean;
  auditError: string | null;
  auditAnalytics: CatalogAssetAuditAnalytics | null;
  auditAnalyticsLoading: boolean;
  auditAnalyticsError: string | null;
  searchQuery: string;
  searchResults: CatalogSearchResult[];
  searchLoading: boolean;
  searchError: string | null;
  searchIncludeVaultOnly: boolean;
  searchPreferLoadMode: 'all' | 'always' | 'on-demand';
  repoInventoryLoading: boolean;
  repoInventory: CatalogReposListResponse | null;
}

const INITIAL_FILTERS: CatalogWorkspaceFilters = {
  text: '',
  kind: 'all',
  scopeKind: 'all',
  installedOnly: false,
  enabledOnly: false,
  availableOnly: false,
  overriddenOnly: false,
};

const INITIAL_STATE: CatalogWorkspaceState = {
  loading: false,
  refreshing: false,
  installing: false,
  mutating: false,
  error: null,
  summaryError: null,
  healthError: null,
  repoInventoryError: null,
  bundlesError: null,
  installMessage: null,
  installWarning: null,
  lastInstallResults: [],
  repoPathInput: '',
  activeRepoPath: '',
  activeRepoId: '',
  filters: INITIAL_FILTERS,
  summary: null,
  bundles: [],
  assets: [],
  selectedBundleId: null,
  selectedAssetId: null,
  selectedAsset: null,
  selectedEntries: [],
  selectedAssetDetailLoading: false,
  selectedAssetDetailError: null,
  selectedAssetContent: '(select an asset to inspect state and content)',
  selectedAssetContentStatus: 'idle',
  selectedAssetContentLabel: 'No asset selected',
  runtimeHealth: null,
  auditEvents: [],
  auditLoading: false,
  auditError: null,
  auditAnalytics: null,
  auditAnalyticsLoading: false,
  auditAnalyticsError: null,
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  searchError: null,
  searchIncludeVaultOnly: false,
  searchPreferLoadMode: 'all',
  repoInventoryLoading: false,
  repoInventory: null,
};

export const CATALOG_SEARCH_RESULT_LIMIT = 20;
export const CATALOG_AUDIT_EVENT_LIMIT = 25;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function normalizeAssets(input: CatalogEffectiveAsset[] | undefined): CatalogEffectiveAsset[] {
  return Array.isArray(input)
    ? input.filter((asset): asset is CatalogEffectiveAsset => Boolean(asset?.assetId))
    : [];
}

function normalizeBundles(input: CatalogBundle[] | undefined): CatalogBundle[] {
  return Array.isArray(input)
    ? input.filter((bundle): bundle is CatalogBundle => Boolean(bundle?.bundleId))
    : [];
}

function normalizeEntries(input: CatalogEntry[] | undefined): CatalogEntry[] {
  return Array.isArray(input)
    ? input.filter((entry): entry is CatalogEntry => Boolean(entry?.assetId))
    : [];
}

function normalizeAuditEvents(input: CatalogAuditEvent[] | undefined): CatalogAuditEvent[] {
  return Array.isArray(input)
    ? input.filter((event): event is CatalogAuditEvent => Boolean(event?.eventId))
    : [];
}

function normalizeSearchResults(input: CatalogSearchResult[] | undefined): CatalogSearchResult[] {
  return Array.isArray(input)
    ? input.filter((result): result is CatalogSearchResult => Boolean(result?.assetId))
    : [];
}

function normalizeAuditAnalytics(input: CatalogAssetAuditAnalytics | null | undefined): CatalogAssetAuditAnalytics | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  return {
    ...input,
    assets: Array.isArray(input.assets)
      ? input.assets.filter((asset) => Boolean(asset?.assetId))
      : [],
    repos: Array.isArray(input.repos)
      ? input.repos
      : [],
    sessions: Array.isArray(input.sessions)
      ? input.sessions
      : [],
    recentEvents: normalizeAuditEvents(input.recentEvents),
  };
}

function normalizeRepoPath(input: string | null | undefined): string {
  return typeof input === 'string' ? input.trim() : '';
}

function normalizePathForComparison(input: string | null | undefined): string {
  return normalizeRepoPath(input).replace(/\//g, '\\').toLowerCase();
}

function samePath(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizePathForComparison(left);
  const normalizedRight = normalizePathForComparison(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeRepoInventory(input: CatalogReposListResponse | null | undefined): CatalogReposListResponse | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const normalizeStringList = (value: unknown): string[] => (
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean)
      : []
  );
  const normalizeStorage = (value: unknown): CatalogRepoInventoryStorage | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }
    const storage = value as CatalogRepoInventoryStorage;
    return {
      ...storage,
      path: typeof storage.path === 'string'
        ? storage.path.trim()
        : undefined,
      exists: storage.exists === true,
    };
  };
  const normalizeRepo = (value: CatalogRepoInventoryEntry | null | undefined): CatalogRepoInventoryEntry | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return {
      ...value,
      repoId: typeof value.repoId === 'string' ? value.repoId.trim() : value.repoId,
      repoPath: typeof value.repoPath === 'string' ? value.repoPath.trim() : value.repoPath,
      repoLabel: typeof value.repoLabel === 'string' ? value.repoLabel.trim() : value.repoLabel,
      sources: normalizeStringList(value.sources),
    };
  };
  const normalizeWorkspaceScan = (value: unknown): CatalogRepoInventoryWorkspaceScan | null => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    return {
      ...(value as CatalogRepoInventoryWorkspaceScan),
      storage: normalizeStorage((value as CatalogRepoInventoryWorkspaceScan).storage),
      defaultRoots: normalizeStringList((value as CatalogRepoInventoryWorkspaceScan).defaultRoots),
      customScanRoots: normalizeStringList((value as CatalogRepoInventoryWorkspaceScan).customScanRoots),
      scanRoots: normalizeStringList((value as CatalogRepoInventoryWorkspaceScan).scanRoots),
    };
  };

  return {
    ...input,
    repos: Array.isArray(input.repos)
      ? input.repos
        .map((repo) => normalizeRepo(repo))
        .filter((repo): repo is CatalogRepoInventoryEntry => Boolean(repo))
      : [],
    selectedRepo: normalizeRepo(input.selectedRepo) ?? null,
    storage: normalizeStorage(input.storage),
    workspaceScan: normalizeWorkspaceScan(input.workspaceScan),
  };
}

function resolveSelectedBundleId(currentSelectedBundleId: string | null, bundles: CatalogBundle[]): string | null {
  if (currentSelectedBundleId && bundles.some((bundle) => bundle.bundleId === currentSelectedBundleId)) {
    return currentSelectedBundleId;
  }

  const activeBundle = bundles.find((bundle) => String(bundle.activationStatus || '').trim().toLowerCase() === 'active')
    ?? bundles.find((bundle) => String(bundle.status || '').trim().toLowerCase() === 'active');
  if (activeBundle?.bundleId) {
    return activeBundle.bundleId;
  }

  const recommendedBundle = bundles.find((bundle) => bundle.defaultRecommended);
  return recommendedBundle?.bundleId ?? bundles[0]?.bundleId ?? null;
}

function toCopilotRelativePath(input: string | undefined): string | null {
  if (!input || !input.trim()) {
    return null;
  }

  const normalized = input.replace(/\//g, '\\');
  const match = normalized.match(/[\\]\.copilot[\\](.+)$/i);
  if (!match?.[1]) {
    return null;
  }

  return match[1].replace(/\\/g, '/');
}

function resolveInspectablePath(asset: CatalogEffectiveAsset | null): string | null {
  if (!asset) {
    return null;
  }

  const explicitViewPath =
    typeof asset.selectedEntry?.metadata?.viewPath === 'string'
      ? asset.selectedEntry.metadata.viewPath.trim()
      : '';
  if (explicitViewPath) {
    return explicitViewPath;
  }

  const installedPaths = asset.installState?.installedPaths;
  if (installedPaths && typeof installedPaths === 'object') {
    for (const candidate of Object.values(installedPaths)) {
      if (typeof candidate === 'string') {
        const relative = toCopilotRelativePath(candidate);
        if (relative) {
          return relative;
        }
      }
    }
  }

  return toCopilotRelativePath(asset.selectedEntry?.contentPath);
}

function getInstallSurfaceLabel(target: InstallSurfaceTarget): string {
  switch (target) {
    case 'codex':
      return 'Codex';
    case 'antigravity':
      return 'Antigravity';
    case 'opencode':
      return 'OpenCode';
    case 'all':
      return 'everything';
    default:
      return target;
  }
}

function getExternalSourceTargetLabel(target: string): string {
  const normalized = target.trim().toLowerCase();
  if (normalized === 'gemini-cli' || normalized === 'antigravity-cli') {
    return 'Antigravity CLI';
  }
  if (normalized === 'host') {
    return 'Host CLI';
  }
  return target;
}

function normalizeExternalSourceTargetKey(target: string): string {
  const normalized = target.trim().toLowerCase();
  return normalized === 'antigravity-cli' ? 'gemini-cli' : normalized;
}

function listExternalSources(state: CatalogWorkspaceState): CatalogExternalSourceProjection[] {
  return Array.isArray(state.summary?.externalSources)
    ? state.summary.externalSources.filter((source): source is CatalogExternalSourceProjection => Boolean(source?.sourceId))
    : [];
}

function resolveExternalSourceTargetState(source: CatalogExternalSourceProjection | null | undefined, target: string): Record<string, unknown> {
  const activation = source?.activation && typeof source.activation === 'object'
    ? source.activation
    : {};
  const targetState = activation[normalizeExternalSourceTargetKey(target)];
  return targetState && typeof targetState === 'object' ? targetState : {};
}

function isExternalInstallableEnabledForTarget(
  source: CatalogExternalSourceProjection | null | undefined,
  installableId: string,
  target: string
): boolean {
  const targetState = resolveExternalSourceTargetState(source, target);
  const installables = targetState.installables && typeof targetState.installables === 'object'
    ? targetState.installables as Record<string, Record<string, unknown>>
    : {};
  return installables[installableId]?.enabled === true;
}

function createCatalogWorkspaceStore() {
  const store = createStore<CatalogWorkspaceState>(INITIAL_STATE);
  let workspaceRequestVersion = 0;
  let detailRequestVersion = 0;
  let auditRequestVersion = 0;
  let auditAnalyticsRequestVersion = 0;
  let searchRequestVersion = 0;

  function selector(state = store.getState()) {
    const repoPath = normalizeRepoPath(state.activeRepoPath);
    const repoId = typeof state.activeRepoId === 'string' ? state.activeRepoId.trim() : '';
    return {
      ...(repoId ? { repoId } : {}),
      ...(repoPath ? { repoPath } : {}),
    };
  }

  function resolveRepoSelection(
    state: CatalogWorkspaceState,
    repoInventory: CatalogReposListResponse | null
  ): { activeRepoPath: string; activeRepoId: string } {
    const requestedPath = normalizeRepoPath(state.activeRepoPath);
    const requestedRepoId = typeof state.activeRepoId === 'string' ? state.activeRepoId.trim() : '';

    if (!repoInventory) {
      return {
        activeRepoPath: requestedPath,
        activeRepoId: requestedRepoId,
      };
    }

    if (requestedPath) {
      const matchingRepo =
        repoInventory.repos.find((repo) => samePath(repo.repoPath, requestedPath)) ?? null;
      if (matchingRepo) {
        return {
          activeRepoPath: normalizeRepoPath(matchingRepo.repoPath),
          activeRepoId: typeof matchingRepo.repoId === 'string' ? matchingRepo.repoId.trim() : '',
        };
      }

      return {
        activeRepoPath: requestedPath,
        activeRepoId: requestedRepoId,
      };
    }

    const selectedRepo = repoInventory?.selectedRepo ?? null;
    return {
      activeRepoPath: normalizeRepoPath(selectedRepo?.repoPath) || requestedPath,
      activeRepoId: typeof selectedRepo?.repoId === 'string' ? selectedRepo.repoId.trim() : requestedRepoId,
    };
  }

  function buildSearchRequest(state: CatalogWorkspaceState, query: string) {
    return {
      query,
      ...(state.filters.kind !== 'all' ? { kind: state.filters.kind } : {}),
      repoId: state.activeRepoId || undefined,
      repoPath: state.activeRepoPath || undefined,
      includeVaultOnly: state.searchIncludeVaultOnly,
      preferLoadMode: state.searchPreferLoadMode === 'all' ? undefined : state.searchPreferLoadMode,
      limit: CATALOG_SEARCH_RESULT_LIMIT,
    };
  }

  async function loadAssetDetail(assetId: string, selectorOverride?: { repoId?: string; repoPath?: string }): Promise<void> {
    const nextVersion = ++detailRequestVersion;
    const requestSelector = selectorOverride ?? selector();

    store.setState((state) => ({
      ...state,
      selectedAssetDetailLoading: true,
      selectedAssetDetailError: null,
      selectedAssetContentStatus: 'loading',
      selectedAssetContentLabel: 'Loading asset detail...',
      selectedAssetContent: `(loading ${assetId}...)`,
    }));

    try {
      const detail: CatalogAssetDetailResponse = await getCatalogAssetDetail(assetId, requestSelector);
      const asset = detail.asset ?? null;
      const entries = normalizeEntries(detail.entries);
      const inspectablePath = resolveInspectablePath(asset);

      if (nextVersion !== detailRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        selectedAsset: asset,
        selectedEntries: entries,
        selectedAssetDetailLoading: false,
        selectedAssetDetailError: null,
        selectedAssetContentStatus: inspectablePath ? 'loading' : 'unavailable',
        selectedAssetContentLabel: inspectablePath
          ? `Installed content preview · ${inspectablePath}`
          : 'State preview only',
        selectedAssetContent: inspectablePath
          ? `(loading installed content from ${inspectablePath}...)`
          : 'Installed content preview is only available for assets materialized under ~/.elegy.',
      }));

      if (!inspectablePath) {
        return;
      }

      try {
        const content = await getAssetView(inspectablePath);
        if (nextVersion !== detailRequestVersion) {
          return;
        }
        store.setState((state) => ({
          ...state,
          selectedAssetContentStatus: 'ready',
          selectedAssetContent: content || '(empty asset content)',
        }));
      } catch (error) {
        if (nextVersion !== detailRequestVersion) {
          return;
        }
        store.setState((state) => ({
          ...state,
          selectedAssetContentStatus: 'error',
          selectedAssetContent: `Unable to load installed content preview: ${toErrorMessage(error, 'preview unavailable')}`,
        }));
      }
    } catch (error) {
      if (nextVersion !== detailRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        selectedAsset: null,
        selectedEntries: [],
        selectedAssetDetailLoading: false,
        selectedAssetDetailError: toErrorMessage(error, 'Unable to load catalog asset detail.'),
        selectedAssetContentStatus: 'error',
        selectedAssetContentLabel: 'State preview unavailable',
        selectedAssetContent: `Error loading ${assetId}: ${toErrorMessage(error, 'Unable to load catalog asset detail.')}`,
      }));
    }
  }

  async function loadAuditEvents(
    assetId: string | null,
    selectorOverride?: { repoId?: string; repoPath?: string }
  ): Promise<void> {
    const nextVersion = ++auditRequestVersion;
    const requestSelector = selectorOverride ?? selector();
    const repoId =
      requestSelector.repoId ||
      (typeof store.getState().summary?.repoContext?.repoId === 'string'
        ? store.getState().summary?.repoContext?.repoId
        : undefined);

    store.setState((state) => ({
      ...state,
      auditLoading: true,
      auditError: null,
    }));

    try {
      const response = await getCatalogAuditEvents({
        assetId: assetId || undefined,
        repoId,
        limit: CATALOG_AUDIT_EVENT_LIMIT,
      });
      if (nextVersion !== auditRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        auditEvents: normalizeAuditEvents(response.events),
        auditLoading: false,
        auditError: null,
      }));
    } catch (error) {
      if (nextVersion !== auditRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        auditLoading: false,
        auditError: toErrorMessage(error, 'Unable to load catalog audit events.'),
      }));
    }
  }

  async function loadAuditAnalytics(
    selectorOverride?: { repoId?: string; repoPath?: string }
  ): Promise<void> {
    const nextVersion = ++auditAnalyticsRequestVersion;
    const requestSelector = selectorOverride ?? selector();
    const summary = store.getState().summary;
    const summaryRepoContext =
      summary?.repoContext && typeof summary.repoContext === 'object'
        ? summary.repoContext
        : null;
    const repoId =
      requestSelector.repoId ||
      (typeof summaryRepoContext?.repoId === 'string' ? summaryRepoContext.repoId : undefined);
    const repoPath =
      requestSelector.repoPath ||
      (typeof summaryRepoContext?.repoPath === 'string' ? summaryRepoContext.repoPath : undefined);

    store.setState((state) => ({
      ...state,
      auditAnalyticsLoading: true,
      auditAnalyticsError: null,
    }));

    try {
      const response = await getCatalogAssetAnalytics({
        ...(repoId ? { repoId } : {}),
        ...(repoPath ? { repoPath } : {}),
        limit: CATALOG_AUDIT_EVENT_LIMIT,
      });
      if (nextVersion !== auditAnalyticsRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        auditAnalytics: normalizeAuditAnalytics(response.analytics),
        auditAnalyticsLoading: false,
        auditAnalyticsError: null,
      }));
    } catch (error) {
      if (nextVersion !== auditAnalyticsRequestVersion) {
        return;
      }

      store.setState((state) => ({
        ...state,
        auditAnalyticsLoading: false,
        auditAnalyticsError: toErrorMessage(error, 'Unable to load catalog audit analytics.'),
      }));
    }
  }

  async function selectAsset(assetId: string): Promise<void> {
    if (!assetId.trim()) {
      return;
    }

    store.setState((state) => ({
      ...state,
      selectedAssetId: assetId,
    }));

    const requestSelector = selector();
    await Promise.all([
      loadAssetDetail(assetId, requestSelector),
      loadAuditEvents(assetId, requestSelector),
      loadAuditAnalytics(requestSelector),
    ]);
  }

  async function inspectSearchResult(result: CatalogSearchResult): Promise<void> {
    const assetId = String(result?.assetId || '').trim();
    if (!assetId) {
      return;
    }

    const state = store.getState();
    const payload: CatalogSearchSelectionPayload = {
      assetId,
      assetKey: result.effectiveState?.assetKey || result.entry?.assetKey,
      resultCount: state.searchResults.length,
      query: buildSearchRequest(state, state.searchQuery.trim()),
      result: {
        assetId,
        score: result.score,
        rank: result.rank,
        explanations: Array.isArray(result.explanations)
          ? result.explanations.map((explanation) => ({
            code: explanation.code,
            message: explanation.message,
          }))
          : [],
        effectiveState: result.effectiveState
          ? {
            assetKey: result.effectiveState.assetKey,
            kind: result.effectiveState.kind,
            scope: result.effectiveState.scope?.repoId
              ? {
                repoId: result.effectiveState.scope.repoId,
              }
              : undefined,
          }
          : null,
        entry: result.entry
          ? {
            assetKey: result.entry.assetKey,
            kind: result.entry.kind,
            scope: result.entry.scope?.repoId
              ? {
                repoId: result.entry.scope.repoId,
              }
              : undefined,
          }
          : null,
      },
    };

    let selectionError: string | null = null;

    try {
      await recordCatalogSearchSelection(payload);
    } catch (error) {
      selectionError = toErrorMessage(error, 'Unable to record search selection telemetry.');
    }

    await selectAsset(assetId);

    if (selectionError) {
      store.setState((state) => ({
        ...state,
        auditError: selectionError,
      }));
    }
  }

  async function loadWorkspace(): Promise<void> {
    const nextVersion = ++workspaceRequestVersion;
    const currentState = store.getState();
    const explicitRepoPath =
      normalizeRepoPath(currentState.activeRepoPath) || normalizeRepoPath(currentState.repoPathInput) || undefined;

    store.setState((state) => ({
      ...state,
      loading: true,
      error: null,
      bundlesError: null,
      summaryError: null,
      healthError: null,
      repoInventoryLoading: true,
      repoInventoryError: null,
    }));

    let repoInventory: CatalogReposListResponse | null = null;
    let repoInventoryError: string | null = null;

    try {
      repoInventory = normalizeRepoInventory(
        await getCatalogRepos(explicitRepoPath ? { repoPath: explicitRepoPath } : {})
      );
    } catch (error) {
      repoInventoryError = toErrorMessage(error, 'Unable to load known repos.');
    }

    if (nextVersion !== workspaceRequestVersion) {
      return;
    }

    const resolvedRepo = resolveRepoSelection(store.getState(), repoInventory);
    const requestSelector = {
      ...(resolvedRepo.activeRepoId ? { repoId: resolvedRepo.activeRepoId } : {}),
      ...(resolvedRepo.activeRepoPath ? { repoPath: resolvedRepo.activeRepoPath } : {}),
    };

    const [summaryResult, assetsResult, bundlesResult, healthResult] = await Promise.allSettled([
      getCatalogSummary(requestSelector),
      getCatalogAssets(requestSelector),
      getCatalogBundles(requestSelector),
      getRuntimeCatalogHealth(requestSelector),
    ]);

    if (nextVersion !== workspaceRequestVersion) {
      return;
    }

    const assets =
      assetsResult.status === 'fulfilled'
        ? normalizeAssets(assetsResult.value.assets)
        : [];
    const bundles =
      bundlesResult.status === 'fulfilled'
        ? normalizeBundles(bundlesResult.value.bundles)
        : [];

    const selectedAssetId =
      assets.some((asset) => asset.assetId === store.getState().selectedAssetId)
        ? store.getState().selectedAssetId
        : assets[0]?.assetId ?? null;
    const selectedBundleId = resolveSelectedBundleId(store.getState().selectedBundleId, bundles);

    store.setState((state) => ({
      ...state,
      loading: false,
      repoInventoryLoading: false,
      repoInventory,
      repoInventoryError,
      error:
        assetsResult.status === 'rejected'
          ? toErrorMessage(assetsResult.reason, 'Unable to load catalog assets.')
          : null,
      summary:
        summaryResult.status === 'fulfilled'
          ? summaryResult.value.summary
          : null,
      bundles:
        bundlesResult.status === 'fulfilled'
          ? normalizeBundles(bundlesResult.value.bundles)
          : [],
      summaryError:
        summaryResult.status === 'rejected'
          ? toErrorMessage(summaryResult.reason, 'Unable to load catalog summary.')
          : null,
      bundlesError:
        bundlesResult.status === 'rejected'
          ? toErrorMessage(bundlesResult.reason, 'Unable to load catalog bundles.')
          : null,
      selectedBundleId,
      runtimeHealth:
        healthResult.status === 'fulfilled'
          ? healthResult.value
          : null,
      healthError:
        healthResult.status === 'rejected'
          ? toErrorMessage(healthResult.reason, 'Unable to load catalog runtime health.')
          : null,
      activeRepoPath: resolvedRepo.activeRepoPath,
      activeRepoId: resolvedRepo.activeRepoId,
      repoPathInput:
        normalizeRepoPath(state.repoPathInput) || !resolvedRepo.activeRepoPath
          ? state.repoPathInput
          : resolvedRepo.activeRepoPath,
      assets,
      selectedAssetId,
      selectedAsset: selectedAssetId
        ? assets.find((asset) => asset.assetId === selectedAssetId) ?? null
        : null,
      selectedEntries: selectedAssetId && state.selectedAsset?.assetId === selectedAssetId
        ? state.selectedEntries
        : [],
      selectedAssetDetailError: null,
    }));

    if (selectedAssetId) {
      await Promise.all([
        loadAssetDetail(selectedAssetId, requestSelector),
        loadAuditEvents(selectedAssetId, requestSelector),
        loadAuditAnalytics(requestSelector),
      ]);
      return;
    }

    await Promise.all([
      loadAuditEvents(null, requestSelector),
      loadAuditAnalytics(requestSelector),
    ]);
  }

  async function refreshWorkspace(): Promise<void> {
    store.setState((state) => ({
      ...state,
      refreshing: true,
      error: null,
      installMessage: 'Refreshing catalog projection...',
    }));

    try {
      await refreshCatalogProjection(selector());
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        refreshing: false,
        installMessage: 'Catalog projection refreshed.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        refreshing: false,
        error: toErrorMessage(error, 'Unable to refresh catalog projection.'),
        installMessage: 'Catalog refresh failed.',
      }));
      throw error;
    }
  }

  async function installSurface(target: InstallSurfaceTarget, force = false): Promise<void> {
    const label = getInstallSurfaceLabel(target);
    store.setState((state) => ({
      ...state,
      installing: true,
      error: null,
      installWarning: null,
      lastInstallResults: [],
      installMessage: force
        ? `Force reinstalling ${label}...`
        : `Installing/updating ${label}...`,
    }));

    try {
      const response = await installSurfaces(target, force);
      const surfaces = Array.isArray(response?.surfaces) ? response.surfaces : [];
      const lastInstallResults = surfaces.map((s) => ({
        target: s.surface || target,
        total: (s.counts?.total || 0) + (s.counts?.created || 0) + (s.counts?.updated || 0),
        created: s.counts?.created || 0,
        updated: s.counts?.updated || 0,
        skipped: s.counts?.skipped || 0,
        skippedConflict: s.counts?.skippedConflict || 0,
      }));
      const skippedCount = lastInstallResults.reduce((sum, r) => sum + r.skipped + r.skippedConflict, 0);
      const installWarning = skippedCount > 0
        ? `${skippedCount} asset(s) were skipped during install. Check the install surface detail for more information.`
        : null;
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installing: false,
        installWarning,
        lastInstallResults,
        installMessage: target === 'all'
          ? `${force ? 'Force reinstall' : 'Install/update'} completed for ${surfaces.length} surface(s).`
          : `${force ? 'Force reinstall' : 'Install/update'} completed for ${label}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installing: false,
        error: toErrorMessage(error, 'Unable to install the requested surface.'),
        installMessage: `${force ? 'Force reinstall' : 'Install/update'} failed for ${label}.`,
      }));
      throw error;
    }
  }

  async function installAll(force = false): Promise<void> {
    await installSurface('all', force);
  }

  async function toggleHarnessOptIn(target: 'codex' | 'opencode' | 'antigravity', optIn: boolean): Promise<void> {
    const harnessLabel = getInstallSurfaceLabel(target);
    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      installWarning: null,
      installMessage: optIn
        ? `Opting into ${harnessLabel}...`
        : `Removing ${harnessLabel} opt-in...`,
    }));

    try {
      const response = await setHarnessOptIn({ target, optIn });
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        mutating: false,
        installMessage: optIn
          ? `Opted into ${harnessLabel}. ${response.assetCount} manifest asset(s) are now managed.`
          : `Removed opt-in for ${harnessLabel}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        error: toErrorMessage(error, 'Unable to update harness opt-in.'),
        installMessage: `Failed to ${optIn ? 'opt into' : 'remove opt-in for'} ${harnessLabel}.`,
      }));
      throw error;
    }
  }

  async function installBundle(bundleId: string): Promise<void> {
    const normalizedBundleId = bundleId.trim();
    if (!normalizedBundleId) {
      return;
    }

    store.setState((state) => ({
      ...state,
      installing: true,
      error: null,
      installMessage: `Installing bundle ${normalizedBundleId}...`,
    }));

    try {
      const requestSelector = selector();
      const bundleResponse = await getCatalogBundles({
        ...requestSelector,
        bundleId: normalizedBundleId,
      });
      const bundle = normalizeBundles(bundleResponse.bundles)[0] ?? null;

      if (!bundle) {
        throw new Error(`Bundle not found: ${normalizedBundleId}`);
      }

      const pendingMembers = (Array.isArray(bundle.members) ? bundle.members : [])
        .filter((member) => member.available && !member.installed && member.assetId);

      if (pendingMembers.length === 0) {
        await loadWorkspace();
        store.setState((state) => ({
          ...state,
          installing: false,
          installMessage: `${bundle.title || normalizedBundleId} is already installed.`,
        }));
        return;
      }

      for (const member of pendingMembers) {
        await installCatalogAsset({ assetId: member.assetId });
      }

      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installing: false,
        installMessage: `Installed ${pendingMembers.length} bundle asset(s) from ${bundle.title || normalizedBundleId}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installing: false,
        error: toErrorMessage(error, 'Unable to install bundle.'),
        installMessage: `Bundle install failed for ${normalizedBundleId}.`,
      }));
      throw error;
    }
  }

  async function uninstallBundle(bundleId: string): Promise<CatalogBundleUninstallResponse> {
    const normalizedBundleId = bundleId.trim();
    if (!normalizedBundleId) {
      return {
        action: 'bundle-uninstall-skipped',
        bundleId: normalizedBundleId,
      };
    }

    const currentBundle =
      normalizeBundles(store.getState().bundles).find((bundle) => bundle.bundleId === normalizedBundleId) ?? null;
    const bundleLabel = currentBundle?.title || normalizedBundleId;

    store.setState((state) => ({
      ...state,
      installing: true,
      error: null,
      installMessage: `Uninstalling bundle ${bundleLabel}...`,
    }));

    try {
      const response = await uninstallCatalogBundle({
        ...selector(),
        bundleId: normalizedBundleId,
      });
      const removedAssetIds = Array.isArray(response.removedAssetIds)
        ? response.removedAssetIds.filter((assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0)
        : [];
      const removedCount = removedAssetIds.length || Number(response.removedCount ?? 0);
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installing: false,
        installMessage:
          `${removedCount > 0
            ? `Uninstalled ${removedCount} bundle asset(s) from ${bundleLabel}.`
            : `Bundle uninstall completed for ${bundleLabel}.`}`
          + `${response.preserveExternalPackages ? ' External provider packages were preserved.' : ''}`,
      }));
      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installing: false,
        error: toErrorMessage(error, 'Unable to uninstall bundle.'),
        installMessage: `Bundle uninstall failed for ${bundleLabel}.`,
      }));
      throw error;
    }
  }

  async function runMutation(
    startMessage: string,
    mutate: () => Promise<CatalogAssetMutationResponse>,
    successMessage: (response: CatalogAssetMutationResponse) => string
  ): Promise<CatalogAssetMutationResponse> {
    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      installMessage: startMessage,
    }));

    try {
      const response = await mutate();
      await loadWorkspace();

      if (response.action !== 'deleted' && response.assetId) {
        const hasAsset = store.getState().assets.some((asset) => asset.assetId === response.assetId);
        if (hasAsset) {
          await selectAsset(response.assetId);
        }
      } else if (response.assetId) {
        const hasAsset = store.getState().assets.some((asset) => asset.assetId === response.assetId);
        if (hasAsset) {
          await selectAsset(response.assetId);
        }
      }

      store.setState((state) => ({
        ...state,
        mutating: false,
        installMessage: successMessage(response),
      }));

      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        error: toErrorMessage(error, 'Catalog action failed.'),
        installMessage: `${startMessage} failed.`,
      }));
      throw error;
    }
  }

  async function createAsset(
    payload: Parameters<typeof createCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Creating ${payload.kind} "${payload.assetKey}"...`,
      () => createCatalogAsset(payload),
      (response) => `Created ${response.assetId || payload.assetKey}.`
    );
  }

  async function updateAsset(
    payload: Parameters<typeof updateCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Saving ${payload.kind} "${payload.assetKey || payload.assetId || 'asset'}"...`,
      () => updateCatalogAsset(payload),
      (response) => `Saved ${response.assetId || payload.assetKey || payload.assetId || 'asset'}.`
    );
  }

  async function deleteAsset(
    payload: Parameters<typeof deleteCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Removing ${payload.assetKey || payload.assetId || 'asset'}...`,
      () => deleteCatalogAsset(payload),
      (response) => `Removed ${response.assetId || payload.assetKey || payload.assetId || 'asset'}.`
    );
  }

  async function installAsset(
    payload: Parameters<typeof installCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Installing ${payload.assetId}...`,
      () => installCatalogAsset(payload),
      (response) => `Installed ${response.assetId || payload.assetId}.`
    );
  }

  async function installProvider(
    payload: Parameters<typeof installCatalogProvider>[0]
  ): Promise<void> {
    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      installMessage: `${payload.action === 'update' ? 'Updating' : 'Installing'} provider ${payload.providerId}...`,
    }));

    try {
      await installCatalogProvider(payload);
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        mutating: false,
        installMessage: `${payload.action === 'update' ? 'Updated' : 'Installed'} provider ${payload.providerId}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        error: toErrorMessage(error, 'Provider install failed.'),
        installMessage: `${payload.action === 'update' ? 'Provider update' : 'Provider install'} failed.`,
      }));
      throw error;
    }
  }

  async function runExternalSourceMutation<T>(
    startMessage: string,
    mutate: () => Promise<T>,
    successMessage: (response: T) => string
  ): Promise<T> {
    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      installMessage: startMessage,
    }));

    try {
      const response = await mutate();
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        mutating: false,
        installMessage: successMessage(response),
      }));
      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        error: toErrorMessage(error, 'External source action failed.'),
        installMessage: `${startMessage} failed.`,
      }));
      throw error;
    }
  }

  async function addExternalSource(
    payload: Parameters<typeof addCatalogSource>[0]
  ): Promise<void> {
    await runExternalSourceMutation(
      `Adding source ${payload.title?.trim() || payload.sourceId?.trim() || payload.url}...`,
      () => addCatalogSource(payload),
      (response) => `Added source ${String(response.source?.title || response.source?.sourceId || payload.url)}.`
    );
  }

  async function removeExternalSource(sourceId: string): Promise<void> {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      return;
    }
    await runExternalSourceMutation(
      `Removing source ${normalizedSourceId}...`,
      () => removeCatalogSource({ sourceId: normalizedSourceId }),
      () => `Removed source ${normalizedSourceId}.`
    );
  }

  async function refreshExternalSource(sourceId: string): Promise<void> {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      return;
    }
    await runExternalSourceMutation(
      `Refreshing source ${normalizedSourceId}...`,
      () => refreshCatalogSource({ sourceId: normalizedSourceId }),
      (response) => {
        const installableCount = Array.isArray((response as { snapshot?: { installables?: unknown[] } }).snapshot?.installables)
          ? (response as { snapshot?: { installables?: unknown[] } }).snapshot?.installables?.length || 0
          : 0;
        return `Refreshed source ${normalizedSourceId}${installableCount ? ` with ${installableCount} installable(s)` : ''}.`;
      }
    );
  }

  async function activateExternalSourceInstallable(
    payload: Parameters<typeof activateCatalogSourceInstallable>[0]
  ): Promise<void> {
    const targetLabel = getExternalSourceTargetLabel(payload.target);
    await runExternalSourceMutation(
      `Activating ${payload.installableId} for ${targetLabel}...`,
      () => activateCatalogSourceInstallable(payload),
      () => `Activated ${payload.installableId} for ${targetLabel}.`
    );
  }

  async function deactivateExternalSourceInstallable(
    payload: Parameters<typeof deactivateCatalogSourceInstallable>[0]
  ): Promise<void> {
    const targetLabel = getExternalSourceTargetLabel(payload.target);
    await runExternalSourceMutation(
      `Deactivating ${payload.installableId} for ${targetLabel}...`,
      () => deactivateCatalogSourceInstallable(payload),
      () => `Deactivated ${payload.installableId} for ${targetLabel}.`
    );
  }

  async function reinstallExternalSourceTarget(sourceId: string, target: string): Promise<void> {
    const normalizedSourceId = sourceId.trim();
    const normalizedTarget = target.trim();
    const targetLabel = getExternalSourceTargetLabel(normalizedTarget);
    if (!normalizedSourceId || !normalizedTarget) {
      return;
    }

    const source = listExternalSources(store.getState()).find((entry) => entry.sourceId === normalizedSourceId) ?? null;
    const installables = Array.isArray(source?.installables) ? source.installables : [];
    const enabledInstallables = installables.filter((installable) =>
      isExternalInstallableEnabledForTarget(source, installable.installableId, normalizedTarget)
    );
    if (enabledInstallables.length === 0) {
      store.setState((state) => ({
        ...state,
        installMessage: `No active installables found for ${normalizedSourceId} on ${targetLabel}.`,
      }));
      return;
    }

    await runExternalSourceMutation(
      `Reinstalling ${enabledInstallables.length} installable(s) for ${targetLabel} from ${normalizedSourceId}...`,
      async () => {
        for (const installable of enabledInstallables) {
          await activateCatalogSourceInstallable({
            sourceId: normalizedSourceId,
            installableId: installable.installableId,
            target: normalizedTarget,
          });
        }
        return { count: enabledInstallables.length };
      },
      (response) => `Reinstalled ${(response as { count: number }).count} installable(s) for ${targetLabel}.`
    );
  }

  async function reinstallExternalSourceAllTargets(sourceId: string): Promise<void> {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId) {
      return;
    }

    const source = listExternalSources(store.getState()).find((entry) => entry.sourceId === normalizedSourceId) ?? null;
    const sourceInstallables = Array.isArray(source?.installables) ? source.installables : [];
    const targetSet = new Set<string>();
    const activation = source?.activation && typeof source.activation === 'object'
      ? source.activation
      : {};
    for (const [target, targetState] of Object.entries(activation)) {
      const installables = targetState && typeof targetState === 'object' && (targetState as { installables?: Record<string, { enabled?: boolean }> }).installables
        ? (targetState as { installables?: Record<string, { enabled?: boolean }> }).installables || {}
        : {};
      if (Object.values(installables).some((entry) => entry?.enabled === true)) {
        targetSet.add(target);
      }
    }

    if (targetSet.size === 0) {
      store.setState((state) => ({
        ...state,
        installMessage: `No active targets found for ${normalizedSourceId}.`,
      }));
      return;
    }

    await runExternalSourceMutation(
      `Reinstalling all active targets for ${normalizedSourceId}...`,
      async () => {
        for (const target of targetSet) {
          for (const installable of sourceInstallables) {
            if (!isExternalInstallableEnabledForTarget(source, installable.installableId, target)) {
              continue;
            }
            await activateCatalogSourceInstallable({
              sourceId: normalizedSourceId,
              installableId: installable.installableId,
              target,
            });
          }
        }
        return { count: targetSet.size };
      },
      (response) => `Reinstalled ${(response as { count: number }).count} active target(s) for ${normalizedSourceId}.`
    );
  }

  async function syncInstallVerifyExternalSource(payload: {
    sourceId: string;
    targets?: string[];
    installableIds?: string[];
    force?: boolean;
    repoPath?: string;
  }): Promise<void> {
    const normalizedSourceId = payload.sourceId.trim();
    if (!normalizedSourceId) {
      return;
    }
    await runExternalSourceMutation(
      `Syncing, installing, and verifying ${normalizedSourceId}...`,
      () => syncInstallVerifyCatalogSource({
        sourceId: normalizedSourceId,
        targets: payload.targets,
        installableIds: payload.installableIds,
        force: payload.force,
        repoPath: payload.repoPath,
      }),
      (response) => {
        const warnings = Array.isArray((response as { warnings?: string[] }).warnings)
          ? (response as { warnings?: string[] }).warnings?.length || 0
          : 0;
        return `Synced, installed, and verified ${normalizedSourceId}${warnings ? ` with ${warnings} warning(s)` : ''}.`;
      }
    );
  }

  async function bootstrapSpecKitRepo(payload?: {
    repoPath?: string;
    integration?: 'copilot' | 'codex' | 'gemini' | string;
    script?: 'ps' | 'sh' | string;
    force?: boolean;
    ignoreAgentTools?: boolean;
  }): Promise<void> {
    const state = store.getState();
    const repoPath = normalizeRepoPath(payload?.repoPath)
      || normalizeRepoPath(state.repoInventory?.selectedRepo?.repoPath)
      || normalizeRepoPath(state.activeRepoPath);
    if (!repoPath) {
      throw new Error('Select a repo before bootstrapping Spec Kit.');
    }

    await runExternalSourceMutation(
      `Bootstrapping Spec Kit in ${repoPath}...`,
      () => bootstrapCatalogSpecKit({
        repoPath,
        integration: payload?.integration || 'copilot',
        script: payload?.script,
        force: payload?.force,
        ignoreAgentTools: payload?.ignoreAgentTools,
      }),
      (response) => `Bootstrapped Spec Kit in ${String((response as { repoPath?: string }).repoPath || repoPath)}.`
    );
  }

  async function enableAsset(
    payload: Parameters<typeof enableCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Enabling ${payload.assetKey || payload.assetId || 'asset'} for the selected repo...`,
      () => enableCatalogAsset(payload),
      (response) => `Enabled ${response.assetId || payload.assetKey || payload.assetId || 'asset'} for the selected repo.`
    );
  }

  async function disableAsset(
    payload: Parameters<typeof disableCatalogAsset>[0]
  ): Promise<CatalogAssetMutationResponse> {
    return runMutation(
      `Disabling ${payload.assetKey || payload.assetId || 'asset'} for the selected repo...`,
      () => disableCatalogAsset(payload),
      (response) => `Disabled ${response.assetId || payload.assetKey || payload.assetId || 'asset'} for the selected repo.`
    );
  }

  async function runActivationMutation(
    startMessage: string,
    mutate: () => Promise<CatalogActivationMutationResponse>,
    successMessage: (response: CatalogActivationMutationResponse) => string
  ): Promise<CatalogActivationMutationResponse> {
    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      installMessage: startMessage,
    }));

    try {
      const response = await mutate();
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        mutating: false,
        installMessage: successMessage(response),
      }));
      return response;
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        error: toErrorMessage(error, 'Activation update failed.'),
        installMessage: `${startMessage} failed.`,
      }));
      throw error;
    }
  }

  async function activateBundle(bundleId: string, repoPath?: string): Promise<CatalogActivationMutationResponse> {
    return runActivationMutation(
      `Activating bundle "${bundleId}"${repoPath ? ' for the selected repo' : ' for user-global defaults'}...`,
      () => updateCatalogActivation({ action: 'activate-bundle', bundleId, repoPath }),
      () => `Activated bundle "${bundleId}"${repoPath ? ' for the selected repo.' : ' in user-global defaults.'}`
    );
  }

  async function deactivateBundle(bundleId: string, repoPath?: string): Promise<CatalogActivationMutationResponse> {
    return runActivationMutation(
      `Deactivating bundle "${bundleId}"${repoPath ? ' for the selected repo' : ' for user-global defaults'}...`,
      () => updateCatalogActivation({ action: 'deactivate-bundle', bundleId, repoPath }),
      () => `Deactivated bundle "${bundleId}"${repoPath ? ' for the selected repo.' : ' in user-global defaults.'}`
    );
  }

  async function setPlannerProfile(plannerProfile: string, repoPath?: string): Promise<CatalogActivationMutationResponse> {
    return runActivationMutation(
      `Saving planner profile "${plannerProfile}"${repoPath ? ' for the selected repo' : ' for user-global defaults'}...`,
      () => updateCatalogActivation({ action: 'set-profile', plannerProfile, repoPath }),
      () => `Saved planner profile "${plannerProfile}"${repoPath ? ' for the selected repo.' : ' in user-global defaults.'}`
    );
  }

  async function clearRepoActivationOverride(repoPath: string): Promise<CatalogActivationMutationResponse> {
    return runActivationMutation(
      'Clearing repo activation override...',
      () => updateCatalogActivation({ action: 'clear-repo-override', repoPath }),
      () => 'Cleared the repo activation override.'
    );
  }

  async function runSearch(): Promise<void> {
    const state = store.getState();
    const query = state.searchQuery.trim();
    if (!query) {
      store.setState((current) => ({
        ...current,
        searchResults: [],
        searchError: 'Enter a search query to inspect recommendations and ranking.',
      }));
      return;
    }

    const nextVersion = ++searchRequestVersion;

    store.setState((current) => ({
      ...current,
      searchLoading: true,
      searchError: null,
    }));

    try {
      const response = await searchCatalogAssets(buildSearchRequest(state, query));

      if (nextVersion !== searchRequestVersion) {
        return;
      }

      store.setState((current) => ({
        ...current,
        searchLoading: false,
        searchError: null,
        searchResults: normalizeSearchResults(response.results),
      }));
      await loadAuditAnalytics(selector());
    } catch (error) {
      if (nextVersion !== searchRequestVersion) {
        return;
      }

      store.setState((current) => ({
        ...current,
        searchLoading: false,
        searchError: toErrorMessage(error, 'Unable to search the catalog.'),
      }));
    }
  }

  function setRepoPathInput(repoPathInput: string): void {
    store.setState((state) => ({
      ...state,
      repoPathInput,
    }));
  }

  async function applyRepoContext(): Promise<void> {
    const repoPath = normalizeRepoPath(store.getState().repoPathInput);
    if (!repoPath) {
      await clearRepoContext();
      return;
    }

    store.setState((state) => ({
      ...state,
      error: null,
      repoInventoryError: null,
      activeRepoPath: repoPath,
      activeRepoId: '',
      selectedAssetId: null,
      selectedAsset: null,
      selectedEntries: [],
      searchResults: [],
      searchError: null,
      installMessage: `Selecting repo scope for ${repoPath}...`,
    }));

    try {
      const response = await selectCatalogRepo({ repoPath });
      const activeRepo = response.selectedRepo ?? response.repo ?? null;
      store.setState((state) => ({
        ...state,
        activeRepoPath: normalizeRepoPath(activeRepo?.repoPath) || repoPath,
        activeRepoId: typeof activeRepo?.repoId === 'string' ? activeRepo.repoId.trim() : '',
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: activeRepo?.repoLabel
          ? `Scoped to ${activeRepo.repoLabel}.`
          : `Scoped to repo path: ${repoPath}`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        repoInventoryError: toErrorMessage(error, 'Unable to select the requested repo.'),
        error: toErrorMessage(error, 'Unable to apply repo scope.'),
        installMessage: 'Repo scope update failed.',
      }));
      throw error;
    }
  }

  async function clearRepoContext(): Promise<void> {
    store.setState((state) => ({
      ...state,
      repoPathInput: '',
      activeRepoPath: '',
      activeRepoId: '',
      selectedAssetId: null,
      selectedAsset: null,
      selectedEntries: [],
      searchResults: [],
      searchError: null,
      error: null,
      repoInventoryError: null,
      installMessage: 'Clearing repo scope...',
    }));

    try {
      await selectCatalogRepo({ clear: true });
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: 'Showing the global catalog projection.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        repoInventoryError: toErrorMessage(error, 'Unable to clear repo scope.'),
        error: toErrorMessage(error, 'Unable to clear repo scope.'),
        installMessage: 'Repo scope clear failed.',
      }));
      throw error;
    }
  }

  async function registerRepo(repoPath: string, repoLabel?: string): Promise<void> {
    const normalizedRepoPath = normalizeRepoPath(repoPath);
    if (!normalizedRepoPath) {
      return;
    }

    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      repoInventoryError: null,
      installMessage: `Registering ${normalizedRepoPath}...`,
    }));

    try {
      const response = await registerCatalogRepo({
        repoPath: normalizedRepoPath,
        repoLabel,
      });
      store.setState((state) => ({
        ...state,
        mutating: false,
        repoPathInput: normalizedRepoPath,
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: response.repo?.repoLabel
          ? `Registered ${response.repo.repoLabel} for discovery metadata.`
          : `Registered ${normalizedRepoPath} for discovery metadata.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        repoInventoryError: toErrorMessage(error, 'Unable to register repo.'),
        error: toErrorMessage(error, 'Unable to register repo.'),
        installMessage: 'Repo registration failed.',
      }));
      throw error;
    }
  }

  async function saveCustomScanRoots(customScanRoots: string[]): Promise<void> {
    const normalizedRoots = Array.from(new Set(
      (Array.isArray(customScanRoots) ? customScanRoots : [])
        .map((root) => normalizeRepoPath(root))
        .filter(Boolean)
    ));

    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      repoInventoryError: null,
      installMessage: normalizedRoots.length
        ? `Saving ${normalizedRoots.length} custom scan root(s)...`
        : 'Clearing custom scan roots...',
    }));

    try {
      await saveCatalogRepoScanRoots({
        customScanRoots: normalizedRoots,
      });
      store.setState((state) => ({
        ...state,
        mutating: false,
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: normalizedRoots.length
          ? `Saved ${normalizedRoots.length} custom scan root(s).`
          : 'Cleared custom scan roots.',
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        repoInventoryError: toErrorMessage(error, 'Unable to save custom scan roots.'),
        error: toErrorMessage(error, 'Unable to save custom scan roots.'),
        installMessage: 'Custom scan root update failed.',
      }));
      throw error;
    }
  }

  async function unregisterRepo(repo: { repoId?: string | null; repoPath?: string | null }): Promise<void> {
    const repoPath = normalizeRepoPath(repo.repoPath);
    const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';

    store.setState((state) => ({
      ...state,
      mutating: true,
      error: null,
      repoInventoryError: null,
      installMessage: `Removing repo registration for ${repoPath || repoId || 'selected repo'}...`,
    }));

    try {
      const response = await unregisterCatalogRepo({
        repoId: repoId || undefined,
        repoPath: repoPath || undefined,
      });
      const shouldClearActiveScope =
        Boolean(response.selectionCleared) ||
        samePath(store.getState().activeRepoPath, repoPath) ||
        (repoId && store.getState().activeRepoId === repoId);

      store.setState((state) => ({
        ...state,
        mutating: false,
        activeRepoPath: shouldClearActiveScope ? '' : state.activeRepoPath,
        activeRepoId: shouldClearActiveScope ? '' : state.activeRepoId,
        repoPathInput: shouldClearActiveScope ? '' : state.repoPathInput,
      }));

      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: `Removed repo registration for ${repoPath || repoId || 'repo'}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        mutating: false,
        repoInventoryError: toErrorMessage(error, 'Unable to unregister repo.'),
        error: toErrorMessage(error, 'Unable to unregister repo.'),
        installMessage: 'Repo unregister failed.',
      }));
      throw error;
    }
  }

  async function selectRepo(repo: { repoId?: string | null; repoPath?: string | null }): Promise<void> {
    const repoPath = normalizeRepoPath(repo.repoPath);
    const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : '';

    store.setState((state) => ({
      ...state,
      error: null,
      repoInventoryError: null,
      installMessage: `Selecting ${repoPath || repoId || 'repo'}...`,
    }));

    try {
      const response = await selectCatalogRepo({
        repoId: repoId || undefined,
        repoPath: repoPath || undefined,
      });
      const activeRepo = response.selectedRepo ?? response.repo ?? null;
      store.setState((state) => ({
        ...state,
        repoPathInput: normalizeRepoPath(activeRepo?.repoPath) || repoPath,
        activeRepoPath: normalizeRepoPath(activeRepo?.repoPath) || repoPath,
        activeRepoId: typeof activeRepo?.repoId === 'string' ? activeRepo.repoId.trim() : '',
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: activeRepo?.repoLabel
          ? `Scoped to ${activeRepo.repoLabel}.`
          : `Scoped to ${repoPath || repoId || 'repo'}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        repoInventoryError: toErrorMessage(error, 'Unable to select repo.'),
        error: toErrorMessage(error, 'Unable to select repo.'),
        installMessage: 'Repo selection failed.',
      }));
      throw error;
    }
  }

  async function refreshRepo(repo: { repoId?: string | null; repoPath?: string | null }): Promise<void> {
    const repoPath = normalizeRepoPath(repo.repoPath) || normalizeRepoPath(store.getState().activeRepoPath);
    const repoId = typeof repo.repoId === 'string' ? repo.repoId.trim() : store.getState().activeRepoId;

    store.setState((state) => ({
      ...state,
      refreshing: true,
      error: null,
      repoInventoryError: null,
      installMessage: `Refreshing repo inventory for ${repoPath || repoId || 'selected repo'}...`,
    }));

    try {
      const response = await refreshCatalogRepo({
        repoId: repoId || undefined,
        repoPath: repoPath || undefined,
      });
      const activeRepo = response.selectedRepo ?? response.repo ?? null;
      store.setState((state) => ({
        ...state,
        activeRepoPath: normalizeRepoPath(activeRepo?.repoPath) || state.activeRepoPath,
        activeRepoId: typeof activeRepo?.repoId === 'string' ? activeRepo.repoId.trim() : state.activeRepoId,
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        refreshing: false,
        installMessage: `Repo inventory refreshed for ${activeRepo?.repoLabel || repoPath || repoId || 'repo'}.`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        refreshing: false,
        repoInventoryError: toErrorMessage(error, 'Unable to refresh repo inventory.'),
        error: toErrorMessage(error, 'Unable to refresh repo inventory.'),
        installMessage: 'Repo refresh failed.',
      }));
      throw error;
    }
  }

  function setFilters(nextFilters: Partial<CatalogWorkspaceFilters>): void {
    store.setState((state) => ({
      ...state,
      filters: {
        ...state.filters,
        ...nextFilters,
      },
    }));
  }

  function selectBundle(bundleId: string | null): void {
    store.setState((state) => ({
      ...state,
      selectedBundleId: bundleId,
    }));
  }

  function setSearchQuery(searchQuery: string): void {
    store.setState((state) => ({
      ...state,
      searchQuery,
    }));
  }

  function setSearchIncludeVaultOnly(searchIncludeVaultOnly: boolean): void {
    store.setState((state) => ({
      ...state,
      searchIncludeVaultOnly,
    }));
  }

  function setSearchPreferLoadMode(searchPreferLoadMode: 'all' | 'always' | 'on-demand'): void {
    store.setState((state) => ({
      ...state,
      searchPreferLoadMode,
    }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadWorkspace,
    refreshWorkspace,
    installSurface,
    toggleHarnessOptIn,
    installAll,
    installBundle,
    uninstallBundle,
    createAsset,
    updateAsset,
    deleteAsset,
    installAsset,
    installProvider,
    addExternalSource,
    removeExternalSource,
    refreshExternalSource,
    activateExternalSourceInstallable,
    deactivateExternalSourceInstallable,
    reinstallExternalSourceTarget,
    reinstallExternalSourceAllTargets,
    syncInstallVerifyExternalSource,
    bootstrapSpecKitRepo,
    enableAsset,
    disableAsset,
    activateBundle,
    deactivateBundle,
    setPlannerProfile,
    clearRepoActivationOverride,
    registerRepo,
    saveCustomScanRoots,
    unregisterRepo,
    refreshRepo,
    selectRepo,
    setRepoPathInput,
    applyRepoContext,
    clearRepoContext,
    setFilters,
    selectBundle,
    selectAsset,
    inspectSearchResult,
    setSearchQuery,
    setSearchIncludeVaultOnly,
    setSearchPreferLoadMode,
    runSearch,
  };
}

export const catalogWorkspaceStore = createCatalogWorkspaceStore();
