import { useState, useEffect, useRef } from 'react';
import { Panel } from '../../components';
import { notificationStore } from '../../stores/notificationStore';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import type { GitSummaryResponse, GitPullRequestResponse } from '../../lib/api/git';
import type { VerificationState } from '../Repositories/verification';
import { getWorkspaceLaunchers, launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';

interface WorkspaceActiveRepoCardProps {
  repo: CatalogRepoInventoryEntry | null;
  repoPath: string;
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse['pullRequest'] | null;
  verificationState: VerificationState;
  changeCount: number;
  onSwitchRepo: () => void;
  showRepoSelector: boolean;
}

const GROUP_ORDER = ['ides', 'agents', 'terminals'] as const;
const GROUP_LABELS: Record<string, string> = {
  ides: 'IDEs',
  agents: 'Agent CLIs',
  terminals: 'Terminals',
};

const LAUNCHER_ICONS: Record<string, string> = {
  ides: '\u25C8',   // ◈ (window/editor)
  agents: '\u26A1', // ⚡ (agent/automation)
  terminals: '\u003E\u005F', // >_ (terminal prompt)
};

export default function WorkspaceActiveRepoCard({
  repo,
  repoPath,
  summary,
  pullRequest,
  verificationState,
  changeCount,
  onSwitchRepo,
  showRepoSelector,
}: WorkspaceActiveRepoCardProps) {
  const branch = summary?.branch ?? null;
  const hasRemote = summary?.hasRemote ?? false;
  const [launchers, setLaunchers] = useState<WorkspaceLauncher[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getWorkspaceLaunchers();
        if (!cancelled) setLaunchers(data.launchers);
      } catch {
        // ignore
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  async function handleLaunch(launcherId: string) {
    setLaunching(launcherId);
    setMenuOpen(false);
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
    <Panel
      title="Active Repository"
      subtitle={repo?.repoLabel || repoPath}
      testId="workspace-active-card"
    >
      <div className="workspace-active-info">
        <div className="workspace-active-path">{repoPath}</div>
        <div className="workspace-active-meta">
          {branch ? (
            <span className="workspace-active-branch" data-testid="workspace-branch">
              {branch}
            </span>
          ) : null}
          <span className={`workspace-verification workspace-verification-${verificationState}`} data-testid="workspace-verification">
            {verificationState === 'verified' ? 'Verified' : verificationState === 'stale' ? 'Stale' : verificationState === 'failed' ? 'Failed' : 'Unverified'}
          </span>
          {changeCount > 0 ? (
            <span className="workspace-change-count" data-testid="workspace-changes">
              {changeCount} change{changeCount !== 1 ? 's' : ''}
            </span>
          ) : null}
          {hasRemote && pullRequest ? (
            <a
              className="workspace-pr-link"
              href={pullRequest.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              PR #{pullRequest.number}
            </a>
          ) : null}
        </div>
      </div>
      <div className="workspace-launch-actions" ref={menuRef}>
        <button
          className="workspace-launch-trigger"
          type="button"
          data-testid="workspace-launch-trigger"
          aria-label="Open in"
          title="Open in"
          disabled={availableLaunchers.length === 0}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span className="workspace-launch-trigger-icon">&gt;_</span>
          <span className="workspace-launch-trigger-chevron">&#9660;</span>
        </button>
        {menuOpen && (
          <div className="workspace-launch-menu" data-testid="workspace-launch-menu">
            {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
              <div key={group} className="workspace-launch-menu-group">
                <div className="workspace-launch-menu-group-label">{GROUP_LABELS[group] || group}</div>
                {grouped.get(group)!.map((launcher) => (
                  <button
                    key={launcher.id}
                    className="workspace-launch-menu-item"
                    type="button"
                    disabled={!launcher.available || launching === launcher.id}
                    onClick={() => void handleLaunch(launcher.id)}
                    data-testid={`workspace-launch-${launcher.id}`}
                    title={launcher.available ? undefined : launcher.reason || `${launcher.label} is not available`}
                  >
                    <span className="workspace-launch-menu-item-icon" aria-hidden="true">
                      {LAUNCHER_ICONS[launcher.group] || LAUNCHER_ICONS.ides}
                    </span>
                    <span className="workspace-launch-menu-item-label">
                      {launching === launcher.id ? 'Opening...' : launcher.label}
                    </span>
                    {launcher.argsPreview ? (
                      <span className="workspace-launch-menu-item-args">{launcher.argsPreview}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
