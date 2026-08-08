import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
describe('DashboardView', () => {
  beforeEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    navigationStore.reset();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/harness-sessions/summary')) {
        return {
          ok: true,
          json: async () => ({
            snapshotId: 'snapshot-1',
            totalSessionCount: 6,
            harnesses: [
              { harnessId: 'copilot', title: 'Copilot', inventoryAvailable: true, sessionCount: 2, latestUpdatedAtMs: Date.UTC(2026, 4, 23, 14, 0, 0) },
              { harnessId: 'codex', title: 'Codex', inventoryAvailable: true, sessionCount: 3, latestUpdatedAtMs: Date.UTC(2026, 4, 24, 8, 0, 0) },
              { harnessId: 'opencode', title: 'OpenCode', inventoryAvailable: false, inventoryReason: 'inventory_not_supported', sessionCount: 0, latestUpdatedAtMs: null },
              { harnessId: 'claude-code', title: 'Claude Code', inventoryAvailable: false, inventoryReason: 'inventory_not_supported', sessionCount: 0, latestUpdatedAtMs: null },
            ],
          }),
        };
      }
      if (/\/api\/dashboard\/harness-sessions\/[^/?]+\?/.test(url)) {
        const harnessId = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname.split('/').pop() || '');
        const sessions = harnessId === 'codex'
          ? [
            { sessionId: 'cx-older', title: 'Older Codex thread', status: 'unknown', updatedAtMs: Date.UTC(2026, 4, 20, 8, 0, 0), canOpen: false, source: 'codex' },
            { sessionId: 'cx-newer', title: 'Newest Codex thread', status: 'unknown', updatedAtMs: Date.UTC(2026, 4, 24, 8, 0, 0), canOpen: false, source: 'codex' },
          ]
          : [
            { sessionId: 'cp-1', title: 'Copilot oldest', status: 'idle', updatedAtMs: Date.UTC(2026, 4, 22, 10, 0, 0), repoLabel: 'elegy-copilot', canOpen: true, source: 'cli' },
            { sessionId: 'cp-2', title: 'Copilot newest', status: 'active', updatedAtMs: Date.UTC(2026, 4, 23, 14, 0, 0), repoLabel: 'elegy-copilot', canOpen: true, source: 'cli' },
          ];
        return {
          ok: true,
          json: async () => ({ snapshotId: 'snapshot-1', sessions, page: { hasMore: false, nextCursor: null } }),
        };
      }
      if (url.includes('/api/dashboard/harness-sessions')) {
        return {
          ok: true,
          json: async () => ({
            totalSessionCount: 6,
            harnesses: [
              {
                harnessId: 'copilot',
                title: 'Copilot',
                inventoryAvailable: true,
                sessionCount: 2,
                latestUpdatedAtMs: Date.UTC(2026, 4, 23, 14, 0, 0),
                sessions: [
                  {
                    sessionId: 'cp-1',
                    title: 'Copilot oldest',
                    status: 'idle',
                    updatedAtMs: Date.UTC(2026, 4, 22, 10, 0, 0),
                    repoLabel: 'elegy-copilot',
                    canOpen: true,
                    source: 'cli',
                  },
                  {
                    sessionId: 'cp-2',
                    title: 'Copilot newest',
                    status: 'active',
                    updatedAtMs: Date.UTC(2026, 4, 23, 14, 0, 0),
                    repoLabel: 'elegy-copilot',
                    canOpen: true,
                    source: 'cli',
                  },
                ],
              },
              {
                harnessId: 'codex',
                title: 'Codex',
                inventoryAvailable: true,
                sessionCount: 3,
                latestUpdatedAtMs: Date.UTC(2026, 4, 24, 8, 0, 0),
                sessions: [
                  {
                    sessionId: 'cx-older',
                    title: 'Older Codex thread',
                    status: 'unknown',
                    updatedAtMs: Date.UTC(2026, 4, 20, 8, 0, 0),
                    canOpen: false,
                    source: 'codex',
                  },
                  {
                    sessionId: 'cx-newer',
                    title: 'Newest Codex thread',
                    status: 'unknown',
                    updatedAtMs: Date.UTC(2026, 4, 24, 8, 0, 0),
                    canOpen: false,
                    source: 'codex',
                  },
                ],
              },
              {
                harnessId: 'opencode',
                title: 'OpenCode',
                inventoryAvailable: false,
                inventoryReason: 'inventory_not_supported',
                sessionCount: 0,
                latestUpdatedAtMs: null,
                sessions: [],
              },
              {
                harnessId: 'claude-code',
                title: 'Claude Code',
                inventoryAvailable: false,
                inventoryReason: 'inventory_not_supported',
                sessionCount: 0,
                latestUpdatedAtMs: null,
                sessions: [],
              },
            ],
            inventorySummary: {
              availableHarnessCount: 2,
              unavailableHarnessCount: 3,
            },
          }),
        };
      }
      if (url.includes('/api/dashboard/summary')) {
        return {
          ok: true,
          json: async () => ({
            activeSessionCount: 1,
            totalSessionCount: 6,
            healthIndicator: 'ok',
            recentActivity: [],
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it('renders harness rows and swaps the visible sessions when a harness is selected', async () => {
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');

    render(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('execution-hub-harness-list')).toBeInTheDocument();
    });

    expect(screen.getByTestId('execution-hub-count')).toHaveTextContent('6 sessions');
    expect(screen.getByTestId('execution-hub-harness-copilot')).toHaveTextContent('Copilot');
    expect(screen.getByTestId('execution-hub-harness-codex')).toHaveTextContent('3 sessions');

    fireEvent.click(screen.getByTestId('execution-hub-harness-codex'));

    await waitFor(() => {
      expect(screen.getByTestId('execution-hub-selected-harness-title')).toHaveTextContent('Codex');
    });

    const sessionList = screen.getByTestId('execution-hub-harness-session-list');
    const titles = within(sessionList)
      .getAllByTestId(/execution-hub-harness-session-title-/)
      .map((node) => node.textContent);

    expect(titles).toEqual(['Newest Codex thread', 'Older Codex thread']);
  });

  it('shows an explicit unavailable message for harnesses without inventory support', async () => {
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');

    render(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('execution-hub-harness-opencode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('execution-hub-harness-opencode'));

    await waitFor(() => {
      expect(screen.getByTestId('execution-hub-harness-unavailable')).toHaveTextContent(
        'Session inventory is not available for OpenCode yet.',
      );
    });
  });

  it('renders Claude Code harness card without breaking existing harnesses', async () => {
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');

    render(<DashboardView />);

    await waitFor(() => {
      expect(screen.getByTestId('execution-hub-harness-list')).toBeInTheDocument();
    });

    // Claude Code should appear among the harness entries
    expect(screen.getByTestId('execution-hub-harness-claude-code')).toHaveTextContent('Claude Code');

    // Existing harnesses should still render
    expect(screen.getByTestId('execution-hub-harness-copilot')).toHaveTextContent('Copilot');
    expect(screen.getByTestId('execution-hub-harness-codex')).toHaveTextContent('3 sessions');
    expect(screen.getByTestId('execution-hub-harness-opencode')).toBeInTheDocument();
  });

  it('loads the summary before a bounded session page and never requests the legacy full inventory', async () => {
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByTestId('execution-hub-harness-session-list')).toBeInTheDocument());

    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(urls).toContain('/api/dashboard/harness-sessions/summary');
    expect(urls.some((url) => url.includes('/api/dashboard/harness-sessions/copilot?limit=100'))).toBe(true);
    expect(urls).not.toContain('/api/dashboard/harness-sessions');
  });

  it('keeps the last successful inventory visible when a refresh fails', async () => {
    const fallbackFetch = vi.mocked(fetch).getMockImplementation()!;
    let summaryCalls = 0;
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/dashboard/harness-sessions/summary')) {
        summaryCalls += 1;
        if (summaryCalls > 1) return Promise.reject(new Error('Temporary inventory failure'));
      }
      return fallbackFetch(input, init);
    });
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');
    render(<DashboardView />);
    await waitFor(() => expect(screen.getByText('Copilot newest')).toBeInTheDocument());

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByTestId('execution-hub-refresh-error')).toHaveTextContent('Temporary inventory failure'));
    expect(screen.getByText('Copilot newest')).toBeInTheDocument();
  });

  it('appends another bounded page when Load more is selected', async () => {
    const fallbackFetch = vi.mocked(fetch).getMockImplementation()!;
    let pageCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!/\/api\/dashboard\/harness-sessions\/[^/?]+\?/.test(url)) return fallbackFetch(input, init);
      pageCallCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          snapshotId: 'snapshot-1',
          sessions: pageCallCount === 1
            ? [{ sessionId: 'page-1', title: 'First page', status: 'unknown', canOpen: false }]
            : [{ sessionId: 'page-2', title: 'Second page', status: 'unknown', canOpen: false }],
          page: pageCallCount === 1
            ? { hasMore: true, nextCursor: 'cursor-2' }
            : { hasMore: false, nextCursor: null },
        }),
      };
    });
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');
    render(<DashboardView />);

    await waitFor(() => expect(screen.getByTestId('execution-hub-load-more')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('execution-hub-load-more'));

    await waitFor(() => expect(screen.getByText('Second page')).toBeInTheDocument());
    expect(screen.getByText('First page')).toBeInTheDocument();
    expect(pageCallCount).toBe(2);
  });

  it('pauses polling while hidden and does not overlap an unfinished refresh', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    let summaryCalls = 0;
    let resolveSummary: ((value: unknown) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/harness-sessions/summary')) {
        summaryCalls += 1;
        return new Promise((resolve) => { resolveSummary = resolve; });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => null });
    }));
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');
    const view = render(<DashboardView />);

    await act(async () => { await Promise.resolve(); });
    expect(summaryCalls).toBe(0);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(summaryCalls).toBe(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(summaryCalls).toBe(1);

    view.unmount();
    resolveSummary?.({ ok: true, status: 200, json: async () => ({ harnesses: [] }) });
    vi.useRealTimers();
  });

  it('aborts in-flight Runtime requests when the view unmounts', async () => {
    const observedSignals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal) observedSignals.push(init.signal);
      return new Promise(() => {});
    }));
    const { default: DashboardView } = await import('../ui/src/views/DashboardView');
    const view = render(<DashboardView />);

    await waitFor(() => expect(observedSignals.length).toBeGreaterThan(0));
    view.unmount();

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
  });
});
