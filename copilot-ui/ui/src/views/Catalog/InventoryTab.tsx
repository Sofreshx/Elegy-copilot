import { useMemo, useState } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import AssetGroupList from './AssetGroupList';
import AssetDetailModal from './AssetDetailModal';
import { getManagementMetadata } from './harnessStateHelper';

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
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [harnessFilter, setHarnessFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [modalItem, setModalItem] = useState<CatalogGlobalItem | null>(null);

  /* Filtered sections (grouped by management owner) for AssetGroupList */
  const filteredSections = useMemo(
    () => {
      const normalizedQuery = query.trim().toLowerCase();
      const hasStateFilters = harnessFilter !== 'all'
        || ownerFilter !== 'all'
        || scopeFilter !== 'all'
        || statusFilter !== 'all';
      return sections.map((s) => ({
        ...s,
        items: (s.items || []).filter((i) => {
          if (kindFilter !== 'all' && i.kind !== kindFilter) return false;
          if (normalizedQuery && !`${i.title} ${i.description || ''} ${i.sourceId || ''}`.toLowerCase().includes(normalizedQuery)) return false;
          const states = (i.harnessStates || []).filter((state) => {
            const management = getManagementMetadata(state);
            if (harnessFilter !== 'all' && state.harnessId !== harnessFilter) return false;
            if (ownerFilter !== 'all' && management.owner !== ownerFilter) return false;
            if (scopeFilter !== 'all' && management.scope !== scopeFilter) return false;
            if (statusFilter !== 'all') {
              const stateValue = String(state.state || state.syncStatus || '').toLowerCase();
              const actionable = Object.values(state.actions || {}).some(Boolean);
              if (statusFilter === 'attention' && (management.readOnly || !actionable || !['missing', 'not-installed', 'stale', 'conflict', 'unmanaged'].includes(stateValue))) return false;
              if (statusFilter === 'installed' && !['installed', 'synced', 'active'].includes(stateValue)) return false;
              if (statusFilter === 'available' && !['available', 'not-installed', 'missing'].includes(stateValue)) return false;
              if (statusFilter === 'readonly' && management.readOnly !== true) return false;
            }
            return true;
          });
          if (hasStateFilters) {
            return states.length > 0;
          }
          return true;
        }),
      })).map((section) => ({
        ...section,
        items: section.items.map((item) => {
          if (!hasStateFilters) return item;
          const states = (item.harnessStates || []).filter((state) => {
            const management = getManagementMetadata(state);
            if (harnessFilter !== 'all' && state.harnessId !== harnessFilter) return false;
            if (ownerFilter !== 'all' && management.owner !== ownerFilter) return false;
            if (scopeFilter !== 'all' && management.scope !== scopeFilter) return false;
            if (statusFilter === 'readonly') return management.readOnly === true;
            if (statusFilter === 'attention') {
              const actionable = Object.values(state.actions || {}).some(Boolean);
              return !management.readOnly
                && actionable
                && ['missing', 'not-installed', 'stale', 'conflict', 'unmanaged'].includes(String(state.state || state.syncStatus || '').toLowerCase());
            }
            if (statusFilter === 'installed') return ['installed', 'synced', 'active'].includes(String(state.state || state.syncStatus || '').toLowerCase());
            if (statusFilter === 'available') return ['available', 'not-installed', 'missing'].includes(String(state.state || state.syncStatus || '').toLowerCase());
            return true;
          });
          return { ...item, harnessStates: states };
        }),
      }));
    },
    [sections, kindFilter, scopeFilter, ownerFilter, harnessFilter, statusFilter, query],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* Filter bar — full width above the three-pane layout */}
      <div className="catalog-filter-grid" style={{ padding: '0 0 var(--space-sm) 0' }}>
        <div className="catalog-filter-groups" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' }}>
          <label className="catalog-filter-group">
            <span className="form-label">Search assets</span>
            <input
              className="form-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, source, or description"
              aria-label="Search assets"
            />
          </label>
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
              {(['all', 'global', 'repo', 'user', 'external'] as const).map((scope) => (
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
          <div className="catalog-filter-group">
            <span className="form-label">Owner</span>
            <div className="catalog-chip-row">
              {(['all', 'elegy', 'harness', 'repository', 'external'] as const).map((owner) => (
                <button
                  aria-pressed={ownerFilter === owner}
                  className={`catalog-chip ${ownerFilter === owner ? 'is-active' : ''}`}
                  key={owner}
                  onClick={() => setOwnerFilter(owner)}
                  type="button"
                >
                  {owner === 'all' ? 'All' : owner === 'elegy' ? 'Elegy' : owner}
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-filter-group">
            <span className="form-label">Harness</span>
            <div className="catalog-chip-row">
              {(['all', ...harnesses.map((harness) => harness.harnessId)] as const).map((harnessId) => (
                <button
                  aria-pressed={harnessFilter === harnessId}
                  className={`catalog-chip ${harnessFilter === harnessId ? 'is-active' : ''}`}
                  key={harnessId}
                  onClick={() => setHarnessFilter(harnessId)}
                  type="button"
                >
                  {harnessId === 'all' ? 'All' : harnesses.find((harness) => harness.harnessId === harnessId)?.title || harnessId}
                </button>
              ))}
            </div>
          </div>
          <div className="catalog-filter-group">
            <span className="form-label">Status</span>
            <div className="catalog-chip-row">
              {(['all', 'installed', 'available', 'attention', 'readonly'] as const).map((status) => (
                <button
                  aria-pressed={statusFilter === status}
                  className={`catalog-chip ${statusFilter === status ? 'is-active' : ''}`}
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  type="button"
                >
                  {status === 'all' ? 'All' : status === 'readonly' ? 'Read-only' : status}
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
