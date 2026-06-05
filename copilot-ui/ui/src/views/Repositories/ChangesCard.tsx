import { useState } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { gitStore } from '../../stores/gitStore';
import { formatSignedCount } from '../Project/gitUi';
import type { GitStatusResponse, GitSummaryResponse } from '../../lib/api/git';

interface ChangesCardProps {
  status: GitStatusResponse | null;
  summary: GitSummaryResponse | null;
  staging: boolean;
}

export function ChangesCard({ status, summary, staging }: ChangesCardProps) {
  const [showFiles, setShowFiles] = useState(false);
  const hasChanges = Boolean(status && status.files.length > 0);

  return (
    <Panel
      title="Changes"
      subtitle={summary ? (summary.clean ? 'Clean' : `${summary.changedFiles} files`) : '...'}
      testId="repo-changes-card"
      actions={(
        <div className="repo-card-actions">
          <Button
            variant="ghost"
            size="sm"
            testId="repo-changes-stage-all"
            onClick={() => void gitStore.stageAll()}
            disabled={staging || !hasChanges}
          >
            Stage all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            testId="repo-changes-unstage-all"
            onClick={() => void gitStore.unstageAll()}
            disabled={staging || (status?.stagedCount ?? 0) === 0}
          >
            Unstage all
          </Button>
        </div>
      )}
    >
      <div className="repo-card-grid">
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Staged</span>
          <span className="repo-card-stat-value">{status?.stagedCount ?? 0}</span>
        </div>
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Unstaged</span>
          <span className="repo-card-stat-value">{status?.unstagedCount ?? 0}</span>
        </div>
        {summary && !summary.clean ? (
          <>
            <div className="repo-card-stat">
              <span className="repo-card-stat-label">Additions</span>
              <span className="repo-card-stat-value repo-card-additions">{formatSignedCount(summary.additions)}</span>
            </div>
            <div className="repo-card-stat">
              <span className="repo-card-stat-label">Deletions</span>
              <span className="repo-card-stat-value repo-card-deletions">{formatSignedCount(-summary.deletions)}</span>
            </div>
          </>
        ) : null}
      </div>

      {hasChanges ? (
        <div className="repo-card-detail-toggle">
          <button
            type="button"
            className="repo-card-toggle-btn"
            onClick={() => setShowFiles(!showFiles)}
            data-testid="repo-changes-toggle-files"
          >
            {showFiles ? 'Hide' : 'Show'} changed files ({status!.files.length})
          </button>
          {showFiles ? (
            <div className="repo-card-file-list" data-testid="repo-changes-file-list">
              {status!.files.map((file, index) => (
                <div key={`${file.path}-${index}`} className="repo-card-file-item">
                  <span className="repo-card-file-status">{file.status.trim() || '?'}</span>
                  <span className="repo-card-file-path">{file.path}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
