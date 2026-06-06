import { useState } from 'react';
import { Button } from '../../components';
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
      <div className="workspace-docs-tab-header" data-testid="workspace-docs-tab-header">
        <Button
          variant="ghost"
          size="sm"
          testId="workspace-docs-focus-toggle"
          onClick={() => navigationStore.toggleWorkspaceCenterFocus()}
        >
          {isFocused ? 'Exit focus' : 'Focus'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          testId="workspace-docs-graph-toggle"
          onClick={() => setShowGraph(!showGraph)}
        >
          {showGraph ? 'List view' : 'Graph view'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          testId="workspace-docs-tree-toggle"
          onClick={() => setTreeVisible((v) => !v)}
        >
          {treeVisible ? 'Hide tree' : 'Show tree'}
        </Button>
      </div>

      {showGraph ? (
        <DocumentationGraphView
          repoPath={repoPath}
          onSelectDoc={(docPath: string) => {
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
