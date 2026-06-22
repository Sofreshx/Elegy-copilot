import { createStore } from '../lib/store';

export interface ShellDetectedShell {
  type: string;
  path: string;
  posix: boolean;
}

export interface ShellOption {
  type: string;
  label: string;
  path: string;
  posix: boolean;
  available: boolean;
  recommended: boolean;
  warnings: string[];
}

export interface ShellStatus {
  wsl2: string;
  detectedShell: ShellDetectedShell | null;
  harnesses: {
    opencode: { shell: string | null; configured: boolean };
    codex: { shell: string | null; configured: boolean };
  };
  checks: Array<{ id: string; label: string; status: string; detail: string }>;
}

export interface ShellState {
  status: ShellStatus | null;
  options: ShellOption[] | null;
  selectedShell: string | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: ShellState = {
  status: null,
  options: null,
  selectedShell: null,
  loading: true,
  saving: false,
  error: null,
  message: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

function createShellStore() {
  const store = createStore<ShellState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const res = await fetch('/api/shell/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const status: ShellStatus = await res.json();
      store.setState((state) => ({
        ...state,
        status,
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

  async function loadOptions(statusOverride?: ShellStatus | null): Promise<void> {
    try {
      const res = await fetch('/api/shell/options');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const options: ShellOption[] = await res.json();
      const status = statusOverride ?? store.getState().status;
      const activePath = status?.harnesses?.opencode?.shell;
      const matchedType = activePath
        ? options.find((o) => o.path === activePath)?.type || null
        : null;
      store.setState((state) => ({
        ...state,
        options,
        selectedShell: matchedType !== null ? matchedType : state.selectedShell,
      }));
    } catch {
      store.setState((state) => ({ ...state, options: [] }));
    }
  }

  async function setShell(shellType: string): Promise<void> {
    store.setState((state) => ({ ...state, saving: true, error: null, message: null }));
    try {
      const res = await fetch('/api/shell/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harness: 'opencode', shell: shellType }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || `HTTP ${res.status}`);
      }
      store.setState((state) => ({
        ...state,
        saving: false,
        selectedShell: shellType,
        message: `Shell set to ${shellType}. Restart OpenCode for changes to take effect.`,
      }));
      // Reload status to show updated config
      const statusRes = await fetch('/api/shell/status');
      if (statusRes.ok) {
        const status: ShellStatus = await statusRes.json();
        store.setState((state) => ({ ...state, status }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        saving: false,
        error: toErrorMessage(error),
      }));
    }
  }

  function resetState(): void {
    store.setState(() => ({ ...INITIAL_STATE }));
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    setState: store.setState,
    load,
    loadOptions,
    setShell,
    resetState,
  };
}

export const shellStore = createShellStore();
