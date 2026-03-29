import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiRuntimeOverlaySession } from '../ui/src/lib/types';

function createMockStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState: (nextState: T) => {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

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
    observations: [],
    annotations: [],
    changeRequests: [],
    qualitySignals: [],
    lastAnalyzedAt: '2026-03-29T09:03:00.000Z',
    createdAt: '2026-03-29T08:59:00.000Z',
    updatedAt: '2026-03-29T09:03:00.000Z',
    ...overrides,
  };
}

const navigationState = vi.hoisted(() => ({
  activeTabId: 'home-runtime',
  runtimeSectionId: 'overview',
  diagnosticsSectionId: 'runtime',
  catalogSectionId: 'overview',
  sessionsMode: 'local',
}));

const overviewState = vi.hoisted(() => ({
  health: { ok: true, runtime: {}, planningPersistence: {}, policy: {} },
  gatewayState: null,
  catalogHealth: null,
  error: null as string | null,
  loading: false,
  lastUpdatedAtMs: Date.parse('2026-03-29T09:05:00.000Z'),
}));

const sdkHealthState = vi.hoisted(() => ({
  health: null,
  error: null as string | null,
  loading: false,
  lastUpdatedAtMs: Date.parse('2026-03-29T09:05:00.000Z'),
}));

const localSessionsState = vi.hoisted(() => ({
  sessions: [],
  loading: false,
  error: null as string | null,
}));

const sandboxesState = vi.hoisted(() => ({
  sandboxes: [],
  loading: false,
  error: null as string | null,
  tokenMissingBlocked: false,
  tokenMissingMessage: '',
}));

const overlayState = vi.hoisted(() => ({
  sessions: [] as UiRuntimeOverlaySession[],
  selectedSessionId: null as string | null,
  loading: false,
  error: null as string | null,
}));

const mockStores = vi.hoisted(() => ({
  navigationStore: createMockStore(navigationState),
  stateOverviewStore: createMockStore(overviewState),
  sdkHealthStore: createMockStore(sdkHealthState),
  sessionsStore: createMockStore(localSessionsState),
  sandboxesStore: createMockStore(sandboxesState),
  uiRuntimeOverlayStore: createMockStore(overlayState),
}));

const navigationMocks = vi.hoisted(() => ({
  goToRuntime: vi.fn(),
  setRuntimeSectionId: vi.fn(),
}));

const lifecycleMocks = vi.hoisted(() => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refreshOverview: vi.fn(),
  refreshSdkHealth: vi.fn(),
  loadSessions: vi.fn(),
  refreshSessions: vi.fn(),
  loadSandboxes: vi.fn(),
  refreshSandboxes: vi.fn(),
  loadOverlaySessions: vi.fn(),
  selectOverlaySession: vi.fn(),
}));

vi.mock('../ui/src/lib/api', () => ({
  patchVscodeGithubMcp: vi.fn(),
}));

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: {
    ...mockStores.navigationStore,
    goToRuntime: navigationMocks.goToRuntime,
    setRuntimeSectionId: navigationMocks.setRuntimeSectionId,
  },
}));

vi.mock('../ui/src/tabs/State/stateOverviewStore', () => ({
  stateOverviewStore: {
    ...mockStores.stateOverviewStore,
    startPolling: lifecycleMocks.startPolling,
    stopPolling: lifecycleMocks.stopPolling,
    refresh: lifecycleMocks.refreshOverview,
  },
}));

vi.mock('../ui/src/stores/sdkHealthStore', () => ({
  sdkHealthStore: {
    ...mockStores.sdkHealthStore,
    refresh: lifecycleMocks.refreshSdkHealth,
  },
}));

vi.mock('../ui/src/tabs/Sessions/sessionsStore', () => ({
  sessionsStore: {
    ...mockStores.sessionsStore,
    loadSessions: lifecycleMocks.loadSessions,
    refresh: lifecycleMocks.refreshSessions,
  },
}));

vi.mock('../ui/src/tabs/Sandboxes/sandboxesStore', () => ({
  sandboxesStore: {
    ...mockStores.sandboxesStore,
    loadSandboxes: lifecycleMocks.loadSandboxes,
    refresh: lifecycleMocks.refreshSandboxes,
  },
  readSandboxId: vi.fn(() => ''),
}));

vi.mock('../ui/src/tabs/Executor/uiRuntimeOverlayStore', () => ({
  uiRuntimeOverlayStore: {
    ...mockStores.uiRuntimeOverlayStore,
    load: lifecycleMocks.loadOverlaySessions,
    selectSession: lifecycleMocks.selectOverlaySession,
  },
}));

vi.mock('../ui/src/tabs/Gateway/GatewayView', () => ({
  default: () => null,
}));

vi.mock('../ui/src/tabs/Executor/ExecutorView', () => ({
  default: () => null,
}));

vi.mock('../ui/src/tabs/LSP/LspView', () => ({
  default: () => null,
}));

vi.mock('../ui/src/tabs/Sessions/SessionsView', () => ({
  default: () => null,
}));

vi.mock('../ui/src/tabs/Tracker/TrackerView', () => ({
  default: () => null,
}));

import HomeRuntimeView from '../ui/src/tabs/HomeRuntime/HomeRuntimeView';

