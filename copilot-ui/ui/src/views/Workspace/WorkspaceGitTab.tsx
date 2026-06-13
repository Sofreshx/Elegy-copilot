import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import type { GitState } from '../../stores/gitStore';
import type {
  GitCheckResults,
  GitBranchEntry,
  MergeCandidate,
  MergeDryRunResponse,
  GitChecksDiscoverResponse,
  GitStashEntry,
  GitStashListResponse,
  GitStashOperationResponse,
  GitCheckStateResponse,
} from '../../lib/api/git';
import {
  getMergeCandidates,
  mergeDryRun,
  mergeLocal,
  pullGit,
  checkoutGitBranch,
  discoverGitChecks,
  mergeWorktree,
  commitGit,
  pushGit,
  runGitChecks,
  listStashes,
  createStash,
  applyStash,
  popStash,
  dropStash,
  getGitCheckState,
} from '../../lib/api/git';
import type { MergeWorktreeResponse } from '../../lib/api/git';
import { listExecutorWorktrees, analyzeWorktreeCleanup, removeWorktreeWithBranch } from '../../lib/api/executor';
import type { ExecutorWorktreeRecord, EnrichedWorktreeEntry } from '../../lib/types';
import { getEnrichedWorktrees } from '../../lib/api/elegyDb';
import type { VerificationState } from '../Repositories/verification';
import WorkspaceCommitGraph from './WorkspaceCommitGraph';

// ─── Inline worktree display helpers (from WorkspaceWorktreesCard) ──────────

const SOURCE_LABELS: Record<string, string> = {
  elegy: 'Elegy',
  opencode: 'OpenCode',
  codex: 'Codex',
  manual: 'Manual',
  unknown: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'active',
  ready: 'ready',
  pending_preparation: 'pending',
  shared: 'shared',
  reusable: 'reusable',
  interrupted: 'interrupted',
  discovered: 'discovered',
};

interface WorktreeDisplay {
  key: string;
  sourceLabel: string;
  statusLabel: string;
  branchLabel: string;
  dirty: boolean;
  dirtyCount: number;
  ahead: number;
  behind: number;
  updatedAtLabel: string;
  path: string;
  isMissing: boolean;
  isLaunchBlocked: boolean;
  hasAssignment: boolean;
  isReusable: boolean;
  isInterrupted: boolean;
  probeError: string | null;
  createdAt: string;
  sessionCount: number;
  hasActiveSessions: boolean;
  enrichedStatus: string | null;
}

const MAX_ROWS = 10;

function getRecordTimestamp(record: ExecutorWorktreeRecord): number {
  const updated = Date.parse(record.updatedAt || '');
  if (Number.isFinite(updated)) return updated;
  const lifecycle = record.lifecycle as { lastSeenAt?: string } | null;
  const lastSeen = lifecycle ? Date.parse(lifecycle.lastSeenAt || '') : 0;
  if (Number.isFinite(lastSeen) && lastSeen > 0) return lastSeen;
  const git = record.git;
  if (git && typeof git.mtimeMs === 'number' && Number.isFinite(git.mtimeMs)) {
    return git.mtimeMs;
  }
  return 0;
}

function sortForDisplay(records: ExecutorWorktreeRecord[], order: 'date-desc' | 'date-asc' | 'status' | 'source' = 'date-desc'): ExecutorWorktreeRecord[] {
  return records.slice().sort((left, right) => {
    if (order === 'status') {
      const leftStatus = (left.status || '').toLowerCase();
      const rightStatus = (right.status || '').toLowerCase();
      if (leftStatus !== rightStatus) return leftStatus.localeCompare(rightStatus);
      return getRecordTimestamp(right) - getRecordTimestamp(left);
    }
    if (order === 'source') {
      const leftSource = (left.source || '').toLowerCase();
      const rightSource = (right.source || '').toLowerCase();
      if (leftSource !== rightSource) return leftSource.localeCompare(rightSource);
      return getRecordTimestamp(right) - getRecordTimestamp(left);
    }
    // date-desc or date-asc
    const delta = getRecordTimestamp(right) - getRecordTimestamp(left);
    if (order === 'date-asc') return -delta;
    if (delta !== 0) return delta;
    const leftStable = typeof left._stableOrder === 'number' ? left._stableOrder : Number.POSITIVE_INFINITY;
    const rightStable = typeof right._stableOrder === 'number' ? right._stableOrder : Number.POSITIVE_INFINITY;
    if (leftStable !== rightStable) return leftStable - rightStable;
    return (left.path || '').localeCompare(right.path || '');
  });
}

function formatRelative(iso: string | null | undefined, mtimeMs?: number | null): string {
  let timestamp = Date.parse(iso || '');
  if (!Number.isFinite(timestamp) && typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)) {
    timestamp = mtimeMs;
  }
  if (!Number.isFinite(timestamp)) return 'unknown';
  const delta = Date.now() - timestamp;
  if (delta < 0) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatDate(record: ExecutorWorktreeRecord): string {
  const updated = record.updatedAt;
  if (updated) {
    const d = new Date(updated);
    if (Number.isFinite(d.getTime())) return d.toLocaleDateString();
  }
  const git = record.git;
  if (git && typeof git.mtimeMs === 'number' && Number.isFinite(git.mtimeMs)) {
    return new Date(git.mtimeMs).toLocaleDateString();
  }
  return 'unknown';
}

function getAssignment(record: ExecutorWorktreeRecord): { sessionId?: string | null; runId?: string | null; overlaySessionId?: string | null } {
  const assignment = record.assignment as { sessionId?: string | null; runId?: string | null; overlaySessionId?: string | null } | null;
  return {
    sessionId: assignment && typeof assignment.sessionId === 'string' ? assignment.sessionId : null,
    runId: assignment && typeof assignment.runId === 'string' ? assignment.runId : null,
    overlaySessionId: assignment && typeof assignment.overlaySessionId === 'string' ? assignment.overlaySessionId : null,
  };
}

function toDisplay(record: ExecutorWorktreeRecord): WorktreeDisplay {
  const source = (record.source || '').toLowerCase();
  const sourceLabel = SOURCE_LABELS[source] || (record.source ? record.source : SOURCE_LABELS.unknown);
  const status = (record.status || '').toLowerCase();
  const statusLabel = STATUS_LABELS[status] || status || 'discovered';
  const git = record.git;
  const isDetached = Boolean(record.detached || (git && git.detached));
  const branchLabel = isDetached
    ? (record.branch || (git && git.branch) || (record.head ? record.head.slice(0, 7) : null) || 'detached HEAD')
    : (record.branch || (git && git.branch) || 'unknown');
  const validation = record.validation as { pathExists?: boolean } | null;
  const isMissing = validation ? validation.pathExists === false : false;
  const launch = record.launch as { blocked?: boolean; reason?: string | null } | null;
  const isLaunchBlocked = Boolean(launch && launch.blocked);
  const assignment = getAssignment(record);
  const hasAssignment = Boolean(assignment.sessionId || assignment.runId || assignment.overlaySessionId);
  const changed = git ? Number(git.changed || 0) : 0;
  const dirty = changed > 0;
  const probeError = git && git.probeError ? git.probeError : null;
  const createdAtTs = getRecordTimestamp(record);
  const createdAt = createdAtTs > 0 ? new Date(createdAtTs).toLocaleDateString() : 'unknown';
  return {
    key: record.worktreeId || record.path || `wt-${Math.random().toString(36).slice(2, 9)}`,
    sourceLabel,
    statusLabel,
    branchLabel,
    dirty,
    dirtyCount: changed,
    ahead: git ? Number(git.ahead || 0) : 0,
    behind: git ? Number(git.behind || 0) : 0,
    updatedAtLabel: formatRelative(record.updatedAt, git ? git.mtimeMs : null),
    path: record.path || record.worktreePath || '',
    isMissing,
    isLaunchBlocked,
    hasAssignment,
    isReusable: status === 'reusable',
    isInterrupted: status === 'interrupted',
    probeError,
    createdAt,
    sessionCount: 0,
    hasActiveSessions: false,
    enrichedStatus: null,
  };
}

