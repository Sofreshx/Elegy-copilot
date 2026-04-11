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

// ── Helpers ──

function formatRelativeTime(ms: number | null): string {
  if (!ms || ms <= 0) return '';
  const delta = Date.now() - ms;
  if (delta < 0) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
        key={project.key}
        className="project-card"
        data-testid={`project-card-${project.key}`}
        role="button"
        tabIndex={0}
        onClick={() => navigationStore.selectProject(project.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigationStore.selectProject(project.key);
          }
        }}
      >
        <div className="project-card-header">
          <div className="project-card-title-row">
            <span className="project-card-name">{project.label}</span>
            <button
              className="project-card-pin"
              data-testid={`project-pin-${project.key}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                projectsListStore.togglePin(project.key);
              }}
              aria-label={project.pinned ? 'Unpin project' : 'Pin project'}
            >
              {project.pinned ? '⭐' : '☆'}
            </button>
          </div>
          <span className="project-card-path">{project.repoPath}</span>
        </div>

        <div className="project-card-footer">
          {project.activeSessionCount > 0 ? (
            <Badge tone="brand" testId={`project-sessions-${project.key}`}>
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
      <div className="projects-list-grid" data-testid="projects-list-grid">
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
