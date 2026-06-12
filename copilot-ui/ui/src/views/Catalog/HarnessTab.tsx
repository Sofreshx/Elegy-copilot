import React, { useMemo, useState, useCallback } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';
import { useStoreValue } from '../../lib/store';
import Button from '../../components/Button';
import AssetDetailModal from './AssetDetailModal';
import {
  getHarnessStateLabel,
  getHarnessStateBadgeClass,
  getCompatibilityLabel,
  canDeactivateAsset,
  getHarnessRowActions,
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
  const [mutatingAssetId, setMutatingAssetId] = useState<string | null>(null);
  const [harnessMessage, setHarnessMessage] = useState<string | null>(null);
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
    setHarnessMessage('Installing harness assets...');
    try {
      await catalogWorkspaceStore.installSurface(harnessId as 'codex' | 'opencode' | 'antigravity' | 'claude');
      setHarnessMessage(`Install completed for ${harnessId}.`);
    } catch (err) {
      console.error('HarnessTab: installSurface failed', err);
      setHarnessMessage(`Install failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  const handleSyncUpdate = useCallback(async () => {
    setHarnessMessage('Syncing harness assets...');
    try {
      await catalogWorkspaceStore.installSurface(harnessId as 'codex' | 'opencode' | 'antigravity' | 'claude');
      setHarnessMessage(`Sync completed for ${harnessId}.`);
    } catch (err) {
      console.error('HarnessTab: installSurface (sync) failed', err);
      setHarnessMessage(`Sync failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  const handleCheck = useCallback(async (item: CatalogGlobalItem) => {
    setMutatingAssetId(item.itemId);
    try {
      const results = await catalogWorkspaceStore.checkHarnessAssets(harnessId, item.itemId);
      const result = results.find(r => r.assetId === item.itemId);
      if (result) {
        setHarnessMessage(`Check: ${result.state}${result.warnings?.length ? ` (${result.warnings.length} warning(s))` : ''}`);
      }
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: checkHarnessAssets failed', err);
      setHarnessMessage(`Check failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setMutatingAssetId(null);
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  const handleDeactivate = useCallback(async (item: CatalogGlobalItem) => {
    setMutatingAssetId(item.itemId);
    try {
      await catalogWorkspaceStore.uninstallHarnessAsset(harnessId, item.itemId);
      setHarnessMessage(`Deactivated ${item.itemId}.`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: uninstallHarnessAsset failed', err);
      setHarnessMessage(`Deactivate failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setMutatingAssetId(null);
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  const handleActivate = useCallback(async (item: CatalogGlobalItem, hs: CatalogGlobalHarnessState) => {
    setMutatingAssetId(item.itemId);
    const metadata = hs.metadata as Record<string, unknown> | null;
    const installableId = (metadata?.installableId as string | undefined) || item.itemId;
    if (!item.sourceId) return;
    try {
      await catalogWorkspaceStore.activateExternalSourceInstallable({
        sourceId: item.sourceId,
        installableId,
        target: harnessId,
      });
      setHarnessMessage(`Activated ${item.title}.`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: activateExternalSourceInstallable failed', err);
      setHarnessMessage(`Activate failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setMutatingAssetId(null);
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  const handleExternalDeactivate = useCallback(async (item: CatalogGlobalItem, hs: CatalogGlobalHarnessState) => {
    setMutatingAssetId(item.itemId);
    const metadata = hs.metadata as Record<string, unknown> | null;
    const installableId = (metadata?.installableId as string | undefined) || item.itemId;
    if (!item.sourceId) return;
    try {
      await catalogWorkspaceStore.deactivateExternalSourceInstallable({
        sourceId: item.sourceId,
        installableId,
        target: harnessId,
      });
      setHarnessMessage(`Deactivated ${item.title}.`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: deactivateExternalSourceInstallable failed', err);
      setHarnessMessage(`Deactivate failed: ${String(err)}`);
    } finally {
      onRefresh?.();
      setMutatingAssetId(null);
      setTimeout(() => setHarnessMessage(null), 8000);
    }
  }, [harnessId, onRefresh]);

  function renderActionButtons(item: CatalogGlobalItem, hs: CatalogGlobalHarnessState): React.ReactNode {
    const isConfirming = confirmRemove === item.itemId;
    const rowMutating = mutatingAssetId === item.itemId || mutating || storeState.mutating || false;
    const rowActions = getHarnessRowActions(hs, rowMutating);

    // External source actions (existing behavior)
    const actionKind =
      ((hs.metadata as Record<string, unknown> | null)?.actionKind as string | undefined) ||
      item.actions?.kind;

    if (actionKind === 'external-source') {
      return (
        <div className="harness-table-cell-actions">
          {rowActions.map((actionInfo, idx) => (
            <Button
              key={`${actionInfo.action}-${idx}`}
              variant={actionInfo.action === 'deactivate' ? 'secondary' : 'primary'}
              size="sm"
              disabled={actionInfo.disabled}
              loading={rowMutating && actionInfo.action !== 'check'}
              onClick={(e) => {
                e.stopPropagation();
                if (actionInfo.action === 'activate') void handleActivate(item, hs);
                else if (actionInfo.action === 'deactivate') void handleExternalDeactivate(item, hs);
                else if (actionInfo.action === 'check') void handleCheck(item);
              }}
            >
              {actionInfo.label}
            </Button>
          ))}
        </div>
      );
    }

    return (
      <div className="harness-table-cell-actions">
        {rowActions.map((actionInfo, idx) => {
          const isDeactivate = actionInfo.action === 'remove';
          const isLoading = rowMutating && !isDeactivate;

          if (isDeactivate && isConfirming) {
            return (
              <span key={`confirm-${idx}`} className="harness-table-confirm">
                <span style={{ fontSize: '0.75rem', color: 'var(--color-warning-600)' }}>
                  Confirm?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={rowMutating}
                  loading={rowMutating}
                  testId={`harness-remove-confirm-btn-${confirmRemove}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeactivate(item);
                  }}
                >
                  Yes
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmRemove(null);
                  }}
                >
                  No
                </Button>
              </span>
            );
          }

          if (isDeactivate) {
            return (
              <Button
                key={`${actionInfo.action}-${idx}`}
                variant="danger"
                size="sm"
                disabled={actionInfo.disabled}
                testId={`harness-remove-btn-${item.itemId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmRemove(item.itemId);
                }}
              >
                {actionInfo.label}
              </Button>
            );
          }

          return (
            <Button
              key={`${actionInfo.action}-${idx}`}
              variant={actionInfo.action === 'install' ? 'primary' : actionInfo.action === 'sync-update' ? 'secondary' : 'ghost'}
              size="sm"
              disabled={actionInfo.disabled}
              loading={isLoading}
              testId={`harness-${actionInfo.action}-btn-${item.itemId}`}
              onClick={(e) => {
                e.stopPropagation();
                if (actionInfo.action === 'install') void handleInstall();
                else if (actionInfo.action === 'sync-update') void handleSyncUpdate();
                else if (actionInfo.action === 'check') void handleCheck(item);
              }}
            >
              {actionInfo.label}
            </Button>
          );
        })}
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
      <div className="harness-tab" data-testid={`harness-tab-${harnessId}`} style={{ minHeight: '300px' }}>
        <div className="harness-tab-header">
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
            {harnessId === 'codex' ? 'Codex' : harnessId === 'opencode' ? 'OpenCode' : harnessId === 'claude-code' ? 'Claude Code' : harnessId}
          </h3>
          <Button
            variant="secondary"
            size="sm"
            disabled={mutating || storeState.mutating || false}
            loading={mutating || storeState.installing || false}
            testId={`harness-refresh-all-${harnessId}`}
            onClick={(e) => {
              e.stopPropagation();
              void handleSyncUpdate();
            }}
          >
            Refresh all
          </Button>
        </div>
        {harnessMessage && (
          <div className="harness-tab-message" data-testid={`harness-message-${harnessId}`}>
            {harnessMessage}
          </div>
        )}
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
