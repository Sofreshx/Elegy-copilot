import { useState, useEffect, useRef } from 'react';
import { Button, Panel } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import type { GitSummaryResponse, GitPullRequestResponse, GitLogResponse, GitCheckResults } from '../../lib/api/git';
import type { VerificationState } from '../Repositories/verification';
import { getWorkspaceLaunchers, launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';
import BrandIcon from '../../components/BrandIcon';
import { resolveLauncherIconPath } from '../../lib/launcherIcons';

interface WorkspaceActiveRepoCardProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse['pullRequest'] | null;
  verificationState: VerificationState;
  changeCount: number;
  onSwitchRepo: () => void;
  showRepoSelector: boolean;
  checkResults: GitCheckResults | null;
  runningChecks: boolean;
  commitMessage: string;
  committing: boolean;
  syncing: boolean;
  creatingPullRequest: boolean;
  pullRequestTitle: string;
  pullRequestBody: string;
  log: GitLogResponse | null;
  onRunChecks: () => void;
  onCommit: () => void;
  onPush: () => void;
  onOpenPR: () => void;
  onCreatePR: () => void;
  onSetCommitMessage: (msg: string) => void;
  onSetPullRequestTitle: (title: string) => void;
  onSetPullRequestBody: (body: string) => void;
}

const GROUP_ORDER = ['ides', 'agents', 'terminals'] as const;
const GROUP_LABELS: Record<string, string> = {
  ides: 'IDEs',
  agents: 'Agent CLIs',
  terminals: 'Terminals',
};

const LAUNCHER_ICONS: Record<string, string> = {
  ides: '\u25C8',   // ◈ (window/editor)
  agents: '\u26A1', // ⚡ (agent/automation)
  terminals: '\u003E\u005F', // >_ (terminal prompt)
};

