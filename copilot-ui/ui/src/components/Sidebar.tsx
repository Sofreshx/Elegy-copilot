import React from 'react';
import type { OpenWorkspace, SidebarItemId } from '../stores/navigation';
import type { AppIconName } from './AppIcon';
import AppIcon from './AppIcon';

export interface SidebarItem {
  id: SidebarItemId;
  icon: AppIconName;
  label: string;
  description?: string;
}

interface SidebarProps {
  items: readonly SidebarItem[];
  activeItem: SidebarItemId | null;
  onNavigate: (id: SidebarItemId) => void;
  openWorkspaces: OpenWorkspace[];
  activeWorkspaceId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onFocusWorkspace: (repoPath: string) => void;
  onCloseWorkspace: (repoPath: string) => void;
}

function workspaceTestId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function Sidebar({
  items,
  activeItem,
  onNavigate,
  openWorkspaces,
  activeWorkspaceId,
  collapsed,
  onToggleCollapsed,
  onFocusWorkspace,
  onCloseWorkspace,
}: SidebarProps) {
  const settingsItem = items.find((item) => item.id === 'settings');
  const globalItems = items.filter((item) => item.id !== 'settings');

  const renderNavItem = (item: SidebarItem) => (
    <button
      key={item.id}
      className={`sidebar-item${activeItem === item.id ? ' sidebar-item-active' : ''}`}
      data-testid={`sidebar-item-${item.id}`}
      onClick={() => onNavigate(item.id)}
      aria-label={item.label}
      title={item.description || item.label}
    >
      <AppIcon name={item.icon} size={18} className="sidebar-item-icon" />
      <span className="sidebar-item-label">{item.label}</span>
    </button>
  );

  return (
    <nav className="sidebar" data-testid="sidebar" data-collapsed={String(collapsed)}>
      <div className="sidebar-brand-row">
        <AppIcon name="diamond" size={22} className="sidebar-brand-icon" />
        <span className="sidebar-brand-label">Elegy Copilot</span>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          data-testid="sidebar-collapse-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          onClick={onToggleCollapsed}
        >
          <AppIcon name={collapsed ? 'chevron-right' : 'chevron-left'} size={16} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <section className="sidebar-section" aria-labelledby="sidebar-workspaces-heading">
          <h2 id="sidebar-workspaces-heading" className="sidebar-section-label">Open workspaces</h2>
          <ul className="sidebar-workspace-list">
            {openWorkspaces.map((workspace) => {
              const active = workspace.repoPath === activeWorkspaceId;
              return (
                <li key={workspace.repoPath} className="sidebar-workspace-row">
                  <button
                    type="button"
                    className={`sidebar-workspace-button${active ? ' sidebar-workspace-button-active' : ''}`}
                    data-testid={`sidebar-workspace-${workspaceTestId(workspace.repoLabel)}`}
                    aria-label={`Open ${workspace.repoLabel}`}
                    aria-current={active ? 'page' : undefined}
                    title={workspace.repoPath}
                    onClick={() => onFocusWorkspace(workspace.repoPath)}
                  >
                    <AppIcon name="folder" size={16} />
                    <span>{workspace.repoLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-workspace-close"
                    aria-label={`Close ${workspace.repoLabel}`}
                    onClick={() => onCloseWorkspace(workspace.repoPath)}
                  >
                    <AppIcon name="close" size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="sidebar-section" aria-labelledby="sidebar-global-heading">
          <h2 id="sidebar-global-heading" className="sidebar-section-label">Global tools</h2>
          <div className="sidebar-nav">{globalItems.map(renderNavItem)}</div>
        </section>
      </div>

      <div className="sidebar-footer">
        {settingsItem ? renderNavItem(settingsItem) : null}
      </div>
    </nav>
  );
}
