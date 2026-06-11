import { useMemo } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection } from '../../lib/types';

interface HarnessTabProps {
  harnessId: string;
  sections: CatalogGlobalSection[];
}

function getStateBadgeClass(state: string | undefined): string {
  switch (state) {
    case 'installed': return 'state-badge state-badge--ok';
    case 'not-installed': return 'state-badge state-badge--warn';
    case 'stale': return 'state-badge state-badge--warn';
    case 'conflict': return 'state-badge state-badge--error';
    case 'unmanaged': return 'state-badge state-badge--error';
    case 'available': return 'state-badge state-badge--muted';
    default: return 'state-badge state-badge--muted';
  }
}

function getStateLabel(state: string | undefined): string {
  switch (state) {
    case 'installed': return 'Installed';
    case 'not-installed': return 'Not installed';
    case 'stale': return 'Stale';
    case 'conflict': return 'Conflict';
    case 'unmanaged': return 'Unmanaged';
    case 'available': return 'Available';
    default: return state || 'Unknown';
  }
}

const STATE_GROUPS: Array<{ state: string; label: string }> = [
  { state: 'installed', label: 'Installed' },
  { state: 'stale', label: 'Stale' },
  { state: 'conflict', label: 'Conflicts' },
  { state: 'not-installed', label: 'Not Installed' },
  { state: 'available', label: 'Available' },
  { state: 'unmanaged', label: 'Unmanaged' },
];

export default function HarnessTab({ harnessId, sections }: HarnessTabProps) {
  const harnessItems = useMemo(() => {
    const result: Array<{ item: CatalogGlobalItem; state: string }> = [];
    for (const section of sections) {
      for (const item of section.items || []) {
        const hs = (item.harnessStates || []).find(
          (s) => s.harnessId === harnessId,
        );
        if (hs && hs.supported) {
          result.push({ item, state: hs.state || 'unknown' });
        }
      }
    }
    return result;
  }, [sections, harnessId]);

  const grouped = useMemo(() => {
    const map = new Map<string, Array<{ item: CatalogGlobalItem; state: string }>>();
    for (const entry of harnessItems) {
      const key = entry.state;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return map;
  }, [harnessItems]);

  if (harnessItems.length === 0) {
    return (
      <div className="assets-tools-empty" data-testid={`harness-tab-${harnessId}-empty`}>
        <p>No assets found for this harness.</p>
      </div>
    );
  }

  return (
    <div className="harness-tab" data-testid={`harness-tab-${harnessId}`}>
      {STATE_GROUPS.map((group) => {
        const items = grouped.get(group.state);
        if (!items || items.length === 0) return null;
        return (
          <div key={group.state} className="harness-tab-group" data-testid={`harness-tab-group-${group.state}`}>
            <h3 className="harness-tab-group-header">
              <span className={getStateBadgeClass(group.state)}>{group.label}</span>
              <span className="harness-tab-group-count">{items.length}</span>
            </h3>
            <div className="harness-tab-items">
              {items.map(({ item, state }) => (
                <div key={item.itemId} className="harness-tab-item" data-testid={`harness-tab-item-${item.itemId}`}>
                  <span className="harness-tab-item-kind">{item.kind}</span>
                  <span className="harness-tab-item-title">{item.title}</span>
                  <span className={getStateBadgeClass(state)}>{getStateLabel(state)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