// ─── Worktree state computation (R5) ──────────────────────────────────────────

type WorktreeComputedState = 'current' | 'clean' | 'dirty' | 'checking' | 'checked' | 'check-failed' | 'mergeable' | 'merged' | 'conflict' | 'missing' | 'blocked' | 'assigned' | 'reusable' | 'interrupted' | 'probe-error' | 'unknown';

function computeWorktreeState(
  entry: WorktreeDisplay,
  worktreeCheckResults: Record<string, GitCheckResults | null>,
  worktreeDryRunResults: Record<string, MergeDryRunResponse | null>,
  worktreeMergeCompleted: Record<string, boolean>,
  currentBranch: string | null,
): WorktreeComputedState {
  // Component-derived states have priority
  if (worktreeMergeCompleted[entry.path]) return 'merged';
  const dryRun = worktreeDryRunResults[entry.path];
  if (dryRun) {
    if (dryRun.conflicts && dryRun.conflicts.length > 0) return 'conflict';
    if (dryRun.ok && dryRun.clean) return 'mergeable';
  }
  const checkResult = worktreeCheckResults[entry.path];
  if (checkResult) {
    if (!checkResult.allPassed) return 'check-failed';
    if (checkResult.allPassed && checkResult.checksAvailable > 0) return 'checked';
  }
  // Checking is tracked separately via a loading set

  // Record-derived states
  if (entry.isMissing) return 'missing';
  if (entry.probeError) return 'probe-error';
  if (entry.isLaunchBlocked) return 'blocked';
  if (entry.hasAssignment) return 'assigned';
  if (entry.isReusable) return 'reusable';
  if (entry.isInterrupted) return 'interrupted';

  // Simple states
  if (entry.branchLabel === currentBranch) return 'current';
  if (entry.dirty) return 'dirty';
  
  return 'clean';
}

// State chip labels and CSS classes
const STATE_LABELS: Record<WorktreeComputedState, string> = {
  'current': 'Current',
  'clean': 'Clean',
  'dirty': 'Dirty',
  'checking': 'Checking...',
  'checked': 'Checked',
  'check-failed': 'Check Failed',
  'mergeable': 'Ready',
  'merged': 'Merged',
  'conflict': 'Conflict',
  'missing': 'Missing',
  'blocked': 'Blocked',
  'assigned': 'Assigned',
  'reusable': 'Reusable',
  'interrupted': 'Interrupted',
  'probe-error': 'Error',
  'unknown': 'Unknown',
};

// ─── CompactCheckStatus inline component ────────────────────────────────────

