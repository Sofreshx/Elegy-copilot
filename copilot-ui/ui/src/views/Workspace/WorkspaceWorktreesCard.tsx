import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { listExecutorWorktrees, removeWorktreeWithBranch } from '../../lib/api/executor';
import { getEnrichedWorktrees } from '../../lib/api/elegyDb';
import { navigationStore } from '../../stores/navigation';
import { notificationStore } from '../../stores/notificationStore';
import type { ExecutorWorktreeRecord } from '../../lib/types';
import type { EnrichedWorktreeEntry } from '../../lib/types';

interface WorkspaceWorktreesCardProps {
  repoId: string | null;
  repoPath: string;
}

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
  createdAt: string;
  path: string;
  isMissing: boolean;
  isLaunchBlocked: boolean;
  hasAssignment: boolean;
  isReusable: boolean;
  isInterrupted: boolean;
  probeError: string | null;
  sessionCount: number;
  hasActiveSessions: boolean;
  linkedPlanId: string | null;
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
    createdAt,
    path: record.path || record.worktreePath || '',
    isMissing,
    isLaunchBlocked,
    hasAssignment,
    isReusable: status === 'reusable',
    isInterrupted: status === 'interrupted',
    probeError,
    sessionCount: 0,
    hasActiveSessions: false,
    linkedPlanId: null,
    enrichedStatus: null,
  };
}

