import { getGitHubStatus, loginGitHub } from '../lib/api/github';
import { createStore } from '../lib/store';
import type { GitHubStatusResponse } from '../lib/types';

export interface GitHubState {
  status: GitHubStatusResponse | null;
  loading: boolean;
  loginLoading: boolean;
  error: string | null;
  message: string | null;
}

const INITIAL_STATE: GitHubState = {
  status: null,
  loading: false,
  loginLoading: false,
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
    resetState,
  };
}

export const githubStore = createGitHubStore();
