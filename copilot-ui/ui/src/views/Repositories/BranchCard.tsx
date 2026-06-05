import { useState } from 'react';
import { Badge, Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { gitStore } from '../../stores/gitStore';
import { formatSignedCount } from '../Project/gitUi';
import type { GitSummaryResponse, GitPullRequestResponse } from '../../lib/api/git';
import {
  computeVerificationState,
  verificationLabel,
  verificationTone,
  type VerificationState,
} from './verification';

interface BranchCardProps {
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse['pullRequest'];
  loading: boolean;
  onRefresh: () => void;
  onOpenPR: () => void;
}

export function BranchCard({ summary, pullRequest, loading, onRefresh, onOpenPR }: BranchCardProps) {
  return (
    <Panel
      title="Branch"
      subtitle={summary?.upstream || 'No upstream'}
      testId="repo-branch-card"
      actions={(
        <Button variant="ghost" size="sm" testId="repo-branch-refresh" onClick={onRefresh} disabled={loading}>
          {loading ? '...' : 'Refresh'}
        </Button>
      )}
    >
      <div className="repo-card-grid">
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Current</span>
          <span className="repo-card-stat-value">{summary?.branch || 'Detached'}</span>
        </div>
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Ahead / Behind</span>
          <span className="repo-card-stat-value">
            {summary?.ahead ?? 0} / {summary?.behind ?? 0}
          </span>
        </div>
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Remote</span>
          <span className="repo-card-stat-value">{summary?.remoteLabel || 'No remote'}</span>
        </div>
        <div className="repo-card-stat">
          <span className="repo-card-stat-label">Pull Request</span>
          <span className="repo-card-stat-value">
            {pullRequest ? (
              <>
                <Badge tone="brand">#{pullRequest.number}</Badge>
                <span className="repo-card-pr-state">{pullRequest.state}</span>
              </>
            ) : (
              'None'
            )}
          </span>
        </div>
      </div>
      {pullRequest?.url ? (
        <div className="repo-card-actions">
          <Button variant="ghost" size="sm" testId="repo-branch-open-pr" onClick={onOpenPR}>
            View PR
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
