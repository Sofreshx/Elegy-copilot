import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, FormInput, Toolbar } from '../../components';
import { getCatalogSummary, getCatalogContent } from '../../lib/api';
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

/* ------------------------------------------------------------------ */
/*  Internal types                                                    */
/* ------------------------------------------------------------------ */

type GroupKey = 'core-agents' | 'shared-skills' | 'plugins-package' | 'hooks' | 'external-tools';

interface AssetGroup {
  key: GroupKey;
  title: string;
  icon: IconName;
  items: CatalogGlobalItem[];
}

interface Metric {
  label: string;
  value: number | string;
  icon: IconName;
  sublabel?: string;
}

interface FilterState {
  search: string;
  typeChips: string[];
  sourceChips: string[];
  harnessChips: string[];
  needsAttention: boolean;
}

interface AddToolForm {
  url: string;
  title: string;
  sourceId: string;
  ref: string;
  description: string;
  includeMcp: boolean;
}

/* ------------------------------------------------------------------ */
/*  Defaults                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_FILTERS: FilterState = {
  search: '',
  typeChips: [],
  sourceChips: [],
  harnessChips: [],
  needsAttention: false,
};

const DEFAULT_ADD_TOOL_FORM: AddToolForm = {
  url: '',
  title: '',
  sourceId: '',
  ref: '',
  description: '',
  includeMcp: false,
};

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

function formatTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'never';
  const trimmed = value.trim();
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : trimmed;
}

function getHarnessBadgeTone(
  state: CatalogGlobalHarnessState,
): 'success' | 'neutral' | 'accent' | 'danger' {
  switch (state.syncStatus) {
    case 'missing':
      return 'danger';
    case 'synced':
    case 'active':
    case 'installed':
      return 'success';
    case 'unsupported':
      return 'neutral';
    case 'available':
      return 'accent';
    default:
      return 'accent';
  }
}

function getHarnessStatusLabel(state: CatalogGlobalHarnessState): string {
  switch (state.syncStatus) {
    case 'missing':
      return 'Missing';
    case 'synced':
      return 'Synced';
    case 'active':
      return 'Active';
    case 'installed':
      return 'Installed';
    case 'unsupported':
      return 'Not supported';
    case 'available':
      return 'Available';
    default:
      return state.expected ? 'Pending' : 'Available';
  }
}

function getActionLabel(
  item: CatalogGlobalItem,
  harnessState: CatalogGlobalHarnessState,
): string | null {
  const actionKind =
    (typeof harnessState.metadata?.actionKind === 'string'
      ? harnessState.metadata.actionKind
      : item.actions?.kind) ?? null;
  if (!actionKind) return null;

  const actions = harnessState.actions;
  if (!actions) return null;

  if (
    actions.canDeactivate &&
    (harnessState.active || harnessState.installed) &&
    actionKind === 'external-source'
  ) {
    return 'Disable';
  }
  if (actions.canActivate && actionKind === 'external-source') {
    return harnessState.installed ? 'Repair source' : 'Enable source';
  }
  if (actions.canInstall && actionKind === 'catalog-asset') {
    return 'Install';
  }
  if (actions.canInstall && actionKind === 'install-surface') {
    return harnessState.syncStatus === 'missing' || harnessState.installed
      ? 'Sync harness'
      : 'Install harness';
  }
  if (
    actions.canSync &&
    actionKind === 'install-surface' &&
    Array.isArray(item.actions?.installSurfaceTargets) &&
    item.actions.installSurfaceTargets.includes(harnessState.harnessId)
  ) {
    return 'Sync harness';
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Grouping logic                                                    */
/* ------------------------------------------------------------------ */

