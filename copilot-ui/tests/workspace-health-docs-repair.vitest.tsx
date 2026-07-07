import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const driftMock = vi.hoisted(() => ({
  state: { byRepo: {} as Record<string, any> },
  listeners: new Set<() => void>(),
  initRepo: vi.fn(),
  runFull: vi.fn(),
  runSingle: vi.fn(),
}));

vi.mock('../ui/src/stores/driftCheckStore', () => ({
  driftCheckStore: {
    getState: () => driftMock.state,
    subscribe: (listener: () => void) => {
      driftMock.listeners.add(listener);
      return () => {
        driftMock.listeners.delete(listener);
      };
    },
    initRepo: driftMock.initRepo,
    runFull: driftMock.runFull,
    runSingle: driftMock.runSingle,
  },
}));

vi.mock('../ui/src/stores/notificationStore', () => ({
  notificationStore: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../ui/src/lib/api/repoContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/src/lib/api/repoContext')>();
  return {
    ...actual,
    listDocsRepairRuns: vi.fn(),
    startDocsRepairRun: vi.fn(),
  };
});

import WorkspaceHealthTab from '../ui/src/views/Workspace/WorkspaceHealthTab';
import * as repoContextApi from '../ui/src/lib/api/repoContext';

const repoPath = '/test/repo';
const repoKey = repoPath.toLowerCase();

function issue(code: string, severity: 'error' | 'warning' | 'info', line: number, message = code) {
  return {
    code,
    severity,
    claim: null,
    file: `docs/${code}.md`,
    line,
    message,
    suggestion: null,
  };
}

function setReport(issues: ReturnType<typeof issue>[]) {
  driftMock.state = {
    byRepo: {
      [repoKey]: {
        report: {
          score: 42,
          issues,
          fileCount: 10,
          claimCount: 20,
          verifiedCount: 15,
          failedCount: 5,
          timestamp: '2026-07-07T12:00:00.000Z',
          severityCounts: {
            error: issues.filter((entry) => entry.severity === 'error').length,
            warning: issues.filter((entry) => entry.severity === 'warning').length,
            info: issues.filter((entry) => entry.severity === 'info').length,
          },
        },
        checkStatuses: {},
        checkTimestamps: {},
        lastFullRunAt: '2026-07-07T12:00:00.000Z',
        error: null,
      },
    },
  };
}

function status(overrides: Partial<repoContextApi.DocsRepairStatusResponse> = {}): repoContextApi.DocsRepairStatusResponse {
  return {
    repoPath,
    repoId: 'repo-1',
    concurrencyLimit: 3,
    activeCount: 0,
    openCodeAvailable: true,
    runs: [],
    ...overrides,
  };
}

describe('WorkspaceHealthTab docs repair controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setReport([
      issue('broken_internal_link', 'error', 12),
      issue('frontmatter_invalid', 'warning', 3),
      issue('stale_doc', 'warning', 9),
    ]);
    vi.mocked(repoContextApi.listDocsRepairRuns).mockResolvedValue(status());
    vi.mocked(repoContextApi.startDocsRepairRun).mockResolvedValue({
      run: {
        id: 'docs-repair-abc123',
        status: 'queued',
        repoPath,
        repoId: 'repo-1',
        batchSize: 50,
        modelProfile: 'opencode-zen-free',
        model: 'opencode/deepseek-v4-flash-free',
        branch: null,
        worktreePath: null,
        commitSha: null,
        prUrl: null,
        issues: [],
        issueSummary: { total: 2, byCode: { broken_internal_link: 1, frontmatter_invalid: 1 } },
        validation: null,
        error: null,
        logs: [],
        createdAt: '2026-07-07T12:00:00.000Z',
        updatedAt: '2026-07-07T12:00:00.000Z',
        startedAt: null,
        finishedAt: null,
      },
      status: status({
        activeCount: 1,
        runs: [],
      }),
    });
  });

  it('renders eligible counts and enables repair when drift data has safe issues', async () => {
    render(<WorkspaceHealthTab repoPath={repoPath} repoId="repo-1" />);

    expect(await screen.findByTestId('workspace-health-repair-controls')).toHaveTextContent('2 eligible');
    expect(screen.getByTestId('workspace-health-repair-controls')).toHaveTextContent('1 skipped');
    expect(screen.getByTestId('workspace-health-start-repair')).not.toBeDisabled();
  });

  it('disables repair when no eligible issues match the current filter', async () => {
    setReport([issue('stale_doc', 'warning', 9)]);

    render(<WorkspaceHealthTab repoPath={repoPath} repoId="repo-1" />);

    expect(await screen.findByTestId('workspace-health-start-repair')).toBeDisabled();
    expect(screen.getByTestId('workspace-health-repair-controls')).toHaveTextContent('No eligible issues match');
  });

  it('disables repair at the active run limit', async () => {
    vi.mocked(repoContextApi.listDocsRepairRuns).mockResolvedValue(status({ activeCount: 3 }));

    render(<WorkspaceHealthTab repoPath={repoPath} repoId="repo-1" />);

    expect(await screen.findByTestId('workspace-health-start-repair')).toBeDisabled();
    expect(screen.getByTestId('workspace-health-repair-controls')).toHaveTextContent('Repair concurrency limit reached');
  });

  it('starts a batch with the current filter and selected batch size', async () => {
    render(<WorkspaceHealthTab repoPath={repoPath} repoId="repo-1" />);

    await screen.findByTestId('workspace-health-repair-controls');
    fireEvent.click(screen.getByText('Errors'));
    fireEvent.click(screen.getByTestId('workspace-health-repair-batch-20'));
    fireEvent.click(screen.getByTestId('workspace-health-start-repair'));

    await waitFor(() => {
      expect(repoContextApi.startDocsRepairRun).toHaveBeenCalledTimes(1);
    });
    expect(repoContextApi.startDocsRepairRun).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath,
        repoId: 'repo-1',
        batchSize: 20,
        filters: { severity: 'error' },
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'broken_internal_link' }),
          expect.objectContaining({ code: 'frontmatter_invalid' }),
          expect.objectContaining({ code: 'stale_doc' }),
        ]),
      }),
    );
  });

  it('shows running, failed, succeeded, and PR-linked repair runs', async () => {
    vi.mocked(repoContextApi.listDocsRepairRuns).mockResolvedValue(status({
      activeCount: 1,
      runs: [
        {
          id: 'docs-repair-running',
          status: 'running',
          repoPath,
          repoId: 'repo-1',
          batchSize: 50,
          modelProfile: 'opencode-zen-free',
          model: 'opencode/deepseek-v4-flash-free',
          branch: 'codex/docs-repair-20260707-running',
          worktreePath: 'C:/tmp/running',
          commitSha: null,
          prUrl: null,
          issues: [],
          issueSummary: { total: 1, byCode: { broken_internal_link: 1 } },
          validation: null,
          error: null,
          logs: [],
          createdAt: '2026-07-07T12:00:00.000Z',
          updatedAt: '2026-07-07T12:00:02.000Z',
          startedAt: '2026-07-07T12:00:01.000Z',
          finishedAt: null,
        },
        {
          id: 'docs-repair-failed',
          status: 'failed',
          repoPath,
          repoId: 'repo-1',
          batchSize: 20,
          modelProfile: 'opencode-zen-free',
          model: 'opencode/deepseek-v4-flash-free',
          branch: 'codex/docs-repair-20260707-failed',
          worktreePath: 'C:/tmp/failed',
          commitSha: null,
          prUrl: null,
          issues: [],
          issueSummary: { total: 1, byCode: { frontmatter_invalid: 1 } },
          validation: { selectedCount: 1, fixedCount: 0 },
          error: 'Validation failed',
          logs: [],
          createdAt: '2026-07-07T11:00:00.000Z',
          updatedAt: '2026-07-07T11:00:30.000Z',
          startedAt: '2026-07-07T11:00:01.000Z',
          finishedAt: '2026-07-07T11:00:30.000Z',
        },
        {
          id: 'docs-repair-succeeded',
          status: 'succeeded',
          repoPath,
          repoId: 'repo-1',
          batchSize: 50,
          modelProfile: 'opencode-zen-free',
          model: 'opencode/deepseek-v4-flash-free',
          branch: 'codex/docs-repair-20260707-succeeded',
          worktreePath: 'C:/tmp/succeeded',
          commitSha: 'abc123',
          prUrl: 'https://github.com/example/repo/pull/1',
          issues: [],
          issueSummary: { total: 2, byCode: { broken_internal_link: 2 } },
          validation: { selectedCount: 2, fixedCount: 2 },
          error: null,
          logs: [],
          createdAt: '2026-07-07T10:00:00.000Z',
          updatedAt: '2026-07-07T10:01:00.000Z',
          startedAt: '2026-07-07T10:00:05.000Z',
          finishedAt: '2026-07-07T10:01:00.000Z',
        },
      ],
    }));

    render(<WorkspaceHealthTab repoPath={repoPath} repoId="repo-1" />);

    expect(await screen.findByTestId('workspace-health-repair-runs')).toHaveTextContent('running');
    expect(screen.getByTestId('workspace-health-repair-runs')).toHaveTextContent('failed');
    expect(screen.getByTestId('workspace-health-repair-runs')).toHaveTextContent('succeeded');
    expect(screen.getByRole('link', { name: 'Draft PR' })).toHaveAttribute('href', 'https://github.com/example/repo/pull/1');
  });
});
