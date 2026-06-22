import { useEffect } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { gitStore } from '../../stores/gitStore';
import { formatSignedCount } from '../Project/gitUi';

interface RepoGitPanelProps {
  repoPath: string | null;
}

function StatusFileList({ files }: { files: Array<{ status: string; path: string }> }) {
  if (files.length === 0) {
    return (
      <div className="git-panel-clean" data-testid="repo-git-clean">
        Working tree clean
      </div>
    );
  }

  return (
    <div className="git-panel-file-list" data-testid="repo-git-file-list">
      {files.map((file, index) => (
        <div key={`${file.path}-${index}`} className="git-panel-file-item" data-testid={`repo-git-file-${index}`}>
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
    <div className="git-panel-log" data-testid="repo-git-log">
      {commits.map((commit, index) => (
        <div key={`${commit.hash}-${index}`} className="git-panel-commit" data-testid={`repo-git-commit-${index}`}>
          <span className="git-panel-commit-hash">{commit.hash}</span>
          <span className="git-panel-commit-message">{commit.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function RepoGitPanel({ repoPath }: RepoGitPanelProps) {
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
      <div className="git-panel" data-testid="repo-git-panel">
        <div className="git-panel-empty">Select a repository to view Git operations.</div>
      </div>
    );
  }

  const status = state.status;
  const summary = state.summary;
  const pullRequest = state.pullRequest?.pullRequest;
  const hasChanges = Boolean(status && status.files.length > 0);

  function handleOpenPullRequest() {
    if (!pullRequest?.url) return;
    window.open(pullRequest.url, '_blank', 'noopener,noreferrer');
  }

  async function handleCreatePullRequest() {
    await gitStore.createPullRequest();
    const nextPR = gitStore.getState().pullRequest?.pullRequest;
    if (nextPR?.url) {
      notificationStore.success('Pull request created', { message: nextPR.url });
    }
  }

  return (
    <div className="git-panel" data-testid="repo-git-panel">
      <Panel
        title="Git Operations"
        subtitle={summary?.remoteLabel || 'Repository status and actions'}
        testId="repo-git-panel-shell"
        actions={(
          <>
            {status?.branch ? (
              <span className="git-panel-branch" data-testid="repo-git-branch">
                {status.branch}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              testId="repo-git-refresh"
              onClick={() => void gitStore.loadStatus(repoPath)}
              disabled={state.loading}
            >
              {state.loading ? 'Refreshing\u2026' : 'Refresh'}
            </Button>
          </>
        )}
      >
        {state.error ? (
          <div className="git-panel-error" data-testid="repo-git-error">{state.error}</div>
        ) : null}

        {state.checkFailed && state.checkResults ? (
          <div className="git-panel-warning">
            <div className="git-panel-warning-header">
              {'\u26A0\uFE0F'} Pre-action checks failed ({state.checkResults.checksFailed} of {state.checkResults.checksRun})
            </div>
            <ul className="git-panel-check-list">
              {state.checkResults.results.filter((r) => !r.passed).map((r, i) => (
                <li key={i}>
                  <strong>{r.checkName}</strong>: {r.error || 'Check failed'}
                  {r.output && <pre className="git-check-output">{r.output.slice(0, 500)}</pre>}
                </li>
              ))}
            </ul>
            {state.showOverrideInput ? (
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
                  {'\u26A0\uFE0F'} Proceeding with failed checks. This action will be recorded.
                </div>
              </div>
            ) : null}
            <div className="git-panel-warning-actions">
              <button onClick={() => gitStore.clearCheckState()}>Cancel</button>
            </div>
          </div>
        ) : null}

        <div className="git-summary-grid" data-testid="repo-git-summary-grid">
          <div className="git-summary-card">
            <span className="git-summary-label">Changes</span>
            <span className="git-summary-value">{summary ? (summary.clean ? 'Clean' : `${summary.changedFiles} files`) : '\u2014'}</span>
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

        <div className="git-panel-inline-actions" data-testid="repo-git-inline-actions">
          <Button
            variant="ghost"
            size="sm"
            testId="repo-git-pull"
            onClick={() => void gitStore.pull()}
            disabled={state.syncing || !summary?.hasRemote}
          >
            {state.syncing ? 'Syncing\u2026' : 'Pull'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="repo-git-push"
            onClick={() => void gitStore.push()}
            disabled={state.syncing || !summary?.branch || (state.checkFailed && !state.unsafeOverrideReason.trim())}
          >
            {state.syncing ? 'Syncing\u2026' : 'Push'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="repo-git-open-pr"
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
              data-testid="repo-git-branch-select"
              value={state.selectedBranch}
              onChange={(event) => gitStore.setSelectedBranch(event.target.value)}
              disabled={state.switchingBranch || !state.branches?.branches.length}
            >
              <option value="">Select branch\u2026</option>
              {(state.branches?.branches ?? []).filter((branch) => !branch.remote).map((branch) => (
                <option key={branch.name} value={branch.name}>{branch.name}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              size="sm"
              testId="repo-git-switch-branch"
              onClick={() => void gitStore.switchBranch()}
              disabled={state.switchingBranch || !state.selectedBranch}
            >
              Switch
            </Button>
          </div>
          <div className="git-branch-controls">
            <input
              className="git-panel-branch-input"
              data-testid="repo-git-new-branch-input"
              type="text"
              placeholder="feature/new-branch"
              value={state.newBranchName}
              onChange={(event) => gitStore.setNewBranchName(event.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              testId="repo-git-create-branch"
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
                testId="repo-git-stage-all"
                onClick={() => void gitStore.stageAll()}
                disabled={state.staging || !hasChanges}
              >
                Stage all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                testId="repo-git-unstage-all"
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
                data-testid="repo-git-diff-unstaged-tab"
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
                data-testid="repo-git-diff-staged-tab"
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
            <pre className="git-panel-diff-content" data-testid="repo-git-diff-content">
              {state.diff.diff || '(no changes)'}
            </pre>
          ) : (
            <div className="git-panel-diff-hint" data-testid="repo-git-diff-hint">
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
            data-testid="repo-git-commit-input"
            placeholder="Commit message\u2026"
            rows={3}
            value={state.commitMessage}
            onChange={(event) => gitStore.setCommitMessage(event.target.value)}
          />
          <Button
            variant="primary"
            size="sm"
            testId="repo-git-commit-button"
            disabled={state.committing || !state.commitMessage.trim() || (state.checkFailed && !state.unsafeOverrideReason.trim())}
            onClick={() => void gitStore.commit()}
          >
            {state.committing ? 'Committing\u2026' : 'Commit changes'}
          </Button>
        </div>

        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Pull Request</span>
            {pullRequest ? <Badge tone="brand">#{pullRequest.number}</Badge> : null}
          </div>
          {pullRequest ? (
            <div className="git-panel-pr-summary" data-testid="repo-git-pr-summary">
              <span>{`#${pullRequest.number} ${pullRequest.state}`}</span>
              <Button
                variant="secondary"
                size="sm"
                testId="repo-git-pr-open"
                onClick={handleOpenPullRequest}
              >
                Open in browser
              </Button>
            </div>
          ) : (
            <>
              <input
                className="git-panel-branch-input"
                data-testid="repo-git-pr-title"
                type="text"
                placeholder="PR title (optional)"
                value={state.pullRequestTitle}
                onChange={(event) => gitStore.setPullRequestTitle(event.target.value)}
              />
              <textarea
                className="git-panel-commit-input"
                data-testid="repo-git-pr-body"
                placeholder="PR body (optional)"
                rows={4}
                value={state.pullRequestBody}
                onChange={(event) => gitStore.setPullRequestBody(event.target.value)}
              />
              <Button
                variant="secondary"
                size="sm"
                testId="repo-git-create-pr"
                onClick={() => void handleCreatePullRequest()}
                disabled={state.creatingPullRequest || !summary?.hasRemote}
              >
                {state.creatingPullRequest ? 'Creating\u2026' : 'Create pull request'}
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
