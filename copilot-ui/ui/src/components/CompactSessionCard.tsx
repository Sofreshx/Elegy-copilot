interface CompactSessionCardProps {
  id: string;
  title: string;
  projectName?: string;
  status: 'active' | 'idle' | 'completed' | 'failed' | 'unknown';
  elapsed?: string;
  repoLabel?: string;
  onSelect?: (id: string) => void;
  onAction?: (id: string, action: 'resume' | 'stop') => void;
  testId?: string;
}

const STATUS_DOT_CLASS: Record<CompactSessionCardProps['status'], string> = {
  active: 'compact-session-dot-active',
  idle: 'compact-session-dot-idle',
  completed: 'compact-session-dot-completed',
  failed: 'compact-session-dot-failed',
  unknown: 'compact-session-dot-completed',
};

export default function CompactSessionCard({
  id,
  title,
  projectName,
  status,
  elapsed,
  repoLabel,
  onSelect,
  onAction,
  testId = 'compact-session-card',
}: CompactSessionCardProps) {
  const showActions = status === 'active' || status === 'idle';

  function handleClick() {
    onSelect?.(id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(id);
    }
  }

  function handleAction(action: 'resume' | 'stop', e: React.MouseEvent) {
    e.stopPropagation();
    onAction?.(id, action);
  }

  return (
    <div
      className="compact-session-card"
      data-testid={testId}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span
        className={`compact-session-dot ${STATUS_DOT_CLASS[status]}`}
        data-testid={`${testId}-dot`}
        aria-label={`Status: ${status}`}
      />

      <div className="compact-session-info">
        <span className="compact-session-title" data-testid={`${testId}-title`}>
          {title}
        </span>
        {projectName ? (
          <span className="compact-session-project" data-testid={`${testId}-project`}>
            {projectName}
          </span>
        ) : null}
        {repoLabel ? (
          <span className="compact-session-repo" data-testid={`${testId}-repo`}>
            {repoLabel}
          </span>
        ) : null}
      </div>

      {elapsed ? (
        <span className="compact-session-elapsed" data-testid={`${testId}-elapsed`}>
          {elapsed}
        </span>
      ) : null}

      <span className="compact-session-status" data-testid={`${testId}-status`}>
        {status}
      </span>

      {showActions && onAction ? (
        <div className="compact-session-actions" data-testid={`${testId}-actions`}>
          {status === 'idle' ? (
            <button
              type="button"
              className="compact-session-action-btn"
              data-testid={`${testId}-resume`}
              onClick={(e) => handleAction('resume', e)}
            >
              Resume
            </button>
          ) : null}
          <button
            type="button"
            className="compact-session-action-btn compact-session-action-stop"
            data-testid={`${testId}-stop`}
            onClick={(e) => handleAction('stop', e)}
          >
            Stop
          </button>
        </div>
      ) : null}
    </div>
  );
}
