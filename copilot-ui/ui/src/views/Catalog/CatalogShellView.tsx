import { useEffect, useState } from 'react';
import { Badge, Toolbar } from '../../components';
import { getCatalogSummary } from '../../lib/api';
import { useStoreValue } from '../../lib/store';
import type { CatalogSnapshotEnvelope } from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import CatalogView from '../../tabs/Catalog/CatalogView';

function formatCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function summarizeCatalog(summary: CatalogSnapshotEnvelope): string {
  const globalSections = Array.isArray(summary.globalInventory?.sections) ? summary.globalInventory.sections : [];
  if (globalSections.length > 0) {
    const parts = globalSections.map((section) => `${formatCount(section.count)} ${String(section.title || section.kind || 'items').toLowerCase()}`);
    return parts.join(', ');
  }

  const stats = summary.stats || {};
  const effectiveCount = formatCount(stats.effectiveCount);
  const installedCount = formatCount(stats.installedCount);
  const byKind = stats.byKind && typeof stats.byKind === 'object'
    ? stats.byKind
    : {};
  const agentCount = formatCount(byKind.agent);
  const skillCount = formatCount(byKind.skill);

  return `${effectiveCount} effective assets, ${installedCount} installed, ${agentCount} agents, ${skillCount} skills`;
}

export default function CatalogShellView() {
  const navigationState = useStoreValue(navigationStore);
  const [searchQuery, setSearchQuery] = useState('');
  const [summary, setSummary] = useState<CatalogSnapshotEnvelope | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const data = await getCatalogSummary();
        if (!cancelled) {
          setSummary(data.summary ?? null);
          setSummaryError(false);
        }
      } catch {
        if (!cancelled) setSummaryError(true);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    void loadSummary();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="catalog-shell-view" data-testid="catalog-shell-view">
      <Toolbar testId="catalog-shell-toolbar">
        <div className="catalog-shell-title-group">
          <h2 className="catalog-shell-title">Catalog</h2>
          {navigationState.adminMode ? (
            <Badge tone="accent" testId="catalog-shell-admin-badge">Admin mode</Badge>
          ) : null}
        </div>

        <input
          type="text"
          className="catalog-shell-search"
          placeholder="Search catalog…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          data-testid="catalog-shell-search"
        />
      </Toolbar>

      <div className="catalog-shell-summary" data-testid="catalog-shell-summary">
        {summaryLoading ? (
          <span className="catalog-shell-summary-text">Loading catalog summary…</span>
        ) : summaryError || !summary ? (
          <span className="catalog-shell-summary-text">Catalog summary unavailable</span>
        ) : (
          <span className="catalog-shell-summary-text">
            {summarizeCatalog(summary)}
          </span>
        )}
      </div>

      <CatalogView />
    </div>
  );
}
