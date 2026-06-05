import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from '../Repositories/repositoriesStore';
import { gitStore } from '../../stores/gitStore';
import { discoverGitChecks, runGitChecks } from '../../lib/api/git';
import type { GitCheckResults } from '../../lib/api/git';
import RepoSelectorPanel from '../Repositories/RepoSelectorPanel';
import SourcesConfigPanel from '../Repositories/SourcesConfigPanel';
import GitHubAuthBanner from '../Repositories/GitHubAuthBanner';
import { computeVerificationState, type VerificationState } from '../Repositories/verification';
import WorkspaceActiveRepoCard from './WorkspaceActiveRepoCard';
import WorkspaceDocsCenter from './WorkspaceDocsCenter';
import WorkspaceRightRail from './WorkspaceRightRail';
import SessionDetailView from '../Sessions/SessionDetailView';

export default function WorkspaceView() {
  const state = useStoreValue(repositoriesStore);
  const gitState = useStoreValue(gitStore);
  const navState = useStoreValue(navigationStore);
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('missing');
  const [checkResults, setCheckResults] = useState<GitCheckResults | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const lastCheckRef = useRef<{ branch: string | null; head: string | null; changeCount: number } | null>(null);

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => {
      repositoriesStore.reset();
    };
  }, []);

  const selectedRepoPath =
    navState.activeWorkspaceId
    || state.selectedRepo?.repoPath
    || null;

  // When the workspace tab is the source of truth (focusWorkspace sets
  // activeWorkspaceId but does not touch repositoriesStore), resolve the
  // display repo from the inventory so the label, repoId, and planning
  // context stay consistent with the path-driven data.
  const displayRepo = selectedRepoPath
    ? (state.repos.find(
        (r) => (r.repoPath || '').replace(/\\/g, '/').toLowerCase()
               === selectedRepoPath.replace(/\\/g, '/').toLowerCase(),
      ) || state.selectedRepo)
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
            />
          </div>

          {showRepoSelector ? (
            <div className="workspace-repo-selector" data-testid="workspace-repo-selector">
              <SourcesConfigPanel />
              <RepoSelectorPanel />
            </div>
          ) : null}

          <GitHubAuthBanner repoPath={selectedRepoPath} />

          <div className="workspace-main-layout">
            <div className="workspace-center" data-testid="workspace-center">
              {centerMode === 'planning-session' && navState.activePlanningSessionId ? (
                <SessionDetailView
                  embedded
                  sessionIdOverride={navState.activePlanningSessionId}
                  sessionContext={navState.activePlanningSessionContext}
                  onBack={() => navigationStore.closePlanningSession()}
                />
              ) : (
                <WorkspaceDocsCenter repoPath={selectedRepoPath} />
              )}
            </div>

            <div className="workspace-right-rail" data-testid="workspace-right-rail">
              <WorkspaceRightRail
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
                summary={gitState.summary}
                pullRequest={gitState.pullRequest?.pullRequest ?? null}
                checkResults={checkResults || gitState.checkResults}
                verificationState={verificationState}
                runningChecks={runningChecks}
                commitMessage={gitState.commitMessage}
                committing={gitState.committing}
                syncing={gitState.syncing}
                log={gitState.log}
                onRunChecks={handleRunChecks}
                onCommit={() => void gitStore.commit()}
                onPush={() => void gitStore.push()}
                onOpenPR={handleOpenPR}
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
