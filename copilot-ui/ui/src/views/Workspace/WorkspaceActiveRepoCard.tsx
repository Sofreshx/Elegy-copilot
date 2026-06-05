import { useState, useEffect } from 'react';
import { Button, Panel } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import type { GitSummaryResponse, GitPullRequestResponse } from '../../lib/api/git';
import type { VerificationState } from '../Repositories/verification';
import { getWorkspaceLaunchers, launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';

interface WorkspaceActiveRepoCardProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse['pullRequest'] | null;
  verificationState: VerificationState;
  changeCount: number;
  onSwitchRepo: () => void;
  showRepoSelector: boolean;
}

export default function WorkspaceActiveRepoCard({
  repo,
  repoPath,
  summary,
  pullRequest,
  verificationState,
  changeCount,
  onSwitchRepo,
  showRepoSelector,
}: WorkspaceActiveRepoCardProps) {
  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const [launchers, setLaunchers] = useState<WorkspaceLauncher[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);

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

  async function handleLaunch(launcherId: string) {
    setLaunching(launcherId);
    try {
      const result = await launchWorkspace(launcherId, repoPath);
      if (!result.ok) {
        notificationStore.error('Launch failed', { message: `Failed to open ${launcherId}` });
      }
    } catch (err) {
      notificationStore.error('Launch failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(null);
    }
  }

  const primaryLaunchers = launchers.filter((l) => ['vscode', 'cursor', 'windsurf', 'codium'].includes(l.id));
  const secondaryLaunchers = launchers.filter((l) => ['terminal', 'opencode', 'codex', 'copilot'].includes(l.id));

  return (
    <Panel
      title="Active Repository"
      subtitle={repo?.repoLabel || repoPath}
      testId="workspace-active-card"
      actions={
        <Button
          variant="ghost"
          size="sm"
          testId="workspace-switch-repo"
          onClick={onSwitchRepo}
        >
          {showRepoSelector ? 'Hide repos' : 'Switch repo'}
        </Button>
      }
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
          {hasRemote && pullRequest ? (
            <a
              className="workspace-pr-link"
              href={pullRequest.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              PR #{pullRequest.number}
            </a>
          ) : null}
        </div>
      </div>
      <div className="workspace-launch-actions">
        {primaryLaunchers.map((launcher) => (
          <Button
            key={launcher.id}
            variant="secondary"
            size="sm"
            disabled={!launcher.available || launching === launcher.id}
            onClick={() => void handleLaunch(launcher.id)}
            testId={`workspace-launch-${launcher.id}`}
            title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
          >
            {launching === launcher.id ? 'Opening...' : `Open ${launcher.label}`}
          </Button>
        ))}
        {secondaryLaunchers.map((launcher) => (
          <Button
            key={launcher.id}
            variant="ghost"
            size="sm"
            disabled={!launcher.available || launching === launcher.id}
            onClick={() => void handleLaunch(launcher.id)}
            testId={`workspace-launch-${launcher.id}`}
            title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
          >
            {launching === launcher.id ? 'Starting...' : launcher.label}
          </Button>
        ))}
      </div>
    </Panel>
  );
}
