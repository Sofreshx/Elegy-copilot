/**
 * Shared UI helpers for harness state labels, badge tones,
 * compatibility labels, and primary action determination.
 */
import type { CatalogGlobalHarnessState, CatalogManagementMetadata, CatalogManagementOwner, CatalogManagementScope } from '../../lib/types';

export function getManagementMetadata(
  hs: CatalogGlobalHarnessState | null | undefined,
): CatalogManagementMetadata {
  const raw = hs?.management;
  if (!raw) {
    return {
      owner: 'elegy',
      sourceOfTruth: 'elegy-catalog',
      scope: 'global',
      readOnly: false,
    };
  }
  const ownerValue = String(raw.owner || '').trim().toLowerCase();
  const owner: CatalogManagementOwner = ['harness', 'harness-owned', 'native'].includes(ownerValue)
    ? 'harness'
    : ['repository', 'repo', 'repo-owned'].includes(ownerValue)
      ? 'repository'
      : ['external', 'third-party'].includes(ownerValue)
        ? 'external'
        : 'elegy';
  const scopeValue = String(raw.scope || '').trim().toLowerCase();
  const scope: CatalogManagementScope = ['repo', 'repo-local', 'repository', 'repository-local'].includes(scopeValue)
    ? 'repo'
    : ['user', 'user-global'].includes(scopeValue)
      ? 'user'
      : scopeValue === 'external'
        ? 'external'
        : 'global';
  const readOnly = raw.readOnly === true || owner === 'harness' || owner === 'repository';
  return {
    ...raw,
    owner,
    scope,
    readOnly,
    readOnlyReason: readOnly
      ? raw.readOnlyReason || (owner === 'harness' ? 'Managed by the harness.' : owner === 'repository' ? 'Managed by the repository.' : null)
      : null,
  };
}

export function getManagementOwner(
  hs: CatalogGlobalHarnessState | null | undefined,
): CatalogManagementOwner {
  return getManagementMetadata(hs).owner || 'elegy';
}

export function getManagementOwnerLabel(
  hs: CatalogGlobalHarnessState | null | undefined,
): string {
  switch (getManagementOwner(hs)) {
    case 'harness': return 'Harness-owned';
    case 'repository': return 'Repository-owned';
    case 'external': return 'External';
    default: return 'Elegy-managed';
  }
}

