import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  addExternalSource: vi.fn(),
  activateExternalSourceInstallable: vi.fn(),
  loadWorkspace: vi.fn(),
  deactivateExternalSourceInstallable: vi.fn(),
  refreshWorkspace: vi.fn(),
  refreshExternalSource: vi.fn(),
  removeExternalSource: vi.fn(),
  reinstallExternalSourceAllTargets: vi.fn(),
  reinstallExternalSourceTarget: vi.fn(),
  installAll: vi.fn(),
  installBundle: vi.fn(),
  uninstallBundle: vi.fn(),
  createAsset: vi.fn(),
  updateAsset: vi.fn(),
  deleteAsset: vi.fn(),
  installAsset: vi.fn(),
  enableAsset: vi.fn(),
  disableAsset: vi.fn(),
  registerRepo: vi.fn(),
  saveCustomScanRoots: vi.fn(),
  unregisterRepo: vi.fn(),
  refreshRepo: vi.fn(),
  selectRepo: vi.fn(),
  setRepoPathInput: vi.fn(),
  applyRepoContext: vi.fn(),
  clearRepoContext: vi.fn(),
  setFilters: vi.fn(),
  selectAsset: vi.fn(),
  inspectSearchResult: vi.fn(),
  setSearchQuery: vi.fn(),
  setSearchIncludeVaultOnly: vi.fn(),
  setSearchPreferLoadMode: vi.fn(),
  runSearch: vi.fn(),
}));

