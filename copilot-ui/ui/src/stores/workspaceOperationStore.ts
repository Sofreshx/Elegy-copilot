import { createStore } from '../lib/store';
import type { GitState } from './gitStore';
import type { ChecksStoreState } from './checksStore';
import type { DriveSyncStatus, GitStatus, VaultStatus } from '../lib/api/notes';

export type WorkspaceOperationStatus = 'ready' | 'attention' | 'blocked' | 'running' | 'unknown';

export type WorkspaceOperationId =
  | 'git.commit'
  | 'git.push'
  | 'git.pull'
  | 'git.pr'
  | 'checks.run'
  | 'notes.export'
  | 'notes.import'
  | 'notes.drive.push'
  | 'notes.drive.pull'
  | 'notes.git.snapshot';

export type WorkspaceOperationSource = 'git' | 'checks' | 'notes';
export type WorkspaceOperationSeverity = 'attention' | 'blocked';
export type WorkspaceTargetTab = 'git' | 'checks' | 'notes';

export interface WorkspaceBlocker {
  id: string;
  severity: WorkspaceOperationSeverity;
  source: WorkspaceOperationSource;
  title: string;
  detail: string;
  actionLabel?: string;
  targetTab?: WorkspaceTargetTab;
}

export interface WorkspaceNextAction {
  id: WorkspaceOperationId;
  label: string;
  targetTab?: WorkspaceTargetTab;
}

export interface WorkspaceOperationSnapshot {
  repoPath: string | null;
  status: WorkspaceOperationStatus;
  activeOperations: WorkspaceOperationId[];
  blockers: WorkspaceBlocker[];
  staleReasons: string[];
  nextAction: WorkspaceNextAction | null;
  lastUpdated: string;
}

export interface NotesOperationState {
  vaultStatus?: VaultStatus | null;
  gitStatus?: GitStatus | null;
  driveSync?: DriveSyncStatus | null;
  busyAction?: string | null;
}

export interface WorkspaceOperationInputs {
  repoPath: string | null;
  gitState?: GitState | null;
  checksState?: ChecksStoreState | null;
  notesState?: NotesOperationState | null;
  now?: string;
}

const INITIAL_SNAPSHOT: WorkspaceOperationSnapshot = {
  repoPath: null,
  status: 'unknown',
  activeOperations: [],
  blockers: [],
  staleReasons: [],
  nextAction: null,
  lastUpdated: new Date(0).toISOString(),
};

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function addBlocker(blockers: WorkspaceBlocker[], blocker: WorkspaceBlocker) {
  if (!blockers.some((existing) => existing.id === blocker.id)) {
    blockers.push(blocker);
  }
}

function isChecksFailed(checksState?: ChecksStoreState | null): boolean {
  if (!checksState) return false;
  if (checksState.runSession?.outcome === 'fail' || checksState.runSession?.outcome === 'error') return true;
  if (checksState.checkResults && checksState.checkResults.allPassed === false) return true;
  if (checksState.checkState?.lastRun && checksState.checkState.lastRun.overallPass === false) return true;
  return false;
}

function isChecksFresh(checksState?: ChecksStoreState | null): boolean | null {
  if (!checksState) return null;
  if (checksState.checkState?.freshness) return checksState.checkState.freshness.fresh;
  if (checksState.checkResults) return true;
  if (checksState.checkState?.lastRun) return true;
  return null;
}

function getChecksStaleReason(checksState?: ChecksStoreState | null): string | null {
  const freshness = checksState?.checkState?.freshness;
  if (!freshness || freshness.fresh) return null;
  return freshness.reason || 'checks are stale';
}

function deriveNotesDriveBlockers(notesState: NotesOperationState | null | undefined, blockers: WorkspaceBlocker[]) {
  if (!notesState) return;
  const { vaultStatus, driveSync } = notesState;

  if (vaultStatus && (!vaultStatus.configured || !vaultStatus.vaultExists)) {
    addBlocker(blockers, {
      id: 'notes.vault.missing',
      severity: 'blocked',
      source: 'notes',
      title: 'Notes vault is not ready',
      detail: vaultStatus.vaultPath ? `Vault path is unavailable: ${vaultStatus.vaultPath}` : 'Configure a vault path before importing, exporting, or syncing notes.',
      actionLabel: 'Open Notes',
      targetTab: 'notes',
    });
    return;
  }

  if (!driveSync) return;

  if (!driveSync.rcloneInstalled) {
    addBlocker(blockers, {
      id: 'notes.drive.rclone-missing',
      severity: 'blocked',
      source: 'notes',
      title: 'rclone is not installed',
      detail: 'Install rclone before Google Drive sync can run.',
      actionLabel: 'Setup Drive',
      targetTab: 'notes',
    });
    return;
  }

  if (!driveSync.rcloneConfigured) {
    addBlocker(blockers, {
      id: 'notes.drive.remote-missing',
      severity: 'blocked',
      source: 'notes',
      title: 'Drive remote is not configured',
      detail: `Create an rclone remote for ${driveSync.gdriveFolderName || 'DevVault'}.`,
      actionLabel: 'Setup Drive',
      targetTab: 'notes',
    });
    return;
  }

  if (!driveSync.authenticated) {
    addBlocker(blockers, {
      id: 'notes.drive.auth-missing',
      severity: 'blocked',
      source: 'notes',
      title: 'Drive remote is not authenticated',
      detail: 'Verify the rclone remote before pushing or pulling notes.',
      actionLabel: 'Verify Drive',
      targetTab: 'notes',
    });
    return;
  }

  if (!driveSync.driveFolderExists) {
    addBlocker(blockers, {
      id: 'notes.drive.folder-missing',
      severity: 'attention',
      source: 'notes',
      title: 'Drive folder has not been created',
      detail: 'The next push can create the Drive folder if the remote is ready.',
      actionLabel: 'Push to Drive',
      targetTab: 'notes',
    });
  }
}

