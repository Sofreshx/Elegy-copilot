import type { WorkspaceLocalTab } from '../../stores/navigation';

interface WorkspaceLocalTabsProps {
  activeTab: WorkspaceLocalTab;
  onTabChange: (tab: WorkspaceLocalTab) => void;
}

const TABS: { id: WorkspaceLocalTab; label: string; icon: string }[] = [
  { id: 'docs', label: 'Docs', icon: '\uD83D\uDCC4' },
  { id: 'git', label: 'Git', icon: '\u2387' },
  { id: 'planning', label: 'Planning', icon: '\u25C8' },
  { id: 'execution', label: 'Execution', icon: '\u25B6' },
];

export default function WorkspaceLocalTabs({ activeTab, onTabChange }: WorkspaceLocalTabsProps) {
  return (
    <div className="workspace-local-tabs" data-testid="workspace-local-tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`workspace-local-tab${activeTab === tab.id ? ' workspace-local-tab-active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          aria-label={tab.label}
          role="tab"
          aria-selected={activeTab === tab.id}
          data-testid={`workspace-local-tab-${tab.id}`}
        >
          <span className="workspace-local-tab-icon">{tab.icon}</span>
          <span className="workspace-local-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
