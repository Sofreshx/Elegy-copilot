import { useEffect, useState, useCallback, useRef } from 'react';
import { useStoreValue } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';
import { navigationStore } from '../../stores/navigation';
import { repositoriesStore } from '../Repositories/repositoriesStore';
import { gitStore } from '../../stores/gitStore';
import { runGitChecks } from '../../lib/api/git';
import type { GitCheckResults } from '../../lib/api/git';
import { getWorkspaceLaunchers, launchWorkspace } from '../../lib/api/workspace';
import type { WorkspaceLauncher } from '../../lib/api/workspace';
import RepoSelectorPanel from '../Repositories/RepoSelectorPanel';
import SourcesConfigPanel from '../Repositories/SourcesConfigPanel';
import GitHubAuthBanner from '../Repositories/GitHubAuthBanner';
import { computeVerificationState, type VerificationState } from '../Repositories/verification';
import WorkspaceLocalTabs from './WorkspaceLocalTabs';
import WorkspaceDocsTab from './WorkspaceDocsTab';
import WorkspaceGitTab from './WorkspaceGitTab';
import WorkspacePlanningTab from './WorkspacePlanningTab';
import WorkspaceExecutionTab from './WorkspaceExecutionTab';
import AppIcon from '../../components/AppIcon';
import WorkspaceAssetsTab from './WorkspaceAssetsTab';
import WorkspaceReviewTab from './WorkspaceReviewTab';

