import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api/orchestrator', () => ({
  createOrchestratorSession: vi.fn(),
  getOrchestratorHealth: vi.fn(),
  getOrchestratorSession: vi.fn(),
  listOrchestratorSessions: vi.fn(),
  mutateOrchestratorSession: vi.fn(),
  openOrchestratorEventStream: vi.fn(() => () => {}),
  readOrchestratorError: vi.fn((error: unknown) => ({
    code: null,
    message: error instanceof Error ? error.message : 'failed',
    details: null,
  })),
}));

vi.mock('../ui/src/lib/api/execution', () => ({
  getExecutionOverview: vi.fn(),
  getExecutionRun: vi.fn(),
  isExecutionRunActive: vi.fn((status: string | null | undefined) =>
    status === 'running' || status === 'stopping'),
  refreshExecutionCommands: vi.fn(),
  runExecutionCommand: vi.fn(),
  startExecutionSetup: vi.fn(),
  stopExecutionRun: vi.fn(),
}));

import WorkspaceExecutionTab, {
  deriveExecutionPresentation,
} from '../ui/src/views/Workspace/WorkspaceExecutionTab';
import * as api from '../ui/src/lib/api/orchestrator';
import * as executionApi from '../ui/src/lib/api/execution';
import type {
  OrchestratorHealth,
  OrchestratorSession,
} from '../ui/src/lib/api/orchestrator';
import type {
  ExecutionOverview,
  ExecutionRun,
} from '../ui/src/lib/api/execution';

const health: OrchestratorHealth = {
  schemaVersion: 'orchestrator-health/v1',
  ok: true,
  planning: { compatible: true, negotiated: false },
  adapters: [
    { adapterId: 'native', available: true },
    { adapterId: 'codex-exec', available: true },
    { adapterId: 'opencode-acp', available: true },
  ],
  journal: { ready: true, journalCount: 1 },
  orphanRecovery: { ready: true, recoverableJournalCount: 0 },
  pilot: {
    enabled: true,
    allowedAdapters: ['native', 'codex-exec'],
    oneActiveRunPerRepository: true,
    approvedOperation: 'commit',
    mergeRequested: false,
    mergeEnabled: false,
    telemetryPath: 'C:/temp/events.jsonl',
    telemetryReady: true,
    telemetryError: null,
    telemetryEventCount: 0,
  },
};

function session(overrides: Partial<OrchestratorSession> = {}): OrchestratorSession {
  return {
    schemaVersion: 'orchestrator-session/v1',
    sessionId: 'session-1',
    repoId: 'repo-1',
    title: 'Execution session',
    adapterId: 'native',
    state: 'running',
    revision: 2,
    createdAt: '2026-06-19T08:00:00Z',
    updatedAt: '2026-06-19T08:01:00Z',
    planning: {
      goalId: 'goal-1',
      roadmapId: 'roadmap-1',
      workPointId: 'work-1',
    },
    workPoints: [{
      workPointId: 'work-1',
      lease: { status: 'healthy' },
      validation: { status: 'passed' },
      evidence: {
        changedPaths: ['src/main.ts'],
        diffHash: 'diff-1',
        resultTreeSha: 'tree-1',
      },
    }],
    approvals: [],
    inputRequests: [],
    events: [{
      schemaVersion: 'orchestrator-api-event/v1',
      eventId: 1,
      sessionId: 'session-1',
      eventType: 'session-created',
      occurredAt: '2026-06-19T08:00:00Z',
      data: {},
    }],
    ...overrides,
  };
}

function overview(overrides: Partial<ExecutionOverview> = {}): ExecutionOverview {
  return {
    repoPath: '/repo',
    discovery: {
      schemaVersion: 1,
      repoPath: '/repo',
      detectedAt: '2026-07-31T08:00:00Z',
      sources: [{ path: '/repo/package.json', mtime: '2026-07-31T07:00:00Z' }],
      setup: { id: 'npm:install', label: 'Install dependencies' },
      categories: [
        {
          id: 'setup',
          label: 'Setup',
          commands: [
            {
              id: 'npm:install',
              kind: 'package.json',
              command: 'npm',
              args: ['install'],
              label: 'Install dependencies',
              description: 'Install all npm dependencies',
              category: 'setup',
              longRunning: false,
              source: null,
            },
          ],
        },
        {
          id: 'test',
          label: 'Test',
          commands: [
            {
              id: 'npm:test',
              kind: 'package.json',
              command: 'npm',
              args: ['run', 'test'],
              label: 'Run tests',
              description: 'Run the test suite',
              category: 'test',
              longRunning: false,
              source: null,
            },
          ],
        },
        {
          id: 'dev',
          label: 'Start / Dev',
          commands: [
            {
              id: 'readme:start',
              kind: 'readme',
              command: 'npm',
              args: ['run', 'dev'],
              label: 'Start the app',
              description: 'Start the dev server',
              category: 'dev',
              longRunning: true,
              source: { kind: 'readme', docPath: '/repo/README.md', line: 12 },
            },
          ],
        },
      ],
      meta: { total: 3, skipped: 0 },
    },
    setup: { status: 'not-started' },
    activeRun: null,
    lastRuns: {
      'npm:test': { lastRunAt: '2026-07-31T07:30:00Z', lastExitCode: 0 },
    },
    ...overrides,
  };
}

