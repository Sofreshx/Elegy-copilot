import { useState } from 'react';
import { Button, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { gitStore } from '../../stores/gitStore';
import type { GitDiffResponse } from '../../lib/api/git';

interface DiffCardProps {
  diff: GitDiffResponse | null;
  diffView: 'unstaged' | 'staged';
}

export function DiffCard({ diff, diffView }: DiffCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Panel title="Diff" testId="repo-diff-card">
      <button
        type="button"
        className="repo-card-toggle-btn"
        onClick={() => setExpanded(!expanded)}
        data-testid="repo-diff-toggle"
      >
        {expanded ? 'Hide' : 'Show'} diff
      </button>

      {expanded ? (
        <div className="repo-diff-content">
          <div className="repo-diff-tabs">
            <button
              type="button"
              className={`repo-diff-tab ${diffView === 'unstaged' ? 'repo-diff-tab-active' : ''}`}
              onClick={() => { gitStore.setDiffView('unstaged'); void gitStore.loadDiff(); }}
              data-testid="repo-diff-unstaged"
            >
              Unstaged
            </button>
            <button
              type="button"
              className={`repo-diff-tab ${diffView === 'staged' ? 'repo-diff-tab-active' : ''}`}
              onClick={() => { gitStore.setDiffView('staged'); void gitStore.loadDiff(); }}
              data-testid="repo-diff-staged"
            >
              Staged
            </button>
          </div>
          <pre className="repo-diff-pre" data-testid="repo-diff-content">
            {diff?.diff || '(no changes)'}
          </pre>
        </div>
      ) : null}
    </Panel>
  );
}
