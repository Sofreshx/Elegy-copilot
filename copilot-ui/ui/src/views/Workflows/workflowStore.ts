import { createStore } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';

// ── Data types ──

export interface WorkflowStep {
  stepId: string;
  label: string;
  type: 'session' | 'approval' | 'hook';
  objective?: string;
  actorRole?: string;
  isolationMode?: string;
  approvalRequired?: boolean;
  approvalMessage?: string;
  agentId?: string | null;
  model?: string | null;
}

export interface WorkflowSchedule {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface WorkflowTemplate {
  templateId: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  schedule: WorkflowSchedule | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  stepId: string;
  label: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-approval' | 'skipped';
  sessionId: string | null;
  executorJobId: string | null;
  executorRunId: string | null;
  startedAt?: string;
  completedAt?: string;
  outcome?: string;
  error?: string | null;
  contextOutput?: string | null;
}

export interface WorkflowRun {
  workflowRunId: string;
  templateId: string;
  projectId?: string;
  repoPath?: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStepIndex: number;
  steps: WorkflowRunStep[];
  launchedAt: string;
  updatedAt: string;
}

// ── Store state ──

interface WorkflowStoreState {
  templates: WorkflowTemplate[];
  runs: WorkflowRun[];
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: WorkflowStoreState = {
  templates: [],
  runs: [],
  loading: false,
  error: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

function createWorkflowStore() {
  const store = createStore<WorkflowStoreState>(INITIAL_STATE);

  async function loadTemplates(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const res = await fetch('/api/workflows/templates');
      if (!res.ok) throw new Error(`Failed to load templates (${res.status})`);
      const data = await res.json();
      store.setState((state) => ({
        ...state,
        templates: data.templates ?? [],
        loading: false,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function loadRuns(filters?: { projectId?: string; status?: string }): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));

    try {
      const params = new URLSearchParams();
      if (filters?.projectId) params.set('projectId', filters.projectId);
      if (filters?.status) params.set('status', filters.status);
      const qs = params.toString();
      const url = qs ? `/api/workflows/runs?${qs}` : '/api/workflows/runs';

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load runs (${res.status})`);
      const data = await res.json();
      store.setState((state) => ({
        ...state,
        runs: data.runs ?? [],
        loading: false,
      }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function createTemplate(
    data: Pick<WorkflowTemplate, 'name' | 'description' | 'steps'>,
  ): Promise<WorkflowTemplate | null> {
    try {
      const res = await fetch('/api/workflows/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to create template (${res.status})`);
      const created: WorkflowTemplate = await res.json();
      store.setState((state) => ({
        ...state,
        templates: [...state.templates, created],
      }));
      notificationStore.success('Template created', { message: created.name });
      return created;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to create template', { message: toErrorMessage(error) });
      return null;
    }
  }

  async function updateTemplate(
    id: string,
    data: Partial<Pick<WorkflowTemplate, 'name' | 'description' | 'steps'>>,
  ): Promise<WorkflowTemplate | null> {
    try {
      const res = await fetch(`/api/workflows/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(`Failed to update template (${res.status})`);
      const updated: WorkflowTemplate = await res.json();
      store.setState((state) => ({
        ...state,
        templates: state.templates.map((t) => (t.templateId === id ? updated : t)),
      }));
      notificationStore.success('Template updated');
      return updated;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to update template', { message: toErrorMessage(error) });
      return null;
    }
  }

  async function deleteTemplate(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/workflows/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to delete template (${res.status})`);
      store.setState((state) => ({
        ...state,
        templates: state.templates.filter((t) => t.templateId !== id),
      }));
      notificationStore.success('Template deleted');
      return true;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to delete template', { message: toErrorMessage(error) });
      return false;
    }
  }

  async function launchRun(templateId: string, projectId?: string, repoPath?: string): Promise<WorkflowRun | null> {
    try {
      const res = await fetch('/api/workflows/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, projectId, repoPath }),
      });
      if (!res.ok) throw new Error(`Failed to launch run (${res.status})`);
      const run: WorkflowRun = await res.json();
      store.setState((state) => ({
        ...state,
        runs: [run, ...state.runs],
      }));
      const templateName = store.getState().templates.find(
        (t) => t.templateId === run.templateId,
      )?.name ?? 'Workflow';
      notificationStore.success('Workflow launched', { message: templateName });
      return run;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to launch workflow', { message: toErrorMessage(error) });
      return null;
    }
  }

  async function retryStep(runId: string, stepIndex: number): Promise<WorkflowRun | null> {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepIndex }),
      });
      if (!res.ok) throw new Error(`Failed to retry step (${res.status})`);
      return await res.json();
    } catch (error) {
      notificationStore.error('Failed to retry step', { message: toErrorMessage(error) });
      return null;
    }
  }

  function subscribeToRunEvents(runId: string, onEvent: (event: any) => void): () => void {
    const source = new EventSource(`/api/workflows/runs/${runId}/events`);
    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        onEvent(event);
      } catch { /* ignore parse errors */ }
    };
    source.onerror = () => {
      // Reconnect is handled by browser EventSource default behavior
    };
    return () => source.close();
  }

  async function updateSchedule(templateId: string, schedule: Partial<WorkflowSchedule>): Promise<WorkflowTemplate | null> {
    try {
      const res = await fetch(`/api/workflows/templates/${templateId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      if (!res.ok) throw new Error(`Failed to update schedule (${res.status})`);
      const updated: WorkflowTemplate = await res.json();
      store.setState((state) => ({
        ...state,
        templates: state.templates.map((t) => (t.templateId === templateId ? updated : t)),
      }));
      notificationStore.success('Schedule updated');
      return updated;
    } catch (error) {
      notificationStore.error('Failed to update schedule', { message: toErrorMessage(error) });
      return null;
    }
  }

  async function seedTemplates(): Promise<void> {
    try {
      const res = await fetch('/api/workflows/seed', { method: 'POST' });
      if (!res.ok) throw new Error(`Failed to seed templates (${res.status})`);
      const data = await res.json();
      notificationStore.success(`Seeded ${data.seeded?.length ?? 0} templates`);
      await loadTemplates();
    } catch (error) {
      notificationStore.error('Failed to seed templates', { message: toErrorMessage(error) });
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadTemplates(), loadRuns()]);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadTemplates,
    loadRuns,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    launchRun,
    retryStep,
    subscribeToRunEvents,
    updateSchedule,
    seedTemplates,
    refresh,
  };
}

export const workflowStore = createWorkflowStore();
