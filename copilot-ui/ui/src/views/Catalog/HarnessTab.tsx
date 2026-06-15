import React, { useMemo, useState, useCallback } from 'react';
import type { CatalogGlobalItem, CatalogGlobalSection, CatalogGlobalHarness, CatalogGlobalHarnessState } from '../../lib/types';
import { catalogWorkspaceStore } from '../../tabs/Assets/catalogWorkspaceStore';
import { useStoreValue } from '../../lib/store';
import Badge from '../../components/Badge';
import Button from '../../components/Button';
import { notificationStore } from '../../stores/notificationStore';
import AssetDetailModal from './AssetDetailModal';
import {
  getHarnessStateLabel,
  getHarnessStateBadgeClass,
  getHarnessRowActions,
} from './harnessStateHelper';
import { normalizeProvenance } from './provenance';

interface LastCheckResult {
  state: string;
  drift?: boolean;
  warnings?: string[];
  timestamp: number;
}

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
  const [lastCheckResults, setLastCheckResults] = useState<Map<string, LastCheckResult>>(new Map());
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
      notificationStore.success(`Install completed for ${harnessId}`);
    } catch (err) {
      console.error('HarnessTab: installSurface failed', err);
      setHarnessMessage(`Install failed: ${String(err)}`);
      notificationStore.error(`Install failed for ${harnessId}`, { message: String(err) });
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
      notificationStore.success(`Sync completed for ${harnessId}`);
    } catch (err) {
      console.error('HarnessTab: installSurface (sync) failed', err);
      setHarnessMessage(`Sync failed: ${String(err)}`);
      notificationStore.error(`Sync failed for ${harnessId}`, { message: String(err) });
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
        const warningCount = result.warnings?.length || 0;
        const message = warningCount > 0
          ? `Check: ${result.state} — ${warningCount} warning(s)`
          : `Check: ${result.state}`;
        notificationStore.success(`Checked ${item.title}`, { message });
        // Store last check result for inline display
        setLastCheckResults(prev => new Map(prev).set(item.itemId, {
          state: result.state,
          drift: result.drift,
          warnings: result.warnings,
          timestamp: Date.now(),
        }));
      }
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: checkHarnessAssets failed', err);
      notificationStore.error(`Check failed for ${item.title}`, { message: String(err) });
    } finally {
      setMutatingAssetId(null);
    }
  }, [harnessId]);

  const handleDeactivate = useCallback(async (item: CatalogGlobalItem) => {
    setMutatingAssetId(item.itemId);
    try {
      await catalogWorkspaceStore.uninstallHarnessAsset(harnessId, item.itemId);
      setHarnessMessage(`Deactivated ${item.itemId}.`);
      notificationStore.success(`Deactivated ${item.title}`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: uninstallHarnessAsset failed', err);
      setHarnessMessage(`Deactivate failed: ${String(err)}`);
      notificationStore.error(`Deactivate failed for ${item.title}`, { message: String(err) });
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
      notificationStore.success(`Activated ${item.title}`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: activateExternalSourceInstallable failed', err);
      setHarnessMessage(`Activate failed: ${String(err)}`);
      notificationStore.error(`Activate failed for ${item.title}`, { message: String(err) });
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
      notificationStore.success(`Deactivated ${item.title}`);
      setConfirmRemove(null);
    } catch (err) {
      console.error('HarnessTab: deactivateExternalSourceInstallable failed', err);
      setHarnessMessage(`Deactivate failed: ${String(err)}`);
      notificationStore.error(`Deactivate failed for ${item.title}`, { message: String(err) });
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
        <div className="harness-card-actions">
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
          <Button variant="ghost" size="sm" onClick={() => setModalItem(item)}>
            Details
          </Button>
        </div>
      );
    }

    return (
      <div className="harness-card-actions">
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
                <Button variant="ghost" size="sm" onClick={() => setModalItem(item)}>
                  Details
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

          const buttons = (
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
              {actionInfo.action === 'sync-update' ? (hs.state === 'stale' ? 'Sync' : 'Reinstall') : actionInfo.label}
            </Button>
          );

          return (
            <React.Fragment key={`${actionInfo.action}-${idx}`}>
              {buttons}
            </React.Fragment>
          );
        })}
        <Button variant="ghost" size="sm" onClick={() => setModalItem(item)}>
          Details
        </Button>
      </div>
    );
  }

  if (harnessItems.length === 0) {
    return (
      <div
        className="harness-card-empty"
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {harnessItems.map(({ item, hs }) => {
            const provenance = normalizeProvenance(
              item.readPath,
              item.sourceId,
              item.sourceType,
            );
            const stateLabel = getHarnessStateLabel(hs);
            const stateBadgeClass = getHarnessStateBadgeClass(hs);
            const warningsCount = hs.warnings?.length || 0;
            const errorsCount = hs.errors?.length || 0;
            const issuesTotal = warningsCount + errorsCount;
            const kindBadgeTone = item.kind === 'skill' ? 'accent' : item.kind === 'agent' ? 'brand' : 'neutral';

            return (
              <div
                key={item.itemId}
                className="harness-card"
                data-testid={`harness-card-${item.itemId}`}
              >
                <div className="harness-card-header">
                  <span
                    className="harness-card-title"
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
                  <Badge tone={kindBadgeTone}>{item.kind}</Badge>
                  <span className="harness-card-provenance">{provenance.group}</span>
                </div>
                <div className="harness-card-meta">
                  <span className={stateBadgeClass}>{stateLabel}</span>
                  {issuesTotal > 0 && <span className="harness-card-issues">{issuesTotal} issue(s)</span>}
                  {(() => {
                    const meta = (hs.metadata || {}) as Record<string, unknown>;
                    const detail = (item.detail || {}) as Record<string, unknown>;
                    const version = meta.version || meta.currentVersion || meta.installedVersion || detail.version || detail.currentVersion || detail.installedVersion;
                    if (version && typeof version === 'string') {
                      return <span className="harness-card-version" style={{ fontSize: '0.72rem', color: 'var(--color-ink-600)', fontWeight: 500 }}>v{version}</span>;
                    }
                    return null;
                  })()}
                </div>
                {lastCheckResults.get(item.itemId) && (
                  <div className="harness-card-check-result">
                    Last checked: {lastCheckResults.get(item.itemId)!.state}
                    {lastCheckResults.get(item.itemId)!.drift ? ' · Drift detected' : ''}
                    {lastCheckResults.get(item.itemId)!.warnings?.length ? ` · ${lastCheckResults.get(item.itemId)!.warnings!.length} warning(s)` : ''}
                  </div>
                )}
                <div className="harness-card-actions">
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
