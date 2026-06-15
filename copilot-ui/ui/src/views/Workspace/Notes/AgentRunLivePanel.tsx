import { useStoreValue } from '../../../lib/store';
import { agentRunStore, cancelRun, detachStream, type AgentRunState } from '../../../stores/agentRunStore';

interface LivePanelProps {
  noteId: string | null;
  onAppendResult?: (runId: string, outputText: string) => void;
}

export default function AgentRunLivePanel({ noteId: _noteId, onAppendResult }: LivePanelProps) {
  const state = useStoreValue(agentRunStore);
  const run = state.activeRunId ? state.runs[state.activeRunId] : null;

  if (!run) return null;

  const isTerminal = run.status === 'completed' || run.status === 'aborted' || run.status === 'error';
  const statusColor = run.status === 'completed' ? 'var(--color-brand-400)' : run.status === 'error' ? '#ef4444' : 'var(--color-ink-400)';

  return (
    <div className="workspace-notes-live-panel" data-testid="agent-live-panel">
      <div className="workspace-notes-live-panel-header">
        <div className="workspace-notes-live-panel-info">
          <span className="workspace-notes-live-panel-action">{run.action}</span>
          <span className="workspace-notes-live-panel-model">{run.modelId || 'default'}</span>
          <span className="workspace-notes-live-panel-status" style={{ color: statusColor }}>{run.status}</span>
        </div>
        <div className="workspace-notes-live-panel-actions">
          {!isTerminal && (
            <button className="button button-secondary button-sm" onClick={() => cancelRun(run.id)} data-testid="agent-live-cancel">Cancel</button>
          )}
          <button className="button button-ghost button-sm" onClick={() => detachStream()} data-testid="agent-live-detach">Close</button>
        </div>
      </div>

      <div className="workspace-notes-live-panel-body">
        {run.outputText && (
          <div className="workspace-notes-live-panel-output" data-testid="agent-live-output">
            <pre className="workspace-notes-live-panel-pre">{run.outputText}</pre>
          </div>
        )}

        {run.events.length === 0 && !isTerminal && (
          <div className="workspace-notes-live-panel-waiting">
            Waiting for agent to start...
          </div>
        )}

        {isTerminal && run.outputText && onAppendResult && (
          <button className="button button-primary button-sm" onClick={() => onAppendResult(run.id, run.outputText!)} style={{ marginTop: 'var(--space-sm)' }} data-testid="agent-live-append">
            Append result to note
          </button>
        )}
      </div>

      {(run.promptTokens || run.outputTokens || run.costUsd) && (
        <div className="workspace-notes-live-panel-footer">
          {run.promptTokens != null && <span>Prompt: {run.promptTokens} tokens</span>}
          {run.outputTokens != null && <span>Output: {run.outputTokens} tokens</span>}
          {run.costUsd != null && <span>Cost: ${run.costUsd.toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}
