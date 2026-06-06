import { useState } from 'react';
import type { OpenWorkspace, SidebarItemId, SidebarNavItem, SettingsSection, SettingsNavItem } from '../stores/navigation';

const BRAND_ICON_SRC = '/elegy-copilot-icon.svg';

interface SidebarProps {
  items: readonly SidebarNavItem[];
  activeItem: SidebarItemId;
  onNavigate: (id: SidebarItemId) => void;
  openWorkspaces?: OpenWorkspace[];
  activeWorkspaceId?: string | null;
  onFocusWorkspace?: (repoPath: string) => void;
  onCloseWorkspace?: (repoPath: string) => void;
  mode?: 'main' | 'settings';
  settingsSection?: SettingsSection;
  settingsNavItems?: readonly SettingsNavItem[];
  onSettingsNavigate?: (section: SettingsSection) => void;
  onBackFromSettings?: () => void;
  onCollapseChange?: (collapsed: boolean) => void;
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
  mode = 'main',
  settingsSection,
  settingsNavItems,
  onSettingsNavigate,
  onBackFromSettings,
  onCollapseChange,
  testId = 'sidebar',
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isSettingsMode = mode === 'settings';

  const topItems = items.filter((item) => item.id !== 'settings');
  const settingsItem = items.find((item) => item.id === 'settings');

  function renderMainMode() {
    return (
      <>
        {openWorkspaces.length > 0 && (
          <div className="sidebar-workspace-tabs" data-testid="sidebar-workspace-tabs">
            {openWorkspaces.map((ws) => (
              <button
                key={ws.repoPath}
                className={`sidebar-workspace-tab${activeWorkspaceId === ws.repoPath ? ' sidebar-workspace-tab-active' : ''}`}
                data-testid={`sidebar-workspace-tab-${ws.repoPath}`}
                title={ws.repoLabel}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusWorkspace?.(ws.repoPath);
                }}
              >
                {collapsed ? (
                  <span className="sidebar-workspace-tab-dot" />
                ) : (
                  <>
                    <span className="sidebar-workspace-tab-label">{ws.repoLabel}</span>
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
                  </>
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
              title={!collapsed ? item.description : item.label}
              type="button"
            >
              <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
            </button>
          ))}
        </div>

        {settingsItem && (
          <div className="sidebar-footer">
            <button
              className={`sidebar-item${activeItem === settingsItem.id ? ' sidebar-item-active' : ''}`}
              data-testid={`sidebar-item-${settingsItem.id}`}
              onClick={() => onNavigate(settingsItem.id)}
              title={!collapsed ? settingsItem.description : settingsItem.label}
              type="button"
            >
              <span className="sidebar-item-icon" aria-hidden="true">⚙</span>
              {!collapsed && <span className="sidebar-item-label">{settingsItem.label}</span>}
            </button>
          </div>
        )}
      </>
    );
  }

  function renderSettingsMode() {
    return (
      <div className="sidebar-nav">
        {settingsNavItems?.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${settingsSection === item.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-settings-${item.id}`}
            onClick={() => onSettingsNavigate?.(item.id)}
            title={item.label}
            type="button"
          >
            <span className="sidebar-item-icon" aria-hidden="true">{item.icon}</span>
            {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
          </button>
        ))}
      </div>
    );
  }

  return (
    <nav
      className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}`}
      data-testid={testId}
      aria-label={isSettingsMode ? 'Settings navigation' : 'Main navigation'}
    >
      <div className="sidebar-header">
        {isSettingsMode ? (
          <>
            <img
              alt=""
              aria-hidden="true"
              className="sidebar-brand-icon"
              src={BRAND_ICON_SRC}
            />
            {!collapsed && (
              <button
                className="sidebar-back-btn"
                data-testid="sidebar-settings-back"
                onClick={onBackFromSettings}
                type="button"
                title="Back"
              >
                ← Back
              </button>
            )}
          </>
        ) : (
          <img
            alt=""
            aria-hidden="true"
            className="sidebar-brand-icon"
            src={BRAND_ICON_SRC}
          />
        )}
      </div>

      {isSettingsMode ? renderSettingsMode() : renderMainMode()}

      <div className="sidebar-footer-collapse">
        <button
          className="sidebar-collapse-toggle"
          data-testid="sidebar-collapse-toggle"
          onClick={() => { setCollapsed((c) => { const next = !c; onCollapseChange?.(next); return next; }); }}
          type="button"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </div>
    </nav>
  );
}
