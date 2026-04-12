import { useStoreValue } from '../lib/store';
import type { SidebarItemId, SidebarNavItem } from '../stores/navigation';
import { questionBadgeStore } from '../stores/questionBadgeStore';

interface SidebarProps {
  items: readonly SidebarNavItem[];
  activeItem: SidebarItemId;
  onNavigate: (id: SidebarItemId) => void;
  adminMode?: boolean;
  onToggleAdmin?: () => void;
  onNewSession?: () => void;
  testId?: string;
}

export default function Sidebar({
  items,
  activeItem,
  onNavigate,
  adminMode = false,
  onToggleAdmin,
  onNewSession,
  testId = 'sidebar',
}: SidebarProps) {
  const questionBadge = useStoreValue(questionBadgeStore);

  return (
    <nav className="sidebar" data-testid={testId} aria-label="Main navigation">
      <div className="sidebar-header">
        <span className="sidebar-brand">Elegy Copilot</span>
      </div>

      <div className="sidebar-nav">
        {items.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${activeItem === item.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${item.id}`}
            onClick={() => onNavigate(item.id)}
            title={item.description}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
            <span className="sidebar-item-label">{item.label}</span>
            {item.id === 'dashboard' && questionBadge.totalPendingQuestions > 0 && (
              <span className="sidebar-badge sidebar-badge-warning" data-testid="sidebar-question-badge">
                {questionBadge.totalPendingQuestions}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        {onNewSession ? (
          <button
            className="sidebar-action-btn"
            data-testid="sidebar-new-session"
            onClick={onNewSession}
            type="button"
          >
            + New Session
          </button>
        ) : null}
        {onToggleAdmin ? (
          <button
            className={`sidebar-item sidebar-item-admin${adminMode ? ' sidebar-item-active' : ''}`}
            data-testid="sidebar-admin-toggle"
            onClick={onToggleAdmin}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">⚡</span>
            <span className="sidebar-item-label">Admin</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
