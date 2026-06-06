import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from '../Repositories/repositoriesStore';
import { gitStore } from '../../stores/gitStore';
import { discoverGitChecks, runGitChecks } from '../../lib/api/git';
import { listRepoDocs } from '../../lib/api/repoDocs';
import type { GitCheckResults } from '../../lib/api/git';
import type { RepoDocEntry } from '../../lib/api/repoDocs';
import RepoSelectorPanel from '../Repositories/RepoSelectorPanel';
import SourcesConfigPanel from '../Repositories/SourcesConfigPanel';
import GitHubAuthBanner from '../Repositories/GitHubAuthBanner';
import { computeVerificationState, type VerificationState } from '../Repositories/verification';
import WorkspaceActiveRepoCard from './WorkspaceActiveRepoCard';
import WorkspaceDocsCenter from './WorkspaceDocsCenter';
import WorkspaceRightRail from './WorkspaceRightRail';
import SessionDetailView from '../Sessions/SessionDetailView';
import DocumentationGraphView from './DocumentationGraphView';

export default function WorkspaceView() {
  const state = useStoreValue(repositoriesStore);
  const gitState = useStoreValue(gitStore);
  const navState = useStoreValue(navigationStore);
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('missing');
  const [checkResults, setCheckResults] = useState<GitCheckResults | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const lastCheckRef = useRef<{ branch: string | null; head: string | null; changeCount: number } | null>(null);

  const [workspaceFiles, setWorkspaceFiles] = useState<RepoDocEntry[]>([]);
  const [graphSelectedDocPath, setGraphSelectedDocPath] = useState<string | null>(null);

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => {
      repositoriesStore.reset();
    };
  }, []);

  const selectedRepoPath = navState.activeWorkspaceId || null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedRepoPath) {
        if (!cancelled) setWorkspaceFiles([]);
        return;
      }
      try {
        const data = await listRepoDocs(selectedRepoPath);
        if (!cancelled) setWorkspaceFiles(data.files);
      } catch {
        if (!cancelled) setWorkspaceFiles([]);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [selectedRepoPath]);

  // When the workspace tab is the source of truth (focusWorkspace sets
  // activeWorkspaceId but does not touch repositoriesStore), resolve the
  // display repo from the inventory so the label, repoId, and planning
  // context stay consistent with the path-driven data.
  const displayRepo = selectedRepoPath
    ? (state.repos.find(
        (r) => (r.repoPath || '').replace(/\\/g, '/').toLowerCase()
               === selectedRepoPath.replace(/\\/g, '/').toLowerCase(),
      ) || null)
    : null;

  useEffect(() => {
    if (selectedRepoPath) {
      void gitStore.loadStatus(selectedRepoPath);
    }
  }, [selectedRepoPath]);

  const updateVerification = useCallback(() => {
    const hasRun = lastCheckRef.current !== null;
    const result = computeVerificationState({
      hasCheckRun: hasRun,
      checkPassed: hasRun ? (checkResults?.allPassed ?? false) : false,
      branch: gitState.summary?.branch ?? null,
      headAtRun: lastCheckRef.current?.head ?? null,
      currentHead: null,
      changeCountAtRun: lastCheckRef.current?.changeCount ?? 0,
      currentChangeCount: gitState.summary?.changedFiles ?? 0,
      ciStatus: 'unavailable',
    });
    setVerificationState(result);
  }, [checkResults, gitState.summary]);

  useEffect(() => {
    updateVerification();
  }, [updateVerification]);

  async function handleRunChecks() {
    if (!selectedRepoPath) return;
    setRunningChecks(true);
    try {
      const results = await runGitChecks(selectedRepoPath);
      setCheckResults(results);
      lastCheckRef.current = {
        branch: gitState.summary?.branch ?? null,
        head: null,
        changeCount: gitState.summary?.changedFiles ?? 0,
      };
    } catch (err) {
      notificationStore.error('Check run failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunningChecks(false);
    }
  }

  function handleOpenPR() {
    const pr = gitState.pullRequest?.pullRequest;
    if (pr?.url) {
      window.open(pr.url, '_blank', 'noopener,noreferrer');
    }
  }

  function handleGraphSelectDoc(path: string) {
    setGraphSelectedDocPath(path);
    navigationStore.closeDocsGraph();
  }

  const centerMode = navState.workspaceCenterMode;

  return (
    <div className="workspace-view" data-testid="workspace-view">
      <Toolbar testId="workspace-toolbar">
        <h2>Workspace</h2>
        <span className="state-copy">
          {displayRepo
            ? displayRepo.repoLabel || displayRepo.repoPath || ''
            : 'Select a repository to begin'}
        </span>
      </Toolbar>

      <div className="workspace-toolbar-actions" data-testid="workspace-toolbar-actions">
        {selectedRepoPath && (
          <>
            {(centerMode === 'docs' || centerMode === 'docs-graph') && (
              <button
                className="workspace-graph-toggle"
                data-testid="workspace-graph-toggle"
                onClick={() =>
                  centerMode === 'docs-graph'
                    ? navigationStore.closeDocsGraph()
                    : navigationStore.openDocsGraph()
                }
                type="button"
                title={centerMode === 'docs-graph' ? 'Show docs list' : 'Show docs graph'}
              >
                {centerMode === 'docs-graph' ? '◉ Docs' : '◉ Graph'}
              </button>
            )}
            <button
              className="workspace-focus-toggle"
              data-testid="workspace-focus-toggle"
              onClick={() => navigationStore.toggleWorkspaceCenterFocus()}
              type="button"
              title={navState.isWorkspaceCenterFocused ? 'Exit focus mode' : 'Enter focus mode'}
            >
              {navState.isWorkspaceCenterFocused ? '□ Unfocus' : '⛶ Focus'}
            </button>
          </>
        )}
      </div>

      {selectedRepoPath ? (
        <div className="workspace-layout">
          <div className="workspace-active-bar" data-testid="workspace-active-bar">
            <WorkspaceActiveRepoCard
              repo={displayRepo}
              repoPath={selectedRepoPath}
              summary={gitState.summary}
              pullRequest={gitState.pullRequest?.pullRequest ?? null}
              verificationState={verificationState}
              changeCount={gitState.summary?.changedFiles ?? 0}
              onSwitchRepo={() => setShowRepoSelector(!showRepoSelector)}
              showRepoSelector={showRepoSelector}
              checkResults={checkResults || gitState.checkResults}
              runningChecks={runningChecks}
              commitMessage={gitState.commitMessage}
              committing={gitState.committing}
              syncing={gitState.syncing}
              creatingPullRequest={gitState.creatingPullRequest}
              pullRequestTitle={gitState.pullRequestTitle}
              pullRequestBody={gitState.pullRequestBody}
              log={gitState.log}
              onRunChecks={handleRunChecks}
              onCommit={() => void gitStore.commit()}
              onPush={() => void gitStore.push()}
              onOpenPR={handleOpenPR}
              onCreatePR={() => void gitStore.createPullRequest()}
              onSetCommitMessage={(msg: string) => gitStore.setCommitMessage(msg)}
              onSetPullRequestTitle={(title: string) => gitStore.setPullRequestTitle(title)}
              onSetPullRequestBody={(body: string) => gitStore.setPullRequestBody(body)}
            />
          </div>

          {showRepoSelector ? (
            <div className="workspace-repo-selector" data-testid="workspace-repo-selector">
              <SourcesConfigPanel />
              <RepoSelectorPanel />
            </div>
          ) : null}

          <GitHubAuthBanner repoPath={selectedRepoPath} />

          <div className={`workspace-main-layout${navState.isWorkspaceCenterFocused ? ' workspace-main-layout-focused' : ''}`}>
            <div className="workspace-center" data-testid="workspace-center">
              {centerMode === 'planning-session' && navState.activePlanningSessionId ? (
                <SessionDetailView
                  embedded
                  sessionIdOverride={navState.activePlanningSessionId}
                  sessionContext={navState.activePlanningSessionContext}
                  onBack={() => navigationStore.closePlanningSession()}
                />
              ) : centerMode === 'docs-graph' ? (
                <DocumentationGraphView
                  repoPath={selectedRepoPath}
                  files={workspaceFiles}
                  onSelectDoc={handleGraphSelectDoc}
                  testId="workspace-docs-graph"
                />
              ) : (
                <WorkspaceDocsCenter
                  repoPath={selectedRepoPath}
                  isFocused={navState.isWorkspaceCenterFocused}
                  files={workspaceFiles}
                  externalSelectPath={graphSelectedDocPath}
                />
              )}
            </div>

            <div className="workspace-right-rail" data-testid="workspace-right-rail">
              <WorkspaceRightRail
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
              />
            </div>
          </div>

          {gitState.error ? (
            <div className="workspace-error" data-testid="workspace-error">{gitState.error}</div>
          ) : null}
        </div>
      ) : (
        <div className="workspace-empty-layout">
          <div className="workspace-sidebar">
            <SourcesConfigPanel />
            <RepoSelectorPanel />
          </div>
          <div className="workspace-main">
            <div className="workspace-empty" data-testid="workspace-empty">
              <p className="state-message">
                Select a repository from the list or configure scan roots to discover repositories.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
