import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import AppIcon from '../../components/AppIcon';
import IconButton from '../../components/IconButton';
import PageContainer from '../../components/PageContainer';
import RouteLoading from '../../components/RouteLoading';
import Toolbar from '../../components/Toolbar';
import { useStoreValue } from '../../lib/store';
import {
  navigationStore,
  SETTINGS_NAV_GROUPS,
  type SettingsSection,
} from '../../stores/navigation';

const loadAppSettingsSection = () => import('./SettingsAppSection');
const loadOpenCodeView = () => import('../../tabs/OpenCode/OpenCodeView');
const loadTelemetryView = () => import('./TelemetryView');
const loadMaintenanceView = () => import('../Maintenance/MaintenanceView');
const loadDashboardView = () => import('../DashboardView');
const loadCodexProviderPanel = () => import('./CodexProviderPanel');
const loadClaudeCodeView = () => import('../../tabs/ClaudeCode/ClaudeCodeView');
const loadGitHubSettingsView = () => import('./GitHubSettingsView');
const loadShellSettingsView = () => import('../../tabs/Shell/ShellSettingsView');
const loadNotesSettingsView = () => import('./NotesSettingsView');

const SETTINGS_PANEL_LOADERS: Record<SettingsSection, () => Promise<{ default: ComponentType }>> = {
  app: loadAppSettingsSection,
  opencode: loadOpenCodeView,
  telemetry: loadTelemetryView,
  maintenance: loadMaintenanceView,
  runtime: loadDashboardView,
  codex: loadCodexProviderPanel,
  'claude-code': loadClaudeCodeView,
  github: loadGitHubSettingsView,
  shell: loadShellSettingsView,
  notes: loadNotesSettingsView,
};

const SETTINGS_PANEL_COMPONENTS: Record<SettingsSection, LazyExoticComponent<ComponentType>> = {
  app: lazy(loadAppSettingsSection),
  opencode: lazy(loadOpenCodeView),
  telemetry: lazy(loadTelemetryView),
  maintenance: lazy(loadMaintenanceView),
  runtime: lazy(loadDashboardView),
  codex: lazy(loadCodexProviderPanel),
  'claude-code': lazy(loadClaudeCodeView),
  github: lazy(loadGitHubSettingsView),
  shell: lazy(loadShellSettingsView),
  notes: lazy(loadNotesSettingsView),
};

function preloadSettingsPanel(section: SettingsSection) {
  void SETTINGS_PANEL_LOADERS[section]().catch(() => {
    // The selected panel's Suspense boundary handles loading on navigation.
  });
}

export default function SettingsView() {
  const navState = useStoreValue(navigationStore);
  const activeSection = navState.settingsSection;
  const ActivePanel = SETTINGS_PANEL_COMPONENTS[activeSection];

  function handleBack() {
    navigationStore.navigate('workspace');
  }

  return (
    <div className="view-shell settings-view" data-testid="settings-view">
      <div className="view-static" data-testid="settings-sticky-toolbar">
        <Toolbar testId="settings-toolbar">
          <IconButton icon="chevron-left" size={22} label="Back" onClick={handleBack} testId="settings-back" />
        </Toolbar>
      </div>

      <div className="settings-layout">
        <div className="view-static">
          <nav className="settings-nav" data-testid="settings-nav">
            {SETTINGS_NAV_GROUPS.map((group) => (
              <div key={group.id} className="settings-nav-group">
                <p className="settings-nav-group-label">{group.label}</p>
                {group.items.map((section) => (
                  <button
                    key={section.id}
                    className={`settings-nav-item${activeSection === section.id ? ' settings-nav-item-active' : ''}`}
                    onClick={() => navigationStore.setSettingsSection(section.id)}
                    onMouseEnter={() => preloadSettingsPanel(section.id)}
                    onFocus={() => preloadSettingsPanel(section.id)}
                    data-testid={`settings-nav-${section.id}`}
                    title={section.description}
                    type="button"
                  >
                    <span className="settings-nav-icon" aria-hidden="true"><AppIcon name={section.icon as any} size={18} /></span>
                    <span className="settings-nav-label">{section.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <div className="view-scroll settings-content" data-testid="settings-content">
          <PageContainer>
            <Suspense fallback={<RouteLoading label="Loading settings…" />}>
              <ActivePanel />
            </Suspense>
          </PageContainer>
        </div>
      </div>
    </div>
  );
}
