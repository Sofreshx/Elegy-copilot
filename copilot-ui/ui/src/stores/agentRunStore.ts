import { createStore, type Store } from '../lib/store';

export interface AgentRunState {
  id: string;
  noteId: string | null;
  action: string;
  agentName: string;
  modelId: string | null;
  status: 'queued' | 'running' | 'completed' | 'aborted' | 'error';
  outputText: string | null;
  errorMessage: string | null;
  promptTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  events: AgentRunEvent[];
}

export interface AgentRunEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface AgentRunConfig {
  noteId: string | null;
  action: string;
  agentName: string;
  modelId?: string;
  providerId?: string;
  extraInstructions?: string;
  repoAccessEnabled?: boolean;
  runInBackground?: boolean;
}

interface AgentRunStoreState {
  runs: Record<string, AgentRunState>;
  activeRunId: string | null;
  activeEventSource: EventSource | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: AgentRunStoreState = {
  runs: {},
  activeRunId: null,
  activeEventSource: null,
  loading: false,
  error: null,
};

const store = createStore<AgentRunStoreState>(INITIAL_STATE);

// ── Exported actions ──

export async function startRun(config: AgentRunConfig): Promise<string> {
  store.setState((s) => ({ ...s, loading: true, error: null }));
  try {
    const body: Record<string, unknown> = {
      parent_kind: 'note',
      parent_id: config.noteId,
      note_id: config.noteId,
      action: config.action,
      agent_name: config.agentName,
      model_id: config.modelId || null,
      provider_id: config.providerId || null,
      extra_instructions: config.extraInstructions || null,
      repo_access_enabled: config.repoAccessEnabled || false,
    };

    const response = await fetch('/api/agent/runs/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Failed to create run');
    }

    const run = await response.json();
    
    const runState: AgentRunState = {
      id: run.id,
      noteId: config.noteId,
      action: config.action,
      agentName: config.agentName,
      modelId: config.modelId || null,
      status: 'queued',
      outputText: null,
      errorMessage: null,
      promptTokens: null,
      outputTokens: null,
      costUsd: null,
      durationMs: null,
      events: [],
    };

    store.setState((s) => ({
      ...s,
      runs: { ...s.runs, [run.id]: runState },
      activeRunId: run.id,
      loading: false,
    }));

    if (!config.runInBackground) {
      attachStream(run.id);
    }

    return run.id;
  } catch (err) {
    store.setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
    throw err;
  }
}

export function attachStream(runId: string) {
  const state = store.getState();
  
  if (state.activeEventSource) {
    state.activeEventSource.close();
  }

  const eventSource = new EventSource(`/api/agent/runs/stream?id=${encodeURIComponent(runId)}`);
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const s = store.getState();
      const runState = s.runs[runId];
      if (!runState) return;

      const evt: AgentRunEvent = { type: data.type || 'unknown', timestamp: new Date().toISOString(), data };
      const updates: Partial<AgentRunState> = { events: [...runState.events, evt] };

      if (data.type === 'run.status') updates.status = data.status;
      if (data.type === 'run.terminal') {
        updates.status = data.status || 'completed';
        updates.outputText = data.output || null;
        updates.errorMessage = data.error || null;
        if (data.tokens) {
          updates.promptTokens = data.tokens.prompt;
          updates.outputTokens = data.tokens.output;
          updates.costUsd = data.tokens.cost;
        }
        eventSource.close();
        store.setState((s2) => ({ ...s2, activeEventSource: s2.activeRunId === runId ? null : s2.activeEventSource }));
      }

      store.setState((s2) => ({ ...s2, runs: { ...s2.runs, [runId]: { ...runState, ...updates } } }));
    } catch { /* ignore */ }
  };

  eventSource.onerror = () => {
    eventSource.close();
    store.setState((s2) => ({ ...s2, activeEventSource: s2.activeRunId === runId ? null : s2.activeEventSource }));
  };

  store.setState((s) => ({ ...s, activeEventSource: eventSource }));
}

export function detachStream() {
  const state = store.getState();
  if (state.activeEventSource) state.activeEventSource.close();
  store.setState((s) => ({ ...s, activeEventSource: null }));
}

export function cancelRun(runId: string) {
  const state = store.getState();
  if (state.activeEventSource) state.activeEventSource.close();
  
  fetch(`/api/agent/runs/abort?id=${encodeURIComponent(runId)}`, { method: 'POST' }).catch(() => {});

  store.setState((s) => ({
    ...s,
    runs: { ...s.runs, [runId]: { ...s.runs[runId], status: 'aborted' as const } },
    activeEventSource: null,
  }));
}

export function clearError() {
  store.setState((s) => ({ ...s, error: null }));
}

export function getActiveRun(): AgentRunState | null {
  const state = store.getState();
  return state.activeRunId ? state.runs[state.activeRunId] || null : null;
}

export { store as agentRunStore };
