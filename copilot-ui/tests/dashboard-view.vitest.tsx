import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigationStore } from '../ui/src/stores/navigation';
describe('DashboardView', () => {
  beforeEach(() => {
    navigationStore.reset();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
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
});
