import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockListSessionPlans = vi.fn();
const mockGetSessionAgentUsage = vi.fn();
const mockGetSessionStructuredState = vi.fn();
const mockGetSessionProposition = vi.fn();
const mockGetSessionHandoff = vi.fn();
const mockGetSessionVerificationGuide = vi.fn();

describe('SessionDetail agent usage observability', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders bounded session agent usage details from the session usage endpoint', async () => {
    vi.doMock('../ui/src/lib/api', async () => {
      const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');
      return {
        ...actual,
        listSessionPlans: mockListSessionPlans,
        getSessionAgentUsage: mockGetSessionAgentUsage,
        getSessionStructuredState: mockGetSessionStructuredState,
        getSessionProposition: mockGetSessionProposition,
        getSessionHandoff: mockGetSessionHandoff,
        getSessionVerificationGuide: mockGetSessionVerificationGuide,
      };
    });

    mockListSessionPlans.mockResolvedValue({ id: 'session-usage', source: 'cli', plans: [] });
    mockGetSessionAgentUsage.mockResolvedValue({
      id: 'session-usage',
      source: 'cli',
      usage: {
        planner: 3,
        reviewer: 1,
      },
    });
    mockGetSessionStructuredState.mockResolvedValue({
      id: 'session-usage',
      source: 'cli',
      warnings: [],
    });
    mockGetSessionProposition.mockResolvedValue({ id: 'session-usage', source: 'cli', content: '' });
    mockGetSessionHandoff.mockResolvedValue({ id: 'session-usage', source: 'cli', content: '' });
    mockGetSessionVerificationGuide.mockResolvedValue({ id: 'session-usage', source: 'cli', content: '' });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage',
          source: 'cli',
          status: 'active',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Observed agent / planner usage')).toBeInTheDocument();
    });

    expect(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage', {
      source: 'cli',
      limit: 500,
    });
    expect(screen.getByText(/most recent 500 session events/i)).toBeInTheDocument();
    expect(screen.getByText(/4 across 2 observed agent label\(s\)\./i)).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
  });
});
