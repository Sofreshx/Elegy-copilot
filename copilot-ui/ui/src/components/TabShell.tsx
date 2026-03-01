import { KeyboardEvent, ReactNode } from 'react';
import { NavigationTab, TabId } from '../stores/navigation';

interface TabShellProps {
  tabs: readonly NavigationTab[];
  activeTabId: TabId;
  onTabChange: (nextTab: TabId) => void;
  tablistLabel?: string;
  children?: ReactNode;
}

const toTabButtonId = (id: TabId): string => `tab-${id}`;
const toTabPanelId = (id: TabId): string => `tabpanel-${id}`;

export default function TabShell({
  tabs,
  activeTabId,
  onTabChange,
  tablistLabel = 'Application sections',
  children,
}: TabShellProps) {
  const onTabKeydown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (tabs.length === 0) {
      return;
    }

    let nextIndex = index;

    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onTabChange(nextTab.id);

    const tabButton = document.getElementById(toTabButtonId(nextTab.id));
    if (tabButton instanceof HTMLElement) {
      tabButton.focus();
    }
  };

  return (
    <section className="tab-shell">
      <div aria-label={tablistLabel} aria-orientation="horizontal" className="tab-bar" role="tablist">
        {tabs.map((tab, index) => (
          <button
            aria-controls={toTabPanelId(tab.id)}
            aria-selected={activeTabId === tab.id}
            className="tab-trigger"
            id={toTabButtonId(tab.id)}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => onTabKeydown(event, index)}
            role="tab"
            tabIndex={activeTabId === tab.id ? 0 : -1}
            type="button"
          >
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div
        aria-labelledby={toTabButtonId(activeTabId)}
        className="tab-panel"
        id={toTabPanelId(activeTabId)}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </section>
  );
}
