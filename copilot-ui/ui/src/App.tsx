import { useMemo, useState } from 'react';
import TabShell from './components/TabShell';
import { NAVIGATION_TABS, TabId } from './stores/navigation';
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
  const placeholder = useMemo(() => tabPlaceholderCopy[activeTabId] ?? null, [activeTabId]);
  const showPlaceholder = PLACEHOLDER_TAB_IDS.includes(activeTabId);

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="kicker">{environmentLabel}</p>
        <h1>Instruction Engine Tab Shell</h1>
        <p>
          Base migration scaffold with token-driven styling, section tabs, and a preserved runtime
          health panel.
        </p>
      </section>

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
