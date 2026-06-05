import { useEffect, useState, useCallback, useRef } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { repositoriesStore } from './repositoriesStore';
import { gitStore } from '../../stores/gitStore';
import { discoverGitChecks, runGitChecks } from '../../lib/api/git';
import type { GitCheckResults } from '../../lib/api/git';
import SourcesConfigPanel from './SourcesConfigPanel';
import RepoSelectorPanel from './RepoSelectorPanel';
import GitHubAuthBanner from './GitHubAuthBanner';
import { BranchCard } from './BranchCard';
import { ChangesCard } from './ChangesCard';
import { CommitPushCard } from './CommitPushCard';
import { DiffCard } from './DiffCard';
import { RecentCommitsCard } from './RecentCommitsCard';
import { RepoDocsCard } from './RepoDocsCard';
import {
  computeVerificationState,
  type VerificationState,
} from './verification';

export default function RepositoriesView() {
  const state = useStoreValue(repositoriesStore);
  const gitState = useStoreValue(gitStore);
  const [showSidebar, setShowSidebar] = useState(false);
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

  const selectedRepoPath = state.selectedRepo?.repoPath ?? null;

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
    <div className="repos-view" data-testid="repositories-view">
      <Toolbar testId="repos-toolbar">
        <h2>Repositories</h2>
        <span className="state-copy">
          {state.selectedRepo
            ? `${state.selectedRepo.repoLabel || state.selectedRepo.repoPath || ''}`
            : 'Select a repository to manage'}
        </span>
      </Toolbar>

      {selectedRepoPath ? (
        <div className="repos-cards-layout">
          <div className="repos-active-bar" data-testid="repos-active-bar">
            <Panel
              title="Active Repository"
              subtitle={state.selectedRepo?.repoLabel || selectedRepoPath}
              testId="repos-active-card"
              actions={(
                <Button
                  variant="ghost"
                  size="sm"
                  testId="repos-toggle-sidebar"
                  onClick={() => setShowSidebar(!showSidebar)}
                >
                  {showSidebar ? 'Hide repos' : 'Switch repo'}
                </Button>
              )}
            >
              <div className="repos-active-path">{selectedRepoPath}</div>
            </Panel>
          </div>

          {showSidebar ? (
            <div className="repos-sidebar-collapsible" data-testid="repos-sidebar-collapsible">
              <SourcesConfigPanel />
              <RepoSelectorPanel />
            </div>
          ) : null}

          <GitHubAuthBanner repoPath={selectedRepoPath} />

          <div className="repos-cards-grid">
            <BranchCard
              summary={gitState.summary}
              pullRequest={gitState.pullRequest?.pullRequest ?? null}
              loading={gitState.loading}
              onRefresh={() => void gitStore.loadStatus(selectedRepoPath)}
              onOpenPR={handleOpenPR}
            />
            <ChangesCard
              status={gitState.status}
              summary={gitState.summary}
              staging={gitState.staging}
            />
            <CommitPushCard
              verificationState={verificationState}
              checkResults={checkResults || gitState.checkResults}
              commitMessage={gitState.commitMessage}
              committing={gitState.committing}
              syncing={gitState.syncing}
              hasBranch={Boolean(gitState.summary?.branch)}
              hasRemote={Boolean(gitState.summary?.hasRemote)}
              showOverrideInput={gitState.showOverrideInput}
              unsafeOverrideReason={gitState.unsafeOverrideReason}
              onCommit={() => void gitStore.commit()}
              onPush={() => void gitStore.push()}
              onRunChecks={handleRunChecks}
            />
          </div>

          <div className="repos-detail-cards">
            <DiffCard diff={gitState.diff} diffView={gitState.diffView} />
            <RecentCommitsCard log={gitState.log} />
            <RepoDocsCard repoPath={selectedRepoPath} />
          </div>

          {gitState.error ? (
            <div className="repos-error" data-testid="repos-error">{gitState.error}</div>
          ) : null}
        </div>
      ) : (
        <div className="repos-master-detail">
          <div className="repos-sidebar">
            <SourcesConfigPanel />
            <RepoSelectorPanel />
          </div>
          <div className="repos-main">
            <div className="repos-empty" data-testid="repos-empty">
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
