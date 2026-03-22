import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSessionAgentUsage = vi.fn();
const mockGetCatalogAssetAnalytics = vi.fn();
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
  getCatalogAssetAnalytics: mockGetCatalogAssetAnalytics,
  getSessionHandoff: mockGetSessionHandoff,
  getSessionProposition: mockGetSessionProposition,
  getSessionStructuredState: mockGetSessionStructuredState,
  getSessionVerificationGuide: mockGetSessionVerificationGuide,
  listSessionPlans: mockListSessionPlans,
}));

describe('SessionDetail agent usage', () => {
  beforeEach(() => {
    mockGetSessionAgentUsage.mockReset();
    mockGetCatalogAssetAnalytics.mockReset();
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
      skillUsage: {
        totalInvocations: 1,
        uniqueSkillCount: 1,
        skills: [
          {
            assetId: 'skill-react-query',
            assetKey: 'react-query',
            invocationCount: 1,
            lastInvokedAt: '2026-03-09T00:02:00.000Z',
            toolNames: ['react-query'],
          },
        ],
      },
    });
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [
          {
            assetId: 'skill-react-query',
            assetKey: 'react-query',
            kind: 'skill',
            search: {
              sampled: {
                resultCount: 2,
                selectedCount: 1,
              },
            },
            usage: {
              invocationCount: 2,
              explicitInvocationCount: 1,
              proxyInvocationCount: 1,
            },
          },
          {
            assetId: 'skill-proxy-only-helper',
            assetKey: 'proxy-only-helper',
            kind: 'skill',
            search: {
              sampled: {
                resultCount: 1,
              },
            },
            usage: {
              invocationCount: 1,
              explicitInvocationCount: 0,
              proxyInvocationCount: 1,
            },
          },
        ],
        sessions: [
          {
            sessionId: 'session-usage-1',
            search: {
              queryCount: 3,
              selectedCount: 1,
            },
            usage: {
              invocationCount: 3,
              explicitInvocationCount: 1,
              proxyInvocationCount: 2,
            },
          },
        ],
        repos: [],
        recentEvents: [],
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
    expect(screen.getAllByText(/Search/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Observed skill usage/i)).toBeInTheDocument();
    expect(screen.getByText(/^Session rollup:$/i).parentElement).toHaveTextContent('Session rollup: Searched 3 · Selected 1 · Invoked 3');
    expect(screen.getByText(/React Query/i)).toBeInTheDocument();
    expect(screen.getByText(/Proxy Only Helper/i)).toBeInTheDocument();
    expect(screen.getAllByText(/proxy-only fallback/i).length).toBeGreaterThan(0);
    expect(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage-1', { source: 'cli', limit: 500 });
    expect(mockGetCatalogAssetAnalytics).toHaveBeenCalledWith({ sessionId: 'session-usage-1', limit: 500 });
  });
});