function groupItems(sections: CatalogGlobalSection[]): AssetGroup[] {
  const grouped: Record<GroupKey, CatalogGlobalItem[]> = {
    'core-agents': [],
    'shared-skills': [],
    'plugins-package': [],
    hooks: [],
    'external-tools': [],
  };

  for (const section of sections) {
    for (const item of section.items || []) {
      const key = resolveGroupKey(item, section);
      if (grouped[key]) {
        grouped[key].push(item);
      } else {
        grouped['external-tools'].push(item);
      }
    }
  }

  const configs: { key: GroupKey; title: string; icon: IconName }[] = [
    { key: 'core-agents', title: 'Core Agents', icon: 'agent' },
    { key: 'shared-skills', title: 'Shared Skills', icon: 'skill' },
    { key: 'plugins-package', title: 'Plugins & Packages', icon: 'plugin' },
    { key: 'hooks', title: 'Hooks', icon: 'hook' },
    { key: 'external-tools', title: 'External Tools', icon: 'mcp' },
  ];

  return configs.map((cfg) => ({
    ...cfg,
    items: grouped[cfg.key],
  }));
}

function resolveGroupKey(
  item: CatalogGlobalItem,
  section: CatalogGlobalSection,
): GroupKey {
  const kind = item.kind?.toLowerCase() ?? '';
  const sourceType = item.sourceType?.toLowerCase() ?? '';

  if (kind === 'agent') return 'core-agents';
  if (kind === 'skill') return 'shared-skills';
  if (kind === 'hook') return 'hooks';
  if (kind === 'mcp' || sourceType === 'external-source') return 'external-tools';

  const sectionTitle = (section.title ?? '').toLowerCase();
  if (
    sectionTitle.includes('plugin') ||
    sectionTitle.includes('package') ||
    kind.includes('plugin') ||
    kind === 'package'
  ) {
    return 'plugins-package';
  }

  if (!kind || sourceType === 'harness-manifest') return 'external-tools';
  return 'external-tools';
}

/* ------------------------------------------------------------------ */
/*  Filter logic                                                      */
/* ------------------------------------------------------------------ */

function itemNeedsAttention(item: CatalogGlobalItem): boolean {
  return (item.harnessStates || []).some(
    (s) => s.syncStatus === 'missing' || s.syncStatus === 'unsupported',
  );
}

