import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Panel, Toolbar } from '../../components';
import { getCatalogContent, getCatalogSummary } from '../../lib/api';
import { useStoreValue } from '../../lib/store';
import type {
  CatalogGlobalHarnessState,
  CatalogGlobalItem,
  CatalogGlobalSection,
  CatalogSnapshotEnvelope,
} from '../../lib/types';
import { navigationStore, type CatalogSectionId } from '../../stores/navigation';
import { catalogWorkspaceStore } from '../Assets/catalogWorkspaceStore';
import AssetsView from '../Assets/AssetsView';
import './catalog.css';

const SECTION_COPY: Record<CatalogSectionId, { title: string; body: string }> = {
  global: {
    title: 'Global',
    body: 'Inspect the real global inventory for Copilot, Codex, OpenCode, Antigravity, and Antigravity CLI-compatible catalog content.',
  },
  repository: {
    title: 'Per Repository',
    body: 'Manage repo-scoped assets, bundle activation, repo registration, and authoring through the existing workspace flows.',
  },
};

interface GlobalDetailState {
  itemId: string | null;
  loading: boolean;
  error: string | null;
  content: string;
  label: string;
}

const INITIAL_DETAIL_STATE: GlobalDetailState = {
  itemId: null,
  loading: false,
  error: null,
  content: '(select Details to inspect item content)',
  label: 'No item selected',
};

const INSTALL_SURFACE_TARGETS = ['codex', 'opencode', 'antigravity'] as const;

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getGlobalInventory(summary: CatalogSnapshotEnvelope | null): CatalogGlobalSection[] {
  return Array.isArray(summary?.globalInventory?.sections)
    ? summary.globalInventory.sections.filter((section): section is CatalogGlobalSection => Boolean(section?.kind))
    : [];
}

function getHarnessStateLabel(state: CatalogGlobalHarnessState): string {
  switch (state.syncStatus) {
    case 'missing':
      return 'Missing';
    case 'synced':
      return 'Synced';
    case 'active':
      return 'Active';
    case 'installed':
      return 'Installed';
    case 'unsupported':
      return 'Not supported';
    default:
      return state.expected ? 'Pending' : 'Available';
  }
}

function getHarnessBadgeTone(state: CatalogGlobalHarnessState): 'success' | 'neutral' | 'accent' | 'danger' {
  switch (state.syncStatus) {
    case 'missing':
      return 'danger';
    case 'synced':
    case 'active':
    case 'installed':
      return 'success';
    case 'unsupported':
      return 'neutral';
    default:
      return 'accent';
  }
}

function getActionLabel(item: CatalogGlobalItem, harnessState: CatalogGlobalHarnessState): string | null {
  const harnessActions = harnessState.actions;
  const actionKind = typeof harnessState.metadata?.actionKind === 'string'
    ? harnessState.metadata.actionKind
    : item.actions?.kind;
  const installSurfaceTargets = Array.isArray(item.actions?.installSurfaceTargets)
    ? item.actions.installSurfaceTargets
    : [];
  if (!harnessActions || !actionKind) {
    return null;
  }
  if (harnessActions.canDeactivate && (harnessState.active || harnessState.installed) && actionKind === 'external-source') {
    return 'Disable';
  }
  if (harnessActions.canActivate && actionKind === 'external-source') {
    return harnessState.installed ? 'Repair source' : 'Enable source';
  }
  if (harnessActions.canInstall && actionKind === 'catalog-asset') {
    return 'Install';
  }
  if (harnessActions.canInstall && actionKind === 'install-surface') {
    return harnessState.syncStatus === 'missing' || harnessState.installed ? 'Sync harness' : 'Install harness';
  }
  if (harnessActions.canSync && actionKind === 'install-surface' && installSurfaceTargets.includes(harnessState.harnessId)) {
    return 'Sync harness';
  }
  return null;
}

function getHarnessTagLabel(state: CatalogGlobalHarnessState): string {
  if (state.expected) {
    return `${state.title} ${state.syncStatus === 'missing' ? 'missing' : 'ready'}`;
  }
  if (state.installed) {
    return `${state.title} installed`;
  }
  return `${state.title} available`;
}

function getItemScopeLabel(item: CatalogGlobalItem): string | null {
  const scopeKinds = Array.isArray(item.scopeKinds) ? item.scopeKinds.filter(Boolean) : [];
  if (scopeKinds.length === 0) {
    return null;
  }
  return scopeKinds.join(' + ');
}

function getSyncWarningText(item: CatalogGlobalItem): string | null {
  if (!item.missingHarnessCount) {
    return null;
  }
  const missingTargets = (item.harnessStates || [])
    .filter((state) => state.syncStatus === 'missing')
    .map((state) => state.title);
  if (missingTargets.length === 0) {
    return null;
  }
  return `Expected on ${missingTargets.join(', ')} but not currently installed.`;
}

