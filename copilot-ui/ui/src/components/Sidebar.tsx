import { useStoreValue } from '../lib/store';
import { navigationStore, type SidebarItemId, type SidebarNavItem } from '../stores/navigation';
import AppIcon from './AppIcon';

interface SidebarProps {
  items: readonly SidebarNavItem[];
  activeItem: SidebarItemId;
  onNavigate: (id: SidebarItemId) => void;
  testId?: string;
}

export default function Sidebar({
  items,
  activeItem,
  onNavigate,
  testId = 'sidebar',
}: SidebarProps) {
  const store = useStoreValue(navigationStore);
  const topItems = items.filter((item) => item.id !== 'settings' && item.id !== 'workspace');
  const settingsItem = items.find((item) => item.id === 'settings');
  const openWorkspaces = store.openWorkspaces;
  const activeWorkspaceId = store.activeWorkspaceId;

  return (
    <nav
      className="sidebar"
      data-testid={testId}
      aria-label="Main navigation"
    >
      <div className="sidebar-nav">
        {topItems.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${activeItem === item.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${item.id}`}
            aria-label={item.label}
            title={item.description}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <AppIcon name={item.icon} size={20} className="sidebar-item-icon" />
          </button>
        ))}
      </div>

      {/* Open workspace list with text labels */}
      {openWorkspaces.length > 0 && (
        <div className="sidebar-workspaces" data-testid="sidebar-workspaces">
          {openWorkspaces.map((ws) => (
            <button
              key={ws.repoPath}
              className={`sidebar-workspace-item${activeWorkspaceId === ws.repoPath && activeItem === 'workspace' ? ' sidebar-workspace-item-active' : ''}`}
              data-testid={`sidebar-workspace-${ws.repoPath.replace(/[^a-zA-Z0-9]/g, '-')}`}
              title={ws.repoPath}
              onClick={() => navigationStore.focusWorkspace(ws.repoPath)}
              type="button"
            >
              <span className="sidebar-workspace-label">{ws.repoLabel}</span>
            </button>
          ))}
        </div>
      )}

      {settingsItem && (
        <button
          className={`sidebar-item${activeItem === settingsItem.id ? ' sidebar-item-active' : ''}`}
          data-testid="sidebar-item-settings"
          aria-label={settingsItem.label}
          title={settingsItem.description}
          onClick={() => onNavigate(settingsItem.id)}
          type="button"
        >
          <AppIcon name="settings" size={20} className="sidebar-item-icon" />
        </button>
      )}
    </nav>
  );
}