function run(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    runId: 'run-1',
    repoPath: '/repo',
    kind: 'command',
    commandId: 'npm:test',
    command: 'npm',
    args: ['run', 'test'],
    status: 'running',
    exitCode: null,
    stdout: 'PASS 1 test\n',
    stderr: '',
    startedAt: '2026-07-31T08:05:00Z',
    finishedAt: null,
    ...overrides,
  };
}

describe('WorkspaceExecutionTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getOrchestratorHealth).mockResolvedValue(health);
    vi.mocked(api.listOrchestratorSessions).mockResolvedValue([session()]);
    vi.mocked(api.getOrchestratorSession).mockResolvedValue(session());
    vi.mocked(api.openOrchestratorEventStream).mockImplementation((_id, handlers) => {
      handlers.onOpen();
      return () => {};
    });
    vi.mocked(executionApi.getExecutionOverview).mockResolvedValue(overview());
  });

  it.each([
    ['normal', session(), true, null, 'normal'],
    ['waiting-input', session({ inputRequests: [{ status: 'pending', prompt: 'Choose a target' }] }), true, null, 'waiting-input'],
    ['validation-failed', session({ workPoints: [{ validation: { status: 'failed' } }] }), true, null, 'validation-failed'],
    ['stale-approval', session({ approvals: [{ status: 'stale' }] }), true, null, 'stale-approval'],
    ['disconnected', session(), false, null, 'disconnected'],
    ['completed', session({ state: 'completed' }), true, null, 'completed'],
  ])('derives the %s presentation', (_label, value, connected, code, expected) => {
    expect(deriveExecutionPresentation(value, connected, code)).toBe(expected);
  });

  it.each([
    ['waiting-input', session({ inputRequests: [{ status: 'pending', prompt: 'Choose a target' }] })],
    ['validation-failed', session({ workPoints: [{ validation: { status: 'failed' } }] })],
    ['stale-approval', session({ approvals: [{ status: 'stale', summary: 'Target moved' }] })],
    ['completed', session({ state: 'completed' })],
  ])('renders the %s operator state', async (stateName, value) => {
    vi.mocked(api.listOrchestratorSessions).mockResolvedValue([value]);
    vi.mocked(api.getOrchestratorSession).mockResolvedValue(value);
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId(`workspace-execution-state-${stateName}`)).toBeInTheDocument();
    });
  });

  it('renders normal evidence, planning links, approvals, and controls', async () => {
    const value = session({
      approvals: [{ status: 'pending', summary: 'Approve verified commit' }],
    });
    vi.mocked(api.listOrchestratorSessions).mockResolvedValue([value]);
    vi.mocked(api.getOrchestratorSession).mockResolvedValue(value);
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-execution-evidence')).toHaveTextContent('diff-1');
    expect(screen.getByTestId('workspace-execution-approval')).toHaveTextContent('Approve verified commit');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Goal: goal-1/ })).toBeInTheDocument();
  });

  it('renders disconnected state when health is unavailable', async () => {
    vi.mocked(api.getOrchestratorHealth).mockResolvedValue({ ...health, ok: false });
    vi.mocked(api.openOrchestratorEventStream).mockImplementation((_id, handlers) => {
      handlers.onError();
      return () => {};
    });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-state-disconnected')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-execution-create-button')).toBeDisabled();
  });

  it('shows the default-off pilot state and disables unavailable adapters', async () => {
    vi.mocked(api.getOrchestratorHealth).mockResolvedValue({
      ...health,
      pilot: { ...health.pilot!, enabled: false },
    });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    expect(await screen.findByTestId('workspace-execution-pilot-disabled')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-execution-create-button')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'OpenCode' })).toBeDisabled();
  });

  it('identifies the approval target and surfaces stale conflicts', async () => {
    const value = session({
      approvals: [{ status: 'pending', summary: 'Approve tree tree-1' }],
    });
    vi.mocked(api.listOrchestratorSessions).mockResolvedValue([value]);
    vi.mocked(api.getOrchestratorSession).mockResolvedValue(value);
    vi.mocked(api.mutateOrchestratorSession).mockRejectedValue(new Error('stale'));
    vi.mocked(api.readOrchestratorError).mockReturnValue({
      code: 'stale_state',
      message: 'Target HEAD moved',
      details: { expectedRevision: 2, actualRevision: 3 },
    });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-state-stale-approval')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Target HEAD moved');
    expect(api.mutateOrchestratorSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      'approvals',
      expect.objectContaining({ decision: 'approved' }),
    );
  });

  it('renders discovered commands grouped by category with setup card', async () => {
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-commands')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-execution-setup')).toHaveTextContent('Install dependencies');
    expect(screen.getByTestId('workspace-execution-setup-status')).toHaveTextContent('not-started');
    expect(screen.getByTestId('workspace-execution-category-test')).toHaveTextContent('Run tests');
    expect(screen.getByTestId('workspace-execution-command-npm:test')).toHaveTextContent('npm run test');
    expect(screen.getByTestId('workspace-execution-command-readme:start')).toHaveTextContent('README.md');
    expect(screen.getByTestId('workspace-execution-server-readme:start')).toHaveTextContent('Server');
    expect(screen.queryByTestId('workspace-execution-server-npm:test')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace-execution-outcome-npm:test')).toHaveTextContent('done');
    expect(screen.getByTestId('workspace-execution-repo-label')).toHaveTextContent('Repo One');
    expect(screen.getByTestId('workspace-execution-scan-time')).toHaveTextContent('Scanned');
  });

  it('starts a command run and refreshes the overview', async () => {
    vi.mocked(executionApi.runExecutionCommand).mockResolvedValue({
      runId: 'run-1',
      run: run(),
    });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-run-npm:test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('workspace-execution-run-npm:test'));
    await waitFor(() => {
      expect(executionApi.runExecutionCommand).toHaveBeenCalledWith('/repo', 'npm:test');
      expect(executionApi.getExecutionOverview).toHaveBeenCalledTimes(2);
    });
  });

  it('runs setup when the setup button is pressed', async () => {
    vi.mocked(executionApi.startExecutionSetup).mockResolvedValue({
      runId: 'run-setup',
      run: run({ runId: 'run-setup', commandId: 'setup', command: 'npm', args: ['install'] }),
    });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-setup-button')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('workspace-execution-setup-button'));
    await waitFor(() => {
      expect(executionApi.startExecutionSetup).toHaveBeenCalledWith('/repo');
    });
  });

  it('shows an active run with stop and expands its output', async () => {
    const activeRun = run({ runId: 'run-1', status: 'running' });
    vi.mocked(executionApi.getExecutionOverview).mockResolvedValue(overview({ activeRun }));
    vi.mocked(executionApi.getExecutionRun).mockResolvedValue(activeRun);
    vi.mocked(executionApi.stopExecutionRun).mockResolvedValue({ ...activeRun, status: 'stopped' });
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-run-npm:test')).toHaveTextContent('Stop');
    });
    fireEvent.click(screen.getByTestId('workspace-execution-expand-npm:test'));
    expect(screen.getByTestId('workspace-execution-output-npm:test')).toHaveTextContent('PASS 1 test');
    fireEvent.click(screen.getByTestId('workspace-execution-run-npm:test'));
    await waitFor(() => {
      expect(executionApi.stopExecutionRun).toHaveBeenCalledWith('run-1');
    });
  });

  it('renders http(s) addresses in run output as clickable links', async () => {
    const activeRun = run({
      runId: 'run-1',
      status: 'running',
      stdout: 'Local: http://localhost:5173\nNetwork: http://192.168.0.10:5173, see it.\n',
    });
    vi.mocked(executionApi.getExecutionOverview).mockResolvedValue(overview({ activeRun }));
    vi.mocked(executionApi.getExecutionRun).mockResolvedValue(activeRun);
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-run-npm:test')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('workspace-execution-expand-npm:test'));

    const localLink = screen.getByRole('link', { name: 'http://localhost:5173' });
    expect(localLink).toHaveAttribute('href', 'http://localhost:5173');
    expect(localLink).toHaveAttribute('target', '_blank');
    expect(localLink).toHaveAttribute('rel', 'noreferrer');

    const networkLink = screen.getByRole('link', { name: 'http://192.168.0.10:5173' });
    expect(networkLink).toHaveAttribute('href', 'http://192.168.0.10:5173');
    expect(screen.getByTestId('workspace-execution-output-npm:test')).toHaveTextContent('see it.');
  });

  it('renders the empty state when nothing is discovered', async () => {
    vi.mocked(executionApi.getExecutionOverview).mockResolvedValue(overview({
      discovery: {
        ...overview().discovery,
        setup: null,
        categories: [],
        meta: { total: 0, skipped: 0 },
      },
      setup: { status: 'not-started' },
      lastRuns: {},
    }));
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('workspace-execution-setup')).not.toBeInTheDocument();
  });

  it('refreshes discovery from the toolbar', async () => {
    vi.mocked(executionApi.refreshExecutionCommands).mockResolvedValue(overview().discovery);
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-commands-refresh')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('workspace-execution-commands-refresh'));
    await waitFor(() => {
      expect(executionApi.refreshExecutionCommands).toHaveBeenCalledWith('/repo');
    });
  });

  it('surfaces command errors in the alert area', async () => {
    vi.mocked(executionApi.getExecutionOverview).mockRejectedValue(new Error('boom'));
    render(<WorkspaceExecutionTab repoPath="/repo" repoId="repo-1" repoLabel="Repo One" />);
    await waitFor(() => {
      expect(screen.getByTestId('workspace-execution-commands-error')).toHaveTextContent('boom');
    });
  });
});
