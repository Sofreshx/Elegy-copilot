import { useRef, type KeyboardEvent } from 'react';
import type { WorkspaceLocalTab } from '../../stores/navigation';
import AppIcon from '../../components/AppIcon';
import type { AppIconName } from '../../components/AppIcon';

interface WorkspaceLocalTabsProps {
  activeTab: WorkspaceLocalTab;
  onTabChange: (tab: WorkspaceLocalTab) => void;
}

const TABS: { id: WorkspaceLocalTab; label: string; icon: AppIconName }[] = [
  { id: 'docs', label: 'Docs', icon: 'file-text' },
  { id: 'planning', label: 'Plan', icon: 'diamond' },
  { id: 'execution', label: 'Execute', icon: 'play' },
  { id: 'git', label: 'Git', icon: 'git-branch' },
  { id: 'checks', label: 'Checks', icon: 'check' },
  { id: 'assets', label: 'Assets', icon: 'assets' },
  { id: 'health', label: 'Health', icon: 'warning' },
];

export default function WorkspaceLocalTabs({ activeTab, onTabChange }: WorkspaceLocalTabsProps) {
  const tabRefs = useRef(new Map<WorkspaceLocalTab, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: WorkspaceLocalTab) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex];
    onTabChange(nextTab.id);
    tabRefs.current.get(nextTab.id)?.focus();
  };

  return (
    <div className="workspace-local-tabs" data-testid="workspace-local-tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`workspace-local-tab${activeTab === tab.id ? ' workspace-local-tab-active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(event) => handleKeyDown(event, tab.id)}
          ref={(element) => {
            if (element) tabRefs.current.set(tab.id, element);
            else tabRefs.current.delete(tab.id);
          }}
          aria-label={tab.label}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`workspace-panel-${tab.id}`}
          id={`workspace-tab-${tab.id}`}
          tabIndex={activeTab === tab.id ? 0 : -1}
          data-testid={`workspace-local-tab-${tab.id}`}
          title={tab.label}
        >
          <AppIcon name={tab.icon} size={18} className="workspace-local-tab-icon" />
          <span className="workspace-local-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
