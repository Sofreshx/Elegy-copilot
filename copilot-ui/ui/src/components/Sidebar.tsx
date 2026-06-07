import AppIcon from './AppIcon';
import { useStoreValue } from '../lib/store';
import { navigationStore, type SidebarItemId, type SidebarNavItem } from '../stores/navigation';

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
  const topItems = items.filter((item) => item.id !== 'settings');
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

      <div className="sidebar-footer">
        {settingsItem && (
          <button
            className={`sidebar-item${activeItem === settingsItem.id ? ' sidebar-item-active' : ''}`}
            data-testid="sidebar-item-settings"
            aria-label={settingsItem.label}
            title={settingsItem.description}
            onClick={() => onNavigate(settingsItem.id)}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">⚙</span>
          </button>
        )}
      </div>
    </nav>
  );
}
