import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SessionsPage from '../SessionsPage';

// Mock apiClient
const mockGet = vi.fn();

vi.mock('../../services/apiClient', () => ({
  getApiClient: () => ({
    get: mockGet,
  }),
}));

const SAMPLE_SESSIONS = {
  sessions: [
    {
      id: 'sess-001-abcdef1234567890',
      user_id: 'u1',
      client_id: 'c1',
      agent_name: 'debugger',
      prompt: 'Fix the login bug that prevents users from signing in with GitHub OAuth',
      status: 'completed',
      started_at: '2026-01-15T10:00:00Z',
      completed_at: '2026-01-15T10:05:00Z',
      error: null,
      metadata: null,
      created_at: '2026-01-15T09:59:00Z',
    },
    {
      id: 'sess-002-bbbbbbbb22222222',
      user_id: 'u1',
      client_id: 'c2',
      agent_name: 'code-reviewer',
      prompt: 'Review the pull request for security issues',
      status: 'failed',
      started_at: '2026-01-16T12:00:00Z',
      completed_at: '2026-01-16T12:03:00Z',
      error: 'Agent timed out',
      metadata: '{"retries": 2}',
      created_at: '2026-01-16T11:59:00Z',
    },
    {
      id: 'sess-003-cccccccc33333333',
      user_id: 'u1',
      client_id: null,
      agent_name: null,
      prompt: null,
      status: 'active',
      started_at: null,
      completed_at: null,
      error: null,
      metadata: null,
      created_at: '2026-01-17T08:00:00Z',
    },
  ],
  total: 3,
  page: 1,
  limit: 20,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sessions']}>
      <SessionsPage />
    </MemoryRouter>
  );
}

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(SAMPLE_SESSIONS);
  });

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('displays sessions after fetch', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('debugger')).toBeInTheDocument();
    });

    expect(screen.getByText('code-reviewer')).toBeInTheDocument();
    expect(screen.getByText('Unknown agent')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/sessions');
  });

  it('shows status badges for each session', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows truncated prompt preview', async () => {
    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText('Fix the login bug that prevents users from signing in with GitHub OAuth')
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText('Review the pull request for security issues')
    ).toBeInTheDocument();
  });

  it('shows error state on fetch failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no sessions', async () => {
    mockGet.mockResolvedValue({ sessions: [], total: 0, page: 1, limit: 20 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No sessions found')).toBeInTheDocument();
    });
  });

  it('filter buttons change the API call', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('debugger')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Active'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/sessions?status=active');
    });

    await user.click(screen.getByText('Failed'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/sessions?status=failed');
    });

    await user.click(screen.getByText('All'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/sessions');
    });
  });

  it('session detail expands on click', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('debugger')).toBeInTheDocument();
    });

    // Detail not visible yet
    expect(screen.queryByText('Session ID')).not.toBeInTheDocument();

    // Click the first session card
    const cards = screen.getAllByRole('button', { expanded: false });
    const firstCard = cards[0];
    if (!firstCard) throw new Error('Session card not found');
    await user.click(firstCard);

    // Detail is now visible with full session ID
    expect(screen.getByText('Session ID')).toBeInTheDocument();
    expect(screen.getByText('sess-001-abcdef1234567890')).toBeInTheDocument();
  });

  it('session detail shows error for failed sessions', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('code-reviewer')).toBeInTheDocument();
    });

    // Click the failed session (second card)
    const cards = screen.getAllByRole('button', { expanded: false });
    const secondCard = cards[1];
    if (!secondCard) throw new Error('Session card not found');
    await user.click(secondCard);

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Agent timed out')).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
  });

  it('clicking an expanded session collapses it', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('debugger')).toBeInTheDocument();
    });

    // Expand
    const cards = screen.getAllByRole('button', { expanded: false });
    const firstCard = cards[0];
    if (!firstCard) throw new Error('Session card not found');
    await user.click(firstCard);

    expect(screen.getByText('Session ID')).toBeInTheDocument();

    // Collapse by clicking the now-expanded card
    const expandedCard = screen.getByRole('button', { expanded: true });
    await user.click(expandedCard);

    expect(screen.queryByText('Session ID')).not.toBeInTheDocument();
  });
});
