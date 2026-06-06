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
} from '../../lib/api/git';
import {
  getMergeCandidates,
  mergeDryRun,
  mergeLocal,
  pullGit,
  checkoutGitBranch,
  discoverGitChecks,
} from '../../lib/api/git';
import { listExecutorWorktrees, analyzeWorktreeCleanup, removeWorktree, pruneWorktrees } from '../../lib/api/executor';
import type { ExecutorWorktreeRecord } from '../../lib/types';
import type { VerificationState } from '../Repositories/verification';

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

function sortForDisplay(records: ExecutorWorktreeRecord[]): ExecutorWorktreeRecord[] {
  return records.slice().sort((left, right) => {
    const delta = getRecordTimestamp(right) - getRecordTimestamp(left);
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
  };
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface WorkspaceGitTabProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  repoId: string | null;
  gitState: GitState;
  verificationState: VerificationState;
  checkResults: GitCheckResults | null;
  runningChecks: boolean;
  onRunChecks: () => void;
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
  const [pruning, setPruning] = useState(false);

  // ─── Checks discovery state ────────────────────────────────────────────────
  const [discoveredChecks, setDiscoveredChecks] = useState<GitChecksDiscoverResponse | null>(null);
  const [showChecksDetail, setShowChecksDetail] = useState(false);

  // ─── Verify & Commit flow ──────────────────────────────────────────────────
  const [commitPhase, setCommitPhase] = useState<'idle' | 'running-checks' | 'checks-passed' | 'committing'>('idle');

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

  // ─── Verify & Commit handler ───────────────────────────────────────────────
  async function handleVerifyAndCommit() {
    if (!gitState.commitMessage.trim()) return;
    setCommitPhase('running-checks');
    onRunChecks();
    // Sync effects handle transitions: running-checks → checks-passed → committing
  }

  // Synchronize commitPhase with verification state
  useEffect(() => {
    if (commitPhase === 'running-checks' && !runningChecks && checkResults?.allPassed) {
      setCommitPhase('checks-passed');
    }
    if (commitPhase === 'running-checks' && !runningChecks && checkResults && !checkResults.allPassed) {
      setCommitPhase('idle');
    }
  }, [commitPhase, runningChecks, checkResults]);

  // Notify when checks fail
  useEffect(() => {
    if (commitPhase === 'running-checks' && !runningChecks && checkResults && !checkResults.allPassed) {
      notificationStore.error('Checks failed', {
        message: `${checkResults.checksFailed} check(s) failed. Fix issues before committing.`,
      });
    }
  }, [commitPhase, runningChecks, checkResults]);

  // Auto-commit when checks pass and in the right phase
  useEffect(() => {
    if (commitPhase === 'checks-passed' && verificationState === 'verified' && gitState.commitMessage.trim()) {
      setCommitPhase('committing');
      onCommit();
      // Reset after committing
      const timer = setTimeout(() => setCommitPhase('idle'), 2000);
      return () => clearTimeout(timer);
    }
  }, [commitPhase, verificationState, onCommit, gitState.commitMessage]);

  // ─── Resolve branches ──────────────────────────────────────────────────────
  const localBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []).filter((b) => !b.remote);
  const remoteBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []).filter((b) => b.remote);
  const allBranches: GitBranchEntry[] = (gitState.branches?.branches ?? []);


  // ─── Worktrees display ─────────────────────────────────────────────────────
  const worktreeDisplay = sortForDisplay(worktreeRecords).slice(0, MAX_ROWS).map(toDisplay);

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

  async function handleRemoveWorktree(worktreePath: string) {
    const analysis = cleanupAnalyses[worktreePath];
    if (!analysis || !analysis.eligible) return;
    setRemoving(worktreePath);
    try {
      const result = await removeWorktree(repoPath, worktreePath);
      if (result.removed) {
        notificationStore.success('Worktree removed', { message: worktreePath });
        // Refresh worktree list
        loadWorktrees();
      }
    } catch (err) {
      notificationStore.error('Remove failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRemoving(null);
    }
  }

  async function handlePrune() {
    setPruning(true);
    try {
      const result = await pruneWorktrees(repoPath);
      if (result.pruned) {
        notificationStore.success('Pruned', { message: result.output || 'Worktrees pruned' });
        loadWorktrees();
      }
    } catch (err) {
      notificationStore.error('Prune failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setPruning(false);
    }
  }

  async function handleBatchRemove() {
    const safePaths = Object.entries(cleanupAnalyses)
      .filter(([, analysis]) => analysis.eligible)
      .map(([path]) => path);
    for (const wtPath of safePaths) {
      await handleRemoveWorktree(wtPath);
    }
  }

  // ─── Push disabled state ───────────────────────────────────────────────────
  const pushDisabled = verificationState !== 'verified' || changeCount === 0 || gitState.syncing;

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
        <h3 className="workspace-git-section-title">
          Worktrees ({worktreeRecords.length})
        </h3>

        {/* Batch cleanup action bar */}
        {worktreeDisplay.length > 0 ? (
          <div className="workspace-git-cleanup-actions" data-testid="workspace-worktrees-cleanup-bar">
            <button
              type="button"
              className="button button-sm button-secondary"
              disabled={pruning}
              onClick={() => void handlePrune()}
              data-testid="workspace-worktrees-prune"
            >
              {pruning ? 'Pruning...' : 'Prune stale'}
            </button>
            <button
              type="button"
              className="button button-sm button-secondary"
              disabled={Object.values(cleanupAnalyses).filter(a => a.eligible).length === 0}
              onClick={() => void handleBatchRemove()}
              data-testid="workspace-worktrees-batch-remove"
            >
              Remove merged & safe
            </button>
            <span className="workspace-git-cleanup-detail" data-testid="workspace-worktrees-safe-count">
              {Object.values(cleanupAnalyses).filter(a => a.eligible).length} safe to remove
            </span>
          </div>
        ) : null}

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
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-source-${entry.key}`}>
                    {entry.sourceLabel}
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-status-${entry.key}`}>
                    {entry.statusLabel}
                  </td>
                  <td className="workspace-git-table-cell" data-testid={`workspace-worktree-dirty-${entry.key}`}>
                    {entry.dirty ? `${entry.dirtyCount} dirty` : 'clean'}
                  </td>
                  <td className="workspace-git-table-cell">
                    <div className="workspace-git-worktree-flags">
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
                          onClick={() => void handleRemoveWorktree(entry.path)}
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
                  </div>
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ================================================================ */}
      {/* SECTION 4 — Sticky Bottom Composer (Verify & Commit)            */}
      {/* ================================================================ */}
      <div className="workspace-git-composer" data-testid="workspace-git-composer">
        <div className="workspace-git-composer-inner">
          {/* Primary action: Verify & Commit */}
          <Button
            variant="primary"
            size="sm"
            disabled={!gitState.commitMessage.trim() || commitPhase === 'running-checks' || commitPhase === 'committing'}
            onClick={() => void handleVerifyAndCommit()}
            testId="workspace-verify-commit"
          >
            {commitPhase === 'running-checks' ? 'Running checks...' : commitPhase === 'committing' ? 'Committing...' : 'Verify & Commit'}
          </Button>

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
            {checkResults.allPassed ? '✓ All checks passed' : '✗ Some checks failed'}
          </div>
        ) : null}

        {/* Checks discovered disclosure */}
        {discoveredChecks && discoveredChecks.checks.length > 0 ? (
          <details className="workspace-git-checks-disclosure" data-testid="workspace-checks-disclosure">
            <summary
              onClick={() => setShowChecksDetail(!showChecksDetail)}
              data-testid="workspace-checks-disclosure-summary"
            >
              ✓ Checks discovered ({discoveredChecks.checks.length})
            </summary>
            {showChecksDetail ? (
              <div className="workspace-git-checks-disclosure-content" data-testid="workspace-checks-disclosure-content">
                {discoveredChecks.checks.map((c) => (
                  <div key={c.name} className="workspace-git-checks-disclosure-item">
                    <span className="workspace-git-checks-disclosure-name">{c.name}</span>
                    <span className="workspace-git-checks-disclosure-desc">{c.description}</span>
                    <code className="workspace-git-checks-disclosure-path">{c.path}</code>
                  </div>
                ))}
              </div>
            ) : null}
          </details>
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