export default function WorkspaceView() {
  const state = useStoreValue(repositoriesStore);
  const gitState = useStoreValue(gitStore);
  const navState = useStoreValue(navigationStore);
  const [showRepoSelector, setShowRepoSelector] = useState(false);
  const [verificationState, setVerificationState] = useState<VerificationState>('missing');
  const [checkResults, setCheckResults] = useState<GitCheckResults | null>(null);
  const [runningChecks, setRunningChecks] = useState(false);
  const [launchers, setLaunchers] = useState<WorkspaceLauncher[]>([]);
  const [launching, setLaunching] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastCheckRef = useRef<{ branch: string | null; head: string | null; changeCount: number } | null>(null);

  const LAST_WORKSPACE_LAUNCHER_KEY = 'elegy-copilot-last-workspace-launcher';

  const [lastLauncherId, setLastLauncherId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_WORKSPACE_LAUNCHER_KEY); }
    catch { return null; }
  });

  const GROUP_ORDER = ['ides', 'agents', 'terminals'] as const;
  const GROUP_LABELS: Record<string, string> = {
    ides: 'IDEs',
    agents: 'Agent CLIs',
    terminals: 'Terminals',
  };

  const LAUNCHER_ICONS: Record<string, string> = {
    ides: 'codex',
    agents: 'agent',
    terminals: 'play',
  };

  function resolveLauncherIcon(launcherId: string | null, launchers: WorkspaceLauncher[]): string {
    if (launcherId) {
      const match = launchers.find(l => l.id === launcherId);
      if (match) return LAUNCHER_ICONS[match.group] || LAUNCHER_ICONS.ides;
    }
    // Default: first available launcher
    const first = launchers.find(l => l.available);
    if (first) return LAUNCHER_ICONS[first.group] || LAUNCHER_ICONS.ides;
    // Fallback
    const firstAny = launchers[0];
    if (firstAny) return LAUNCHER_ICONS[firstAny.group] || LAUNCHER_ICONS.ides;
    return 'play';
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await getWorkspaceLaunchers();
        if (!cancelled) setLaunchers(data.launchers);
      } catch { /* optional */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void repositoriesStore.loadInventory();
    return () => {
      repositoriesStore.reset();
    };
  }, []);

  const selectedRepoPath =
    navState.activeWorkspaceId
    || state.selectedRepo?.repoPath
    || null;

  // When the workspace tab is the source of truth (focusWorkspace sets
  // activeWorkspaceId but does not touch repositoriesStore), resolve the
  // display repo from the inventory so the label, repoId, and planning
  // context stay consistent with the path-driven data.
  const displayRepo = selectedRepoPath
    ? (state.repos.find(
        (r) => (r.repoPath || '').replace(/\\/g, '/').toLowerCase()
               === selectedRepoPath.replace(/\\/g, '/').toLowerCase(),
      ) || state.selectedRepo)
    : null;

  useEffect(() => {
    if (selectedRepoPath) {
      void gitStore.loadStatus(selectedRepoPath);
    }
  }, [selectedRepoPath]);

  const updateVerification = useCallback(() => {
    const hasRun = lastCheckRef.current !== null;
    const result = computeVerificationState({
      hasCheckRun: hasRun,
      checkPassed: hasRun ? (checkResults?.allPassed ?? false) : false,
      branch: gitState.summary?.branch ?? null,
      headAtRun: lastCheckRef.current?.head ?? null,
      currentHead: null,
      changeCountAtRun: lastCheckRef.current?.changeCount ?? 0,
      currentChangeCount: gitState.summary?.changedFiles ?? 0,
      ciStatus: 'unavailable',
    });
    setVerificationState(result);
  }, [checkResults, gitState.summary]);

  useEffect(() => {
    updateVerification();
  }, [updateVerification]);

  async function handleRunChecks() {
    if (!selectedRepoPath) return;
    setRunningChecks(true);
    try {
      const results = await runGitChecks(selectedRepoPath);
      setCheckResults(results);
      lastCheckRef.current = {
        branch: gitState.summary?.branch ?? null,
        head: null,
        changeCount: gitState.summary?.changedFiles ?? 0,
      };
    } catch (err) {
      notificationStore.error('Check run failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunningChecks(false);
    }
  }

  function handleOpenPR() {
    const pr = gitState.pullRequest?.pullRequest;
    if (pr?.url) {
      window.open(pr.url, '_blank', 'noopener,noreferrer');
    }
  }

  // ─── Group launchers ─────────────────────────────────────────────────────
  const grouped = new Map<string, WorkspaceLauncher[]>();
  for (const l of launchers) {
    const group = l.group || 'unknown';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(l);
  }
  const availableLaunchers = launchers.filter((l) => l.available);

  const triggerIcon = launching ? 'refresh' as const : resolveLauncherIcon(lastLauncherId, launchers);

  // ─── Launch handler ──────────────────────────────────────────────────────
  async function handleLaunch(launcherId: string) {
    if (!selectedRepoPath) return;
    setLaunching(launcherId);
    setMenuOpen(false);
    try {
      const result = await launchWorkspace(launcherId, selectedRepoPath);
      if (!result.ok) {
        notificationStore.error('Launch failed', { message: `Failed to open ${launcherId}` });
      } else {
        setLastLauncherId(launcherId);
        try { localStorage.setItem(LAST_WORKSPACE_LAUNCHER_KEY, launcherId); } catch {}
      }
    } catch (err) {
      notificationStore.error('Launch failed', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLaunching(null);
    }
  }

  // ─── Stabilized callbacks ───────────────────────────────────────────────
  const handleCommit = useCallback(() => { void gitStore.commit(); }, []);
  const handlePush = useCallback(() => { void gitStore.push(); }, []);
  const handleCreatePR = useCallback(() => { void gitStore.createPullRequest(); }, []);

  // ─── Close menu on outside click ─────────────────────────────────────────
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

  return (
    <div className="workspace-view" data-testid="workspace-view">
      {selectedRepoPath ? (
        <div className="workspace-layout">
          {/* Floating local tab switcher and launcher */}
          <div className="workspace-local-tabs-row" data-testid="workspace-local-tabs-row">
            <WorkspaceLocalTabs
              activeTab={navState.activeWorkspaceLocalTab}
              onTabChange={(tab) => navigationStore.setActiveWorkspaceLocalTab(tab)}
            />
            <div className="workspace-launch-actions" ref={menuRef}>
              <button
                className="workspace-launch-trigger"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="Open in..."
                title="Open in..."
                disabled={availableLaunchers.length === 0}
                type="button"
              >
                <AppIcon name={triggerIcon as any} size={18} className="workspace-launch-trigger-icon" />
                <span className="workspace-launch-trigger-label">Open in...</span>
                <AppIcon name="chevron-down" size={12} className="workspace-launch-trigger-chevron" />
              </button>
              {menuOpen && (
                <div className="workspace-launch-menu" data-testid="workspace-launch-menu">
                  {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
                    <div key={group} className="workspace-launch-menu-group">
                      <div className="workspace-launch-menu-group-label">
                        <AppIcon name={(LAUNCHER_ICONS[group] || 'play') as any} size={14} className="workspace-launch-menu-group-icon" />
                        {GROUP_LABELS[group] || group}
                      </div>
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
                          <AppIcon name={(LAUNCHER_ICONS[launcher.group] || 'play') as any} size={15} className="workspace-launch-menu-item-icon" />
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
          </div>

          {showRepoSelector ? (
            <div className="workspace-repo-selector" data-testid="workspace-repo-selector">
              <SourcesConfigPanel />
              <RepoSelectorPanel />
            </div>
          ) : null}

          <GitHubAuthBanner repoPath={selectedRepoPath} />

          <div className="workspace-tab-content" data-testid="workspace-tab-content">
            {navState.activeWorkspaceLocalTab === 'docs' && (
              <WorkspaceDocsTab
                repoPath={selectedRepoPath}
                isFocused={navState.isWorkspaceCenterFocused}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'git' && (
              <WorkspaceGitTab
                repo={displayRepo}
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
                gitState={gitState}
                verificationState={verificationState}
                checkResults={checkResults}
                runningChecks={runningChecks}
                onRunChecks={handleRunChecks}
                onCommit={handleCommit}
                onPush={handlePush}
                onOpenPR={handleOpenPR}
                onCreatePR={handleCreatePR}
                onSetCommitMessage={(msg: string) => gitStore.setCommitMessage(msg)}
                onSetPullRequestTitle={(t: string) => gitStore.setPullRequestTitle(t)}
                onSetPullRequestBody={(b: string) => gitStore.setPullRequestBody(b)}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'planning' && (
              <WorkspacePlanningTab
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
              />
            )}
            {navState.activeWorkspaceLocalTab === 'execution' && (
              <WorkspaceExecutionTab repoPath={selectedRepoPath} launchers={launchers} />
            )}
            {navState.activeWorkspaceLocalTab === 'assets' && (
              <WorkspaceAssetsTab repoPath={selectedRepoPath} />
            )}
            {navState.activeWorkspaceLocalTab === 'review' && (
              <WorkspaceReviewTab
                repoPath={selectedRepoPath}
                repoId={displayRepo?.repoId ?? null}
              />
            )}
          </div>

          {gitState.error ? (
            <div className="workspace-error" data-testid="workspace-error">{gitState.error}</div>
          ) : null}
        </div>
      ) : (
        <div className="workspace-empty-layout">
          <div className="workspace-sidebar">
            <SourcesConfigPanel />
            <RepoSelectorPanel />
          </div>
          <div className="workspace-main">
            <div className="workspace-empty" data-testid="workspace-empty">
              <p className="state-message">
                Select a repository from the list or configure scan roots to discover repositories.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
