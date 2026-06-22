import { useMemo, useState } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import AssetGroupList from './AssetGroupList';
import AssetDetailModal from './AssetDetailModal';

interface InventoryTabProps {
  sections: CatalogGlobalSection[];
  harnesses: CatalogGlobalHarness[];
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  onUninstall?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
}

export default function InventoryTab({ sections, harnesses, onItemAction, onUninstall, mutating }: InventoryTabProps) {
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<string>('all');
  const [modalItem, setModalItem] = useState<CatalogGlobalItem | null>(null);

  /* Filtered sections (grouped by provenance) for AssetGroupList */
  const filteredSections = useMemo(
    () => {
      if (kindFilter === 'all' && scopeFilter === 'all') return sections;
      return sections.map((s) => ({
        ...s,
        items: (s.items || []).filter((i) => {
          if (kindFilter !== 'all' && i.kind !== kindFilter) return false;
          if (scopeFilter !== 'all') {
            const st = (i.sourceType || '').toLowerCase();
            if (scopeFilter === 'global' && st !== 'global') return false;
            if (scopeFilter === 'repo' && st !== 'repo') return false;
            if (scopeFilter === 'user' && st !== 'user') return false;
          }
          return true;
        }),
      }));
    },
    [sections, kindFilter, scopeFilter],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Filter bar — full width above the three-pane layout */}
      <div className="catalog-filter-grid" style={{ padding: '0 0 var(--space-sm) 0' }}>
        <div className="catalog-filter-groups" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
          <div className="catalog-filter-group">
            <span className="form-label">Kind</span>
            <div className="catalog-chip-row">
              {(['all', 'skill', 'agent', 'mcp', 'hook', 'plugin'] as const).map((kind) => (
                <button
                  aria-pressed={kindFilter === kind}
                  className={`catalog-chip ${kindFilter === kind ? 'is-active' : ''}`}
                  key={kind}
                  onClick={() => setKindFilter(kind)}
                  type="button"
                >
                  {kind === 'all' ? 'All' : kind}
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-filter-group">
            <span className="form-label">Scope</span>
            <div className="catalog-chip-row">
              {(['all', 'global', 'repo', 'user'] as const).map((scope) => (
                <button
                  aria-pressed={scopeFilter === scope}
                  className={`catalog-chip ${scopeFilter === scope ? 'is-active' : ''}`}
                  key={scope}
                  onClick={() => setScopeFilter(scope)}
                  type="button"
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width asset list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} data-testid="assets-tools-inventory">
        {filteredSections.length === 0 || filteredSections.every((s) => (s.items ?? []).length === 0) ? (
          <div className="assets-tools-empty" data-testid="inventory-empty" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-ink-muted)', marginBottom: 'var(--space-xs)' }}>
              No assets found in the catalog inventory.
            </p>
            <p style={{ color: 'var(--color-ink-muted)', fontSize: '0.85rem' }}>
              This usually means the catalog projection snapshot is empty or stale. Try the <strong>Refresh</strong> button above, or check that your agent source directories are accessible.
            </p>
          </div>
        ) : (
          <AssetGroupList
            sections={filteredSections}
            selectedItem={modalItem}
            onSelectItem={setModalItem}
            onItemAction={onItemAction}
            onUninstall={onUninstall}
            mutating={mutating}
          />
        )}
      </div>

      {/* Modal overlay */}
      {modalItem && (
        <AssetDetailModal
          item={modalItem}
          harnesses={harnesses}
          onClose={() => setModalItem(null)}
          onItemAction={onItemAction}
          onUninstall={onUninstall}
          mutating={mutating}
        />
      )}
    </div>
  );
}
