import type { CatalogGlobalItem, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { Badge } from '../../components';

interface StatusRailProps {
  item: CatalogGlobalItem | null;
  harnesses: CatalogGlobalHarness[];
}

function getHarnessStatusBadgeTone(status: string | undefined): 'success' | 'neutral' | 'accent' | 'danger' {
  switch (status) {
    case 'missing': return 'danger';
    case 'synced': case 'active': case 'installed': return 'success';
    case 'unsupported': return 'neutral';
    case 'available': return 'accent';
    default: return 'neutral';
  }
}

function getStatusLabel(state: CatalogGlobalHarnessState): string {
  switch (state.syncStatus) {
    case 'missing': return 'Missing';
    case 'synced': return 'Synced';
    case 'active': return 'Active';
    case 'installed': return 'Installed';
    case 'unsupported': return 'Not supported';
    case 'available': return 'Available';
    default: return state.expected ? 'Pending' : 'Available';
  }
}

export default function StatusRail({ item, harnesses }: StatusRailProps) {
  if (!item) {
    return (
      <aside className="assets-tools-inspector" data-testid="assets-tools-status-rail">
        <p className="assets-tools-empty">Select an asset</p>
      </aside>
    );
  }

  // Build a map of harnessId to state for this item
  const stateMap = new Map<string, CatalogGlobalHarnessState>();
  for (const hs of item.harnessStates || []) {
    stateMap.set(hs.harnessId, hs);
  }

  return (
    <aside className="assets-tools-inspector" data-testid="assets-tools-status-rail">
      <div className="assets-tools-inspector-section">
        <h4>Harness Status</h4>
      </div>

      {/* Harness rows */}
      {harnesses.map((harness) => {
        const state = stateMap.get(harness.harnessId);
        const status = state ? getStatusLabel(state) : 'Not supported';
        const tone = state ? getHarnessStatusBadgeTone(state.syncStatus) : 'neutral';

        return (
          <div key={harness.harnessId} className="assets-tools-inspector-section" style={{ paddingBottom: 'var(--space-xs)', borderBottom: '1px solid var(--color-ink-200)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2xs)' }}>
              <strong style={{ fontSize: '0.82rem' }}>{harness.title}</strong>
              <Badge tone={tone}>{status}</Badge>
            </div>

            {/* Separate state labels */}
            {state && (
              <div style={{ display: 'flex', gap: 'var(--space-2xs)', flexWrap: 'wrap', marginTop: 'var(--space-2xs)' }}>
                {state.installed !== undefined && (
                  <Badge tone={state.installed ? 'success' : 'neutral'}>
                    {state.installed ? 'installed' : 'not installed'}
                  </Badge>
                )}
                {state.active !== undefined && (
                  <Badge tone={state.active ? 'brand' : 'neutral'}>
                    {state.active ? 'active' : 'inactive'}
                  </Badge>
                )}
                {typeof (state as any).enabled === 'boolean' && (
                  <Badge tone={(state as any).enabled ? 'success' : 'neutral'}>
                    {(state as any).enabled ? 'enabled' : 'disabled'}
                  </Badge>
                )}
                {typeof (state as any).autoRoutable === 'boolean' && (
                  <Badge tone={(state as any).autoRoutable ? 'brand' : 'neutral'}>
                    {(state as any).autoRoutable ? 'auto-routable' : 'manual'}
                  </Badge>
                )}
              </div>
            )}

            {state?.installPath ? (
              <p style={{ fontSize: '0.72rem', color: 'var(--color-ink-500)', marginTop: 'var(--space-2xs)', wordBreak: 'break-all' }}>
                {state.installPath}
              </p>
            ) : null}
            {state?.metadata && typeof state.metadata === 'object' ? (
              (() => {
                const meta = state.metadata as Record<string, unknown>;
                const version = meta.version || meta.currentVersion || meta.installedVersion;
                if (version && typeof version === 'string') {
                  return (
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-ink-600)', marginTop: '2px' }}>
                      Version: {version}
                    </p>
                  );
                }
                return null;
              })()
            ) : null}
          </div>
        );
      })}

      {/* Quality summary (if available) */}
      <div className="assets-tools-inspector-section" style={{ marginTop: 'var(--space-sm)' }}>
        <h4>Quality</h4>
        {((item as any).qualityScore !== undefined) ? (
          <Badge tone={(item as any).qualityScore > 0 ? 'danger' : 'success'}>
            {(item as any).qualityScore > 0 ? `${(item as any).qualityScore} issues` : 'No issues'}
          </Badge>
        ) : (
          <p className="assets-tools-empty" style={{ fontSize: '0.78rem' }}>Not evaluated</p>
        )}
      </div>
    </aside>
  );
}
