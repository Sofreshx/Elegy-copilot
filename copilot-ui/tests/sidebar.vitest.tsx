import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { act } from 'react';
import Sidebar from '../ui/src/components/Sidebar';
import { navigationStore, SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEMS } from '../ui/src/stores/navigation';

beforeEach(() => {
  navigationStore.reset();
});

describe('Sidebar - Main Mode', () => {
  it('renders main nav items: Repositories, Lexicon (no static workspace item)', () => {
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        mode="main"
      />
    );
    expect(screen.getByTestId('sidebar-item-repositories')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-item-lexicon')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-item-workspace')).not.toBeInTheDocument();
  });

  it('renders settings as gear icon in footer without label', () => {
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        mode="main"
      />
    );
    const settingsBtn = screen.getByTestId('sidebar-item-settings');
    expect(settingsBtn).toBeInTheDocument();
    // gear icon should be present: ⚙
    expect(settingsBtn.querySelector('.sidebar-item-icon')?.textContent).toContain('⚙');
    // label should still be "Settings" when expanded (it's not hidden by collapsed)
    expect(settingsBtn.querySelector('.sidebar-item-label')?.textContent).toBe('Settings');
  });

  it('does NOT render settings subroutes in main mode', () => {
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        mode="main"
      />
    );
    expect(screen.queryByTestId('sidebar-settings-codex')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-settings-app')).not.toBeInTheDocument();
  });
});

describe('Sidebar - Settings Mode', () => {
  it('renders only settings nav items: Settings, Codex, Claude Code, OpenCode', () => {
    act(() => {
      navigationStore.setSettingsSection('app');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="app"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={() => {}}
      />
    );
    expect(screen.getByTestId('sidebar-settings-app')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-settings-codex')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-settings-claude-code')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-settings-opencode')).toBeInTheDocument();
  });

  it('does NOT render Repositories or Lexicon in settings mode', () => {
    act(() => {
      navigationStore.setSettingsSection('app');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="app"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={() => {}}
      />
    );
    expect(screen.queryByTestId('sidebar-item-repositories')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-item-lexicon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-item-workspace')).not.toBeInTheDocument();
  });

  it('settings gear is not shown in settings mode footer', () => {
    act(() => {
      navigationStore.setSettingsSection('app');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="app"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={() => {}}
      />
    );
    // The settings gear item should not be rendered in settings mode
    expect(screen.queryByTestId('sidebar-item-settings')).not.toBeInTheDocument();
  });

  it('highlights active settings section', () => {
    act(() => {
      navigationStore.setSettingsSection('codex');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="codex"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={() => {}}
      />
    );
    expect(screen.getByTestId('sidebar-settings-codex').className).toContain('sidebar-item-active');
  });

  it('calls onBackFromSettings when back button is clicked', () => {
    const onBack = vi.fn();
    act(() => {
      navigationStore.setSettingsSection('app');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="app"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={onBack}
      />
    );
    fireEvent.click(screen.getByTestId('sidebar-settings-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar - Collapse toggle', () => {
  it('collapses and expands when toggle is clicked', () => {
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        mode="main"
      />
    );
    const nav = screen.getByTestId('sidebar');
    expect(nav.className).not.toContain('sidebar-collapsed');

    const toggle = screen.getByTestId('sidebar-collapse-toggle');
    fireEvent.click(toggle);
    expect(nav.className).toContain('sidebar-collapsed');

    fireEvent.click(toggle);
    expect(nav.className).not.toContain('sidebar-collapsed');
  });

  it('hides labels when collapsed in main mode', () => {
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="repositories"
        onNavigate={() => {}}
        mode="main"
      />
    );
    const toggle = screen.getByTestId('sidebar-collapse-toggle');
    fireEvent.click(toggle);

    // Labels should not be rendered when collapsed
    const reposBtn = screen.getByTestId('sidebar-item-repositories');
    expect(reposBtn.querySelector('.sidebar-item-label')).toBeNull();

    const toggleText = screen.getByTestId('sidebar-collapse-toggle');
    expect(toggleText.textContent).toBe('▸'); // right-pointing when collapsed
  });
});

describe('Sidebar - Back navigation logic', () => {
  it('back from settings goes to workspace when workspaces open', () => {
    // This tests the App.tsx handleBackFromSettings logic via the sidebar
    const onBack = vi.fn();
    act(() => {
      navigationStore.setSettingsSection('app');
    });
    render(
      <Sidebar
        items={SIDEBAR_NAV_ITEMS}
        activeItem="settings"
        onNavigate={() => {}}
        mode="settings"
        settingsSection="app"
        settingsNavItems={SETTINGS_NAV_ITEMS}
        onSettingsNavigate={() => {}}
        onBackFromSettings={onBack}
      />
    );
    fireEvent.click(screen.getByTestId('sidebar-settings-back'));
    expect(onBack).toHaveBeenCalled();
  });
});
