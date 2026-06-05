import { useState } from 'react';
import { Panel } from '../../components';
import type { GitLogResponse } from '../../lib/api/git';

interface RecentCommitsCardProps {
  log: GitLogResponse | null;
}

export function RecentCommitsCard({ log }: RecentCommitsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const commits = log?.commits ?? [];

  if (commits.length === 0) return null;

  return (
    <Panel title="Recent Commits" testId="repo-commits-card">
      <button
        type="button"
        className="repo-card-toggle-btn"
        onClick={() => setExpanded(!expanded)}
        data-testid="repo-commits-toggle"
      >
        {expanded ? 'Hide' : 'Show'} commits ({commits.length})
      </button>

      {expanded ? (
        <div className="repo-commits-list" data-testid="repo-commits-list">
          {commits.map((commit, index) => (
            <div key={`${commit.hash}-${index}`} className="repo-commit-item">
              <span className="repo-commit-hash">{commit.hash}</span>
              <span className="repo-commit-message">{commit.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
