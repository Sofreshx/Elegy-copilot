import { createStore } from '../lib/store';

export type ThemePreference = 'graphite';

interface ShellPreferencesState {
  sidebarCollapsed: boolean;
  themePreference: ThemePreference;
}

const SIDEBAR_STORAGE_KEY = 'elegy-copilot-sidebar-collapsed';
const THEME_STORAGE_KEY = 'elegy-copilot-theme';

function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

function readThemePreference(): ThemePreference {
  return 'graphite';
}

function createShellPreferencesStore() {
  const store = createStore<ShellPreferencesState>({
    sidebarCollapsed: readSidebarCollapsed(),
    themePreference: readThemePreference(),
  });
  function applyTheme(): void {
    document.documentElement.dataset.theme = store.getState().themePreference;
  }

  function setThemePreference(themePreference: ThemePreference): void {
    try { localStorage.setItem(THEME_STORAGE_KEY, themePreference); } catch { /* best effort */ }
    store.setState((state) => ({ ...state, themePreference }));
    applyTheme();
  }

  function toggleSidebar(): void {
    store.setState((state) => {
      const sidebarCollapsed = !state.sidebarCollapsed;
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed)); } catch { /* best effort */ }
      return { ...state, sidebarCollapsed };
    });
  }

  function startThemeSync(): () => void {
    applyTheme();
    try { localStorage.setItem(THEME_STORAGE_KEY, store.getState().themePreference); } catch { /* best effort */ }
    return () => {};
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    toggleSidebar,
    setThemePreference,
    applyTheme,
    startThemeSync,
  };
}

export const shellPreferencesStore = createShellPreferencesStore();
