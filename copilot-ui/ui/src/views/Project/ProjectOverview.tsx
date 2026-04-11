import { useEffect } from 'react';
import { Badge, Button, HealthDot, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import type { ProjectSubView } from '../../stores/navigation';
import { projectOverviewStore } from './projectOverviewStore';
import ProjectSessionsList from './ProjectSessionsList';
import ProjectTaskBoard from './ProjectTaskBoard';
import ProjectConfigSummary from './ProjectConfigSummary';

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

const SUB_TABS: { id: ProjectSubView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'config', label: 'Config' },
];

// ── Overview sub-view (inline) ──

function OverviewSummary() {
  const { sessions, activity, loading } = useStoreValue(projectOverviewStore);

  if (loading) {
    return <p>Loading…</p>;
  }

  const activeCount = sessions.filter((s) => {
    const lower = (s.status || '').toLowerCase();
    return lower === 'active' || lower === 'running';
  }).length;

  return (
    <div className="project-overview-summary" data-testid="project-overview-summary">
      <Panel title="Quick Stats">
        <div className="project-stats-row">
          <div className="project-stat">
            <span className="project-stat-value">{sessions.length}</span>
            <span className="project-stat-label">Total Sessions</span>
          </div>
          <div className="project-stat">
            <span className="project-stat-value">{activeCount}</span>
            <span className="project-stat-label">Active</span>
          </div>
        </div>
      </Panel>

      <Panel title="Recent Activity" testId="project-activity-feed">
        {activity.length > 0 ? (
          <div className="recent-activity-feed">
            {activity.slice(0, 10).map((item, i) => (
              <div className="activity-item" key={`${item.timestamp}-${i}`}>
                <span className="activity-item-time">
                  {item.timestamp ? formatTimeAgo(item.timestamp) : '—'}
                </span>
                <span className="activity-item-summary">{item.summary}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="project-sessions-empty">No recent activity</p>
        )}
      </Panel>
    </div>
  );
}

// ── Main component ──

export default function ProjectOverview() {
  const navState = useStoreValue(navigationStore);
  const { projectInfo, loading, error } = useStoreValue(projectOverviewStore);

  const projectId = navState.selectedProjectId;
  const subView = navState.projectSubView;

  useEffect(() => {
    if (projectId) {
      void projectOverviewStore.loadProject(projectId);
    }
  }, [projectId]);

  if (!projectId) {
    return (
      <div className="project-overview" data-testid="project-overview">
        <p>No project selected.</p>
      </div>
    );
  }

  function renderSubView() {
    switch (subView) {
      case 'sessions':
        return <ProjectSessionsList />;
      case 'tasks':
        return <ProjectTaskBoard />;
      case 'config':
        return <ProjectConfigSummary />;
      case 'overview':
      default:
        return <OverviewSummary />;
    }
  }

  return (
    <div className="project-overview" data-testid="project-overview">
      {/* Header */}
      <header className="project-overview-header" data-testid="project-overview-header">
        <div className="project-overview-title-row">
          <h2 className="project-overview-name">
            {projectInfo?.label ?? projectId}
          </h2>
          {projectInfo ? (
            <span
              className="project-overview-pin"
              data-testid="project-pin-toggle"
              title={projectInfo.pinned ? 'Pinned' : 'Not pinned'}
            >
              {projectInfo.pinned ? '★' : '☆'}
            </span>
          ) : null}
          <HealthDot tone="ok" label="Healthy" testId="project-health-dot" />
          {projectInfo?.lastActivityMs ? (
            <Badge tone="neutral" testId="project-last-activity">
              {formatTimeAgo(projectInfo.lastActivityMs)}
            </Badge>
          ) : null}
        </div>
        {projectInfo?.repoPath ? (
          <p className="project-overview-path" data-testid="project-overview-path">
            {projectInfo.repoPath}
          </p>
        ) : null}
      </header>

      {/* Quick Actions */}
      <Toolbar testId="project-toolbar">
        <Button
          variant="secondary"
          size="sm"
          testId="project-back-btn"
          onClick={() => navigationStore.navigate('projects')}
        >
          ← Back to Projects
        </Button>
        <Button
          variant="primary"
          size="sm"
          testId="project-new-session-btn"
          onClick={() => navigationStore.openWizard('session')}
        >
          + New Session
        </Button>
      </Toolbar>

      {/* Sub-tab bar */}
      <nav className="project-sub-tabs" data-testid="project-sub-tabs" role="tablist">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`project-sub-tab ${subView === tab.id ? 'project-sub-tab-active' : ''}`}
            aria-selected={subView === tab.id}
            data-testid={`project-tab-${tab.id}`}
            onClick={() => navigationStore.selectProject(projectId, tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Error state */}
      {error ? (
        <div className="project-error" data-testid="project-error">
          <p>Failed to load: {error}</p>
          <Button variant="secondary" size="sm" onClick={() => void projectOverviewStore.refresh()}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* Loading state */}
      {loading && !error ? (
        <p className="project-loading" data-testid="project-loading">Loading…</p>
      ) : null}

      {/* Sub-view content */}
      {!loading || error ? (
        <div className="project-sub-view-content" data-testid="project-sub-view-content">
          {renderSubView()}
        </div>
      ) : null}
    </div>
  );
}
