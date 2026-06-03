import { useEffect } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { gitStore } from '../../stores/gitStore';
import { formatSignedCount } from './gitUi';

interface RepositoryGitPanelProps {
  repoPath: string | null;
  mode?: 'project' | 'session';
}

function StatusFileList({ files }: { files: Array<{ status: string; path: string }> }) {
  if (files.length === 0) {
    return (
      <div className="git-panel-clean" data-testid="git-panel-clean">
        Working tree clean
      </div>
    );
  }

  return (
    <div className="git-panel-file-list" data-testid="git-panel-file-list">
      {files.map((file, index) => (
        <div key={`${file.path}-${index}`} className="git-panel-file-item" data-testid={`git-file-${index}`}>
          <span className="git-panel-file-status">{file.status.trim() || '?'}</span>
          <span className="git-panel-file-path">{file.path}</span>
        </div>
      ))}
    </div>
  );
}

function CommitLogList({ commits }: { commits: Array<{ hash: string; message: string }> }) {
  if (commits.length === 0) {
    return <div className="git-panel-no-commits">No recent commits</div>;
  }

  return (
    <div className="git-panel-log" data-testid="git-panel-log">
      {commits.map((commit, index) => (
        <div key={`${commit.hash}-${index}`} className="git-panel-commit" data-testid={`git-commit-${index}`}>
          <span className="git-panel-commit-hash">{commit.hash}</span>
          <span className="git-panel-commit-message">{commit.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function RepositoryGitPanel({ repoPath, mode = 'project' }: RepositoryGitPanelProps) {
  const state = useStoreValue(gitStore);

  useEffect(() => {
    if (repoPath) {
      void gitStore.loadStatus(repoPath);
    }
    return () => {
      gitStore.reset();
    };
  }, [repoPath]);

  if (!repoPath) {
    return (
      <div className="git-panel" data-testid={`${mode}-git-panel`}>
        <div className="git-panel-empty">No repository path available.</div>
      </div>
    );
  }

  const status = state.status;
  const summary = state.summary;
  const pullRequest = state.pullRequest?.pullRequest;
  const hasChanges = Boolean(status && status.files.length > 0);

  function handleOpenPullRequest() {
    if (!pullRequest?.url) {
      return;
    }

    window.open(pullRequest.url, '_blank', 'noopener,noreferrer');
  }

  async function handleCreatePullRequest() {
    await gitStore.createPullRequest();
    const nextPullRequest = gitStore.getState().pullRequest?.pullRequest;
    if (nextPullRequest?.url) {
      notificationStore.success('Pull request created', { message: nextPullRequest.url });
    }
  }

  return (
    <div className="git-panel" data-testid={`${mode}-git-panel`}>
      <Panel
        title="Git"
        subtitle={summary?.remoteLabel || 'Repository status and GitHub actions'}
        testId="git-panel-shell"
        actions={(
          <>
            {status?.branch ? (
              <span className="git-panel-branch" data-testid="git-panel-branch">
                {status.branch}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              testId="git-panel-refresh"
              onClick={() => void gitStore.loadStatus(repoPath)}
              disabled={state.loading}
            >
              {state.loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </>
        )}
      >
        {state.error ? (
          <div className="git-panel-error" data-testid="git-panel-error">{state.error}</div>
        ) : null}

        {/* Check results warning */}
        {state.checkFailed && state.checkResults && (
          <div className="git-panel-warning">
            <div className="git-panel-warning-header">
              ⚠️ Pre-action checks failed ({state.checkResults.checksFailed} of {state.checkResults.checksRun})
            </div>
            <ul className="git-panel-check-list">
              {state.checkResults.results.filter(r => !r.passed).map((r, i) => (
                <li key={i}>
                  <strong>{r.checkName}</strong>: {r.error || 'Check failed'}
                  {r.output && <pre className="git-check-output">{r.output.slice(0, 500)}</pre>}
                </li>
              ))}
            </ul>
            {state.showOverrideInput && (
              <div className="git-override-section">
                <label>
                  Override reason (required for unsafe action):
                  <input
                    type="text"
                    className="git-override-input"
                    value={state.unsafeOverrideReason}
                    onChange={(e) => gitStore.setUnsafeOverrideReason(e.target.value)}
                    placeholder="e.g., Hotfix for production issue PROD-123"
                  />
                </label>
                <div className="git-override-warning">
                  ⚠️ Proceeding with failed checks. This action will be recorded.
                </div>
              </div>
            )}
            <div className="git-panel-warning-actions">
              <button onClick={() => gitStore.clearCheckState()}>Cancel</button>
            </div>
          </div>
        )}

        <div className="git-summary-grid" data-testid="git-summary-grid">
          <div className="git-summary-card">
            <span className="git-summary-label">Changes</span>
            <span className="git-summary-value">{summary ? (summary.clean ? 'Clean' : `${summary.changedFiles} files`) : '—'}</span>
            {summary && !summary.clean ? (
              <span className="git-summary-meta">
                <span className="git-summary-additions">{formatSignedCount(summary.additions)}</span>
                <span className="git-summary-deletions">{formatSignedCount(-summary.deletions)}</span>
              </span>
            ) : null}
          </div>
          <div className="git-summary-card">
            <span className="git-summary-label">Local</span>
            <span className="git-summary-value">{summary?.branch || 'Detached'}</span>
            <span className="git-summary-meta">ahead {summary?.ahead ?? 0} / behind {summary?.behind ?? 0}</span>
          </div>
          <div className="git-summary-card">
            <span className="git-summary-label">Remote</span>
            <span className="git-summary-value">{summary?.remoteLabel || 'No remote'}</span>
            <span className="git-summary-meta">{status?.upstream || 'Untracked branch'}</span>
          </div>
          <div className="git-summary-card">
            <span className="git-summary-label">Pull Request</span>
            <span className="git-summary-value">{pullRequest ? `#${pullRequest.number}` : 'None'}</span>
            <span className="git-summary-meta">{pullRequest?.state || 'Create from current branch'}</span>
          </div>
        </div>

        <div className="git-panel-inline-actions" data-testid="git-panel-inline-actions">
          <Button
            variant="ghost"
            size="sm"
            testId="git-panel-pull"
            onClick={() => void gitStore.pull()}
            disabled={state.syncing || !summary?.hasRemote}
          >
            {state.syncing ? 'Syncing…' : 'Pull'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="git-panel-push"
            onClick={() => void gitStore.push()}
            disabled={state.syncing || !summary?.branch || (state.checkFailed && !state.unsafeOverrideReason.trim())}
          >
            {state.syncing ? 'Syncing…' : 'Push'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="git-panel-open-pr"
            onClick={handleOpenPullRequest}
            disabled={!pullRequest?.url}
          >
            View PR
          </Button>
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Branch</span>
          </div>
          <div className="git-branch-controls">
            <select
              className="git-panel-branch-select"
              data-testid="git-panel-branch-select"
              value={state.selectedBranch}
              onChange={(event) => gitStore.setSelectedBranch(event.target.value)}
              disabled={state.switchingBranch || !state.branches?.branches.length}
            >
              <option value="">Select branch…</option>
              {state.branches?.branches.filter((branch) => !branch.remote).map((branch) => (
                <option key={branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              testId="git-panel-switch-branch"
              onClick={() => void gitStore.switchBranch()}
              disabled={state.switchingBranch || !state.selectedBranch}
            >
              Switch
            </Button>
          </div>
          <div className="git-branch-controls">
            <input
              className="git-panel-branch-input"
              data-testid="git-panel-new-branch-input"
              type="text"
              placeholder="feature/new-branch"
              value={state.newBranchName}
              onChange={(event) => gitStore.setNewBranchName(event.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              testId="git-panel-create-branch"
              onClick={() => void gitStore.switchBranch({ create: true })}
              disabled={state.switchingBranch || !state.newBranchName.trim()}
            >
              Create branch
            </Button>
          </div>
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Changed files ({status?.files.length ?? 0})</span>
            <div className="git-panel-actions">
              <Button
                variant="ghost"
                size="sm"
                testId="git-panel-stage-all"
                onClick={() => void gitStore.stageAll()}
                disabled={state.staging || !hasChanges}
              >
                Stage all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                testId="git-panel-unstage-all"
                onClick={() => void gitStore.unstageAll()}
                disabled={state.staging || (status?.stagedCount ?? 0) === 0}
              >
                Unstage all
              </Button>
            </div>
          </div>
          <StatusFileList files={status?.files ?? []} />
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Diff</span>
            <div className="git-panel-diff-toggle">
              <button
                type="button"
                className={`git-panel-diff-tab ${state.diffView === 'unstaged' ? 'git-panel-diff-tab-active' : ''}`}
                data-testid="git-diff-unstaged-tab"
                onClick={() => {
                  gitStore.setDiffView('unstaged');
                  void gitStore.loadDiff();
                }}
              >
                Unstaged
              </button>
              <button
                type="button"
                className={`git-panel-diff-tab ${state.diffView === 'staged' ? 'git-panel-diff-tab-active' : ''}`}
                data-testid="git-diff-staged-tab"
                onClick={() => {
                  gitStore.setDiffView('staged');
                  void gitStore.loadDiff();
                }}
              >
                Staged
              </button>
            </div>
          </div>
          {state.diff ? (
            <pre className="git-panel-diff-content" data-testid="git-panel-diff-content">
              {state.diff.diff || '(no changes)'}
            </pre>
          ) : (
            <div className="git-panel-diff-hint" data-testid="git-panel-diff-hint">
              Click Unstaged or Staged to view diff
            </div>
          )}
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Commit</span>
          </div>
          <textarea
            className="git-panel-commit-input"
            data-testid="git-panel-commit-input"
            placeholder="Commit message…"
            rows={3}
            value={state.commitMessage}
            onChange={(event) => gitStore.setCommitMessage(event.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            testId="git-panel-commit-button"
            disabled={state.committing || !state.commitMessage.trim() || (state.checkFailed && !state.unsafeOverrideReason.trim())}
            onClick={() => void gitStore.commit()}
          >
            {state.committing ? 'Committing…' : 'Commit changes'}
          </Button>
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Pull Request</span>
            {pullRequest ? <Badge tone="brand">#{pullRequest.number}</Badge> : null}
          </div>
          {pullRequest ? (
            <div className="git-panel-pr-summary" data-testid="git-panel-pr-summary">
              <span>{`#${pullRequest.number} ${pullRequest.state}`}</span>
              <Button
                variant="secondary"
                size="sm"
                testId="git-panel-pr-open"
                onClick={handleOpenPullRequest}
              >
                Open in browser
              </Button>
            </div>
          ) : (
            <>
              <input
                className="git-panel-branch-input"
                data-testid="git-panel-pr-title"
                type="text"
                placeholder="PR title (optional)"
                value={state.pullRequestTitle}
                onChange={(event) => gitStore.setPullRequestTitle(event.target.value)}
              />
              <textarea
                className="git-panel-commit-input"
                data-testid="git-panel-pr-body"
                placeholder="PR body (optional)"
                rows={4}
                value={state.pullRequestBody}
                onChange={(event) => gitStore.setPullRequestBody(event.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                testId="git-panel-create-pr"
                onClick={() => void handleCreatePullRequest()}
                disabled={state.creatingPullRequest || !summary?.hasRemote}
              >
                {state.creatingPullRequest ? 'Creating…' : 'Create pull request'}
              </Button>
            </>
          )}
        </div>

        {state.log && state.log.commits.length > 0 ? (
          <div className="git-panel-section">
            <div className="git-panel-section-header">
              <span className="git-panel-section-title">Recent commits</span>
            </div>
            <CommitLogList commits={state.log.commits} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
