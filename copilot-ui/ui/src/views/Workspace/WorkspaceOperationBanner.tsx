import { Button } from '../../components';
import type { WorkspaceOperationSnapshot } from '../../stores/workspaceOperationStore';

interface WorkspaceOperationBannerProps {
  snapshot: WorkspaceOperationSnapshot;
  onPrimaryAction?: (snapshot: WorkspaceOperationSnapshot) => void;
}

const STATUS_LABELS: Record<WorkspaceOperationSnapshot['status'], string> = {
  ready: 'Ready',
  attention: 'Attention',
  blocked: 'Blocked',
  running: 'Running',
  unknown: 'Unknown',
};

function formatRepo(repoPath: string | null): string {
  if (!repoPath) return 'No repository';
  const parts = repoPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || repoPath;
}

export default function WorkspaceOperationBanner({ snapshot, onPrimaryAction }: WorkspaceOperationBannerProps) {
  const topBlocker = snapshot.blockers[0] || null;
  const activeLabel = snapshot.activeOperations.length > 0
    ? snapshot.activeOperations.join(', ')
    : null;
  const staleLabel = snapshot.staleReasons[0] || null;
  const detail = topBlocker?.detail || staleLabel || (activeLabel ? `Active: ${activeLabel}` : 'No blockers detected.');
  const canAct = Boolean(onPrimaryAction && snapshot.nextAction && snapshot.nextAction.label !== 'Ready');

  return (
    <section
      className={`workspace-operation-banner workspace-operation-banner-${snapshot.status}`}
      data-testid="workspace-operation-banner"
      aria-label="Workspace operation status"
    >
      <div className="workspace-operation-main">
        <span className="workspace-operation-status" data-testid="workspace-operation-status">
          {STATUS_LABELS[snapshot.status]}
        </span>
        <div className="workspace-operation-copy">
          <div className="workspace-operation-title" data-testid="workspace-operation-title">
            {topBlocker?.title || (activeLabel ? 'Operation in progress' : 'Workspace is clear')}
          </div>
          <div className="workspace-operation-detail" data-testid="workspace-operation-detail">
            {detail}
          </div>
        </div>
      </div>
      <div className="workspace-operation-meta">
        <span className="workspace-operation-repo" title={snapshot.repoPath || undefined}>
          {formatRepo(snapshot.repoPath)}
        </span>
        {staleLabel ? (
          <span className="workspace-operation-chip" data-testid="workspace-operation-stale">
            stale
          </span>
        ) : null}
        {activeLabel ? (
          <span className="workspace-operation-chip" data-testid="workspace-operation-active">
            {snapshot.activeOperations.length} active
          </span>
        ) : null}
        {snapshot.nextAction ? (
          <Button
            variant={snapshot.status === 'blocked' ? 'secondary' : 'primary'}
            size="sm"
            disabled={!canAct}
            onClick={() => onPrimaryAction?.(snapshot)}
            testId="workspace-operation-primary"
          >
            {snapshot.nextAction.label}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
