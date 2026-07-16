import { createStore } from '../lib/store';
import type { AppIconName } from '../components/AppIcon';

export const CATALOG_SECTION_IDS = [
  'status',
  'global',
  'repository',
] as const;

export type CatalogSectionId = (typeof CATALOG_SECTION_IDS)[number];

export const SIDEBAR_IDS = [
  'workspace',
  'remote',
  'mcp',
  'repositories',
  'notes',
  'settings',
] as const;

export type SidebarItemId = (typeof SIDEBAR_IDS)[number];

export type ProjectSubView = 'overview' | 'sessions' | 'tasks' | 'git' | 'config';
export type SessionDetailTab = 'activity' | 'tasks' | 'artifacts' | 'config' | 'git' | 'usage';
export type MaintenanceSection = 'updates' | 'diagnostics' | 'assets';
export type WizardType = 'project' | 'asset' | null;

export type SettingsSection = 'app' | 'catalog' | 'opencode' | 'telemetry' | 'maintenance' | 'runtime' | 'codex' | 'claude-code' | 'github' | 'shell' | 'notes';

export interface SettingsNavItem {
  id: SettingsSection;
  label: string;
  icon: string;
  description: string;
}

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: 'app', label: 'App Settings', icon: 'settings', description: 'Keyboard shortcuts and application information.' },
  { id: 'catalog', label: 'Assets & Tools', icon: 'layout', description: 'Manage shared skills, agents, prompts, and instructions.' },
  { id: 'opencode', label: 'OpenCode', icon: 'opencode', description: 'OpenCode readiness, provider routing, and active warnings.' },
  { id: 'telemetry', label: 'Telemetry', icon: 'runtime', description: 'Session and event telemetry collected by the dashboard.' },
  { id: 'maintenance', label: 'Maintenance', icon: 'maintenance', description: 'Updates and diagnostics for the desktop runtime.' },
  { id: 'runtime', label: 'Runtime', icon: 'play', description: 'Live runtime health and harness session status.' },
  { id: 'codex', label: 'Codex', icon: 'codex', description: 'Switch local Codex between OpenAI defaults and DeepSeek via Moon Bridge.' },
  { id: 'claude-code', label: 'Claude Code', icon: 'claude-code', description: 'Claude Code installation and configuration.' },
  { id: 'github', label: 'GitHub CLI', icon: 'git-branch', description: 'GitHub authentication and CLI status.' },
  { id: 'shell', label: 'Shell', icon: 'play', description: 'Default shell and terminal environment used by sessions.' },
  { id: 'notes', label: 'Notes', icon: 'file-text', description: 'Workspace notes and scratch settings.' },
];

export interface SettingsNavGroup {
  id: string;
  label: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'app')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'telemetry')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'runtime')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'maintenance')!,
    ],
  },
  {
    id: 'providers',
    label: 'AI Providers',
    items: [
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'catalog')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'opencode')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'codex')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'claude-code')!,
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'github')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'shell')!,
      SETTINGS_NAV_ITEMS.find((i) => i.id === 'notes')!,
    ],
  },
];

export type WorkspaceCenterMode = 'docs' | 'planning-session' | 'terminal' | 'docs-graph';

export type WorkspaceLocalTab = 'docs' | 'git' | 'planning' | 'execution' | 'assets' | 'checks' | 'health';

export interface OpenWorkspace {
  repoPath: string;
  repoLabel: string;
  openedAt: number;
}

function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export const WORKSPACE_TABS_STORAGE_KEY = 'elegy-copilot-workspace-tabs';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'elegy-copilot-active-workspace';
export const WORKSPACE_CENTER_FOCUS_KEY = 'elegy-copilot-workspace-center-focused';

export interface SelectedSessionContext {
  source?: string | null;
  sandbox?: string | null;
}

export type SidebarNavItem = {
  id: SidebarItemId;
  label: string;
  icon: AppIconName;
  description: string;
};

export const SIDEBAR_NAV_ITEMS: readonly SidebarNavItem[] = [
  { id: 'repositories', label: 'Repositories', icon: 'repo', description: 'Browse and open registered repositories' },
  { id: 'notes', label: 'Notes', icon: 'file-text', description: 'Read, write, import, export, and sync workspace notes' },
  { id: 'remote', label: 'Remote', icon: 'hexagon', description: 'Manage Discord-driven remote sessions via Kimaki' },
  { id: 'mcp', label: 'MCP', icon: 'mcp', description: 'Expose selected local MCP servers to web chatbots' },
  { id: 'settings', label: 'Settings', icon: 'settings', description: 'App configuration and preferences' },
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
  activeWorkspaceLocalTab: WorkspaceLocalTab;
  isWorkspaceCenterFocused: boolean;
  activePlanningSessionId: string | null;
  activePlanningSessionContext: SelectedSessionContext | null;
  openWorkspaces: OpenWorkspace[];
  activeWorkspaceId: string | null;
};

const INITIAL_STATE: NavigationState = {
  catalogSectionId: 'global',
  activeSidebarItem: 'repositories',
  selectedProjectId: null,
  projectSubView: 'overview',
  selectedSessionId: null,
  selectedSessionContext: null,
  sessionDetailTab: 'activity',
  maintenanceSection: 'updates',
  wizardOpen: null,
  settingsSection: 'app',
  workspaceCenterMode: 'docs',
  activeWorkspaceLocalTab: 'docs',
  isWorkspaceCenterFocused: false,
  activePlanningSessionId: null,
  activePlanningSessionContext: null,
  openWorkspaces: [],
  activeWorkspaceId: null,
};

