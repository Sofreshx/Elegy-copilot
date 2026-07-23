import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api/git', () => ({
  discoverGitChecks: vi.fn(),
  getGitCheckState: vi.fn(),
  getGitCiSync: vi.fn(),
  getRepoQualityStatus: vi.fn(),
  createRepoQualitySetupTask: vi.fn(),
  runGitChecksWithProfile: vi.fn(),
}));

vi.mock('../ui/src/stores/notificationStore', () => ({
  notificationStore: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import WorkspaceChecksTab from '../ui/src/views/Workspace/WorkspaceChecksTab';
import * as gitApi from '../ui/src/lib/api/git';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const discovery = {
  repoPath: '/test/repo',
  checksAvailable: 2,
  source: 'commit-check' as const,
  checks: [
    {
      name: 'lint',
      path: 'npm run lint',
      description: 'Run lint',
      source: 'commit-check' as const,
      defaultProfiles: ['commit'],
      cost: 'fast' as const,
      required: true,
    },
    {
      name: 'test',
      path: 'npm test',
      description: 'Run tests',
      source: 'commit-check' as const,
      defaultProfiles: ['ci-local'],
      cost: 'medium' as const,
      required: true,
    },
  ],
};

describe('WorkspaceChecksTab run status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitApi.discoverGitChecks).mockResolvedValue(discovery);
    vi.mocked(gitApi.getGitCheckState).mockResolvedValue({
      repoId: 'repo-1',
      repoPath: '/test/repo',
      hasState: false,
      lastRun: null,
      freshness: { fresh: false, reason: 'no-state' },
      history: [],
    });
    vi.mocked(gitApi.getGitCiSync).mockResolvedValue({
      repoRoot: '/test/repo',
      config: null,
      ciWorkflows: { workflows: [], unknown: [] },
      syncResult: {
        mappings: [],
        summary: { totalCiJobs: 0, mapped: 0, gaps: 0, readiness: 'no-ci' },
      },
    });
    vi.mocked(gitApi.getRepoQualityStatus).mockResolvedValue({
      schemaVersion: 'repo-quality-status/v1',
      repoPath: '/test/repo',
      readiness: 'setup-required',
      nextAction: { id: 'setup-quality-workflow', label: 'Set up quality workflow' },
      support: { supported: true, adapter: 'node', reason: null },
      local: {
        config: { elegy: false, legacyCommitCheck: false },
        hooks: { manager: 'none', configured: false, active: false, configPath: null, coreHooksPath: null },
        lastProof: null,
        freshness: { fresh: false, reason: 'No recorded proof.' },
      },
      remote: { available: false, reason: 'GitHub CLI is unavailable.' },
      drift: [],
    });
  });

  it('leads with repository readiness and the recommended next action', async () => {
    render(<WorkspaceChecksTab repoPath="/test/repo" repoId="repo-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-readiness')).toHaveTextContent('Setup required');
    });
    expect(screen.getByTestId('workspace-checks-primary-action')).toHaveTextContent('Set up quality workflow');
    expect(screen.getByTestId('workspace-checks-readiness')).toHaveTextContent('HooksNot configured');
    expect(screen.getByTestId('workspace-checks-readiness')).toHaveTextContent('GitHubUnavailable');
  });

  it('shows a scoped skill prompt when the task launcher is unavailable', async () => {
    vi.mocked(gitApi.createRepoQualitySetupTask).mockResolvedValue({
      schemaVersion: 'repo-quality-setup-task/v1',
      repoPath: '/test/repo',
      skill: 'repo-quality-setup',
      launched: false,
      reason: 'Codex task launcher is unavailable.',
      prompt: 'Use the repo-quality-setup skill for /test/repo.',
    });
    render(<WorkspaceChecksTab repoPath="/test/repo" repoId="repo-1" />);

    const action = await screen.findByTestId('workspace-checks-primary-action');
    fireEvent.click(action);

    await waitFor(() => {
      expect(gitApi.createRepoQualitySetupTask).toHaveBeenCalledWith('/test/repo');
    });
    expect(screen.getByTestId('workspace-checks-setup-prompt')).toHaveTextContent('repo-quality-setup skill for /test/repo');
  });

  it('shows selected lanes as running and keeps a copyable trace after failure', async () => {
    const run = deferred<any>();
    vi.mocked(gitApi.runGitChecksWithProfile).mockReturnValue(run.promise);

    render(<WorkspaceChecksTab repoPath="/test/repo" repoId="repo-1" />);

    fireEvent.click(await screen.findByTestId('workspace-checks-manual-run-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-profile-commit')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('workspace-checks-profile-commit'));

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-run-status')).toHaveTextContent('RUNNING');
    });
    expect(screen.getByTestId('workspace-checks-lane-toggle-lint')).toHaveTextContent('RUNNING');
    expect(screen.getByTestId('workspace-checks-lane-toggle-test')).toHaveTextContent('NOT RUN');
    expect(screen.getByTestId('workspace-checks-log-console')).toHaveTextContent('run_start');

    run.resolve({
      repoRoot: '/test/repo',
      source: 'commit-check',
      checkedAt: new Date().toISOString(),
      checksAvailable: 1,
      checksRun: 1,
      checksPassed: 0,
      checksFailed: 1,
      allPassed: false,
      results: [
        {
          checkName: 'lint',
          status: 'FAIL',
          passed: false,
          output: 'lint failed',
          error: 'lint failed',
          commands: [{ command: 'npm run lint', exitCode: 1, success: false, durationMs: 12 }],
        },
      ],
      message: '1 of 1 lanes failed.',
      logs: [
        { timestamp: new Date().toISOString(), event: 'lane_start', lane: 'lint' },
        { timestamp: new Date().toISOString(), event: 'lane_end', lane: 'lint', status: 'FAIL', exitCode: 1, durationMs: 12 },
      ],
      errorOutput: '[lint] Command failed: npm run lint',
    });

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-run-status')).toHaveTextContent('FAIL');
    });
    expect(screen.getByTestId('workspace-checks-log-console')).toHaveTextContent('lane_end');
    expect(screen.getByTestId('workspace-checks-run-trace')).toHaveTextContent('Failed lanes: lint');
    expect(screen.getByTestId('workspace-checks-copy-trace')).toBeInTheDocument();
  });
});
