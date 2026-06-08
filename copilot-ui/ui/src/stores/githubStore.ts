import { getGitHubStatus, loginGitHub, installGitHubCli } from '../lib/api/github';
import { createStore } from '../lib/store';
import type { GitHubStatusResponse } from '../lib/types';

export interface GitHubState {
  status: GitHubStatusResponse | null;
  loading: boolean;
  loginLoading: boolean;
  installLoading: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: GitHubState = {
  status: null,
  loading: false,
  loginLoading: false,
  installLoading: false,
  error: null,
  message: null,
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

function createGitHubStore() {
  const store = createStore<GitHubState>(INITIAL_STATE);

  async function load(): Promise<void> {
    store.setState((state) => ({ ...state, loading: true, error: null }));
    try {
      const status = await getGitHubStatus();
      store.setState((state) => ({ ...state, status, loading: false }));
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function install(): Promise<void> {
    store.setState((state) => ({ ...state, installLoading: true, error: null, message: null }));
    try {
      const result = await installGitHubCli();
      if (result.installed) {
        store.setState((state) => ({
          ...state,
          installLoading: false,
          message: `GitHub CLI installed successfully via ${result.method || 'automatic install'}.`,
        }));
        // Reload status
        const status = await getGitHubStatus();
        store.setState((state) => ({ ...state, status }));
      } else {
        store.setState((state) => ({
          ...state,
          installLoading: false,
          error: result.error || 'Installation failed.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        installLoading: false,
        error: toErrorMessage(error),
      }));
    }
  }

  async function login(): Promise<void> {
    store.setState((state) => ({ ...state, loginLoading: true, error: null, message: null }));
    try {
      const result = await loginGitHub();
      if (result.authenticated) {
        store.setState((state) => ({
          ...state,
          loginLoading: false,
          message: 'GitHub authentication successful.',
        }));
        // Reload status to get user info
        const status = await getGitHubStatus();
        store.setState((state) => ({ ...state, status }));
      } else {
        store.setState((state) => ({
          ...state,
          loginLoading: false,
          error: result.error || 'GitHub authentication failed.',
        }));
      }
    } catch (error) {
      store.setState((state) => ({
        ...state,
        loginLoading: false,
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
    login,
    install,
    resetState,
  };
}

export const githubStore = createGitHubStore();