const mockState = {
  loading: false,
  refreshing: false,
  installing: false,
  mutating: false,
  error: null,
  summaryError: null,
  healthError: null,
  repoInventoryError: null,
  bundlesError: null,
  installMessage: 'Catalog projection refreshed.',
  repoPathInput: 'C:\\repo',
  activeRepoPath: 'C:\\repo',
  activeRepoId: 'repo-1',
  filters: {
    text: '',
    kind: 'all',
    scopeKind: 'all',
    installedOnly: false,
    enabledOnly: false,
    availableOnly: false,
    overriddenOnly: false,
  },
  summary: {
    schemaVersion: 1,
    generatedAt: '2026-03-09T00:00:00.000Z',
    externalSources: [
      {
        sourceId: 'demo-source',
        title: 'Demo Source',
        description: 'Shared external catalog source.',
        sync: {
          status: 'ready',
          lastSyncedAt: '2026-03-09T00:00:00.000Z',
          resolvedRef: 'main',
        },
        editable: true,
        installables: [
          {
            installableId: 'skill:brainstorming',
            kind: 'skill',
            title: 'Brainstorming',
            description: 'Prompted ideation skill.',
            targetSupport: ['codex', 'opencode'],
          },
        ],
        activation: {
          codex: {
            installables: {
              'skill:brainstorming': {
                installed: true,
                enabled: true,
                managedName: 'external--demo-source--brainstorming',
                installedPath: 'C:\\Users\\demo\\.codex\\skills\\external--demo-source--brainstorming',
              },
            },
          },
        },
      },
    ],
    stats: {
      effectiveCount: 2,
      installedCount: 1,
      overriddenCount: 1,
      byKind: {
        skill: 1,
        agent: 1,
      },
    },
  },
  bundles: [
    {
      bundleId: 'superpowers-workflow',
      title: 'Superpowers Workflow Pack',
      description: 'Optional workflow pack for disciplined planning, debugging, and TDD.',
      classification: 'workflow',
      targeting: {
        frameworks: ['react'],
        scopeKinds: ['repo'],
        tags: ['superpowers', 'workflow'],
      },
      materialization: 'on-demand',
      status: 'available',
      defaultRecommended: false,
      uninstallPolicy: {
        removesInstalledMembers: true,
        clearsActivationState: true,
        clearsRepoOverlayState: true,
        preservesExternalPackages: true,
      },
      stats: {
        memberCount: 15,
        installedCount: 3,
        enabledCount: 2,
        availableCount: 15,
        missingCount: 1,
      },
      tags: ['superpowers', 'workflow'],
      members: [],
    },
  ],
  assets: [
    {
      assetId: 'skill-test',
      assetKey: 'test',
      kind: 'skill',
      installed: true,
      enabled: true,
      available: true,
      overridden: true,
      selectedLayer: 'repo-local',
      scope: {
        kind: 'repo',
        repoPath: 'C:\\repo',
      },
      selectedEntry: {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        title: 'Test skill',
        description: 'Searchable skill',
        layer: 'repo-local',
        scope: {
          kind: 'repo',
          repoPath: 'C:\\repo',
          displayName: 'repo',
        },
        contentPath: 'C:\\repo\\.github\\skills\\test\\SKILL.md',
        installState: {
          availability: 'repo-local',
          loadMode: 'on-demand',
          contentHash: 'repo-hash',
        },
        metadata: {
          triggersOn: ['repo', 'helper'],
        },
      },
      contributingEntries: [],
      suppressedEntries: [],
      reasons: [
        {
          code: 'selected-repo-local',
          message: 'Repo-local override wins in the selected repo context.',
        },
      ],
      labels: ['available', 'installed', 'enabled', 'overridden'],
    },
  ],
  selectedAssetId: 'skill-test',
  selectedAsset: {
    assetId: 'skill-test',
    assetKey: 'test',
    kind: 'skill',
    installed: true,
    enabled: true,
    available: true,
    overridden: true,
    selectedLayer: 'repo-local',
    scope: {
      kind: 'repo',
      repoPath: 'C:\\repo',
    },
    installState: {
      availability: 'repo-local',
      isAutoLoaded: false,
      loadMode: 'on-demand',
    },
    selectedEntry: {
      assetId: 'skill-test',
      assetKey: 'test',
      kind: 'skill',
      title: 'Test skill',
      description: 'Searchable skill',
      layer: 'repo-local',
      scope: {
        kind: 'repo',
        repoPath: 'C:\\repo',
        displayName: 'repo',
      },
      contentPath: 'C:\\repo\\.github\\skills\\test\\SKILL.md',
      installState: {
        availability: 'repo-local',
        loadMode: 'on-demand',
        contentHash: 'repo-hash',
      },
      metadata: {
        triggersOn: ['repo', 'helper'],
      },
    },
    contributingEntries: [
      {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        layer: 'repo-local',
        title: 'Test skill',
        scope: {
          kind: 'repo',
          repoPath: 'C:\\repo',
          displayName: 'repo',
        },
        installState: {
          availability: 'repo-local',
          loadMode: 'on-demand',
          contentHash: 'repo-hash',
        },
        contentPath: 'C:\\repo\\.github\\skills\\test\\SKILL.md',
        metadata: {
          triggersOn: ['repo', 'helper'],
        },
      },
      {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        layer: 'source',
        title: 'Test skill',
        scope: {
          kind: 'global',
        },
        installState: {
          availability: 'source-only',
          loadMode: 'always',
          contentHash: 'source-hash',
        },
        contentPath: 'C:\\workspace\\engine-assets\\skills\\test\\SKILL.md',
        metadata: {
          triggersOn: ['repo', 'helper'],
        },
      },
    ],
    suppressedEntries: [
      {
        assetId: 'skill-test',
        kind: 'skill',
        layer: 'source',
        title: 'Test skill',
        scope: {
          kind: 'global',
        },
        installState: {
          availability: 'source-only',
        },
      },
    ],
    reasons: [
      {
        code: 'selected-repo-local',
        message: 'Repo-local override wins in the selected repo context.',
      },
    ],
    labels: ['available', 'installed', 'enabled', 'overridden'],
  },
  selectedEntries: [
    {
      assetId: 'skill-test',
      assetKey: 'test',
      kind: 'skill',
      title: 'Test skill',
      description: 'Searchable skill',
      layer: 'repo-local',
      scope: {
        kind: 'repo',
        repoPath: 'C:\\repo',
        displayName: 'repo',
      },
      contentPath: 'C:\\repo\\.github\\skills\\test\\SKILL.md',
      installState: {
        availability: 'repo-local',
        loadMode: 'on-demand',
        contentHash: 'repo-hash',
      },
      metadata: {
        triggersOn: ['repo', 'helper'],
      },
    },
    {
      assetId: 'skill-test',
      assetKey: 'test',
      kind: 'skill',
      title: 'Test skill',
      description: 'Searchable skill',
      layer: 'source',
      scope: {
        kind: 'global',
      },
      contentPath: 'C:\\workspace\\engine-assets\\skills\\test\\SKILL.md',
      installState: {
        availability: 'source-only',
        loadMode: 'always',
        contentHash: 'source-hash',
      },
      metadata: {
        triggersOn: ['repo', 'helper'],
      },
    },
  ],
  selectedAssetDetailLoading: false,
  selectedAssetDetailError: null,
  selectedAssetContent: '# Test skill',
  selectedAssetContentStatus: 'ready',
  selectedAssetContentLabel: 'Installed content preview · skills/test/SKILL.md',
  runtimeHealth: {
    ok: true,
    projection: {
      generatedAt: '2026-03-09T00:00:00.000Z',
      freshness: {
        status: 'fresh',
      },
      rebuild: {
        status: 'ready',
        lastSuccessfulAt: '2026-03-09T00:00:00.000Z',
      },
      warnings: {
        count: 0,
      },
      readMode: 'persisted-snapshot',
    },
    audit: {
      exists: true,
    },
  },
  auditEvents: [
    {
      eventId: 'audit-1',
      eventType: 'asset.search.result',
      occurredAt: '2026-03-09T00:01:00.000Z',
      search: {
        query: {
          query: 'search test',
        },
      },
    },
  ],
  auditLoading: false,
  auditError: null,
  auditAnalytics: {
    assets: [
      {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        search: {
          sampled: {
            resultCount: 3,
            selectedCount: 2,
          },
        },
        usage: {
          invocationCount: 4,
          explicitInvocationCount: 3,
          proxyInvocationCount: 1,
        },
      },
    ],
    repos: [
      {
        repoId: 'repo-1',
        search: {
          queryCount: 5,
          selectedCount: 2,
        },
        usage: {
          invocationCount: 4,
          explicitInvocationCount: 3,
          proxyInvocationCount: 1,
        },
      },
    ],
    sessions: [],
    recentEvents: [],
  },
  auditAnalyticsLoading: false,
  auditAnalyticsError: null,
  searchQuery: '',
  searchResults: [
    {
      rank: 1,
      assetId: 'skill-test',
      score: 42,
      entry: {
        assetId: 'skill-test',
        kind: 'skill',
        title: 'Test skill',
      },
      effectiveState: {
        assetId: 'skill-test',
        assetKey: 'test',
        kind: 'skill',
        selectedLayer: 'repo-local',
      },
      explanations: [
        {
          code: 'name',
          message: 'Matched asset name/title.',
        },
      ],
    },
  ],
  searchLoading: false,
  searchError: null,
  searchIncludeVaultOnly: false,
  searchPreferLoadMode: 'all',
  repoInventoryLoading: false,
  repoInventory: {
    workspaceScan: {
      storage: {
        path: 'C:\\Users\\tester\\.copilot\\catalog\\repo-discovery.json',
        exists: true,
      },
      defaultRoots: ['C:\\Users\\tester\\Documents\\GitHub'],
      customScanRoots: ['D:\\work\\repos'],
      scanRoots: ['C:\\Users\\tester\\Documents\\GitHub', 'D:\\work\\repos'],
    },
    repos: [
      {
        repoId: 'repo-1',
        repoPath: 'C:\\repo',
        repoLabel: 'repo',
        selected: true,
        registered: true,
        scanStatus: 'ready',
        sources: ['manual', 'session-state'],
        assets: {
          skillCount: 1,
          agentCount: 0,
        },
        hints: {
          frameworks: ['react'],
          targets: ['frontend'],
        },
      },
      {
        repoId: 'workspace-repo',
        repoPath: 'C:\\workspace',
        repoLabel: 'instruction-engine',
        selected: false,
        registered: false,
        scanStatus: 'ready',
        sources: ['workspace'],
        assets: {
          skillCount: 4,
          agentCount: 2,
        },
        hints: {
          frameworks: ['react'],
          targets: ['frontend'],
        },
      },
    ],
    selectedRepo: {
      repoId: 'repo-1',
      repoPath: 'C:\\repo',
      repoLabel: 'repo',
      selected: true,
      registered: true,
      scanStatus: 'ready',
      sources: ['manual', 'session-state'],
      assets: {
        skillCount: 1,
        agentCount: 0,
      },
      hints: {
        frameworks: ['react'],
        targets: ['frontend'],
      },
    },
  },
  selectedBundleId: 'superpowers-workflow',
};

