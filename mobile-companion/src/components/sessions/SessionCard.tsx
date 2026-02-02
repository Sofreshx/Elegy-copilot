import type { Session } from '../../services/relayApi';
import './SessionCard.css';

interface SessionCardProps {
  session: Session;
  onClick: () => void;
}

/**
 * Format relative time (e.g., "2 minutes ago", "just now")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 30) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes === 1) return '1 min ago';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays} days ago`;
}

/**
 * Get status badge class and label
 */
function getStatusInfo(status: Session['status']): { className: string; label: string } {
  switch (status) {
    case 'pending':
      return { className: 'pending', label: 'Pending' };
    case 'running':
      return { className: 'running', label: 'Running' };
    case 'completed':
      return { className: 'completed', label: 'Completed' };
    case 'failed':
      return { className: 'failed', label: 'Failed' };
    case 'cancelled':
      return { className: 'cancelled', label: 'Cancelled' };
    default:
      return { className: '', label: status };
  }
}

/**
 * Get agent icon
 */
function getAgentIcon(agentName: string): string {
  const iconMap: Record<string, string> = {
    debugger: '🔧',
    executive2: '📋',
    'code-reviewer': '🔍',
    'feature-creator': '✨',
    'code-explorer': '🗺️',
    'test-runner': '🧪',
    default: '🤖',
  };
  return iconMap[agentName] ?? iconMap['default'] ?? '🤖';
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export default function SessionCard({ session, onClick }: SessionCardProps) {
  const statusInfo = getStatusInfo(session.status);
  const agentIcon = getAgentIcon(session.agentName);
  const timeText = formatRelativeTime(session.startedAt);
  const promptPreview = truncate(session.prompt, 100);
  const toolCallCount = session.toolCalls?.length ?? 0;
  const messageCount = session.messages?.length ?? 0;

  return (
    <div 
      className={`session-card status-${statusInfo.className}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="session-card-header">
        <div className="session-agent">
          <span className="agent-icon">{agentIcon}</span>
          <span className="agent-name">@{session.agentName}</span>
        </div>
        <span className={`status-badge ${statusInfo.className}`}>
          {session.status === 'running' && <span className="status-dot pulse" />}
          {statusInfo.label}
        </span>
      </div>

      <div className="session-prompt">{promptPreview}</div>

      <div className="session-card-footer">
        <span className="session-time">{timeText}</span>
        <div className="session-stats">
          {toolCallCount > 0 && (
            <span className="stat-item" title="Tool calls">
              <ToolIcon /> {toolCallCount}
            </span>
          )}
          {messageCount > 0 && (
            <span className="stat-item" title="Messages">
              <MessageIcon /> {messageCount}
            </span>
          )}
        </div>
      </div>

      {session.error && (
        <div className="session-error">
          <ErrorIcon /> {truncate(session.error, 50)}
        </div>
      )}
    </div>
  );
}

function ToolIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
