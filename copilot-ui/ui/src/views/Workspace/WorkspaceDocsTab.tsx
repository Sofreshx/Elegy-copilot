import { useState } from 'react';
import { navigationStore } from '../../stores/navigation';
import WorkspaceDocsCenter from './WorkspaceDocsCenter';
import AppIcon from '../../components/AppIcon';

interface WorkspaceDocsTabProps {
  repoPath: string;
  isFocused: boolean;
}

export default function WorkspaceDocsTab({ repoPath, isFocused }: WorkspaceDocsTabProps) {
  const [treeVisible, setTreeVisible] = useState(true);

  return (
    <div className="workspace-docs-tab" data-testid="workspace-docs-tab">
      {/* Icon-only toolbar */}
      <div className="workspace-docs-toolbar" data-testid="workspace-docs-toolbar">
        <button
          className="workspace-docs-toolbar-btn"
          onClick={() => navigationStore.toggleWorkspaceCenterFocus()}
          aria-label={isFocused ? 'Exit focus' : 'Focus'}
          title={isFocused ? 'Exit focus' : 'Focus'}
          data-testid="workspace-docs-focus-toggle"
          type="button"
        >
          <AppIcon name="focus" size={18} />
        </button>
        <div className="workspace-docs-toolbar-spacer" />
        <button
          className="workspace-docs-toolbar-btn"
          onClick={() => setTreeVisible((v) => !v)}
          aria-label={treeVisible ? 'Hide tree' : 'Show tree'}
          title={treeVisible ? 'Hide tree' : 'Show tree'}
          data-testid="workspace-docs-tree-toggle"
          type="button"
        >
          <AppIcon name={treeVisible ? 'chevron-left' : 'chevron-right'} size={18} />
        </button>
      </div>

      <WorkspaceDocsCenter
        repoPath={repoPath}
        isFocused={isFocused}
        treeVisible={treeVisible}
        onToggleTree={() => setTreeVisible((v) => !v)}
      />
    </div>
  );
}
