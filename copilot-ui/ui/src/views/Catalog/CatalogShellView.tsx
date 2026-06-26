import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Toolbar } from '../../components';
import { getCatalogSummary } from '../../lib/api';
import { useStoreValue } from '../../lib/store';
import type {
  CatalogSnapshotEnvelope,
  CatalogGlobalItem,
  CatalogGlobalSection,
  CatalogGlobalHarnessState,
  CatalogExternalSourceProjection,
} from '../../lib/types';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';
import CatalogIcon, { type IconName } from './CatalogIcon';
import AssetsView from '../../tabs/Assets/AssetsView';
import InventoryTab from './InventoryTab';
import DiagnosticsTab from './DiagnosticsTab';
import OperationsTab from './OperationsTab';
import SourcesTab from './SourcesTab';
import HarnessTab from './HarnessTab';

/* ------------------------------------------------------------------ */
/*  Internal types                                                    */
/* ------------------------------------------------------------------ */

interface Metric {
  label: string;
  value: number | string;
  icon: IconName;
  sublabel?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function getGlobalSections(summary: CatalogSnapshotEnvelope | null): CatalogGlobalSection[] {
  return Array.isArray(summary?.globalInventory?.sections)
    ? summary.globalInventory.sections.filter((s): s is CatalogGlobalSection => Boolean(s?.kind))
    : [];
}

/* ------------------------------------------------------------------ */
/*  Metrics derivation                                                */
/* ------------------------------------------------------------------ */

function countPlugins(items: CatalogGlobalItem[]): number {
  return items.filter(
    (i) =>
      i.kind === 'plugin' ||
      i.kind === 'package' ||
      (i.kind !== 'agent' && i.kind !== 'skill' && i.kind !== 'hook' && i.kind !== 'mcp'),
  ).length;
}

function deriveMetrics(
  summary: CatalogSnapshotEnvelope | null,
): Metric[] {
  const sections = getGlobalSections(summary);
  const allItems = sections.flatMap((s) => s.items || []);
  const externalSources = summary?.externalSources || [];
  const harnesses = summary?.globalInventory?.harnesses || [];

  const externalToolCount =
    externalSources.reduce((sum, src) => sum + (src.installables?.length || 0), 0) +
    allItems.filter((i) => i.kind === 'mcp').length;

  return [
    {
      label: 'Agents',
      value: allItems.filter((i) => i.kind === 'agent').length,
      icon: 'agent',
    },
    {
      label: 'Skills',
      value: allItems.filter((i) => i.kind === 'skill').length,
      icon: 'skill',
    },
    {
      label: 'Hooks',
      value: allItems.filter((i) => i.kind === 'hook').length,
      icon: 'hook',
    },
    {
      label: 'Plugins',
      value: countPlugins(allItems),
      icon: 'plugin',
    },
    {
      label: 'External Tools',
      value: externalToolCount,
      icon: 'mcp',
    },
    {
      label: 'Harnesses synced',
      value: (() => {
        const syncedHarnessIds = new Set<string>();
        for (const section of sections) {
          for (const item of section.items || []) {
            for (const hs of item.harnessStates || []) {
              if (hs.installed || hs.active) {
                syncedHarnessIds.add(hs.harnessId);
              }
            }
          }
        }
        return syncedHarnessIds.size;
      })(),
      icon: 'sync',
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function CatalogShellView() {
  /* ---- local state ---- */
  const [summary, setSummary] = useState<CatalogSnapshotEnvelope | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'inventory' | 'quality' | 'operations' | 'sources' | 'codex' | 'opencode' | 'claude'>('inventory');

  const [showRepositoryAssets, setShowRepositoryAssets] = useState(false);

  /* ---- mounted guard ---- */
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* ---- store state ---- */
  const catalogState = useStoreValue(catalogWorkspaceStore);

  /* ---- summary loading ---- */
  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const data = await getCatalogSummary();
        if (!cancelled) {
          setSummary(data.summary ?? null);
        }
      } catch (err) {
        if (!cancelled) setSummaryError(toErrorMessage(err, 'Catalog summary unavailable'));
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    void loadSummary();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- derived data ---- */
  const allSections = useMemo(() => getGlobalSections(summary), [summary]);

  const externalSources = useMemo(
    () => (summary?.externalSources || []) as CatalogExternalSourceProjection[],
    [summary],
  );

  const metrics = useMemo(() => deriveMetrics(summary), [summary]);

  /* ---- handlers ---- */
  async function handleRefresh(): Promise<void> {
    if (!mountedRef.current) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await getCatalogSummary();
      if (!mountedRef.current) return;
      setSummary(data.summary ?? null);
    } catch (err) {
      if (!mountedRef.current) return;
      setSummaryError(toErrorMessage(err, 'Catalog summary unavailable'));
    } finally {
      if (!mountedRef.current) return;
      setSummaryLoading(false);
    }
  }



  async function handleItemAction(
    item: CatalogGlobalItem,
    harnessState: CatalogGlobalHarnessState,
  ): Promise<void> {
    const actionKind =
      (typeof harnessState.metadata?.actionKind === 'string'
        ? harnessState.metadata.actionKind
        : item.actions?.kind) ?? null;

    if (actionKind === 'external-source' && item.sourceId) {
      const installableId =
        (typeof harnessState.metadata?.installableId === 'string'
          ? harnessState.metadata.installableId
          : '') || '';
      if (!installableId) return;

      if (harnessState.actions?.canDeactivate && (harnessState.active || harnessState.installed)) {
        await catalogWorkspaceStore.deactivateExternalSourceInstallable({
          sourceId: item.sourceId,
          installableId,
          target: harnessState.harnessId,
        });
      } else if (harnessState.actions?.canActivate) {
        await catalogWorkspaceStore.activateExternalSourceInstallable({
          sourceId: item.sourceId,
          installableId,
          target: harnessState.harnessId,
        });
      }
      await handleRefresh();
      return;
    }

    if (actionKind === 'catalog-asset' && item.actions?.installAssetId && harnessState.harnessId === 'copilot') {
      await catalogWorkspaceStore.installAsset({ assetId: item.actions.installAssetId });
      await handleRefresh();
      return;
    }

    if (
      actionKind === 'install-surface' &&
      Array.isArray(item.actions?.installSurfaceTargets) &&
      item.actions.installSurfaceTargets.includes(harnessState.harnessId)
    ) {
      await catalogWorkspaceStore.installSurface(harnessState.harnessId as 'codex' | 'opencode' | 'antigravity' | 'claude');
      await handleRefresh();
    }
  }

  async function handleUninstall(
    item: CatalogGlobalItem,
    harnessState: CatalogGlobalHarnessState,
  ): Promise<void> {
    const assetId = (harnessState.metadata as Record<string, unknown> | null)?.installableId
      || (typeof item.itemId === 'string' ? item.itemId : '')
      || '';
    if (!assetId || !harnessState.harnessId) {
      console.warn('CatalogShellView: Cannot uninstall — missing assetId or harnessId', { itemId: item.itemId, harnessId: harnessState.harnessId });
      return;
    }

    await catalogWorkspaceStore.uninstallHarnessAsset(harnessState.harnessId, String(assetId));
    await handleRefresh();
  }

  /* ---- render helpers ---- */
  function renderMetricCard(m: Metric): React.ReactNode {
    return (
      <div
        className="assets-tools-metric-card catalog-stat-card"
        data-testid={`assets-tools-metric-${m.label}`}
        key={m.label}
      >
        <CatalogIcon name={m.icon} className="assets-tools-metric-icon" />
        <div>
          <p className="assets-tools-metric-label catalog-stat-label">{m.label}</p>
          <p className="assets-tools-metric-value catalog-stat-value">{String(m.value)}</p>
          {m.sublabel ? <p className="assets-tools-metric-sublabel">{m.sublabel}</p> : null}
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  Main render                                                     */
  /* ================================================================ */

  /* If we're showing the repository view, render AssetsView instead */
  if (showRepositoryAssets) {
    return (
      <div className="assets-tools-view" data-testid="catalog-shell-view">
        <div className="assets-tools-header">
          <h2>Assets &amp; Tools</h2>
          <div className="assets-tools-header-actions">
            <Button
              onClick={() => setShowRepositoryAssets(false)}
              testId="assets-tools-back-to-explorer"
              variant="ghost"
            >
              Back to Explorer
            </Button>
          </div>
        </div>
        <AssetsView />
      </div>
    );
  }

  const harnesses = summary?.globalInventory?.harnesses || [];

  return (
    <div className="view-shell assets-tools-view catalog-shell-view" data-testid="catalog-shell-view">
      {/* STICKY HEADER: toolbar + summary + state banners + tabs */}
      <div className="view-static catalog-shell-sticky-header" data-testid="catalog-shell-sticky-header">
        {/* HEADER with toolbar */}
        <Toolbar testId="catalog-shell-toolbar">
          <div className="assets-tools-header">
            <h2>Assets &amp; Tools</h2>
            <p>
              Explore, install, sync, and verify agents, skills, hooks, plugins, and
              external MCP tools.
            </p>
          </div>
          <div className="assets-tools-header-actions">
            <Button
              loading={summaryLoading && !!summary}
              disabled={catalogState.refreshing || (summaryLoading && !summary)}
              onClick={() => void handleRefresh()}
              testId="assets-tools-refresh"
              variant="ghost"
            >
              {summaryLoading && !summary ? 'Loading...' : summaryLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              loading={catalogState.installing}
              disabled={catalogState.installing || catalogState.refreshing || (summaryLoading && !summary)}
              onClick={() => { void catalogWorkspaceStore.installAll(false); }}
              testId="assets-tools-install-all"
              variant="primary"
            >
              {catalogState.installing ? 'Installing...' : 'Install All'}
            </Button>
            <Button
              loading={catalogState.installing}
              disabled={catalogState.installing || catalogState.refreshing || (summaryLoading && !summary)}
              onClick={() => { void catalogWorkspaceStore.installAll(true); }}
              testId="assets-tools-force-install"
              variant="ghost"
            >
              Force All
            </Button>

            {/* Repository Assets moved to Workspace area — see WorkspaceAssetsTab */}
          </div>
        </Toolbar>

        {/* SUMMARY */}
        <div className="catalog-shell-summary" data-testid="catalog-shell-summary">
          {summaryLoading && !summary ? (
            <span className="catalog-shell-summary-text state-message">
              Loading catalog summary…
            </span>
          ) : summary ? (
            <span className="catalog-shell-summary-text">
              {allSections
                .map((s) => `${s.count} ${s.title.toLowerCase()}`)
                .join(' · ')}
              {summaryLoading ? (
                <span className="state-message" style={{ marginLeft: '8px', opacity: 0.7, fontSize: '0.8rem', fontStyle: 'italic' }}>
                  Refreshing…
                </span>
              ) : null}
            </span>
          ) : summaryError ? (
            <span className="catalog-shell-summary-text state-error">
              {summaryError}
            </span>
          ) : (
            <span className="catalog-shell-summary-text state-error">
              Catalog summary unavailable
            </span>
          )}
        </div>

        {/* STATE BANNERS */}
        {catalogState.error ? (
          <p className="state-message state-error" role="alert">{catalogState.error}</p>
        ) : null}
        {catalogState.installMessage ? (
          <p className="state-message">{catalogState.installMessage}</p>
        ) : null}

        {/* ACTIONABLE CATALOG ERROR — visible when summary API fails (e.g. missing snapshot) */}
        {!summary && (summaryError || (!summaryLoading && !summary)) ? (
          <div
            className="catalog-actionable-error"
            data-testid="catalog-actionable-error"
            role="alert"
            style={{
              margin: '0 var(--space-md) var(--space-sm) var(--space-md)',
              padding: 'var(--space-sm) var(--space-md)',
              border: '1px solid var(--color-danger-500, #c0392b)',
              borderRadius: '6px',
              background: 'rgba(192, 57, 43, 0.08)',
              color: 'var(--color-danger-700, #7a2018)',
              fontSize: '0.85rem',
            }}
          >
            <strong style={{ display: 'block', marginBottom: 'var(--space-2xs)' }}>
              Catalog data could not be loaded
            </strong>
            <p style={{ margin: 0, marginBottom: 'var(--space-2xs)' }}>
              {summaryError ?? 'The catalog projection snapshot is unavailable.'}
            </p>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.85 }}>
              The snapshot is normally stored at{' '}
              <code style={{ background: 'rgba(0,0,0,0.05)', padding: '1px 4px', borderRadius: '3px' }}>
                ~/.elegy/catalog/projection/snapshot.json
              </code>{' '}
              and is rebuilt automatically. If it is missing or stale, try the{' '}
              <strong>Refresh</strong> button above, or open the <strong>Operations</strong> tab and trigger a catalog rebuild.
            </p>
          </div>
        ) : null}

        {/* TAB BAR */}
        <div className="assets-tools-chip-row" data-testid="assets-tools-tabs">
          {([
            { key: 'inventory' as const, label: 'Elegy Inventory' },
            { key: 'quality' as const, label: 'Diagnostics' },
            { key: 'operations' as const, label: 'Operations' },
            { key: 'sources' as const, label: 'External Inventory' },
            { key: 'codex' as const, label: 'Codex' },
            { key: 'opencode' as const, label: 'OpenCode' },
            { key: 'claude' as const, label: 'Claude' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              className={`assets-tools-chip catalog-chip ${activeTab === key ? 'active catalog-chip is-active' : ''}`}
              data-testid={`assets-tools-tab-${key}`}
              onClick={() => setActiveTab(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* SCROLLABLE CONTENT */}
      <div className="view-scroll catalog-shell-content" data-testid="catalog-shell-content">
        {/* METRIC STRIP - now inside scrollable content */}
        <div className="assets-tools-metrics" data-testid="assets-tools-metrics">
          {metrics.map(renderMetricCard)}
        </div>

        {/* TAB CONTENT */}
        {summaryLoading && !summary ? (
          <p className="assets-tools-empty state-message">Loading catalog summary&hellip;</p>
        ) : summaryError && !summary ? (
          <div
            className="assets-tools-empty state-error"
            data-testid="catalog-empty-state"
            style={{ padding: 'var(--space-lg)' }}
          >
            <p style={{ marginBottom: 'var(--space-xs)' }}>
              <strong>Catalog summary unavailable</strong>
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-ink-muted)' }}>
              {summaryError}
            </p>
            <button
              type="button"
              className="button button-secondary button-sm"
              onClick={() => void handleRefresh()}
              style={{ marginTop: 'var(--space-sm)' }}
            >
              Retry
            </button>
          </div>
        ) : !summary && !summaryError ? (
          <p className="assets-tools-empty state-error">Catalog summary unavailable</p>
        ) : (
          <>
            {activeTab === 'inventory' && (
              <div className="catalog-tab-panel">
                <InventoryTab
                  sections={allSections}
                  harnesses={harnesses}
                  onItemAction={(item, state) => void handleItemAction(item, state)}
                  onUninstall={(item, state) => void handleUninstall(item, state)}
                  mutating={catalogState.mutating}
                />
              </div>
            )}

            {activeTab === 'quality' && (
              <div className="catalog-tab-panel" data-testid="assets-tools-tab-diagnostics">
                <DiagnosticsTab />
              </div>
            )}

            {activeTab === 'operations' && (
              <div className="catalog-tab-panel" data-testid="assets-tools-tab-operations">
                <OperationsTab summary={summary} />
              </div>
            )}

            {activeTab === 'sources' && (
              <div className="catalog-tab-panel">
                <SourcesTab
                  externalSources={externalSources}
                  onSourceChanged={() => void handleRefresh()}
                />
              </div>
            )}

            {activeTab === 'codex' && (
              <div className="catalog-tab-panel">
                <HarnessTab
                  harnessId="codex"
                  sections={allSections}
                  harnesses={harnesses}
                  onItemAction={(item, state) => void handleItemAction(item, state)}
                  onUninstall={(item, state) => void handleUninstall(item, state)}
                  onRefresh={() => void handleRefresh()}
                  mutating={catalogState.mutating}
                />
              </div>
            )}

            {activeTab === 'opencode' && (
              <div className="catalog-tab-panel">
                <HarnessTab
                  harnessId="opencode"
                  sections={allSections}
                  harnesses={harnesses}
                  onItemAction={(item, state) => void handleItemAction(item, state)}
                  onUninstall={(item, state) => void handleUninstall(item, state)}
                  onRefresh={() => void handleRefresh()}
                  mutating={catalogState.mutating}
                />
              </div>
            )}

            {activeTab === 'claude' && (
              <div className="catalog-tab-panel">
                <HarnessTab
                  harnessId="claude-code"
                  sections={allSections}
                  harnesses={harnesses}
                  onItemAction={(item, state) => void handleItemAction(item, state)}
                  onUninstall={(item, state) => void handleUninstall(item, state)}
                  onRefresh={() => void handleRefresh()}
                  mutating={catalogState.mutating}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
