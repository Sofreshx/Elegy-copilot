import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSessionAgentUsage = vi.fn();
const mockGetSessionHandoff = vi.fn();
const mockGetSessionProposition = vi.fn();
const mockGetSessionStructuredState = vi.fn();
const mockGetSessionVerificationGuide = vi.fn();
const mockListSessionPlans = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getSessionAgentUsage: mockGetSessionAgentUsage,
  getSessionHandoff: mockGetSessionHandoff,
  getSessionProposition: mockGetSessionProposition,
  getSessionStructuredState: mockGetSessionStructuredState,
  getSessionVerificationGuide: mockGetSessionVerificationGuide,
  listSessionPlans: mockListSessionPlans,
}));

describe('SessionDetail agent usage', () => {
  beforeEach(() => {
    mockGetSessionAgentUsage.mockReset();
    mockGetSessionHandoff.mockReset();
    mockGetSessionProposition.mockReset();
    mockGetSessionStructuredState.mockReset();
    mockGetSessionVerificationGuide.mockReset();
    mockListSessionPlans.mockReset();

    mockGetSessionAgentUsage.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      usage: {
        'o-planner': 3,
        search: 1,
      },
    });
    mockGetSessionHandoff.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      content: '',
    });
    mockGetSessionProposition.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      content: '',
      entries: [],
    });
    mockGetSessionStructuredState.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      warnings: [],
      nextUnit: null,
    });
    mockGetSessionVerificationGuide.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      content: '',
    });
    mockListSessionPlans.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      plans: [],
    });
  });

  it('renders bounded sampled agent usage for the selected session', async () => {
    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'cli',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Observed agent \/ planner usage/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/bounded sample rather than a full historical ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/Sampled invocations:/i)).toBeInTheDocument();
    expect(screen.getByText(/O Planner/i)).toBeInTheDocument();
    expect(screen.getByText(/Search/i)).toBeInTheDocument();
    expect(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage-1', { source: 'cli', limit: 500 });
  });
});
