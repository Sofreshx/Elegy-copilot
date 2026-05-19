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
    body: 'Inspect the real global inventory for Copilot, Codex, OpenCode, Antigravity, and Gemini-backed catalog content.',
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
  if (!state.supported) {
    return 'Not supported';
  }
  if (state.active && state.installed) {
    return 'Installed';
  }
  if (state.installed) {
    return 'Installed';
  }
  return 'Not installed';
}

function getHarnessBadgeTone(state: CatalogGlobalHarnessState): 'success' | 'neutral' | 'accent' {
  if (!state.supported) {
    return 'neutral';
  }
  if (state.active || state.installed) {
    return 'success';
  }
  return 'accent';
}

function getActionLabel(item: CatalogGlobalItem, harnessState: CatalogGlobalHarnessState): string | null {
  const itemActions = item.actions;
  const harnessActions = harnessState.actions;
  if (!harnessActions || !itemActions) {
    return null;
  }
  if (harnessActions.canDeactivate && (harnessState.active || harnessState.installed) && itemActions.kind === 'external-source') {
    return 'Deactivate';
  }
  if (harnessActions.canActivate && itemActions.kind === 'external-source') {
    return harnessState.installed ? 'Reinstall' : 'Activate';
  }
  if (harnessActions.canInstall && itemActions.kind === 'catalog-asset') {
    return 'Install';
  }
  if (harnessActions.canInstall && itemActions.kind === 'install-surface') {
    return harnessState.installed ? 'Sync' : 'Install';
  }
  if (harnessActions.canSync && itemActions.kind === 'install-surface') {
    return 'Sync';
  }
  return null;
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

  async function handleItemAction(item: CatalogGlobalItem, harnessState: CatalogGlobalHarnessState): Promise<void> {
    const itemActions = item.actions;
    const harnessActions = harnessState.actions;
    if (!itemActions || !harnessActions) {
      return;
    }

    if (itemActions.kind === 'external-source' && item.sourceId) {
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
      const response = await getCatalogSummary();
      setSummary(response.summary ?? null);
      return;
    }

    if (itemActions.kind === 'catalog-asset' && itemActions.installAssetId && harnessState.harnessId === 'copilot') {
      await catalogWorkspaceStore.installAsset({ assetId: itemActions.installAssetId });
      const response = await getCatalogSummary();
      setSummary(response.summary ?? null);
      return;
    }

    if (itemActions.kind === 'install-surface' && Array.isArray(itemActions.installSurfaceTargets) && itemActions.installSurfaceTargets.includes(harnessState.harnessId)) {
      await catalogWorkspaceStore.installSurface(harnessState.harnessId as 'codex' | 'opencode' | 'antigravity');
      const response = await getCatalogSummary();
      setSummary(response.summary ?? null);
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
              <Button
                onClick={() => {
                  void (async () => {
                    setSummaryLoading(true);
                    try {
                      const response = await getCatalogSummary();
                      setSummary(response.summary ?? null);
                      setSummaryError(null);
                    } catch (error) {
                      setSummaryError(toErrorMessage(error, 'Unable to refresh the global catalog inventory.'));
                    } finally {
                      setSummaryLoading(false);
                    }
                  })();
                }}
                testId="catalog-global-refresh"
                variant="ghost"
              >
                {summaryLoading ? 'Refreshing...' : 'Refresh'}
              </Button>
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
                          <Badge tone="neutral">{section.title}</Badge>
                        </div>
                        <p className="catalog-global-description">{item.description || 'No description available.'}</p>
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
                              Open in Repository
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
