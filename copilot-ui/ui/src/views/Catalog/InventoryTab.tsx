import { useEffect, useMemo, useState } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState, CatalogSnapshotEnvelope } from '../../lib/types';
import AssetGroupList from './AssetGroupList';
import AssetReader from './AssetReader';
import StatusRail from './StatusRail';

interface InventoryTabProps {
  sections: CatalogGlobalSection[];
  harnesses: CatalogGlobalHarness[];
  summary: CatalogSnapshotEnvelope | null;
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
}

/* Helper: detect items needing attention */
function itemNeedsAttention(item: CatalogGlobalItem): boolean {
  return (item.harnessStates || []).some(
    (s) => s.syncStatus === 'missing' || s.syncStatus === 'unsupported',
  );
}

export default function InventoryTab({ sections, harnesses, onItemAction, mutating }: InventoryTabProps) {
  const [selectedItem, setSelectedItem] = useState<CatalogGlobalItem | null>(null);

  const allItems = useMemo(
    () => sections.flatMap((s) => s.items || []),
    [sections],
  );

  /* Auto-select item with attention first, otherwise first item */
  useEffect(() => {
    if (allItems.length > 0) {
      const needsAttention = allItems.find((i) => itemNeedsAttention(i));
      setSelectedItem(needsAttention ?? allItems[0]);
    }
    // Only run when allItems changes - auto-select on initial load and data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems]);

  return (
    <div className="assets-tools-explorer" data-testid="assets-tools-inventory">
      <AssetGroupList
        sections={sections}
        selectedItem={selectedItem}
        onSelectItem={setSelectedItem}
      />
      <AssetReader item={selectedItem} />
      <StatusRail
        item={selectedItem}
        harnesses={harnesses}
        onItemAction={onItemAction}
        mutating={mutating}
      />
    </div>
  );
}
