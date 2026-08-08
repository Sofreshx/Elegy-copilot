import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api', () => ({
  getGitDiff: vi.fn(),
  getGitLog: vi.fn(),
  getGitBranches: vi.fn(),
  getGitSummary: vi.fn(),
  getGitPullRequest: vi.fn(),
  stageGitFiles: vi.fn(),
  unstageGitFiles: vi.fn(),
  commitGit: vi.fn(),
  checkoutGitBranch: vi.fn(),
  pullGit: vi.fn(),
  pushGit: vi.fn(),
  createGitPullRequest: vi.fn(),
  generateCommitMessage: vi.fn(),
}));

import * as gitApi from '../ui/src/lib/api';
import { gitStore } from '../ui/src/stores/gitStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const summary = {
  branch: 'main',
  clean: true,
  changedFiles: 0,
  stagedFiles: 0,
  files: [],
  additions: 0,
  deletions: 0,
  ahead: 0,
  behind: 0,
  upstream: 'origin/main',
  remoteName: 'origin',
  remoteLabel: 'owner/repo',
  remoteUrl: 'https://github.com/owner/repo',
  hasRemote: true,
  pullRequest: null,
};

describe('gitStore progressive reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gitStore.reset();
  });

  it('publishes summary before delayed log and branches complete', async () => {
    const log = deferred<any>();
    const branches = deferred<any>();
    vi.mocked(gitApi.getGitSummary).mockResolvedValue(summary);
    vi.mocked(gitApi.getGitLog).mockReturnValue(log.promise);
    vi.mocked(gitApi.getGitBranches).mockReturnValue(branches.promise);

    const startedAt = performance.now();
    const loading = gitStore.loadStatus('/test/repo');
    await vi.waitFor(() => expect(gitStore.getState().summary?.branch).toBe('main'));
    expect(performance.now() - startedAt).toBeLessThan(1_000);

    expect(gitStore.getState().loading).toBe(true);
    expect(gitStore.getState().sections.summary.loading).toBe(false);
    expect(gitStore.getState().sections.summary.updatedAt).not.toBeNull();
    expect(gitStore.getState().log).toBeNull();

    log.resolve({ commits: [] });
    branches.resolve({ currentBranch: 'main', branches: [] });
    await loading;
    expect(gitStore.getState().loading).toBe(false);
  });

  it('retains the last successful summary when a refresh section fails', async () => {
    vi.mocked(gitApi.getGitSummary).mockResolvedValue(summary);
    vi.mocked(gitApi.getGitLog).mockResolvedValue({ commits: [] });
    vi.mocked(gitApi.getGitBranches).mockResolvedValue({ currentBranch: 'main', branches: [] });
    await gitStore.loadStatus('/test/repo');

    vi.mocked(gitApi.getGitSummary).mockRejectedValue(new Error('summary unavailable'));
    await gitStore.loadStatus('/test/repo');

    expect(gitStore.getState().summary?.branch).toBe('main');
    expect(gitStore.getState().sections.summary.error).toBe('summary unavailable');
    expect(gitStore.getState().error).toContain('summary unavailable');
  });
});
