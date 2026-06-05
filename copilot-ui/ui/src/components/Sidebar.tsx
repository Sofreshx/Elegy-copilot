import type { SidebarItemId, SidebarNavItem } from '../stores/navigation';

const BRAND_ICON_SRC = '/elegy-copilot-icon.svg';

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
  const topItems = items.filter((item) => item.id !== 'settings');
  const settingsItem = items.find((item) => item.id === 'settings');

  return (
    <nav className="sidebar" data-testid={testId} aria-label="Main navigation">
      <div className="sidebar-header">
        <div className="sidebar-brand-lockup">
          <img
            alt=""
            aria-hidden="true"
            className="sidebar-brand-icon"
            src={BRAND_ICON_SRC}
          />
          <span className="sidebar-brand">Elegy Copilot</span>
        </div>
      </div>

      <div className="sidebar-nav">
        {topItems.map((item) => (
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
          </button>
        ))}
      </div>

      {settingsItem ? (
        <div className="sidebar-footer">
          <button
            className={`sidebar-item${activeItem === settingsItem.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${settingsItem.id}`}
            onClick={() => onNavigate(settingsItem.id)}
            title={settingsItem.description}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">{settingsItem.icon}</span>
            <span className="sidebar-item-label">{settingsItem.label}</span>
          </button>
        </div>
      ) : null}
    </nav>
  );
}
