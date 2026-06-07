import { useState } from 'react';
import { navigationStore } from '../../stores/navigation';
import WorkspaceDocsCenter from './WorkspaceDocsCenter';
import DocumentationGraphView from './DocumentationGraphView';

interface WorkspaceDocsTabProps {
  repoPath: string;
  isFocused: boolean;
}

export default function WorkspaceDocsTab({ repoPath, isFocused }: WorkspaceDocsTabProps) {
  const [showGraph, setShowGraph] = useState(false);
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
          <span aria-hidden="true">{isFocused ? '\u25A3' : '\u25A1'}</span>
        </button>
        <button
          className="workspace-docs-toolbar-btn"
          onClick={() => setShowGraph(!showGraph)}
          aria-label={showGraph ? 'List view' : 'Graph view'}
          title={showGraph ? 'List view' : 'Graph view'}
          data-testid="workspace-docs-graph-toggle"
          type="button"
        >
          <span aria-hidden="true">{showGraph ? '\u2630' : '\u25C9'}</span>
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
          <span aria-hidden="true">{treeVisible ? '\u25C0' : '\u25B6'}</span>
        </button>
      </div>

      {showGraph ? (
        <DocumentationGraphView
          repoPath={repoPath}
          onSelectDoc={(_docPath: string) => {
            setShowGraph(false);
          }}
        />
      ) : (
        <WorkspaceDocsCenter
          repoPath={repoPath}
          isFocused={isFocused}
          treeVisible={treeVisible}
          onToggleTree={() => setTreeVisible((v) => !v)}
        />
      )}
    </div>
  );
}
