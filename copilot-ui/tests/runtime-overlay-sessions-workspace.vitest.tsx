import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiRuntimeOverlaySession } from '../ui/src/lib/types';

const overlayState = vi.hoisted(() => ({
  sessions: [] as UiRuntimeOverlaySession[],
  selectedSessionId: null as string | null,
  loading: false,
  error: null as string | null,
}));

const overlayStoreMocks = vi.hoisted(() => ({
  load: vi.fn(),
  selectSession: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getState: vi.fn(() => overlayState),
}));

const navigationMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('../ui/src/tabs/Executor/uiRuntimeOverlayStore', () => ({
  uiRuntimeOverlayStore: overlayStoreMocks,
}));

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: navigationMocks,
}));

import OverlaySessionsWorkspace from '../ui/src/tabs/Sessions/OverlaySessionsWorkspace';

function createOverlaySession(overrides: Partial<UiRuntimeOverlaySession> = {}): UiRuntimeOverlaySession {
  return {
    id: 'overlay-1',
    status: 'attached',
    runtimeUrl: 'http://127.0.0.1:4173/app',
    runtimeOrigin: 'http://127.0.0.1:4173',
    repoId: 'repo-1',
    repoPath: 'C:/Repos/instruction-engine',
    repoLabel: 'Storefront App',
    packageRoot: 'copilot-ui',
    observations: [{
      id: 'obs-1',
      kind: 'snapshot',
      summary: 'Primary CTA stayed disabled.',
      locator: null,
      snapshotSummary: 'Checkout button looked inactive.',
      interaction: null,
      state: null,
      createdAt: '2026-03-29T09:00:00.000Z',
      updatedAt: '2026-03-29T09:00:00.000Z',
    }],
    annotations: [{
      id: 'ann-1',
      observationId: 'obs-1',
      title: 'CTA regression',
      message: 'Button never enabled after valid input.',
      status: 'open',
      createdAt: '2026-03-29T09:01:00.000Z',
      updatedAt: '2026-03-29T09:01:00.000Z',
    }],
    changeRequests: [{
      id: 'cr-1',
      observationId: 'obs-1',
      annotationId: 'ann-1',
      title: 'Re-enable checkout CTA',
      request: 'Investigate the disabled checkout CTA and restore the happy path.',
      prompt: null,
      status: 'draft',
      executorJobId: null,
      executorRunId: null,
      createdAt: '2026-03-29T09:02:00.000Z',
      updatedAt: '2026-03-29T09:02:00.000Z',
      queuedAt: null,
    }],
    qualitySignals: [{
      id: 'qs-1',
      observationId: 'obs-1',
      kind: 'blocked-control',
      severity: 'warning',
      summary: 'Observed control appears blocked or disabled.',
      createdAt: '2026-03-29T09:00:00.000Z',
    }],
    lastAnalyzedAt: '2026-03-29T09:03:00.000Z',
    createdAt: '2026-03-29T08:59:00.000Z',
    updatedAt: '2026-03-29T09:03:00.000Z',
    ...overrides,
  };
}

describe('OverlaySessionsWorkspace', () => {
  beforeEach(() => {
    overlayState.sessions = [createOverlaySession()];
    overlayState.selectedSessionId = 'overlay-1';
    overlayState.loading = false;
    overlayState.error = null;
    overlayStoreMocks.load.mockReset();
    overlayStoreMocks.selectSession.mockReset();
    navigationMocks.navigate.mockReset();
  });

  it('resumes attached sessions into Executor and keeps review lightweight', () => {
    render(<OverlaySessionsWorkspace />);

    expect(overlayStoreMocks.load).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('runtime-overlay-sessions-list')).getByText('Storefront App')).toBeInTheDocument();
    expect(screen.getByText(/1 observation\(s\) \| 1 annotation\(s\) \| 1 change request\(s\)/i)).toBeInTheDocument();
    const selectedSessionSummary = screen.getByTestId('runtime-overlay-selected-session-summary');
    expect(selectedSessionSummary).toBeInTheDocument();
    expect(selectedSessionSummary).toHaveTextContent('Storefront App');
    expect(selectedSessionSummary).toHaveTextContent(/Quality Signals\s*1/i);
    expect(screen.getByTestId('runtime-overlay-session-open-executor-overlay-1')).toHaveTextContent('Resume');
    expect(screen.getByTestId('runtime-overlay-session-select-overlay-1')).toHaveTextContent('Reviewing');

    fireEvent.click(screen.getByTestId('runtime-overlay-session-select-overlay-1'));

    expect(overlayStoreMocks.selectSession).toHaveBeenCalledWith('overlay-1');
    expect(navigationMocks.navigate).not.toHaveBeenCalled();

    overlayStoreMocks.selectSession.mockClear();

    fireEvent.click(screen.getByTestId('runtime-overlay-session-open-executor-overlay-1'));

    expect(overlayStoreMocks.selectSession).toHaveBeenCalledWith('overlay-1');
    expect(navigationMocks.navigate).toHaveBeenCalledWith('dashboard');
  });

  it('keeps closed sessions reviewable without resumable handoff actions', () => {
    overlayState.sessions = [createOverlaySession({ id: 'overlay-closed', status: 'closed' })];
    overlayState.selectedSessionId = 'overlay-closed';

    render(<OverlaySessionsWorkspace />);

    expect(screen.queryByTestId('runtime-overlay-open-selected-executor')).not.toBeInTheDocument();
    expect(screen.queryByTestId('runtime-overlay-session-open-executor-overlay-closed')).not.toBeInTheDocument();
    expect(screen.getByTestId('runtime-overlay-session-select-overlay-closed')).toHaveTextContent('Reviewing');
    expect(screen.getByTestId('runtime-overlay-selected-session-summary')).toHaveTextContent(
      'Closed overlay sessions stay reviewable here without reopening Executor handoff.',
    );

    fireEvent.click(screen.getByTestId('runtime-overlay-session-select-overlay-closed'));

    expect(overlayStoreMocks.selectSession).toHaveBeenCalledWith('overlay-closed');
    expect(navigationMocks.navigate).not.toHaveBeenCalled();
  });
});
