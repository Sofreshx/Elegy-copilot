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
          </button>
        ))}
      </div>
    </nav>
  );
}
