import { useEffect, useMemo, useState } from 'react';
import { Button, FormInput, Panel, Toolbar } from '../../components';
import { humanizeToken, resolveSessionStatus, summarizeSdkHealth } from '../../lib/stateDiagnostics';
import { useStoreValue } from '../../lib/store';
import type { CatalogRepoInventoryEntry } from '../../lib/types';
import { navigationStore } from '../../stores/navigation';
import { sdkHealthStore } from '../../stores/sdkHealthStore';
import { gatewayStore } from '../Gateway/gatewayStore';
import { uiRuntimeOverlayStore } from '../Executor/uiRuntimeOverlayStore';
import { sandboxesStore } from '../Sandboxes/sandboxesStore';
import SessionDetail from './SessionDetail';
import SessionWorkspaceDetail from './SessionWorkspaceDetail';
import SessionsWorkspaceBrowser from './SessionsWorkspaceBrowser';
import OverlaySessionsWorkspace from './OverlaySessionsWorkspace';
import SdkMessageList from './SdkMessageList';
import { sdkSessionsStore } from './sdkSessionsStore';
import { sessionsStore } from './sessionsStore';
import { sessionsWorkspaceStore } from './sessionsWorkspaceStore';

function parseTaskIds(value: string): string[] {
  return Array.from(new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ));
}

function buildSdkOrchestrationPayload(input: {
  repo: CatalogRepoInventoryEntry | null;
  objective: string;
  taskIdsText: string;
  actorLabel: string;
  actorRole: string;
  worktreeMode: string;
  worktreeId: string;
  worktreePath: string;
  contextType: string;
  sandboxId: string;
}): Record<string, unknown> | undefined {
  const taskIds = parseTaskIds(input.taskIdsText);
  const repoId = typeof input.repo?.repoId === 'string' ? input.repo.repoId.trim() : '';
  const repoPath = typeof input.repo?.repoPath === 'string' ? input.repo.repoPath.trim() : '';
  const repoLabel = typeof input.repo?.repoLabel === 'string' ? input.repo.repoLabel.trim() : '';
  const objective = input.objective.trim();
  const actorLabel = input.actorLabel.trim();
  const actorRole = input.actorRole.trim();
  const worktreeMode = input.worktreeMode.trim();
  const worktreeId = input.worktreeId.trim();
  const worktreePath = input.worktreePath.trim();
  const sandboxId = input.sandboxId.trim();

  const explicitWorktreeMode = worktreeMode && (worktreeMode !== 'shared' || !!worktreeId || !!worktreePath || !!sandboxId)
    ? worktreeMode
    : '';

  if (!repoId && !repoPath && !objective && taskIds.length === 0 && !actorLabel && !actorRole && !explicitWorktreeMode && !worktreeId && !worktreePath && !sandboxId) {
    return undefined;
  }

  return {
    ...(objective ? { objective } : {}),
    repo: {
      ...(repoId ? { repoId } : {}),
      ...(repoPath ? { repoPath } : {}),
      ...(repoLabel ? { repoLabel } : {}),
      source: repoId || repoPath ? 'catalog' : 'runtime',
    },
    isolation: {
      ...(explicitWorktreeMode ? { mode: explicitWorktreeMode } : {}),
      ...(input.contextType.trim() ? { contextType: input.contextType.trim() } : {}),
      ...(sandboxId ? { sandboxId } : {}),
      ...(worktreeId ? { worktreeId } : {}),
      ...(worktreePath ? { worktreePath } : {}),
    },
    ...(taskIds.length > 0 ? { taskRefs: taskIds.map((taskId) => ({ taskId })) } : {}),
    ...(actorLabel || actorRole
      ? {
        actors: [{
          actorId: actorLabel || actorRole || 'operator',
          label: actorLabel || actorRole || 'operator',
          role: actorRole || 'operator',
          source: 'ui-launch',
          taskIds,
        }],
      }
      : {}),
    workflow: {
      workflowKind: 'task-execution',
      trigger: 'manual',
      mode: 'manual',
      status: 'launching',
    },
  };
}

