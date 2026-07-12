import React, { useEffect } from 'react';
import type { CatalogGlobalItem, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { Badge } from '../../components';
import { normalizeProvenance } from './provenance';
import AssetReader from './AssetReader';

interface AssetDetailModalProps {
  item: CatalogGlobalItem;
  harnesses: CatalogGlobalHarness[];
  onClose: () => void;
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  onUninstall?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
}

function getHarnessStateBadgeClass(state: string | undefined | null): string {
  switch (state) {
    case 'installed': case 'synced': return 'state-badge--ok';
    case 'not-installed': case 'missing': return 'state-badge--warn';
    case 'stale': return 'state-badge--warn';
    case 'conflict': return 'state-badge--error';
    case 'unmanaged': return 'state-badge--warn';
    case 'available': return 'state-badge--muted';
    default: return 'state-badge--muted';
  }
}

function getHarnessStateLabel(state: string | undefined | null): string {
  switch (state) {
    case 'installed': return 'Installed';
    case 'synced': return 'Synced';
    case 'not-installed': return 'Not installed';
    case 'missing': return 'Missing';
    case 'stale': return 'Stale';
    case 'conflict': return 'Conflict';
    case 'unmanaged': return 'Unmanaged';
    case 'available': return 'Available';
    default: return state || 'Unknown';
  }
}

function renderHarnessActions({
  hs,
  item,
  onAction,
  onUninstall,
  mutating,
}: {
  hs: CatalogGlobalHarnessState;
  item: CatalogGlobalItem;
  onAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  onUninstall?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
}): React.ReactNode {
  const state: string = hs.state || hs.syncStatus || '';
  const targets = item.actions?.installSurfaceTargets || [];
  const canInstall = targets.length > 0 && (state === 'available' || state === 'not-installed' || state === 'missing');
  const canUpdate = targets.length > 0 && (state === 'installed' || state === 'synced' || state === 'stale');
  const canUninstall = state === 'installed' || state === 'synced' || state === 'stale';
  const canCheck = state === 'installed' || state === 'synced' || state === 'stale' || state === 'conflict' || state === 'unmanaged';
  const uninstallBlocked = state === 'unmanaged' || state === 'conflict';

  return (
    <>
      {canInstall && (
        <button
          className="button button-sm button-primary"
          disabled={mutating}
          onClick={() => onAction?.(item, hs)}
          data-testid="asset-detail-install-btn"
          type="button"
        >
          Install
        </button>
      )}
      {canUpdate && (
        <>
          <button
            className="button button-sm button-primary"
            disabled={mutating}
            onClick={() => onAction?.(item, hs)}
            data-testid="asset-detail-update-btn"
            type="button"
          >
            Update
          </button>
          <button
            className="button button-sm button-ghost"
            disabled={mutating}
            onClick={() => onAction?.(item, hs)}
            data-testid="asset-detail-sync-btn"
            type="button"
          >
            Sync
          </button>
        </>
      )}
      {canUninstall && (
        <button
          className={`button button-sm ${uninstallBlocked ? 'button-ghost' : 'button-danger'}`}
          disabled={mutating || uninstallBlocked}
          onClick={() => onUninstall?.(item, hs)}
          data-testid="asset-detail-uninstall-btn"
          title={uninstallBlocked ? 'Uninstall blocked — asset is externally modified' : 'Uninstall managed asset'}
          type="button"
        >
          Uninstall
        </button>
      )}
      {canCheck && (
        <button
          className="button button-sm button-ghost"
          disabled={mutating}
          onClick={() => onAction?.(item, hs)}
          data-testid="asset-detail-check-btn"
          type="button"
        >
          Check
        </button>
      )}
    </>
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

export default function AssetDetailModal({
  item,
  harnesses,
  onClose,
  onItemAction,
  onUninstall,
  mutating,
}: AssetDetailModalProps) {
  /* Escape key closes */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const provenance = normalizeProvenance(item.readPath, item.sourceId, item.sourceType);

  return (
    <div className="asset-detail-drawer-layer">
      <aside
        className="asset-detail-drawer"
        role="complementary"
        aria-labelledby="asset-detail-modal-title"
        data-testid="asset-detail-drawer"
      >
        {/* Header */}
        <div className="asset-detail-modal-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', flex: 1, minWidth: 0 }}>
            <h2 id="asset-detail-modal-title" style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
              {item.title}
            </h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              <Badge tone={getKindBadgeTone(item.kind)}>{item.kind}</Badge>
              {item.sourceType ? <Badge tone="neutral">{item.sourceType}</Badge> : null}
              <Badge tone="brand">{provenance.group}</Badge>
              {item.providerId ? <Badge tone="accent">{item.providerId}</Badge> : null}
            </div>
          </div>
          <button
            onClick={onClose}
            className="button button-ghost button-sm"
            data-testid="asset-detail-modal-close"
            aria-label="Close details"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="asset-detail-modal-body">
          <AssetReader item={item} />
          <div className="asset-detail-harness-rows" data-testid="asset-detail-harness-rows">
            {(item.harnessStates || []).map((hs) => (
              <div
                key={hs.harnessId}
                className="asset-detail-harness-row"
                data-testid={`asset-detail-harness-row-${hs.harnessId}`}
              >
                <div className="asset-detail-harness-row-info">
                  <span className="asset-detail-harness-title">{hs.title || hs.harnessId}</span>
                  <span className={`state-badge ${getHarnessStateBadgeClass(hs.state || hs.syncStatus)}`}>
                    {getHarnessStateLabel(hs.state || hs.syncStatus)}
                  </span>
                  {hs.installPath ? (
                    <span className="asset-detail-harness-path" title={hs.installPath}>
                      {hs.installPath}
                    </span>
                  ) : null}
                </div>
                <div className="asset-detail-harness-row-actions">
                  {renderHarnessActions({ hs, item, onAction: onItemAction, onUninstall, mutating })}
                </div>
              </div>
            ))}
            {(item.harnessStates || []).length === 0 && (
              <p className="state-message">No harness states available.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
