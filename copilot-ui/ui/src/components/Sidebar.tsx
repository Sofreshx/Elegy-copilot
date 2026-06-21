import React from 'react';
import type { SidebarItemId } from '../stores/navigation';
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
}

export default function Sidebar({ items, activeItem, onNavigate }: SidebarProps) {
  return (
    <nav className="sidebar" data-testid="sidebar">
      <div className="sidebar-nav">
        {items.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item${activeItem === item.id ? ' sidebar-item-active' : ''}`}
            data-testid={`sidebar-item-${item.id}`}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
            title={item.description || item.label}
          >
            <AppIcon name={item.icon} size={20} className="sidebar-item-icon" />
          </button>
        ))}
      </div>
    </nav>
  );
}