export default function SessionsView({ preferredMode = 'local' }: { preferredMode?: 'local' | 'sdk' }) {
  const [mode, setMode] = useState<'local' | 'sdk'>(preferredMode);
  const [createModel, setCreateModel] = useState('');
  const [launchObjective, setLaunchObjective] = useState('');
  const [launchTaskIds, setLaunchTaskIds] = useState('');
  const [launchActorLabel, setLaunchActorLabel] = useState('');
  const [launchActorRole, setLaunchActorRole] = useState('implementer');
  const [launchWorktreeMode, setLaunchWorktreeMode] = useState('shared');
  const [launchWorktreeId, setLaunchWorktreeId] = useState('');
  const [launchWorktreePath, setLaunchWorktreePath] = useState('');
  const [sandboxLaunchId, setSandboxLaunchId] = useState('');
  const [sandboxLaunching, setSandboxLaunching] = useState(false);
  const [sandboxLaunchStatus, setSandboxLaunchStatus] = useState<string | null>(null);
  const [sandboxLaunchError, setSandboxLaunchError] = useState<string | null>(null);
  const localSessionState = useStoreValue(sessionsStore);
  const sdkSessionState = useStoreValue(sdkSessionsStore);
  const sdkHealthState = useStoreValue(sdkHealthStore);
  const gatewayState = useStoreValue(gatewayStore);
  const overlayState = useStoreValue(uiRuntimeOverlayStore);
  const workspaceState = useStoreValue(sessionsWorkspaceStore);

  useEffect(() => {
    void sessionsStore.loadSessions();
    void sessionsWorkspaceStore.load();
    void gatewayStore.refreshState(false);
    void uiRuntimeOverlayStore.load();

    return () => {
      sdkSessionsStore.dispose();
    };
  }, []);

  useEffect(() => {
    if (mode === 'sdk') {
      void sdkSessionsStore.loadSessions();
      return;
    }

    sdkSessionsStore.detachStream();
  }, [mode]);

  useEffect(() => {
    if (preferredMode !== mode) {
      setMode(preferredMode);
    }
  }, [mode, preferredMode]);

  const selectedSession =
    localSessionState.sessions.find((session) => session.id === localSessionState.selectedSessionId) ?? null;
  const selectedSessionOrchestration = selectedSession
    ? (localSessionState.sessionOrchestrationById[selectedSession.id] ?? null)
    : null;
  const workspaceEntries = workspaceState.selectedView === 'history' ? workspaceState.history : workspaceState.active;
  const selectedWorkspaceEntry =
    workspaceEntries.find((entry) => entry.entryId === workspaceState.selectedEntryId) ?? workspaceEntries[0] ?? null;
  const selectedWorkspaceArtifactSession =
    selectedWorkspaceEntry?.detail?.canOpenArtifacts && selectedWorkspaceEntry.sessionId
      ? (localSessionState.sessions.find((session) => session.id === selectedWorkspaceEntry.sessionId) ?? null)
      : null;
  const selectedWorkspaceArtifactOrchestration = selectedWorkspaceArtifactSession
    ? (localSessionState.sessionOrchestrationById[selectedWorkspaceArtifactSession.id] ?? null)
    : null;
  const liveCount = localSessionState.sessions.filter((session) => resolveSessionStatus(session) === 'active').length;
  const selectedSessionTasks = Array.isArray(selectedWorkspaceArtifactOrchestration?.taskBoard?.items)
    ? selectedWorkspaceArtifactOrchestration.taskBoard.items
    : [];
  const selectedRepo = overlayState.selectedRepo;

  const selectedSdkSessionId = sdkSessionState.selectedSessionId;
  const selectedSdkMessages = selectedSdkSessionId
    ? (sdkSessionState.messagesBySession[selectedSdkSessionId] ?? [])
    : [];
  const pendingSdkMessage = selectedSdkSessionId
    ? (sdkSessionState.pendingBySession[selectedSdkSessionId] ?? { content: '', reasoning: '' })
    : { content: '', reasoning: '' };

  const selectedSdkSession = useMemo(
    () => sdkSessionState.sessions.find((session) => session.sessionId === selectedSdkSessionId) ?? null,
    [sdkSessionState.sessions, selectedSdkSessionId]
  );

  const modeError = mode === 'local' ? (workspaceState.error || localSessionState.error) : sdkSessionState.error;
  const sdkHealthSummary = summarizeSdkHealth(sdkHealthState.health, sdkHealthState.error);

  const trackerSegment =
    gatewayState.stateEnvelope?.tracker && typeof gatewayState.stateEnvelope.tracker === 'object'
      ? (gatewayState.stateEnvelope.tracker as Record<string, unknown>)
      : null;
  const trackerReason =
    trackerSegment?.error && typeof trackerSegment.error === 'object'
      ? (trackerSegment.error as Record<string, unknown>)
      : null;

  const localConnectionStatus = localSessionState.error
    ? 'Blocked'
    : localSessionState.loading
      ? 'Checking'
      : liveCount > 0
        ? 'Live'
        : 'Idle';
  const localConnectionDetail = localSessionState.error
    ? localSessionState.error
    : `${localSessionState.sessions.length} session(s), ${liveCount} with confirmed live runtime evidence.`;

  const sandboxConnectionStatus = gatewayState.sandboxTokenMissing
    ? 'Blocked'
    : trackerSegment?.ready === true
      ? 'Connected'
      : humanizeToken(typeof trackerSegment?.status === 'string' ? trackerSegment.status : 'unknown');
  const sandboxConnectionDetail = gatewayState.sandboxTokenMissing
    ? (gatewayState.sandboxTokenGuidance || 'Gateway auth is missing for sandbox lifecycle actions.')
    : (typeof trackerReason?.message === 'string' && trackerReason.message.trim()
      ? trackerReason.message
      : 'Sandbox lifecycle follows gateway transport readiness and token policy.');
  const sandboxLifecycleBlocked = gatewayState.sandboxTokenMissing;

  const handleRefresh = async () => {
    if (mode === 'local') {
      await Promise.all([
        sessionsStore.refresh(),
        sessionsWorkspaceStore.refresh(),
      ]);
      return;
    }

    await sdkSessionsStore.loadSessions();
  };

  const handleSelectWorkspaceEntry = (entryId: string) => {
    sessionsWorkspaceStore.selectEntry(entryId);
    const entry = workspaceEntries.find((candidate) => candidate.entryId === entryId);
    if (entry?.detail?.canOpenArtifacts && entry.sessionId) {
      sessionsStore.selectSession(entry.sessionId);
    }
  };

  const handleCreateSdkSession = async () => {
    await sdkSessionsStore.createSession({
      model: createModel,
      contextType: sandboxLaunchId.trim() ? 'sandbox' : 'regular',
      sandboxId: sandboxLaunchId.trim() || undefined,
      orchestration: buildSdkOrchestrationPayload({
        repo: selectedRepo,
        objective: launchObjective,
        taskIdsText: launchTaskIds,
        actorLabel: launchActorLabel,
        actorRole: launchActorRole,
        worktreeMode: launchWorktreeMode,
        worktreeId: launchWorktreeId,
        worktreePath: launchWorktreePath,
        contextType: sandboxLaunchId.trim() ? 'sandbox' : 'regular',
        sandboxId: sandboxLaunchId,
      }),
    });
    setCreateModel('');
  };

  const handleLaunchSandboxSdkSession = async () => {
    const normalizedSandboxId = sandboxLaunchId.trim();
    if (!normalizedSandboxId) {
      setSandboxLaunchError('Sandbox ID is required to launch an isolated SDK session.');
      setSandboxLaunchStatus(null);
      return;
    }

    setSandboxLaunching(true);
    setSandboxLaunchError(null);
    setSandboxLaunchStatus('Preparing sandbox...');
    sandboxesStore.setSandboxId(normalizedSandboxId);

    try {
      try {
        await sandboxesStore.createSandbox();
      } catch (error) {
        const createMessage = error instanceof Error ? error.message : String(error);
        if (!/already exists/i.test(createMessage)) {
          throw error;
        }
      }

      setSandboxLaunchStatus('Starting sandbox...');
      await sandboxesStore.startSandbox();

      setSandboxLaunchStatus('Creating isolated SDK session...');
      await sdkSessionsStore.createSession({
        model: createModel,
        contextType: 'sandbox',
        sandboxId: normalizedSandboxId,
        orchestration: buildSdkOrchestrationPayload({
          repo: selectedRepo,
          objective: launchObjective,
          taskIdsText: launchTaskIds,
          actorLabel: launchActorLabel,
          actorRole: launchActorRole,
          worktreeMode: 'sandbox',
          worktreeId: launchWorktreeId,
          worktreePath: launchWorktreePath,
          contextType: 'sandbox',
          sandboxId: normalizedSandboxId,
        }),
      });

      setSandboxLaunchStatus(`Sandbox SDK session ready: ${normalizedSandboxId}`);
      setSandboxLaunchError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to launch sandbox SDK session.';
      setSandboxLaunchError(message);
      setSandboxLaunchStatus(null);
    } finally {
      setSandboxLaunching(false);
    }
  };

  const handleOpenSandboxTerminal = async () => {
    const normalizedSandboxId = sandboxLaunchId.trim();
    if (!normalizedSandboxId) {
      setSandboxLaunchError('Sandbox ID is required to open a sandbox terminal.');
      setSandboxLaunchStatus(null);
      return;
    }

    setSandboxLaunching(true);
    setSandboxLaunchError(null);
    setSandboxLaunchStatus('Opening sandbox terminal...');
    sandboxesStore.setSandboxId(normalizedSandboxId);

    try {
      await sandboxesStore.openSandboxTerminal();
      setSandboxLaunchStatus(`Sandbox terminal opened: ${normalizedSandboxId}`);
      setSandboxLaunchError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open sandbox terminal.';
      setSandboxLaunchError(message);
      setSandboxLaunchStatus(null);
    } finally {
      setSandboxLaunching(false);
    }
  };

  const handleDeleteSdkSession = async () => {
    if (!selectedSdkSessionId) {
      return;
    }

    await sdkSessionsStore.removeSession(selectedSdkSessionId);
  };

  const handleSendSdkMessage = async () => {
    await sdkSessionsStore.sendPrompt();
  };

  return (
    <section className="sessions-view" data-testid="sessions-view">
      <Toolbar testId="sessions-view-toolbar">
        <div className="sessions-summary">
          <p className="sessions-title">{mode === 'local' ? 'Runtime Sessions' : 'SDK Sessions'}</p>
          <p className="sessions-copy">
            {mode === 'local'
              ? `${localSessionState.sessions.length} total, ${liveCount} live`
              : `${sdkSessionState.sessions.length} total, stream ${sdkSessionState.streamStatus}`}
          </p>
        </div>

        <div className="showcase-toolbar-group showcase-toolbar-group-stable">
          <Button
            onClick={() => setMode('local')}
            testId="sessions-mode-local"
            variant={mode === 'local' ? 'primary' : 'ghost'}
          >
            Local
          </Button>
          <Button
            onClick={() => setMode('sdk')}
            testId="sessions-mode-sdk"
            variant={mode === 'sdk' ? 'primary' : 'ghost'}
          >
            SDK
          </Button>
          <Button
            disabled={mode === 'local' ? localSessionState.loading : sdkSessionState.loading}
            onClick={handleRefresh}
            testId="sessions-view-refresh"
            variant="secondary"
          >
            {(mode === 'local' ? localSessionState.loading : sdkSessionState.loading)
              ? 'Refreshing...'
              : 'Refresh'}
          </Button>
        </div>
      </Toolbar>

      <div className="sessions-connection-grid" data-testid="sessions-connection-grid">
        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Local Sessions</p>
          <p className="sessions-connection-status">{localConnectionStatus}</p>
          <p className="sessions-connection-copy">{localConnectionDetail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">SDK Bridge</p>
          <p className="sessions-connection-status">{sdkHealthSummary.status}</p>
          <p className="sessions-connection-copy">{sdkHealthSummary.detail}</p>
        </article>

        <article className="sessions-connection-card">
          <p className="sessions-connection-title">Sandbox Lifecycle</p>
          <p className="sessions-connection-status">{sandboxConnectionStatus}</p>
          <p className="sessions-connection-copy">{sandboxConnectionDetail}</p>
        </article>
      </div>

      <Panel
        subtitle="Keep app-level sessions, in-session actors, and worktree isolation explicit before launching or resuming work."
        testId="sessions-operator-launch-context-panel"
        title="Operator Launch Context"
      >
        <div className="state-card-grid">
          <article className="state-card">
            <div className="state-card-header">
              <p className="state-card-title">Selected repo</p>
            </div>
            <p className="state-card-copy">
              {selectedRepo
                ? `${selectedRepo.repoLabel || selectedRepo.repoId} | ${selectedRepo.repoPath || '(repo path unavailable)'}`
                : 'No Catalog repo is selected yet.'}
            </p>
            <p className="state-card-detail">
              {selectedRepo
                ? 'This repo context seeds orchestrated SDK launches and overlay handoff.'
                : 'Select a repo in Catalog or Planning, then return here to launch an orchestrated session with repo-aware context.'}
            </p>
          </article>

          <article className="state-card">
            <div className="state-card-header">
              <p className="state-card-title">App-level session</p>
            </div>
            <p className="state-card-copy">{selectedSession?.id || 'No local runtime session selected.'}</p>
            <p className="state-card-detail">
              {selectedSessionOrchestration?.repo
                ? `${selectedSessionOrchestration.repo.repoLabel || selectedSessionOrchestration.repo.repoId || 'runtime repo'} | ${selectedSessionOrchestration.isolation?.mode || 'shared'} isolation`
                : 'Select a local session to inspect runtime-owned orchestration overlays and durable repo-state tasks.'}
            </p>
          </article>

          <article className="state-card">
            <div className="state-card-header">
              <p className="state-card-title">In-session actors</p>
            </div>
            <p className="state-card-copy">
              {selectedSessionOrchestration?.actors?.items?.length
                ? `${selectedSessionOrchestration.actors.items.length} runtime actor overlay(s) reported`
                : 'No actor overlays loaded.'}
            </p>
            <p className="state-card-detail">
              {selectedSessionOrchestration?.actors?.items?.length
                ? selectedSessionOrchestration.actors.items
                  .map((actor) => `${actor.label || actor.actorId} (${humanizeToken(actor.role || 'unknown')})`)
                  .join(' | ')
                : 'Actor metadata stays runtime-scoped; durable task ownership remains repo-state.'}
            </p>
          </article>

          <article className="state-card">
            <div className="state-card-header">
              <p className="state-card-title">Worktree isolation</p>
            </div>
            <p className="state-card-copy">
              {selectedSessionOrchestration?.isolation?.worktreeId
                ? `${selectedSessionOrchestration.isolation.worktreeId} | ${selectedSessionOrchestration.isolation.worktreeStatus || selectedSessionOrchestration.isolation.mode || 'unknown'}`
                : launchWorktreeMode
                  ? `${launchWorktreeMode} launch mode`
                  : 'Shared repo checkout'}
            </p>
            <p className="state-card-detail">
              {selectedSessionOrchestration?.isolation?.worktreePath
                || launchWorktreePath
                || 'Use dedicated worktrees for parallel writable same-repo sessions; sub-actors stay inside the parent session worktree.'}
            </p>
          </article>
        </div>
      </Panel>

      <Panel
        subtitle="Attach-first overlay sessions use the existing runtime overlay store and API family. Resume or inspect them here, then hand off deep editing and queue work to Executor."
        testId="runtime-overlay-sessions-panel"
        title="Overlay Sessions"
      >
        <OverlaySessionsWorkspace />
      </Panel>

      {modeError ? (
        <p className="sessions-error" role="alert">
          {modeError}
        </p>
      ) : null}

      {mode === 'local' ? (
        <>
          <div className="sessions-grid">
            <Panel
              subtitle="Runtime-first Active and durable History stay inside the frozen Sessions workspace."
              testId="sessions-list-panel"
              title="Session Workspace"
            >
              <SessionsWorkspaceBrowser
                active={workspaceState.active}
                error={workspaceState.error}
                history={workspaceState.history}
                loading={workspaceState.loading}
                onSelectEntry={handleSelectWorkspaceEntry}
                onSelectView={(view) => sessionsWorkspaceStore.selectView(view)}
                selectedEntryId={workspaceState.selectedEntryId}
                selectedView={workspaceState.selectedView}
              />
            </Panel>

            <Panel
              subtitle={
                selectedWorkspaceEntry?.detail?.canOpenArtifacts
                  ? 'Reuses the current artifact detail surface when durable session folders are available.'
                  : 'Summary-first detail for runtime-only or archived entries in this first slice.'
              }
              testId="session-detail-panel"
              title="Session Details"
            >
              {selectedWorkspaceEntry?.detail?.canOpenArtifacts && selectedWorkspaceArtifactSession ? (
                <SessionDetail session={selectedWorkspaceArtifactSession} />
              ) : (
                <SessionWorkspaceDetail entry={selectedWorkspaceEntry} />
              )}
            </Panel>
          </div>

          <Panel
            subtitle="Planning owns the visible repo-state task board. Sessions stays focused on launch, resume, inspection, and live overlay context for the selected session."
            testId="sessions-task-board-link-panel"
            title="Planning Task Board Link"
          >
            <div className="session-detail">
              <p className="session-detail-suggestion">
                <span>Selected session linkage:</span> {selectedWorkspaceEntry?.title || 'No session workspace entry selected.'}
              </p>
              <p className="tracker-item-copy">
                {selectedWorkspaceEntry?.workspace?.primaryRepo
                  ? `${selectedWorkspaceEntry.workspace.primaryRepo.repoLabel || selectedWorkspaceEntry.workspace.primaryRepo.repoId || 'Repo context'} remains the primary planning handoff for this entry.`
                  : 'No repo context was reported for this workspace entry yet.'}
              </p>
              <p className="tracker-item-copy">
                {selectedSessionTasks.length > 0
                  ? `${selectedSessionTasks.length} durable repo-state task(s) are linked to the selected session. Open Planning for the primary board view.`
                  : 'No durable task links were reported for the selected workspace entry yet.'}
              </p>
              <p className="tracker-item-copy">
                Runtime remains session-specific here: launch/resume flows, live actor overlays, worktree context, and session inspection stay in Home / Runtime.
              </p>
            </div>
            {localSessionState.orchestrationError ? (
              <p className="sessions-error" role="alert">{localSessionState.orchestrationError}</p>
            ) : null}
            {selectedSessionTasks.length > 0 ? (
              <ul className="tracker-session-list executor-job-list">
                {selectedSessionTasks.slice(0, 5).map((task) => {
                  const taskId = typeof task?.taskId === 'string' ? task.taskId : '(unknown task)';
                  return (
                    <li key={taskId}>
                      <div>
                        <p className="tracker-item-title">{typeof task?.title === 'string' && task.title.trim() ? task.title : taskId}</p>
                        <p className="tracker-item-copy">
                          {[taskId, humanizeToken(typeof task?.status === 'string' ? task.status : 'unknown')].join(' | ')}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="state-message">Planning will show durable repo-state tasks for the selected repo even when additive runtime metadata is absent.</p>
            )}
            <div className="sessions-actions">
              {selectedWorkspaceEntry?.detail?.handoffTarget === 'sdk' ? (
                <Button
                  onClick={() => setMode('sdk')}
                  testId="sessions-open-sdk-workspace"
                  variant="secondary"
                >
                  Open SDK Sessions
                </Button>
              ) : null}
              {selectedWorkspaceEntry?.detail?.handoffTarget === 'overlay' ? (
                <Button
                  onClick={() => navigationStore.navigate('dashboard')}
                  testId="sessions-open-overlay-executor"
                  variant="secondary"
                >
                  Open Executor
                </Button>
              ) : null}
              <Button
                onClick={() => navigationStore.navigate('planning')}
                testId="sessions-open-planning-task-board"
                variant="secondary"
              >
                Open Planning Task Board
              </Button>
            </div>
          </Panel>
        </>
      ) : (
        <div className="sessions-grid">
          <Panel
            subtitle="Create, select, and stream SDK sessions with optional repo, task, actor, and worktree launch context."
            testId="sdk-sessions-list-panel"
            title="SDK Session List"
          >
            <div className="sessions-controls">
              <div className="session-detail">
                <p className="session-detail-suggestion">
                  <span>Catalog repo context:</span> {selectedRepo?.repoLabel || selectedRepo?.repoId || 'No repo selected'}
                </p>
                <p className="tracker-item-copy">
                  {selectedRepo?.repoPath || 'Select a repo in Catalog or Planning to seed repo/worktree context for new SDK sessions.'}
                </p>
              </div>

              <FormInput
                id="sdk-session-model"
                label="Model (optional)"
                onValueChange={setCreateModel}
                placeholder="gpt-5.3-codex"
                testId="sdk-session-model-input"
                value={createModel}
              />

              <FormInput
                id="sdk-session-objective"
                label="Objective (optional)"
                onValueChange={setLaunchObjective}
                placeholder="Implement the selected ready task in a dedicated worktree"
                testId="sdk-session-objective-input"
                value={launchObjective}
              />

              <FormInput
                id="sdk-session-task-ids"
                label="Durable Task IDs (comma separated)"
                onValueChange={setLaunchTaskIds}
                placeholder="TASK-20260407-001, TASK-20260407-002"
                testId="sdk-session-task-ids-input"
                value={launchTaskIds}
              />

              <div className="sandboxes-branch-grid">
                <FormInput
                  id="sdk-session-actor-label"
                  label="In-session Actor Label (optional)"
                  onValueChange={setLaunchActorLabel}
                  placeholder="Implementer lane"
                  testId="sdk-session-actor-label-input"
                  value={launchActorLabel}
                />
                <label className="form-input" htmlFor="sdk-session-actor-role">
                  <span className="form-label">In-session Actor Role</span>
                  <select
                    data-testid="sdk-session-actor-role-input"
                    id="sdk-session-actor-role"
                    onChange={(event) => setLaunchActorRole(event.target.value)}
                    value={launchActorRole}
                  >
                    {['implementer', 'planner', 'reviewer', 'researcher', 'operator', 'orchestrator'].map((role) => (
                      <option key={role} value={role}>{humanizeToken(role)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="sandboxes-branch-grid">
                <label className="form-input" htmlFor="sdk-session-worktree-mode">
                  <span className="form-label">Worktree Isolation</span>
                  <select
                    data-testid="sdk-session-worktree-mode-input"
                    id="sdk-session-worktree-mode"
                    onChange={(event) => setLaunchWorktreeMode(event.target.value)}
                    value={launchWorktreeMode}
                  >
                    {['shared', 'dedicated', 'sandbox'].map((modeOption) => (
                      <option key={modeOption} value={modeOption}>{humanizeToken(modeOption)}</option>
                    ))}
                  </select>
                </label>
                <FormInput
                  id="sdk-session-worktree-id"
                  label="Worktree ID (optional)"
                  onValueChange={setLaunchWorktreeId}
                  placeholder="instruction-engine-wt-001"
                  testId="sdk-session-worktree-id-input"
                  value={launchWorktreeId}
                />
              </div>

              <FormInput
                id="sdk-session-worktree-path"
                label="Worktree Path (optional)"
                onValueChange={setLaunchWorktreePath}
                placeholder="C:\\worktrees\\instruction-engine\\task-001"
                testId="sdk-session-worktree-path-input"
                value={launchWorktreePath}
              />

              <div className="sessions-actions">
                <Button
                  disabled={sdkSessionState.creating}
                  onClick={handleCreateSdkSession}
                  testId="sdk-session-create"
                  variant="secondary"
                >
                  {sdkSessionState.creating ? 'Creating...' : 'Create Session'}
                </Button>
                <Button
                  disabled={!selectedSdkSessionId || sdkSessionState.deleting}
                  onClick={handleDeleteSdkSession}
                  testId="sdk-session-delete"
                  variant="danger"
                >
                  {sdkSessionState.deleting ? 'Deleting...' : 'Delete Selected'}
                </Button>
              </div>

              <FormInput
                id="sdk-sandbox-id"
                label="Sandbox ID (isolated SDK launch)"
                onValueChange={setSandboxLaunchId}
                placeholder="sb-..."
                testId="sdk-sandbox-id-input"
                value={sandboxLaunchId}
              />

              <div className="sessions-actions">
                <Button
                  disabled={sandboxLaunching || sdkSessionState.creating || sandboxLifecycleBlocked}
                  onClick={handleLaunchSandboxSdkSession}
                  testId="sdk-session-launch-sandbox"
                  variant="secondary"
                >
                  {sandboxLaunching ? 'Launching...' : 'Launch Sandbox Session'}
                </Button>
                <Button
                  disabled={sandboxLaunching || sandboxLifecycleBlocked}
                  onClick={handleOpenSandboxTerminal}
                  testId="sdk-session-open-sandbox-terminal"
                  variant="ghost"
                >
                  Open Sandbox Terminal
                </Button>
              </div>

              {sandboxLifecycleBlocked ? (
                <p className="sessions-error">
                  Sandbox launch blocked: {sandboxConnectionDetail}
                </p>
              ) : null}

              {sandboxLaunchStatus ? <p className="sessions-copy">{sandboxLaunchStatus}</p> : null}
              {sandboxLaunchError ? (
                <p className="sessions-error" role="alert">
                  {sandboxLaunchError}
                </p>
              ) : null}

              {sdkSessionState.sessions.length === 0 ? (
                <p className="state-message">No SDK sessions available.</p>
              ) : (
                <ul className="tracker-session-list">
                  {sdkSessionState.sessions.map((session) => {
                    const isSelected = selectedSdkSessionId === session.sessionId;
                    return (
                      <li className={isSelected ? 'is-selected' : ''} key={session.sessionId}>
                        <div>
                          <p className="tracker-item-title">{session.sessionId}</p>
                          <p className="tracker-item-copy">
                            {session.model || '(default model)'}
                            {' | '}
                            {session.contextType || 'regular'}
                            {session.sandboxId ? `:${session.sandboxId}` : ''}
                            {' | '}
                            sse clients={session.sseClientCount ?? 0}
                          </p>
                        </div>
                        <div className="tracker-item-actions">
                          <Button
                            onClick={() => sdkSessionsStore.selectSession(session.sessionId)}
                            size="sm"
                            testId={`sdk-session-select-${session.sessionId}`}
                            variant={isSelected ? 'primary' : 'ghost'}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Panel>

          <Panel
            subtitle="Message stream with delta accumulation and reasoning details."
            testId="sdk-session-messages-panel"
            title="SDK Messages"
          >
            <p className="sessions-stream-status">
              Stream: <strong>{sdkSessionState.streamStatus}</strong>
              {sdkSessionState.streamError ? ` (${sdkSessionState.streamError})` : ''}
            </p>

            <p className="sessions-copy">
              Selected session: {selectedSdkSession?.sessionId || '(none)'}
              {selectedSdkSession?.contextType
                ? ` (${selectedSdkSession.contextType}${selectedSdkSession.sandboxId ? `:${selectedSdkSession.sandboxId}` : ''})`
                : ''}
            </p>

            <SdkMessageList
              messages={selectedSdkMessages}
              pendingContent={pendingSdkMessage.content}
              pendingReasoning={pendingSdkMessage.reasoning}
              streamStatus={sdkSessionState.streamStatus}
            />

            <label className="form-input" htmlFor="sdk-session-prompt">
              <span className="form-label">Prompt</span>
              <textarea
                data-testid="sdk-session-prompt"
                id="sdk-session-prompt"
                onChange={(event) => sdkSessionsStore.setComposerPrompt(event.target.value)}
                placeholder="Ask the SDK session..."
                rows={5}
                value={sdkSessionState.composerPrompt}
              />
            </label>

            <div className="sessions-actions">
              <Button
                disabled={
                  !selectedSdkSessionId
                  || sdkSessionState.sending
                  || sdkSessionState.composerPrompt.trim().length === 0
                }
                onClick={handleSendSdkMessage}
                testId="sdk-session-send"
              >
                {sdkSessionState.sending ? 'Sending...' : 'Send'}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </section>
  );
}