function matchesFilters(
  item: CatalogGlobalItem,
  filters: FilterState,
): boolean {
  /* search */
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase();
    const haystack = [
      item.title,
      item.itemKey,
      item.description,
      item.sourceId,
      item.providerId,
      item.kind,
      ...(item.harnessStates || []).flatMap((s) => [s.title, s.syncStatus]),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  /* type chips */
  if (filters.typeChips.length > 0) {
    const kind = item.kind?.toLowerCase() ?? '';
    if (!filters.typeChips.some((chip) => chip === kind || chip === 'all')) {
      return false;
    }
  }

  /* source chips */
  if (filters.sourceChips.length > 0) {
    const sourceType = item.sourceType?.toLowerCase() ?? '';
    if (!filters.sourceChips.includes(sourceType)) return false;
  }

  /* harness chips */
  if (filters.harnessChips.length > 0) {
    const itemHarnessIds = new Set(
      (item.harnessStates || []).map((s) => s.harnessId),
    );
    const hasMatch = filters.harnessChips.some((id) => itemHarnessIds.has(id));
    if (!hasMatch) return false;
  }

  /* needs attention */
  if (filters.needsAttention && !itemNeedsAttention(item)) return false;

  return true;
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
      value:
        allItems.filter((i) => i.kind === 'hook').length > 0
          ? allItems.filter((i) => i.kind === 'hook').length
          : 'Coming soon',
      icon: 'hook',
      sublabel:
        allItems.filter((i) => i.kind === 'hook').length === 0
          ? 'Coming soon'
          : undefined,
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
      value: harnesses.filter((h) => (h as Record<string, unknown>).optedIn === true).length,
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

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedItem, setSelectedItem] = useState<CatalogGlobalItem | null>(null);
  const [inspectorContent, setInspectorContent] = useState('');
  const [inspectorLoading, setInspectorLoading] = useState(false);

  const [showAddTool, setShowAddTool] = useState(false);
  const [addToolMode, setAddToolMode] = useState<'mcp' | 'skill-folder' | 'hook' | 'plugin'>('mcp');
  const [addToolForm, setAddToolForm] = useState<AddToolForm>(DEFAULT_ADD_TOOL_FORM);

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
  const harnessList = useMemo(
    () => (summary?.globalInventory?.harnesses || []).map((h) => h.harnessId),
    [summary],
  );

  const groups = useMemo(() => groupItems(allSections), [allSections]);

  const allItems = useMemo(
    () => allSections.flatMap((s) => s.items || []),
    [allSections],
  );

  const externalSources = useMemo(
    () => (summary?.externalSources || []) as CatalogExternalSourceProjection[],
    [summary],
  );

  const filteredGroups = useMemo(() => {
    return groups.map((g) => ({
      ...g,
      items: g.items.filter((item) => matchesFilters(item, filters)),
    }));
  }, [groups, filters]);

  const metrics = useMemo(() => deriveMetrics(summary), [summary]);

  /* ---- selected item fallback ---- */
  useEffect(() => {
    if (!selectedItem && allItems.length > 0 && !summaryLoading) {
      const needsAttention = allItems.find((i) => itemNeedsAttention(i));
      setSelectedItem(needsAttention ?? allItems[0]);
    }
  }, [allItems, selectedItem, summaryLoading]);

  /* ---- inspector content loading ---- */
  useEffect(() => {
    if (!selectedItem) {
      setInspectorContent('');
      setInspectorLoading(false);
      return;
    }

    const item = selectedItem; // capture for closure

    let cancelled = false;

    async function loadContent() {
      const readPath =
        typeof item.readPath === 'string' && item.readPath.trim()
          ? item.readPath.trim()
          : item.detail && typeof item.detail === 'object' && 'readPath' in item.detail
            ? String((item.detail as Record<string, unknown>).readPath ?? '')
            : '';

      if (!readPath) {
        if (!cancelled) {
          setInspectorContent('(no content path available)');
          setInspectorLoading(false);
        }
        return;
      }

      setInspectorLoading(true);
      setInspectorContent('(loading content...)');

      try {
        const mode =
          item.sourceType === 'external-source'
            ? ('external-source' as const)
            : item.sourceType === 'harness-manifest'
              ? ('engine' as const)
              : ('absolute' as const);
        const content = await getCatalogContent({
          mode,
          path: readPath,
          sourceId: item.sourceId ?? undefined,
        });
        if (!cancelled) {
          setInspectorContent(content || '(empty)');
          setInspectorLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setInspectorContent(`(error: ${toErrorMessage(err, 'load failed')})`);
          setInspectorLoading(false);
        }
      }
    }

    void loadContent();
    return () => {
      cancelled = true;
    };
  }, [selectedItem]);

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

  function handleOpenAddTool(): void {
    setAddToolForm(DEFAULT_ADD_TOOL_FORM);
    setAddToolMode('mcp');
    setShowAddTool(true);
  }

  function handleCloseAddTool(): void {
    setShowAddTool(false);
  }

  async function handleAddToolSubmit(): Promise<void> {
    if (!addToolForm.url.trim()) return;

    await catalogWorkspaceStore.addExternalSource({
      url: addToolForm.url.trim(),
      title: addToolForm.title.trim() || undefined,
      sourceId: addToolForm.sourceId.trim() || undefined,
      ref: addToolForm.ref.trim() || undefined,
      description: addToolForm.description.trim() || undefined,
      includeMcp: addToolForm.includeMcp,
    });

    setAddToolForm(DEFAULT_ADD_TOOL_FORM);
    setShowAddTool(false);

    /* refresh after adding */
    await handleRefresh();
  }

  async function handleSyncHarnesses(): Promise<void> {
    await catalogWorkspaceStore.installAll();
    await handleRefresh();
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
      await catalogWorkspaceStore.installSurface(harnessState.harnessId as 'codex' | 'opencode' | 'antigravity');
      await handleRefresh();
    }
  }

  function handleSelectItem(item: CatalogGlobalItem): void {
    setSelectedItem(item);
  }

  function toggleFilterChip(
    group: 'typeChips' | 'sourceChips' | 'harnessChips',
    value: string,
  ): void {
    setFilters((prev) => {
      const current = prev[group];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [group]: next };
    });
  }

  function handleAddToolFormField<K extends keyof AddToolForm>(
    field: K,
    value: AddToolForm[K],
  ): void {
    setAddToolForm((prev) => ({ ...prev, [field]: value }));
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

  function renderFilterRail(): React.ReactNode {
    const typeOptions = ['all', 'agent', 'skill', 'hook', 'plugin', 'mcp', 'package'];
    const sourceOptions = ['shipped', 'elegy-repo', 'external', 'user'];
    const harnessOptions = harnessList;

    function chipRow(
      group: 'typeChips' | 'sourceChips' | 'harnessChips',
      options: string[],
      testIdPrefix: string,
    ): React.ReactNode {
      return (
        <div className="assets-tools-chip-row">
          {options.map((opt) => {
            const active = filters[group].length === 0 || filters[group].includes(opt);
            return (
              <button
                key={opt}
                className={`assets-tools-chip catalog-chip ${active ? 'active catalog-chip is-active' : ''}`}
                data-testid={`${testIdPrefix}-${opt}`}
                onClick={() => toggleFilterChip(group, opt)}
                type="button"
              >
                {opt}
              </button>
            );
          })}
        </div>
      );
    }

    return (
      <aside className="assets-tools-filters" data-testid="assets-tools-filters">
        {/* search */}
        <div className="assets-tools-filter-search" data-testid="assets-tools-filter-search">
          <input
            type="text"
            className="catalog-shell-search"
            placeholder="Search assets & tools…"
            value={filters.search}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, search: e.target.value }))
            }
            data-testid="catalog-shell-search"
          />
        </div>

        {/* type chips */}
        <div className="assets-tools-filter-group">
          <p className="assets-tools-filter-label">Type</p>
          {chipRow('typeChips', typeOptions, 'assets-tools-filter-type')}
        </div>

        {/* source chips */}
        <div className="assets-tools-filter-group">
          <p className="assets-tools-filter-label">Source</p>
          {chipRow('sourceChips', sourceOptions, 'assets-tools-filter-source')}
        </div>

        {/* harness chips */}
        <div className="assets-tools-filter-group">
          <p className="assets-tools-filter-label">Harness</p>
          {chipRow('harnessChips', harnessOptions, 'assets-tools-filter-harness')}
        </div>

        {/* needs attention toggle */}
        <div className="assets-tools-filter-group">
          <button
            className={`assets-tools-chip catalog-chip ${filters.needsAttention ? 'active catalog-chip is-active' : ''}`}
            data-testid="assets-tools-filter-attention"
            onClick={() =>
              setFilters((prev) => ({ ...prev, needsAttention: !prev.needsAttention }))
            }
            type="button"
          >
            Needs attention
          </button>
        </div>
      </aside>
    );
  }

  function renderGroupSection(group: AssetGroup): React.ReactNode {
    if (group.items.length === 0) return null;

    return (
      <div
        className="assets-tools-group"
        data-testid={`assets-tools-group-${group.key}`}
        key={group.key}
      >
        <div className="assets-tools-group-header">
          <CatalogIcon name={group.icon} size={16} />
          <h3>{group.title}</h3>
          <Badge tone="neutral">{group.items.length}</Badge>
        </div>

        {group.items.map((item) => {
          const isSelected = selectedItem?.itemId === item.itemId;
          const attention = itemNeedsAttention(item);
          return (
            <article
              className={`assets-tools-item-card ${isSelected ? 'selected' : ''}`}
              data-testid={`assets-tools-item-${item.itemId}`}
              key={item.itemId}
              onClick={() => handleSelectItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') handleSelectItem(item);
              }}
              role="button"
              tabIndex={0}
            >
              <div className="assets-tools-item-header">
                <CatalogIcon
                  name={item.kind === 'agent' ? 'agent' : item.kind === 'skill' ? 'skill' : item.kind === 'hook' ? 'hook' : item.kind === 'mcp' ? 'mcp' : 'package'}
                  size={18}
                />
                <span>{item.title}</span>
                <div className="assets-tools-item-badges">
                  <Badge tone="neutral">{item.kind}</Badge>
                  {item.sourceType ? <Badge tone="accent">{item.sourceType}</Badge> : null}
                </div>
              </div>

              {item.description ? (
                <p className="assets-tools-item-description">{item.description}</p>
              ) : null}

              <div className="assets-tools-item-harnesses">
                {(item.harnessStates || []).slice(0, 4).map((hs) => (
                  <Badge
                    key={`${item.itemId}-${hs.harnessId}`}
                    tone={getHarnessBadgeTone(hs)}
                  >
                    {hs.title}: {getHarnessStatusLabel(hs)}
                  </Badge>
                ))}
                {(item.harnessStates || []).length > 4 ? (
                  <Badge tone="neutral">+{(item.harnessStates || []).length - 4} more</Badge>
                ) : null}
              </div>

              {attention ? (
                <p className="assets-tools-item-attention catalog-inline-note state-error">
                  Needs attention
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  function renderInspector(): React.ReactNode {
    if (!selectedItem) {
      return (
        <aside className="assets-tools-inspector" data-testid="assets-tools-inspector">
          <p className="assets-tools-empty">Select an item to inspect</p>
        </aside>
      );
    }

    const kindIcon: IconName =
      selectedItem.kind === 'agent'
        ? 'agent'
        : selectedItem.kind === 'skill'
          ? 'skill'
          : selectedItem.kind === 'hook'
            ? 'hook'
            : selectedItem.kind === 'mcp'
              ? 'mcp'
              : 'package';

    return (
      <aside className="assets-tools-inspector" data-testid="assets-tools-inspector">
        {/* Header */}
        <div className="assets-tools-inspector-section">
          <div className="assets-tools-item-header">
            <CatalogIcon name={kindIcon} size={22} />
            <h3>{selectedItem.title}</h3>
          </div>
          <div className="assets-tools-item-badges">
            <Badge tone="neutral">{selectedItem.kind}</Badge>
            {selectedItem.sourceType ? (
              <Badge tone="accent">{selectedItem.sourceType}</Badge>
            ) : null}
            {selectedItem.sourceId ? (
              <Badge tone="brand">{selectedItem.sourceId}</Badge>
            ) : null}
          </div>
        </div>

        {/* Description */}
        {selectedItem.description ? (
          <div className="assets-tools-inspector-section">
            <h4>Description</h4>
            <p>{selectedItem.description}</p>
          </div>
        ) : null}

        {/* Package / Source info */}
        <div className="assets-tools-inspector-section">
          <h4>Package &amp; Source</h4>
          <table>
            <tbody>
              <tr><td>Item Key</td><td>{selectedItem.itemKey}</td></tr>
              <tr><td>Source Type</td><td>{selectedItem.sourceType || '—'}</td></tr>
              <tr><td>Source ID</td><td>{selectedItem.sourceId || '—'}</td></tr>
              <tr><td>Provider ID</td><td>{selectedItem.providerId || '—'}</td></tr>
              {selectedItem.readPath ? <tr><td>Read Path</td><td>{selectedItem.readPath}</td></tr> : null}
            </tbody>
          </table>
        </div>

        {/* Harness availability */}
        <div className="assets-tools-inspector-section">
          <h4>Harness Availability</h4>
          {(selectedItem.harnessStates || []).length === 0 ? (
            <p className="assets-tools-empty">No harness state data</p>
          ) : (
            <div className="assets-tools-item-harnesses">
              {(selectedItem.harnessStates || []).map((hs) => {
                const actionLabel = getActionLabel(selectedItem, hs);
                const disabled =
                  !actionLabel ||
                  catalogState.mutating ||
                  catalogState.installing;
                return (
                  <div
                    className="assets-tools-item-actions"
                    key={`${selectedItem.itemId}-${hs.harnessId}`}
                  >
                    <Badge tone={getHarnessBadgeTone(hs)}>
                      {hs.title}: {getHarnessStatusLabel(hs)}
                    </Badge>
                    {hs.installPath ? (
                      <p className="catalog-inline-note">{hs.installPath}</p>
                    ) : null}
                    {actionLabel ? (
                      <Button
                        disabled={disabled}
                        onClick={() => void handleItemAction(selectedItem, hs)}
                        size="sm"
                        testId={`assets-tools-item-action-${selectedItem.itemId}-${hs.harnessId}`}
                        variant="secondary"
                      >
                        {actionLabel}
                      </Button>
                    ) : (
                      <p className="catalog-inline-note state-error">
                        {hs.supported ? 'No action available' : 'Unsupported harness'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Install paths */}
        {selectedItem.readPath ? (
          <div className="assets-tools-inspector-section">
            <h4>Install Paths</h4>
            <p className="catalog-inline-note">{selectedItem.readPath}</p>
          </div>
        ) : null}

        {/* Verification (external source) */}
        {selectedItem.sourceType === 'external-source' && selectedItem.detail ? (
          <div className="assets-tools-inspector-section">
            <h4>Verification</h4>
            <p className="catalog-inline-note">
              {String((selectedItem.detail as Record<string, unknown>)?.sourceSyncStatus ?? 'unknown')}
            </p>
          </div>
        ) : null}

        {/* Content */}
        <div className="assets-tools-inspector-section">
          <h4>Content</h4>
          {inspectorLoading ? (
            <p className="catalog-inline-note">Loading content...</p>
          ) : (
            <pre className="assets-tools-inspector-content">{inspectorContent}</pre>
          )}
        </div>
      </aside>
    );
  }

  function renderAddToolPanel(): React.ReactNode {
    if (!showAddTool) return null;

    const isSubmitting = catalogState.mutating || catalogState.installing;
    const modes: { key: typeof addToolMode; label: string; pending?: boolean }[] = [
      { key: 'mcp', label: 'MCP Server' },
      { key: 'skill-folder', label: 'Skill Folder' },
      { key: 'hook', label: 'Hook', pending: true },
      { key: 'plugin', label: 'Plugin', pending: true },
    ];

    return (
      <div className="assets-tools-add-panel" data-testid="assets-tools-add-panel">
        <div className="assets-tools-add-panel-header">
          <h3>Add Tool</h3>
          <Button onClick={handleCloseAddTool} variant="ghost" testId="assets-tools-add-panel-close">
            Close
          </Button>
        </div>

        <div className="assets-tools-add-panel-modes">
          {modes.map((mode) => (
            <button
              key={mode.key}
              className={`assets-tools-chip catalog-chip ${addToolMode === mode.key ? 'active catalog-chip is-active' : ''}`}
              data-testid={`assets-tools-add-panel-mode-${mode.key}`}
              disabled={mode.pending}
              onClick={() => setAddToolMode(mode.key)}
              type="button"
            >
              {mode.label}
              {mode.pending ? ' (pending)' : ''}
            </button>
          ))}
        </div>

        <div className="assets-tools-add-panel-body">
          {addToolMode === 'mcp' || addToolMode === 'skill-folder' ? (
            <div className="assets-tools-add-panel-form">
              <FormInput
                label="URL"
                required
                testId="assets-tools-add-panel-url"
                type="url"
                value={addToolForm.url}
                onValueChange={(v) => handleAddToolFormField('url', v)}
                placeholder="https://github.com/owner/repo"
              />
              <FormInput
                label="Title"
                testId="assets-tools-add-panel-title"
                value={addToolForm.title}
                onValueChange={(v) => handleAddToolFormField('title', v)}
                placeholder="(optional) My Tool"
              />
              <FormInput
                label="Source ID"
                testId="assets-tools-add-panel-source-id"
                value={addToolForm.sourceId}
                onValueChange={(v) => handleAddToolFormField('sourceId', v)}
                placeholder="(optional) my-tool"
              />
              <FormInput
                label="Ref"
                testId="assets-tools-add-panel-ref"
                value={addToolForm.ref}
                onValueChange={(v) => handleAddToolFormField('ref', v)}
                placeholder="(optional) main"
              />
              <FormInput
                label="Description"
                testId="assets-tools-add-panel-description"
                value={addToolForm.description}
                onValueChange={(v) => handleAddToolFormField('description', v)}
                placeholder="(optional) A brief description"
              />
              <label className="form-input">
                <span className="form-label">Probe for MCP manifests</span>
                <input
                  type="checkbox"
                  checked={addToolForm.includeMcp}
                  onChange={(e) => handleAddToolFormField('includeMcp', e.target.checked)}
                  data-testid="assets-tools-add-panel-include-mcp"
                />
              </label>
              <Button
                disabled={isSubmitting || !addToolForm.url.trim()}
                onClick={() => void handleAddToolSubmit()}
                testId="assets-tools-add-panel-submit"
              >
                {isSubmitting ? 'Adding...' : 'Add Source'}
              </Button>
            </div>
          ) : (
            <p className="catalog-inline-note state-message">
              Catalog support for {addToolMode === 'hook' ? 'hooks' : 'plugins'} is pending.
            </p>
          )}
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

  const hasFilteredItems = filteredGroups.some((g) => g.items.length > 0);

  return (
    <div className="assets-tools-view catalog-shell-view" data-testid="catalog-shell-view">
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
            disabled={catalogState.refreshing || summaryLoading}
            onClick={() => void handleRefresh()}
            testId="assets-tools-refresh"
            variant="ghost"
          >
            {summaryLoading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button
            disabled={catalogState.mutating}
            onClick={handleOpenAddTool}
            testId="assets-tools-add-tool"
            variant="secondary"
          >
            Add Tool
          </Button>
          <Button
            disabled={catalogState.installing}
            onClick={() => void handleSyncHarnesses()}
            testId="assets-tools-sync-harnesses"
            variant="secondary"
          >
            {catalogState.installing ? 'Syncing...' : 'Sync Harnesses'}
          </Button>
          <Button
            onClick={() => setShowRepositoryAssets(true)}
            testId="assets-tools-repository-view"
            variant="ghost"
          >
            Repository Assets
          </Button>
        </div>
      </Toolbar>

      {/* SUMMARY */}
      <div className="catalog-shell-summary" data-testid="catalog-shell-summary">
        {summaryLoading ? (
          <span className="catalog-shell-summary-text state-message">
            Loading catalog summary…
          </span>
        ) : summaryError ? (
          <span className="catalog-shell-summary-text state-error">
            {summaryError}
          </span>
        ) : summary ? (
          <span className="catalog-shell-summary-text">
            {allSections
              .map((s) => `${s.count} ${s.title.toLowerCase()}`)
              .join(' · ')}
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

      {/* METRIC STRIP */}
      <div className="assets-tools-metrics" data-testid="assets-tools-metrics">
        {metrics.map(renderMetricCard)}
      </div>

      {/* THREE-COLUMN EXPLORER */}
      <div className="assets-tools-explorer" data-testid="assets-tools-explorer">
        {renderFilterRail()}

        <main className="assets-tools-list" data-testid="assets-tools-list">
          {summaryLoading ? (
            <p className="assets-tools-empty state-message">Loading catalog summary…</p>
          ) : summaryError ? (
            <p className="assets-tools-empty state-error">Catalog summary unavailable</p>
          ) : !hasFilteredItems ? (
            <p className="assets-tools-empty">No assets or tools found.</p>
          ) : (
            filteredGroups.map(renderGroupSection)
          )}
        </main>

        {renderInspector()}
      </div>

      {/* ADD TOOL OVERLAY */}
      {renderAddToolPanel()}
    </div>
  );
}
