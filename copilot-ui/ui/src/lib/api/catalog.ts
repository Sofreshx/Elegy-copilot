import type {
  CatalogActivationMutationResponse,
  CatalogAssetAuditAnalyticsResponse,
  CatalogAssetDetailResponse,
  CatalogAssetMutationResponse,
  CatalogAssetsResponse,
  CatalogAuditEventsResponse,
  CatalogBundleUninstallResponse,
  CatalogBundlesResponse,
  CatalogContentQuery,
  CatalogProviderInstallResponse,
  CatalogRefreshResponse,
  CatalogRepoMutationResponse,
  CatalogRepoScanRootsMutationResponse,
  CatalogReposListResponse,
  CatalogSourceDetailResponse,
  CatalogSourceInstallableMutationResponse,
  CatalogSourceMutationResponse,
  CatalogSourcesListResponse,
  CatalogSearchRequest,
  CatalogSearchResponse,
  CatalogSearchSelectionPayload,
  CatalogSearchSelectionResponse,
  CatalogSummaryResponse,
  PolicyPreflightResponse,
  RuntimeCatalogHealthResponse,
} from '../types';
import {
  apiRequest,
  buildCatalogSelectorQuery,
  normalizeCatalogReposListResponse,
  normalizeCatalogRepoScanRootsMutationResponse,
  normalizePolicyPreflight,
} from './core';
import type {
  CatalogActivationMutationPayload,
  CatalogAssetCreatePayload,
  CatalogAssetDeletePayload,
  CatalogAssetEnablementPayload,
  CatalogAssetInstallPayload,
  CatalogAssetUpdatePayload,
  CatalogAssetsQuery,
  CatalogAuditAssetsQuery,
  CatalogAuditEventsQuery,
  CatalogBundleUninstallPayload,
  CatalogBundlesQuery,
  CatalogProviderInstallPayload,
  CatalogRepoInventoryQuery,
  CatalogRepoMutationPayload,
  CatalogRepoScanRootsPayload,
  CatalogSourceAddPayload,
  CatalogSourceIdPayload,
  CatalogSourceInstallableMutationPayload,
   CatalogSourceSyncInstallVerifyPayload,
   CatalogSpecKitBootstrapPayload,
  CatalogSelectorQuery,
} from './core';

export function getCatalogSummary(query: CatalogSelectorQuery = {}, baseUrl?: string): Promise<CatalogSummaryResponse> {
  return apiRequest<CatalogSummaryResponse>('/api/catalog/summary', {
    baseUrl,
    query: buildCatalogSelectorQuery(query),
  });
}

export function getCatalogContent(query: CatalogContentQuery, baseUrl?: string): Promise<string> {
  return apiRequest<string>('/api/catalog/content', {
    baseUrl,
    query: {
      mode: query.mode,
      path: query.path,
      sourceId: query.sourceId,
    },
  });
}

export function getCatalogSources(baseUrl?: string): Promise<CatalogSourcesListResponse> {
  return apiRequest<CatalogSourcesListResponse>('/api/catalog/sources', {
    baseUrl,
  });
}

export function getCatalogSourceDetail(
  sourceId: string,
  baseUrl?: string
): Promise<CatalogSourceDetailResponse> {
  return apiRequest<CatalogSourceDetailResponse>(`/api/catalog/sources/${encodeURIComponent(sourceId)}`, {
    baseUrl,
  });
}

export function addCatalogSource(
  payload: CatalogSourceAddPayload,
  baseUrl?: string
): Promise<CatalogSourceMutationResponse> {
  return apiRequest<CatalogSourceMutationResponse>('/api/catalog/sources/add', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function removeCatalogSource(
  payload: CatalogSourceIdPayload,
  baseUrl?: string
): Promise<CatalogSourceMutationResponse> {
  return apiRequest<CatalogSourceMutationResponse>('/api/catalog/sources/remove', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function refreshCatalogSource(
  payload: CatalogSourceIdPayload,
  baseUrl?: string
): Promise<CatalogSourceMutationResponse> {
  return apiRequest<CatalogSourceMutationResponse>('/api/catalog/sources/refresh', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function activateCatalogSourceInstallable(
  payload: CatalogSourceInstallableMutationPayload,
  baseUrl?: string
): Promise<CatalogSourceInstallableMutationResponse> {
  return apiRequest<CatalogSourceInstallableMutationResponse>('/api/catalog/sources/activate', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function deactivateCatalogSourceInstallable(
  payload: CatalogSourceInstallableMutationPayload,
  baseUrl?: string
): Promise<CatalogSourceInstallableMutationResponse> {
  return apiRequest<CatalogSourceInstallableMutationResponse>('/api/catalog/sources/deactivate', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function syncInstallVerifyCatalogSource(
  payload: CatalogSourceSyncInstallVerifyPayload,
  baseUrl?: string
): Promise<CatalogSourceMutationResponse> {
  return apiRequest<CatalogSourceMutationResponse>('/api/catalog/sources/sync-install-verify', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function bootstrapCatalogSpecKit(
  payload: CatalogSpecKitBootstrapPayload,
  baseUrl?: string
): Promise<CatalogSourceInstallableMutationResponse> {
  return apiRequest<CatalogSourceInstallableMutationResponse>('/api/catalog/tools/spec-kit/bootstrap', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
