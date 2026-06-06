import { useEffect, useState, useCallback, useRef } from 'react';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from '../Repositories/repositoriesStore';
import { gitStore } from '../../stores/gitStore';
import { runGitChecks } from '../../lib/api/git';
import type { GitCheckResults } from '../../lib/api/git';
import { getWorkspaceLaunchers } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';
import RepoSelectorPanel from '../Repositories/RepoSelectorPanel';
import SourcesConfigPanel from '../Repositories/SourcesConfigPanel';
import GitHubAuthBanner from '../Repositories/GitHubAuthBanner';
import { computeVerificationState, type VerificationState } from '../Repositories/verification';
import WorkspaceLocalTabs from './WorkspaceLocalTabs';
import WorkspaceDocsTab from './WorkspaceDocsTab';
import WorkspaceGitTab from './WorkspaceGitTab';
import WorkspacePlanningTab from './WorkspacePlanningTab';
import WorkspaceExecutionTab from './WorkspaceExecutionTab';

export default function WorkspaceView() {
  const state = useStoreValue(repositoriesStore);
  const gitState = useStoreValue(gitStore);
  const navState = useStoreValue(navigationStore);
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('missing');
  const [checkResults, setCheckResults] = useState<GitCheckResults | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const [launchers, setLaunchers] = useState<WorkspaceLauncher[]>([]);
  const lastCheckRef = useRef<{ branch: string | null; head: string | null; changeCount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getWorkspaceLaunchers();
        if (!cancelled) setLaunchers(data.launchers);
      } catch { /* optional */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="workspace-view" data-testid="workspace-view">
      {selectedRepoPath ? (
        <div className="workspace-layout">
          {/* Floating local tab switcher and brand */}
          <div className="workspace-local-tabs-row" data-testid="workspace-local-tabs-row">
            <WorkspaceLocalTabs
              activeTab={navState.activeWorkspaceLocalTab}
              onTabChange={(tab) => navigationStore.setActiveWorkspaceLocalTab(tab)}
            />
            <div className="workspace-brand" data-testid="workspace-brand">
              <img src="/elegy-copilot-icon.svg" alt="Elegy Copilot" className="workspace-brand-icon" />
            </div>
          </div>

          {showRepoSelector ? (
            <div className="workspace-repo-selector" data-testid="workspace-repo-selector">
              <SourcesConfigPanel />
              <RepoSelectorPanel />
            </div>
          ) : null}

          <GitHubAuthBanner repoPath={selectedRepoPath} />

          <div className="workspace-tab-content" data-testid="workspace-tab-content">
            {navState.activeWorkspaceLocalTab === 'docs' && (
              <WorkspaceDocsTab
                repoPath={selectedRepoPath}
                isFocused={navState.isWorkspaceCenterFocused}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'git' && (
              <WorkspaceGitTab
                repo={displayRepo}
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
                gitState={gitState}
                verificationState={verificationState}
                checkResults={checkResults}
                runningChecks={runningChecks}
                launchers={launchers}
                onRunChecks={handleRunChecks}
                onCommit={() => void gitStore.commit()}
                onPush={() => void gitStore.push()}
                onOpenPR={handleOpenPR}
                onCreatePR={() => void gitStore.createPullRequest()}
                onSetCommitMessage={(msg: string) => gitStore.setCommitMessage(msg)}
                onSetPullRequestTitle={(t: string) => gitStore.setPullRequestTitle(t)}
                onSetPullRequestBody={(b: string) => gitStore.setPullRequestBody(b)}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'planning' && (
              <WorkspacePlanningTab
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'execution' && (
              <WorkspaceExecutionTab repoPath={selectedRepoPath} launchers={launchers} />
            )}
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
