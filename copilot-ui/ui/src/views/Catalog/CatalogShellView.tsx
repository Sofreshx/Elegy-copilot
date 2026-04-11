import { useEffect, useState } from 'react';
import { Badge, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import CatalogView from '../../tabs/Catalog/CatalogView';

interface CatalogSummary {
  totalBundles: number;
  totalAssets: number;
  agentCount: number;
  skillCount: number;
}

export default function CatalogShellView() {
  const navigationState = useStoreValue(navigationStore);
  const [searchQuery, setSearchQuery] = useState('');
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      try {
        const res = await fetch('/api/catalog/summary');
        if (!res.ok) throw new Error('Failed to fetch catalog summary');
        const data: CatalogSummary = await res.json();
        if (!cancelled) {
          setSummary(data);
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
            {summary.totalAssets} installed assets, {summary.agentCount} agents, {summary.skillCount} skills
          </span>
        )}
      </div>

      <CatalogView />
    </div>
  );
}
