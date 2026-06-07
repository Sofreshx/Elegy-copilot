import WorkspaceCommandsCard from './WorkspaceCommandsCard';

interface WorkspaceExecutionTabProps {
  repoPath: string;
}

export default function WorkspaceExecutionTab({ repoPath }: WorkspaceExecutionTabProps) {
  return (
    <div className="workspace-execution-tab" data-testid="workspace-execution-tab">
      {/* Commands card */}
      <div className="workspace-execution-commands">
        <WorkspaceCommandsCard repoPath={repoPath} />
      </div>

      {/* Terminal placeholder */}
      <div className="workspace-execution-terminal" data-testid="workspace-execution-terminal">
        <div className="state-message">Terminal — future release</div>
      </div>
    </div>
  );
}
