import { useEffect, useMemo, useState } from 'react';
import {
  AppIcon,
  Badge,
  Button,
  PageContainer,
  Panel,
  Toolbar,
} from '../../components';
import type {
  RepoOperationsBranch,
  RepoOperationsCapability,
  RepoOperationsCleanupCandidate,
  RepoOperationsIssue,
  RepoOperationsPullRequest,
  RepoOperationsRepository,
} from '../../lib/api/repoOperations';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import {
  repoOperationsStore,
  type RepoOperationsFilter,
} from './repoOperationsStore';

function formatScanTime(value: string | null | undefined): string {
  if (!value) return 'Not scanned yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function display(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

const ISSUE_COPY: Record<string, { severity: 'error' | 'warning' | 'info'; title: string; message: string }> = {
  'dirty-worktree': { severity: 'error', title: 'Working tree is dirty', message: 'Uncommitted changes are present.' },
  'no-upstream': { severity: 'warning', title: 'No upstream configured', message: 'This branch is not tracking a remote branch.' },
  'upstream-gone': { severity: 'warning', title: 'Upstream is gone', message: 'The configured upstream branch is no longer available.' },
  diverged: { severity: 'error', title: 'Branch diverged', message: 'Local and upstream history have diverged.' },
  ahead: { severity: 'info', title: 'Ahead of upstream', message: 'Local commits have not been pushed.' },
  'ahead-of-upstream': { severity: 'info', title: 'Ahead of upstream', message: 'Local commits have not been pushed.' },
  behind: { severity: 'info', title: 'Behind upstream', message: 'Remote commits are available to fast-forward.' },
  'active-worktree': { severity: 'info', title: 'Worktree exists', message: 'This branch is checked out in a linked worktree.' },
  merged: { severity: 'info', title: 'Merged worktree', message: 'This branch is merged into the default branch.' },
  'active-session-or-worktree': { severity: 'warning', title: 'Active session or worktree', message: 'Managed activity is using this repository or worktree.' },
  'remote-unavailable': { severity: 'warning', title: 'Remote unavailable', message: 'The configured remote could not be reached.' },
  'no-remote': { severity: 'warning', title: 'No remote configured', message: 'No Git remote is configured for this repository.' },
  'unsupported-provider': { severity: 'warning', title: 'Provider not supported', message: 'Pull request reporting is only available for GitHub remotes.' },
  'missing-github-cli': { severity: 'warning', title: 'GitHub CLI unavailable', message: 'The GitHub CLI is not installed or could not be started.' },
  'github-authentication-unavailable': { severity: 'warning', title: 'GitHub authentication unavailable', message: 'GitHub CLI authentication could not be verified.' },
  'github-query-failed': { severity: 'warning', title: 'GitHub query failed', message: 'Open GitHub pull requests could not be loaded.' },
  'invalid-merge-request': { severity: 'warning', title: 'Invalid merge request', message: 'The merge request is missing a squash operation or expected head SHA.' },
  'stale-repository-state': { severity: 'warning', title: 'Repository state changed', message: 'The repository changed during the safe sync operation.' },
  'fast-forward-verification-failed': { severity: 'error', title: 'Fast-forward verification failed', message: 'The resulting branch was not clean and up to date.' },
  'sync-command-failed': { severity: 'error', title: 'Safe sync failed', message: 'The fetch or fast-forward operation could not complete.' },
  'missing-path': { severity: 'error', title: 'Repository unavailable', message: 'The repository path is unavailable.' },
  'linked-worktree-checkout': { severity: 'info', title: 'Linked worktree checkout', message: 'This checkout is represented by its canonical repository.' },
  'scan-failed': { severity: 'error', title: 'Repository scan failed', message: 'The repository could not be scanned.' },
  'git-command-failed': { severity: 'warning', title: 'Git command failed', message: 'A Git command could not complete.' },
  'command-timeout': { severity: 'warning', title: 'Command timed out', message: 'A repository command exceeded its time limit.' },
  'activity-state-unavailable': { severity: 'warning', title: 'Activity state unavailable', message: 'Managed session activity could not be verified.' },
  'repository-unavailable': { severity: 'error', title: 'Repository unavailable', message: 'The repository could not be opened.' },
  'branch-delete-failed': { severity: 'warning', title: 'Local branch retained', message: 'The worktree was removed, but Git kept the branch.' },
  'worktree-remove-failed': { severity: 'error', title: 'Worktree removal failed', message: 'Git could not remove the linked worktree.' },
  'cleanup-operation-unavailable': { severity: 'error', title: 'Cleanup unavailable', message: 'Safe Git cleanup operations are unavailable.' },
  'repository-not-in-catalog': { severity: 'error', title: 'Repository not in catalog', message: 'The repository is not in the canonical inventory.' },
  'invalid-cleanup-candidate': { severity: 'warning', title: 'Invalid cleanup candidate', message: 'A worktree path, branch, and observed Git SHAs are required.' },
  'not-merged': { severity: 'info', title: 'Not merged', message: 'The branch is not fully merged into the default branch.' },
  'worktree-dirty': { severity: 'error', title: 'Worktree is dirty', message: 'Uncommitted changes prevent safe cleanup.' },
  'current-worktree': { severity: 'warning', title: 'Primary worktree protected', message: 'The primary worktree is never removed.' },
  'current-branch': { severity: 'warning', title: 'Current branch protected', message: 'The active branch is never removed.' },
  'default-branch': { severity: 'warning', title: 'Default branch protected', message: 'The default branch is never removed.' },
  'worktree-state-unavailable': { severity: 'warning', title: 'Worktree state unavailable', message: 'The linked worktree could not be revalidated.' },
  'stale-cleanup-candidate': { severity: 'warning', title: 'State changed', message: 'The candidate no longer matches the confirmed scan.' },
};

function issueCodesForRepo(repo: RepoOperationsRepository): string[] {
  return Array.from(new Set([
    ...(repo.sync?.issueCodes || []),
    ...(repo.issues || []).map((entry) => entry.code),
  ]));
}

function issueTitle(code: string): string {
  return ISSUE_COPY[code]?.title || 'Repository state needs attention';
}

function issuesForCodes(codes: string[], context: Record<string, unknown> = {}): RepoOperationsIssue[] {
  return Array.from(new Map(codes.map((code) => {
    const fallback = ISSUE_COPY[code] || { severity: 'warning' as const, title: issueTitle(code), message: 'Repository state needs attention.' };
    return [code, { code, ...fallback, details: context }];
  })).values());
}

function issuesForRepo(repo: RepoOperationsRepository): RepoOperationsIssue[] {
  const known = Array.isArray(repo.issues) ? repo.issues : [];
  const knownCodes = new Set(known.map((issue) => issue.code));
  const normalizedKnown = known.map((issue) => {
    const fallback = ISSUE_COPY[issue.code];
    return {
      ...issue,
      severity: issue.severity || fallback?.severity || 'warning',
      title: issue.title || fallback?.title || issue.code,
      message: issue.message || fallback?.message || 'Repository state needs attention.',
      details: issue.details || { repository: repo.repoLabel },
    };
  });
  return [...normalizedKnown, ...issuesForCodes(issueCodesForRepo(repo).filter((code) => !knownCodes.has(code)), { repository: repo.repoLabel })];
}

function matchesQuery(values: unknown[], query: string): boolean {
  if (!query.trim()) return true;
  const normalized = query.trim().toLowerCase();
  return values.some((value) => String(value ?? '').toLowerCase().includes(normalized));
}

function branchTone(state: string): 'neutral' | 'brand' | 'accent' | 'success' | 'danger' {
  if (state === 'up-to-date' || state === 'default') return 'success';
  if (state === 'ahead' || state === 'behind' || state === 'merged' || state === 'active-worktree') return 'accent';
  if (state === 'diverged' || state === 'upstream-gone' || state === 'no-upstream') return 'danger';
  return 'neutral';
}

function IssueCluster({ issues, label }: { issues: RepoOperationsIssue[]; label: string }) {
  if (issues.length === 0) {
    return <span aria-label={`${label}: no issues`} className="repo-operations-status-icon repo-operations-status-icon-success" role="img" title="No issues"><AppIcon name="check" size={15} /></span>;
  }
  const counts = issues.reduce<Record<string, number>>((result, issue) => {
    const severity = issue.severity === 'error' || issue.severity === 'warning' ? issue.severity : 'info';
    result[severity] = (result[severity] || 0) + 1;
    return result;
  }, {});
  return (
    <details className="repo-operations-issue-details" data-testid={`repo-operations-issues-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
      <summary aria-label={`${label}: ${issues.length} issue${issues.length === 1 ? '' : 's'}`} className="repo-operations-issue-summary">
        {(['error', 'warning', 'info'] as const).map((severity) => counts[severity] ? (
          <span className={`repo-operations-issue-count repo-operations-issue-count-${severity}`} key={severity} title={`${counts[severity]} ${severity} issue${counts[severity] === 1 ? '' : 's'}`}>
            <AppIcon name={severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info'} size={14} />
            <span>{counts[severity]}</span>
          </span>
        ) : null)}
      </summary>
      <div className="repo-operations-issue-popover" role="list">
        {issues.map((issue, index) => (
          <div className="repo-operations-issue-item" key={`${issue.code}-${index}`} role="listitem">
            <span className={`repo-operations-issue-dot repo-operations-issue-dot-${issue.severity === 'error' || issue.severity === 'warning' ? issue.severity : 'info'}`} aria-hidden="true" />
            <div>
              <strong>{issue.title || issueTitle(issue.code)}</strong>
              <span>{issue.message}</span>
              {issue.details && Object.entries(issue.details).filter(([, value]) => value !== null && value !== undefined && value !== '').map(([key, value]) => (
                <small key={key}>{key}: {String(value)}</small>
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function SemanticStatus({ icon, label, tone = 'neutral', value }: { icon: 'check' | 'warning' | 'error' | 'info' | 'sync'; label: string; tone?: string; value?: string }) {
  return (
    <span aria-label={label} className={`repo-operations-semantic-status repo-operations-semantic-status-${tone}`} data-tooltip={label} role="img" tabIndex={0} title={label}>
      <AppIcon name={icon} size={16} />
      {value ? <span>{value}</span> : null}
    </span>
  );
}

function ActionButton({
  capability,
  onClick,
  loading = false,
  testId,
}: {
  capability?: RepoOperationsCapability;
  onClick?: () => void;
  loading?: boolean;
  testId?: string;
}) {
  if (!capability) return null;
  return (
    <Button
      disabled={!capability.enabled}
      loading={loading}
      loadingLabel="Working"
      onClick={onClick}
      size="sm"
      testId={testId || `repo-operations-action-${capability.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
      title={capability.reason || capability.description || undefined}
      variant="secondary"
    >
      {capability.label}
    </Button>
  );
}

function RepositoryAction({ repo, onPrepare }: { repo: RepoOperationsRepository; onPrepare: (repo: RepoOperationsRepository) => void }) {
  const actionsTestId = `repo-operations-repository-actions-${repo.repoId || repo.repoLabel}`;
  if (!repo.repoPath || !repo.available) {
    return <div className="repo-operations-row-actions" data-testid={actionsTestId}><span className="repo-operations-muted">Unavailable</span></div>;
  }
  const prCapability = repo.actionCapabilities?.prAgent;
  return (
    <div className="repo-operations-row-actions" data-testid={actionsTestId}>
      <Button
        onClick={() => navigationStore.openWorkspace(repo.repoPath!, repo.repoLabel)}
        size="sm"
        testId={`repo-operations-open-${repo.repoId || repo.repoLabel}`}
        variant="ghost"
      >
        Open workspace
      </Button>
      {prCapability ? (
        <Button
          disabled={!prCapability.enabled}
          onClick={() => onPrepare(repo)}
          size="sm"
          testId={`repo-operations-prepare-${repo.repoId || repo.repoLabel}`}
          title={prCapability.reason || prCapability.description || undefined}
          variant="secondary"
        >
          Prepare merge with OpenCode
        </Button>
      ) : null}
    </div>
  );
}

function SyncTable({ repositories, onPrepare }: { repositories: RepoOperationsRepository[]; onPrepare: (repo: RepoOperationsRepository) => void }) {
  return (
    <div className="table-wrap repo-operations-table-wrap">
      <table>
        <caption className="sr-only">Repository synchronization status</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Branch</th>
            <th scope="col">Upstream</th>
            <th scope="col">Working tree</th>
            <th scope="col">Ahead / behind</th>
            <th scope="col">Remote</th>
            <th scope="col">Sync action</th>
            <th scope="col">Issues</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {repositories.length === 0 ? (
            <tr><td className="empty-cell" colSpan={9}>No repositories match this filter.</td></tr>
          ) : repositories.map((repo) => {
            const issues = issuesForRepo(repo);
            const sync = repo.sync;
            const workingTreeLabel = !repo.available || sync?.clean === null
              ? 'Working tree state unavailable'
              : sync?.clean === true ? 'Working tree clean' : 'Working tree has uncommitted changes';
            const remoteLabel = sync?.remoteAvailable ? 'Remote available' : 'Remote unavailable';
            const syncBlocker = sync?.blockerCodes?.[0];
            const syncLabel = sync?.syncEligible
              ? 'Eligible for safe fast-forward sync'
              : `Sync blocked: ${syncBlocker ? issueTitle(syncBlocker) : 'Repository state needs attention'}`;
            return (
              <tr key={repo.repoId || repo.repoPath || repo.repoLabel}>
                <td>
                  <div className="repo-operations-primary-cell">{repo.repoLabel}</div>
                  <div className="repo-operations-secondary-cell">{display(repo.repoPath)}</div>
                </td>
                <td>{display(repo.sync?.branch)}</td>
                <td>{display(repo.sync?.upstream)}</td>
                <td>
                  <SemanticStatus
                    icon={!repo.available || sync?.clean === null ? 'warning' : sync?.clean ? 'check' : 'error'}
                    label={workingTreeLabel}
                    tone={!repo.available || sync?.clean === null ? 'warning' : sync?.clean ? 'success' : 'danger'}
                  />
                </td>
                <td>
                  <span className="repo-operations-ahead-behind" title={`Ahead ${sync?.ahead || 0}, behind ${sync?.behind || 0}`}>
                    <SemanticStatus icon={sync?.ahead ? 'warning' : 'check'} label={`${sync?.ahead || 0} commits ahead`} value={`+${sync?.ahead || 0}`} tone={sync?.ahead ? 'accent' : 'success'} />
                    <SemanticStatus icon={sync?.behind ? 'info' : 'check'} label={`${sync?.behind || 0} commits behind`} value={`−${sync?.behind || 0}`} tone={sync?.behind ? 'accent' : 'success'} />
                  </span>
                </td>
                <td>
                  <SemanticStatus icon={sync?.remoteAvailable ? 'check' : 'warning'} label={remoteLabel} tone={sync?.remoteAvailable ? 'success' : 'warning'} />
                </td>
                <td>
                  <SemanticStatus icon={sync?.syncEligible ? 'check' : 'warning'} label={syncLabel} tone={sync?.syncEligible ? 'success' : 'accent'} />
                </td>
                <td><IssueCluster issues={issues} label={`${repo.repoLabel} issues`} /></td>
                <td><RepositoryAction onPrepare={onPrepare} repo={repo} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BranchTable({ branches }: { branches: RepoOperationsBranch[] }) {
  return (
    <div className="table-wrap repo-operations-table-wrap">
      <table>
        <caption className="sr-only">Local branch hygiene</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Branch</th>
            <th scope="col">Upstream</th>
            <th scope="col">Status</th>
            <th scope="col">Worktree</th>
            <th scope="col">Cleanup</th>
            <th scope="col">Issues</th>
          </tr>
        </thead>
        <tbody>
          {branches.length === 0 ? (
            <tr><td className="empty-cell" colSpan={7}>No local branches match this filter.</td></tr>
          ) : branches.map((branch) => (
            <tr key={`${branch.repoId || branch.repoLabel}-${branch.name}`}>
              <td>{display(branch.repoLabel || branch.repoId)}</td>
              <td>
                <span className="repo-operations-primary-cell">{branch.name}</span>
                {branch.current ? <Badge tone="brand">current</Badge> : null}
              </td>
              <td>{display(branch.upstream || (branch.upstreamGone ? 'gone' : null))}</td>
              <td><Badge tone={branchTone(branch.state)}>{branch.state}</Badge></td>
              <td>{display(branch.worktree || (branch.activeWorktree ? 'active' : null))}</td>
              <td>{branch.cleanupEligible ? <Badge tone="accent">eligible</Badge> : <span className="repo-operations-muted">blocked</span>}</td>
              <td><IssueCluster issues={issuesForCodes(branch.issueCodes || [], { branch: branch.name, repository: branch.repoLabel || branch.repoId })} label={`${branch.name} issues`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PullRequestTable({ pullRequests }: { pullRequests: RepoOperationsPullRequest[] }) {
  return (
    <div className="table-wrap repo-operations-table-wrap">
      <table>
        <caption className="sr-only">Open GitHub pull requests</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Pull request</th>
            <th scope="col">Branch</th>
            <th scope="col">Review</th>
            <th scope="col">Checks / merge</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.length === 0 ? (
            <tr><td className="empty-cell" colSpan={6}>No open GitHub pull requests match this filter.</td></tr>
          ) : pullRequests.map((pullRequest) => (
            <tr key={`${pullRequest.repoId || pullRequest.repoLabel}-${pullRequest.number || pullRequest.title}`}>
              <td>{display(pullRequest.repoLabel || pullRequest.repoId)}</td>
              <td>
                <a className="repo-operations-link" href={pullRequest.url || undefined} target="_blank" rel="noreferrer">
                  #{display(pullRequest.number)} · {pullRequest.title}
                </a>
              </td>
              <td>
                <div>{display(pullRequest.headRefName)}</div>
                <div className="repo-operations-secondary-cell">into {display(pullRequest.baseRefName)}</div>
                <Badge tone={pullRequest.hasLocalBranch ? 'success' : 'neutral'}>
                  {pullRequest.hasLocalBranch ? 'local branch linked' : 'remote-only branch'}
                </Badge>
              </td>
              <td>{display(pullRequest.reviewDecision, 'not requested')}</td>
              <td>
                <div>{display(pullRequest.mergeStateStatus, 'unknown')}</div>
                <div className="repo-operations-secondary-cell">
                  {pullRequest.checksSummary ? `${pullRequest.checksSummary.passed} passed · ${pullRequest.checksSummary.failed} failed · ${pullRequest.checksSummary.pending} pending` : 'checks unavailable'}
                </div>
              </td>
              <td><Badge tone={pullRequest.isDraft ? 'accent' : 'success'}>{pullRequest.isDraft ? 'draft' : 'open'}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncConfirmationDialog({
  repositories,
  onCancel,
  onConfirm,
  loading,
}: {
  repositories: RepoOperationsRepository[];
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const eligible = repositories.filter((repo) => repo.sync?.syncEligible);
  const skipped = repositories.filter((repo) => !repo.sync?.syncEligible);
  const reasonCounts = skipped.reduce<Record<string, number>>((counts, repo) => {
    const reason = repo.sync?.blockerCodes?.[0] || 'unavailable';
    counts[reason] = (counts[reason] || 0) + 1;
    return counts;
  }, {});
  return (
    <div className="repo-operations-dialog-backdrop" role="presentation">
      <div aria-label="Confirm repository sync" aria-modal="true" className="repo-operations-dialog" role="dialog">
        <div className="repo-operations-dialog-header">
          <div>
            <div className="eyebrow">Safe sync</div>
            <h2>Confirm repository sync</h2>
            <p>Only clean current branches with a configured upstream are eligible. This fetches and fast-forwards; it never pushes, rebases, stashes, or deletes anything.</p>
          </div>
          <Button onClick={onCancel} size="sm" variant="ghost">Cancel</Button>
        </div>
        <div className="repo-operations-dialog-summary">
          <strong>{eligible.length} eligible {eligible.length === 1 ? 'repository' : 'repositories'}</strong>
          <span>{skipped.length} skipped by safety gates</span>
        </div>
        {eligible.length > 0 ? (
          <ul className="repo-operations-dialog-list">
            {eligible.map((repo) => <li key={repo.repoId || repo.repoPath}>{repo.repoLabel} · {display(repo.sync?.branch)}</li>)}
          </ul>
        ) : <p className="repo-operations-muted">There are no eligible repositories to sync right now.</p>}
        {Object.keys(reasonCounts).length > 0 ? (
          <div className="repo-operations-dialog-reasons">
            {Object.entries(reasonCounts).map(([reason, count]) => <Badge key={reason} tone="accent">{count} {issueTitle(reason)}</Badge>)}
          </div>
        ) : null}
        <div className="repo-operations-dialog-actions">
          <Button onClick={onCancel} variant="ghost">Cancel</Button>
          <Button disabled={eligible.length === 0} loading={loading} loadingLabel="Syncing" onClick={onConfirm} testId="repo-operations-confirm-sync" variant="primary">Confirm sync</Button>
        </div>
      </div>
    </div>
  );
}

function PullRequestPickerDialog({
  repo,
  onCancel,
  onSelect,
}: {
  repo: RepoOperationsRepository;
  onCancel: () => void;
  onSelect: (pullRequest: RepoOperationsPullRequest) => void;
}) {
  return (
    <div className="repo-operations-dialog-backdrop" role="presentation">
      <div aria-label={`Choose a pull request for ${repo.repoLabel}`} aria-modal="true" className="repo-operations-dialog" role="dialog">
        <div className="repo-operations-dialog-header">
          <div>
            <div className="eyebrow">{repo.repoLabel}</div>
            <h2>Choose a pull request</h2>
            <p>OpenCode preparation runs for this repository only. Local-only branches and PRs without fresh SHAs go to manual handling.</p>
          </div>
          <Button onClick={onCancel} size="sm" variant="ghost">Close</Button>
        </div>
        <div className="repo-operations-dialog-list">
          {repo.pullRequests.length === 0 ? <p className="repo-operations-muted">No open GitHub pull requests are available.</p> : repo.pullRequests.map((pullRequest) => {
            const ready = Boolean(pullRequest.number && pullRequest.baseRefName && pullRequest.headSha && pullRequest.baseSha);
            return (
              <div className="repo-operations-pr-picker-row" key={pullRequest.number || pullRequest.title}>
                <div>
                  <strong>#{display(pullRequest.number)} · {pullRequest.title}</strong>
                  <div className="repo-operations-secondary-cell">{display(pullRequest.headRefName)} → {display(pullRequest.baseRefName)} · {pullRequest.isDraft ? 'draft' : 'open'}</div>
                  {!ready ? <div className="repo-operations-muted">Observed head/base SHAs are unavailable; manual session required.</div> : null}
                </div>
                <Button aria-label={`#${display(pullRequest.number)} · ${pullRequest.title} — Prepare`} disabled={!ready} onClick={() => onSelect(pullRequest)} size="sm" testId={`repo-operations-select-pr-${repo.repoId}-${pullRequest.number}`} variant="secondary">Prepare</Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CleanupConfirmationDialog({
  candidates,
  onCancel,
  onConfirm,
  loading,
}: {
  candidates: RepoOperationsCleanupCandidate[];
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const skipped = candidates.filter((candidate) => !candidate.eligible);
  return (
    <div className="repo-operations-dialog-backdrop" role="presentation">
      <div aria-label="Confirm merged worktree cleanup" aria-modal="true" className="repo-operations-dialog repo-operations-cleanup-dialog" role="dialog">
        <div className="repo-operations-dialog-header">
          <div>
            <div className="eyebrow">Safe cleanup preview</div>
            <h2>Clean merged worktrees</h2>
            <p>Each candidate is freshly revalidated before mutation. Only clean, inactive linked worktrees merged into the default branch are removed, followed by a non-force local branch delete. Remote branches and the primary worktree are never touched.</p>
          </div>
          <Button onClick={onCancel} size="sm" variant="ghost">Cancel</Button>
        </div>
        <div className="repo-operations-dialog-summary">
          <strong>{eligible.length} eligible candidate{eligible.length === 1 ? '' : 's'}</strong>
          <span>{skipped.length} shown but protected or blocked</span>
        </div>
        {eligible.length > 0 ? (
          <ul className="repo-operations-dialog-list">
            {eligible.map((candidate) => <li key={`${candidate.repoId}-${candidate.worktreePath}-${candidate.branch}`}><strong>{candidate.repoLabel}</strong><span>{candidate.branch}</span><small>{candidate.worktreePath}</small></li>)}
          </ul>
        ) : <p className="repo-operations-muted">No candidate is currently eligible. Refresh the overview and try again.</p>}
        {skipped.length > 0 ? (
          <details className="repo-operations-cleanup-skipped">
            <summary>Show protected candidates ({skipped.length})</summary>
            <ul className="repo-operations-dialog-list">
              {skipped.map((candidate) => <li key={`${candidate.repoId}-${candidate.worktreePath}-${candidate.branch}`}><strong>{candidate.repoLabel}</strong><span>{candidate.branch}</span><small>{candidate.blockerCodes.length ? candidate.blockerCodes.map(issueTitle).join(' · ') : 'Not eligible'}</small></li>)}
            </ul>
          </details>
        ) : null}
        <div className="repo-operations-dialog-actions">
          <Button onClick={onCancel} variant="ghost">Cancel</Button>
          <Button disabled={eligible.length === 0} loading={loading} loadingLabel="Cleaning" onClick={onConfirm} testId="repo-operations-confirm-cleanup" variant="primary">Confirm cleanup</Button>
        </div>
      </div>
    </div>
  );
}

function CleanupResult({ result }: { result: { summary: { removedWorktrees: number; deletedBranches: number; partial: number; skipped: number; failed: number } } }) {
  return (
    <div className="repo-operations-result" role="status">
      Cleanup finished: {result.summary.removedWorktrees} worktree{result.summary.removedWorktrees === 1 ? '' : 's'} removed · {result.summary.deletedBranches} local branch{result.summary.deletedBranches === 1 ? '' : 'es'} deleted · {result.summary.partial} partial · {result.summary.skipped} skipped · {result.summary.failed} failed.
    </div>
  );
}

function AgentRunsPanel() {
  const runs = Object.values(repoOperationsStore.getState().agentRuns);
  if (runs.length === 0) return null;
  return (
    <Panel title="OpenCode preparation runs" subtitle="Runs are durable and read-only until you approve a fresh-SHA squash merge." testId="repo-operations-agent-runs-panel">
      <div className="repo-operations-run-list">
        {runs.map((run) => {
          const approvalReady = run.status === 'awaiting-approval';
          const cancellable = ['queued', 'running', 'awaiting-approval'].includes(run.status);
          return (
            <article className="repo-operations-run-card" data-testid={`repo-operations-run-${run.id}`} key={run.id}>
              <div className="repo-operations-run-card-header">
                <div>
                  <strong>{run.repoLabel || run.repoId} · PR #{run.prNumber}</strong>
                  <div className="repo-operations-secondary-cell">{run.model || 'OpenCode'} · {run.agent || 'repo-operations'}</div>
                </div>
                <Badge tone={approvalReady ? 'accent' : run.status === 'completed' ? 'success' : run.status === 'failed' || run.status === 'blocked' || run.status === 'needs-manual-session' ? 'danger' : 'neutral'}>{run.status}</Badge>
              </div>
              {run.blockerCodes?.length ? <IssueCluster issues={issuesForCodes(run.blockerCodes, { run: run.id })} label={`${run.repoLabel || run.repoId} run blockers`} /> : null}
              {run.proposedOperation ? <p className="repo-operations-run-proposal">Proposed: squash merge PR #{run.prNumber}; approval re-checks the current head SHA.</p> : null}
              {run.evidence ? <details><summary>Evidence</summary><pre>{JSON.stringify(run.evidence, null, 2)}</pre></details> : null}
              {run.error ? <p className="repo-operations-run-error">{run.error}</p> : null}
              <div className="repo-operations-run-actions">
                <Button onClick={() => void repoOperationsStore.refreshAgentRun(run.id)} size="sm" variant="ghost">Refresh run</Button>
                {approvalReady ? <Button onClick={() => void repoOperationsStore.approveAgentRun(run.id)} size="sm" testId={`repo-operations-approve-${run.id}`} variant="primary">Approve squash merge</Button> : null}
                {cancellable ? <Button onClick={() => void repoOperationsStore.cancelAgentRun(run.id)} size="sm" testId={`repo-operations-cancel-${run.id}`} variant="secondary">Cancel run</Button> : null}
                {run.status === 'needs-manual-session' || run.status === 'blocked' ? <span className="repo-operations-muted">Manual session required</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

export default function RepoOperationsView() {
  const state = useStoreValue(repoOperationsStore);
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
  const [prPickerRepo, setPrPickerRepo] = useState<RepoOperationsRepository | null>(null);

  useEffect(() => {
    void repoOperationsStore.loadOverview();
  }, []);

  const filteredRepositories = useMemo(() => {
    const overview = state.overview;
    if (!overview) return [];
    return overview.repositories.filter((repo) => {
      const issueCodes = issueCodesForRepo(repo);
      if (state.filter === 'attention' && issueCodes.length === 0 && repo.sync?.syncEligible !== false && repo.branches.every((branch) => !branch.cleanupEligible)) return false;
      if (state.filter === 'sync-eligible' && !repo.sync?.syncEligible) return false;
      if (state.filter === 'pr-action' && !repo.actionCapabilities?.prAgent?.enabled) return false;
      if (state.filter === 'branches' && repo.branches.length === 0) return false;
      if (state.filter === 'pull-requests' && repo.pullRequests.length === 0) return false;
      return matchesQuery([
        repo.repoLabel,
        repo.repoPath,
        repo.sync?.branch,
        repo.sync?.upstream,
        ...issueCodes,
        ...repo.branches.map((branch) => branch.name),
        ...repo.pullRequests.map((pullRequest) => pullRequest.title),
      ], state.searchQuery);
    });
  }, [state.filter, state.overview, state.searchQuery]);

  const branches = useMemo(() => filteredRepositories.flatMap((repo) => repo.branches.map((branch) => ({
    ...branch,
    repoId: repo.repoId,
    repoLabel: repo.repoLabel,
    repoPath: repo.repoPath,
  }))), [filteredRepositories]);
  const pullRequests = useMemo(() => filteredRepositories.flatMap((repo) => repo.pullRequests.map((pullRequest) => ({
    ...pullRequest,
    repoId: repo.repoId,
    repoLabel: repo.repoLabel,
    repoPath: repo.repoPath,
  }))), [filteredRepositories]);

  if (state.loading && !state.overview) {
    return <div className="view-shell repo-operations-view" data-testid="repo-operations-loading"><PageContainer><div className="state-message"><AppIcon name="refresh" size={20} /><p>Scanning tracked repositories…</p></div></PageContainer></div>;
  }

  if (state.error && !state.overview) {
    return <div className="view-shell repo-operations-view" data-testid="repo-operations-error"><PageContainer><div className="state-message state-message-error"><AppIcon name="error" size={20} /><h1>Repo Operations scan failed</h1><p>{state.error}</p><Button onClick={() => void repoOperationsStore.loadOverview()} variant="secondary">Retry</Button></div></PageContainer></div>;
  }

  const overview = state.overview;
  if (!overview) {
    return <div className="view-shell repo-operations-view" data-testid="repo-operations-empty"><PageContainer><div className="state-message"><p>No repository operations data is available.</p><Button onClick={() => void repoOperationsStore.loadOverview()} variant="secondary">Refresh all</Button></div></PageContainer></div>;
  }

  const syncCapability = overview.capabilities.sync;
  const branchCleanupCapability = overview.capabilities.branchCleanup;
  return (
    <div className="view-shell repo-operations-view" data-testid="repo-operations-view">
      <div className="view-scroll">
        <PageContainer>
          <Toolbar testId="repo-operations-toolbar">
            <div>
              <div className="eyebrow">Global maintenance</div>
              <h1>Repo Operations</h1>
              <p className="repo-operations-lede">Safely sync clean repositories, spot branch hygiene issues, and prepare easy GitHub PR merges one repository at a time.</p>
            </div>
            <div className="repo-operations-toolbar-actions">
              <span className="repo-operations-last-scan">Last scan: {formatScanTime(overview.generatedAt)}</span>
              <Button loading={state.loading} loadingLabel="Refreshing" onClick={() => void repoOperationsStore.loadOverview()} size="sm" testId="repo-operations-refresh" variant="secondary">Refresh all</Button>
            </div>
          </Toolbar>

          <div className="repo-operations-controls">
            <label className="repo-operations-search-label" htmlFor="repo-operations-search">Filter</label>
            <input
              aria-label="Filter repositories and operations"
              id="repo-operations-search"
              onChange={(event) => repoOperationsStore.setSearchQuery(event.target.value)}
              placeholder="Search repositories, branches, issues, or PRs"
              role="searchbox"
              type="search"
              value={state.searchQuery}
            />
            <label htmlFor="repo-operations-filter">Show</label>
            <select
              aria-label="Filter operation type"
              id="repo-operations-filter"
              onChange={(event) => repoOperationsStore.setFilter(event.target.value as RepoOperationsFilter)}
              value={state.filter}
            >
              <option value="all">All operations</option>
              <option value="attention">Needs attention</option>
              <option value="sync-eligible">Sync eligible</option>
              <option value="pr-action">PR action available</option>
              <option value="branches">Branches</option>
              <option value="pull-requests">PRs</option>
            </select>
          </div>

          <section aria-label="Repo Operations summary" className="repo-operations-summary-grid">
            {[
              ['Tracked repos', overview.summary.trackedRepos],
              ['Needs attention', overview.summary.reposNeedingAttention],
              ['Sync issues', overview.summary.syncIssues],
              ['Stale branches', overview.summary.staleBranches],
              ['Open PRs', overview.summary.openPullRequests],
            ].map(([label, value]) => <div className="repo-operations-summary-card" key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}
          </section>

          {overview.warnings.length > 0 ? <div className="repo-operations-warning" role="status"><AppIcon name="warning" size={16} /><div>{overview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}
          {state.error ? <div className="repo-operations-warning" role="alert"><AppIcon name="error" size={16} /><p>Refresh failed: {state.error}. Showing the last successful scan.</p></div> : null}
          {state.actionError ? <div className="repo-operations-warning" role="alert"><AppIcon name="error" size={16} /><p>Action failed: {state.actionError}</p></div> : null}

          <Panel title="Safe actions" subtitle="Sync is fast-forward-only and confirmed per batch. PR handling stays scoped to one repository and one pull request." testId="repo-operations-planned-actions">
            <div className="repo-operations-actions">
              <ActionButton
                capability={syncCapability}
                loading={state.syncing}
                onClick={() => setSyncConfirmOpen(true)}
                testId="repo-operations-action-sync-eligible-repositories"
              />
              <ActionButton
                capability={branchCleanupCapability}
                loading={state.cleaning}
                onClick={() => setCleanupConfirmOpen(true)}
                testId="repo-operations-action-clean-merged-worktrees"
              />
              <span className="repo-operations-action-note">PR preparation is intentionally per repository; conflicts, dirty trees, failed checks, and stale approvals require a manual session.</span>
            </div>
          </Panel>

          {state.syncResult ? <div className="repo-operations-result" role="status">Sync finished: {state.syncResult.summary.synced} synced · {state.syncResult.summary.unchanged} unchanged · {state.syncResult.summary.skipped} skipped · {state.syncResult.summary.failed} failed.</div> : null}
          {state.cleanupResult ? <CleanupResult result={state.cleanupResult} /> : null}

          <AgentRunsPanel />

          <Panel title="Repository sync" subtitle={`${filteredRepositories.length} of ${overview.repositories.length} tracked repositories`} testId="repo-operations-sync-panel">
            <SyncTable onPrepare={setPrPickerRepo} repositories={filteredRepositories} />
          </Panel>

          <Panel title="Local branch hygiene" subtitle="Merged branches remain blocked when active in a worktree or when cleanup safety cannot be established." testId="repo-operations-branches-panel">
            <BranchTable branches={branches} />
          </Panel>

          <Panel title="Open GitHub pull requests" subtitle="Includes remote-only PR branches and the local branch linkage when available." testId="repo-operations-prs-panel">
            <PullRequestTable pullRequests={pullRequests} />
          </Panel>
        </PageContainer>
      </div>
      {syncConfirmOpen ? <SyncConfirmationDialog
        loading={state.syncing}
        onCancel={() => setSyncConfirmOpen(false)}
        onConfirm={() => {
          setSyncConfirmOpen(false);
          void repoOperationsStore.syncEligibleRepositories();
        }}
        repositories={overview.repositories}
      /> : null}
      {cleanupConfirmOpen ? <CleanupConfirmationDialog
        candidates={overview.cleanupCandidates || []}
        loading={state.cleaning}
        onCancel={() => setCleanupConfirmOpen(false)}
        onConfirm={() => {
          setCleanupConfirmOpen(false);
          void repoOperationsStore.cleanupMergedWorktrees((overview.cleanupCandidates || []).filter((candidate) => candidate.eligible));
        }}
      /> : null}
      {prPickerRepo ? <PullRequestPickerDialog
        onCancel={() => setPrPickerRepo(null)}
        onSelect={(pullRequest) => {
          setPrPickerRepo(null);
          if (!prPickerRepo.repoId || !pullRequest.number || !pullRequest.baseRefName || !pullRequest.headSha || !pullRequest.baseSha) return;
          void repoOperationsStore.prepareAgentRun({
            repoId: prPickerRepo.repoId,
            prNumber: pullRequest.number,
            targetBranch: pullRequest.baseRefName,
            observedHeadSha: pullRequest.headSha,
            observedBaseSha: pullRequest.baseSha,
            allowedOperationScope: { inspect: true, checks: true, dryRun: true, merge: false },
          });
        }}
        repo={prPickerRepo}
      /> : null}
    </div>
  );
}
