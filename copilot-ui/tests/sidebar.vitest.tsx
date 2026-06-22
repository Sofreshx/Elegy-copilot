import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_NAV_ITEMS } from '../ui/src/stores/navigation';

describe('sidebar', () => {
  it('renders settings as icon-only with aria-label', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    const settingsBtn = screen.getByTestId('sidebar-item-settings');
    expect(settingsBtn).toBeInTheDocument();
    expect(settingsBtn).toHaveAttribute('aria-label', 'Settings');
    // Icon is now an SVG element (AppIcon), not a Unicode text node
    const iconEl = settingsBtn.querySelector('.sidebar-item-icon');
    expect(iconEl).toBeInTheDocument();
    expect(iconEl?.tagName).toBe('svg');
  });

  it('does not render brand icon', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByAltText('Elegy Copilot')).not.toBeInTheDocument();
  });

  it('renders nav items for non-settings routes', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    expect(screen.getByTestId('sidebar-item-repositories')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-pattern-atlas')).toBeInTheDocument();
  });

  it('is always visible as fixed-width icon rail without collapse', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    const nav = screen.getByTestId('sidebar');
    expect(nav).toHaveClass('sidebar');
    expect(nav.className).not.toContain('sidebar-collapsed');
    // No collapse toggle in new design
    expect(screen.queryByTestId('sidebar-collapse-toggle')).not.toBeInTheDocument();
    // Settings should still be rendered
    expect(screen.getByTestId('sidebar-item-settings')).toBeInTheDocument();
  });

  it('each nav item has aria-label and title attributes', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    const lexiconBtn = screen.getByTestId('sidebar-item-pattern-atlas');
    expect(lexiconBtn).toHaveAttribute('aria-label', 'Pattern Atlas');
    expect(lexiconBtn).toHaveAttribute('title');
    expect(lexiconBtn.querySelector('.sidebar-item-icon')).toBeInTheDocument();
  });

  it('renders active item with sidebar-item-active class', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    const activeBtn = screen.getByTestId('sidebar-item-repositories');
    expect(activeBtn.className).toContain('sidebar-item-active');
  });
});