export function getManagementOwnerClass(
  hs: CatalogGlobalHarnessState | null | undefined,
): string {
  return `asset-owner-badge asset-owner-badge--${String(getManagementOwner(hs)).replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
}

export function getManagementScope(
  hs: CatalogGlobalHarnessState | null | undefined,
): CatalogManagementScope {
  return getManagementMetadata(hs).scope || 'global';
}

export function getManagementScopeLabel(
  hs: CatalogGlobalHarnessState | null | undefined,
): string {
  switch (getManagementScope(hs)) {
    case 'repo': return 'Repository';
    case 'user': return 'User';
    case 'external': return 'External';
    default: return 'Global';
  }
}

export function isHarnessReadOnly(
  hs: CatalogGlobalHarnessState | null | undefined,
): boolean {
  return getManagementMetadata(hs).readOnly === true;
}

/* ── User-facing state labels ── */

export type HarnessDisplayState =
  | 'Installed'
  | 'Needs sync'
  | 'Not installed'
  | 'Available'
  | 'Active'
  | 'Conflict'
  | 'Unmanaged'
  | 'External'
  | 'Unsupported';

/** Map backend state string (plus installed/active booleans) to a user-facing label. */
export function getHarnessStateLabel(
  hs: CatalogGlobalHarnessState | null | undefined,
): HarnessDisplayState {
  if (!hs || !hs.supported) return 'Unsupported';
  const state: string = hs.state || hs.syncStatus || '';
  if (state === 'conflict') return 'Conflict';
  if (state === 'unmanaged') return 'Unmanaged';
  if (state === 'external-managed') return 'External';
  if (state === 'installed' || state === 'synced') {
    // Distinguish "Needs sync" vs pure "Installed"
    if (hs.actions?.canSync && !hs.actions?.canInstall) return 'Needs sync';
    return 'Installed';
  }
  if (state === 'stale') return 'Needs sync';
  if (state === 'available') return 'Available';
  if (state === 'not-installed' || state === 'missing') return 'Not installed';
  if (hs.installed) return 'Installed';
  if (hs.active && !hs.installed) return 'Active';
  return 'Available';
}

/* ── Badge CSS class ── */

/** Return a CSS class for the state badge. */
export function getHarnessStateBadgeClass(
  hs: CatalogGlobalHarnessState | null | undefined,
): string {
  const label = getHarnessStateLabel(hs);
  switch (label) {
    case 'Installed': return 'state-badge state-badge--ok';
    case 'Needs sync': return 'state-badge state-badge--warn';
    case 'Not installed': return 'state-badge state-badge--warn';
    case 'Available': return 'state-badge state-badge--muted';
    case 'Active': return 'state-badge state-badge--ok';
    case 'Conflict': return 'state-badge state-badge--error';
    case 'Unmanaged': return 'state-badge state-badge--warn';
    case 'External': return 'state-badge state-badge--muted';
    case 'Unsupported': return 'state-badge state-badge--muted';
    default: return 'state-badge state-badge--muted';
  }
}

/* ── Compatibility label ── */

/** Return human-readable compatibility text. */
export function getCompatibilityLabel(
  harnessId: string,
  hs: CatalogGlobalHarnessState | null | undefined,
): string {
  if (!hs) return `Not supported by ${harnessLabel(harnessId)}`;
  if (!hs.supported) return `Not supported by ${harnessLabel(harnessId)}`;
  return `Compatible with ${harnessLabel(harnessId)}`;
}

function harnessLabel(harnessId: string): string {
  switch (harnessId) {
    case 'codex': return 'Codex';
    case 'opencode': return 'OpenCode';
    case 'claude-code': return 'Claude Code';
    case 'antigravity': return 'Antigravity';
    case 'copilot': return 'Copilot';
    default: return harnessId;
  }
}

/* ── Primary action determination ── */

export type HarnessAction =
  | 'install'
  | 'sync-update'
  | 'check'
  | 'remove'
  | 'activate'
  | 'deactivate'
  | null;

export interface HarnessActionInfo {
  action: HarnessAction;
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

/** Determine the primary action for a harness state row. */
export function getHarnessPrimaryAction(
  hs: CatalogGlobalHarnessState,
  mutating?: boolean,
): HarnessActionInfo {
  const state: string = hs.state || hs.syncStatus || '';
  const targets = (hs.actions?.installSurfaceTargets as string[] | undefined) || [];

  if (isHarnessReadOnly(hs)) {
    return state === 'available'
      ? { action: null, label: 'Read-only', disabled: true, disabledReason: getManagementMetadata(hs).readOnlyReason || 'Managed by the harness' }
      : { action: 'check', label: 'Inspect', disabled: !!mutating };
  }

  // External-source actions
  const actionKind = (hs.metadata as Record<string, unknown> | null)?.actionKind as string | undefined;
  if (actionKind === 'external-source') {
    if (hs.actions?.canDeactivate && (hs.active || hs.installed)) {
      return { action: 'deactivate', label: 'Deactivate', disabled: !!mutating };
    }
    if (hs.actions?.canActivate) {
      return { action: 'activate', label: 'Activate', disabled: !!mutating };
    }
    return { action: 'check', label: 'Check', disabled: !!mutating };
  }

  // External-managed assets are view-only (managed by secondary ledger)
  if (state === 'external-managed') {
    return { action: null, label: 'External', disabled: true, disabledReason: 'Managed by another system' };
  }

  // Catalog-asset actions
  if (state === 'available' || state === 'not-installed' || state === 'missing') {
    return {
      action: targets.length > 0 ? 'install' : null,
      label: 'Install',
      disabled: !!mutating || targets.length === 0,
      disabledReason: targets.length === 0 ? 'No install target' : undefined,
    };
  }

  if (state === 'stale') {
    return { action: 'sync-update', label: 'Sync / Update', disabled: !!mutating };
  }

  if (state === 'installed' || state === 'synced') {
    const canSync = hs.actions?.canSync;
    if (canSync) {
      return { action: 'sync-update', label: 'Sync / Update', disabled: !!mutating };
    }
    return { action: 'check', label: 'Check', disabled: !!mutating };
  }

  if (state === 'conflict' || state === 'unmanaged') {
    return { action: 'check', label: 'Inspect', disabled: !!mutating };
  }

  return { action: null, label: '', disabled: true };
}

/** Check if a deactivate action should be available (safe removal of managed asset). */
export function canDeactivateAsset(
  hs: CatalogGlobalHarnessState,
): { canDeactivate: boolean; blockedReason?: string } {
  const state: string = hs.state || hs.syncStatus || '';
  if (isHarnessReadOnly(hs)) {
    return { canDeactivate: false, blockedReason: getManagementMetadata(hs).readOnlyReason || 'Asset is managed by the harness' };
  }
  if (state === 'conflict' || state === 'unmanaged') {
    return { canDeactivate: false, blockedReason: 'Asset is externally modified or not tracked' };
  }
  if (state === 'external-managed') {
    return { canDeactivate: false, blockedReason: 'Asset is managed by another system' };
  }
  if (state === 'installed' || state === 'synced' || state === 'stale') {
    return { canDeactivate: true };
  }
  return { canDeactivate: false };
}

/** Return all valid per-row actions for a harness asset (not just primary). */
export function getHarnessRowActions(
  hs: CatalogGlobalHarnessState,
  mutating?: boolean,
): HarnessActionInfo[] {
  const actions: HarnessActionInfo[] = [];
  const state: string = hs.state || hs.syncStatus || '';
  const actionKind = (hs.metadata as Record<string, unknown> | null)?.actionKind as string | undefined;

  if (isHarnessReadOnly(hs)) {
    return state === 'available'
      ? []
      : [{ action: 'check', label: 'Inspect', disabled: !!mutating }];
  }

  // External-source assets: keep existing activate/deactivate only
  if (actionKind === 'external-source') {
    if (hs.actions?.canDeactivate && (hs.active || hs.installed)) {
      actions.push({ action: 'deactivate', label: 'Deactivate', disabled: !!mutating });
    }
    if (hs.actions?.canActivate) {
      actions.push({ action: 'activate', label: 'Activate', disabled: !!mutating });
    }
    if (!hs.actions?.canDeactivate && !hs.actions?.canActivate) {
      actions.push({ action: 'check', label: 'Check', disabled: !!mutating });
    }
    return actions;
  }

  // External-managed: check only (view-only)
  if (state === 'external-managed') {
    actions.push({ action: 'check', label: 'Check', disabled: !!mutating });
    return actions;
  }

  // Check is always available for non-available states
  if (state !== 'available') {
    actions.push({ action: 'check', label: 'Check', disabled: !!mutating });
  }

  // Activate (install) when available or not-installed
  if (state === 'available' || state === 'not-installed' || state === 'missing') {
    if (hs.actions?.canInstall) {
      actions.push({ action: 'install', label: 'Activate', disabled: !!mutating });
    }
  }

  // Sync when installed or stale and canSync
  if ((state === 'installed' || state === 'synced' || state === 'stale') && hs.actions?.canSync) {
    actions.push({ action: 'sync-update', label: 'Sync', disabled: !!mutating });
  }

  // Deactivate (uninstall) when safe
  const deactivateInfo = canDeactivateAsset(hs);
  if (deactivateInfo.canDeactivate) {
    actions.push({ action: 'remove', label: 'Deactivate', disabled: !!mutating });
  }

  return actions;
}
