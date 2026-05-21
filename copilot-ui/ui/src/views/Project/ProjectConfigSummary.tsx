import { useState } from 'react';
import { Badge, Panel } from '../../components';
import { useStoreValue } from '../../lib/store';
import { projectOverviewStore } from './projectOverviewStore';
import { formatRelativeTime } from './gitUi';

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
            {formatRelativeTime(projectInfo.lastActivityMs)}
          </dd>
        </dl>
      </Panel>

      <Panel title="Installed Assets" subtitle="Assets targeting this project">
        <p className="config-empty-state" data-testid="config-assets-empty">
          No assets configured for this project yet. Install assets from the Catalog.
        </p>
      </Panel>
    </div>
  );
}
