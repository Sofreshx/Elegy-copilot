import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutorWorktreesResponse } from '../ui/src/lib/types';

const listMock = vi.fn();
vi.mock('../ui/src/lib/api/executor', () => ({
  listExecutorWorktrees: (opts: unknown) => listMock(opts),
}));

import WorkspaceWorktreesCard from '../ui/src/views/Workspace/WorkspaceWorktreesCard';

const baseWorktree = (overrides: Record<string, unknown>) => ({
  worktreeId: 'wt-1',
  path: '/repo/.tmp/llm-work/wt-1',
  source: 'elegy',
  mode: 'dedicated',
  status: 'ready',
  branch: 'feature/test',
  head: 'abc1234',
  updatedAt: new Date().toISOString(),
  lifecycle: { lastSeenAt: new Date().toISOString() },
  validation: { pathExists: true },
  launch: { blocked: false, reason: null },
  assignment: null,
  git: {
    head: 'abc1234',
    branch: 'feature/test',
    detached: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    changed: 0,
    probeError: null,
    mtimeMs: Date.now(),
  },
  repoId: 'repo-1',
  repoPath: '/repo',
  repoLabel: 'repo',
  _discovered: false,
  _discoveredOnly: false,
  _merged: 'persisted',
  _stableOrder: 1,
  ...overrides,
});

function makeResponse(records: ReturnType<typeof baseWorktree>[]): ExecutorWorktreesResponse {
  return {
    worktrees: records,
    worktreeDiscovery: {
      contractVersion: '1',
      repoId: 'repo-1',
      repoPath: '/repo',
      gitListOk: true,
      gitListError: null,
      persistedCount: records.length,
      discoveredCount: 0,
    },
  };
}

describe('WorkspaceWorktreesCard', () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  afterEach(() => {
    listMock.mockReset();
  });

  it('renders the empty state when no worktrees are found', async () => {
    listMock.mockResolvedValueOnce(makeResponse([]));
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-empty')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-worktrees-empty')).toHaveTextContent('No worktrees found for this repo.');
    expect(listMock).toHaveBeenCalledWith({ repoId: 'repo-1', repoPath: '/repo' });
  });

  it('renders source labels (codex, opencode, elegy, manual) with status pills', async () => {
    const codexWt = baseWorktree({ worktreeId: 'wt-codex', source: 'codex', path: '/codex/wt-a', _stableOrder: 4 });
    const opencodeWt = baseWorktree({ worktreeId: 'wt-opencode', source: 'opencode', path: '/opencode/wt-b', _stableOrder: 3 });
    const elegyWt = baseWorktree({ worktreeId: 'wt-elegy', source: 'elegy', path: '/elegy/wt-c', _stableOrder: 2 });
    const manualWt = baseWorktree({ worktreeId: 'wt-manual', source: 'manual', path: '/manual/wt-d', _stableOrder: 1 });
    listMock.mockResolvedValueOnce(makeResponse([codexWt, opencodeWt, elegyWt, manualWt]));
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list').children.length).toBe(4);
    });
    expect(screen.getByTestId('workspace-worktree-source-wt-codex')).toHaveTextContent('Codex');
    expect(screen.getByTestId('workspace-worktree-source-wt-opencode')).toHaveTextContent('OpenCode');
    expect(screen.getByTestId('workspace-worktree-source-wt-elegy')).toHaveTextContent('Elegy');
    expect(screen.getByTestId('workspace-worktree-source-wt-manual')).toHaveTextContent('Manual');
  });

  it('orders records by updatedAt desc with lastSeenAt fallback and stable order tiebreaker', async () => {
    const now = Date.now();
    const newish = baseWorktree({
      worktreeId: 'wt-new',
      path: '/new',
      updatedAt: new Date(now - 1000).toISOString(),
      lifecycle: { lastSeenAt: new Date(now - 60_000).toISOString() },
      _stableOrder: 0,
    });
    const oldie = baseWorktree({
      worktreeId: 'wt-old',
      path: '/old',
      updatedAt: null,
      lifecycle: { lastSeenAt: new Date(now - 86_400_000).toISOString() },
      _stableOrder: 1,
    });
    const noTimestamp = baseWorktree({
      worktreeId: 'wt-fs',
      path: '/fs',
      updatedAt: null,
      lifecycle: null,
      git: { ...baseWorktree({}).git, mtimeMs: now - 5_000 },
      _stableOrder: 2,
    });
    listMock.mockResolvedValueOnce(makeResponse([noTimestamp, oldie, newish]));
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list').children.length).toBe(3);
    });
    const items = screen.getByTestId('workspace-worktrees-list').children;
    expect(items[0].getAttribute('data-testid')).toBe('workspace-worktree-wt-new');
    expect(items[1].getAttribute('data-testid')).toBe('workspace-worktree-wt-fs');
    expect(items[2].getAttribute('data-testid')).toBe('workspace-worktree-wt-old');
  });

  it('shows dirty, missing, and launch-blocked flags', async () => {
    const dirty = baseWorktree({
      worktreeId: 'wt-dirty',
      path: '/dirty',
      git: { ...baseWorktree({}).git, changed: 4, unstaged: 4 },
    });
    const missing = baseWorktree({
      worktreeId: 'wt-missing',
      path: '/missing',
      validation: { pathExists: false },
    });
    const blocked = baseWorktree({
      worktreeId: 'wt-blocked',
      path: '/blocked',
      launch: { blocked: true, reason: 'in-progress elsewhere' },
    });
    listMock.mockResolvedValueOnce(makeResponse([dirty, missing, blocked]));
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list').children.length).toBe(3);
    });
    expect(screen.getByTestId('workspace-worktree-dirty-wt-dirty')).toHaveTextContent('4 dirty');
    const missingItem = screen.getByTestId('workspace-worktree-wt-missing');
    expect(missingItem.className).toContain('workspace-worktree-missing');
    const blockedItem = screen.getByTestId('workspace-worktree-wt-blocked');
    expect(blockedItem.className).toContain('workspace-worktree-blocked');
  });

  it('surfaces a git discovery error notice when gitListError is set', async () => {
    const response = makeResponse([]);
    response.worktreeDiscovery = {
      contractVersion: '1',
      repoId: 'repo-1',
      repoPath: '/repo',
      gitListOk: false,
      gitListError: 'git not available on PATH',
      persistedCount: 0,
      discoveredCount: 0,
    };
    listMock.mockResolvedValueOnce(response);
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-git-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-worktrees-git-error')).toHaveTextContent('git not available on PATH');
  });

  it('caps display at 10 rows and shows overflow subtitle', async () => {
    const records = Array.from({ length: 14 }).map((_, index) => {
      return baseWorktree({
        worktreeId: `wt-${index}`,
        path: `/path/${index}`,
        updatedAt: new Date(Date.now() - index * 1000).toISOString(),
        _stableOrder: index,
      });
    });
    listMock.mockResolvedValueOnce(makeResponse(records));
    render(<WorkspaceWorktreesCard repoId="repo-1" repoPath="/repo" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-worktrees-list').children.length).toBe(10);
    });
    const card = screen.getByTestId('workspace-worktrees-card');
    expect(card.textContent).toContain('10 newest of 14');
  });

  it('passes an undefined repoId to the API when none is provided', async () => {
    listMock.mockResolvedValueOnce(makeResponse([]));
    render(<WorkspaceWorktreesCard repoId={null} repoPath="/repo" />);
    await waitFor(() => {
      expect(listMock).toHaveBeenCalled();
    });
    expect(listMock).toHaveBeenCalledWith({ repoId: undefined, repoPath: '/repo' });
  });
});
