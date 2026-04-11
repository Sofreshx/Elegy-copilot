import { useState } from 'react';
import { Badge, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { projectOverviewStore } from './projectOverviewStore';

// ── Helpers ──

function formatTimeAgo(ms: number | null): string {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ── Component ──

export default function ProjectConfigSummary() {
  const { projectInfo, loading } = useStoreValue(projectOverviewStore);
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <div className="project-config-summary" data-testid="project-config-summary">
        <p>Loading…</p>
      </div>
    );
  }

  if (!projectInfo) {
    return (
      <div className="project-config-summary" data-testid="project-config-summary">
        <p>No project information available.</p>
      </div>
    );
  }

  function handleCopyPath() {
    if (!projectInfo) return;
    void navigator.clipboard.writeText(projectInfo.repoPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="project-config-summary" data-testid="project-config-summary">
      <Panel title="Project Configuration">
        <dl className="config-definition-list">
          <dt>Repo Path</dt>
          <dd>
            <code className="config-path" data-testid="config-repo-path">
              {projectInfo.repoPath}
            </code>
            <button
              type="button"
              className="button button-ghost button-sm"
              data-testid="config-copy-path"
              onClick={handleCopyPath}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </dd>

          <dt>Canonical Remote</dt>
          <dd data-testid="config-remote">
            {projectInfo.canonicalRemote ?? <span className="config-none">Not set</span>}
          </dd>

          <dt>Pinned</dt>
          <dd data-testid="config-pinned">
            <Badge tone={projectInfo.pinned ? 'brand' : 'neutral'}>
              {projectInfo.pinned ? '★ Pinned' : '☆ Not pinned'}
            </Badge>
          </dd>

          <dt>Session Count</dt>
          <dd data-testid="config-session-count">{projectInfo.sessionCount}</dd>

          <dt>Last Activity</dt>
          <dd data-testid="config-last-activity">
            {formatTimeAgo(projectInfo.lastActivityMs)}
          </dd>
        </dl>
      </Panel>

      <Panel title="Installed Assets" subtitle="Assets targeting this project (Phase 4)">
        <p className="config-placeholder">
          Asset inventory integration coming in a future phase.
        </p>
      </Panel>
    </div>
  );
}
