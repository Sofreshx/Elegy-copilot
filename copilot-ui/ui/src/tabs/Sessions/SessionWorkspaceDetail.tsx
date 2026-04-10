import { formatTimestampLabel, humanizeToken } from '../../lib/stateDiagnostics';
import type { SessionsWorkspaceEntry } from '../../lib/types';

interface SessionWorkspaceDetailProps {
  entry?: SessionsWorkspaceEntry | null;
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
    return 'No repo context was reported for this session yet.';
  }
  return primaryRepo.repoPath || primaryRepo.repoLabel || primaryRepo.repoId || 'Repo context available.';
}

function describeHandoff(entry: SessionsWorkspaceEntry): string {
  switch (entry.detail?.handoffTarget) {
    case 'sdk':
      return 'Open the SDK subview to stream messages or manage the live SDK session directly.';
    case 'overlay':
      return 'Use the overlay workspace or Executor for attached runtime observations and queue handoff.';
    case 'session-detail':
      return 'This entry can reuse the existing artifact-backed session detail surface.';
    default:
      return 'This history entry is summary-only in the current slice.';
  }
}

export default function SessionWorkspaceDetail({ entry = null }: SessionWorkspaceDetailProps) {
  if (!entry) {
    return <p className="state-message">Select a session workspace entry to inspect its current summary.</p>;
  }

  const linkedRepos = Array.isArray(entry.workspace?.linkedRepos) ? entry.workspace.linkedRepos : [];

  return (
    <div className="session-detail">
      <p className="session-detail-suggestion">
        <span>Workspace entry:</span> {entry.title}
      </p>
      <p className="tracker-item-copy">
        {entry.sourceLabel || humanizeToken(entry.source)} | {humanizeToken(entry.status)}
      </p>
      <p className="tracker-item-copy">{describeRepo(entry)}</p>
      <p className="tracker-item-copy">Updated: {formatTimestampLabel(toTimestamp(entry.updatedAt || entry.startedAt))}</p>
      {entry.linkedSessionId ? (
        <p className="tracker-item-copy">Linked durable session: {entry.linkedSessionId}</p>
      ) : null}
      <p className="tracker-item-copy">Linked repos in this first slice: {linkedRepos.length}</p>
      <p className="tracker-item-copy">{describeHandoff(entry)}</p>
    </div>
  );
}
