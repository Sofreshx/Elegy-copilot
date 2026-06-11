import type { CatalogGlobalItem, CatalogGlobalSection } from '../../lib/types';
import { normalizeProvenance, compareProvenanceGroups, type ProvenanceGroupInfo } from './provenance';
import { Badge } from '../../components';

/* Types */
export interface ProvenanceAssetGroup {
  groupInfo: ProvenanceGroupInfo;
  items: CatalogGlobalItem[];
  totalCount: number;
  installedCount: number;
  issueCount: number;
}

interface AssetGroupListProps {
  sections: CatalogGlobalSection[];
  selectedItem: CatalogGlobalItem | null;
  onSelectItem: (item: CatalogGlobalItem) => void;
}

/* Helpers */
function countIssues(item: CatalogGlobalItem): number {
  return (item.harnessStates || []).filter(
    (s) => s.syncStatus === 'missing' || s.syncStatus === 'unsupported',
  ).length;
}

function countInstalled(item: CatalogGlobalItem): number {
  return (item.harnessStates || []).filter(
    (s) => s.installed === true || s.active === true,
  ).length;
}

function getProvenanceGroup(item: CatalogGlobalItem): ProvenanceGroupInfo {
  const readPath = item.readPath ?? '';
  return normalizeProvenance(readPath, item.sourceId, item.sourceType);
}

function groupByProvenance(items: CatalogGlobalItem[]): ProvenanceAssetGroup[] {
  const grouped = new Map<string, ProvenanceAssetGroup>();
  
  for (const item of items) {
    const groupInfo = getProvenanceGroup(item);
    const key = groupInfo.groupKey;
    if (!grouped.has(key)) {
      grouped.set(key, {
        groupInfo,
        items: [],
        totalCount: 0,
        installedCount: 0,
        issueCount: 0,
      });
    }
    const g = grouped.get(key)!;
    g.items.push(item);
    g.totalCount++;
    g.installedCount += countInstalled(item);
    g.issueCount += countIssues(item);
  }
  
  return Array.from(grouped.values()).sort((a, b) => 
    compareProvenanceGroups(a.groupInfo, b.groupInfo)
  );
}

function getKindBadgeTone(kind: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  switch (kind) {
    case 'agent': return 'brand';
    case 'skill': return 'accent';
    case 'mcp': return 'success';
    case 'plugin': return 'accent';
    case 'hook': return 'danger';
    default: return 'neutral';
  }
}

/* Component */
export default function AssetGroupList({ sections, selectedItem, onSelectItem }: AssetGroupListProps) {
  const allItems = sections.flatMap((s) => s.items || []);
  const groups = groupByProvenance(allItems);

  return (
    <aside className="assets-tools-filters" data-testid="assets-tools-group-list">
      {groups.map((group) => (
        <div
          className="assets-tools-group"
          data-testid={`assets-tools-prov-group-${group.groupInfo.groupKey}`}
          key={group.groupInfo.groupKey}
        >
          <div className="assets-tools-group-header">
            <h3>{group.groupInfo.group}</h3>
            <span className="assets-tools-group-count">
              {group.totalCount} total &middot; {group.installedCount} installed
              {group.issueCount > 0 ? ` &middot; ${group.issueCount} issues` : ''}
            </span>
          </div>

          {group.items.map((item) => {
            const isSelected = selectedItem?.itemId === item.itemId;
            const issues = countIssues(item);
            return (
              <article
                className={`assets-tools-item-card ${isSelected ? 'selected' : ''}`}
                data-testid={`assets-tools-item-${item.itemId}`}
                key={item.itemId}
                onClick={() => onSelectItem(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectItem(item);
                }}
                role="button"
                tabIndex={0}
              >
                <div className="assets-tools-item-header">
                  <span>{item.title}</span>
                </div>
                <div className="assets-tools-item-badges">
                  <Badge tone={getKindBadgeTone(item.kind)}>{item.kind}</Badge>
                  {item.sourceType ? <Badge tone="neutral">{item.sourceType}</Badge> : null}
                  {issues > 0 ? <Badge tone="danger">⚠ {issues}</Badge> : null}
                </div>
                {item.description ? (
                  <p className="assets-tools-item-description">{item.description}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
