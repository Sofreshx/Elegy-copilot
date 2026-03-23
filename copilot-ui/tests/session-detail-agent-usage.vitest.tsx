import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function flushAsyncWork(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.useRealTimers();
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
      content: '## Handoff Manifest\n- Session: session-usage-1\n',
    });
    mockGetSessionProposition.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      content: '## 2026-03-23T00:00:00Z — after-execution — workflow-executor\n',
      entries: [
        {
          heading: '2026-03-23T00:00:00Z — after-execution — workflow-executor',
          phase: 'after-execution',
          sections: [],
        },
      ],
    });
    mockGetSessionStructuredState.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      warnings: [],
      nextUnit: null,
      meta: {
        intentFrame: {
          summary: 'Focus the session details view on the derived Session Intent Frame first.',
          inScope: ['Render the framing card before raw artifacts.'],
          outOfScope: ['Broader planning-surface rollout remains later.'],
          successSignals: ['Session Intent Frame appears at the top of the artifacts area.'],
          constraints: ['Do not add new required artifact files.'],
          watchOuts: ['Keep raw artifacts available as supporting detail.'],
          sourceArtifacts: ['plan', 'handoff', 'proposition'],
        },
        closureSummary: {
          summary: 'The runtime/UI adoption slice is implemented and exposed through structured-state.',
          outcome: 'completed',
          confidence: 'high',
          reviewVerdict: 'APPROVED',
          delivered: ['Structured-state publishes intent and closure summaries.'],
          validationEvidence: ['Review ledger verdict: APPROVED (reviewer-opus-4-6)'],
          followUps: {
            activeContinuation: ['Verify the framing cards in Session Details.'],
            durableCarryover: ['Extend the same summaries into planning surfaces later.'],
          },
          sourceArtifacts: ['plan', 'proposition', 'verification-guide'],
        },
        executionOverlay: {
          present: true,
          applied: true,
          warnings: [],
        },
        executionState: {
          schemaVersion: 'execution-state-v1',
          updatedAt: '2026-03-23T00:01:00.000Z',
          lifecycle: 'executing',
          status: 'active',
          mode: 'resumed',
          summary: 'The orchestrator is actively working through the runtime overlay tree.',
          activeGroup: {
            id: 'G-01',
            label: 'Runtime Adoption',
            status: 'in-progress',
          },
          activeWorkUnit: {
            id: 'WU-002',
            label: 'Merge execution overlay',
            status: 'in-progress',
          },
          nextUnit: {
            workUnitId: 'WU-003',
            rationale: 'Render the Session Detail execution hierarchy.',
          },
          lastCompletedUnit: {
            id: 'WU-001',
            label: 'Contract definition',
            status: 'done',
          },
          blockers: [
            {
              label: 'Keep test routing narrow',
              details: 'Request broader coverage instead of running it here.',
              severity: 'medium',
            },
          ],
          replanCount: 1,
          tree: [
            {
              id: 'G-01',
              kind: 'group',
              label: 'Runtime Adoption',
              status: 'in-progress',
              current: true,
              children: [
                {
                  id: 'WU-001',
                  kind: 'work-unit',
                  label: 'Contract definition',
                  status: 'done',
                },
                {
                  id: 'WU-002',
                  kind: 'work-unit',
                  label: 'Merge execution overlay',
                  status: 'in-progress',
                  current: true,
                },
                {
                  id: 'WU-003',
                  kind: 'work-unit',
                  label: 'Render execution tree',
                  status: 'queued',
                  next: true,
                },
              ],
            },
          ],
        },
      },
    });
    mockGetSessionVerificationGuide.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      content: '## Summary\nVerify the framing cards.\n',
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
    expect(screen.getByText('Session Intent Frame')).toBeInTheDocument();
    expect(screen.getByText(/derived Session Intent Frame first/i)).toBeInTheDocument();
    expect(screen.getByText('Execution State')).toBeInTheDocument();
    expect(screen.getByText(/actively working through the runtime overlay tree/i)).toBeInTheDocument();
    expect(screen.getByText('Execution tree')).toBeInTheDocument();
    expect(screen.getAllByText(/Merge execution overlay/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Keep test routing narrow/i)).toBeInTheDocument();
    expect(screen.getByText('Session Closure Summary')).toBeInTheDocument();
    expect(screen.getByText(/runtime\/UI adoption slice is implemented/i)).toBeInTheDocument();
    expect(screen.getByText('Supporting raw artifacts')).toBeInTheDocument();
    expect(screen.getByText(/Observed skill usage/i)).toBeInTheDocument();
    expect(screen.getByText(/^Session rollup:$/i).parentElement).toHaveTextContent('Session rollup: Searched 3 · Selected 1 · Invoked 3');
    expect(screen.getByText(/React Query/i)).toBeInTheDocument();
    expect(screen.getByText(/Proxy Only Helper/i)).toBeInTheDocument();
    expect(screen.getAllByText(/proxy-only fallback/i).length).toBeGreaterThan(0);
    expect(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage-1', { source: 'cli', limit: 500 });
    expect(mockGetCatalogAssetAnalytics).toHaveBeenCalledWith({ sessionId: 'session-usage-1', limit: 500 });
  });

  it('suppresses catalog-derived observability for non-CLI sessions', async () => {
    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'vscode',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/catalog-derived skill observability are currently only source-aware for CLI sessions/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/^Session rollup:$/i)).not.toBeInTheDocument();
    expect(mockGetCatalogAssetAnalytics).not.toHaveBeenCalled();
  });

  it('passes the sandbox discriminator through session artifact requests for sandbox sessions', async () => {
    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'sandbox',
          sandbox: 'sandbox-42',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(mockGetSessionStructuredState).toHaveBeenCalledWith('session-usage-1', {
        source: 'sandbox',
        sandbox: 'sandbox-42',
        planId: 'latest',
      });
    });

    expect(mockListSessionPlans).toHaveBeenCalledWith('session-usage-1', {
      source: 'sandbox',
      sandbox: 'sandbox-42',
    });
    expect(mockGetSessionAgentUsage).toHaveBeenCalledWith('session-usage-1', {
      source: 'sandbox',
      sandbox: 'sandbox-42',
      limit: 500,
    });
    expect(mockGetSessionProposition).toHaveBeenCalledWith('session-usage-1', {
      source: 'sandbox',
      sandbox: 'sandbox-42',
    });
    expect(mockGetSessionHandoff).toHaveBeenCalledWith('session-usage-1', {
      source: 'sandbox',
      sandbox: 'sandbox-42',
    });
    expect(mockGetSessionVerificationGuide).toHaveBeenCalledWith('session-usage-1', {
      source: 'sandbox',
      sandbox: 'sandbox-42',
    });
    expect(mockGetCatalogAssetAnalytics).not.toHaveBeenCalled();
  });

  it('hides previous session artifacts immediately when the selected session changes', async () => {
    const deferredStructuredState = createDeferred<{
      id: string;
      source: string;
      warnings: string[];
      nextUnit: null;
      meta: {
        intentFrame: {
          summary: string;
        };
      };
    }>();

    mockGetSessionStructuredState.mockImplementation((sessionId: string) => {
      if (sessionId === 'session-usage-2') {
        return deferredStructuredState.promise;
      }
      return Promise.resolve({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          intentFrame: {
            summary: 'Focus the session details view on the derived Session Intent Frame first.',
          },
        },
      });
    });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    const { rerender } = render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'cli',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/derived Session Intent Frame first/i)).toBeInTheDocument();
    });

    rerender(
      <SessionDetail
        session={{
          id: 'session-usage-2',
          source: 'cli',
          status: 'idle',
        }}
      />
    );

    expect(screen.getByText(/Loading session folder artifacts/i)).toBeInTheDocument();
    expect(screen.queryByText(/derived Session Intent Frame first/i)).not.toBeInTheDocument();

    deferredStructuredState.resolve({
      id: 'session-usage-2',
      source: 'cli',
      warnings: [],
      nextUnit: null,
      meta: {
        intentFrame: {
          summary: 'Fresh second-session framing is now visible.',
        },
      },
    });

    await flushAsyncWork();

    expect(screen.getByText(/Fresh second-session framing is now visible\./i)).toBeInTheDocument();
  });

  it('hides previous session artifacts immediately when the selected session source changes for the same id', async () => {
    const deferredStructuredState = createDeferred<{
      id: string;
      source: string;
      warnings: string[];
      nextUnit: null;
      meta: {
        intentFrame: {
          summary: string;
        };
      };
    }>();

    mockGetSessionStructuredState.mockImplementation((sessionId: string, options?: { source?: string }) => {
      if (sessionId === 'session-usage-1' && options?.source === 'vscode') {
        return deferredStructuredState.promise;
      }
      return Promise.resolve({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          intentFrame: {
            summary: 'CLI framing should disappear before same-id VS Code artifacts load.',
          },
        },
      });
    });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    const { rerender } = render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'cli',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/CLI framing should disappear/i)).toBeInTheDocument();
    });

    rerender(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'vscode',
          status: 'idle',
        }}
      />
    );

    expect(screen.getByText(/Loading session folder artifacts/i)).toBeInTheDocument();
    expect(screen.queryByText(/CLI framing should disappear/i)).not.toBeInTheDocument();

    deferredStructuredState.resolve({
      id: 'session-usage-1',
      source: 'vscode',
      warnings: [],
      nextUnit: null,
      meta: {
        intentFrame: {
          summary: 'VS Code framing is now visible for the same session id.',
        },
      },
    });

    await flushAsyncWork();

    expect(screen.getByText(/VS Code framing is now visible for the same session id\./i)).toBeInTheDocument();
  });

  it('hides previous sandbox artifacts immediately when the selected sandbox changes for the same id', async () => {
    const deferredStructuredState = createDeferred<{
      id: string;
      source: string;
      warnings: string[];
      nextUnit: null;
      meta: {
        intentFrame: {
          summary: string;
        };
      };
    }>();

    mockGetSessionStructuredState.mockImplementation((sessionId: string, options?: { source?: string; sandbox?: string }) => {
      if (sessionId === 'session-usage-1' && options?.source === 'sandbox' && options?.sandbox === 'sandbox-2') {
        return deferredStructuredState.promise;
      }
      return Promise.resolve({
        id: 'session-usage-1',
        source: 'sandbox',
        warnings: [],
        nextUnit: null,
        meta: {
          intentFrame: {
            summary: 'Sandbox one framing should disappear before sandbox two loads.',
          },
        },
      });
    });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    const { rerender } = render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'sandbox',
          sandbox: 'sandbox-1',
          status: 'idle',
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Sandbox one framing should disappear/i)).toBeInTheDocument();
    });

    rerender(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'sandbox',
          sandbox: 'sandbox-2',
          status: 'idle',
        }}
      />
    );

    expect(screen.getByText(/Loading session folder artifacts/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sandbox one framing should disappear/i)).not.toBeInTheDocument();

    deferredStructuredState.resolve({
      id: 'session-usage-1',
      source: 'sandbox',
      warnings: [],
      nextUnit: null,
      meta: {
        intentFrame: {
          summary: 'Sandbox two framing is now visible for the same session id.',
        },
      },
    });

    await flushAsyncWork();

    expect(screen.getByText(/Sandbox two framing is now visible for the same session id\./i)).toBeInTheDocument();
  });

  it('polls structured session artifacts while the selected session remains active', async () => {
    vi.useFakeTimers();
    mockGetSessionStructuredState
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Initial execution snapshot.',
            status: 'active',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Updated execution snapshot.',
            status: 'active',
          },
        },
      });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'cli',
          active: true,
          status: 'active',
        }}
      />
    );

    await flushAsyncWork();
    expect(screen.getByText(/Initial execution snapshot\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await flushAsyncWork();
    expect(screen.getByText(/Updated execution snapshot\./i)).toBeInTheDocument();

    expect(mockGetSessionStructuredState).toHaveBeenCalledTimes(2);
  });

  it('continues polling when the session summary is idle but the fetched execution overlay remains active', async () => {
    vi.useFakeTimers();
    mockGetSessionStructuredState
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Overlay is still active.',
            status: 'active',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Overlay finished.',
            status: 'completed',
          },
        },
      });

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

    await flushAsyncWork();
    expect(screen.getByText(/Overlay is still active\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await flushAsyncWork();
    expect(screen.getByText(/Overlay finished\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await flushAsyncWork();

    expect(mockGetSessionStructuredState).toHaveBeenCalledTimes(2);
  });

  it('renders present-but-ignored execution overlays distinctly from missing overlays', async () => {
    mockGetSessionStructuredState.mockResolvedValueOnce({
      id: 'session-usage-1',
      source: 'cli',
      warnings: [],
      nextUnit: null,
      meta: {
        executionOverlay: {
          present: true,
          applied: false,
          warnings: ['invalid execution-state.json JSON payload'],
        },
      },
    });

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
      expect(screen.getByText('Execution State')).toBeInTheDocument();
    });

    expect(screen.getByText('Present (ignored)')).toBeInTheDocument();
    expect(screen.getByText(/invalid execution-state\.json JSON payload/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Not present$/i)).not.toBeInTheDocument();
  });

  it('does not keep polling forever for idle sessions with present-but-ignored overlays and no execution state', async () => {
    vi.useFakeTimers();
    mockGetSessionStructuredState.mockResolvedValue({
      id: 'session-usage-1',
      source: 'cli',
      warnings: [],
      nextUnit: null,
      meta: {
        executionOverlay: {
          present: true,
          applied: false,
          warnings: ['invalid execution-state.json JSON payload'],
        },
      },
    });

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

    await flushAsyncWork();
    expect(screen.getByText('Present (ignored)')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    await flushAsyncWork();

    expect(mockGetSessionStructuredState).toHaveBeenCalledTimes(1);
  });

  it('continues polling through blocked execution states until a true terminal state is reached', async () => {
    vi.useFakeTimers();
    mockGetSessionStructuredState
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Waiting on an external unblock.',
            status: 'blocked',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Execution finished after the blocker cleared.',
            status: 'completed',
          },
        },
      });

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

    await flushAsyncWork();
    expect(screen.getByText(/Waiting on an external unblock\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await flushAsyncWork();
    expect(screen.getByText(/Execution finished after the blocker cleared\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await flushAsyncWork();

    expect(mockGetSessionStructuredState).toHaveBeenCalledTimes(2);
  });

  it('stops polling once structured execution state becomes terminal', async () => {
    vi.useFakeTimers();
    mockGetSessionStructuredState
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Initial execution snapshot.',
            status: 'active',
          },
        },
      })
      .mockResolvedValueOnce({
        id: 'session-usage-1',
        source: 'cli',
        warnings: [],
        nextUnit: null,
        meta: {
          executionOverlay: {
            present: true,
            applied: true,
            warnings: [],
          },
          executionState: {
            schemaVersion: 'execution-state-v1',
            summary: 'Execution finished.',
            status: 'closed',
          },
        },
      });

    const { default: SessionDetail } = await import('../ui/src/tabs/Sessions/SessionDetail');

    render(
      <SessionDetail
        session={{
          id: 'session-usage-1',
          source: 'cli',
          active: true,
          status: 'active',
        }}
      />
    );

    await flushAsyncWork();
    expect(screen.getByText(/Initial execution snapshot\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    await flushAsyncWork();
    expect(screen.getByText(/Execution finished\./i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    await flushAsyncWork();

    expect(mockGetSessionStructuredState).toHaveBeenCalledTimes(2);
  });

  it('keeps structured state visible when ancillary artifact reads fail', async () => {
    mockGetSessionProposition.mockRejectedValueOnce(new Error('Proposition service unavailable'));

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
      expect(screen.getByText('Execution State')).toBeInTheDocument();
    });

    expect(screen.getByText(/actively working through the runtime overlay tree/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Proposition: Proposition service unavailable/i);
  });
});