describe('HomeRuntimeView overlay quick action', () => {
  beforeEach(() => {
    mockStores.navigationStore.setState({
      activeTabId: 'home-runtime',
      runtimeSectionId: 'overview',
      diagnosticsSectionId: 'runtime',
      catalogSectionId: 'overview',
      sessionsMode: 'local',
    });
    mockStores.stateOverviewStore.setState({
      health: { ok: true, runtime: {}, planningPersistence: {}, policy: {} },
      gatewayState: null,
      catalogHealth: null,
      error: null,
      loading: false,
      lastUpdatedAtMs: Date.parse('2026-03-29T09:05:00.000Z'),
    });
    mockStores.sdkHealthStore.setState({
      health: null,
      error: null,
      loading: false,
      lastUpdatedAtMs: Date.parse('2026-03-29T09:05:00.000Z'),
    });
    mockStores.sessionsStore.setState({
      sessions: [],
      loading: false,
      error: null,
    });
    mockStores.sandboxesStore.setState({
      sandboxes: [],
      loading: false,
      error: null,
      tokenMissingBlocked: false,
      tokenMissingMessage: '',
    });
    mockStores.uiRuntimeOverlayStore.setState({
      sessions: [],
      selectedSessionId: null,
      loading: false,
      error: null,
    });
    navigationMocks.goToRuntime.mockReset();
    navigationMocks.setRuntimeSectionId.mockReset();
    lifecycleMocks.startPolling.mockReset();
    lifecycleMocks.stopPolling.mockReset();
    lifecycleMocks.refreshOverview.mockReset();
    lifecycleMocks.refreshSdkHealth.mockReset();
    lifecycleMocks.loadSessions.mockReset();
    lifecycleMocks.refreshSessions.mockReset();
    lifecycleMocks.loadSandboxes.mockReset();
    lifecycleMocks.refreshSandboxes.mockReset();
    lifecycleMocks.loadOverlaySessions.mockReset();
    lifecycleMocks.selectOverlaySession.mockReset();
  });

  it('prefers the selected non-closed session even when resumable sessions are out of timestamp order', () => {
    mockStores.uiRuntimeOverlayStore.setState({
      sessions: [
        createOverlaySession({
          id: 'overlay-newest',
          repoLabel: 'Newest Attached',
          updatedAt: '2026-03-29T09:06:00.000Z',
        }),
        createOverlaySession({
          id: 'overlay-selected',
          repoLabel: 'Selected Attached',
          updatedAt: '2026-03-29T09:02:00.000Z',
        }),
        createOverlaySession({
          id: 'overlay-middle',
          repoLabel: 'Middle Attached',
          updatedAt: '2026-03-29T09:04:00.000Z',
        }),
      ],
      selectedSessionId: 'overlay-selected',
      loading: false,
      error: null,
    });

    render(<HomeRuntimeView />);

    expect(lifecycleMocks.loadOverlaySessions).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('runtime-overview-overlay-action')).toHaveTextContent('Resume Overlay in Executor');
    expect(screen.getByText(/Continue Selected Attached with the overlay session ready for Executor handoff\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('runtime-overview-overlay-action'));

    expect(lifecycleMocks.selectOverlaySession).toHaveBeenCalledWith('overlay-selected');
    expect(navigationMocks.goToRuntime).toHaveBeenCalledWith('executor');
  });

  it('falls back to the newest non-closed session by updatedAt or createdAt when store order drifts', () => {
    mockStores.uiRuntimeOverlayStore.setState({
      sessions: [
        createOverlaySession({ id: 'overlay-closed', status: 'closed', repoLabel: 'Closed Review' }),
        createOverlaySession({
          id: 'overlay-first-resumable',
          repoLabel: 'First Resumable',
          updatedAt: '2026-03-29T09:01:00.000Z',
          createdAt: '2026-03-29T09:01:00.000Z',
        }),
        createOverlaySession({
          id: 'overlay-newest-created',
          repoLabel: 'Newest From CreatedAt',
          updatedAt: '',
          createdAt: '2026-03-29T09:06:00.000Z',
        }),
      ],
      selectedSessionId: 'overlay-closed',
      loading: false,
      error: null,
    });

    render(<HomeRuntimeView />);

    expect(lifecycleMocks.loadOverlaySessions).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('runtime-overview-overlay-action')).toHaveTextContent('Resume Overlay in Executor');
    expect(screen.getByText(/Continue Newest From CreatedAt with the overlay session ready for Executor handoff\./i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('runtime-overview-overlay-action'));

    expect(lifecycleMocks.selectOverlaySession).toHaveBeenCalledWith('overlay-newest-created');
    expect(navigationMocks.goToRuntime).toHaveBeenCalledWith('executor');
  });

  it('falls back to Runtime sessions when every overlay session is closed', () => {
    mockStores.uiRuntimeOverlayStore.setState({
      sessions: [
        createOverlaySession({ id: 'overlay-closed', status: 'closed', repoLabel: 'Closed Review' }),
      ],
      selectedSessionId: 'overlay-closed',
      loading: false,
      error: null,
    });

    render(<HomeRuntimeView />);

    expect(screen.getByTestId('runtime-overview-overlay-action')).toHaveTextContent('Open Overlay Sessions');
    expect(screen.getByText('Open Runtime / Sessions to inspect overlay sessions.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('runtime-overview-overlay-action'));

    expect(lifecycleMocks.selectOverlaySession).not.toHaveBeenCalled();
    expect(navigationMocks.goToRuntime).toHaveBeenCalledWith('sessions', { sessionsMode: 'local' });
  });
});