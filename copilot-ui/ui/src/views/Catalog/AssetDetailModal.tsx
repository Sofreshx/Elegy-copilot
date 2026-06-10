import { useEffect, useRef } from 'react';
import type { CatalogGlobalItem, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { Badge, Button } from '../../components';
import { normalizeProvenance } from './provenance';
import AssetReader from './AssetReader';
import StatusRail from './StatusRail';

interface AssetDetailModalProps {
  item: CatalogGlobalItem;
  harnesses: CatalogGlobalHarness[];
  onClose: () => void;
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  mutating?: boolean;
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
          <StatusRail
            item={item}
            harnesses={harnesses}
          />
        </div>
      </div>
    </div>
  );
}
