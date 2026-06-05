import { createStore } from '../lib/store';

export const CATALOG_SECTION_IDS = [
  'status',
  'global',
  'repository',
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

export const SIDEBAR_IDS = [
  'workspace',
  'lexicon',
  'repositories',
  'settings',
] as const;

export type SidebarItemId = (typeof SIDEBAR_IDS)[number];

export type ProjectSubView = 'overview' | 'sessions' | 'tasks' | 'git' | 'config';
export type SessionDetailTab = 'activity' | 'tasks' | 'artifacts' | 'config' | 'git' | 'usage';
export type MaintenanceSection = 'updates' | 'sandboxes' | 'diagnostics';
export type WizardType = 'project' | 'asset' | null;

export type SettingsSection = 'app' | 'catalog' | 'opencode' | 'maintenance' | 'runtime' | 'codex';

export type WorkspaceCenterMode = 'docs' | 'planning-session' | 'terminal';

export interface OpenWorkspace {
  repoPath: string;
  repoLabel: string;
  openedAt: number;
}

export const WORKSPACE_TABS_STORAGE_KEY = 'elegy-copilot-workspace-tabs';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'elegy-copilot-active-workspace';

export interface SelectedSessionContext {
  source?: string | null;
  sandbox?: string | null;
}

export type SidebarNavItem = {
  id: SidebarItemId;
  label: string;
  icon: string;
  description: string;
};

export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItem[] = [
  { id: 'workspace', label: 'Workspace', icon: '⎔', description: 'Document-centric repository workspace with docs, planning, and git operations' },
  { id: 'lexicon', label: 'Lexicon', icon: '◈', description: 'Searchable vocabulary reference for UI, design, architecture, and software engineering terms' },
  { id: 'repositories', label: 'Repositories', icon: '␀', description: 'Manage registered repositories and sources' },
  { id: 'settings', label: 'Settings', icon: '☰', description: 'App configuration and preferences' },
];

export type NavigationState = {
  catalogSectionId: CatalogSectionId;
  activeSidebarItem: SidebarItemId;
  selectedProjectId: string | null;
  projectSubView: ProjectSubView;
  selectedSessionId: string | null;
  selectedSessionContext: SelectedSessionContext | null;
  sessionDetailTab: SessionDetailTab;
  maintenanceSection: MaintenanceSection;
  wizardOpen: WizardType;
  settingsSection: SettingsSection;
  workspaceCenterMode: WorkspaceCenterMode;
  activePlanningSessionId: string | null;
  activePlanningSessionContext: SelectedSessionContext | null;
  openWorkspaces: OpenWorkspace[];
  activeWorkspaceId: string | null;
};

const INITIAL_STATE: NavigationState = {
  catalogSectionId: 'global',
  activeSidebarItem: 'workspace',
  selectedProjectId: null,
  projectSubView: 'overview',
  selectedSessionId: null,
  selectedSessionContext: null,
  sessionDetailTab: 'activity',
  maintenanceSection: 'updates',
  wizardOpen: null,
  settingsSection: 'app',
  workspaceCenterMode: 'docs',
  activePlanningSessionId: null,
  activePlanningSessionContext: null,
  openWorkspaces: [],
  activeWorkspaceId: null,
};

function createNavigationStore() {
  const persistedTabs = loadPersistedWorkspaceTabs();
  const persistedActiveId = loadPersistedActiveWorkspaceId();
  const initialState = {
    ...INITIAL_STATE,
    openWorkspaces: persistedTabs,
    activeWorkspaceId: persistedActiveId || (persistedTabs.length > 0 ? persistedTabs[0].repoPath : null),
  };
  const store = createStore<NavigationState>(initialState);

  function setCatalogSectionId(catalogSectionId: CatalogSectionId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: 'catalog',
      catalogSectionId,
    }));
  }

  function navigate(sidebarItem: SidebarItemId): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: sidebarItem,
      selectedSessionId: null,
      selectedSessionContext: null,
      wizardOpen: null,
      workspaceCenterMode: 'docs',
    }));
  }

  function selectProject(projectId: string | null, subView: ProjectSubView = 'overview'): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'workspace',
      selectedProjectId: projectId,
      projectSubView: subView,
    }));
  }

  function selectSession(
    sessionId: string | null,
    tab: SessionDetailTab = 'activity',
    context: SelectedSessionContext | null = null,
  ): void {
    store.setState((state) => ({
      ...state,
      selectedSessionId: sessionId,
      selectedSessionContext: sessionId ? context : null,
      sessionDetailTab: tab,
    }));
  }

  function setMaintenanceSection(section: MaintenanceSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: 'maintenance',
      maintenanceSection: section,
    }));
  }

  function openWizard(wizard: WizardType): void {
    store.setState((state) => ({
      ...state,
      wizardOpen: wizard,
    }));
  }

  function closeWizard(): void {
    store.setState((state) => ({
      ...state,
      wizardOpen: null,
    }));
  }

  function setSettingsSection(section: SettingsSection): void {
    store.setState((state) => ({
      ...state,
      activeSidebarItem: 'settings',
      settingsSection: section,
    }));
  }

  function setWorkspaceCenterMode(mode: WorkspaceCenterMode): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: mode,
    }));
  }

  function openPlanningSession(sessionId: string, context: SelectedSessionContext | null = null): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'planning-session',
      activePlanningSessionId: sessionId,
      activePlanningSessionContext: context,
    }));
  }

  function closePlanningSession(): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'docs',
      activePlanningSessionId: null,
      activePlanningSessionContext: null,
    }));
  }

  function openWorkspace(repoPath: string, repoLabel: string): void {
    const existing = store.getState().openWorkspaces.find((w) => w.repoPath === repoPath);
    if (existing) {
      persistActiveWorkspaceId(repoPath);
      store.setState((state) => ({ ...state, activeWorkspaceId: repoPath, activeSidebarItem: 'workspace' as const }));
      return;
    }
    store.setState((state) => {
      const newWorkspace: OpenWorkspace = {
        repoPath,
        repoLabel,
        openedAt: Date.now(),
      };
      const openWorkspaces = [...state.openWorkspaces, newWorkspace];
      persistWorkspaceTabs(openWorkspaces);
      persistActiveWorkspaceId(repoPath);
      return { ...state, openWorkspaces, activeWorkspaceId: repoPath, activeSidebarItem: 'workspace' as const };
    });
  }

  function focusWorkspace(repoPath: string): void {
    persistActiveWorkspaceId(repoPath);
    store.setState((state) => ({
      ...state,
      activeWorkspaceId: repoPath,
      activeSidebarItem: 'workspace' as const,
    }));
  }

  function closeWorkspace(repoPath: string): void {
    store.setState((state) => {
      const openWorkspaces = state.openWorkspaces.filter((w) => w.repoPath !== repoPath);
      persistWorkspaceTabs(openWorkspaces);
      const nextActiveId = state.activeWorkspaceId === repoPath
        ? (openWorkspaces.length > 0 ? openWorkspaces[openWorkspaces.length - 1].repoPath : null)
        : state.activeWorkspaceId;
      persistActiveWorkspaceId(nextActiveId);
      return { ...state, openWorkspaces, activeWorkspaceId: nextActiveId };
    });
  }

  function persistWorkspaceTabs(tabs: OpenWorkspace[]): void {
    try {
      localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // localStorage may be unavailable (private browsing, quota)
    }
  }

  function persistActiveWorkspaceId(repoPath: string | null): void {
    try {
      if (repoPath) {
        localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, repoPath);
      } else {
        localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
      }
    } catch {
      // localStorage may be unavailable
    }
  }

  function loadPersistedWorkspaceTabs(): OpenWorkspace[] {
    try {
      const raw = localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item: unknown) =>
          item && typeof item === 'object' &&
          typeof (item as OpenWorkspace).repoPath === 'string' &&
          typeof (item as OpenWorkspace).repoLabel === 'string',
      );
    } catch {
      return [];
    }
  }

  function loadPersistedActiveWorkspaceId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  function reset(): void {
    try {
      localStorage.removeItem(WORKSPACE_TABS_STORAGE_KEY);
      localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    } catch {
      // best-effort cleanup
    }
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setCatalogSectionId,
    navigate,
    selectProject,
    selectSession,
    setMaintenanceSection,
    openWizard,
    closeWizard,
    setSettingsSection,
    setWorkspaceCenterMode,
    openPlanningSession,
    closePlanningSession,
    openWorkspace,
    focusWorkspace,
    closeWorkspace,
    reset,
  };
}

export const navigationStore = createNavigationStore();
