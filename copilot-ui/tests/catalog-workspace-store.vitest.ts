import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetCatalogSummary = vi.fn();
const mockGetCatalogBundles = vi.fn();
const mockGetCatalogAssets = vi.fn();
const mockGetRuntimeCatalogHealth = vi.fn();
const mockGetCatalogAssetDetail = vi.fn();
const mockGetCatalogAuditEvents = vi.fn();
const mockGetCatalogRepos = vi.fn();
const mockGetAssetView = vi.fn();
const mockRefreshCatalogProjection = vi.fn();
const mockSearchCatalogAssets = vi.fn();
const mockSyncAllAssets = vi.fn();
const mockCreateCatalogAsset = vi.fn();
const mockUpdateCatalogAsset = vi.fn();
const mockDeleteCatalogAsset = vi.fn();
const mockInstallCatalogAsset = vi.fn();
const mockEnableCatalogAsset = vi.fn();
const mockDisableCatalogAsset = vi.fn();
const mockRegisterCatalogRepo = vi.fn();
const mockSaveCatalogRepoScanRoots = vi.fn();
const mockSelectCatalogRepo = vi.fn();
const mockRefreshCatalogRepo = vi.fn();
const mockUnregisterCatalogRepo = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  createCatalogAsset: mockCreateCatalogAsset,
  deleteCatalogAsset: mockDeleteCatalogAsset,
  disableCatalogAsset: mockDisableCatalogAsset,
  enableCatalogAsset: mockEnableCatalogAsset,
  getAssetView: mockGetAssetView,
  getCatalogAssetDetail: mockGetCatalogAssetDetail,
  getCatalogAssets: mockGetCatalogAssets,
  getCatalogAuditEvents: mockGetCatalogAuditEvents,
  getCatalogBundles: mockGetCatalogBundles,
  getCatalogRepos: mockGetCatalogRepos,
  getCatalogSummary: mockGetCatalogSummary,
  getRuntimeCatalogHealth: mockGetRuntimeCatalogHealth,
  installCatalogAsset: mockInstallCatalogAsset,
  refreshCatalogProjection: mockRefreshCatalogProjection,
  refreshCatalogRepo: mockRefreshCatalogRepo,
  registerCatalogRepo: mockRegisterCatalogRepo,
  saveCatalogRepoScanRoots: mockSaveCatalogRepoScanRoots,
  searchCatalogAssets: mockSearchCatalogAssets,
  selectCatalogRepo: mockSelectCatalogRepo,
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
    mockGetCatalogAuditEvents.mockReset();
    mockGetCatalogRepos.mockReset();
    mockGetAssetView.mockReset();
    mockRefreshCatalogProjection.mockReset();
    mockSearchCatalogAssets.mockReset();
    mockSyncAllAssets.mockReset();
    mockCreateCatalogAsset.mockReset();
    mockUpdateCatalogAsset.mockReset();
    mockDeleteCatalogAsset.mockReset();
    mockInstallCatalogAsset.mockReset();
    mockEnableCatalogAsset.mockReset();
    mockDisableCatalogAsset.mockReset();
    mockRegisterCatalogRepo.mockReset();
    mockSaveCatalogRepoScanRoots.mockReset();
    mockSelectCatalogRepo.mockReset();
    mockRefreshCatalogRepo.mockReset();
    mockUnregisterCatalogRepo.mockReset();
    mockGetCatalogBundles.mockResolvedValue({ bundles: [] });
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
  }

  it('loads the catalog workspace, selects the first asset, and hydrates audit plus content preview', async () => {
    mockGetCatalogRepos.mockResolvedValue({
      workspaceScan: {
        storage: {
          path: 'C:\\Users\\tester\\.copilot\\catalog\\repo-discovery.json',
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
          bundleId: 'superpowers-workflow',
          title: 'Superpowers Workflow Pack',
          status: 'available',
          stats: {
            memberCount: 15,
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
            'user-installed': 'C:\\Users\\lolzi\\.copilot\\skills\\test\\SKILL.md',
          },
        },
        selectedEntry: {
          assetId: 'skill-test',
          kind: 'skill',
          title: 'Test skill',
          contentPath: 'C:\\Users\\lolzi\\.copilot\\skills\\test\\SKILL.md',
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
    expect(mockGetAssetView).toHaveBeenCalledWith('skills/test/SKILL.md');

    const state = catalogWorkspaceStore.getState();
    expect(state.selectedAssetId).toBe('skill-test');
    expect(state.selectedAsset?.assetId).toBe('skill-test');
    expect(state.selectedEntries).toHaveLength(1);
    expect(state.auditEvents).toHaveLength(1);
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
          assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
          assetKey: 'copilot-home-plugin-superpowers-brainstorming',
          kind: 'skill',
          installed: true,
          enabled: true,
          available: true,
          selectedEntry: {
            assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
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
        assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
        assetKey: 'copilot-home-plugin-superpowers-brainstorming',
        kind: 'skill',
        installed: true,
        enabled: true,
        available: true,
        installState: {
          availability: 'installed',
          installedPaths: {
            'user-installed': 'C:\\Users\\lolzi\\.copilot\\skills\\superpowers\\brainstorming\\SKILL.md',
          },
        },
        selectedEntry: {
          assetId: 'skill-copilot-home-plugin-superpowers-brainstorming',
          kind: 'skill',
          title: 'Brainstorming',
          contentPath: 'C:\\Users\\lolzi\\.copilot\\skills\\superpowers\\brainstorming\\SKILL.md',
          metadata: {
            viewPath: 'skills/superpowers/brainstorming/SKILL.md',
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

    expect(mockGetAssetView).toHaveBeenCalledWith('skills/superpowers/brainstorming/SKILL.md');
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
      kind: 'skill',
      repoPath: 'C:\\repo',
      includeVaultOnly: false,
      preferLoadMode: 'on-demand',
    });
    expect(catalogWorkspaceStore.getState().searchResults).toHaveLength(1);
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
            bundleId: 'superpowers-workflow',
            title: 'Superpowers Workflow Pack',
            status: 'available',
            stats: {
              memberCount: 2,
              installedCount: 0,
            },
            members: [
              {
                assetId: 'skill-superpowers-brainstorming',
                available: true,
                installed: false,
              },
              {
                assetId: 'agent-superpowers-code-reviewer',
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
            bundleId: 'superpowers-workflow',
            title: 'Superpowers Workflow Pack',
            status: 'available',
            stats: {
              memberCount: 2,
              installedCount: 0,
            },
            members: [
              {
                assetId: 'skill-superpowers-brainstorming',
                available: true,
                installed: false,
              },
              {
                assetId: 'agent-superpowers-code-reviewer',
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
            bundleId: 'superpowers-workflow',
            title: 'Superpowers Workflow Pack',
            status: 'installed',
            stats: {
              memberCount: 2,
              installedCount: 2,
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
    await catalogWorkspaceStore.installBundle('superpowers-workflow');

    expect(mockInstallCatalogAsset).toHaveBeenCalledTimes(2);
    expect(mockInstallCatalogAsset).toHaveBeenNthCalledWith(1, { assetId: 'skill-superpowers-brainstorming' });
    expect(mockInstallCatalogAsset).toHaveBeenNthCalledWith(2, { assetId: 'agent-superpowers-code-reviewer' });
    expect(catalogWorkspaceStore.getState().installMessage).toContain('Installed 2 bundle asset(s)');
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
            path: 'C:\\Users\\tester\\.copilot\\catalog\\repo-discovery.json',
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
});