export function deriveWorkspaceOperationSnapshot({
  repoPath,
  gitState,
  checksState,
  notesState,
  now = new Date().toISOString(),
}: WorkspaceOperationInputs): WorkspaceOperationSnapshot {
  const activeOperations: WorkspaceOperationId[] = [];
  const blockers: WorkspaceBlocker[] = [];
  const staleReasons: string[] = [];

  if (!repoPath) {
    return {
      ...INITIAL_SNAPSHOT,
      lastUpdated: now,
    };
  }

  if (gitState?.committing) activeOperations.push('git.commit');
  if (gitState?.syncing) activeOperations.push('git.push');
  if (gitState?.creatingPullRequest) activeOperations.push('git.pr');
  if (checksState?.runningChecks || checksState?.runSession?.outcome === 'running') activeOperations.push('checks.run');

  if (notesState?.busyAction === 'export-json' || notesState?.busyAction === 'export-markdown') activeOperations.push('notes.export');
  if (notesState?.busyAction === 'import') activeOperations.push('notes.import');
  if (notesState?.busyAction === 'push') activeOperations.push('notes.drive.push');
  if (notesState?.busyAction === 'pull') activeOperations.push('notes.drive.pull');
  if (notesState?.busyAction === 'commit' || notesState?.busyAction === 'init') activeOperations.push('notes.git.snapshot');

  const checksFailed = isChecksFailed(checksState);
  if (checksFailed) {
    addBlocker(blockers, {
      id: 'checks.failed',
      severity: 'blocked',
      source: 'checks',
      title: 'Checks are failing',
      detail: 'Resolve failed lanes before treating commit or push as safe.',
      actionLabel: 'Open Checks',
      targetTab: 'checks',
    });
  }

  const checksFresh = isChecksFresh(checksState);
  const staleReason = getChecksStaleReason(checksState);
  if (checksFresh === false || staleReason) {
    const reason = staleReason || 'checks are stale';
    staleReasons.push(reason);
    addBlocker(blockers, {
      id: 'checks.stale',
      severity: 'blocked',
      source: 'checks',
      title: 'Checks are stale',
      detail: reason,
      actionLabel: 'Run Checks',
      targetTab: 'checks',
    });
  }

  const summary = gitState?.summary;
  if ((summary?.behind ?? gitState?.status?.behind ?? 0) > 0) {
    staleReasons.push('branch is behind upstream');
    addBlocker(blockers, {
      id: 'git.behind',
      severity: 'attention',
      source: 'git',
      title: 'Branch is behind upstream',
      detail: 'Pull latest changes before pushing or opening a PR.',
      actionLabel: 'Pull',
      targetTab: 'git',
    });
  }

  if (gitState?.checkFailed) {
    addBlocker(blockers, {
      id: 'git.preaction-checks',
      severity: 'blocked',
      source: 'git',
      title: 'Pre-action checks require review',
      detail: 'Git commit or push was blocked by verification. Review the check output or provide an override reason.',
      actionLabel: 'Review Checks',
      targetTab: 'git',
    });
  }

  deriveNotesDriveBlockers(notesState, blockers);

  const uniqueActive = unique(activeOperations);
  const hasBlocked = blockers.some((blocker) => blocker.severity === 'blocked');
  const hasAttention = blockers.some((blocker) => blocker.severity === 'attention') || staleReasons.length > 0;
  const status: WorkspaceOperationStatus = uniqueActive.length > 0
    ? 'running'
    : hasBlocked
      ? 'blocked'
      : hasAttention
        ? 'attention'
        : 'ready';

  const topBlocker = blockers.find((blocker) => blocker.severity === 'blocked') || blockers[0] || null;
  const nextAction: WorkspaceNextAction | null = topBlocker?.actionLabel
    ? {
      id: topBlocker.source === 'checks'
        ? 'checks.run'
        : topBlocker.source === 'notes'
          ? 'notes.drive.push'
          : topBlocker.id === 'git.behind'
            ? 'git.pull'
            : 'git.push',
      label: topBlocker.actionLabel,
      targetTab: topBlocker.targetTab,
    } satisfies WorkspaceNextAction
    : status === 'ready'
      ? { id: 'git.commit', label: 'Ready', targetTab: 'git' }
      : null;

  return {
    repoPath,
    status,
    activeOperations: uniqueActive,
    blockers,
    staleReasons: unique(staleReasons),
    nextAction,
    lastUpdated: now,
  };
}

const store = createStore<WorkspaceOperationSnapshot>(INITIAL_SNAPSHOT);

export const workspaceOperationStore = {
  getState: store.getState,
  subscribe: store.subscribe,
  publish(inputs: WorkspaceOperationInputs): WorkspaceOperationSnapshot {
    const snapshot = deriveWorkspaceOperationSnapshot(inputs);
    store.setState(snapshot);
    return snapshot;
  },
  reset(): void {
    store.setState(INITIAL_SNAPSHOT);
  },
};
