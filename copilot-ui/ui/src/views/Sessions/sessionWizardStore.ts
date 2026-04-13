import { createStore } from '../../lib/store';
import { getCatalogRepos, createSdkSession, getPlanningBullets, SdkCreateSessionPayload } from '../../lib/api';
import type { CatalogRepoInventoryEntry, SdkSessionSummary } from '../../lib/types';
import { notificationStore } from '../../stores/notificationStore';
import { SESSION_AGENTS } from '../../constants/sessionAgents';

export interface SessionWizardState {
  step: number;
  // Step 1: Project Selection
  projects: CatalogRepoInventoryEntry[];
  projectsLoading: boolean;
  selectedProject: CatalogRepoInventoryEntry | null;
  customRepoPath: string;
  useCustomRepo: boolean;
  // Step 2: Objective
  objective: string;
  templateId: string | null;
  agentId: string;
  taskIds: string;
  // Step 3: Isolation Mode
  isolationMode: 'shared' | 'worktree' | 'sandbox';
  worktreeId: string;
  worktreePath: string;
  sandboxId: string;
  // Step 4: Confirm
  model: string;
  actorLabel: string;
  actorRole: string;
  remoteEnabled: boolean | null; // null = follow global default
  // Backlog
  backlogBullets: Array<{ id: string; title: string; state: string; summary: string; tags: string[] }>;
  backlogLoading: boolean;
  selectedBulletIds: string[];
  // Status
  launching: boolean;
  launchError: string | null;
  launchStatus: string | null;
}

const INITIAL_STATE: SessionWizardState = {
  step: 0,
  projects: [],
  projectsLoading: false,
  selectedProject: null,
  customRepoPath: '',
  useCustomRepo: false,
  objective: '',
  templateId: null,
  agentId: 'orchestrator-cli',
  taskIds: '',
  isolationMode: 'shared',
  worktreeId: '',
  worktreePath: '',
  sandboxId: '',
  model: '',
  actorLabel: '',
  actorRole: '',
  remoteEnabled: null,
  backlogBullets: [],
  backlogLoading: false,
  selectedBulletIds: [],
  launching: false,
  launchError: null,
  launchStatus: null,
};

