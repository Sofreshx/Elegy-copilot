import { createStore } from '../lib/store';
import {
  getGitStatus,
  getGitDiff,
  getGitLog,
  getGitBranches,
  getGitSummary,
  getGitPullRequest,
  stageGitFiles,
  unstageGitFiles,
  commitGit,
  checkoutGitBranch,
  pullGit,
  pushGit,
  createGitPullRequest,
} from '../lib/api';
import type {
  GitStatusResponse,
  GitDiffResponse,
  GitLogResponse,
  GitBranchesResponse,
  GitPullRequestResponse,
  GitSummaryResponse,
} from '../lib/api/git';

export interface GitState {
  repoPath: string | null;
  loading: boolean;
  error: string | null;
  status: GitStatusResponse | null;
  diff: GitDiffResponse | null;
  log: GitLogResponse | null;
  branches: GitBranchesResponse | null;
  summary: GitSummaryResponse | null;
  pullRequest: GitPullRequestResponse | null;
  commitMessage: string;
  committing: boolean;
  staging: boolean;
  syncing: boolean;
  switchingBranch: boolean;
  creatingPullRequest: boolean;
  diffView: 'unstaged' | 'staged';
  selectedBranch: string;
  newBranchName: string;
  pullRequestTitle: string;
  pullRequestBody: string;
}

const INITIAL_STATE: GitState = {
  repoPath: null,
  loading: false,
  error: null,
  status: null,
  diff: null,
  log: null,
  branches: null,
  summary: null,
  pullRequest: null,
  commitMessage: '',
  committing: false,
  staging: false,
  syncing: false,
  switchingBranch: false,
  creatingPullRequest: false,
  diffView: 'unstaged',
  selectedBranch: '',
  newBranchName: '',
  pullRequestTitle: '',
  pullRequestBody: '',
};

function createGitStore() {
  const store = createStore<GitState>(INITIAL_STATE);
  let requestVersion = 0;

  async function loadRepoState(repoPath: string): Promise<void> {
    const nextVersion = ++requestVersion;
    store.setState((s) => ({ ...s, repoPath, loading: true, error: null }));

    try {
      const [status, log, branches, summary, pullRequest] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath),
        getGitBranches(repoPath),
        getGitSummary(repoPath),
        getGitPullRequest(repoPath),
      ]);

      if (nextVersion !== requestVersion) return;

      store.setState((s) => ({
        ...s,
        repoPath,
        status,
        log,
        branches,
        summary,
        pullRequest,
        selectedBranch: status.branch || branches.currentBranch || '',
        loading: false,
      }));
    } catch (err) {
      if (nextVersion !== requestVersion) return;

      store.setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function loadStatus(repoPath: string): Promise<void> {
    await loadRepoState(repoPath);
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
      await loadRepoState(repoPath);
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
      await loadRepoState(repoPath);
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
      await loadRepoState(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        committing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  async function pull(): Promise<void> {
    const { repoPath } = store.getState();
    if (!repoPath) return;
    store.setState((s) => ({ ...s, syncing: true, error: null }));
    try {
      await pullGit(repoPath);
      await loadRepoState(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      store.setState((s) => ({ ...s, syncing: false }));
    }
  }

  async function push(): Promise<void> {
    const { repoPath, status } = store.getState();
    if (!repoPath) return;
    store.setState((s) => ({ ...s, syncing: true, error: null }));
    try {
      await pushGit(repoPath, { setUpstream: !status?.upstream });
      await loadRepoState(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      store.setState((s) => ({ ...s, syncing: false }));
    }
  }

  async function switchBranch(options?: { create?: boolean }): Promise<void> {
    const { repoPath, selectedBranch, newBranchName } = store.getState();
    if (!repoPath) return;

    const create = Boolean(options?.create);
    const branchName = create ? newBranchName.trim() : selectedBranch.trim();
    if (!branchName) return;

    store.setState((s) => ({ ...s, switchingBranch: true, error: null }));
    try {
      await checkoutGitBranch(repoPath, { branchName, create });
      store.setState((s) => ({ ...s, newBranchName: '' }));
      await loadRepoState(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      store.setState((s) => ({ ...s, switchingBranch: false }));
    }
  }

  async function createPullRequest(): Promise<void> {
    const { repoPath, pullRequestTitle, pullRequestBody, status } = store.getState();
    if (!repoPath) return;

    store.setState((s) => ({ ...s, creatingPullRequest: true, error: null }));
    try {
      await createGitPullRequest(repoPath, {
        title: pullRequestTitle.trim() || undefined,
        body: pullRequestBody.trim() || undefined,
        head: status?.branch || undefined,
      });
      store.setState((s) => ({ ...s, pullRequestTitle: '', pullRequestBody: '' }));
      await loadRepoState(repoPath);
    } catch (err) {
      store.setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      store.setState((s) => ({ ...s, creatingPullRequest: false }));
    }
  }

  function setCommitMessage(commitMessage: string): void {
    store.setState((s) => ({ ...s, commitMessage }));
  }

  function setDiffView(diffView: 'unstaged' | 'staged'): void {
    store.setState((s) => ({ ...s, diffView, diff: null }));
  }

  function setSelectedBranch(selectedBranch: string): void {
    store.setState((s) => ({ ...s, selectedBranch }));
  }

  function setNewBranchName(newBranchName: string): void {
    store.setState((s) => ({ ...s, newBranchName }));
  }

  function setPullRequestTitle(pullRequestTitle: string): void {
    store.setState((s) => ({ ...s, pullRequestTitle }));
  }

  function setPullRequestBody(pullRequestBody: string): void {
    store.setState((s) => ({ ...s, pullRequestBody }));
  }

  function reset(): void {
    requestVersion++;
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
    pull,
    push,
    switchBranch,
    createPullRequest,
    setCommitMessage,
    setDiffView,
    setSelectedBranch,
    setNewBranchName,
    setPullRequestTitle,
    setPullRequestBody,
    reset,
  };
}

export const gitStore = createGitStore();
