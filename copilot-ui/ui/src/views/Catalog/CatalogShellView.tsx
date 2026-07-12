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
import InventoryTab from './InventoryTab';
import DiagnosticsTab from './DiagnosticsTab';
import OperationsTab from './OperationsTab';
import SourcesTab from './SourcesTab';

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

function harnessNeedsAttention(state: CatalogGlobalHarnessState): boolean {
  if (state.supported === false || state.syncStatus === 'unsupported') return false;
  const status = state.syncStatus || state.state || '';
  if (status === 'missing' || status === 'not-installed') return state.expected !== false;
  return ['stale', 'conflict', 'unmanaged', 'error', 'failed'].includes(status);
}

function itemNeedsAttention(item: CatalogGlobalItem): boolean {
  return (item.harnessStates || []).some(harnessNeedsAttention);
}

function deriveMetrics(
  summary: CatalogSnapshotEnvelope | null,
): Metric[] {
  const sections = getGlobalSections(summary);
  const allItems = sections.flatMap((s) => s.items || []);
  const externalSources = summary?.externalSources || [];
  const harnesses = summary?.globalInventory?.harnesses || [];

  const needsAttention = allItems.filter(itemNeedsAttention).length;
  const healthy = allItems.filter((item) => (
    !itemNeedsAttention(item)
    && (item.harnessStates || []).some((state) => state.installed || state.active)
  )).length;
  const notInstalled = allItems.filter((item) => (
    !itemNeedsAttention(item)
    && (item.harnessStates || []).some((state) => state.supported !== false)
    && !(item.harnessStates || []).some((state) => state.installed || state.active)
  )).length;
  const external = externalSources.reduce((sum, src) => sum + (src.installables?.length || 0), 0)
    + allItems.filter((item) => item.sourceType === 'external-source').length;

  return [
    { label: 'Needs attention', value: needsAttention, icon: 'hook', sublabel: needsAttention ? 'Repairable drift or missing targets' : 'No known issues' },
    { label: 'Healthy', value: healthy, icon: 'sync', sublabel: 'Installed or active as expected' },
    { label: 'Not installed', value: notInstalled, icon: 'skill', sublabel: 'Available without an active issue' },
    { label: 'External', value: external, icon: 'mcp', sublabel: 'Resources from configured sources' },
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

  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'quality' | 'operations' | 'sources'>('inventory');

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
  const attentionSections = useMemo(() => allSections.map((section) => ({
    ...section,
    items: (section.items || []).filter(itemNeedsAttention),
  })), [allSections]);
  const issueCount = metrics.find((metric) => metric.label === 'Needs attention')?.value || 0;

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
              Understand, verify, and repair Elegy-managed resources across every harness.
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
              onClick={() => { void catalogWorkspaceStore.installAll(false); }}
              testId="assets-tools-repair-issues"
              variant="primary"
              disabled={catalogState.installing || catalogState.refreshing || (summaryLoading && !summary) || Number(issueCount) === 0}
            >
              {catalogState.installing ? 'Repairing...' : `Repair ${issueCount} issue${Number(issueCount) === 1 ? '' : 's'}`}
            </Button>
            <details className="catalog-more-actions">
              <summary>More</summary>
              <Button
                disabled={catalogState.installing || catalogState.refreshing || (summaryLoading && !summary)}
                onClick={() => {
                  if (window.confirm('Force reinstall every managed asset across supported targets? Healthy targets may be overwritten.')) {
                    void catalogWorkspaceStore.installAll(true);
                  }
                }}
                testId="assets-tools-force-install"
                variant="ghost"
              >Force reinstall all…</Button>
            </details>

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
            { key: 'overview' as const, label: 'Overview' },
            { key: 'inventory' as const, label: 'Inventory' },
            { key: 'sources' as const, label: 'External Sources' },
            { key: 'operations' as const, label: 'Operations' },
            { key: 'quality' as const, label: 'Diagnostics' },
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
            {activeTab === 'overview' && (
              <div className="catalog-tab-panel" data-testid="assets-tools-overview">
                <div className="catalog-section-intro">
                  <h3>{Number(issueCount) > 0 ? 'Resources needing attention' : 'All managed resources are healthy'}</h3>
                  <p>{Number(issueCount) > 0 ? 'Review desired-versus-actual target state before repairing.' : 'No actionable drift or missing expected targets was reported.'}</p>
                </div>
                {Number(issueCount) > 0 ? <InventoryTab sections={attentionSections} harnesses={harnesses} onItemAction={(item, state) => void handleItemAction(item, state)} onUninstall={(item, state) => void handleUninstall(item, state)} mutating={catalogState.mutating} /> : null}
              </div>
            )}
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

          </>
        )}
      </div>
    </div>
  );
}
