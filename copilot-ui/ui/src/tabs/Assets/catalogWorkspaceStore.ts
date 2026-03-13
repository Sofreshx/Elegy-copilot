import {
  updateCatalogActivation,
  createCatalogAsset,
  deleteCatalogAsset,
  disableCatalogAsset,
  enableCatalogAsset,
  getAssetView,
  getCatalogAssetDetail,
  getCatalogAssets,
  getCatalogAuditEvents,
  getCatalogBundles,
  getCatalogRepos,
  getCatalogSummary,
  getRuntimeCatalogHealth,
  installCatalogAsset,
  refreshCatalogProjection,
  refreshCatalogRepo,
  registerCatalogRepo,
  searchCatalogAssets,
  selectCatalogRepo,
  syncAllAssets,
  unregisterCatalogRepo,
  updateCatalogAsset,
} from '../../lib/api';
import type {
  CatalogActivationMutationResponse,
  CatalogAssetDetailResponse,
  CatalogAssetMutationResponse,
  CatalogAuditEvent,
  CatalogBundle,
  CatalogEffectiveAsset,
  CatalogEntry,
  CatalogRepoInventoryEntry,
  CatalogReposListResponse,
  CatalogSearchResult,
  CatalogSnapshotEnvelope,
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
  installMessage: string | null;
  repoPathInput: string;
  activeRepoPath: string;
  activeRepoId: string;
  filters: CatalogWorkspaceFilters;
  summary: CatalogSnapshotEnvelope | null;
  assets: CatalogEffectiveAsset[];
  bundles: CatalogBundle[];
  bundlesError: string | null;
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
  installMessage: null,
  repoPathInput: '',
  activeRepoPath: '',
  activeRepoId: '',
  filters: INITIAL_FILTERS,
  summary: null,
  assets: [],
  bundles: [],
  bundlesError: null,
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
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  searchError: null,
  searchIncludeVaultOnly: false,
  searchPreferLoadMode: 'all',
  repoInventoryLoading: false,
  repoInventory: null,
};

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

  return {
    ...input,
    repos: Array.isArray(input.repos)
      ? input.repos.filter((repo): repo is CatalogRepoInventoryEntry => Boolean(repo))
      : [],
    selectedRepo: input.selectedRepo ?? null,
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

function createCatalogWorkspaceStore() {
  const store = createStore<CatalogWorkspaceState>(INITIAL_STATE);
  let workspaceRequestVersion = 0;
  let detailRequestVersion = 0;
  let auditRequestVersion = 0;
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

    if (requestedPath && repoInventory) {
      const matchingRepo =
        repoInventory.repos.find((repo) => samePath(repo.repoPath, requestedPath)) ?? null;
      if (matchingRepo) {
        return {
          activeRepoPath: normalizeRepoPath(matchingRepo.repoPath),
          activeRepoId: typeof matchingRepo.repoId === 'string' ? matchingRepo.repoId.trim() : '',
        };
      }
    }

    const selectedRepo = repoInventory?.selectedRepo ?? null;
    return {
      activeRepoPath: normalizeRepoPath(selectedRepo?.repoPath),
      activeRepoId: typeof selectedRepo?.repoId === 'string' ? selectedRepo.repoId.trim() : '',
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
          : 'Installed content preview is only available for assets materialized under ~/.copilot.',
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
        limit: 25,
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

  async function selectAsset(assetId: string): Promise<void> {
    if (!assetId.trim()) {
      return;
    }

    store.setState((state) => ({
      ...state,
      selectedAssetId: assetId,
    }));

    const requestSelector = selector();
    await Promise.all([loadAssetDetail(assetId, requestSelector), loadAuditEvents(assetId, requestSelector)]);
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
      summaryError:
        summaryResult.status === 'rejected'
          ? toErrorMessage(summaryResult.reason, 'Unable to load catalog summary.')
          : null,
      bundles,
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
      await Promise.all([loadAssetDetail(selectedAssetId, requestSelector), loadAuditEvents(selectedAssetId, requestSelector)]);
      return;
    }

    await loadAuditEvents(null, requestSelector);
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

  async function installAll(force = false): Promise<void> {
    store.setState((state) => ({
      ...state,
      installing: true,
      error: null,
      installMessage: force ? 'Force reinstalling managed assets...' : 'Installing/updating managed assets...',
    }));

    try {
      const response = await syncAllAssets(force);
      const results = Array.isArray(response?.result) ? response.result : [];
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installing: false,
        installMessage: `${force ? 'Force reinstall' : 'Install/update'} completed for ${results.length} asset(s).`,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installing: false,
        error: toErrorMessage(error, 'Unable to sync assets.'),
        installMessage: `${force ? 'Force reinstall' : 'Install/update'} failed.`,
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
      const response = await searchCatalogAssets({
        query,
        kind: state.filters.kind === 'all' ? 'skill' : state.filters.kind,
        repoPath: state.activeRepoPath || undefined,
        includeVaultOnly: state.searchIncludeVaultOnly,
        preferLoadMode: state.searchPreferLoadMode === 'all' ? undefined : state.searchPreferLoadMode,
      });

      if (nextVersion !== searchRequestVersion) {
        return;
      }

      store.setState((current) => ({
        ...current,
        searchLoading: false,
        searchError: null,
        searchResults: normalizeSearchResults(response.results),
      }));
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
        select: true,
      });
      const activeRepo = response.selectedRepo ?? response.repo ?? null;
      store.setState((state) => ({
        ...state,
        mutating: false,
        repoPathInput: normalizeRepoPath(activeRepo?.repoPath) || normalizedRepoPath,
        activeRepoPath: normalizeRepoPath(activeRepo?.repoPath) || normalizedRepoPath,
        activeRepoId: typeof activeRepo?.repoId === 'string' ? activeRepo.repoId.trim() : '',
      }));
      await loadWorkspace();
      store.setState((state) => ({
        ...state,
        installMessage: activeRepo?.repoLabel
          ? `Registered and selected ${activeRepo.repoLabel}.`
          : `Registered ${normalizedRepoPath}.`,
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
    installAll,
    createAsset,
    updateAsset,
    deleteAsset,
    installAsset,
    enableAsset,
    disableAsset,
    activateBundle,
    deactivateBundle,
    setPlannerProfile,
    clearRepoActivationOverride,
    registerRepo,
    unregisterRepo,
    refreshRepo,
    selectRepo,
    setRepoPathInput,
    applyRepoContext,
    clearRepoContext,
    setFilters,
    selectBundle,
    selectAsset,
    setSearchQuery,
    setSearchIncludeVaultOnly,
    setSearchPreferLoadMode,
    runSearch,
  };
}

export const catalogWorkspaceStore = createCatalogWorkspaceStore();
