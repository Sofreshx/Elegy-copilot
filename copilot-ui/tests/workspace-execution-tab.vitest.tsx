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

import WorkspaceExecutionTab, {
  deriveExecutionPresentation,
} from '../ui/src/views/Workspace/WorkspaceExecutionTab';
import * as api from '../ui/src/lib/api/orchestrator';
import type {
  OrchestratorHealth,
  OrchestratorSession,
} from '../ui/src/lib/api/orchestrator';

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
});
