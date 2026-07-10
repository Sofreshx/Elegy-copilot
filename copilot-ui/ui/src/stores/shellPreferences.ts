import { createStore } from '../lib/store';

export type ThemePreference = 'system' | 'light' | 'dark';

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
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function createShellPreferencesStore() {
  const store = createStore<ShellPreferencesState>({
    sidebarCollapsed: readSidebarCollapsed(),
    themePreference: readThemePreference(),
  });
  let mediaQuery: MediaQueryList | null = null;

  function applyTheme(): void {
    document.documentElement.dataset.theme = resolveTheme(store.getState().themePreference);
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
    if (typeof matchMedia !== 'function') return () => {};
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (store.getState().themePreference === 'system') applyTheme();
    };
    mediaQuery.addEventListener?.('change', handleChange);
    return () => mediaQuery?.removeEventListener?.('change', handleChange);
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

