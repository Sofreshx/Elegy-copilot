import { createStore } from '../lib/store';
import {
  getGitStatus,
  getGitDiff,
  getGitLog,
  stageGitFiles,
  unstageGitFiles,
  commitGit,
} from '../lib/api';
import type { GitStatusResponse, GitDiffResponse, GitLogResponse } from '../lib/api/git';

export interface GitState {
  repoPath: string | null;
  loading: boolean;
  error: string | null;
  status: GitStatusResponse | null;
  diff: GitDiffResponse | null;
  log: GitLogResponse | null;
  commitMessage: string;
  committing: boolean;
  staging: boolean;
  diffView: 'unstaged' | 'staged';
}

const INITIAL_STATE: GitState = {
  repoPath: null,
  loading: false,
  error: null,
  status: null,
  diff: null,
  log: null,
  commitMessage: '',
  committing: false,
  staging: false,
  diffView: 'unstaged',
};

function createGitStore() {
  const store = createStore<GitState>(INITIAL_STATE);

  async function loadStatus(repoPath: string): Promise<void> {
    store.setState((s) => ({ ...s, repoPath, loading: true, error: null }));
    try {
      const [status, log] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath),
      ]);
      store.setState((s) => ({ ...s, status, log, loading: false }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function loadDiff(): Promise<void> {
    const { repoPath, diffView } = store.getState();
    if (!repoPath) return;
    try {
      const diff = await getGitDiff(repoPath, diffView === 'staged');
      store.setState((s) => ({ ...s, diff }));
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function stageAll(): Promise<void> {
    const { repoPath } = store.getState();
    if (!repoPath) return;
    store.setState((s) => ({ ...s, staging: true }));
    try {
      await stageGitFiles(repoPath);
      await loadStatus(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        staging: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    store.setState((s) => ({ ...s, staging: false }));
  }

  async function unstageAll(): Promise<void> {
    const { repoPath } = store.getState();
    if (!repoPath) return;
    store.setState((s) => ({ ...s, staging: true }));
    try {
      await unstageGitFiles(repoPath);
      await loadStatus(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        staging: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
    store.setState((s) => ({ ...s, staging: false }));
  }

  async function commit(): Promise<void> {
    const { repoPath, commitMessage } = store.getState();
    if (!repoPath || !commitMessage.trim()) return;
    store.setState((s) => ({ ...s, committing: true, error: null }));
    try {
      await commitGit(repoPath, commitMessage.trim());
      store.setState((s) => ({ ...s, commitMessage: '', committing: false }));
      await loadStatus(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        committing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  function setCommitMessage(commitMessage: string): void {
    store.setState((s) => ({ ...s, commitMessage }));
  }

  function setDiffView(diffView: 'unstaged' | 'staged'): void {
    store.setState((s) => ({ ...s, diffView, diff: null }));
  }

  function reset(): void {
    store.setState(INITIAL_STATE);
  }

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    loadStatus,
    loadDiff,
    stageAll,
    unstageAll,
    commit,
    setCommitMessage,
    setDiffView,
    reset,
  };
}

export const gitStore = createGitStore();