function resolveContentRequest(item: CatalogGlobalItem): { mode: 'absolute' | 'engine' | 'external-source'; path: string; sourceId?: string } | null {
  const detail = item.detail && typeof item.detail === 'object' ? item.detail : null;
  const readPath = typeof item.readPath === 'string' && item.readPath.trim()
    ? item.readPath.trim()
    : typeof detail?.readPath === 'string' && detail.readPath.trim()
      ? detail.readPath.trim()
      : '';
  if (!readPath) {
    return null;
  }

  if (item.sourceType === 'external-source') {
    return {
      mode: 'external-source',
      path: readPath,
      sourceId: typeof item.sourceId === 'string' ? item.sourceId : undefined,
    };
  }

  if (item.sourceType === 'harness-manifest') {
    return {
      mode: 'engine',
      path: readPath,
    };
  }

  return {
    mode: 'absolute',
    path: readPath,
  };
}

function getDetailLabel(item: CatalogGlobalItem): string {
  if (item.sourceType === 'external-source') {
    return `Source detail · ${item.title}`;
  }
  if (item.sourceType === 'harness-manifest') {
    return `Shipped detail · ${item.title}`;
  }
  return `Catalog detail · ${item.title}`;
}

function getSectionSummary(summary: CatalogSnapshotEnvelope | null): string {
  const sections = getGlobalInventory(summary);
  return sections.map((section) => `${section.count} ${section.title.toLowerCase()}`).join(' · ');
}

