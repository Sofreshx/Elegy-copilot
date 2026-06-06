import { useState } from 'react';
import { Button } from '../../components';
import { launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';
import { notificationStore } from '../../stores/notificationStore';
import WorkspaceCommandsCard from './WorkspaceCommandsCard';

interface WorkspaceExecutionTabProps {
  repoPath: string;
  launchers: WorkspaceLauncher[];
}

export default function WorkspaceExecutionTab({ repoPath, launchers }: WorkspaceExecutionTabProps) {
  const GROUP_ORDER = ['ides', 'agents', 'terminals'] as const;
  const GROUP_LABELS: Record<string, string> = {
    ides: 'IDEs',
    agents: 'Agent CLIs',
    terminals: 'Terminals',
  };

  const [launching, setLaunching] = useState<string | null>(null);

  async function handleLaunch(launcherId: string) {
    setLaunching(launcherId);
    try {
      const result = await launchWorkspace(launcherId, repoPath);
      if (!result.ok) {
        notificationStore.error('Launch failed', { message: `Failed to open ${launcherId}` });
      }
    } catch (err) {
      notificationStore.error('Launch failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(null);
    }
  }

  const grouped = new Map<string, WorkspaceLauncher[]>();
  for (const l of launchers) {
    const group = l.group || 'unknown';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(l);
  }

  const availableLaunchers = launchers.filter((l) => l.available);

  return (
    <div className="workspace-execution-tab" data-testid="workspace-execution-tab">
      {/* External launcher buttons */}
      {availableLaunchers.length > 0 ? (
        <div className="workspace-execution-launchers" data-testid="workspace-execution-launchers">
          {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
            <div key={group} className="workspace-execution-launcher-group">
              <span className="workspace-section-label">{GROUP_LABELS[group] || group}</span>
              <div className="workspace-execution-launcher-buttons">
                {grouped.get(group)!.map((launcher) => (
                  <Button
                    key={launcher.id}
                    variant="secondary"
                    size="sm"
                    disabled={!launcher.available || launching === launcher.id}
                    onClick={() => void handleLaunch(launcher.id)}
                    testId={`workspace-execution-launch-${launcher.id}`}
                    title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
                  >
                    {launching === launcher.id ? 'Opening...' : launcher.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

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
