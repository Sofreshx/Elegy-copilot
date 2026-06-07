import type { WorkspaceLocalTab } from '../../stores/navigation';
import AppIcon from '../../components/AppIcon';

interface WorkspaceLocalTabsProps {
  activeTab: WorkspaceLocalTab;
  onTabChange: (tab: WorkspaceLocalTab) => void;
}

const TABS: { id: WorkspaceLocalTab; label: string; icon: string }[] = [
  { id: 'docs', label: 'Docs', icon: 'file-text' },
  { id: 'git', label: 'Git', icon: 'git-branch' },
  { id: 'planning', label: 'Planning', icon: 'diamond' },
  { id: 'execution', label: 'Execution', icon: 'play' },
  { id: 'assets', label: 'Assets', icon: 'assets' },
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
          title={tab.label}
        >
          <AppIcon name={tab.icon as any} size={18} className="workspace-local-tab-icon" />
        </button>
      ))}
    </div>
  );
}
