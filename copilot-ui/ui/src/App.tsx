import { useEffect } from 'react';
import AppLayout from './components/AppLayout';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import { getDesktopUpdaterPresentation } from './lib/desktopUpdaterPresentation';
import { useStoreValue } from './lib/store';
import {
  navigationStore,
  SIDEBAR_NAV_ITEMS,
  type SidebarItemId,
} from './stores/navigation';
import { desktopUpdaterStore } from './stores/desktopUpdaterStore';
import { sdkHealthStore } from './stores/sdkHealthStore';
import CatalogView from './tabs/Catalog/CatalogView';
import HomeRuntimeView from './tabs/HomeRuntime/HomeRuntimeView';
import PlanningView from './tabs/Planning/PlanningView';
import StatsView from './tabs/Stats/StatsView';
import DashboardView from './views/DashboardView';
import AddProjectWizard from './views/Project/AddProjectWizard';
import ProjectOverview from './views/Project/ProjectOverview';
import ProjectsListView from './views/Project/ProjectsListView';
import SessionDetailView from './views/Sessions/SessionDetailView';
import SessionsListView from './views/Sessions/SessionsListView';
import SessionWizard from './views/Sessions/SessionWizard';

export default function App() {
  const navigationState = useStoreValue(navigationStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const desktopUpdaterState = useStoreValue(desktopUpdaterStore);

  useEffect(() => {
    sdkHealthStore.startPolling();
    desktopUpdaterStore.startListening();
    return () => {
      sdkHealthStore.stopPolling();
      desktopUpdaterStore.stopListening();
    };
  }, []);

  const sdkHealthClassName = sdkHealthState.error
    ? 'error'
    : sdkHealthState.health?.connected
      ? 'ok'
      : sdkHealthState.loading
        ? 'loading'
        : 'warn';

  const sdkHealthSummary = sdkHealthState.error
    ? sdkHealthState.error
    : sdkHealthState.health
      ? sdkHealthState.health.connected
        ? `${sdkHealthState.health.state}${Number.isFinite(sdkHealthState.health.sessionCount)
          ? `, sessions=${sdkHealthState.health.sessionCount}`
          : ''}`
        : sdkHealthState.health.error?.trim()
          || sdkHealthState.health.cliManager?.message?.trim()
          || sdkHealthState.health.reason
          || sdkHealthState.health.state
      : 'awaiting first poll';
  const managedCliState = sdkHealthState.health?.cliManager || null;
  const managedCliTone = managedCliState?.approved
    ? 'ok'
    : managedCliState?.status === 'blocked'
      ? 'warn'
      : 'loading';
  const managedCliSummary = managedCliState?.message?.trim()
    || 'Waiting for desktop Copilot CLI status.';

  const desktopUpdaterPresentation = getDesktopUpdaterPresentation(desktopUpdaterState);

  function renderContent() {
    // Wizards take priority when open
    if (navigationState.wizardOpen === 'session') {
      return <SessionWizard />;
    }
    if (navigationState.wizardOpen === 'project') {
      return <AddProjectWizard />;
    }

    // Session detail takes priority when a session is selected
    if (navigationState.selectedSessionId) {
      return <SessionDetailView />;
    }

    switch (navigationState.activeSidebarItem) {
      case 'dashboard':
        return <DashboardView />;
      case 'projects':
        return navigationState.selectedProjectId
          ? <ProjectOverview />
          : <ProjectsListView />;
      case 'catalog':
        return <CatalogView />;
      case 'planning':
        return (
          <PlanningView onSdkSessionReady={() => {
            navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' });
          }} />
        );
      case 'maintenance':
        // Phase 1a bridge: show diagnostics + stats
        return (
          <>
            <HomeRuntimeView />
            <StatsView />
          </>
        );
      case 'settings':
        return (
          <div className="settings-placeholder" data-testid="settings-placeholder">
            Settings — coming soon
          </div>
        );
      default:
        return <DashboardView />;
    }
  }

  return (
    <AppLayout
      statusBar={
        <StatusBar
          sdkHealthClassName={sdkHealthClassName}
          sdkHealthSummary={sdkHealthSummary}
          managedCliTone={managedCliTone}
          managedCliSummary={managedCliSummary}
          desktopUpdaterTone={desktopUpdaterPresentation.tone}
          desktopUpdaterSummary={desktopUpdaterPresentation.summary}
          canCheckForUpdates={desktopUpdaterState.canCheckForUpdates}
          canDownload={desktopUpdaterState.canDownload}
          canRestartToUpdate={desktopUpdaterState.canRestartToUpdate}
          onCheckForUpdates={() => void desktopUpdaterStore.checkForUpdates()}
          onDownloadUpdate={() => void desktopUpdaterStore.downloadUpdate()}
          onRestartToUpdate={() => void desktopUpdaterStore.restartToUpdate()}
        />
      }
      sidebar={
        <Sidebar
          items={SIDEBAR_NAV_ITEMS}
          activeItem={navigationState.activeSidebarItem}
          onNavigate={(id: SidebarItemId) => navigationStore.navigate(id)}
          adminMode={navigationState.adminMode}
          onToggleAdmin={() => navigationStore.toggleAdmin()}
          onNewSession={() => navigationStore.openWizard('session')}
        />
      }
    >
      {renderContent()}
    </AppLayout>
  );
}
