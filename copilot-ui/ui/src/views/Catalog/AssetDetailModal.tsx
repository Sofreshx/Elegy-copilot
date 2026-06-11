import React, { useEffect, useRef } from 'react';
import type { CatalogGlobalItem, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { Badge } from '../../components';
import { normalizeProvenance } from './provenance';
import AssetReader from './AssetReader';

interface AssetDetailModalProps {
  item: CatalogGlobalItem;
  harnesses: CatalogGlobalHarness[];
  onClose: () => void;
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
}

function getHarnessStateBadgeClass(state: string | undefined | null): string {
  switch (state) {
    case 'installed': case 'synced': return 'state-badge--ok';
    case 'not-installed': case 'missing': return 'state-badge--warn';
    case 'stale': return 'state-badge--warn';
    case 'conflict': case 'unmanaged': return 'state-badge--error';
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

function renderHarnessActions(
  hs: CatalogGlobalHarnessState,
  item: CatalogGlobalItem,
): React.ReactNode {
  const state = hs.state || hs.syncStatus || '';
  const targets = item.actions?.installSurfaceTargets || [];
  const canInstall = targets.length > 0 && (state === 'available' || state === 'not-installed' || state === 'missing');
  const canUpdate = targets.length > 0 && (state === 'installed' || state === 'synced' || state === 'stale');
  const canUninstall = state === 'installed' || state === 'synced' || state === 'stale';
  const canCheck = state === 'installed' || state === 'synced' || state === 'stale' || state === 'conflict' || state === 'unmanaged';
  const uninstallBlocked = state === 'unmanaged' || state === 'conflict';

  return (
    <>
      {canInstall && (
        <button className="button button-sm button-primary" disabled={mutating} type="button">
          Install
        </button>
      )}
      {canUpdate && (
        <>
          <button className="button button-sm button-primary" disabled={mutating} type="button">
            Update
          </button>
          <button className="button button-sm button-ghost" disabled={mutating} type="button">
            Sync
          </button>
        </>
      )}
      {canUninstall && (
        <button
          className={`button button-sm ${uninstallBlocked ? 'button-ghost' : 'button-danger'}`}
          disabled={mutating || uninstallBlocked}
          title={uninstallBlocked ? 'Uninstall blocked — asset is externally modified' : 'Uninstall managed asset'}
          type="button"
        >
          Uninstall
        </button>
      )}
      {canCheck && (
        <button className="button button-sm button-ghost" disabled={mutating} type="button">
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
  mutating,
}: AssetDetailModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Scroll lock on body when modal opens */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* Focus trap: focus close button on mount */
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  /* Escape key closes */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Trap Tab within modal */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const provenance = normalizeProvenance(item.readPath, item.sourceId, item.sourceType);

  /* Backdrop click closes */
  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="asset-detail-modal-backdrop"
      onClick={handleBackdropClick}
      data-testid="asset-detail-modal-backdrop"
    >
      <div
        ref={panelRef}
        className="asset-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-detail-modal-title"
        data-testid="asset-detail-modal"
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
          {/* Plain <button> because Button does not forward refs */}
          <button
            ref={closeRef}
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
                  {renderHarnessActions(hs, item)}
                </div>
              </div>
            ))}
            {(item.harnessStates || []).length === 0 && (
              <p className="state-message">No harness states available.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
