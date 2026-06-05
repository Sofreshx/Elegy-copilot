import { useState, useEffect } from 'react';
import { Button, Panel } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import { getWorkspaceCommands, runWorkspaceCommand, getPinnedCommands, createPinnedCommand, deletePinnedCommand } from '../../lib/api/workspace';
import type { WorkspaceCommand, WorkspaceCommandsResponse, PinnedCommand } from '../../lib/api/workspace';

interface WorkspaceCommandsCardProps {
  repoPath: string;
}

export default function WorkspaceCommandsCard({ repoPath }: WorkspaceCommandsCardProps) {
  const [data, setData] = useState<WorkspaceCommandsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ commandId: string; exitCode: number; stdout: string; stderr: string } | null>(null);
  const [pinnedCommands, setPinnedCommands] = useState<PinnedCommand[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await getWorkspaceCommands(repoPath);
        if (!cancelled) setData(result);
      } catch {
        // commands are optional
      }

      // Also load pinned commands
      try {
        const pinnedResult = await getPinnedCommands(repoPath);
        if (!cancelled) setPinnedCommands(pinnedResult.commands || []);
      } catch {
        // pinned commands are optional
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [repoPath]);

  async function handleRun(commandId: string) {
    setRunningId(commandId);
    setLastResult(null);
    try {
      const result = await runWorkspaceCommand(repoPath, commandId);
      setLastResult(result);
      if (result.exitCode !== 0) {
        notificationStore.error('Command failed', { message: `Exit code ${result.exitCode}` });
      }
    } catch (err) {
      notificationStore.error('Command error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunningId(null);
    }
  }

  if (loading) {
    return (
      <Panel title="Commands" testId="workspace-commands-card">
        <div className="state-message">Loading commands...</div>
      </Panel>
    );
  }

  const commands = data?.commands ?? [];
  const detected = data?.detected ?? [];
  const hasConfig = data?.hasConfig ?? false;

  if (!hasConfig && detected.length === 0) {
    return (
      <Panel title="Commands" testId="workspace-commands-card">
        <div className="state-message">
          No <code>elegy.workspace.json</code> found. Add one to declare safe one-click commands.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Commands" testId="workspace-commands-card">
      {commands.length > 0 ? (
        <div className="workspace-commands-list">
          {commands.map((cmd) => (
            <div key={cmd.id} className="workspace-command-entry">
              <Button
                variant="secondary"
                size="sm"
                disabled={runningId !== null}
                onClick={() => void handleRun(cmd.id)}
                testId={`workspace-command-${cmd.id}`}
              >
                {runningId === cmd.id ? 'Running...' : cmd.label}
              </Button>
              {cmd.description ? (
                <span className="workspace-command-desc">{cmd.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {pinnedCommands.length > 0 ? (
        <div className="workspace-commands-pinned" data-testid="workspace-pinned-commands">
          <p className="workspace-section-label">Pinned</p>
          <div className="workspace-commands-list">
            {pinnedCommands.map((cmd) => (
              <div key={cmd.id} className="workspace-command-entry">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={runningId !== null}
                  onClick={() => void handleRun(cmd.id)}
                  testId={`workspace-pinned-command-${cmd.id}`}
                >
                  {runningId === cmd.id ? 'Running...' : cmd.label}
                </Button>
                {cmd.sourceDocPath ? (
                  <span className="workspace-command-source" title={`From: ${cmd.sourceDocPath}`}>
                    📄
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!hasConfig && detected.length > 0 ? (
        <div className="workspace-commands-detected">
          <p className="state-message">Detected package scripts (suggestions only):</p>
          <div className="workspace-commands-suggestions">
            {detected.map((d) => (
              <span key={d.id} className="workspace-command-suggestion" title={d.description}>
                {d.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {lastResult ? (
        <div className={`workspace-command-result ${lastResult.exitCode === 0 ? 'workspace-command-result-ok' : 'workspace-command-result-fail'}`}>
          <span className="workspace-command-result-label">
            {lastResult.commandId}: exit {lastResult.exitCode}
          </span>
          {lastResult.stdout ? (
            <pre className="workspace-command-output">{lastResult.stdout.slice(0, 2000)}</pre>
          ) : null}
          {lastResult.stderr ? (
            <pre className="workspace-command-output workspace-command-stderr">{lastResult.stderr.slice(0, 2000)}</pre>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