function createSessionWizardStore() {
  const store = createStore<SessionWizardState>(INITIAL_STATE);

  async function loadProjects(): Promise<void> {
    const current = store.getState();
    if (current.projects.length > 0 || current.projectsLoading) return;

    store.setState((s) => ({ ...s, projectsLoading: true }));
    try {
      const response = await getCatalogRepos();
      store.setState((s) => ({
        ...s,
        projects: response.repos ?? [],
        projectsLoading: false,
      }));
    } catch {
      store.setState((s) => ({ ...s, projectsLoading: false }));
    }
  }

  function setStep(step: number): void {
    store.setState((s) => ({ ...s, step }));
  }

  function selectProject(project: CatalogRepoInventoryEntry | null): void {
    store.setState((s) => ({
      ...s,
      selectedProject: project,
      useCustomRepo: false,
      customRepoPath: '',
      selectedBulletIds: [],
      backlogBullets: [],
      backlogLoading: false,
    }));
    if (project?.repoPath) {
      void loadBacklog();
    }
  }

  function setCustomRepoPath(customRepoPath: string): void {
    store.setState((s) => ({
      ...s,
      customRepoPath,
      useCustomRepo: true,
      selectedProject: null,
    }));
  }

  function setObjective(objective: string): void {
    store.setState((s) => ({ ...s, objective }));
  }

  function setTemplateId(templateId: string | null): void {
    store.setState((s) => ({ ...s, templateId }));
  }

  function setAgentId(agentId: string): void {
    store.setState((s) => ({ ...s, agentId }));
  }

  function setTaskIds(taskIds: string): void {
    store.setState((s) => ({ ...s, taskIds }));
  }

  function setIsolationMode(isolationMode: SessionWizardState['isolationMode']): void {
    store.setState((s) => ({ ...s, isolationMode }));
  }

  function setWorktreeId(worktreeId: string): void {
    store.setState((s) => ({ ...s, worktreeId }));
  }

  function setWorktreePath(worktreePath: string): void {
    store.setState((s) => ({ ...s, worktreePath }));
  }

  function setSandboxId(sandboxId: string): void {
    store.setState((s) => ({ ...s, sandboxId }));
  }

  function setModel(model: string): void {
    store.setState((s) => ({ ...s, model }));
  }

  function setActorLabel(actorLabel: string): void {
    store.setState((s) => ({ ...s, actorLabel }));
  }

  function setActorRole(actorRole: string): void {
    store.setState((s) => ({ ...s, actorRole }));
  }

  function setRemoteEnabled(remoteEnabled: boolean | null): void {
    store.setState((s) => ({ ...s, remoteEnabled }));
  }

  async function loadBacklog(): Promise<void> {
    const current = store.getState();
    if (current.backlogLoading) return;

    const repoPath = current.useCustomRepo
      ? current.customRepoPath.trim()
      : current.selectedProject?.repoPath ?? null;
    if (!repoPath) return;

    store.setState((s) => ({ ...s, backlogLoading: true }));
    try {
      const response = await getPlanningBullets({ repoPath });
      const bullets = (response.artifacts ?? []).map((b) => ({
        id: b.id,
        title: b.title,
        state: b.state,
        summary: b.summary ?? '',
        tags: [] as string[],
      }));
      store.setState((s) => ({ ...s, backlogBullets: bullets, backlogLoading: false }));
    } catch {
      store.setState((s) => ({ ...s, backlogBullets: [], backlogLoading: false }));
    }
  }

  function toggleBullet(bulletId: string): void {
    store.setState((s) => ({
      ...s,
      selectedBulletIds: s.selectedBulletIds.includes(bulletId)
        ? s.selectedBulletIds.filter((id) => id !== bulletId)
        : [...s.selectedBulletIds, bulletId],
    }));
  }

  function clearBullets(): void {
    store.setState((s) => ({ ...s, selectedBulletIds: [] }));
  }

  function buildOrchestrationPayload(state: SessionWizardState): Record<string, unknown> {
    const repoPath = state.useCustomRepo
      ? state.customRepoPath.trim()
      : state.selectedProject?.repoPath ?? null;
    const repoLabel = state.useCustomRepo
      ? state.customRepoPath.trim().split(/[\\/]/).pop() ?? ''
      : state.selectedProject?.repoLabel ?? null;
    const repoId = state.useCustomRepo
      ? null
      : state.selectedProject?.repoId ?? null;

    const orchestration: Record<string, unknown> = {
      contractVersion: '2025-06-wizard',
      objective: state.objective || null,
      repo: repoPath
        ? { repoId, repoPath, repoLabel, source: 'wizard' }
        : null,
      isolation: {
        mode: state.isolationMode,
        contextType: state.isolationMode === 'sandbox' ? 'sandbox' : 'regular',
        sandboxId: state.isolationMode === 'sandbox' && state.sandboxId ? state.sandboxId : null,
        worktreeId: state.isolationMode === 'worktree' && state.worktreeId ? state.worktreeId : null,
        worktreePath: state.isolationMode === 'worktree' && state.worktreePath ? state.worktreePath : null,
      },
      workflow: state.templateId
        ? { workflowKind: state.templateId, trigger: 'wizard' }
        : null,
      agent: {
        agentId: state.agentId,
        source: 'wizard',
      },
    };

    const actors: Record<string, unknown>[] = [];
    if (state.actorLabel.trim()) {
      actors.push({
        actorId: 'primary',
        label: state.actorLabel.trim(),
        role: state.actorRole.trim() || 'assistant',
        kind: 'copilot',
        status: 'active',
      });
    }
    if (actors.length > 0) {
      orchestration.actors = { items: actors, activeActorId: 'primary' };
    }

    const taskRefs = state.taskIds
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (taskRefs.length > 0) {
      orchestration.taskBoard = {
        items: taskRefs.map((taskId) => ({ taskId, status: 'pending' })),
      };
    }

    if (state.selectedBulletIds.length > 0) {
      orchestration.backlog = {
        bulletIds: state.selectedBulletIds,
        bullets: state.backlogBullets
          .filter((b) => state.selectedBulletIds.includes(b.id))
          .map((b) => ({ id: b.id, title: b.title })),
      };
    }

    return orchestration;
  }

  async function launch(): Promise<SdkSessionSummary> {
    const state = store.getState();
    store.setState((s) => ({
      ...s,
      launching: true,
      launchError: null,
      launchStatus: 'Launching session…',
    }));

    try {
      const orchestration = buildOrchestrationPayload(state);

      const agentDef = SESSION_AGENTS.find(a => a.id === state.agentId);
      const effectiveModel = state.model.trim() || agentDef?.defaultModel || 'claude-opus-4.6';

      const payload: SdkCreateSessionPayload = {
        model: effectiveModel,
        contextType: state.isolationMode === 'sandbox' ? 'sandbox' : undefined,
        sandboxId: state.isolationMode === 'sandbox' && state.sandboxId ? state.sandboxId : undefined,
        remote: state.remoteEnabled === null ? undefined : state.remoteEnabled,
        orchestration,
      };

      const session = await createSdkSession(payload);

      store.setState((s) => ({
        ...s,
        launching: false,
        launchStatus: 'Session created',
        launchError: null,
      }));

      notificationStore.success('Session launched', { message: `Session ${session.sessionId ?? 'started'} is now active.` });

      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      store.setState((s) => ({
        ...s,
        launching: false,
        launchError: message,
        launchStatus: null,
      }));
      notificationStore.error('Session launch failed', { message });
      throw err;
    }
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    loadProjects,
    setStep,
    selectProject,
    setCustomRepoPath,
    setObjective,
    setTemplateId,
    setAgentId,
    setTaskIds,
    setIsolationMode,
    setWorktreeId,
    setWorktreePath,
    setSandboxId,
    setModel,
    setActorLabel,
    setActorRole,
    setRemoteEnabled,
    loadBacklog,
    toggleBullet,
    clearBullets,
    launch,
    reset,
  };
}

export const sessionWizardStore = createSessionWizardStore();
