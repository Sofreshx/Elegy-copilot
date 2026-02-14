import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GitPage from '../GitPage';

// NOTE: vi.mock() factories are hoisted in Vitest.
// Define any referenced values via vi.hoisted() to avoid TDZ errors.
const { mockGet, MockApiError } = vi.hoisted(() => {
  // Mock apiClient — include ApiError so instanceof checks work
  class MockApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  return {
    mockGet: vi.fn(),
    MockApiError,
  };
});

vi.mock('../../services/apiClient', () => ({
  getApiClient: () => ({
    get: mockGet,
  }),
  ApiError: MockApiError,
}));

const SAMPLE_REPOS = {
  repos: [
    {
      repo: 'my-app',
      branch: 'main',
      ahead: 2,
      behind: 1,
      modified: 3,
      untracked: 1,
      lastChecked: '2026-02-11T10:30:00Z',
    },
    {
      repo: 'infra',
      branch: 'develop',
      ahead: 0,
      behind: 0,
      modified: 0,
      untracked: 0,
      lastChecked: '2026-02-11T10:29:00Z',
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/git']}>
      <GitPage />
    </MemoryRouter>
  );
}

describe('GitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGet.mockResolvedValue(SAMPLE_REPOS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading git status...')).toBeInTheDocument();
  });

  it('displays repositories after fetch', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    expect(screen.getByText('infra')).toBeInTheDocument();
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('develop')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/git-status');
  });

  it('shows "Clean" for repos with no changes', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('infra')).toBeInTheDocument();
    });

    expect(screen.getByText('Clean')).toBeInTheDocument();
  });

  it('shows modified/untracked/ahead/behind counts', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    expect(screen.getByText('M 3')).toBeInTheDocument();
    expect(screen.getByText('? 1')).toBeInTheDocument();
    expect(screen.getByText('↑ 2')).toBeInTheDocument();
    expect(screen.getByText('↓ 1')).toBeInTheDocument();
  });

  it('handles API 404 gracefully (no error shown)', async () => {
    mockGet.mockRejectedValue(new MockApiError('Not Found', 404));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No repositories being monitored.')).toBeInTheDocument();
    });

    // No error banner should be shown
    expect(screen.queryByText('Not Found')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows error for non-404 failures', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('refresh button triggers re-fetch', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });

    mockGet.mockClear();
    await user.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/git-status');
    });
  });
});
