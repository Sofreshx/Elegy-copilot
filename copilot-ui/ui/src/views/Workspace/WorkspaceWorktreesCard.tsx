import { useState, useEffect } from 'react';
import { Panel } from '../../components';
import { listExecutorWorktrees } from '../../lib/api/executor';
import type { ExecutorWorktreeRecord } from '../../lib/types';

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

export default function WorkspaceWorktreesCard({ repoId, repoPath }: WorkspaceWorktreesCardProps) {
  const [records, setRecords] = useState<ExecutorWorktreeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [gitListError, setGitListError] = useState<string | null>(null);

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

  const display = sortForDisplay(records).slice(0, MAX_ROWS).map(toDisplay);
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
              </div>
              <div className="workspace-worktree-row workspace-worktree-meta">
                <span className="workspace-worktree-dirty" data-testid={`workspace-worktree-dirty-${entry.key}`}>
                  {entry.dirty
                    ? `${entry.dirtyCount} dirty`
                    : 'clean'}
                </span>
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
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
