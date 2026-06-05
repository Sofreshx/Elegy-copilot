import { useState, useEffect } from 'react';
import { Button, Panel } from '../../components';
import { navigationStore } from '../../stores/navigation';
import { gitStore } from '../../stores/gitStore';
import { getPlanningRecords } from '../../lib/api/planning';
import type { PlanningRecordItem } from '../../lib/types';
import type { GitSummaryResponse, GitPullRequestResponse, GitCheckResults, GitLogResponse } from '../../lib/api/git';
import type { VerificationState } from '../Repositories/verification';
import WorkspaceCommandsCard from './WorkspaceCommandsCard';

interface WorkspaceRightRailProps {
  repoPath: string;
  repoId: string | null;
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse['pullRequest'] | null;
  checkResults: GitCheckResults | null;
  verificationState: VerificationState;
  runningChecks: boolean;
  commitMessage: string;
  committing: boolean;
  syncing: boolean;
  log: GitLogResponse | null;
  onRunChecks: () => void;
  onCommit: () => void;
  onPush: () => void;
  onOpenPR: () => void;
}

export default function WorkspaceRightRail({
  repoPath,
  repoId,
  summary,
  pullRequest,
  checkResults,
  verificationState,
  runningChecks,
  commitMessage,
  committing,
  syncing,
  log,
  onRunChecks,
  onCommit,
  onPush,
  onOpenPR,
}: WorkspaceRightRailProps) {
  const [planningRecords, setPlanningRecords] = useState<PlanningRecordItem[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanning() {
      setPlanningLoading(true);
      try {
        const query: Record<string, string> = {};
        if (repoId) query.repoId = repoId;
        const data = await getPlanningRecords(query);
        if (!cancelled) {
          const records = (data.records || []);
          const filtered = repoId
            ? records.filter((r) => r.repoId === repoId)
            : records.filter((r) => !r.repoId);
          setPlanningRecords(filtered.slice(0, 10));
        }
      } catch {
        // planning is optional, don't show error
      } finally {
        if (!cancelled) setPlanningLoading(false);
      }
    }
    void loadPlanning();
    return () => { cancelled = true; };
  }, [repoPath, repoId]);

  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const changedFiles = summary?.changedFiles ?? 0;

  return (
    <div className="workspace-right-rail-stack" data-testid="workspace-right-rail-stack">
      <Panel title="Planning" subtitle={`${planningRecords.length} sessions`} testId="workspace-planning-card">
        {planningLoading ? (
          <div className="state-message">Loading...</div>
        ) : planningRecords.length === 0 ? (
          <div className="state-message">No planning sessions for this repo.</div>
        ) : (
          <ul className="workspace-planning-list">
            {planningRecords.map((record) => (
              <li key={record.recordId}>
                <button
                  type="button"
                  className="workspace-planning-item"
                  onClick={() => navigationStore.openPlanningSession(record.recordId)}
                  data-testid={`workspace-planning-item-${record.recordId}`}
                >
                  <span className="workspace-planning-item-title">{String(record.title || record.recordId)}</span>
                  {record.state ? (
                    <span className="workspace-planning-item-status">{String(record.state)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Git" subtitle={branch || 'No branch'} testId="workspace-git-card">
        <div className="workspace-git-info">
          {branch ? (
            <div className="workspace-git-row">
              <span className="workspace-git-label">Branch</span>
              <span className="workspace-git-value">{branch}</span>
            </div>
          ) : null}
          {hasRemote && pullRequest ? (
            <div className="workspace-git-row">
              <span className="workspace-git-label">PR</span>
              <a href={pullRequest.url} target="_blank" rel="noopener noreferrer" className="workspace-git-pr-link">
                #{pullRequest.number} ({pullRequest.state})
              </a>
            </div>
          ) : null}
          <div className="workspace-git-row">
            <span className="workspace-git-label">Changes</span>
            <span className="workspace-git-value">{changedFiles} file{changedFiles !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="workspace-git-actions">
          <Button
            variant="secondary"
            size="sm"
            disabled={runningChecks}
            onClick={onRunChecks}
            testId="workspace-run-checks"
          >
            {runningChecks ? 'Running...' : 'Run checks'}
          </Button>
          {hasRemote && pullRequest ? (
            <Button variant="ghost" size="sm" onClick={onOpenPR} testId="workspace-open-pr">
              Open PR
            </Button>
          ) : null}
        </div>
        {checkResults ? (
          <div className={`workspace-checks-result ${checkResults.allPassed ? 'workspace-checks-passed' : 'workspace-checks-failed'}`}>
            {checkResults.allPassed ? 'All checks passed' : 'Some checks failed'}
          </div>
        ) : null}
      </Panel>

      <WorkspaceCommandsCard repoPath={repoPath} />

      <Panel title="Commit & Push" testId="workspace-commit-card">
        <div className="workspace-commit-form">
          <input
            className="form-input-field"
            type="text"
            placeholder="Commit message..."
            value={commitMessage}
            onChange={(e) => gitStore.setCommitMessage(e.target.value)}
            disabled={committing}
          />
          <div className="workspace-commit-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={!commitMessage.trim() || committing}
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
          {verificationState !== 'verified' && changedFiles > 0 ? (
            <div className="workspace-commit-warning" data-testid="workspace-commit-warning">
              Checks are not verified. Run checks before pushing.
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Recent Commits" testId="workspace-log-card">
        {log && log.commits.length > 0 ? (
          <ul className="workspace-commit-log">
            {log.commits.slice(0, 5).map((commit) => (
              <li key={commit.hash} className="workspace-commit-entry">
                <span className="workspace-commit-hash">{commit.hash.slice(0, 7)}</span>
                <span className="workspace-commit-msg">{commit.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="state-message">No commits found.</div>
        )}
      </Panel>
    </div>
  );
}
