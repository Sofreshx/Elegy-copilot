import { useEffect } from 'react';
import TabShell from './components/TabShell';
import { getDesktopUpdaterPresentation } from './lib/desktopUpdaterPresentation';
import { useStoreValue } from './lib/store';
import { navigationStore, NAVIGATION_TABS } from './stores/navigation';
import { desktopUpdaterStore } from './stores/desktopUpdaterStore';
import { sdkHealthStore } from './stores/sdkHealthStore';
import CatalogView from './tabs/Catalog/CatalogView';
import HomeRuntimeView from './tabs/HomeRuntime/HomeRuntimeView';
import PlanningView from './tabs/Planning/PlanningView';
import StatsView from './tabs/Stats/StatsView';

const environmentLabel = 'Desktop app';
const productName = 'Elegy Copilot';

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

  return (
    <main aria-labelledby="elegy-copilot-title" className="app-shell">
      <header className="hero-card">
        <p className="kicker">{environmentLabel}</p>
        <div className="hero-status-stack">
          <p className={`sdk-health-indicator sdk-health-${sdkHealthClassName}`}>
            SDK Health: {sdkHealthSummary}
          </p>
          <p className={`desktop-cli-indicator desktop-cli-${managedCliTone}`} data-testid="desktop-cli-status">
            Copilot CLI: {managedCliSummary}
          </p>
          <p className={`desktop-updater-indicator desktop-updater-${desktopUpdaterPresentation.tone}`} data-testid="desktop-updater-status">
            Update status: {desktopUpdaterPresentation.summary}
          </p>
        </div>
        <h1 id="elegy-copilot-title">{productName}</h1>
        <p>
          Planning-first workspace for turning ideas into repo-targeted plans, managing assets,
          operating sessions, and checking system readiness without scattering the workflow across
          overlapping tabs.
        </p>
        <div className="hero-actions" data-testid="desktop-updater-actions">
          <button
            className="button button-secondary button-sm"
            data-testid="desktop-updater-check"
            disabled={!desktopUpdaterState.canCheckForUpdates}
            onClick={() => {
              void desktopUpdaterStore.checkForUpdates();
            }}
            type="button"
          >
            Check for updates
          </button>
          {desktopUpdaterState.canDownload ? (
            <button
              className="button button-primary button-sm"
              data-testid="desktop-updater-download"
              onClick={() => {
                void desktopUpdaterStore.downloadUpdate();
              }}
              type="button"
            >
              Download update
            </button>
          ) : null}
          {desktopUpdaterState.canRestartToUpdate ? (
            <button
              className="button button-primary button-sm"
              data-testid="desktop-updater-restart"
              onClick={() => {
                void desktopUpdaterStore.restartToUpdate();
              }}
              type="button"
            >
              Restart to update
            </button>
          ) : null}
        </div>
      </header>

      <TabShell
        activeTabId={navigationState.activeTabId}
        tabs={NAVIGATION_TABS}
        tablistLabel="Elegy Copilot sections"
        onTabChange={(tabId) => navigationStore.setActiveTabId(tabId)}
      >
        {navigationState.activeTabId === 'home-runtime' ? <HomeRuntimeView /> : null}
        {navigationState.activeTabId === 'catalog' ? <CatalogView /> : null}
        {navigationState.activeTabId === 'planning' ? (
          <PlanningView onSdkSessionReady={() => {
            navigationStore.goToRuntime('sessions', { sessionsMode: 'sdk' });
          }} />
        ) : null}
        {navigationState.activeTabId === 'stats' ? <StatsView /> : null}
      </TabShell>
    </main>
  );
}
