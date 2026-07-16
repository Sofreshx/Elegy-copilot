import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('shell preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.resetModules();
  });

  it('defaults to an expanded sidebar and Graphite theme', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    expect(shellPreferencesStore.getState()).toMatchObject({
      sidebarCollapsed: false,
      themePreference: 'graphite',
    });
    shellPreferencesStore.applyTheme();
    expect(document.documentElement).toHaveAttribute('data-theme', 'graphite');
  });

  it('persists sidebar collapse and the Graphite theme', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    shellPreferencesStore.toggleSidebar();
    shellPreferencesStore.setThemePreference('graphite');

    expect(shellPreferencesStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem('elegy-copilot-sidebar-collapsed')).toBe('true');
    expect(localStorage.getItem('elegy-copilot-theme')).toBe('graphite');
    expect(document.documentElement).toHaveAttribute('data-theme', 'graphite');
  });

  it('migrates the retired Ember preference to Graphite during startup sync', async () => {
    localStorage.setItem('elegy-copilot-theme', 'ember');
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');

    shellPreferencesStore.startThemeSync();

    expect(shellPreferencesStore.getState().themePreference).toBe('graphite');
    expect(localStorage.getItem('elegy-copilot-theme')).toBe('graphite');
    expect(document.documentElement).toHaveAttribute('data-theme', 'graphite');
  });
});
