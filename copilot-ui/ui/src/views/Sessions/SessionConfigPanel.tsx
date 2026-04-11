import { Panel } from '../../components';
import {
  resolveSessionStatus,
  resolveSessionStartedAt,
  resolveSessionUpdatedAt,
  formatTimestampLabel,
  humanizeToken,
} from '../../lib/stateDiagnostics';
import type { SessionSummary, SessionOrchestrationProjection } from '../../lib/types';

interface Props {
  session: SessionSummary | null;
  orchestration: SessionOrchestrationProjection | null;
}

function MetadataRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="metadata-row" data-testid="metadata-row">
      <span className="metadata-label">{label}</span>
      <span className="metadata-value">{value ?? '—'}</span>
    </div>
  );
}

export default function SessionConfigPanel({ session, orchestration }: Props) {
  const repo = orchestration?.repo ?? null;
  const isolation = orchestration?.isolation ?? null;
  const actors = orchestration?.actors?.items ?? [];
  const workflow = orchestration?.workflow ?? null;

  return (
    <div className="session-config-panel" data-testid="session-config-panel">
      <Panel title="Session Metadata" testId="config-metadata-panel">
        <MetadataRow label="Session ID" value={session?.id} />
        <MetadataRow
          label="Source"
          value={session?.source ? humanizeToken(session.source) : null}
        />
        <MetadataRow label="Status" value={session ? resolveSessionStatus(session) : null} />
        <MetadataRow
          label="Started"
          value={session ? formatTimestampLabel(resolveSessionStartedAt(session)) : null}
        />
        <MetadataRow
          label="Last Updated"
          value={session ? formatTimestampLabel(resolveSessionUpdatedAt(session)) : null}
        />
      </Panel>

      {repo && (
        <Panel title="Repository Context" testId="config-repo-panel">
          <MetadataRow label="Repo ID" value={repo.repoId} />
          <MetadataRow label="Repo Path" value={repo.repoPath} />
          <MetadataRow label="Repo Label" value={repo.repoLabel} />
          <MetadataRow label="Branch" value={repo.branch} />
        </Panel>
      )}

      {isolation && (
        <Panel title="Isolation" testId="config-isolation-panel">
          <MetadataRow label="Mode" value={isolation.mode ? humanizeToken(isolation.mode) : null} />
          <MetadataRow
            label="Context Type"
            value={isolation.contextType ? humanizeToken(isolation.contextType) : null}
          />
          <MetadataRow label="Sandbox ID" value={isolation.sandboxId} />
          <MetadataRow label="Worktree ID" value={isolation.worktreeId} />
          <MetadataRow label="Worktree Path" value={isolation.worktreePath} />
        </Panel>
      )}

      {actors.length > 0 && (
        <Panel title="Actors" testId="config-actors-panel">
          <div className="config-actors-list">
            {actors.map((actor) => (
              <div
                key={actor.actorId}
                className="config-actor-item"
                data-testid="config-actor-item"
              >
                <MetadataRow label="Actor ID" value={actor.actorId} />
                <MetadataRow
                  label="Role"
                  value={actor.role ? humanizeToken(actor.role) : null}
                />
                <MetadataRow label="Label" value={actor.label} />
                <MetadataRow
                  label="Status"
                  value={actor.status ? humanizeToken(actor.status) : null}
                />
                {actor.taskIds && actor.taskIds.length > 0 && (
                  <MetadataRow label="Tasks" value={actor.taskIds.join(', ')} />
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {workflow && (
        <Panel title="Workflow" testId="config-workflow-panel">
          <MetadataRow
            label="Kind"
            value={workflow.workflowKind ? humanizeToken(workflow.workflowKind) : null}
          />
          <MetadataRow
            label="Trigger"
            value={workflow.trigger ? humanizeToken(workflow.trigger) : null}
          />
          <MetadataRow
            label="Mode"
            value={workflow.mode ? humanizeToken(workflow.mode) : null}
          />
          <MetadataRow
            label="Status"
            value={workflow.status ? humanizeToken(workflow.status) : null}
          />
        </Panel>
      )}
    </div>
  );
}