const mockCatalogWorkspaceStore = {
  getState: () => mockState,
  subscribe: () => () => {},
  loadWorkspace: storeMocks.loadWorkspace,
  refreshWorkspace: storeMocks.refreshWorkspace,
  installAll: storeMocks.installAll,
  installBundle: storeMocks.installBundle,
  uninstallBundle: storeMocks.uninstallBundle,
  createAsset: storeMocks.createAsset,
  updateAsset: storeMocks.updateAsset,
  deleteAsset: storeMocks.deleteAsset,
  installAsset: storeMocks.installAsset,
  enableAsset: storeMocks.enableAsset,
  disableAsset: storeMocks.disableAsset,
  addExternalSource: storeMocks.addExternalSource,
  removeExternalSource: storeMocks.removeExternalSource,
  refreshExternalSource: storeMocks.refreshExternalSource,
  activateExternalSourceInstallable: storeMocks.activateExternalSourceInstallable,
  deactivateExternalSourceInstallable: storeMocks.deactivateExternalSourceInstallable,
  reinstallExternalSourceTarget: storeMocks.reinstallExternalSourceTarget,
  reinstallExternalSourceAllTargets: storeMocks.reinstallExternalSourceAllTargets,
  registerRepo: storeMocks.registerRepo,
  saveCustomScanRoots: storeMocks.saveCustomScanRoots,
  unregisterRepo: storeMocks.unregisterRepo,
  refreshRepo: storeMocks.refreshRepo,
  selectRepo: storeMocks.selectRepo,
  setRepoPathInput: storeMocks.setRepoPathInput,
  applyRepoContext: storeMocks.applyRepoContext,
  clearRepoContext: storeMocks.clearRepoContext,
  setFilters: storeMocks.setFilters,
  selectAsset: storeMocks.selectAsset,
  inspectSearchResult: storeMocks.inspectSearchResult,
  setSearchQuery: storeMocks.setSearchQuery,
  setSearchIncludeVaultOnly: storeMocks.setSearchIncludeVaultOnly,
  setSearchPreferLoadMode: storeMocks.setSearchPreferLoadMode,
  runSearch: storeMocks.runSearch,
};

