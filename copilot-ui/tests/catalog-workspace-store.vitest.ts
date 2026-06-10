import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mockGetCatalogSummary = vi.fn();
const mockGetCatalogBundles = vi.fn();
const mockGetCatalogAssets = vi.fn();
const mockGetRuntimeCatalogHealth = vi.fn();
const mockGetCatalogAssetDetail = vi.fn();
const mockAddCatalogSource = vi.fn();
const mockActivateCatalogSourceInstallable = vi.fn();
const mockGetCatalogAuditEvents = vi.fn();
const mockGetCatalogAssetAnalytics = vi.fn();
const mockGetCatalogRepos = vi.fn();
const mockGetAssetView = vi.fn();
const mockDeactivateCatalogSourceInstallable = vi.fn();
const mockRefreshCatalogProjection = vi.fn();
const mockRefreshCatalogSource = vi.fn();
const mockRemoveCatalogSource = vi.fn();
const mockSyncInstallVerifyCatalogSource = vi.fn();
const mockBootstrapCatalogSpecKit = vi.fn();
const mockSearchCatalogAssets = vi.fn();
const mockRecordCatalogSearchSelection = vi.fn();
const mockSyncAllAssets = vi.fn();
const mockCreateCatalogAsset = vi.fn();
const mockUpdateCatalogAsset = vi.fn();
const mockDeleteCatalogAsset = vi.fn();
const mockInstallCatalogAsset = vi.fn();
const mockUninstallCatalogBundle = vi.fn();
const mockEnableCatalogAsset = vi.fn();
const mockDisableCatalogAsset = vi.fn();
const mockRegisterCatalogRepo = vi.fn();
const mockSaveCatalogRepoScanRoots = vi.fn();
const mockSelectCatalogRepo = vi.fn();
const mockRefreshCatalogRepo = vi.fn();
const mockUnregisterCatalogRepo = vi.fn();
vi.mock('../ui/src/lib/api', () => ({
  activateCatalogSourceInstallable: mockActivateCatalogSourceInstallable,
  addCatalogSource: mockAddCatalogSource,
  createCatalogAsset: mockCreateCatalogAsset,
  deactivateCatalogSourceInstallable: mockDeactivateCatalogSourceInstallable,
  deleteCatalogAsset: mockDeleteCatalogAsset,
  disableCatalogAsset: mockDisableCatalogAsset,
  enableCatalogAsset: mockEnableCatalogAsset,
  getAssetView: mockGetAssetView,
  getCatalogAssetDetail: mockGetCatalogAssetDetail,
  getCatalogAssetAnalytics: mockGetCatalogAssetAnalytics,
  getCatalogAssets: mockGetCatalogAssets,
  getCatalogAuditEvents: mockGetCatalogAuditEvents,
  getCatalogBundles: mockGetCatalogBundles,
  getCatalogRepos: mockGetCatalogRepos,
  getCatalogSummary: mockGetCatalogSummary,
  getRuntimeCatalogHealth: mockGetRuntimeCatalogHealth,
  bootstrapCatalogSpecKit: mockBootstrapCatalogSpecKit,
  installCatalogAsset: mockInstallCatalogAsset,
  uninstallCatalogBundle: mockUninstallCatalogBundle,
  refreshCatalogSource: mockRefreshCatalogSource,
  removeCatalogSource: mockRemoveCatalogSource,
  refreshCatalogProjection: mockRefreshCatalogProjection,
  recordCatalogSearchSelection: mockRecordCatalogSearchSelection,
  refreshCatalogRepo: mockRefreshCatalogRepo,
  registerCatalogRepo: mockRegisterCatalogRepo,
  saveCatalogRepoScanRoots: mockSaveCatalogRepoScanRoots,
  searchCatalogAssets: mockSearchCatalogAssets,
  selectCatalogRepo: mockSelectCatalogRepo,
  syncInstallVerifyCatalogSource: mockSyncInstallVerifyCatalogSource,
  syncAllAssets: mockSyncAllAssets,
  unregisterCatalogRepo: mockUnregisterCatalogRepo,
  updateCatalogAsset: mockUpdateCatalogAsset,
}));
describe('catalogWorkspaceStore', () => {
  beforeEach(() => {
    mockGetCatalogSummary.mockReset();
    mockGetCatalogBundles.mockReset();
    mockGetCatalogAssets.mockReset();
    mockGetCatalogBundles.mockReset();
    mockGetRuntimeCatalogHealth.mockReset();
    mockGetCatalogAssetDetail.mockReset();
    mockAddCatalogSource.mockReset();
    mockActivateCatalogSourceInstallable.mockReset();
    mockGetCatalogAuditEvents.mockReset();
    mockGetCatalogAssetAnalytics.mockReset();
    mockGetCatalogRepos.mockReset();
    mockGetAssetView.mockReset();
    mockDeactivateCatalogSourceInstallable.mockReset();
    mockRefreshCatalogProjection.mockReset();
    mockRefreshCatalogSource.mockReset();
    mockRemoveCatalogSource.mockReset();
    mockSyncInstallVerifyCatalogSource.mockReset();
    mockBootstrapCatalogSpecKit.mockReset();
    mockSearchCatalogAssets.mockReset();
    mockRecordCatalogSearchSelection.mockReset();
    mockSyncAllAssets.mockReset();
    mockCreateCatalogAsset.mockReset();
    mockUpdateCatalogAsset.mockReset();
    mockDeleteCatalogAsset.mockReset();
    mockInstallCatalogAsset.mockReset();
    mockUninstallCatalogBundle.mockReset();
    mockEnableCatalogAsset.mockReset();
    mockDisableCatalogAsset.mockReset();
    mockRegisterCatalogRepo.mockReset();
    mockSaveCatalogRepoScanRoots.mockReset();
    mockSelectCatalogRepo.mockReset();
    mockRefreshCatalogRepo.mockReset();
    mockUnregisterCatalogRepo.mockReset();
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [],
        repos: [],
        sessions: [],
        recentEvents: [],
      },
    });
  });
  afterEach(() => {
    vi.resetModules();
  });
  function primeWorkspaceLoad() {
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [],
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [],
        repos: [
          {
            repoId: 'repo-1',
            search: {
              queryCount: 1,
            },
            usage: {
              invocationCount: 0,
              explicitInvocationCount: 0,
              proxyInvocationCount: 0,
            },
          },
        ],
        sessions: [],
        recentEvents: [],
      },
    });
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [],
        repos: [],
        sessions: [],
        recentEvents: [],
      },
    });
  }
  it('loads the catalog workspace, selects the first asset, and hydrates audit plus content preview', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      workspaceScan: {
        storage: {
          path: 'C:\\Users\\tester\\.elegy\\catalog\\repo-discovery.json',
          exists: true,
        },
        defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
        customScanRoots: ['D:\\work\\repos'],
        scanRoots: ['C:\\Users\\tester\\Documents\\GitHub', 'D:\\work\\repos'],
      },
      repos: [],
      selectedRepo: null,
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
        },
        stats: {
          effectiveCount: 1,
          installedCount: 1,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [
        {
          bundleId: 'repo-setup-governance-global',
          title: 'Repo Setup Governance Skill',
          status: 'available',
          stats: {
            memberCount: 1,
            installedCount: 0,
          },
          members: [],
        },
      ],
    });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [
        {
          assetId: 'skill-test',
          assetKey: 'test',
          kind: 'skill',
          installed: true,
          enabled: true,
          available: true,
          selectedEntry: {
            assetId: 'skill-test',
            kind: 'skill',
            title: 'Test skill',
          },
        },
      ],
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        freshness: {
          status: 'fresh',
          ageMs: 0,
          latestInputAt: '2026-03-09T00:00:00.000Z',
          reasons: [],
        },
      },
      audit: {
        exists: true,
      },
    });
    mockGetCatalogAssetDetail.mockResolvedValue({
      asset: {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        installed: true,
        enabled: true,
        available: true,
        installState: {
          availability: 'installed',
          installedPaths: {
            'user-installed': 'C:\\Users\\lolzi\\.elegy\\skills\\test\\SKILL.md',
          },
        },
        selectedEntry: {
          assetId: 'skill-test',
          kind: 'skill',
          title: 'Test skill',
          contentPath: 'C:\\Users\\lolzi\\.elegy\\skills\\test\\SKILL.md',
        },
      },
      entries: [
        {
          assetId: 'skill-test',
          kind: 'skill',
          title: 'Test skill',
        },
      ],
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [
        {
          eventId: 'audit-1',
          eventType: 'asset.search.result',
          occurredAt: '2026-03-09T00:01:00.000Z',
        },
      ],
    });
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [
          {
            assetId: 'skill-test',
            assetKey: 'test',
            kind: 'skill',
            search: {
              sampled: {
                resultCount: 2,
                selectedCount: 1,
              },
            },
            usage: {
              invocationCount: 3,
              explicitInvocationCount: 2,
              proxyInvocationCount: 1,
            },
          },
        ],
        repos: [
          {
            repoId: 'repo-1',
            search: {
              queryCount: 4,
              selectedCount: 1,
            },
            usage: {
              invocationCount: 3,
              explicitInvocationCount: 2,
              proxyInvocationCount: 1,
            },
          },
        ],
        sessions: [],
        recentEvents: [],
      },
    });
    mockGetAssetView.mockResolvedValue('# Test skill');
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    expect(mockGetCatalogRepos).toHaveBeenCalledTimes(1);
    expect(mockGetCatalogSummary).toHaveBeenCalledTimes(1);
    expect(mockGetCatalogBundles).toHaveBeenCalledTimes(1);
    expect(mockGetCatalogAssets).toHaveBeenCalledTimes(1);
    expect(mockGetRuntimeCatalogHealth).toHaveBeenCalledTimes(1);
    expect(mockGetCatalogAssetDetail).toHaveBeenCalledWith('skill-test', {});
    expect(mockGetCatalogAuditEvents).toHaveBeenCalledWith({
      assetId: 'skill-test',
      repoId: 'repo-1',
      limit: 25,
    });
    expect(mockGetCatalogAssetAnalytics).toHaveBeenCalledWith({
      repoId: 'repo-1',
      limit: 25,
    });
    expect(mockGetAssetView).toHaveBeenCalledWith('skills/test/SKILL.md');
    const state = catalogWorkspaceStore.getState();
    expect(state.selectedAssetId).toBe('skill-test');
    expect(state.selectedAsset?.assetId).toBe('skill-test');
    expect(state.selectedEntries).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
    expect(state.auditAnalytics?.assets[0]?.usage?.explicitInvocationCount).toBe(2);
    expect(state.selectedAssetContent).toContain('Test skill');
    expect(state.repoInventory?.workspaceScan?.customScanRoots).toEqual(['D:\\work\\repos']);
  });
  it('prefers explicit metadata view paths for nested installed assets', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [],
      selectedRepo: null,
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        stats: {
          effectiveCount: 1,
          installedCount: 1,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [
        {
          assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
          assetKey: 'copilot-home-plugin-external-provider-brainstorming',
          kind: 'skill',
          installed: true,
          enabled: true,
          available: true,
          selectedEntry: {
            assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
            kind: 'skill',
            title: 'Brainstorming',
          },
        },
      ],
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
      audit: {
        exists: true,
      },
    });
    mockGetCatalogAssetDetail.mockResolvedValue({
      asset: {
        assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
        assetKey: 'copilot-home-plugin-external-provider-brainstorming',
        kind: 'skill',
        installed: true,
        enabled: true,
        available: true,
        installState: {
          availability: 'installed',
          installedPaths: {
            'user-installed': 'C:\\Users\\lolzi\\.elegy\\skills\\external-provider\\brainstorming\\SKILL.md',
          },
        },
        selectedEntry: {
          assetId: 'skill-copilot-home-plugin-external-provider-brainstorming',
          kind: 'skill',
          title: 'Brainstorming',
          contentPath: 'C:\\Users\\lolzi\\.elegy\\skills\\external-provider\\brainstorming\\SKILL.md',
          metadata: {
            viewPath: 'skills/external-provider/brainstorming/SKILL.md',
          },
        },
      },
      entries: [],
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockGetAssetView.mockResolvedValue('# Brainstorming');
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    expect(mockGetAssetView).toHaveBeenCalledWith('skills/external-provider/brainstorming/SKILL.md');
  });
  it('runs deterministic catalog search with the active repo scope and load mode preference', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [],
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockSelectCatalogRepo.mockResolvedValue({
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
      },
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
      },
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    catalogWorkspaceStore.setRepoPathInput('C:\\repo');
    await catalogWorkspaceStore.applyRepoContext();
    mockSearchCatalogAssets.mockResolvedValue({
      results: [
        {
          rank: 1,
          assetId: 'skill-search',
          score: 42,
          explanations: [
            {
              code: 'name',
              message: 'Matched asset name/title.',
            },
          ],
        },
      ],
    });
    catalogWorkspaceStore.setSearchQuery('search');
    catalogWorkspaceStore.setSearchPreferLoadMode('on-demand');
    await catalogWorkspaceStore.runSearch();
    expect(mockSearchCatalogAssets).toHaveBeenCalledWith({
      query: 'search',
      repoId: 'repo-1',
      repoPath: 'C:\\repo',
      includeVaultOnly: false,
      preferLoadMode: 'on-demand',
      limit: 20,
    });
    expect(mockGetCatalogAssetAnalytics).toHaveBeenLastCalledWith({
      repoId: 'repo-1',
      repoPath: 'C:\\repo',
      limit: 25,
    });
    expect(catalogWorkspaceStore.getState().searchResults).toHaveLength(1);
  });
  it('records search selection telemetry without blocking inspection', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
        },
        stats: {
          effectiveCount: 1,
          installedCount: 1,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [
        {
          assetId: 'skill-search',
          assetKey: 'search-skill',
          kind: 'skill',
          installed: true,
          enabled: true,
          available: true,
          selectedEntry: {
            assetId: 'skill-search',
            assetKey: 'search-skill',
            kind: 'skill',
            title: 'Search skill',
          },
        },
      ],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAssetDetail.mockResolvedValue({
      asset: {
        assetId: 'skill-search',
        assetKey: 'search-skill',
        kind: 'skill',
      },
      entries: [],
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockGetAssetView.mockResolvedValue('# Search skill');
    mockRecordCatalogSearchSelection.mockRejectedValue(new Error('telemetry unavailable'));
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    catalogWorkspaceStore.setSearchQuery('search');
    catalogWorkspaceStore.setSearchPreferLoadMode('on-demand');
    await catalogWorkspaceStore.inspectSearchResult({
      rank: 1,
      assetId: 'skill-search',
      score: 42,
      explanations: [
        {
          code: 'name',
          message: 'Matched asset name/title.',
        },
      ],
      effectiveState: {
        assetId: 'skill-search',
        assetKey: 'search-skill',
        kind: 'skill',
        scope: {
          kind: 'repo',
          repoId: 'repo-1',
        },
      },
      entry: {
        assetId: 'skill-search',
        assetKey: 'search-skill',
        kind: 'skill',
        scope: {
          kind: 'repo',
          repoId: 'repo-1',
        },
      },
    });
    expect(mockRecordCatalogSearchSelection).toHaveBeenCalledWith({
      assetId: 'skill-search',
      assetKey: 'search-skill',
      resultCount: 0,
      query: {
        query: 'search',
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        includeVaultOnly: false,
        preferLoadMode: 'on-demand',
        limit: 20,
      },
      result: {
        assetId: 'skill-search',
        score: 42,
        rank: 1,
        explanations: [
          {
            code: 'name',
            message: 'Matched asset name/title.',
          },
        ],
        effectiveState: {
          assetKey: 'search-skill',
          kind: 'skill',
          scope: {
            repoId: 'repo-1',
          },
        },
        entry: {
          assetKey: 'search-skill',
          kind: 'skill',
          scope: {
            repoId: 'repo-1',
          },
        },
      },
    });
    expect(catalogWorkspaceStore.getState().selectedAssetId).toBe('skill-search');
    expect(mockGetCatalogAssetDetail).toHaveBeenCalledWith('skill-search', {
      repoId: 'repo-1',
      repoPath: 'C:\\repo',
    });
    expect(catalogWorkspaceStore.getState().auditError).toContain('telemetry unavailable');
  });
  it('preserves the active repo context when repo inventory refresh fails', async () => {
    primeWorkspaceLoad();
    mockGetCatalogRepos.mockResolvedValue({
      repos: [],
      selectedRepo: null,
    });
    mockSelectCatalogRepo.mockResolvedValue({
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
      },
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
      },
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    catalogWorkspaceStore.setRepoPathInput('C:\\repo');
    await catalogWorkspaceStore.applyRepoContext();
    mockGetCatalogRepos.mockRejectedValue(new Error('repo inventory unavailable'));
    await catalogWorkspaceStore.loadWorkspace();
    expect(catalogWorkspaceStore.getState().activeRepoPath).toBe('C:\\repo');
    expect(catalogWorkspaceStore.getState().activeRepoId).toBe('repo-1');
  });
  it('installs a bundle by iterating installable bundle members and reloading workspace state', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [],
      selectedRepo: null,
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogBundles
      .mockResolvedValueOnce({
        bundles: [
          {
            bundleId: 'repo-setup-governance-global',
            title: 'Repo Setup Governance Skill',
            status: 'available',
            stats: {
              memberCount: 1,
              installedCount: 0,
            },
            members: [
              {
                assetId: 'skill-repo-setup-governance',
                available: true,
                installed: false,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        bundles: [
          {
            bundleId: 'repo-setup-governance-global',
            title: 'Repo Setup Governance Skill',
            status: 'available',
            stats: {
              memberCount: 1,
              installedCount: 0,
            },
            members: [
              {
                assetId: 'skill-repo-setup-governance',
                available: true,
                installed: false,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        bundles: [
          {
            bundleId: 'repo-setup-governance-global',
            title: 'Repo Setup Governance Skill',
            status: 'installed',
            stats: {
              memberCount: 1,
              installedCount: 1,
            },
            members: [],
          },
        ],
      });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockInstallCatalogAsset.mockResolvedValue({ action: 'installed' });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.installBundle('repo-setup-governance-global');
    expect(mockInstallCatalogAsset).toHaveBeenCalledTimes(1);
    expect(mockInstallCatalogAsset).toHaveBeenNthCalledWith(1, { assetId: 'skill-repo-setup-governance' });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Installed 1 bundle asset(s)');
  });
  it('uninstalls a bundle through the lifecycle route and reloads workspace state', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
        },
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogBundles
      .mockResolvedValueOnce({
        bundles: [
          {
            bundleId: 'repo-setup-governance-global',
            title: 'Repo Setup Governance Skill',
            activationStatus: 'active',
            status: 'installed',
            stats: {
              memberCount: 1,
              installedCount: 1,
            },
            uninstallPolicy: {
              preservesExternalPackages: true,
            },
            members: [
              {
                assetId: 'skill-repo-setup-governance',
                available: true,
                installed: true,
                enabled: true,
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        bundles: [
          {
            bundleId: 'repo-setup-governance-global',
            title: 'Repo Setup Governance Skill',
            activationStatus: 'inactive',
            status: 'available',
            stats: {
              memberCount: 1,
              installedCount: 0,
            },
            members: [],
          },
        ],
      });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockUninstallCatalogBundle.mockResolvedValue({
      action: 'bundle-uninstalled',
      bundleId: 'repo-setup-governance-global',
      removedAssetIds: ['skill-repo-setup-governance'],
      preserveExternalPackages: true,
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.uninstallBundle('repo-setup-governance-global');
    expect(mockUninstallCatalogBundle).toHaveBeenCalledWith({
      bundleId: 'repo-setup-governance-global',
      repoId: 'repo-1',
      repoPath: 'C:\\repo',
    });
    expect(mockGetCatalogSummary).toHaveBeenCalledTimes(2);
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Uninstalled 1 bundle asset(s)');
    expect(catalogWorkspaceStore.getState().installMessage).toContain('External provider packages were preserved');
  });
  it('registers repo metadata without auto-selecting the repo scope', async () => {
    primeWorkspaceLoad();
    mockGetCatalogRepos
      .mockResolvedValueOnce({
        workspaceScan: {
          customScanRoots: [],
          defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
          scanRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
        },
        repos: [],
        selectedRepo: null,
      })
      .mockResolvedValueOnce({
        workspaceScan: {
          customScanRoots: [],
          defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
          scanRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
        },
        repos: [
          {
            repoId: 'repo-1',
            repoPath: 'C:\\repo',
            repoLabel: 'Repo',
            registered: true,
            selected: false,
            sources: ['manual'],
          },
        ],
        selectedRepo: null,
      });
    mockRegisterCatalogRepo.mockResolvedValue({
      repo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        repoLabel: 'Repo',
        registered: true,
      },
      selectedRepo: null,
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.registerRepo('C:\\repo', 'Repo');
    expect(mockRegisterCatalogRepo).toHaveBeenCalledWith({
      repoPath: 'C:\\repo',
      repoLabel: 'Repo',
    });
    expect(catalogWorkspaceStore.getState().activeRepoPath).toBe('');
    expect(catalogWorkspaceStore.getState().activeRepoId).toBe('');
    expect(catalogWorkspaceStore.getState().repoPathInput).toBe('C:\\repo');
    expect(catalogWorkspaceStore.getState().repoInventory?.selectedRepo).toBeNull();
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Registered Repo for discovery metadata');
  });
  it('saves persisted custom scan roots and reloads discovered repo inventory', async () => {
    primeWorkspaceLoad();
    mockGetCatalogRepos
      .mockResolvedValueOnce({
        workspaceScan: {
          customScanRoots: [],
          defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
          scanRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
        },
        repos: [],
        selectedRepo: null,
      })
      .mockResolvedValueOnce({
        workspaceScan: {
          storage: {
            path: 'C:\\Users\\tester\\.elegy\\catalog\\repo-discovery.json',
            exists: true,
          },
          customScanRoots: ['D:\\work\\repos'],
          defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
          scanRoots: ['C:\\Users\\tester\\Documents\\GitHub', 'D:\\work\\repos'],
        },
        repos: [
          {
            repoId: 'discovered-repo',
            repoPath: 'D:\\work\\repos\\catalog-app',
            repoLabel: 'catalog-app',
            selected: false,
            registered: false,
            sources: ['workspace-scan'],
          },
        ],
        selectedRepo: null,
      });
    mockSaveCatalogRepoScanRoots.mockResolvedValue({
      updated: true,
      workspaceScan: {
        customScanRoots: ['D:\\work\\repos'],
        defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
        scanRoots: ['C:\\Users\\tester\\Documents\\GitHub', 'D:\\work\\repos'],
      },
      repos: [
        {
          repoId: 'discovered-repo',
          repoPath: 'D:\\work\\repos\\catalog-app',
          repoLabel: 'catalog-app',
          sources: ['workspace-scan'],
        },
      ],
      selectedRepo: null,
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.saveCustomScanRoots(['D:\\work\\repos']);
    expect(mockSaveCatalogRepoScanRoots).toHaveBeenCalledWith({
      customScanRoots: ['D:\\work\\repos'],
    });
    expect(catalogWorkspaceStore.getState().repoInventory?.workspaceScan?.customScanRoots).toEqual(['D:\\work\\repos']);
    expect(catalogWorkspaceStore.getState().repoInventory?.repos[0]?.sources).toEqual(['workspace-scan']);
    expect(catalogWorkspaceStore.getState().activeRepoPath).toBe('');
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Saved 1 custom scan root');
  });
  it('creates a repo-local asset and reloads the workspace around the mutation', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
        },
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
      },
    });
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetCatalogAssets.mockResolvedValue({
      assets: [],
    });
    mockGetCatalogBundles.mockResolvedValue({
      bundles: [],
    });
    mockGetRuntimeCatalogHealth.mockResolvedValue({
      ok: true,
      projection: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
      },
    });
    mockGetCatalogAuditEvents.mockResolvedValue({
      events: [],
    });
    mockCreateCatalogAsset.mockResolvedValue({
      action: 'created',
      assetId: 'skill-new-helper',
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.createAsset({
      authoringScope: 'repo-local',
      kind: 'skill',
      assetKey: 'new-helper',
      content: '## New helper',
      repoPath: 'C:\\repo',
      loadMode: 'on-demand',
    });
    expect(mockCreateCatalogAsset).toHaveBeenCalledWith({
      authoringScope: 'repo-local',
      kind: 'skill',
      assetKey: 'new-helper',
      content: '## New helper',
      repoPath: 'C:\\repo',
      loadMode: 'on-demand',
    });
    expect(mockGetCatalogSummary).toHaveBeenCalledTimes(2);
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Created');
  });
  it('adds an external source and reloads the workspace', async () => {
    primeWorkspaceLoad();
    mockGetCatalogRepos.mockResolvedValue({ repos: [], selectedRepo: null });
    mockAddCatalogSource.mockResolvedValue({
      source: {
        sourceId: 'demo-source',
        title: 'Demo Source',
      },
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.addExternalSource({
      url: 'https://github.com/example/demo',
      title: 'Demo Source',
      includeMcp: true,
    });
    expect(mockAddCatalogSource).toHaveBeenCalledWith({
      url: 'https://github.com/example/demo',
      title: 'Demo Source',
      includeMcp: true,
    });
    expect(mockGetCatalogSummary).toHaveBeenCalledTimes(2);
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Added source Demo Source');
  });
  it('activates and deactivates an external installable for a target', async () => {
    mockGetCatalogRepos.mockResolvedValue({ repos: [], selectedRepo: null });
    mockGetCatalogSummary
      .mockResolvedValueOnce({
        summary: {
          schemaVersion: 1,
          generatedAt: '2026-03-09T00:00:00.000Z',
          stats: {
            effectiveCount: 0,
            installedCount: 0,
            overriddenCount: 0,
          },
          externalSources: [
            {
              sourceId: 'demo-source',
              title: 'Demo Source',
              installables: [
                {
                  installableId: 'skill:brainstorming',
                  kind: 'skill',
                  title: 'Brainstorming',
                  targetSupport: ['codex', 'opencode'],
                },
              ],
              activation: {},
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        summary: {
          schemaVersion: 1,
          generatedAt: '2026-03-09T00:00:01.000Z',
          stats: {
            effectiveCount: 0,
            installedCount: 0,
            overriddenCount: 0,
          },
          externalSources: [
            {
              sourceId: 'demo-source',
              title: 'Demo Source',
              installables: [
                {
                  installableId: 'skill:brainstorming',
                  kind: 'skill',
                  title: 'Brainstorming',
                  targetSupport: ['codex', 'opencode'],
                },
              ],
              activation: {
                codex: {
                  installables: {
                    'skill:brainstorming': {
                      enabled: true,
                    },
                  },
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        summary: {
          schemaVersion: 1,
          generatedAt: '2026-03-09T00:00:02.000Z',
          stats: {
            effectiveCount: 0,
            installedCount: 0,
            overriddenCount: 0,
          },
          externalSources: [
            {
              sourceId: 'demo-source',
              title: 'Demo Source',
              installables: [
                {
                  installableId: 'skill:brainstorming',
                  kind: 'skill',
                  title: 'Brainstorming',
                  targetSupport: ['codex', 'opencode'],
                },
              ],
              activation: {
                codex: {
                  installables: {
                    'skill:brainstorming': {
                      enabled: false,
                    },
                  },
                },
              },
            },
          ],
        },
      });
    mockGetCatalogAssets.mockResolvedValue({ assets: [] });
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetRuntimeCatalogHealth.mockResolvedValue({ ok: true, projection: { schemaVersion: 1, generatedAt: '2026-03-09T00:00:00.000Z' } });
    mockGetCatalogAuditEvents.mockResolvedValue({ events: [] });
    mockActivateCatalogSourceInstallable.mockResolvedValue({});
    mockDeactivateCatalogSourceInstallable.mockResolvedValue({});
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.activateExternalSourceInstallable({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
    });
    await catalogWorkspaceStore.deactivateExternalSourceInstallable({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
    });
    expect(mockActivateCatalogSourceInstallable).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
    });
    expect(mockDeactivateCatalogSourceInstallable).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
    });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Deactivated skill:brainstorming for codex');
  });
  it('reinstalls active external installables for one target and across all active targets', async () => {
    mockGetCatalogRepos.mockResolvedValue({ repos: [], selectedRepo: null });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
        externalSources: [
          {
            sourceId: 'demo-source',
            title: 'Demo Source',
            installables: [
              {
                installableId: 'skill:brainstorming',
                kind: 'skill',
                targetSupport: ['codex', 'opencode'],
              },
              {
                installableId: 'mcp:context7',
                kind: 'mcp-server',
                targetSupport: ['codex', 'opencode', 'gemini-cli'],
              },
            ],
            activation: {
              codex: {
                installables: {
                  'skill:brainstorming': { enabled: true },
                  'mcp:context7': { enabled: true },
                },
              },
              opencode: {
                installables: {
                  'skill:brainstorming': { enabled: true },
                },
              },
            },
          },
        ],
      },
    });
    mockGetCatalogAssets.mockResolvedValue({ assets: [] });
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetRuntimeCatalogHealth.mockResolvedValue({ ok: true, projection: { schemaVersion: 1, generatedAt: '2026-03-09T00:00:00.000Z' } });
    mockGetCatalogAuditEvents.mockResolvedValue({ events: [] });
    mockActivateCatalogSourceInstallable.mockResolvedValue({});
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.reinstallExternalSourceTarget('demo-source', 'codex');
    await catalogWorkspaceStore.reinstallExternalSourceAllTargets('demo-source');
    expect(mockActivateCatalogSourceInstallable).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'codex',
    });
    expect(mockActivateCatalogSourceInstallable).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      installableId: 'mcp:context7',
      target: 'codex',
    });
    expect(mockActivateCatalogSourceInstallable).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      installableId: 'skill:brainstorming',
      target: 'opencode',
    });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Reinstalled 2 active target(s)');
  });
  it('syncs, installs, and verifies an external source with the selected repo context', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
        },
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
        externalSources: [
          {
            sourceId: 'demo-source',
            title: 'Demo Source',
            sync: {
              verificationStatus: 'partial',
            },
            installables: [],
            activation: {},
          },
        ],
      },
    });
    mockGetCatalogAssets.mockResolvedValue({ assets: [] });
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetRuntimeCatalogHealth.mockResolvedValue({ ok: true, projection: { schemaVersion: 1, generatedAt: '2026-03-09T00:00:00.000Z' } });
    mockGetCatalogAuditEvents.mockResolvedValue({ events: [] });
    mockSyncInstallVerifyCatalogSource.mockResolvedValue({
      overallStatus: 'partial',
      warnings: ['Ghidra is not running.'],
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.syncInstallVerifyExternalSource({
      sourceId: 'demo-source',
      repoPath: 'C:\\repo',
    });
    expect(mockSyncInstallVerifyCatalogSource).toHaveBeenCalledWith({
      sourceId: 'demo-source',
      targets: undefined,
      installableIds: undefined,
      force: undefined,
      repoPath: 'C:\\repo',
    });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Synced, installed, and verified demo-source with 1 warning');
  });
  it('bootstraps Spec Kit in the selected repo and defaults to the Windows script', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      repos: [
        {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
          selected: true,
        },
      ],
      selectedRepo: {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        selected: true,
      },
    });
    mockGetCatalogSummary.mockResolvedValue({
      summary: {
        schemaVersion: 1,
        generatedAt: '2026-03-09T00:00:00.000Z',
        repoContext: {
          repoId: 'repo-1',
          repoPath: 'C:\\repo',
        },
        stats: {
          effectiveCount: 0,
          installedCount: 0,
          overriddenCount: 0,
        },
        externalSources: [
          {
            sourceId: 'spec-kit',
            title: 'Spec Kit',
            installables: [
              {
                installableId: 'cli:specify',
                kind: 'cli-tool',
                targetSupport: ['host'],
              },
            ],
            activation: {
              host: {
                installables: {
                  'cli:specify': {
                    enabled: true,
                    installed: true,
                  },
                },
              },
            },
          },
        ],
      },
    });
    mockGetCatalogAssets.mockResolvedValue({ assets: [] });
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
    mockGetRuntimeCatalogHealth.mockResolvedValue({ ok: true, projection: { schemaVersion: 1, generatedAt: '2026-03-09T00:00:00.000Z' } });
    mockGetCatalogAuditEvents.mockResolvedValue({ events: [] });
    mockBootstrapCatalogSpecKit.mockResolvedValue({
      repoPath: 'C:\\repo',
      overallStatus: 'ready',
    });
    const { catalogWorkspaceStore } = await import('../ui/src/tabs/Assets/catalogWorkspaceStore');
    await catalogWorkspaceStore.loadWorkspace();
    await catalogWorkspaceStore.bootstrapSpecKitRepo();
    expect(mockBootstrapCatalogSpecKit).toHaveBeenCalledWith({
      repoPath: 'C:\\repo',
      integration: 'copilot',
      script: undefined,
      force: undefined,
      ignoreAgentTools: undefined,
    });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Bootstrapped Spec Kit in C:\\repo');
  });
});
