import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SIDEBAR_NAV_ITEMS } from '../ui/src/stores/navigation';

describe('sidebar', () => {
  const openWorkspaces = [
    { repoPath: 'C:/repos/instruction-engine', repoLabel: 'instruction-engine', openedAt: 1 },
    { repoPath: 'C:/repos/data-pipeline', repoLabel: 'data-pipeline', openedAt: 2 },
  ];

  function renderSidebar(overrides: Record<string, unknown> = {}) {
    return import('../ui/src/components/Sidebar').then(({ default: Sidebar }) => render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="workspace"
        openWorkspaces={openWorkspaces}
        activeWorkspaceId="C:/repos/instruction-engine"
        collapsed={false}
        onToggleCollapsed={() => {}}
        onNavigate={() => {}}
        onFocusWorkspace={() => {}}
        onCloseWorkspace={() => {}}
        {...overrides}
      />
    ));
  }

  it('renders brand, open workspaces, grouped global tools, and bottom settings', async () => {
    await renderSidebar();

    expect(screen.getByText('Elegy Copilot')).toBeInTheDocument();
    const brandIcon = screen.getByTestId('sidebar-brand-icon');
    expect(brandIcon.tagName).toBe('IMG');
    expect(brandIcon).toHaveAttribute('src', '/elegy-copilot-icon.png');
    expect(screen.getByText('Open workspaces')).toBeInTheDocument();
    expect(screen.getByText('instruction-engine')).toBeInTheDocument();
    expect(screen.getByText('data-pipeline')).toBeInTheDocument();
    expect(screen.getByText('Global tools')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-repositories')).toHaveTextContent('Repositories');
    expect(screen.getByTestId('sidebar-item-pattern-atlas')).toHaveTextContent('Pattern Atlas');
    expect(screen.getByTestId('sidebar-item-settings')).toHaveTextContent('Settings');
    expect(screen.getByTestId('sidebar-item-settings').closest('.sidebar-footer')).not.toBeNull();
  });

  it('focuses and closes workspaces through explicit controls', async () => {
    const onFocusWorkspace = vi.fn();
    const onCloseWorkspace = vi.fn();
    await renderSidebar({ onFocusWorkspace, onCloseWorkspace });

    fireEvent.click(screen.getByTestId('sidebar-workspace-instruction-engine'));
    expect(onFocusWorkspace).toHaveBeenCalledWith('C:/repos/instruction-engine');

    fireEvent.click(screen.getByRole('button', { name: 'Close data-pipeline' }));
    expect(onCloseWorkspace).toHaveBeenCalledWith('C:/repos/data-pipeline');
  });

  it('renders expanded by default and exposes a collapse toggle', async () => {
    const onToggleCollapsed = vi.fn();
    await renderSidebar({ onToggleCollapsed });

    const nav = screen.getByTestId('sidebar');
    expect(nav).toHaveAttribute('data-collapsed', 'false');
    const toggle = screen.getByTestId('sidebar-collapse-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Collapse sidebar');
    fireEvent.click(toggle);
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('keeps controls accessible when collapsed', async () => {
    await renderSidebar({ collapsed: true });
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByTestId('sidebar-collapse-toggle')).toHaveAttribute('aria-label', 'Expand sidebar');
    expect(screen.getByTestId('sidebar-item-settings')).toHaveAttribute('aria-label', 'Settings');
    expect(screen.getByTestId('sidebar-workspace-instruction-engine')).toHaveAttribute('aria-label', 'Open instruction-engine');
  });

  it('renders settings with aria-label and local icon', async () => {
    await renderSidebar();
    const settingsBtn = screen.getByTestId('sidebar-item-settings');
    expect(settingsBtn).toBeInTheDocument();
    expect(settingsBtn).toHaveAttribute('aria-label', 'Settings');
    // Icon is now an SVG element (AppIcon), not a Unicode text node
    const iconEl = settingsBtn.querySelector('.sidebar-item-icon');
    expect(iconEl).toBeInTheDocument();
    expect(iconEl?.tagName).toBe('svg');
  });

  it('each nav item has aria-label and title attributes', async () => {
    await renderSidebar();
    const atlasBtn = screen.getByTestId('sidebar-item-pattern-atlas');
    expect(atlasBtn).toHaveAttribute('aria-label', 'Pattern Atlas');
    expect(atlasBtn).toHaveAttribute('title');
    expect(atlasBtn.querySelector('.sidebar-item-icon')).toBeInTheDocument();
  });

  it('renders active item with sidebar-item-active class', async () => {
    await renderSidebar({ activeItem: 'repositories' });
    const activeBtn = screen.getByTestId('sidebar-item-repositories');
    expect(activeBtn.className).toContain('sidebar-item-active');
  });
});
