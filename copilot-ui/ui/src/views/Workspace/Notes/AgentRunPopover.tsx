import { useState, useEffect } from 'react';
import { startRun, type AgentRunConfig } from '../../../stores/agentRunStore';

interface AgentRunPopoverProps {
  noteId: string | null;
  action: 'enhance' | 'research' | 'deduplicate' | 'reexamine';
  onClose: () => void;
  onRunStarted?: (runId: string) => void;
}

const ACTION_META: Record<string, { title: string; agentName: string; showRepoAccess: boolean }> = {
  enhance: { title: 'Enhance Note', agentName: 'notes-enhance', showRepoAccess: false },
  research: { title: 'Research Note', agentName: 'notes-research', showRepoAccess: true },
  deduplicate: { title: 'Deduplicate Notes', agentName: 'notes-deduplicate', showRepoAccess: false },
  reexamine: { title: 'Re-examine Note', agentName: 'notes-reexamine', showRepoAccess: false },
};

export default function AgentRunPopover({ noteId, action, onClose, onRunStarted }: AgentRunPopoverProps) {
  const [modelId, setModelId] = useState('');
  const [extraInstructions, setExtraInstructions] = useState('');
  const [repoAccess, setRepoAccess] = useState(false);
  const [runInBackground, setRunInBackground] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = ACTION_META[action];

  async function handleStart() {
    if (!noteId) return;
    setStarting(true);
    setError(null);
    try {
      const config: AgentRunConfig = {
        noteId,
        action,
        agentName: meta.agentName,
        modelId: modelId || undefined,
        extraInstructions: extraInstructions || undefined,
        repoAccessEnabled: meta.showRepoAccess ? repoAccess : false,
        runInBackground,
      };
      const runId = await startRun(config);
      onRunStarted?.(runId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="workspace-notes-popover-backdrop" onClick={onClose} data-testid="agent-popover-backdrop">
      <div className="workspace-notes-popover" onClick={e => e.stopPropagation()} data-testid="agent-popover">
        <div className="workspace-notes-popover-header">
          <h3 className="workspace-notes-popover-title">{meta.title}</h3>
          <button className="workspace-notes-popover-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {error && <div className="workspace-notes-error">{error}</div>}

        <div className="workspace-notes-popover-body">
          <div className="workspace-notes-popover-field">
            <label className="workspace-notes-editor-label">Model (optional)</label>
            <input
              className="workspace-notes-editor-input"
              type="text"
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              placeholder="Default model from settings"
              data-testid="agent-popover-model"
            />
          </div>

          <div className="workspace-notes-popover-field">
            <label className="workspace-notes-editor-label">Extra instructions (optional)</label>
            <textarea
              className="workspace-notes-editor-textarea"
              value={extraInstructions}
              onChange={e => setExtraInstructions(e.target.value)}
              placeholder="Any additional context or instructions for the agent..."
              rows={3}
              style={{ minHeight: '60px' }}
              data-testid="agent-popover-instructions"
            />
          </div>

          {meta.showRepoAccess && (
            <div className="workspace-notes-popover-field">
              <label className="workspace-notes-popover-checkbox">
                <input type="checkbox" checked={repoAccess} onChange={e => setRepoAccess(e.target.checked)} data-testid="agent-popover-repo-access" />
                Allow filesystem access to the current repo
              </label>
            </div>
          )}

          <div className="workspace-notes-popover-field">
            <label className="workspace-notes-popover-checkbox">
              <input type="checkbox" checked={runInBackground} onChange={e => setRunInBackground(e.target.checked)} data-testid="agent-popover-background" />
              Run in background
            </label>
          </div>
        </div>

        <div className="workspace-notes-popover-actions">
          <button className="button button-secondary button-sm" onClick={onClose}>Cancel</button>
          <button className="button button-primary button-sm" onClick={() => void handleStart()} disabled={starting || !noteId} data-testid="agent-popover-run">
            {starting ? 'Starting...' : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}
