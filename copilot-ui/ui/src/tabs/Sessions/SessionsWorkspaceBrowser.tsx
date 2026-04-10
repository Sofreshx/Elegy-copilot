import { Button } from '../../components';
import { formatTimestampLabel, humanizeToken } from '../../lib/stateDiagnostics';
import type { SessionsWorkspaceEntry } from '../../lib/types';
import type { SessionsWorkspaceView } from './sessionsWorkspaceStore';

interface SessionsWorkspaceBrowserProps {
  active: SessionsWorkspaceEntry[];
  history: SessionsWorkspaceEntry[];
  selectedView: SessionsWorkspaceView;
  selectedEntryId: string | null;
  loading?: boolean;
  error?: string | null;
  onSelectView: (view: SessionsWorkspaceView) => void;
  onSelectEntry: (entryId: string) => void;
}

function toTimestamp(value: number | string | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function describeRepo(entry: SessionsWorkspaceEntry): string {
  const primaryRepo = entry.workspace?.primaryRepo;
  if (!primaryRepo) {
    return 'No repo context';
  }
  return primaryRepo.repoLabel || primaryRepo.repoId || primaryRepo.repoPath || 'Repo context available';
}

export default function SessionsWorkspaceBrowser({
  active,
  history,
  selectedView,
  selectedEntryId,
  loading = false,
  error = null,
  onSelectView,
  onSelectEntry,
}: SessionsWorkspaceBrowserProps) {
  const visibleEntries = selectedView === 'history' ? history : active;

  return (
    <section className="session-list" data-testid="sessions-workspace-browser">
      <div className="showcase-toolbar-group showcase-toolbar-group-stable">
        <Button
          onClick={() => onSelectView('active')}
          testId="sessions-workspace-view-active"
          variant={selectedView === 'active' ? 'primary' : 'ghost'}
        >
          Active ({active.length})
        </Button>
        <Button
          onClick={() => onSelectView('history')}
          testId="sessions-workspace-view-history"
          variant={selectedView === 'history' ? 'primary' : 'ghost'}
        >
          History ({history.length})
        </Button>
      </div>

      {loading && visibleEntries.length === 0 ? <p className="state-message">Loading session workspace…</p> : null}
      {!loading && error && visibleEntries.length === 0 ? (
        <p className="state-message state-error" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && !error && visibleEntries.length === 0 ? (
        <p className="state-message">
          {selectedView === 'active' ? 'No active sessions available.' : 'No session history available.'}
        </p>
      ) : null}

      {visibleEntries.length > 0 ? (
        <ul className="session-list-items" data-testid="sessions-workspace-list">
          {visibleEntries.map((entry) => (
            <li key={entry.entryId} className="session-item" data-testid="sessions-workspace-item">
              <article
                aria-label={`Select workspace entry ${entry.title}`}
                aria-pressed={entry.entryId === selectedEntryId}
                className={`session-card ${entry.entryId === selectedEntryId ? 'selected' : ''}`}
                onClick={() => onSelectEntry(entry.entryId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectEntry(entry.entryId);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="session-item-header">
                  <p className="session-id">{entry.title}</p>
                  <p className="tracker-item-copy">{humanizeToken(entry.status)}</p>
                </div>
                <dl className="session-item-meta">
                  <div>
                    <dt>Source</dt>
                    <dd>{entry.sourceLabel || humanizeToken(entry.source)}</dd>
                  </div>
                  <div>
                    <dt>Repo</dt>
                    <dd>{describeRepo(entry)}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatTimestampLabel(toTimestamp(entry.updatedAt || entry.startedAt))}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
