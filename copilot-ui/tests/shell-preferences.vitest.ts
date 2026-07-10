import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('shell preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.resetModules();
  });

  it('defaults to an expanded sidebar and system theme', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    expect(shellPreferencesStore.getState()).toMatchObject({
      sidebarCollapsed: false,
      themePreference: 'system',
    });
  });

  it('persists sidebar collapse and theme preference', async () => {
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    shellPreferencesStore.toggleSidebar();
    shellPreferencesStore.setThemePreference('light');

    expect(shellPreferencesStore.getState().sidebarCollapsed).toBe(true);
    expect(localStorage.getItem('elegy-copilot-sidebar-collapsed')).toBe('true');
    expect(localStorage.getItem('elegy-copilot-theme')).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('resolves system theme from the OS preference', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { shellPreferencesStore } = await import('../ui/src/stores/shellPreferences');
    shellPreferencesStore.applyTheme();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
