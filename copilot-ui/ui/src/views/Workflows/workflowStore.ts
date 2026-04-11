import { createStore } from '../../lib/store';
import { notificationStore } from '../../stores/notificationStore';

// ── Data types ──

export interface WorkflowStep {
  id: string;
  label: string;
  type: 'session' | 'approval' | 'script';
  objective?: string;
  actorRole?: string;
  isolationMode?: string;
  approvalMessage?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStep {
  id: string;
  label: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-approval' | 'skipped';
  startedAt?: string;
  completedAt?: string;
  outcome?: string;
}

export interface WorkflowRun {
  id: string;
  templateId: string;
  templateName: string;
  projectId?: string;
  status: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStepIndex: number;
  steps: WorkflowRunStep[];
  createdAt: string;
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
        templates: state.templates.map((t) => (t.id === id ? updated : t)),
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
        templates: state.templates.filter((t) => t.id !== id),
      }));
      notificationStore.success('Template deleted');
      return true;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to delete template', { message: toErrorMessage(error) });
      return false;
    }
  }

  async function launchRun(templateId: string, projectId?: string): Promise<WorkflowRun | null> {
    try {
      const res = await fetch('/api/workflows/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, projectId }),
      });
      if (!res.ok) throw new Error(`Failed to launch run (${res.status})`);
      const run: WorkflowRun = await res.json();
      store.setState((state) => ({
        ...state,
        runs: [run, ...state.runs],
      }));
      notificationStore.success('Workflow launched', { message: run.templateName });
      return run;
    } catch (error) {
      store.setState((state) => ({ ...state, error: toErrorMessage(error) }));
      notificationStore.error('Failed to launch workflow', { message: toErrorMessage(error) });
      return null;
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
    refresh,
  };
}

export const workflowStore = createWorkflowStore();
