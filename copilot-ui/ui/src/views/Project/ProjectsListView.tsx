import { useEffect, useMemo } from 'react';
import { Button, Badge, Panel, Toolbar } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import {
  projectsListStore,
  getFilteredProjects,
  type ProjectSortField,
  type ProjectListItem,
} from './projectsListStore';
import { describeDirtyState, formatRelativeTime, formatSignedCount } from './gitUi';

const SORT_OPTIONS: { value: ProjectSortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'activity', label: 'Activity' },
  { value: 'sessions', label: 'Sessions' },
];

// ── Component ──

export default function ProjectsListView() {
  const state = useStoreValue(projectsListStore);

  useEffect(() => {
    void projectsListStore.loadProjects();
    const interval = setInterval(() => projectsListStore.refresh(), 30_000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => getFilteredProjects(state), [state]);

  // ── Render helpers ──

  function renderProjectCard(project: ProjectListItem) {
    return (
      <div
        key={project.projectId}
        className="project-card"
        data-testid={`project-card-${project.projectId}`}
        role="button"
        tabIndex={0}
        onClick={() => navigationStore.selectProject(project.projectId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigationStore.selectProject(project.projectId);
          }
        }}
      >
        <div className="project-card-header">
          <div className="project-card-title-row">
            <span className="project-card-name">{project.repoLabel}</span>
            <button
              className="project-card-pin"
              data-testid={`project-pin-${project.projectId}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                projectsListStore.togglePin(project.projectId);
              }}
              aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
            >
              {project.pinned ? '⭐' : '☆'}
            </button>
          </div>
          <span className="project-card-path">{project.repoPath}</span>
        </div>

        <div className="project-card-meta">
          <span className="project-card-sessions">{project.totalSessionCount} sessions</span>
          <span className="project-card-git-branch">{project.gitSummary?.branch || 'No branch'}</span>
          <span className={`project-card-git-state ${project.gitSummary?.clean ? 'project-card-git-clean' : 'project-card-git-dirty'}`}>
            {describeDirtyState(project.gitSummary?.changedFiles ?? 0, project.gitSummary?.clean ?? true)}
          </span>
        </div>

        {project.gitSummary && !project.gitSummary.clean ? (
          <div className="project-card-git-delta" data-testid={`project-git-delta-${project.projectId}`}>
            <span className="project-card-git-additions">{formatSignedCount(project.gitSummary.additions)}</span>
            <span className="project-card-git-deletions">{formatSignedCount(-project.gitSummary.deletions)}</span>
          </div>
        ) : null}

        {project.gitSummary?.prNumber ? (
          <div className="project-card-git-pr" data-testid={`project-git-pr-${project.projectId}`}>
            PR #{project.gitSummary.prNumber}
          </div>
        ) : null}

        <div className="project-card-footer">
          {project.activeSessionCount > 0 ? (
            <Badge tone="brand" testId={`project-sessions-${project.projectId}`}>
              {project.activeSessionCount} active
            </Badge>
          ) : (
            <span className="project-card-no-sessions">No active sessions</span>
          )}
          {project.lastActivityMs ? (
            <span className="project-card-activity">{formatRelativeTime(project.lastActivityMs)}</span>
          ) : null}
        </div>
      </div>
    );
  }

  function renderContent() {
    if (state.loading && state.projects.length === 0) {
      return (
        <p className="projects-list-empty" data-testid="projects-loading">
          Loading projects…
        </p>
      );
    }

    if (state.error) {
      return (
        <div className="projects-list-error" data-testid="projects-error">
          <p>{state.error}</p>
          <Button
            variant="secondary"
            size="sm"
            testId="projects-retry"
            onClick={() => projectsListStore.refresh()}
          >
            Retry
          </Button>
        </div>
      );
    }

    if (state.projects.length === 0) {
      return (
        <p className="projects-list-empty" data-testid="projects-empty">
          No projects registered. Add one to get started!
        </p>
      );
    }

    if (filtered.length === 0) {
      return (
        <p className="projects-list-empty" data-testid="projects-no-match">
          No projects match your search
        </p>
      );
    }

    return (
      <div className="projects-grid" data-testid="projects-list-grid">
        {filtered.map(renderProjectCard)}
      </div>
    );
  }

  // ── Main render ──

  return (
    <div className="projects-list-view" data-testid="projects-list-view">
      <Toolbar testId="projects-list-toolbar">
        <h2 className="projects-list-title">Projects</h2>
        <div className="projects-list-header-actions">
          <input
            className="projects-search-input"
            data-testid="projects-search-input"
            type="text"
            placeholder="Search projects…"
            value={state.searchQuery}
            onChange={(e) => projectsListStore.setSearchQuery(e.target.value)}
          />
          <select
            className="projects-sort-select"
            data-testid="projects-sort-field"
            value={state.sortField}
            onChange={(e) => projectsListStore.setSortField(e.target.value as ProjectSortField)}
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            testId="projects-refresh"
            onClick={() => projectsListStore.refresh()}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            testId="projects-add"
            onClick={() => navigationStore.openWizard('project')}
          >
            + Add Project
          </Button>
        </div>
      </Toolbar>

      <Panel testId="projects-list-panel">
        {renderContent()}
      </Panel>
    </div>
  );
}
