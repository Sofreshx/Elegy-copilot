import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { gitStore } from '../../stores/gitStore';
import type { GitCheckResults } from '../../lib/api/git';
import {
  verificationLabel,
  verificationTone,
  type VerificationState,
} from './verification';

interface CommitPushCardProps {
  verificationState: VerificationState;
  checkResults: GitCheckResults | null;
  commitMessage: string;
  committing: boolean;
  syncing: boolean;
  hasBranch: boolean;
  hasRemote: boolean;
  showOverrideInput: boolean;
  unsafeOverrideReason: string;
  onCommit: () => void;
  onPush: () => void;
  onRunChecks: () => void;
}

export function CommitPushCard({
  verificationState,
  checkResults,
  commitMessage,
  committing,
  syncing,
  hasBranch,
  hasRemote,
  showOverrideInput,
  unsafeOverrideReason,
  onCommit,
  onPush,
  onRunChecks,
}: CommitPushCardProps) {
  const needsWarning = verificationState === 'missing' || verificationState === 'stale' ||
    verificationState === 'partial' || verificationState === 'failed';
  const canPush = hasBranch && hasRemote && !syncing &&
    (verificationState === 'verified' || (showOverrideInput && unsafeOverrideReason.trim().length > 0));

  return (
    <Panel title="Commit & Push" testId="repo-commit-push-card">
      <div className="repo-card-verification" data-testid="repo-verification-state">
        <div className="repo-card-verification-row">
          <span className={`repo-card-verification-badge repo-card-verification-${verificationState}`}>
            {verificationLabel(verificationState)}
          </span>
          {(verificationState === 'missing' || verificationState === 'stale') ? (
            <Button variant="secondary" size="sm" testId="repo-run-checks" onClick={onRunChecks}>
              Run checks
            </Button>
          ) : null}
        </div>

        {verificationState === 'failed' && checkResults ? (
          <div className="repo-card-check-summary" data-testid="repo-check-summary">
            <span className="repo-card-check-failed-count">
              {checkResults.checksFailed} of {checkResults.checksRun} checks failed
            </span>
            <div className="repo-card-check-detail-toggle">
              <details>
                <summary className="repo-card-toggle-btn">View failed checks</summary>
                <ul className="repo-card-check-list">
                  {checkResults.results.filter((r) => !r.passed).map((r, i) => (
                    <li key={i} className="repo-card-check-item">
                      <strong>{r.checkName}</strong>: {r.error || 'Failed'}
                      {r.output ? <pre className="repo-card-check-output">{r.output.slice(0, 300)}</pre> : null}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            <Button variant="secondary" size="sm" testId="repo-rerun-checks" onClick={onRunChecks}>
              Re-run checks
            </Button>
          </div>
        ) : null}

        {needsWarning && verificationState !== 'failed' ? (
          <div className="repo-card-verification-warning" data-testid="repo-verification-warning">
            {verificationState === 'missing' && 'Run checks before pushing to ensure code quality.'}
            {verificationState === 'stale' && 'Repo state changed since last check run. Re-run checks.'}
            {verificationState === 'partial' && 'Local checks passed but CI is still pending.'}
          </div>
        ) : null}
      </div>

      <div className="repo-card-commit-section">
        <textarea
          className="repo-card-commit-input"
          data-testid="repo-commit-input"
          placeholder="Commit message..."
          rows={3}
          value={commitMessage}
          onChange={(e) => gitStore.setCommitMessage(e.target.value)}
        />

        {showOverrideInput ? (
          <div className="repo-card-override" data-testid="repo-override-section">
            <label className="repo-card-override-label">
              Override reason (required for unsafe push):
              <input
                type="text"
                className="repo-card-override-input"
                value={unsafeOverrideReason}
                onChange={(e) => gitStore.setUnsafeOverrideReason(e.target.value)}
                placeholder="e.g., Hotfix for production issue"
                data-testid="repo-override-input"
              />
            </label>
            <div className="repo-card-override-warning">
              Proceeding with failed checks. This action will be recorded.
            </div>
          </div>
        ) : null}

        <div className="repo-card-commit-actions">
          <Button
            variant="primary"
            size="sm"
            testId="repo-commit-button"
            disabled={committing || !commitMessage.trim()}
            onClick={onCommit}
          >
            {committing ? 'Committing...' : 'Commit'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            testId="repo-push-button"
            disabled={!canPush}
            onClick={onPush}
          >
            {syncing ? 'Pushing...' : 'Push'}
          </Button>
          {showOverrideInput ? (
            <Button
              variant="ghost"
              size="sm"
              testId="repo-clear-check"
              onClick={() => gitStore.clearCheckState()}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