export default function WorkspaceActiveRepoCard({
  repo,
  repoPath,
  summary,
  pullRequest,
  verificationState,
  changeCount,
  onSwitchRepo,
  showRepoSelector,
  checkResults,
  runningChecks,
  commitMessage,
  committing,
  syncing,
  creatingPullRequest,
  pullRequestTitle,
  pullRequestBody,
  log,
  onRunChecks,
  onCommit,
  onPush,
  onOpenPR,
  onCreatePR,
  onSetCommitMessage,
  onSetPullRequestTitle,
  onSetPullRequestBody,
}: WorkspaceActiveRepoCardProps) {
  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const [launchers, setLaunchers] = useState<WorkspaceLauncher[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedCommit, setExpandedCommit] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const LAST_WORKSPACE_LAUNCHER_KEY = 'elegy-copilot-last-workspace-launcher';

  const [lastLauncherId, setLastLauncherId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_WORKSPACE_LAUNCHER_KEY); }
    catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getWorkspaceLaunchers();
        if (!cancelled) setLaunchers(data.launchers);
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleLaunch(launcherId: string) {
    setLaunching(launcherId);
    setMenuOpen(false);
    try {
      const result = await launchWorkspace(launcherId, repoPath);
      if (!result.ok) {
        notificationStore.error('Launch failed', { message: `Failed to open ${launcherId}` });
      } else {
        setLastLauncherId(launcherId);
        try { localStorage.setItem(LAST_WORKSPACE_LAUNCHER_KEY, launcherId); } catch {}
      }
    } catch (err) {
      notificationStore.error('Launch failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(null);
    }
  }

  const grouped = new Map<string, WorkspaceLauncher[]>();
  for (const l of launchers) {
    const group = l.group || 'unknown';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(l);
  }

  const availableLaunchers = launchers.filter((l) => l.available);

  function resolveTriggerIcon(): string {
    if (lastLauncherId) {
      const match = launchers.find(l => l.id === lastLauncherId);
      if (match) return LAUNCHER_ICONS[match.group] || LAUNCHER_ICONS.ides;
    }
    const first = launchers.find(l => l.available);
    if (first) return LAUNCHER_ICONS[first.group] || LAUNCHER_ICONS.ides;
    const firstAny = launchers[0];
    if (firstAny) return LAUNCHER_ICONS[firstAny.group] || LAUNCHER_ICONS.ides;
    return '>_';
  }

  const triggerIcon = resolveTriggerIcon();

  return (
    <Panel
      title="Git"
      subtitle={repo?.repoLabel || repoPath}
      testId="workspace-active-card"
    >
      <div className="workspace-active-info">
        <div className="workspace-active-path">{repoPath}</div>
        <div className="workspace-active-meta">
          {branch ? (
            <span className="workspace-active-branch" data-testid="workspace-branch">
              {branch}
            </span>
          ) : null}
          <span className={`workspace-verification workspace-verification-${verificationState}`} data-testid="workspace-verification">
            {verificationState === 'verified' ? 'Verified' : verificationState === 'stale' ? 'Stale' : verificationState === 'failed' ? 'Failed' : 'Unverified'}
          </span>
          {changeCount > 0 ? (
            <span className="workspace-change-count" data-testid="workspace-changes">
              {changeCount} change{changeCount !== 1 ? 's' : ''}
            </span>
          ) : null}
          {(summary?.ahead ?? 0) > 0 ? <span className="workspace-ahead">+{summary?.ahead} ahead</span> : null}
          {(summary?.behind ?? 0) > 0 ? <span className="workspace-behind">-{summary?.behind} behind</span> : null}
          {summary?.remoteLabel ? <span className="workspace-remote-label">{summary.remoteLabel}</span> : null}
          {summary?.remoteUrl ? (
            <a className="workspace-repo-link" href={summary.remoteUrl} target="_blank" rel="noopener noreferrer" data-testid="workspace-repo-link">
              Repo
            </a>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitchRepo}
            testId="workspace-switch-repo"
          >
            Switch repo
          </Button>
        </div>
      </div>
      <div className="workspace-launch-actions" ref={menuRef}>
        <button
          className="workspace-launch-trigger"
          type="button"
          data-testid="workspace-launch-trigger"
          aria-label="Open in"
          title="Open in"
          disabled={availableLaunchers.length === 0}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="workspace-launch-trigger-icon">{triggerIcon}</span>
          <span className="workspace-launch-trigger-chevron">&#9660;</span>
        </button>
        {menuOpen && (
          <div className="workspace-launch-menu" data-testid="workspace-launch-menu">
            {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
              <div key={group} className="workspace-launch-menu-group">
                <div className="workspace-launch-menu-group-label">{GROUP_LABELS[group] || group}</div>
                {grouped.get(group)!.map((launcher) => (
                  <button
                    key={launcher.id}
                    className="workspace-launch-menu-item"
                    type="button"
                    disabled={!launcher.available || launching === launcher.id}
                    onClick={() => void handleLaunch(launcher.id)}
                    data-testid={`workspace-launch-${launcher.id}`}
                    title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
                  >
                    <BrandIcon src={resolveLauncherIconPath(launcher.id)} size={15} className="workspace-launch-menu-item-icon" />
                    <span className="workspace-launch-menu-item-label">
                      {launching === launcher.id ? 'Opening...' : launcher.label}
                    </span>
                    {launcher.argsPreview ? (
                      <span className="workspace-launch-menu-item-args">{launcher.argsPreview}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="workspace-git-actions" data-testid="workspace-git-actions">
        <Button
          variant="secondary"
          size="sm"
          disabled={runningChecks}
          onClick={onRunChecks}
          testId="workspace-run-checks"
        >
          {runningChecks ? 'Running...' : 'Run checks'}
        </Button>
        <input
          className="form-input-field"
          type="text"
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => onSetCommitMessage(e.target.value)}
          disabled={committing}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={!commitMessage?.trim() || committing}
          onClick={onCommit}
          testId="workspace-commit"
        >
          {committing ? 'Committing...' : 'Commit'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasRemote || syncing}
          onClick={onPush}
          testId="workspace-push"
        >
          {syncing ? 'Pushing...' : 'Push'}
        </Button>
      </div>
      {checkResults ? (
        <div className={`workspace-checks-result ${checkResults.allPassed ? 'workspace-checks-passed' : 'workspace-checks-failed'}`} data-testid="workspace-checks-result">
          {checkResults.allPassed ? 'All checks passed' : 'Some checks failed'}
        </div>
      ) : null}
      {verificationState !== 'verified' && changeCount > 0 ? (
        <div className="workspace-commit-warning" data-testid="workspace-commit-warning">
          Checks are not verified. Run checks before pushing.
        </div>
      ) : null}
      {hasRemote ? (
        pullRequest ? (
          <div className="workspace-pr-existing">
            <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" className="workspace-git-pr-link">
              PR #{pullRequest.number} ({pullRequest.state})
            </a>
            <Button variant="ghost" size="sm" onClick={onOpenPR} testId="workspace-open-pr">
              Open PR
            </Button>
          </div>
        ) : (
          <div className="workspace-pr-create" data-testid="workspace-pr-create">
            <input
              className="form-input-field"
              type="text"
              placeholder="PR title..."
              value={pullRequestTitle}
              onChange={(e) => onSetPullRequestTitle(e.target.value)}
              disabled={creatingPullRequest}
            />
            <input
              className="form-input-field"
              type="text"
              placeholder="PR body (optional)..."
              value={pullRequestBody}
              onChange={(e) => onSetPullRequestBody(e.target.value)}
              disabled={creatingPullRequest}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!pullRequestTitle.trim() || creatingPullRequest}
              onClick={onCreatePR}
              testId="workspace-create-pr"
            >
              {creatingPullRequest ? 'Creating...' : 'Create pull request'}
            </Button>
          </div>
        )
      ) : null}
      {log && log.commits.length > 0 ? (
        <div className="workspace-commit-log" data-testid="workspace-commit-log">
          {log.commits.slice(0, 5).map((commit, index) => (
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
        <div className="state-message">No commits found.</div>
      )}
    </Panel>
  );
}