function createNavigationStore() {
  const persistedTabs = loadPersistedWorkspaceTabs();
  const persistedActiveId = loadPersistedActiveWorkspaceId();
  const persistedFocus = loadPersistedWorkspaceCenterFocused();
  const initialState = {
    ...INITIAL_STATE,
    openWorkspaces: persistedTabs,
    activeWorkspaceId: persistedActiveId || (persistedTabs.length > 0 ? persistedTabs[0].repoPath : null),
    isWorkspaceCenterFocused: persistedFocus,
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
      activeWorkspaceLocalTab: 'docs',
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

  function setActiveWorkspaceLocalTab(tab: WorkspaceLocalTab): void {
    store.setState((state) => ({
      ...state,
      activeWorkspaceLocalTab: tab,
    }));
  }

  function openPlanningSession(sessionId: string, context: SelectedSessionContext | null = null): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'planning-session',
      activeWorkspaceLocalTab: 'planning',
      activePlanningSessionId: sessionId,
      activePlanningSessionContext: context,
    }));
  }

  function closePlanningSession(): void {
    store.setState((state) => ({
      ...state,
      workspaceCenterMode: 'docs',
      activeWorkspaceLocalTab: 'docs',
      activePlanningSessionId: null,
      activePlanningSessionContext: null,
    }));
  }

  function toggleWorkspaceCenterFocus(): void {
    store.setState((state) => {
      const next = !state.isWorkspaceCenterFocused;
      persistWorkspaceCenterFocused(next);
      return { ...state, isWorkspaceCenterFocused: next };
    });
  }

  function openWorkspace(repoPath: string, repoLabel: string): void {
    const normalized = normalizeRepoPath(repoPath);
    const existing = store.getState().openWorkspaces.find(
      (w) => normalizeRepoPath(w.repoPath) === normalized,
    );
    if (existing) {
      persistActiveWorkspaceId(existing.repoPath);
      store.setState((state) => ({ ...state, activeWorkspaceId: existing.repoPath, activeSidebarItem: 'workspace' as const }));
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
    const normalized = normalizeRepoPath(repoPath);
    const existing = store.getState().openWorkspaces.find(
      (w) => normalizeRepoPath(w.repoPath) === normalized,
    );
    const resolvedPath = existing ? existing.repoPath : repoPath;
    persistActiveWorkspaceId(resolvedPath);
    store.setState((state) => ({
      ...state,
      activeWorkspaceId: resolvedPath,
      activeSidebarItem: 'workspace' as const,
    }));
  }

  function closeWorkspace(repoPath: string): void {
    const normalized = normalizeRepoPath(repoPath);
    store.setState((state) => {
      const openWorkspaces = state.openWorkspaces.filter(
        (w) => normalizeRepoPath(w.repoPath) !== normalized,
      );
      persistWorkspaceTabs(openWorkspaces);
      const nextActiveId = state.activeWorkspaceId && normalizeRepoPath(state.activeWorkspaceId) === normalized
        ? (openWorkspaces.length > 0 ? openWorkspaces[openWorkspaces.length - 1].repoPath : null)
        : state.activeWorkspaceId;
      persistActiveWorkspaceId(nextActiveId);
      const redirectedSidebarItem = nextActiveId ? state.activeSidebarItem : ('repositories' as const);
      return { ...state, openWorkspaces, activeWorkspaceId: nextActiveId, activeSidebarItem: redirectedSidebarItem };
    });
  }

  function reconcileOpenWorkspaces(validRepoPaths: string[]): void {
    const valid = new Set(validRepoPaths.map(normalizeRepoPath));
    store.setState((state) => {
      const openWorkspaces = state.openWorkspaces.filter((workspace) => valid.has(normalizeRepoPath(workspace.repoPath)));
      if (openWorkspaces.length === state.openWorkspaces.length) return state;
      const activeWorkspaceId = state.activeWorkspaceId && valid.has(normalizeRepoPath(state.activeWorkspaceId))
        ? state.activeWorkspaceId
        : openWorkspaces.at(-1)?.repoPath || null;
      persistWorkspaceTabs(openWorkspaces);
      persistActiveWorkspaceId(activeWorkspaceId);
      return {
        ...state,
        openWorkspaces,
        activeWorkspaceId,
        activeSidebarItem: activeWorkspaceId ? state.activeSidebarItem : 'repositories',
      };
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
      const raw = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
      if (!raw || !raw.trim()) return null;
      return raw.trim();
    } catch {
      return null;
    }
  }

  function loadPersistedWorkspaceCenterFocused(): boolean {
    try {
      return localStorage.getItem(WORKSPACE_CENTER_FOCUS_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function persistWorkspaceCenterFocused(focused: boolean): void {
    try {
      localStorage.setItem(WORKSPACE_CENTER_FOCUS_KEY, String(focused));
    } catch {
      // localStorage may be unavailable
    }
  }

  function openDocsGraph(): void {
    store.setState((state) => ({ ...state, workspaceCenterMode: 'docs-graph' }));
  }

  function closeDocsGraph(): void {
    store.setState((state) => ({ ...state, workspaceCenterMode: 'docs' }));
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
    setActiveWorkspaceLocalTab,
    toggleWorkspaceCenterFocus,
    openPlanningSession,
    closePlanningSession,
    openDocsGraph,
    closeDocsGraph,
    openWorkspace,
    focusWorkspace,
    closeWorkspace,
    reconcileOpenWorkspaces,
    reset,
  };
}

export const navigationStore = createNavigationStore();