function CompactCheckStatus({ repoPath }: { repoPath: string }) {
  const [state, setState] = useState<GitCheckStateResponse | null>(null);
  
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    getGitCheckState(repoPath).then(s => { if (!cancelled) setState(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [repoPath]);

  if (!state?.lastRun) {
    return (
      <div className="workspace-git-compact-checks" data-testid="workspace-git-compact-checks">
        <span className="workspace-git-compact-checks-label">Checks:</span>
        <span style={{ color: '#888' }}>no prior run</span>
      </div>
    );
  }

  const lr = state.lastRun;
  const passed = Object.values(lr.lanes || {}).filter((l: any) => l.status === 'PASS').length;
  const total = Object.keys(lr.lanes || {}).length;
  const profile = (lr as any).profile || 'default';
  const fresh = state.freshness?.fresh;
  const timeAgo = getRelativeTime(lr.timestamp);

  return (
    <div className="workspace-git-compact-checks" data-testid="workspace-git-compact-checks">
      <span className="workspace-git-compact-checks-label">Checks:</span>
      <span style={{ color: lr.overallPass ? '#4caf50' : '#ef5350' }}>
        {lr.overallPass ? '✓' : '✗'} {passed}/{total}
      </span>
      <span style={{ color: '#888', marginLeft: 8 }}>{profile}</span>
      <span style={{ color: fresh ? '#4caf50' : '#ff9800', marginLeft: 8 }}>
        {fresh ? 'fresh' : 'stale'}
      </span>
      <span style={{ color: '#666', marginLeft: 8, fontSize: '0.8em' }}>{timeAgo}</span>
      <span style={{ marginLeft: 8 }}>
        <button 
          type="button" 
          style={{ fontSize: '0.75em', padding: '2px 6px', background: 'var(--color-surface-400)', color: 'var(--color-text-100)', border: '1px solid var(--color-border-100)', borderRadius: 3, cursor: 'pointer' }}
          onClick={() => {
            // Switch to checks tab via navigation
            const nav = (window as any).__navStore;
            if (nav?.setActiveWorkspaceLocalTab) nav.setActiveWorkspaceLocalTab('checks');
          }}
          data-testid="workspace-git-open-checks"
        >
          Run CI →
        </button>
      </span>
    </div>
  );
}

function getRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface WorkspaceGitTabProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  repoId: string | null;
  gitState: GitState;
  verificationState?: VerificationState;
  checkResults?: GitCheckResults | null;
  runningChecks?: boolean;
  onRunChecks?: () => void;
  onCommit: () => void;
  onPush: () => void;
  onOpenPR: () => void;
  onCreatePR: () => void;
  onSetCommitMessage: (msg: string) => void;
  onSetPullRequestTitle: (t: string) => void;
  onSetPullRequestBody: (b: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WorkspaceGitTab({
  repo,
  repoPath,
  repoId,
  gitState,
  verificationState,
  checkResults,
  runningChecks,
  onRunChecks,
  onCommit,
  onPush,
  onOpenPR,
  onCreatePR,
  onSetCommitMessage,
  onSetPullRequestTitle,
  onSetPullRequestBody,
}: WorkspaceGitTabProps) {
  const summary = gitState.summary;
  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const pullRequest = gitState.pullRequest?.pullRequest ?? null;
  const changeCount = summary?.changedFiles ?? 0;
  const stagedCount = summary?.stagedFiles ?? 0;

  // ─── Section 1: Branch switch popover ──────────────────────────────────────
  const [showBranchPopover, setShowBranchPopover] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const branchPopoverRef = useRef<HTMLDivElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);

  // ─── Section 2: segmented tab state ────────────────────────────────────────
  const [branchTab, setBranchTab] = useState<'local' | 'remote'>('local');

  // ─── Section 3 state: commit log expand ────────────────────────────────────
  const [expandedCommit, setExpandedCommit] = useState<number | null>(null);

  // ─── Merge candidate state ─────────────────────────────────────────────────
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [mergeResults, setMergeResults] = useState<Record<string, MergeDryRunResponse>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [dryRunning, setDryRunning] = useState<string | null>(null);

  // ─── Worktrees state ───────────────────────────────────────────────────────
  const [worktreeRecords, setWorktreeRecords] = useState<ExecutorWorktreeRecord[]>([]);
  const [worktreesLoading, setWorktreesLoading] = useState(false);
  const [worktreesError, setWorktreesError] = useState<string | null>(null);
  const [expandedWorktree, setExpandedWorktree] = useState<string | null>(null);

  // ─── Worktree cleanup state ────────────────────────────────────────────────
  const [cleanupAnalyses, setCleanupAnalyses] = useState<Record<string, { eligible: boolean; reason: string; dirty: boolean; missing: boolean; assigned: boolean; conflicts: boolean; mergedIntoCurrentOrDefault: boolean; diagnostics: string[] }>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // ─── Enriched worktree state ──────────────────────────────────────────────
  const [enrichedWorktrees, setEnrichedWorktrees] = useState<EnrichedWorktreeEntry[]>([]);
  const [enrichedLoading, setEnrichedLoading] = useState(false);
  
  // ─── Worktree sorting ─────────────────────────────────────────────────────
  const [sortOrder, setSortOrder] = useState<'date-desc' | 'date-asc' | 'status' | 'source'>('date-desc');

  // ─── Worktree merge state ─────────────────────────────────────────────────
  const [worktreeMergeResults, setWorktreeMergeResults] = useState<Record<string, MergeWorktreeResponse>>({});
  const [mergingWorktree, setMergingWorktree] = useState<string | null>(null);

  // ─── Worktree check/merge UI state (R5) ────────────────────────────────────
  const [worktreeCheckResults, setWorktreeCheckResults] = useState<Record<string, GitCheckResults | null>>({});
  const [worktreeDryRunResults, setWorktreeDryRunResults] = useState<Record<string, MergeDryRunResponse | null>>({});
  const [worktreeMergeCompleted, setWorktreeMergeCompleted] = useState<Record<string, boolean>>({});
  const [checkingWorktree, setCheckingWorktree] = useState<string | null>(null);

  // ─── Skip-verify commit state ─────────────────────────────────────────────
  const [showSkipVerifyConfirm, setShowSkipVerifyConfirm] = useState(false);
  const [skipVerifyCommitting, setSkipVerifyCommitting] = useState(false);

  // ─── Checks discovery state ────────────────────────────────────────────────
  const [discoveredChecks, setDiscoveredChecks] = useState<GitChecksDiscoverResponse | null>(null);

  // ─── Verify & Commit flow ──────────────────────────────────────────────────
  const [commitPhase, setCommitPhase] = useState<'idle' | 'running-checks'>('idle');
  const [checksVerified, setChecksVerified] = useState(false);
  const [failedCheckResults, setFailedCheckResults] = useState<GitCheckResults | null>(null);

  // ─── Force commit/override state ───────────────────────────────────────────
  const [showForceCommitDialog, setShowForceCommitDialog] = useState(false);
  const [forceOverrideReason, setForceOverrideReason] = useState('');
  const [forceCommitting, setForceCommitting] = useState(false);

  // ─── Stash state ───────────────────────────────────────────────────────────
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [stashesLoading, setStashesLoading] = useState(false);
  const [showStashList, setShowStashList] = useState(false);

  // ─── PR create form collapse ───────────────────────────────────────────────
  const [showPrForm, setShowPrForm] = useState(false);

  // ─── Load merge candidates ─────────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      try {
        const data = await getMergeCandidates(repoPath);
        if (!cancelled) setMergeCandidates(data.branches);
      } catch {
        // merge candidates are informational, not critical
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // ─── Load worktrees ────────────────────────────────────────────────────────
  const loadWorktrees = useCallback(async () => {
    if (!repoPath) {
      setWorktreeRecords([]);
      return;
    }
    setWorktreesLoading(true);
    try {
      const response = await listExecutorWorktrees({ repoId: repoId || undefined, repoPath });
      setWorktreeRecords(response.worktrees || []);
      setWorktreesError(response.worktreeDiscovery ? response.worktreeDiscovery.gitListError : null);
    } catch {
      setWorktreeRecords([]);
      setWorktreesError(null);
    } finally {
      setWorktreesLoading(false);
    }
  }, [repoId, repoPath]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await loadWorktrees();
    }
    void load();
    return () => { cancelled = true; };
  }, [loadWorktrees]);

  // ─── Load enriched worktree data ──────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      setEnrichedLoading(true);
      try {
        const data = await getEnrichedWorktrees(repoPath);
        if (!cancelled) setEnrichedWorktrees(data.worktrees || []);
      } catch {
        // enriched data is optional
      } finally {
        if (!cancelled) setEnrichedLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // ─── Discover checks on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      try {
        const result = await discoverGitChecks(repoPath);
        if (!cancelled) setDiscoveredChecks(result);
      } catch {
        // discovery is informational
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // ─── Close branch popover on outside click ─────────────────────────────────
  useEffect(() => {
    if (!showBranchPopover) return;
    function handleClick(e: MouseEvent) {
      if (
        branchPopoverRef.current &&
        !branchPopoverRef.current.contains(e.target as Node) &&
        branchTriggerRef.current &&
        !branchTriggerRef.current.contains(e.target as Node)
      ) {
        setShowBranchPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showBranchPopover]);

  // ─── Merge dry-run handler ─────────────────────────────────────────────────
  async function handleDryRun(branchName: string) {
    if (!repoPath || !summary?.branch) return;
    setDryRunning(branchName);
    try {
      const result = await mergeDryRun(repoPath, branchName, summary.branch);
      setMergeResults((prev) => ({ ...prev, [branchName]: result }));
    } catch (err) {
      setMergeResults((prev) => ({
        ...prev,
        [branchName]: {
          ok: false,
          clean: false,
          diagnostics: err instanceof Error ? err.message : String(err),
          sourceRef: branchName,
          targetRef: summary.branch || '',
          dirty: false,
        },
      }));
    } finally {
      setDryRunning(null);
    }
  }

  // ─── Merge local handler ───────────────────────────────────────────────────
  async function handleMerge(branchName: string) {
    if (!repoPath || !summary?.branch) return;
    setMerging(branchName);
    try {
      const result = await mergeLocal(repoPath, branchName, summary.branch);
      notificationStore.success('Merge complete', { message: `Merged ${branchName} into ${summary.branch}` });
      setMergeResults((prev) => {
        const next = { ...prev };
        delete next[branchName];
        return next;
      });
    } catch (err) {
      notificationStore.error('Merge failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMerging(null);
    }
  }

  // ─── Branch checkout handler ───────────────────────────────────────────────
  async function handleCheckout(targetBranch: string) {
    if (!repoPath || changeCount > 0) return; // block when dirty
    setSwitchingTo(targetBranch);
    setShowBranchPopover(false);
    try {
      await checkoutGitBranch(repoPath, { branchName: targetBranch });
      notificationStore.success('Switched branch', { message: `Now on ${targetBranch}` });
    } catch (err) {
      notificationStore.error('Checkout failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSwitchingTo(null);
    }
  }

  // ─── Remote branch checkout handler ────────────────────────────────────────
  async function handleRemoteCheckout(remoteName: string) {
    if (!repoPath || changeCount > 0) return;
    // remoteName is like "origin/feature-x", extract local name
    const parts = remoteName.split('/');
    const localName = parts[parts.length - 1] || remoteName;
    setSwitchingTo(localName);
    try {
      await checkoutGitBranch(repoPath, { branchName: localName, create: true, startPoint: remoteName });
      notificationStore.success('Checked out remote branch', { message: `Created and switched to ${localName}` });
    } catch (err) {
      notificationStore.error('Checkout failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSwitchingTo(null);
    }
  }

  // ─── Pull handler ──────────────────────────────────────────────────────────
  async function handlePull() {
    if (!repoPath) return;
    try {
      const result = await pullGit(repoPath);
      notificationStore.success('Pull complete', { message: result.output || 'Repository updated' });
    } catch (err) {
      notificationStore.error('Pull failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ─── Verify & Commit handler (direct flow, no useEffect sync) ──────────────
  async function handleVerifyAndCommit() {
    if (!gitState.commitMessage.trim() || !repoPath) return;
    setCommitPhase('running-checks');
    setChecksVerified(false);
    setFailedCheckResults(null);

    try {
      const results = await runGitChecks(repoPath);

      if (results.checksAvailable === 0) {
        // No checks configured — allow commit, show neutral info
        setChecksVerified(true);
        notificationStore.success('No checks configured', { message: 'Proceeding with commit.' });
        onCommit();
        setCommitPhase('idle');
        return;
      }

      if (results.allPassed) {
        setChecksVerified(true);
        onCommit();
        setCommitPhase('idle');
      } else {
        setCommitPhase('idle');
        setFailedCheckResults(results);
        notificationStore.error('Checks failed', {
          message: `${results.checksFailed} check(s) failed. Fix issues before committing.`,
        });
      }
    } catch (err) {
      setCommitPhase('idle');
      notificationStore.error('Checks error', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ─── Force commit handler ──────────────────────────────────────────────────
  async function handleForceCommit() {
    if (!forceOverrideReason.trim() || !gitState.commitMessage.trim() || !repoPath) return;
    setForceCommitting(true);
    try {
      const result = await commitGit(repoPath, gitState.commitMessage, { reason: forceOverrideReason.trim() });
      if (result.error) {
        notificationStore.error('Force commit failed', { message: result.error });
      } else {
        notificationStore.success('Force committed', {
          message: `Committed with override: "${forceOverrideReason.trim()}"`,
        });
        setShowForceCommitDialog(false);
        setForceOverrideReason('');
        setFailedCheckResults(null);
      }
    } catch (err) {
      notificationStore.error('Force commit failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setForceCommitting(false);
    }
  }

  // ─── Stash action handlers ─────────────────────────────────────────────────
  async function handleCreateStash() {
    if (!repoPath) return;
    try {
      await createStash(repoPath);
      notificationStore.success('Changes stashed');
      // Refresh stashes and status
      const [stashResult] = await Promise.all([listStashes(repoPath)]);
      setStashes(stashResult.stashes || []);
      loadWorktrees();
    } catch (err) {
      notificationStore.error('Stash failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleApplyStash(index?: number) {
    if (!repoPath) return;
    try {
      await applyStash(repoPath, index);
      notificationStore.success('Stash applied', { message: index !== undefined ? `Applied stash@{${index}}` : 'Applied latest stash' });
      const [stashResult] = await Promise.all([listStashes(repoPath)]);
      setStashes(stashResult.stashes || []);
      loadWorktrees();
    } catch (err) {
      notificationStore.error('Apply failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handlePopStash(index?: number) {
    if (!repoPath) return;
    try {
      await popStash(repoPath, index);
      notificationStore.success('Stash popped');
      const [stashResult] = await Promise.all([listStashes(repoPath)]);
      setStashes(stashResult.stashes || []);
      loadWorktrees();
    } catch (err) {
      notificationStore.error('Pop failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleDropStash(index?: number) {
    if (!repoPath) return;
    try {
      await dropStash(repoPath, index);
      notificationStore.success('Stash dropped');
      const [stashResult] = await Promise.all([listStashes(repoPath)]);
      setStashes(stashResult.stashes || []);
    } catch (err) {
      notificationStore.error('Drop failed', { message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ─── Reset checksVerified when repoPath changes ────────────────────────────
  useEffect(() => {
    setChecksVerified(false);
    setFailedCheckResults(null);
  }, [repoPath]);

  // ─── Load stashes on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    async function load() {
      setStashesLoading(true);
      try {
        const result = await listStashes(repoPath);
        if (!cancelled) setStashes(result.stashes || []);
      } catch {
        if (!cancelled) setStashes([]);
      } finally {
        if (!cancelled) setStashesLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // ─── Resolve branches ──────────────────────────────────────────────────────
  const localBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []).filter((b) => !b.remote);
  const remoteBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []).filter((b) => b.remote);
  const allBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []);


  // ─── Worktrees display ─────────────────────────────────────────────────────
  const worktreeDisplay = sortForDisplay(worktreeRecords, sortOrder).slice(0, MAX_ROWS).map(record => {
    const entry = toDisplay(record);
    // Merge enriched data
    const enriched = enrichedWorktrees.find(w => {
      const wtPath = (w.path || '').replace(/\\/g, '/').toLowerCase();
      const entryPath = (entry.path || '').replace(/\\/g, '/').toLowerCase();
      return wtPath && entryPath && (wtPath === entryPath || entryPath.endsWith(wtPath) || wtPath.endsWith(entryPath));
    });
    if (enriched) {
      entry.sessionCount = enriched.sessionCount || 0;
      entry.hasActiveSessions = enriched.sessionCount > 0;
      entry.enrichedStatus = enriched.status || null;
    }
    return entry;
  });

  // ─── Worktree cleanup handlers ─────────────────────────────────────────────
  async function handleAnalyzeCleanup(worktreePath: string, branch: string) {
    setAnalyzing(worktreePath);
    try {
      const result = await analyzeWorktreeCleanup(repoPath, worktreePath, branch || null);
      setCleanupAnalyses(prev => ({ ...prev, [worktreePath]: result }));
    } catch (err) {
      notificationStore.error('Analysis failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setAnalyzing(null);
    }
  }

  async function handleRemoveWorktree(worktreePath: string, branch: string) {
    setRemoving(worktreePath);
    try {
      const result = await removeWorktreeWithBranch(repoPath, worktreePath, branch || null);
      if (result.removed) {
        notificationStore.success(
          result.branchDeleted ? 'Worktree & branch removed' : 'Worktree removed (branch may remain)',
          { message: `${worktreePath}${result.branch ? ` (branch: ${result.branch})` : ''}` }
        );
        loadWorktrees();
      }
    } catch (err) {
      notificationStore.error('Remove failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRemoving(null);
    }
  }

  async function handleMergeWorktree(worktreePath: string, worktreeBranch: string) {
    if (!summary?.branch) return;
    const targetBranch = summary.branch;
    setMergingWorktree(worktreePath);
    try {
      const result = await mergeWorktree(repoPath, worktreePath, worktreeBranch, targetBranch);
      setWorktreeMergeResults(prev => ({ ...prev, [worktreePath]: result }));
      if (result.merged) {
        notificationStore.success('Merge complete', { message: `Merged ${worktreeBranch} into ${targetBranch}` });
        loadWorktrees();
      } else if (result.conflicts) {
        notificationStore.error('Merge conflicts', { message: `${result.conflictFiles?.length || 0} file(s) have conflicts` });
      }
    } catch (err) {
      setWorktreeMergeResults(prev => ({
        ...prev,
        [worktreePath]: {
          merged: false,
          conflicts: true,
          conflictFiles: [],
          diagnostics: err instanceof Error ? err.message : String(err),
          sourceRef: worktreeBranch,
          targetRef: targetBranch,
        },
      }));
      notificationStore.error('Merge failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMergingWorktree(null);
    }
  }

  // ─── Worktree check handler (R5) ──────────────────────────────────────────
  async function handleWorktreeRunChecks(worktreePath: string, worktreeBranch: string) {
    if (!repoPath || !summary?.branch) return;
    setCheckingWorktree(worktreePath);
    try {
      const results = await runGitChecks(worktreePath);
      setWorktreeCheckResults(prev => ({ ...prev, [worktreePath]: results }));
      
      // Auto-run dry-run after checks pass
      if (results.allPassed && results.checksAvailable > 0) {
        const dryRunResult = await mergeDryRun(repoPath, worktreeBranch, summary.branch);
        setWorktreeDryRunResults(prev => ({ ...prev, [worktreePath]: dryRunResult }));
      }
    } catch (err) {
      notificationStore.error('Check failed', { message: err instanceof Error ? err.message : String(err) });
      setWorktreeCheckResults(prev => ({ 
        ...prev, 
        [worktreePath]: { 
          repoRoot: worktreePath, 
          checkedAt: new Date().toISOString(), 
          checksAvailable: 0, checksRun: 0, checksPassed: 0, checksFailed: 1, 
          allPassed: false, results: [], 
          message: err instanceof Error ? err.message : String(err),
          source: 'legacy' as const,
        } 
      }));
    } finally {
      setCheckingWorktree(null);
    }
  }

  // ─── Worktree merge handler (R5/R6) ───────────────────────────────────────
  async function handleWorktreeMerge(worktreePath: string, worktreeBranch: string) {
    if (!repoPath || !summary?.branch) return;
    setMergingWorktree(worktreePath);
    try {
      const result = await mergeWorktree(repoPath, worktreePath, worktreeBranch, summary.branch);
      setWorktreeMergeResults(prev => ({ ...prev, [worktreePath]: result }));
      if (result.merged) {
        setWorktreeMergeCompleted(prev => ({ ...prev, [worktreePath]: true }));
        notificationStore.success('Merge complete', { message: `Merged ${worktreeBranch} into ${summary.branch}` });
        loadWorktrees();
      } else if (result.conflicts) {
        notificationStore.error('Merge conflicts', { message: `${result.conflictFiles?.length || 0} file(s) have conflicts` });
      }
    } catch (err) {
      notificationStore.error('Merge failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setMergingWorktree(null);
    }
  }

  // ─── Push disabled state ───────────────────────────────────────────────────
  const pushDisabled = (verificationState !== 'verified' && !checksVerified) || changeCount === 0 || gitState.syncing;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="workspace-git-tab" data-testid="workspace-git-tab">

      {/* ================================================================ */}
      {/* SECTION 1 — Slim Status Strip                                    */}
      {/* ================================================================ */}
      <div className="workspace-git-summary" data-testid="workspace-git-summary">
        {/* Branch name with dropdown trigger */}
        {branch ? (
          <span className="workspace-git-summary-branch-wrap" data-testid="workspace-summary-branch">
            <button
              ref={branchTriggerRef}
              type="button"
              className="workspace-git-summary-branch"
              onClick={() => setShowBranchPopover(!showBranchPopover)}
              title="Switch branch"
              data-testid="workspace-summary-branch-btn"
            >
              ⎇ {branch} <span className="workspace-git-dropdown-arrow">▼</span>
            </button>
            {showBranchPopover ? (
              <div
                ref={branchPopoverRef}
                className="workspace-git-branch-popover"
                data-testid="workspace-branch-popover"
              >
                <div className="workspace-git-branch-popover-header">Switch branch</div>
                {changeCount > 0 ? (
                  <div className="workspace-git-branch-popover-warning">
                    ⚠ Working tree has {changeCount} dirty file(s). Commit or stash before switching.
                  </div>
                ) : null}
                <div className="workspace-git-branch-popover-list">
                  {allBranches
                    .filter((b) => !b.remote)
                    .map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        className={`workspace-git-branch-popover-item ${b.current ? 'workspace-git-branch-popover-current' : ''}`}
                        onClick={() => !b.current && void handleCheckout(b.name)}
                        disabled={b.current || changeCount > 0 || switchingTo === b.name}
                        data-testid={`workspace-branch-popover-${b.name}`}
                      >
                        {b.current ? '✓ ' : ''}{b.name}
                        {b.upstream ? <span className="workspace-git-branch-popover-upstream">{b.upstream}</span> : null}
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
          </span>
        ) : null}

        {/* Upstream */}
        {summary?.upstream ? (
          <span className="workspace-git-summary-upstream" data-testid="workspace-summary-upstream">
            {summary.upstream}
          </span>
        ) : null}

        {/* Dirty count */}
        <span
          className={`workspace-git-summary-clean-badge ${
            changeCount > 0 ? 'workspace-git-summary-dirty' : 'workspace-git-summary-clean'
          }`}
          data-testid="workspace-summary-clean"
        >
          {changeCount > 0 ? `dirty(${changeCount})` : 'clean'}
        </span>

        {/* Staged count */}
        {stagedCount > 0 ? (
          <span className="workspace-git-summary-staged" data-testid="workspace-summary-staged">
            {stagedCount} staged
          </span>
        ) : null}

        {/* Ahead/Behind */}
        {(summary?.ahead ?? 0) > 0 ? (
          <span className="workspace-git-summary-ahead" data-testid="workspace-summary-ahead" style={{ color: 'var(--color-success-500)' }}>
            ↑{summary?.ahead}
          </span>
        ) : null}
        {(summary?.behind ?? 0) > 0 ? (
          <span className="workspace-git-summary-behind" data-testid="workspace-summary-behind" style={{ color: 'var(--color-accent-500)' }}>
            ↓{summary?.behind}
          </span>
        ) : null}

        {/* PR link */}
        {pullRequest ? (
          <a
            className="workspace-git-summary-pr-link"
            href={pullRequest.url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="workspace-summary-pr-link"
          >
            PR #{pullRequest.number}
          </a>
        ) : null}

        {/* Pull button */}
        {hasRemote ? (
          <button
            type="button"
            className="workspace-git-icon-btn"
            onClick={() => void handlePull()}
            title="Pull latest changes"
            aria-label="Pull"
            data-testid="workspace-summary-pull"
          >
            ↻
          </button>
        ) : null}

        {/* Push button (in strip) */}
        <button
          type="button"
          className="workspace-git-icon-btn"
          onClick={onPush}
          disabled={pushDisabled}
          title="Push changes"
          aria-label="Push"
          data-testid="workspace-summary-push"
        >
          ⬆
        </button>

        {/* Repo path */}
        <span className="workspace-git-summary-path" data-testid="workspace-summary-path">
          {repo?.repoLabel || repoPath}
        </span>
      </div>

      {/* ================================================================ */}
      {/* SECTION 2 — Branches Table with Segmented Tabs                  */}
      {/* ================================================================ */}
      <div className="workspace-git-branches-area" data-testid="workspace-git-branches-area">
        {/* Segmented tabs */}
        <div className="workspace-git-segmented-tabs" data-testid="workspace-git-segmented-tabs">
          <button
            type="button"
            className={`workspace-git-segmented-tab ${branchTab === 'local' ? 'workspace-git-segmented-tab-active' : ''}`}
            onClick={() => setBranchTab('local')}
            data-testid="workspace-git-tab-local"
          >
            Local
          </button>
          <button
            type="button"
            className={`workspace-git-segmented-tab ${branchTab === 'remote' ? 'workspace-git-segmented-tab-active' : ''}`}
            onClick={() => setBranchTab('remote')}
            data-testid="workspace-git-tab-remote"
          >
            Remote
          </button>
        </div>

        {branchTab === 'local' ? (
          <div data-testid="workspace-git-branches-pane">
            {localBranches.length === 0 ? (
              <div className="state-message" data-testid="workspace-git-no-branches">No local branches found.</div>
            ) : (
              <table className="workspace-git-table" data-testid="workspace-git-branches-list">
                <thead>
                  <tr className="workspace-git-table-header">
                    <th className="workspace-git-table-cell">Branch</th>
                    <th className="workspace-git-table-cell">Current</th>
                    <th className="workspace-git-table-cell">Upstream</th>
                    <th className="workspace-git-table-cell">Ahead/Behind</th>
                    <th className="workspace-git-table-cell">Last Commit</th>
                    <th className="workspace-git-table-cell">PR Status</th>
                    <th className="workspace-git-table-cell">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {localBranches.map((b) => {
                    const mc = mergeCandidates.find((c) => c.name === b.name);
                    const drResult = mergeResults[b.name];
                    return (
                      <tr
                        key={b.name}
                        className={`workspace-git-table-row ${b.current ? 'workspace-git-table-row-current' : ''}`}
                        data-testid={`workspace-git-branch-${b.name}`}
                      >
                        <td className="workspace-git-table-cell">
                          <span className="workspace-git-branch-name" style={{ fontWeight: b.current ? 700 : 400 }}>
                            {b.name}
                          </span>
                        </td>
                        <td className="workspace-git-table-cell">
                          {b.current ? (
                            <span className="workspace-git-branch-current-badge">current</span>
                          ) : null}
                        </td>
                        <td className="workspace-git-table-cell">
                          <span className="workspace-git-branch-upstream">{b.upstream || '—'}</span>
                        </td>
                        <td className="workspace-git-table-cell">
                          {mc ? (
                            <span className="workspace-git-merge-ahead-behind">
                              ↑{mc.ahead} ↓{mc.behind}
                            </span>
                          ) : (
                            <span className="workspace-git-merge-ahead-behind" style={{ color: 'var(--color-ink-400)' }}>—</span>
                          )}
                        </td>
                        <td className="workspace-git-table-cell">
                          <span className="workspace-git-merge-last-commit">
                            {mc?.lastCommit ? mc.lastCommit.slice(0, 7) : '—'}
                          </span>
                        </td>
                        <td className="workspace-git-table-cell">
                          {mc ? (
                            mc.isMerged ? (
                              <span className="workspace-git-merge-status-merged">Merged</span>
                            ) : (
                              <span className="workspace-git-merge-status-not-merged">Not merged</span>
                            )
                          ) : (
                            <span className="workspace-git-merge-status-not-merged">Unknown</span>
                          )}
                        </td>
                        <td className="workspace-git-table-cell">
                          <div className="workspace-git-merge-controls">
                            {b.current ? (
                              <span className="workspace-git-merge-clean-label" style={{ color: 'var(--color-ink-400)', fontSize: '0.75rem' }}>
                                current
                              </span>
                            ) : mc?.isMerged ? (
                              <span className="workspace-git-merge-clean-label" style={{ color: 'var(--color-ink-400)', fontSize: '0.75rem' }}>
                                merged
                              </span>
                            ) : !drResult ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={dryRunning === b.name}
                                onClick={() => void handleDryRun(b.name)}
                                testId={`workspace-git-dry-run-${b.name}`}
                              >
                                {dryRunning === b.name ? '...' : 'Dry-run'}
                              </Button>
                            ) : drResult.ok ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                                <span className="workspace-git-merge-clean-label">✓ Ready</span>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={merging === b.name}
                                  onClick={() => void handleMerge(b.name)}
                                  testId={`workspace-git-merge-local-${b.name}`}
                                >
                                  {merging === b.name ? '...' : 'Merge'}
                                </Button>
                              </div>
                            ) : drResult.dirty ? (
                              <span className="workspace-git-merge-dirty-label">⚠ Dirty</span>
                            ) : drResult.conflicts && drResult.conflicts.length > 0 ? (
                              <span className="workspace-git-merge-conflicts-label" title={drResult.conflicts.join(', ')}>
                                ✗ {drResult.conflicts.length} conflict(s)
                              </span>
                            ) : (
                              <span className="workspace-git-merge-error" style={{ fontSize: '0.75rem' }}>
                                ✗ {drResult.diagnostics?.slice(0, 40)}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div data-testid="workspace-git-branches-remote-pane">
            {remoteBranches.length === 0 ? (
              <div className="state-message">No remote branches found.</div>
            ) : (
              <table className="workspace-git-table" data-testid="workspace-git-remote-branches-list">
                <thead>
                  <tr className="workspace-git-table-header">
                    <th className="workspace-git-table-cell">Remote Branch</th>
                    <th className="workspace-git-table-cell">Tracks</th>
                    <th className="workspace-git-table-cell">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {remoteBranches.map((b) => {
                    const parts = b.name.split('/');
                    const localName = parts[parts.length - 1];
                    const tracked = localBranches.find((lb) => lb.upstream === b.name);
                    return (
                      <tr
                        key={b.name}
                        className="workspace-git-table-row"
                        data-testid={`workspace-git-remote-branch-${b.name}`}
                      >
                        <td className="workspace-git-table-cell">
                          <span className="workspace-git-branch-name">{b.name}</span>
                        </td>
                        <td className="workspace-git-table-cell">
                          <span className="workspace-git-branch-upstream">
                            {tracked ? tracked.name : '—'}
                          </span>
                        </td>
                        <td className="workspace-git-table-cell">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={changeCount > 0 || switchingTo !== null}
                            onClick={() => void handleRemoteCheckout(b.name)}
                            testId={`workspace-git-checkout-remote-${b.name}`}
                          >
                            {switchingTo === localName ? '...' : 'Checkout'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ================================================================ */}
      {/* SECTION 3 — Worktrees Table                                      */}
      {/* ================================================================ */}
      <div className="workspace-git-worktrees-area" data-testid="workspace-git-worktrees-area">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
          <h3 className="workspace-git-section-title" style={{ margin: 0 }}>
            Worktrees ({worktreeRecords.length})
          </h3>
          <button
            type="button"
            className="button button-sm button-ghost"
            onClick={() => void loadWorktrees()}
            disabled={worktreesLoading}
            title="Reload worktrees"
            aria-label="Reload worktrees"
            data-testid="workspace-worktrees-reload"
          >
            ↻ Reload
          </button>
          <select
            className="form-input-field"
            style={{ width: 'auto', padding: '2px 6px', fontSize: '0.75rem' }}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
            data-testid="workspace-worktrees-sort"
          >
            <option value="date-desc">Newest first</option>
            <option value="date-asc">Oldest first</option>
            <option value="status">By status</option>
            <option value="source">By source</option>
          </select>
        </div>

        {worktreesLoading ? (
          <div className="state-message">Scanning worktrees...</div>
        ) : worktreeDisplay.length === 0 ? (
          <div className="state-message" data-testid="workspace-worktrees-empty">
            {worktreesError ? `git discovery failed: ${worktreesError}` : 'No worktrees found for this repo.'}
          </div>
        ) : (
          <table className="workspace-git-table" data-testid="workspace-worktrees-list">
            <thead>
              <tr className="workspace-git-table-header">
                <th className="workspace-git-table-cell">Branch</th>
                <th className="workspace-git-table-cell">Path</th>
                <th className="workspace-git-table-cell">Created</th>
                <th className="workspace-git-table-cell">Source</th>
                <th className="workspace-git-table-cell">Status</th>
                <th className="workspace-git-table-cell">Dirty</th>
                <th className="workspace-git-table-cell">Flags</th>
                <th className="workspace-git-table-cell">Cleanup</th>
              </tr>
            </thead>
            <tbody>
              {worktreeDisplay.map((entry) => (
                <tr
                  key={entry.key}
                  className={`workspace-git-table-row ${entry.dirty ? 'workspace-git-table-row-dirty' : ''} ${entry.isMissing ? 'workspace-git-table-row-missing' : ''}`}
                  data-testid={`workspace-worktree-${entry.key}`}
                >
                  <td className="workspace-git-table-cell">
                    <span className="workspace-git-branch-name">{entry.branchLabel}</span>
                  </td>
                  <td className="workspace-git-table-cell">
                    <span
                      className="workspace-git-worktree-path"
                      title={entry.path}
                      data-testid={`workspace-worktree-path-${entry.key}`}
                    >
                      {entry.path}
                    </span>
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-created-${entry.key}`}>
                    {entry.createdAt}
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-source-${entry.key}`}>
                    {entry.sourceLabel}
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-status-${entry.key}`}>
                    {(() => {
                      const state = computeWorktreeState(
                        entry, 
                        worktreeCheckResults, 
                        worktreeDryRunResults, 
                        worktreeMergeCompleted,
                        summary?.branch ?? null
                      );
                      const isChecking = checkingWorktree === entry.path;
                      const label = isChecking ? 'Checking...' : STATE_LABELS[state];
                      return (
                        <span
                          className={`workspace-git-state-chip workspace-git-state-${isChecking ? 'checking' : state}`}
                          data-testid={`workspace-worktree-state-${entry.key}`}
                        >
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-dirty-${entry.key}`}>
                    {entry.dirty ? `${entry.dirtyCount} dirty` : 'clean'}
                  </td>
                  <td className="workspace-git-table-cell">
                    <div className="workspace-git-worktree-flags">
                      {/* Worktree check/merge actions (R5/R6) */}
                      {!entry.isMissing && !worktreeMergeCompleted[entry.path] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={checkingWorktree === entry.path}
                          onClick={() => void handleWorktreeRunChecks(entry.path, entry.branchLabel)}
                          testId={`workspace-worktree-run-checks-${entry.key}`}
                        >
                          {checkingWorktree === entry.path ? '...' : 'Run checks'}
                        </Button>
                      )}
                      {worktreeDryRunResults[entry.path]?.ok && worktreeDryRunResults[entry.path]?.clean && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={mergingWorktree === entry.path}
                          onClick={() => void handleWorktreeMerge(entry.path, entry.branchLabel)}
                          testId={`workspace-worktree-merge-${entry.key}`}
                        >
                          {mergingWorktree === entry.path ? '...' : 'Merge'}
                        </Button>
                      )}
                      {worktreeDryRunResults[entry.path]?.conflicts && worktreeDryRunResults[entry.path]!.conflicts!.length > 0 && (
                        <span 
                          className="workspace-git-worktree-flag workspace-git-worktree-flag-error" 
                          title={worktreeDryRunResults[entry.path]!.conflicts!.join(', ')}
                          data-testid={`workspace-worktree-conflicts-${entry.key}`}
                        >
                          ✗ {worktreeDryRunResults[entry.path]!.conflicts!.length} conflict(s)
                        </span>
                      )}
                      {worktreeMergeCompleted[entry.path] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removing === entry.path}
                          onClick={() => void handleRemoveWorktree(entry.path, entry.branchLabel)}
                          testId={`workspace-worktree-remove-merged-${entry.key}`}
                        >
                          {removing === entry.path ? '...' : 'Remove + delete branch'}
                        </Button>
                      )}
                      {entry.isMissing ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-missing" title="Path missing">missing</span>
                      ) : null}
                      {entry.isLaunchBlocked ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-blocked" title="Launch blocked">blocked</span>
                      ) : null}
                      {entry.hasAssignment ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-assigned" title="Active assignment">assigned</span>
                      ) : null}
                      {entry.isReusable ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-reusable" title="Reusable">reusable</span>
                      ) : null}
                      {entry.isInterrupted ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-interrupted" title="Interrupted">interrupted</span>
                      ) : null}
                      {entry.probeError ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-error" title={entry.probeError}>probe error</span>
                      ) : null}
                      {worktreeMergeResults[entry.path]?.conflicts ? (
                        <span className="workspace-git-worktree-flag workspace-git-worktree-flag-error" title={worktreeMergeResults[entry.path].diagnostics || 'Merge conflicts detected'}>
                          conflicts
                        </span>
                      ) : null}

                      {/* Expand diagnostics */}
                      {(entry.isMissing || entry.isLaunchBlocked || entry.hasAssignment || entry.probeError) ? (
                        <button
                          type="button"
                          className="workspace-git-worktree-expand-btn"
                          onClick={() => setExpandedWorktree(expandedWorktree === entry.key ? null : entry.key)}
                          aria-label="Toggle diagnostics"
                          data-testid={`workspace-worktree-expand-${entry.key}`}
                        >
                          {expandedWorktree === entry.key ? '▲' : '▼'}
                        </button>
                      ) : null}
                    </div>

                    {/* Expanded diagnostics */}
                    {expandedWorktree === entry.key ? (
                      <div className="workspace-git-worktree-diagnostics" data-testid={`workspace-worktree-diag-${entry.key}`}>
                        {entry.isMissing ? (
                          <div className="workspace-git-worktree-diag-row">⚠ Path missing: {entry.path}</div>
                        ) : null}
                        {entry.isLaunchBlocked ? (
                          <div className="workspace-git-worktree-diag-row">⛔ Launch blocked</div>
                        ) : null}
                        {entry.hasAssignment ? (
                          <div className="workspace-git-worktree-diag-row">📋 Active assignment</div>
                        ) : null}
                        {entry.probeError ? (
                          <div className="workspace-git-worktree-diag-row workspace-git-worktree-diag-error">✗ {entry.probeError}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </td>
                <td className="workspace-git-table-cell">
                  <div className="workspace-git-worktree-cleanup">
                    {cleanupAnalyses[entry.path] ? (
                      <>
                        {cleanupAnalyses[entry.path].eligible ? (
                          <span className="workspace-git-cleanup-safe" title={cleanupAnalyses[entry.path].reason}>✓ Safe</span>
                        ) : (
                          <span className="workspace-git-cleanup-blocked" title={cleanupAnalyses[entry.path].reason}>✗ Blocked</span>
                        )}
                        <button
                          type="button"
                          className="button button-sm button-secondary"
                          disabled={!cleanupAnalyses[entry.path].eligible || removing === entry.path}
                          onClick={() => void handleRemoveWorktree(entry.path, entry.branchLabel)}
                          data-testid={`workspace-worktree-remove-${entry.key}`}
                        >
                          {removing === entry.path ? '...' : 'Remove'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button-sm button-ghost"
                        disabled={analyzing === entry.path}
                        onClick={() => void handleAnalyzeCleanup(entry.path, entry.branchLabel)}
                        data-testid={`workspace-worktree-analyze-${entry.key}`}
                      >
                        {analyzing === entry.path ? '...' : 'Analyze'}
                      </button>
                    )}
{/* Worktree merge actions are now in the Flags column (R5/R6) — available for all worktrees */}
                  </div>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Compact check status strip */}
      <CompactCheckStatus repoPath={repoPath} />

      {/* Commit Graph (collapsible) */}
      <details className="workspace-git-graph-details" data-testid="workspace-git-graph-details" style={{ marginBottom: 'var(--space-md)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--color-text-200)', fontSize: '0.85em', padding: '4px 0' }}>
          Commit Graph
        </summary>
        <WorkspaceCommitGraph repoPath={repoPath} compact />
      </details>

      {/* ================================================================ */}
      {/* SECTION 4 — Sticky Bottom Composer (Verify & Commit)            */}
      {/* ================================================================ */}
      <div className="workspace-git-composer" data-testid="workspace-git-composer">
        <div className="workspace-git-composer-inner">
          {/* Primary action: Verify & Commit */}
          <Button
            variant="primary"
            size="sm"
            disabled={!gitState.commitMessage.trim() || commitPhase === 'running-checks'}
            onClick={() => void handleVerifyAndCommit()}
            testId="workspace-verify-commit"
          >
            {commitPhase === 'running-checks' ? 'Running checks...' : 'Verify & Commit'}
          </Button>

          {/* Force commit area (shown when checks fail) */}
          {failedCheckResults && (
            <div className="workspace-git-force-commit-area" data-testid="workspace-force-commit-area">
              {!showForceCommitDialog ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowForceCommitDialog(true)}
                  testId="workspace-force-commit-btn"
                >
                  Force Commit
                </Button>
              ) : (
                <div className="workspace-git-force-dialog" data-testid="workspace-force-commit-dialog">
                  <input
                    className="form-input-field"
                    placeholder="Override reason required..."
                    value={forceOverrideReason}
                    onChange={(e) => setForceOverrideReason(e.target.value)}
                    data-testid="workspace-force-reason-input"
                  />
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!forceOverrideReason.trim() || forceCommitting}
                    onClick={() => void handleForceCommit()}
                    testId="workspace-force-commit-confirm"
                  >
                    {forceCommitting ? '...' : 'Force Commit (skip verification)'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowForceCommitDialog(false); setForceOverrideReason(''); }}
                    testId="workspace-force-commit-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Commit message input */}
          <input
            className="form-input-field workspace-git-composer-input"
            type="text"
            placeholder="Commit message..."
            value={gitState.commitMessage}
            onChange={(e) => onSetCommitMessage(e.target.value)}
            disabled={gitState.committing}
            data-testid="workspace-commit-input"
          />

          {/* Commit button (standalone) */}
          <Button
            variant="secondary"
            size="sm"
            disabled={!gitState.commitMessage.trim() || gitState.committing}
            onClick={onCommit}
            testId="workspace-commit"
          >
            {gitState.committing ? 'Committing...' : 'Commit'}
          </Button>

          {/* Push button */}
          <Button
            variant="secondary"
            size="sm"
            disabled={pushDisabled}
            onClick={onPush}
            testId="workspace-push"
          >
            {gitState.syncing ? 'Pushing...' : 'Push ⬆'}
          </Button>

          {/* ─── Stash area ────────────────────────────────────────────────── */}
          <div className="workspace-git-stash-area" data-testid="workspace-git-stash-area">
            <div className="workspace-git-stash-header">
              <span className="workspace-git-stash-count" data-testid="workspace-stash-count">
                Stashes ({stashes.length})
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCreateStash()}
                disabled={changeCount === 0}
                testId="workspace-stash-create"
              >
                Stash changes
              </Button>
              {stashes.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowStashList(!showStashList)}
                  testId="workspace-stash-toggle-list"
                >
                  {showStashList ? 'Hide' : 'Show'} list
                </Button>
              )}
            </div>

            {showStashList && stashes.length > 0 && (
              <div className="workspace-git-stash-list" data-testid="workspace-stash-list">
                {stashes.map((s) => (
                  <div key={s.index} className="workspace-git-stash-entry" data-testid={`workspace-stash-entry-${s.index}`}>
                    <span className="workspace-git-stash-entry-ref" data-testid={`workspace-stash-ref-${s.index}`}>
                      stash@{s.index}
                    </span>
                    <span className="workspace-git-stash-entry-msg" data-testid={`workspace-stash-msg-${s.index}`}>
                      {s.message}
                    </span>
                    <div className="workspace-git-stash-entry-actions">
                      <Button variant="ghost" size="sm" onClick={() => void handleApplyStash(s.index)} testId={`workspace-stash-apply-${s.index}`}>
                        Apply
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handlePopStash(s.index)} testId={`workspace-stash-pop-${s.index}`}>
                        Pop
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDropStash(s.index)} testId={`workspace-stash-drop-${s.index}`}>
                        Drop
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Collapsible PR create */}
          <div className="workspace-git-composer-pr-area">
            {pullRequest ? (
              <div className="workspace-git-pr-existing" data-testid="workspace-git-pr-existing">
                <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" className="workspace-git-pr-link">
                  PR #{pullRequest.number} ({pullRequest.state})
                </a>
                <Button variant="ghost" size="sm" onClick={onOpenPR} testId="workspace-open-pr">
                  Open PR
                </Button>
              </div>
            ) : hasRemote ? (
              <>
                <button
                  type="button"
                  className="workspace-git-composer-pr-toggle"
                  onClick={() => setShowPrForm(!showPrForm)}
                  data-testid="workspace-toggle-pr-form"
                >
                  {showPrForm ? '−' : '+'} Create PR
                </button>
                {showPrForm ? (
                  <div className="workspace-git-pr-create" data-testid="workspace-git-pr-create">
                    <input
                      className="form-input-field"
                      type="text"
                      placeholder="PR title..."
                      value={gitState.pullRequestTitle}
                      onChange={(e) => onSetPullRequestTitle(e.target.value)}
                      disabled={gitState.creatingPullRequest}
                    />
                    <input
                      className="form-input-field"
                      type="text"
                      placeholder="PR body (optional)..."
                      value={gitState.pullRequestBody}
                      onChange={(e) => onSetPullRequestBody(e.target.value)}
                      disabled={gitState.creatingPullRequest}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!gitState.pullRequestTitle.trim() || gitState.creatingPullRequest}
                      onClick={onCreatePR}
                      testId="workspace-create-pr"
                    >
                      {gitState.creatingPullRequest ? 'Creating...' : 'Create pull request'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {/* Verification warning */}
        {verificationState !== 'verified' && changeCount > 0 ? (
          <div className="workspace-git-composer-warning" data-testid="workspace-commit-warning">
            ⚠ Checks are not verified. Run Verify & Commit before pushing.
          </div>
        ) : null}

        {/* Commit & Push without verifying */}
        <div className="workspace-git-composer-actions" style={{ marginTop: 'var(--space-sm)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-sm)' }}>
          {!showSkipVerifyConfirm ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!gitState.commitMessage.trim() || gitState.committing || gitState.syncing}
              onClick={() => setShowSkipVerifyConfirm(true)}
              testId="workspace-skip-verify-commit"
            >
              Commit & Push (skip verify)
            </Button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <span style={{ color: 'var(--color-accent-500)', fontSize: '0.8rem' }}>⚠ Skip verification and push directly?</span>
              <Button
                variant="primary"
                size="sm"
                disabled={skipVerifyCommitting}
                onClick={async () => {
                  if (!repoPath) return;
                  setSkipVerifyCommitting(true);
                  try {
                    // Use direct commit with skip-verification override
                    const commitResult = await commitGit(repoPath, gitState.commitMessage, { reason: 'skip verify' });
                    if (commitResult.error) {
                      notificationStore.error('Skip-verify commit failed', { message: commitResult.error });
                      setSkipVerifyCommitting(false);
                      return;
                    }
                    await pushGit(repoPath, false, { reason: 'skip verify' });
                    notificationStore.success('Committed & pushed', { message: 'Changes committed and pushed (skipped verification)' });
                  } catch (err) {
                    notificationStore.error('Skip-verify failed', { message: err instanceof Error ? err.message : String(err) });
                  } finally {
                    setSkipVerifyCommitting(false);
                    setShowSkipVerifyConfirm(false);
                  }
                }}
                testId="workspace-skip-verify-confirm"
              >
                {skipVerifyCommitting ? 'Committing...' : 'Yes, commit & push'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSkipVerifyConfirm(false)}
                testId="workspace-skip-verify-cancel"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        {/* Push disabled hint */}
        {pushDisabled && changeCount > 0 ? (
          <div className="workspace-git-composer-hint" data-testid="workspace-push-hint">
            Push disabled — run Verify & Commit first
          </div>
        ) : null}

        {/* Checks results */}
        {checkResults ? (
          <div
            className={`workspace-git-composer-checks ${checkResults.allPassed ? 'workspace-checks-passed' : 'workspace-checks-failed'}`}
            data-testid="workspace-checks-result"
          >
            <div className="workspace-git-checks-header">
              <span>{checkResults.allPassed ? '✓ All checks passed' : `✗ ${checkResults.checksFailed} of ${checkResults.checksRun} checks failed`}</span>
              <Button variant="ghost" size="sm" onClick={onRunChecks} disabled={runningChecks} testId="workspace-checks-rerun">
                {runningChecks ? 'Running...' : 'Re-run checks'}
              </Button>
            </div>
            {checkResults.results && checkResults.results.length > 0 ? (
              <details className="workspace-git-checks-results-detail">
                <summary>View check results</summary>
                <ul className="workspace-git-checks-list">
                  {checkResults.results.map((r, i) => (
                    <li key={i} className={r.passed ? 'workspace-check-item-passed' : 'workspace-check-item-failed'}>
                      <strong>{r.checkName}</strong>: {r.passed ? 'Passed' : (r.error || 'Failed')}
                      {r.output && !r.passed ? <pre className="workspace-check-output">{r.output.slice(0, 500)}</pre> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        {/* Checks discovered disclosure */}
        {discoveredChecks && discoveredChecks.checks.length > 0 ? (
          <div className="workspace-git-checks-disclosure" data-testid="workspace-checks-disclosure">
            <div className="workspace-git-checks-disclosure-header" data-testid="workspace-checks-disclosure-header">✓ Checks discovered ({discoveredChecks.checks.length})</div>
            <div className="workspace-git-checks-disclosure-content" data-testid="workspace-checks-disclosure-content">
              {discoveredChecks.checks.map((c) => (
                <div key={c.name} className="workspace-git-checks-disclosure-item">
                  <span className="workspace-git-checks-disclosure-name">{c.name}</span>
                  <span className="workspace-git-checks-disclosure-desc">{c.description}</span>
                  <code className="workspace-git-checks-disclosure-path">{c.path}</code>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* ================================================================ */}
      {/* SECTION 5 — Commit Log                                          */}
      {/* ================================================================ */}
      <div className="workspace-git-actions-area" data-testid="workspace-git-actions-area">
        {gitState.log && gitState.log.commits.length > 0 ? (
          <div className="workspace-commit-log" data-testid="workspace-commit-log">
            <h3 className="workspace-git-section-title">Recent Commits</h3>
            {gitState.log.commits.slice(0, 5).map((commit, index) => (
              <div key={commit.hash}>
                <button
                  type="button"
                  className="workspace-commit-entry workspace-commit-entry-clickable"
                  onClick={() => setExpandedCommit(expandedCommit === index ? null : index)}
                  data-testid={`workspace-commit-entry-${index}`}
                >
                  <span className="workspace-commit-hash">{commit.hash.slice(0, 7)}</span>
                  <span className="workspace-commit-msg">{commit.message}</span>
                </button>
                {expandedCommit === index ? (
                  <div className="workspace-commit-detail" data-testid={`workspace-commit-detail-${index}`}>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Hash</span>
                      <span className="workspace-commit-detail-value">{commit.hash}</span>
                    </div>
                    {commit.fullHash ? (
                      <div className="workspace-commit-detail-row">
                        <span className="workspace-commit-detail-label">Full hash</span>
                        <span className="workspace-commit-detail-value">{commit.fullHash}</span>
                      </div>
                    ) : null}
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Message</span>
                      <span className="workspace-commit-detail-value">{commit.message}</span>
                    </div>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Author</span>
                      <span className="workspace-commit-detail-value">{commit.author || 'Unknown author'}</span>
                    </div>
                    <div className="workspace-commit-detail-row">
                      <span className="workspace-commit-detail-label">Date</span>
                      <span className="workspace-commit-detail-value">{commit.authoredAt || 'Unknown date'}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="state-message" data-testid="workspace-commit-log-empty">No commits found.</div>
        )}
      </div>
    </div>
  );
}