export default function WorkspaceWorktreesCard({ repoId, repoPath }: WorkspaceWorktreesCardProps) {
  const [records, setRecords] = useState<ExecutorWorktreeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [gitListError, setGitListError] = useState<string | null>(null);
  const [enrichedWorktrees, setEnrichedWorktrees] = useState<EnrichedWorktreeEntry[]>([]);
  const [enrichedLoading, setEnrichedLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!repoPath) {
        setRecords([]);
        return;
      }
      setLoading(true);
      try {
        const response = await listExecutorWorktrees({ repoId: repoId || undefined, repoPath });
        if (!cancelled) {
          setRecords(response.worktrees || []);
          setGitListError(response.worktreeDiscovery ? response.worktreeDiscovery.gitListError : null);
        }
      } catch {
        if (!cancelled) {
          setRecords([]);
          setGitListError(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoId, repoPath]);

  useEffect(() => {
    let cancelled = false;
    async function loadEnriched() {
      if (!repoPath) return;
      setEnrichedLoading(true);
      try {
        const data = await getEnrichedWorktrees(repoPath);
        if (!cancelled) setEnrichedWorktrees(data.worktrees || []);
      } catch {
        // enriched data is optional, don't error
      } finally {
        if (!cancelled) setEnrichedLoading(false);
      }
    }
    void loadEnriched();
    return () => { cancelled = true; };
  }, [repoPath]);

  if (loading) {
    return (
      <Panel title="Worktrees" subtitle="Scanning git" testId="workspace-worktrees-card">
        <div className="state-message">Scanning worktrees...</div>
      </Panel>
    );
  }

  if (!records.length) {
    return (
      <Panel title="Worktrees" subtitle="0 found" testId="workspace-worktrees-card">
        <div className="state-message" data-testid="workspace-worktrees-empty">
          No worktrees found for this repo.
        </div>
        {gitListError ? (
          <div className="workspace-worktrees-error" data-testid="workspace-worktrees-git-error">
            git discovery failed: {gitListError}
          </div>
        ) : null}
      </Panel>
    );
  }

  const display = sortForDisplay(records).slice(0, MAX_ROWS).map(record => {
    const entry = toDisplay(record);
    // Merge enriched data by matching worktree path
    const enriched = enrichedWorktrees.find(w => {
      const wtPath = (w.path || '').replace(/\\/g, '/').toLowerCase();
      const entryPath = (entry.path || '').replace(/\\/g, '/').toLowerCase();
      return wtPath && entryPath && (wtPath === entryPath || entryPath.endsWith(wtPath) || wtPath.endsWith(entryPath));
    });
    if (enriched) {
      entry.sessionCount = enriched.sessionCount || 0;
      entry.hasActiveSessions = enriched.sessionCount > 0;
      entry.linkedPlanId = enriched.sessions && enriched.sessions.length > 0 ? enriched.sessions[0].sessionId : null;
      entry.enrichedStatus = enriched.status || null;
    }
    return entry;
  });
  const total = records.length;
  const subtitle = total > MAX_ROWS
    ? `${MAX_ROWS} newest of ${total}`
    : `${total} found`;

  return (
    <Panel title="Worktrees" subtitle={subtitle} testId="workspace-worktrees-card">
      {gitListError ? (
        <div className="workspace-worktrees-error" data-testid="workspace-worktrees-git-error">
          git discovery failed: {gitListError}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '8px' }}>
        <button
          type="button"
          className="button button-sm button-ghost"
          onClick={async () => {
            setLoading(true);
            try {
              const response = await listExecutorWorktrees({ repoId: repoId || undefined, repoPath });
              setRecords(response.worktrees || []);
              setGitListError(response.worktreeDiscovery ? response.worktreeDiscovery.gitListError : null);
            } catch {
              setRecords([]);
              setGitListError(null);
            } finally {
              setLoading(false);
            }
            // Also reload enriched
            setEnrichedLoading(true);
            try {
              const data = await getEnrichedWorktrees(repoPath);
              setEnrichedWorktrees(data.worktrees || []);
            } catch {
              // enriched optional
            } finally {
              setEnrichedLoading(false);
            }
          }}
          title="Reload worktrees"
          aria-label="Reload worktrees"
          data-testid="workspace-worktrees-card-reload"
        >
          ↻ Reload
        </button>
      </div>
      <ul className="workspace-worktrees-list" data-testid="workspace-worktrees-list">
        {display.map((entry) => {
          const classes = ['workspace-worktree-item'];
          if (entry.dirty) classes.push('workspace-worktree-dirty');
          if (entry.isMissing) classes.push('workspace-worktree-missing');
          if (entry.isLaunchBlocked) classes.push('workspace-worktree-blocked');
          if (entry.hasAssignment) classes.push('workspace-worktree-assigned');
          if (entry.isReusable) classes.push('workspace-worktree-reusable');
          if (entry.isInterrupted) classes.push('workspace-worktree-interrupted');
          return (
            <li
              key={entry.key}
              className={classes.join(' ')}
              data-testid={`workspace-worktree-${entry.key}`}
            >
              <div className="workspace-worktree-row">
                <span className="workspace-worktree-source" data-testid={`workspace-worktree-source-${entry.key}`}>
                  {entry.sourceLabel}
                </span>
                <span className="workspace-worktree-status" data-testid={`workspace-worktree-status-${entry.key}`}>
                  {entry.statusLabel}
                </span>
                <span className="workspace-worktree-branch" title={entry.path}>
                  {entry.branchLabel}
                </span>
                {entry.sessionCount > 0 && (
                  <span className="workspace-worktree-sessions" title={`${entry.sessionCount} active session(s)`}>
                    {entry.sessionCount} session{entry.sessionCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <div className="workspace-worktree-row workspace-worktree-meta">
                <span className="workspace-worktree-dirty" data-testid={`workspace-worktree-dirty-${entry.key}`}>
                  {entry.dirty
                    ? `${entry.dirtyCount} dirty`
                    : 'clean'}
                </span>
                {entry.enrichedStatus ? (
                  <span className="workspace-worktree-enriched-status" style={{ color: entry.hasActiveSessions ? 'var(--color-success-500)' : 'var(--color-ink-400)', fontSize: '0.7rem' }}>
                    {entry.hasActiveSessions ? '● active' : `● ${entry.enrichedStatus}`}
                  </span>
                ) : null}
                {entry.ahead > 0 || entry.behind > 0 ? (
                  <span className="workspace-worktree-ahead-behind" data-testid={`workspace-worktree-ahead-behind-${entry.key}`}>
                    {entry.ahead > 0 ? `+${entry.ahead} ahead` : ''}
                    {entry.ahead > 0 && entry.behind > 0 ? ' ' : ''}
                    {entry.behind > 0 ? `-${entry.behind} behind` : ''}
                  </span>
                ) : null}
                <span className="workspace-worktree-updated" data-testid={`workspace-worktree-updated-${entry.key}`}>
                  {entry.updatedAtLabel}
                </span>
                <span className="workspace-worktree-created" data-testid={`workspace-worktree-created-${entry.key}`}>
                  {entry.createdAt}
                </span>
              </div>
              <div className="workspace-worktree-path" data-testid={`workspace-worktree-path-${entry.key}`}>
                {entry.path}
              </div>
              {entry.isMissing ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-missing">path missing</div>
              ) : null}
              {entry.isLaunchBlocked ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-blocked">launch blocked</div>
              ) : null}
              {entry.hasAssignment ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-assigned">active assignment</div>
              ) : null}
              {entry.isReusable ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-reusable">reusable</div>
              ) : null}
              {entry.isInterrupted ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-interrupted">interrupted</div>
              ) : null}
              {entry.probeError ? (
                <div className="workspace-worktree-flag workspace-worktree-flag-error">{entry.probeError}</div>
              ) : null}
              <div className="workspace-worktree-actions">
                <button
                  type="button"
                  className="workspace-worktree-code-review-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Navigate to the Review tab in the workspace
                    navigationStore.setActiveWorkspaceLocalTab('review');
                    // Store the selected worktree path for the review tab to pre-select
                    // (the WorkspaceReviewTab will auto-select the most active worktree)
                  }}
                  title="Start code review for this worktree"
                  data-testid={`workspace-worktree-review-${entry.key}`}
                >
                  <span aria-hidden="true">{'\uD83D\uDD0D'}</span> Review
                </button>
                {showRemoveConfirm === entry.key ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ color: 'var(--color-accent-500)', fontSize: '0.75rem' }}>
                      {entry.hasActiveSessions ? '⚠ Active sessions! Remove?' : 'Remove?'}
                    </span>
                    <button
                      type="button"
                      className="button button-sm button-secondary"
                      disabled={removing === entry.key}
                      onClick={async () => {
                        setRemoving(entry.key);
                        setShowRemoveConfirm(null);
                        try {
                          const result = await removeWorktreeWithBranch(repoPath, entry.path, entry.branchLabel);
                          if (result.removed) {
                            notificationStore.success('Worktree removed', { message: entry.path });
                            // Reload
                            setLoading(true);
                            try {
                              const response = await listExecutorWorktrees({ repoId: repoId || undefined, repoPath });
                              setRecords(response.worktrees || []);
                            } catch { /* ignore */ }
                            finally { setLoading(false); }
                          }
                        } catch (err) {
                          notificationStore.error('Remove failed', { message: err instanceof Error ? err.message : String(err) });
                        } finally {
                          setRemoving(null);
                        }
                      }}
                      data-testid={`workspace-worktree-card-remove-confirm-${entry.key}`}
                    >
                      {removing === entry.key ? '...' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      className="button button-sm button-ghost"
                      onClick={() => setShowRemoveConfirm(null)}
                      data-testid={`workspace-worktree-card-remove-cancel-${entry.key}`}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="workspace-worktree-remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRemoveConfirm(entry.key);
                    }}
                    title={entry.hasActiveSessions ? 'Remove (has active sessions)' : 'Remove worktree'}
                    data-testid={`workspace-worktree-card-remove-${entry.key}`}
                  >
                    ✕ Remove
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
