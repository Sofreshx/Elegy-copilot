import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('shell preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.resetModules();
  });

  it('defaults to an expanded sidebar and Ember theme', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    expect(shellPreferencesStore.getState()).toMatchObject({
      sidebarCollapsed: false,
      themePreference: 'ember',
    });
    shellPreferencesStore.applyTheme();
    expect(document.documentElement).toHaveAttribute('data-theme', 'ember');
  });

  it('persists sidebar collapse and the Ember theme', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    shellPreferencesStore.toggleSidebar();
    shellPreferencesStore.setThemePreference('ember');

    expect(shellPreferencesStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem('elegy-copilot-sidebar-collapsed')).toBe('true');
    expect(localStorage.getItem('elegy-copilot-theme')).toBe('ember');
    expect(document.documentElement).toHaveAttribute('data-theme', 'ember');
  });
});
