import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api/git', () => ({
  discoverGitChecks: vi.fn(),
  getGitCheckState: vi.fn(),
  getGitCiSync: vi.fn(),
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
  });

  it('shows selected lanes as running and keeps a copyable trace after failure', async () => {
    const run = deferred<any>();
    vi.mocked(gitApi.runGitChecksWithProfile).mockReturnValue(run.promise);

    render(<WorkspaceChecksTab repoPath="/test/repo" repoId="repo-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-checks-profile-commit')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-operation-banner')).toBeInTheDocument();

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
