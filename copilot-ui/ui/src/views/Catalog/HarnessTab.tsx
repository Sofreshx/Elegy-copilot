import React, { useMemo, useState, useCallback } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';
import { useStoreValue } from '../../lib/store';
import AssetDetailModal from './AssetDetailModal';
import {
  getHarnessStateLabel,
  getHarnessStateBadgeClass,
  getCompatibilityLabel,
  getHarnessPrimaryAction,
  canRemoveAsset,
} from './harnessStateHelper';
import { normalizeProvenance } from './provenance';

interface HarnessTabProps {
  harnessId: string;
  sections: CatalogGlobalSection[];
  harnesses: CatalogGlobalHarness[];
  onItemAction?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  onUninstall?: (item: CatalogGlobalItem, state: CatalogGlobalHarnessState) => void;
  onRefresh?: () => void;
  mutating?: boolean;
}

export default function HarnessTab({ harnessId, sections, harnesses, onItemAction, onUninstall, onRefresh, mutating }: HarnessTabProps) {
  const [modalItem, setModalItem] = useState<CatalogGlobalItem | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const storeState = useStoreValue(catalogWorkspaceStore);

  const harnessItems = useMemo(() => {
    const result: Array<{ item: CatalogGlobalItem; hs: CatalogGlobalHarnessState }> = [];
    for (const section of sections) {
      for (const item of section.items || []) {
        const hs = (item.harnessStates || []).find(
          (s) => s.harnessId === harnessId,
        );
        if (hs) {
          result.push({ item, hs });
        }
      }
    }
    return result;
  }, [sections, harnessId]);

  // installSurface is idempotent — it syncs/updates the full harness surface
  // and is the correct API for both Install and Sync/Update actions
  const handleInstall = useCallback(async () => {
    try {
      await catalogWorkspaceStore.installSurface(harnessId as 'codex' | 'opencode' | 'antigravity' | 'claude');
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: installSurface failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  const handleSyncUpdate = useCallback(async () => {
    try {
      await catalogWorkspaceStore.installSurface(harnessId as 'codex' | 'opencode' | 'antigravity' | 'claude');
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: installSurface (sync) failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  const handleCheck = useCallback(async (item: CatalogGlobalItem) => {
    try {
      await catalogWorkspaceStore.checkHarnessAssets(harnessId, item.itemId);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: checkHarnessAssets failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  const handleRemove = useCallback(async (item: CatalogGlobalItem) => {
    try {
      await catalogWorkspaceStore.uninstallHarnessAsset(harnessId, item.itemId);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: uninstallHarnessAsset failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  const handleActivate = useCallback(async (item: CatalogGlobalItem, hs: CatalogGlobalHarnessState) => {
    const metadata = hs.metadata as Record<string, unknown> | null;
    const installableId = (metadata?.installableId as string | undefined) || item.itemId;
    if (!item.sourceId) return;
    try {
      await catalogWorkspaceStore.activateExternalSourceInstallable({
        sourceId: item.sourceId,
        installableId,
        target: harnessId,
      });
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: activateExternalSourceInstallable failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  const handleDeactivate = useCallback(async (item: CatalogGlobalItem, hs: CatalogGlobalHarnessState) => {
    const metadata = hs.metadata as Record<string, unknown> | null;
    const installableId = (metadata?.installableId as string | undefined) || item.itemId;
    if (!item.sourceId) return;
    try {
      await catalogWorkspaceStore.deactivateExternalSourceInstallable({
        sourceId: item.sourceId,
        installableId,
        target: harnessId,
      });
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: deactivateExternalSourceInstallable failed', err);
    } finally {
      onRefresh?.();
    }
  }, [harnessId, onRefresh]);

  function renderActionButtons(item: CatalogGlobalItem, hs: CatalogGlobalHarnessState): React.ReactNode {
    const actionInfo = getHarnessPrimaryAction(hs, mutating || storeState.mutating);
    const removeInfo = canRemoveAsset(hs);
    const isConfirming = confirmRemove === item.itemId;

    // External source actions
    const actionKind =
      ((hs.metadata as Record<string, unknown> | null)?.actionKind as string | undefined) ||
      item.actions?.kind;

    if (actionKind === 'external-source') {
      return (
        <div className="harness-table-cell-actions">
          {hs.actions?.canDeactivate && (hs.active || hs.installed) ? (
            <button
              className="button button-sm button-secondary"
              disabled={mutating || storeState.mutating}
              onClick={(e) => {
                e.stopPropagation();
                void handleDeactivate(item, hs);
              }}
              type="button"
            >
              Deactivate
            </button>
          ) : hs.actions?.canActivate ? (
            <button
              className="button button-sm button-primary"
              disabled={mutating || storeState.mutating}
              onClick={(e) => {
                e.stopPropagation();
                void handleActivate(item, hs);
              }}
              type="button"
            >
              Activate
            </button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="harness-table-cell-actions">
        {actionInfo.action === 'install' && (
          <button
            className="button button-sm button-primary"
            disabled={actionInfo.disabled}
            title={actionInfo.disabledReason}
            data-testid={`harness-install-btn-${item.itemId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleInstall();
            }}
            type="button"
          >
            {actionInfo.label}
          </button>
        )}
        {actionInfo.action === 'sync-update' && (
          <button
            className="button button-sm button-secondary"
            disabled={actionInfo.disabled}
            data-testid={`harness-sync-btn-${item.itemId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleSyncUpdate();
            }}
            type="button"
          >
            {actionInfo.label}
          </button>
        )}
        {actionInfo.action === 'check' && (
          <button
            className="button button-sm button-ghost"
            disabled={actionInfo.disabled}
            data-testid={`harness-check-btn-${item.itemId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleCheck(item);
            }}
            type="button"
          >
            {actionInfo.label}
          </button>
        )}
        {removeInfo.canRemove && !isConfirming && (
          <button
            className="button button-sm button-danger"
            disabled={mutating || storeState.mutating}
            data-testid={`harness-remove-btn-${item.itemId}`}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmRemove(item.itemId);
            }}
            type="button"
          >
            Remove
          </button>
        )}
        {isConfirming && (
          <span className="harness-table-confirm">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-warning-600)' }}>
              Confirm?
            </span>
            <button
              className="button button-sm button-danger"
              disabled={mutating || storeState.mutating}
              data-testid={`harness-remove-confirm-btn-${confirmRemove}`}
              onClick={(e) => {
                e.stopPropagation();
                void handleRemove(item);
              }}
              type="button"
            >
              Yes
            </button>
            <button
              className="button button-sm button-ghost"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmRemove(null);
              }}
              type="button"
            >
              No
            </button>
          </span>
        )}
      </div>
    );
  }

  if (harnessItems.length === 0) {
    return (
      <div
        className="harness-table-empty"
        data-testid={`harness-tab-${harnessId}-empty`}
      >
        No assets found for this harness.
      </div>
    );
  }

  return (
    <>
      <div className="harness-tab" data-testid={`harness-tab-${harnessId}`}>
        <div className="harness-table">
          {/* Header row */}
          <div className="harness-table-header">
            <span>Asset Name</span>
            <span>Kind</span>
            <span>Source</span>
            <span>Compatibility</span>
            <span>State</span>
            <span>Issues</span>
            <span>Install Path</span>
            <span>Actions</span>
          </div>

          {/* Data rows */}
          {harnessItems.map(({ item, hs }) => {
            const provenance = normalizeProvenance(
              item.readPath,
              item.sourceId,
              item.sourceType,
            );
            const compatLabel = getCompatibilityLabel(harnessId, hs);
            const stateLabel = getHarnessStateLabel(hs);
            const stateBadgeClass = getHarnessStateBadgeClass(hs);
            const warningsCount = hs.warnings?.length || 0;
            const errorsCount = hs.errors?.length || 0;
            const issuesTotal = warningsCount + errorsCount;

            return (
              <div
                key={item.itemId}
                className="harness-table-row"
                data-testid={`harness-tab-item-${item.itemId}`}
              >
                {/* Title — clickable, opens detail modal */}
                <div className="harness-table-cell">
                  <span
                    className="harness-table-cell-title"
                    onClick={() => setModalItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setModalItem(item);
                      }
                    }}
                  >
                    {item.title}
                  </span>
                </div>

                {/* Kind badge */}
                <div className="harness-table-cell">
                  <span className="harness-table-cell-kind">{item.kind}</span>
                </div>

                {/* Provenance group */}
                <div className="harness-table-cell">
                  <span className="harness-table-cell-provenance">
                    {provenance.group}
                  </span>
                </div>

                {/* Compatibility */}
                <div className="harness-table-cell">
                  <span className="harness-table-cell-compat">{compatLabel}</span>
                </div>

                {/* State badge */}
                <div className="harness-table-cell">
                  <span className={stateBadgeClass}>{stateLabel}</span>
                </div>

                {/* Issues count */}
                <div className="harness-table-cell">
                  <span className="harness-table-cell-issues">
                    {issuesTotal > 0
                      ? `${issuesTotal} issue${issuesTotal !== 1 ? 's' : ''}`
                      : ''}
                  </span>
                </div>

                {/* Install path (truncated) */}
                <div className="harness-table-cell">
                  <span
                    className="harness-table-cell-path"
                    title={hs.installPath || undefined}
                  >
                    {hs.installPath || ''}
                  </span>
                </div>

                {/* Action buttons */}
                <div className="harness-table-cell">
                  {renderActionButtons(item, hs)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail modal */}
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
    </>
  );
}
