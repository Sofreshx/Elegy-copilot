import { useEffect, useMemo } from 'react';
import { Button, Panel, Toolbar } from '../../components';
import CompactSessionCard from '../../components/CompactSessionCard';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import {
  sessionsListStore,
  getFilteredSessions,
  normalizeStatus,
  type SessionSourceFilter,
  type SessionStatusFilter,
  type SessionSortField,
} from './sessionsListStore';

// ── Helpers ──

function formatElapsed(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const SOURCE_OPTIONS: { value: SessionSourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'cli', label: 'CLI' },
  { value: 'sdk', label: 'SDK' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'sandbox', label: 'Sandbox' },
];

const STATUS_OPTIONS: { value: SessionStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

const SORT_OPTIONS: { value: SessionSortField; label: string }[] = [
  { value: 'updated', label: 'Last Updated' },
  { value: 'created', label: 'Created' },
  { value: 'project', label: 'Project' },
];

// ── Component ──

export default function SessionsListView() {
  const state = useStoreValue(sessionsListStore);

  // Load on mount + auto-refresh every 15s
  useEffect(() => {
    void sessionsListStore.loadSessions();
    const interval = setInterval(() => sessionsListStore.refresh(), 15_000);
    return () => clearInterval(interval);
  }, []);

  const filtered = useMemo(() => getFilteredSessions(state), [state]);

  // ── Render helpers ──

  function renderFilterPills() {
    return (
      <div className="sessions-filter-bar" data-testid="sessions-filter-bar">
        <div className="sessions-filter-pills" data-testid="sessions-source-filter">
          {SOURCE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`filter-pill ${state.sourceFilter === value ? 'filter-pill-active' : ''}`}
              onClick={() => sessionsListStore.setSourceFilter(value)}
              data-testid={`source-filter-${value}`}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="sessions-filter-pills" data-testid="sessions-status-filter">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`filter-pill ${state.statusFilter === value ? 'filter-pill-active' : ''}`}
              onClick={() => sessionsListStore.setStatusFilter(value)}
              data-testid={`status-filter-${value}`}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className="sessions-search-input"
          data-testid="sessions-search-input"
          type="text"
          placeholder="Search sessions…"
          value={state.searchQuery}
          onChange={(e) => sessionsListStore.setSearchQuery(e.target.value)}
        />
      </div>
    );
  }

  function renderSortControls() {
    return (
      <div className="sessions-sort-controls" data-testid="sessions-sort-controls">
        <label className="sessions-sort-label" htmlFor="sessions-sort-field">
          Sort by
        </label>
        <select
          id="sessions-sort-field"
          className="sessions-sort-select"
          data-testid="sessions-sort-field"
          value={state.sortField}
          onChange={(e) => sessionsListStore.setSortField(e.target.value as SessionSortField)}
        >
          {SORT_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button
          className="sessions-sort-direction"
          data-testid="sessions-sort-direction"
          type="button"
          onClick={() =>
            sessionsListStore.setSortDirection(state.sortDirection === 'desc' ? 'asc' : 'desc')
          }
          aria-label={`Sort ${state.sortDirection === 'desc' ? 'ascending' : 'descending'}`}
        >
          {state.sortDirection === 'desc' ? '↓' : '↑'}
        </button>
      </div>
    );
  }

  function renderContent() {
    if (state.loading && state.sessions.length === 0) {
      return (
        <p className="sessions-list-empty" data-testid="sessions-loading">
          Loading sessions…
        </p>
      );
    }

    if (state.error) {
      return (
        <div className="sessions-list-error" data-testid="sessions-error">
          <p>{state.error}</p>
          <Button
            variant="secondary"
            size="sm"
            testId="sessions-retry"
            onClick={() => sessionsListStore.refresh()}
          >
            Retry
          </Button>
        </div>
      );
    }

    if (state.sessions.length === 0) {
      return (
        <p className="sessions-list-empty" data-testid="sessions-empty">
          No sessions yet. Create one to get started!
        </p>
      );
    }

    if (filtered.length === 0) {
      return (
        <p className="sessions-list-empty" data-testid="sessions-no-match">
          No sessions match your filters
        </p>
      );
    }

    return (
      <div className="sessions-list-grid" data-testid="sessions-list-grid">
        {filtered.map((session) => (
          <CompactSessionCard
            key={session.id}
            id={session.id}
            title={session.title}
            projectName={session.projectName || undefined}
            repoLabel={session.repoLabel || undefined}
            status={normalizeStatus(session.status)}
            elapsed={formatElapsed(session.elapsedMs)}
            onSelect={(id) => navigationStore.selectSession(id)}
            testId={`session-card-${session.id}`}
          />
        ))}
      </div>
    );
  }

  // ── Main render ──

  return (
    <div className="sessions-list-view" data-testid="sessions-list-view">
      <Toolbar testId="sessions-list-toolbar">
        <h2 className="sessions-list-title">Sessions</h2>
        <div className="sessions-list-header-actions">
          <Button
            variant="ghost"
            size="sm"
            testId="sessions-refresh"
            onClick={() => sessionsListStore.refresh()}
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            testId="sessions-new"
            onClick={() => navigationStore.openWizard('session')}
          >
            + New Session
          </Button>
        </div>
      </Toolbar>

      <Panel testId="sessions-list-panel">
        {renderFilterPills()}
        {renderSortControls()}
        {renderContent()}
      </Panel>
    </div>
  );
}
