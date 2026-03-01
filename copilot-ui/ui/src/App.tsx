import { useEffect, useMemo, useState } from 'react';
import TabShell from './components/TabShell';
import { useStoreValue } from './lib/store';
import { NAVIGATION_TABS, TabId } from './stores/navigation';
import { sdkHealthStore } from './stores/sdkHealthStore';
import AssetsView from './tabs/Assets/AssetsView';
import LspView from './tabs/LSP/LspView';
import GatewayView from './tabs/Gateway/GatewayView';
import PlanningView from './tabs/Planning/PlanningView';
import SandboxesView from './tabs/Sandboxes/SandboxesView';
import SessionsView from './tabs/Sessions/SessionsView';
import SkillsPreviewView from './tabs/SkillsPreview/SkillsPreviewView';
import TrackerView from './tabs/Tracker/TrackerView';

const environmentLabel = 'Instruction Engine UI';

const tabPlaceholderCopy: Partial<Record<TabId, { title: string; body: string }>> = {
  workflows: {
    title: 'Workflows Wave Placeholder',
    body: 'Cross-tab workflow orchestration and migration progress controls will be anchored in this new tab.',
  },
};

const PLACEHOLDER_TAB_IDS: readonly TabId[] = ['workflows'];

export default function App() {
  const [activeTabId, setActiveTabId] = useState<TabId>('sessions');
  const sdkHealthState = useStoreValue(sdkHealthStore);

  useEffect(() => {
    sdkHealthStore.startPolling();
    return () => {
      sdkHealthStore.stopPolling();
    };
  }, []);

  const placeholder = useMemo(() => tabPlaceholderCopy[activeTabId] ?? null, [activeTabId]);
  const showPlaceholder = PLACEHOLDER_TAB_IDS.includes(activeTabId);

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
      ? `${sdkHealthState.health.state}${Number.isFinite(sdkHealthState.health.sessionCount)
        ? `, sessions=${sdkHealthState.health.sessionCount}`
        : ''}`
      : 'awaiting first poll';

  return (
    <main aria-labelledby="instruction-engine-title" className="app-shell">
      <header className="hero-card">
        <p className="kicker">{environmentLabel}</p>
        <p className={`sdk-health-indicator sdk-health-${sdkHealthClassName}`}>
          SDK Health: {sdkHealthSummary}
        </p>
        <h1 id="instruction-engine-title">Instruction Engine Tab Shell</h1>
        <p>
          Base migration scaffold with token-driven styling, section tabs, and a preserved runtime
          health panel.
        </p>
      </header>

      <TabShell
        activeTabId={activeTabId}
        tabs={NAVIGATION_TABS}
        tablistLabel="Instruction Engine sections"
        onTabChange={setActiveTabId}
      >
        {activeTabId === 'sessions' ? <SessionsView /> : null}
        {activeTabId === 'assets' ? <AssetsView /> : null}
        {activeTabId === 'planning' ? <PlanningView /> : null}
        {activeTabId === 'gateway' ? <GatewayView /> : null}
        {activeTabId === 'sandboxes' ? <SandboxesView onFollowSessions={() => setActiveTabId('sessions')} /> : null}
        {activeTabId === 'lsp' ? <LspView /> : null}
        {activeTabId === 'tracker' ? <TrackerView /> : null}
        {activeTabId === 'skills-preview' ? <SkillsPreviewView /> : null}

        {showPlaceholder && placeholder ? (
          <section aria-live="polite" className="status-grid">
            <article className="status-card placeholder-card">
              <p className="kicker">Migration Wave Placeholder</p>
              <h2>{placeholder.title}</h2>
              <p>{placeholder.body}</p>
            </article>
          </section>
        ) : null}
      </TabShell>
    </main>
  );
}
