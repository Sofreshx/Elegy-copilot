import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ui/src/lib/store', () => {
  const navState = {
    selectedSessionId: 'test-session-id',
    sessionDetailTab: 'activity',
    selectedSessionContext: null,
  };

  const sessionState = {
    sessionId: 'test-session-id',
    sessionSource: 'test',
    sessionSandbox: null,
    loading: false,
    error: null,
    sdkMessages: [],
    sdkPendingContent: '',
    sdkPendingReasoning: '',
    sdkStreamStatus: 'disconnected',
    composerPrompt: '',
    structuredState: { id: 'test-session-id', summary: 'Test' },
    orchestration: { objective: 'Test Session' },
    plans: [],
    planContents: {},
    handoff: null,
    proposition: null,
    verificationGuide: null,
    agentUsage: null,
    toolCalls: [],
    pendingQuestions: [],
    sendError: null,
    lastFailedPrompt: null,
    lastFailedMessageId: null,
    stopping: false,
    refreshing: false,
    historyLoaded: true,
    streamPaused: false,
    isRemote: false,
    remoteUrl: null,
    remoteSessionId: null,
    continuationActionKey: null,
  };

  return {
    useStoreValue: vi.fn((store: any) => {
      // Navigation store has selectSession — return nav state
      if (store.selectSession) return navState;
      // Default to session detail state for sessionDetailStore or any other store
      return sessionState;
    }),
    createStore: vi.fn((initialState: any) => ({
      getState: () => initialState,
      setState: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
    })),
  };
});

vi.mock('../ui/src/stores/navigation', () => ({
  navigationStore: {
    selectedSessionId: 'test-session-id',
    sessionDetailTab: 'activity',
    selectedSessionContext: null,
    selectSession: vi.fn(),
    navigate: vi.fn(),
  },
}));

vi.mock('../ui/src/views/Sessions/sessionDetailStore', () => ({
  sessionDetailStore: {
    loading: false,
    error: null,
    sdkMessages: [],
    orchestration: { objective: 'Test Session' },
    structuredState: { id: 'test-session-id', summary: 'Test' },
    sessionSource: 'test',
    sdkStreamStatus: 'disconnected',
    refreshing: false,
    stopping: false,
    agentUsage: null,
    continuationActionKey: null,
    loadSession: vi.fn().mockResolvedValue(undefined),
    attachStream: vi.fn(),
    detachStream: vi.fn(),
    refreshSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    setComposerPrompt: vi.fn(),
    copyContinuationPrompt: vi.fn().mockResolvedValue(undefined),
    downloadContinuationPackage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../ui/src/views/Sessions/RemoteSessionBanner', () => ({
  default: () => null,
}));

describe('SessionDetailView layout contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders session detail as a view-shell', async () => {
    const { default: SessionDetailView } = await import('../ui/src/views/Sessions/SessionDetailView');

    await act(async () => {
      render(<SessionDetailView />);
    });

    const view = screen.getByTestId('session-detail-view');
    expect(view).toBeInTheDocument();
    expect(view.className).toContain('view-shell');
  });

  it('keeps header outside session-detail-content scroll region', async () => {
    const { default: SessionDetailView } = await import('../ui/src/views/Sessions/SessionDetailView');

    await act(async () => {
      render(<SessionDetailView />);
    });

    const content = screen.getByTestId('session-detail-content');
    const tabs = screen.getByTestId('session-detail-tabs');

    // Tabs should NOT be inside the scrollable content
    expect(content.contains(tabs)).toBe(false);
  });

  it('renders session-detail-content as a view-scroll region', async () => {
    const { default: SessionDetailView } = await import('../ui/src/views/Sessions/SessionDetailView');

    await act(async () => {
      render(<SessionDetailView />);
    });

    const content = screen.getByTestId('session-detail-content');
    expect(content).toBeInTheDocument();
    expect(content.className).toContain('view-scroll');
  });
});
