import { useEffect } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';

export default function AssetsMaintenancePanel() {
  const catalogState = useStoreValue(catalogWorkspaceStore);

  useEffect(() => {
    void catalogWorkspaceStore.loadWorkspace();
  }, []);

  const summaryStats = catalogState.summary?.stats;
  const installedCount = summaryStats?.installedCount ?? 0;
  const availableCount = (summaryStats?.byKind?.skill ?? 0) + (summaryStats?.byKind?.agent ?? 0);
  const effectiveCount = summaryStats?.effectiveCount ?? 0;

  return (
    <div className="maintenance-assets-panel" data-testid="maintenance-assets-panel">
      <Panel
        subtitle="Overview of managed assets across all harnesses."
        testId="maintenance-assets-summary"
        title="Asset Health"
      >
        <div className="catalog-summary-grid">
          <article className="catalog-stat-card">
            <p className="catalog-stat-label">Installed</p>
            <p className="catalog-stat-value">{installedCount}</p>
            <p className="catalog-stat-copy">Assets active on disk</p>
          </article>
          <article className="catalog-stat-card">
            <p className="catalog-stat-label">Available</p>
            <p className="catalog-stat-value">{availableCount}</p>
            <p className="catalog-stat-copy">Skills + Agents in catalog</p>
          </article>
          <article className="catalog-stat-card">
            <p className="catalog-stat-label">Effective</p>
            <p className="catalog-stat-value">{effectiveCount}</p>
            <p className="catalog-stat-copy">After overlays + scopes</p>
          </article>
        </div>
      </Panel>

      <Panel
        subtitle="Quick actions for managing the full asset surface."
        testId="maintenance-assets-actions"
        title="Bulk Operations"
      >
        <div className="catalog-action-row" style={{ flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <Button
            loading={catalogState.installing}
            disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
            onClick={() => { void catalogWorkspaceStore.installAll(false); }}
            testId="maintenance-install-all"
            variant="primary"
          >
            {catalogState.installing ? 'Installing...' : 'Install Everything'}
          </Button>
          <Button
            loading={catalogState.installing}
            disabled={catalogState.loading || catalogState.installing || catalogState.refreshing}
            onClick={() => { void catalogWorkspaceStore.installAll(true); }}
            testId="maintenance-force-install"
            variant="secondary"
          >
            Force Reinstall All
          </Button>
          <Button
            loading={catalogState.refreshing}
            disabled={catalogState.loading || catalogState.refreshing}
            onClick={() => { void catalogWorkspaceStore.refreshWorkspace(); }}
            testId="maintenance-refresh-all"
            variant="ghost"
          >
            Refresh Projection
          </Button>
        </div>

        {catalogState.error ? (
          <p className="state-message state-error" role="alert" style={{ marginTop: 'var(--space-sm)' }}>
            {catalogState.error}
          </p>
        ) : null}
        {catalogState.installMessage ? (
          <p className="state-message" style={{ marginTop: 'var(--space-sm)' }}>
            {catalogState.installMessage}
          </p>
        ) : null}
        {catalogState.lastInstallResults && catalogState.lastInstallResults.length > 0 ? (
          <div className="catalog-install-summary" data-testid="maintenance-install-results" style={{ marginTop: 'var(--space-sm)' }}>
            {catalogState.lastInstallResults.map((r, i) => (
              <span key={i} className="catalog-inline-stat">
                {r.target}: {r.total} assets ({r.created} new, {r.updated} updated
                {r.skipped + r.skippedConflict > 0 ? `, ${r.skipped + r.skippedConflict} skipped` : ''})
              </span>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
