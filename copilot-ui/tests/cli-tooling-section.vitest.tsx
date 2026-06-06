import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CliToolingSection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const mockResponse = (body: unknown) => ({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => body,
      });

      if (url.includes('/api/tooling/cli/status')) {
        return mockResponse({
          ok: true,
          tools: [
            {
              id: 'opencode-cli',
              title: 'OpenCode CLI',
              installed: true,
              path: 'opencode-ai',
              version: '2.1.0',
              lastError: null,
            },
            {
              id: 'codex-cli',
              title: 'Codex CLI',
              installed: false,
              path: null,
              version: null,
              lastError: 'npm error: not found',
            },
            {
              id: 'claude-cli',
              title: 'Claude Code CLI',
              installed: false,
              path: null,
              version: null,
              lastError: 'npm error: not found',
            },
          ],
          checkedAt: '2026-06-06T00:00:00.000Z',
        });
      }
      if (url.includes('/api/dashboard/summary')) {
        return mockResponse({
          activeSessionCount: 0,
          totalSessionCount: 0,
          healthIndicator: 'ok',
          recentActivity: [],
        });
      }
      return mockResponse({});
    }));
  });

  it('renders CLI tooling section with installed and not-installed states', async () => {
    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');

    render(<UpdatesSection />);

    await waitFor(() => {
      expect(screen.getByTestId('updates-cli-section')).toBeInTheDocument();
    });

    // All three CLI tool cards should render
    expect(screen.getByTestId('updates-cli-opencode-cli-card')).toBeInTheDocument();
    expect(screen.getByTestId('updates-cli-codex-cli-card')).toBeInTheDocument();
    expect(screen.getByTestId('updates-cli-claude-cli-card')).toBeInTheDocument();

    // OpenCode CLI should show installed status
    const opencodeCard = screen.getByTestId('updates-cli-opencode-cli-card');
    expect(within(opencodeCard).getByTestId('updates-cli-opencode-cli-health')).toHaveTextContent('2.1.0');
    expect(within(opencodeCard).getByTestId('updates-cli-opencode-cli-version')).toHaveTextContent('2.1.0');

    // Codex CLI should show not installed
    const codexCard = screen.getByTestId('updates-cli-codex-cli-card');
    expect(within(codexCard).getByTestId('updates-cli-codex-cli-version')).toHaveTextContent('not detected');
    expect(within(codexCard).getByTestId('updates-cli-codex-cli-error')).toHaveTextContent('npm error: not found');

    // Claude Code CLI should show install button (because not installed)
    const claudeCard = screen.getByTestId('updates-cli-claude-cli-card');
    expect(within(claudeCard).getByTestId('updates-cli-claude-cli-install')).toBeInTheDocument();
  });

  it('install action is separate from asset-based Elegy updates', async () => {
    const { default: UpdatesSection } = await import('../ui/src/views/Maintenance/UpdatesSection');

    render(<UpdatesSection />);

    await waitFor(() => {
      expect(screen.getByTestId('updates-cli-section')).toBeInTheDocument();
    });

    // CLI tooling section has its own install buttons separate from
    // the asset-based Elegy Planning and Elegy Skills cards.
    expect(screen.getByTestId('updates-cli-claude-cli-install')).toBeInTheDocument();

    // The Elegy asset cards should also render
    expect(screen.getByTestId('updates-elegy-planning-card')).toBeInTheDocument();
    expect(screen.getByTestId('updates-elegy-skills-card')).toBeInTheDocument();

    // Installed tool (OpenCode CLI) should NOT have an install button
    const opencodeCard = screen.getByTestId('updates-cli-opencode-cli-card');
    expect(within(opencodeCard).queryByTestId('updates-cli-opencode-cli-install')).toBeNull();

    // Not-installed tool (Codex CLI) should have an install button
    const codexCard = screen.getByTestId('updates-cli-codex-cli-card');
    expect(within(codexCard).getByTestId('updates-cli-codex-cli-install')).toBeInTheDocument();
  });
});