export default function CatalogView() {
  const navigationState = useStoreValue(navigationStore);
  const activeSection = navigationState.catalogSectionId;
  const sectionCopy = SECTION_COPY[activeSection];
  const catalogState = useStoreValue(catalogWorkspaceStore);
  const [summary, setSummary] = useState<CatalogSnapshotEnvelope | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<GlobalDetailState>(INITIAL_DETAIL_STATE);

  useEffect(() => {
    if (activeSection !== 'global') {
      return;
    }
    let cancelled = false;

    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const response = await getCatalogSummary();
        if (!cancelled) {
          setSummary(response.summary ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setSummaryError(toErrorMessage(error, 'Unable to load the global catalog inventory.'));
        }
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, [activeSection, catalogState.summary?.generatedAt]);

  const globalSections = useMemo(() => getGlobalInventory(summary), [summary]);
  const globalItems = useMemo(
    () => globalSections.flatMap((section) => section.items || []),
    [globalSections]
  );

  async function refreshSummary(errorMessage: string): Promise<void> {
    setSummaryLoading(true);
    try {
      const response = await getCatalogSummary();
      setSummary(response.summary ?? null);
      setSummaryError(null);
    } catch (error) {
      setSummaryError(toErrorMessage(error, errorMessage));
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleSyncAllHarnesses(): Promise<void> {
    await catalogWorkspaceStore.installSurface('all', false);
    await refreshSummary('Unable to sync all harnesses.');
  }

  async function handleItemAction(item: CatalogGlobalItem, harnessState: CatalogGlobalHarnessState): Promise<void> {
    const harnessActions = harnessState.actions;
    const actionKind = typeof harnessState.metadata?.actionKind === 'string'
      ? harnessState.metadata.actionKind
      : item.actions?.kind;
    if (!harnessActions || !actionKind) {
      return;
    }

    if (actionKind === 'external-source' && item.sourceId) {
      const installableId = typeof harnessState.metadata?.installableId === 'string'
        ? harnessState.metadata.installableId
        : typeof item.detail === 'object' && item.detail && 'installableId' in item.detail && typeof item.detail.installableId === 'string'
          ? item.detail.installableId
          : '';
      if (!installableId) {
        return;
      }
      if (harnessActions.canDeactivate && (harnessState.active || harnessState.installed)) {
        await catalogWorkspaceStore.deactivateExternalSourceInstallable({
          sourceId: item.sourceId,
          installableId,
          target: harnessState.harnessId,
        });
      } else if (harnessActions.canActivate) {
        await catalogWorkspaceStore.activateExternalSourceInstallable({
          sourceId: item.sourceId,
          installableId,
          target: harnessState.harnessId,
        });
      }
      await refreshSummary('Unable to refresh the global catalog inventory.');
      return;
    }

    if (actionKind === 'catalog-asset' && item.actions?.installAssetId && harnessState.harnessId === 'copilot') {
      await catalogWorkspaceStore.installAsset({ assetId: item.actions.installAssetId });
      await refreshSummary('Unable to refresh the global catalog inventory.');
      return;
    }

    if (actionKind === 'install-surface' && Array.isArray(item.actions?.installSurfaceTargets) && item.actions.installSurfaceTargets.includes(harnessState.harnessId)) {
      await catalogWorkspaceStore.installSurface(harnessState.harnessId as 'codex' | 'opencode' | 'antigravity');
      await refreshSummary('Unable to refresh the global catalog inventory.');
    }
  }

  async function handleOpenDetails(item: CatalogGlobalItem): Promise<void> {
    const request = resolveContentRequest(item);
    if (!request) {
      setDetailState({
        itemId: item.itemId,
        loading: false,
        error: 'No readable detail path is available for this item.',
        content: 'No readable detail path is available for this item.',
        label: getDetailLabel(item),
      });
      return;
    }

    setDetailState({
      itemId: item.itemId,
      loading: true,
      error: null,
      content: `(loading ${item.title}...)`,
      label: getDetailLabel(item),
    });

    try {
      const content = await getCatalogContent(request);
      setDetailState({
        itemId: item.itemId,
        loading: false,
        error: null,
        content: content || '(empty content)',
        label: getDetailLabel(item),
      });
    } catch (error) {
      setDetailState({
        itemId: item.itemId,
        loading: false,
        error: toErrorMessage(error, 'Unable to load item details.'),
        content: `Unable to load item details: ${toErrorMessage(error, 'unknown error')}`,
        label: getDetailLabel(item),
      });
    }
  }

  return (
    <section className="workspace-stack catalog-hub-view" data-testid="catalog-hub-view">
      <Toolbar testId="catalog-hub-toolbar">
        <div className="workspace-nav-summary">
          <p className="workspace-nav-title">Catalog</p>
          <p className="workspace-nav-copy">{sectionCopy.body}</p>
        </div>

        <div className="workspace-nav" role="tablist" aria-label="Catalog workspaces">
          <Button
            onClick={() => navigationStore.setCatalogSectionId('global')}
            testId="catalog-section-global"
            variant={activeSection === 'global' ? 'primary' : 'ghost'}
          >
            Global
          </Button>
          <Button
            onClick={() => navigationStore.setCatalogSectionId('repository')}
            testId="catalog-section-repository"
            variant={activeSection === 'repository' ? 'primary' : 'ghost'}
          >
            Per repository
          </Button>
        </div>
      </Toolbar>

      <p className="workspace-section-label">{sectionCopy.title}</p>

      {activeSection === 'repository' ? <AssetsView /> : null}

      {activeSection === 'global' ? (
        <div className="catalog-global-view" data-testid="catalog-global-view">
          <Panel
            testId="catalog-global-summary-panel"
            title="Harness inventory"
            subtitle={summary ? getSectionSummary(summary) : 'Global catalog inventory'}
            actions={
              <>
                <Button
                  disabled={catalogState.installing || catalogState.refreshing || summaryLoading}
                  onClick={() => {
                    void handleSyncAllHarnesses();
                  }}
                  testId="catalog-global-sync-all"
                  variant="secondary"
                >
                  {catalogState.installing ? 'Syncing...' : 'Sync all harnesses'}
                </Button>
                <Button
                  onClick={() => {
                    void refreshSummary('Unable to refresh the global catalog inventory.');
                  }}
                  testId="catalog-global-refresh"
                  variant="ghost"
                >
                  {summaryLoading ? 'Refreshing...' : 'Refresh'}
                </Button>
              </>
            }
          >
            {summaryError ? <p className="catalog-global-error">{summaryError}</p> : null}
            <div className="catalog-global-harness-grid">
              {(summary?.globalInventory?.harnesses || []).map((harness) => (
                <div className="catalog-global-harness-card" data-testid={`catalog-global-harness-${harness.harnessId}`} key={harness.harnessId}>
                  <div className="catalog-global-card-header">
                    <h4>{harness.title}</h4>
                    <Badge tone="accent">{harness.harnessId}</Badge>
                  </div>
                  <p className="catalog-global-path">{harness.homePath || '(home unavailable)'}</p>
                  {harness.skillsHomePath ? <p className="catalog-global-path">Skills: {harness.skillsHomePath}</p> : null}
                </div>
              ))}
            </div>
          </Panel>

          <div className="catalog-global-layout">
            <div className="catalog-global-sections">
              {globalSections.map((section) => (
                <Panel
                  key={section.kind}
                  testId={`catalog-global-section-${section.kind}`}
                  title={section.title}
                  subtitle={`${section.count} item${section.count === 1 ? '' : 's'}`}
                >
                  <div className="catalog-global-item-list">
                    {section.items.map((item) => (
                      <article className="catalog-global-item-card" data-testid={`catalog-global-item-${item.itemId}`} key={item.itemId}>
                        <div className="catalog-global-card-header">
                          <div>
                            <h4>{item.title}</h4>
                            <p className="catalog-global-subtitle">
                              {item.itemKey}
                              {item.sourceId ? ` · ${item.sourceId}` : ''}
                              {item.providerId ? ` · ${item.providerId}` : ''}
                            </p>
                          </div>
                          <div className="catalog-global-badge-stack">
                            <Badge tone="neutral">{section.title}</Badge>
                            {item.central ? <Badge tone="accent">Central</Badge> : null}
                            {item.keyFeature ? <Badge tone="success">{item.keyFeatureLabel || 'Key skill'}</Badge> : null}
                            {getItemScopeLabel(item) ? <Badge tone="neutral">{getItemScopeLabel(item)}</Badge> : null}
                          </div>
                        </div>
                        <p className="catalog-global-description">{item.description || 'No description available.'}</p>
                        <div className="catalog-global-tag-row">
                          {(item.harnessStates || []).map((harnessState) => (
                            <span
                              className={`catalog-global-harness-pill sync-${harnessState.syncStatus || 'available'}`}
                              data-testid={`catalog-global-pill-${item.itemId}-${harnessState.harnessId}`}
                              key={`${item.itemId}-pill-${harnessState.harnessId}`}
                            >
                              {getHarnessTagLabel(harnessState)}
                            </span>
                          ))}
                        </div>
                        {getSyncWarningText(item) ? (
                          <div className="catalog-global-warning-banner" data-testid={`catalog-global-warning-${item.itemId}`}>
                            <p>{getSyncWarningText(item)}</p>
                            {item.harnessStates?.some((state) => state.syncStatus === 'missing' && getActionLabel(item, state)) ? (
                              <div className="catalog-global-warning-actions">
                                {(item.harnessStates || [])
                                  .filter((state) => state.syncStatus === 'missing')
                                  .map((state) => {
                                    const actionLabel = getActionLabel(item, state);
                                    if (!actionLabel) {
                                      return null;
                                    }
                                    return (
                                      <Button
                                        key={`${item.itemId}-warning-${state.harnessId}`}
                                        onClick={() => {
                                          void handleItemAction(item, state);
                                        }}
                                        size="sm"
                                        testId={`catalog-global-warning-action-${item.itemId}-${state.harnessId}`}
                                        variant="ghost"
                                      >
                                        Sync {state.title}
                                      </Button>
                                    );
                                  })}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        <div className="catalog-global-harness-state-list">
                          {(item.harnessStates || []).map((harnessState) => {
                            const actionLabel = getActionLabel(item, harnessState);
                            return (
                              <div className="catalog-global-harness-state" key={`${item.itemId}-${harnessState.harnessId}`}>
                                <div>
                                  <p className="catalog-global-harness-name">{harnessState.title}</p>
                                  <Badge tone={getHarnessBadgeTone(harnessState)}>{getHarnessStateLabel(harnessState)}</Badge>
                                  {harnessState.installPath ? <p className="catalog-global-path">{harnessState.installPath}</p> : null}
                                </div>
                                {actionLabel ? (
                                  <Button
                                    onClick={() => {
                                      void handleItemAction(item, harnessState);
                                    }}
                                    testId={`catalog-global-action-${item.itemId}-${harnessState.harnessId}`}
                                    variant="secondary"
                                  >
                                    {actionLabel}
                                  </Button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        <div className="catalog-global-item-actions">
                          <Button
                            onClick={() => {
                              void handleOpenDetails(item);
                            }}
                            testId={`catalog-global-details-${item.itemId}`}
                            variant="ghost"
                          >
                            Details
                          </Button>
                          {item.actions?.kind === 'catalog-asset' && item.actions.installAssetId ? (
                            <Button
                              onClick={() => {
                                void (async () => {
                                  await catalogWorkspaceStore.selectAsset(item.actions?.installAssetId || item.itemId);
                                  navigationStore.setCatalogSectionId('repository');
                                })();
                              }}
                            testId={`catalog-global-open-repository-${item.itemId}`}
                            variant="ghost"
                          >
                            Open repo asset
                          </Button>
                        ) : null}
                      </div>
                      </article>
                    ))}
                  </div>
                </Panel>
              ))}
            </div>

            <Panel testId="catalog-global-detail-panel" title="Detail" subtitle={detailState.label}>
              {detailState.error ? <p className="catalog-global-error">{detailState.error}</p> : null}
              <pre className="catalog-global-detail-content">{detailState.content}</pre>
            </Panel>
          </div>
        </div>
      ) : null}
    </section>
  );
}