describe('AssetsView catalog workspace', () => {
  beforeEach(() => {
    Object.values(storeMocks).forEach((mock) => mock.mockReset());
    storeMocks.installBundle.mockResolvedValue(undefined);
    storeMocks.uninstallBundle.mockResolvedValue(undefined);
    storeMocks.createAsset.mockResolvedValue(undefined);
    storeMocks.updateAsset.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('renders repo inventory and actionable authoring controls', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    expect(storeMocks.loadWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Repo scope & registration')).toBeInTheDocument();
    expect(screen.getByText('Workflow packs')).toBeInTheDocument();
    expect(screen.getAllByText('Superpowers Workflow Pack').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Create asset' })).toBeInTheDocument();
    expect(screen.getByText('Catalog browser')).toBeInTheDocument();
    expect(screen.getByText('Search & recommendations')).toBeInTheDocument();
    expect(screen.getByText('Usage & audit')).toBeInTheDocument();
    expect(screen.getByText('Runtime health')).toBeInTheDocument();
    expect(screen.getByText(/Persisted custom roots:/)).toHaveTextContent('D:\\work\\repos');
    expect(screen.getByTestId('catalog-write-target-copy')).toHaveTextContent('authoritative repo-local asset');
    expect(screen.getByTestId('catalog-runtime-freshness')).toHaveTextContent('fresh');
    expect(screen.getByTestId('catalog-observability-summary')).toHaveTextContent('Searched 5 · Selected 2 · Invoked 4');
    expect(screen.getByTestId('catalog-selected-asset-observability')).toHaveTextContent('Searched 3 · Selected 2 · Invoked 4');
    expect(screen.getAllByText(/Mixed evidence:/i).length).toBeGreaterThan(0);
    expect(screen.getByText('# Test skill')).toBeInTheDocument();
    expect(screen.getByText(/Privacy-safe selection telemetry/i)).toBeInTheDocument();
  });

  it('no longer renders the external source management panel in AssetsView', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    expect(screen.queryByTestId('catalog-external-sources-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Demo Source')).not.toBeInTheDocument();
  });

  it('saves custom scan roots through the workspace store', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    fireEvent.change(screen.getByTestId('catalog-custom-scan-roots-input'), {
      target: { value: 'D:\\work\\repos\nE:\\client\\repos' },
    });
    fireEvent.click(screen.getByTestId('catalog-save-custom-scan-roots'));

    await waitFor(() => {
      expect(storeMocks.saveCustomScanRoots).toHaveBeenCalledWith(['D:\\work\\repos', 'E:\\client\\repos']);
    });
  });

  it('dispatches bundle installation through the workspace store', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    fireEvent.click(screen.getByTestId('catalog-install-bundle-superpowers-workflow'));

    await waitFor(() => {
      expect(storeMocks.installBundle).toHaveBeenCalledWith('superpowers-workflow');
    });
  });

  it('surfaces bundle lifecycle metadata and dispatches bundle uninstall through the workspace store', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    expect(screen.getByTestId('catalog-bundle-lifecycle-superpowers-workflow')).toHaveTextContent('Partial member state');
    expect(screen.getByTestId('catalog-workflow-bundle-taxonomy-superpowers-workflow'))
      .toHaveTextContent('Classification: workflow · Targets: scope: repo · frameworks: react · tags: superpowers, workflow');
    expect(screen.getByTestId('catalog-workflow-bundle-uninstall-policy-superpowers-workflow'))
      .toHaveTextContent('removes managed members');
    expect(screen.getByTestId('catalog-selected-bundle-uninstall-policy'))
      .toHaveTextContent('preserves external packages');

    fireEvent.click(screen.getByTestId('catalog-uninstall-workflow-bundle-superpowers-workflow'));

    await waitFor(() => {
      expect(storeMocks.uninstallBundle).toHaveBeenCalledWith('superpowers-workflow');
    });
  });

  it('submits create and update actions through the workspace store', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    fireEvent.change(screen.getByTestId('catalog-create-asset-key-control'), {
      target: { value: 'new-skill' },
    });
    fireEvent.change(screen.getByTestId('catalog-create-target'), {
      target: { value: 'repo-local:C:\\repo' },
    });
    fireEvent.change(screen.getByTestId('catalog-create-content'), {
      target: { value: '## New skill' },
    });
    fireEvent.click(screen.getByTestId('catalog-create-submit'));

    await waitFor(() => {
      expect(storeMocks.createAsset).toHaveBeenCalledWith(expect.objectContaining({
        authoringScope: 'repo-local',
        kind: 'skill',
        assetKey: 'new-skill',
        content: '## New skill',
        repoPath: 'C:\\repo',
      }));
    });

    fireEvent.change(screen.getByTestId('catalog-edit-content'), {
      target: { value: '## Updated skill' },
    });
    fireEvent.click(screen.getByTestId('catalog-edit-save'));

    await waitFor(() => {
      expect(storeMocks.updateAsset).toHaveBeenCalledWith(expect.objectContaining({
        authoringScope: 'repo-local',
        kind: 'skill',
        assetKey: 'test',
        content: '## Updated skill',
        repoPath: 'C:\\repo',
        expectedHash: 'repo-hash',
      }));
    });
  });

  it('records search inspection telemetry through the workspace store', async () => {
    vi.doMock('../ui/src/tabs/Assets/catalogWorkspaceStore', () => ({
      catalogWorkspaceStore: mockCatalogWorkspaceStore,
      CATALOG_SEARCH_RESULT_LIMIT: 20,
      CATALOG_AUDIT_EVENT_LIMIT: 25,
    }));

    const { default: AssetsView } = await import('../ui/src/tabs/Assets/AssetsView');

    render(<AssetsView />);

    fireEvent.click(screen.getByTestId('catalog-search-inspect'));

    expect(storeMocks.inspectSearchResult).toHaveBeenCalledWith(expect.objectContaining({
      assetId: 'skill-test',
      rank: 1,
      score: 42,
    }));
  });
});
