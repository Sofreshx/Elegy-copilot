import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockListSessionPlans = vi.fn();
const mockGetCatalogAssetAnalytics = vi.fn();
const mockGetSessionAgentUsage = vi.fn();
const mockGetSessionStructuredState = vi.fn();
const mockGetSessionProposition = vi.fn();
const mockGetSessionHandoff = vi.fn();
const mockGetSessionVerificationGuide = vi.fn();

describe('SessionDetail usage observability', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders bounded session agent and skill usage details from the session usage endpoint', async () => {
    vi.doMock('../ui/src/lib/api', async () => {
      const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');
      return {
        ...actual,
        getCatalogAssetAnalytics: mockGetCatalogAssetAnalytics,
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
      skillUsage: {
        contractVersion: 1,
        sessionId: 'session-usage',
        totalInvocations: 2,
        uniqueSkillCount: 1,
        skills: [
          {
            assetId: 'skill-react-query',
            assetKey: 'react-query',
            invocationCount: 2,
            lastInvokedAt: '2026-03-09T00:02:00.000Z',
            toolNames: ['react-query'],
          },
        ],
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
    mockGetCatalogAssetAnalytics.mockResolvedValue({
      analytics: {
        assets: [
          {
            assetId: 'skill-react-query',
            assetKey: 'react-query',
            kind: 'skill',
            search: {
              sampled: {
                resultCount: 4,
                selectedCount: 1,
              },
            },
            usage: {
              invocationCount: 2,
              explicitInvocationCount: 2,
              proxyInvocationCount: 0,
            },
          },
        ],
        repos: [],
        sessions: [
          {
            sessionId: 'session-usage',
            search: {
              queryCount: 4,
              selectedCount: 1,
            },
            usage: {
              invocationCount: 2,
              explicitInvocationCount: 2,
              proxyInvocationCount: 0,
            },
          },
        ],
        recentEvents: [],
      },
    });

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
    expect(mockGetCatalogAssetAnalytics).toHaveBeenCalledWith({
      sessionId: 'session-usage',
      limit: 500,
    });
    expect(screen.getByText(/most recent 500 session events/i)).toBeInTheDocument();
    expect(screen.getByText(/4 across 2 observed agent label\(s\)\./i)).toBeInTheDocument();
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Observed skill usage')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Session rollup: Searched 4 · Selected 1 · Invoked 2')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => (
        element?.tagName.toLowerCase() === 'li'
        && (element.textContent?.includes('React Query: searched 4 · selected 1 · invoked 2') ?? false)
      ))
    ).toBeInTheDocument();
    expect(screen.getAllByText(/2 authoritative asset\.invoked observation\(s\)\./i)).toHaveLength(2);
  });
});
