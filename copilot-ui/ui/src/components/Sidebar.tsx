import type { OpenWorkspace, SidebarItemId, SidebarNavItem } from '../stores/navigation';

const BRAND_ICON_SRC = '/elegy-copilot-icon.svg';

interface SidebarProps {
  items: readonly SidebarNavItem[];
  activeItem: SidebarItemId;
  onNavigate: (id: SidebarItemId) => void;
  openWorkspaces?: OpenWorkspace[];
  activeWorkspaceId?: string | null;
  onFocusWorkspace?: (repoPath: string) => void;
  onCloseWorkspace?: (repoPath: string) => void;
  testId?: string;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  items,
  activeItem,
  onNavigate,
  openWorkspaces = [],
  activeWorkspaceId = null,
  onFocusWorkspace,
  onCloseWorkspace,
  testId = 'sidebar',
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const topItems = items.filter((item) => item.id !== 'settings');
  const settingsItem = items.find((item) => item.id === 'settings');

  return (
    <nav
      className={`sidebar${isCollapsed ? ' sidebar-collapsed' : ''}`}
      data-testid={testId}
      aria-label="Main navigation"
    >
      <div className="sidebar-header">
        <div className="sidebar-brand-lockup">
          <img
            alt="Elegy Copilot"
            className="sidebar-brand-icon"
            src={BRAND_ICON_SRC}
            onError={(e) => {
              const img = e.currentTarget;
              img.style.display = 'none';
            }}
          />
          {!isCollapsed && <span className="sidebar-brand">Elegy Copilot</span>}
        </div>
      </div>

      {openWorkspaces.length > 0 && (
        <div className="sidebar-workspace-tabs" data-testid="sidebar-workspace-tabs">
          {openWorkspaces.map((ws) => (
            <button
              key={ws.repoPath}
              className={`sidebar-workspace-tab${activeWorkspaceId === ws.repoPath ? ' sidebar-workspace-tab-active' : ''}`}
              data-testid={`sidebar-workspace-tab-${ws.repoPath}`}
              title={isCollapsed ? ws.repoLabel : undefined}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFocusWorkspace?.(ws.repoPath);
              }}
            >
              {isCollapsed ? (
                <span className="sidebar-workspace-tab-dot" />
              ) : (
                <span className="sidebar-workspace-tab-label">{ws.repoLabel}</span>
              )}
              {!isCollapsed && (
                <span
                  className="sidebar-workspace-tab-close"
                  data-testid={`sidebar-workspace-tab-close-${ws.repoPath}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onCloseWorkspace?.(ws.repoPath); } }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWorkspace?.(ws.repoPath);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-nav">
        {topItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${activeItem === item.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${item.id}`}
            onClick={() => onNavigate(item.id)}
            title={isCollapsed ? item.label : item.description}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
            {!isCollapsed && <span className="sidebar-item-label">{item.label}</span>}
          </button>
        ))}
      </div>

      {settingsItem ? (
        <div className="sidebar-footer">
          <button
            className={`sidebar-item${activeItem === settingsItem.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${settingsItem.id}`}
            aria-label={settingsItem.label}
            onClick={() => onNavigate(settingsItem.id)}
            title={settingsItem.description}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">{settingsItem.icon}</span>
          </button>
          {onToggleCollapse && (
            <button
              className="sidebar-collapse-toggle"
              data-testid="sidebar-collapse-toggle"
              onClick={onToggleCollapse}
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              type="button"
              aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? '▶' : '◀'}
            </button>
          )}
        </div>
      ) : onToggleCollapse ? (
        <div className="sidebar-footer">
          <button
            className="sidebar-collapse-toggle"
            data-testid="sidebar-collapse-toggle"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            type="button"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? '▶' : '◀'}
          </button>
        </div>
      ) : null}
    </nav>
  );
}
