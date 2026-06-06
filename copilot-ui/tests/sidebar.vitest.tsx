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
    // Should have aria-label
    expect(settingsBtn).toHaveAttribute('aria-label', 'Settings');
    // Should NOT have visible text label child
    expect(settingsBtn.querySelector('.sidebar-item-label')).not.toBeInTheDocument();
  });

  it('renders brand icon with alt text', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
      />
    );
    const brandImg = screen.getByAltText('Elegy Copilot');
    expect(brandImg).toBeInTheDocument();
    expect(brandImg.tagName).toBe('IMG');
    expect(brandImg).toHaveClass('sidebar-brand-icon');
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
    expect(screen.getByTestId('sidebar-item-lexicon')).toBeInTheDocument();
  });

  it('renders correctly when collapsed', async () => {
    const { default: Sidebar } = await import('../ui/src/components/Sidebar');
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        isCollapsed
        onToggleCollapse={() => {}}
      />
    );
    // Should still render but with collapsed class
    const nav = screen.getByTestId('sidebar');
    expect(nav.className).toContain('sidebar-collapsed');
    // Settings should still be icon-only in collapsed mode too
    expect(screen.getByTestId('sidebar-item-settings')).toBeInTheDocument();
  });
});
