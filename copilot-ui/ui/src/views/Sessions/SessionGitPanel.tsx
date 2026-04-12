import { useEffect } from 'react';
import { Button } from '../../components';
import { useStoreValue } from '../../lib/store';
import { gitStore } from '../../stores/gitStore';

interface SessionGitPanelProps {
  repoPath: string | null;
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
      {files.map((f, i) => (
        <div key={i} className="git-panel-file-item" data-testid={`git-file-${i}`}>
          <span className="git-panel-file-status">{f.status.trim() || '?'}</span>
          <span className="git-panel-file-path">{f.path}</span>
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
      {commits.map((c, i) => (
        <div key={i} className="git-panel-commit" data-testid={`git-commit-${i}`}>
          <span className="git-panel-commit-hash">{c.hash}</span>
          <span className="git-panel-commit-message">{c.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function SessionGitPanel({ repoPath }: SessionGitPanelProps) {
  const state = useStoreValue(gitStore);

  useEffect(() => {
    if (repoPath) {
      gitStore.loadStatus(repoPath);
    }
    return () => {
      gitStore.reset();
    };
  }, [repoPath]);

  if (!repoPath) {
    return (
      <div className="git-panel" data-testid="git-panel">
        <div className="git-panel-empty">No repository path available for this session.</div>
      </div>
    );
  }

  return (
    <div className="git-panel" data-testid="git-panel">
      <div className="git-panel-header" data-testid="git-panel-header">
        <h3 className="git-panel-title">Git</h3>
        {state.status && (
          <span className="git-panel-branch" data-testid="git-panel-branch">
            ⎇ {state.status.branch}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          testId="git-panel-refresh"
          onClick={() => gitStore.loadStatus(repoPath)}
          disabled={state.loading}
        >
          ↻ Refresh
        </Button>
      </div>

      {state.loading && (
        <div className="git-panel-loading" data-testid="git-panel-loading">Loading git status…</div>
      )}

      {state.error && (
        <div className="git-panel-error" data-testid="git-panel-error">{state.error}</div>
      )}

      {state.status && !state.loading && (
        <>
          <div className="git-panel-section">
            <div className="git-panel-section-header">
              <span className="git-panel-section-title">Changed files ({state.status.files.length})</span>
              <div className="git-panel-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  testId="git-panel-stage-all"
                  onClick={() => gitStore.stageAll()}
                  disabled={state.staging || state.status.clean}
                >
                  Stage all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  testId="git-panel-unstage-all"
                  onClick={() => gitStore.unstageAll()}
                  disabled={state.staging}
                >
                  Unstage all
                </Button>
              </div>
            </div>
            <StatusFileList files={state.status.files} />
          </div>

          <div className="git-panel-section">
            <div className="git-panel-section-header">
              <span className="git-panel-section-title">Diff</span>
              <div className="git-panel-diff-toggle">
                <button
                  type="button"
                  className={`git-panel-diff-tab ${state.diffView === 'unstaged' ? 'git-panel-diff-tab-active' : ''}`}
                  data-testid="git-diff-unstaged-tab"
                  onClick={() => { gitStore.setDiffView('unstaged'); gitStore.loadDiff(); }}
                >
                  Unstaged
                </button>
                <button
                  type="button"
                  className={`git-panel-diff-tab ${state.diffView === 'staged' ? 'git-panel-diff-tab-active' : ''}`}
                  data-testid="git-diff-staged-tab"
                  onClick={() => { gitStore.setDiffView('staged'); gitStore.loadDiff(); }}
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
              onChange={(e) => gitStore.setCommitMessage(e.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              testId="git-panel-commit-button"
              disabled={state.committing || !state.commitMessage.trim()}
              onClick={() => gitStore.commit()}
            >
              {state.committing ? 'Committing…' : 'Commit'}
            </Button>
          </div>
        </>
      )}

      {state.log && state.log.commits.length > 0 && (
        <div className="git-panel-section">
          <div className="git-panel-section-header">
            <span className="git-panel-section-title">Recent commits</span>
          </div>
          <CommitLogList commits={state.log.commits} />
        </div>
      )}
    </div>
  );
}
