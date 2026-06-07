import WorkspaceDocsCenter from './WorkspaceDocsCenter';

interface WorkspaceDocsTabProps {
  repoPath: string;
}

export default function WorkspaceDocsTab({ repoPath }: WorkspaceDocsTabProps) {
  return (
    <div className="workspace-docs-tab" data-testid="workspace-docs-tab">
      <WorkspaceDocsCenter repoPath={repoPath} />
    </div>
  );
}
