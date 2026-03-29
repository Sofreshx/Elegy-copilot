import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  createUiRuntimeOverlaySession: vi.fn(),
  getCatalogRepos: vi.fn(),
  listUiRuntimeOverlaySessions: vi.fn(),
  queueUiRuntimeOverlayChangeRequest: vi.fn(),
}));

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');
  return {
    ...actual,
    createUiRuntimeOverlaySession: apiMocks.createUiRuntimeOverlaySession,
    getCatalogRepos: apiMocks.getCatalogRepos,
    listUiRuntimeOverlaySessions: apiMocks.listUiRuntimeOverlaySessions,
    queueUiRuntimeOverlayChangeRequest: apiMocks.queueUiRuntimeOverlayChangeRequest,
  };
});

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createOverlaySession(changeRequestStatus: 'draft' | 'reserved') {
  return {
    id: 'overlay-1',
    status: 'attached',
    runtimeUrl: 'http://127.0.0.1:4173/',
    runtimeOrigin: 'http://127.0.0.1:4173',
    repoId: 'repo-1',
    repoPath: 'C:\\Repos\\instruction-engine',
    repoLabel: 'Instruction Engine',
    packageRoot: 'C:\\Repos\\instruction-engine\\copilot-ui',
    observations: [],
    annotations: [],
    changeRequests: [
      {
        id: 'cr-1',
        observationId: null,
        annotationId: null,
        title: 'Patch the overlay',
        request: 'Apply the executor change.',
        prompt: null,
        status: changeRequestStatus,
        executorJobId: null,
        executorRunId: null,
        createdAt: '2026-03-28T10:00:00.000Z',
        updatedAt: changeRequestStatus === 'reserved'
          ? '2026-03-28T10:05:00.000Z'
          : '2026-03-28T10:00:00.000Z',
        queuedAt: null,
      },
    ],
    qualitySignals: [],
    lastAnalyzedAt: null,
    createdAt: '2026-03-28T09:55:00.000Z',
    updatedAt: changeRequestStatus === 'reserved'
      ? '2026-03-28T10:05:00.000Z'
      : '2026-03-28T10:00:00.000Z',
  };
}

describe('uiRuntimeOverlayStore queue failure resync', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getCatalogRepos.mockResolvedValue({
      repos: [],
      selectedRepo: null,
    });
  });

  it('reloads overlay sessions after a queue failure so reserved state is reflected', async () => {
    apiMocks.listUiRuntimeOverlaySessions
      .mockResolvedValueOnce({ sessions: [createOverlaySession('draft')] })
      .mockResolvedValueOnce({ sessions: [createOverlaySession('reserved')] });
    apiMocks.queueUiRuntimeOverlayChangeRequest.mockRejectedValueOnce(new Error('Queue persistence failed.'));

    const { uiRuntimeOverlayStore } = await import('../ui/src/tabs/Executor/uiRuntimeOverlayStore');

    await uiRuntimeOverlayStore.load();
    const response = await uiRuntimeOverlayStore.queueChangeRequest('overlay-1', 'cr-1');

    expect(response).toBeNull();
    expect(apiMocks.listUiRuntimeOverlaySessions).toHaveBeenCalledTimes(2);

    const state = uiRuntimeOverlayStore.getState();
    expect(state.queueingChangeRequestId).toBeNull();
    expect(state.error).toBe('Queue persistence failed.');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.changeRequests[0]?.status).toBe('reserved');
  });

  it('keeps rollback draft state when an overlapping stale load resolves after a failed queue refresh', async () => {
    const pendingStaleLoad = createDeferredPromise<{ sessions: ReturnType<typeof createOverlaySession>[] }>();

    apiMocks.listUiRuntimeOverlaySessions
      .mockResolvedValueOnce({ sessions: [createOverlaySession('draft')] })
      .mockReturnValueOnce(pendingStaleLoad.promise)
      .mockResolvedValueOnce({ sessions: [createOverlaySession('draft')] });
    apiMocks.queueUiRuntimeOverlayChangeRequest.mockRejectedValueOnce(new Error('Queue persistence failed.'));

    const { uiRuntimeOverlayStore } = await import('../ui/src/tabs/Executor/uiRuntimeOverlayStore');

    await uiRuntimeOverlayStore.load();
    const overlappingLoadPromise = uiRuntimeOverlayStore.load();
    const response = await uiRuntimeOverlayStore.queueChangeRequest('overlay-1', 'cr-1');

    pendingStaleLoad.resolve({ sessions: [createOverlaySession('reserved')] });
    await overlappingLoadPromise;

    expect(response).toBeNull();
    expect(apiMocks.listUiRuntimeOverlaySessions).toHaveBeenCalledTimes(3);

    const state = uiRuntimeOverlayStore.getState();
    expect(state.loading).toBe(false);
    expect(state.queueingChangeRequestId).toBeNull();
    expect(state.error).toBe('Queue persistence failed.');
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.changeRequests[0]?.status).toBe('draft');
  });
});

describe('uiRuntimeOverlayStore stale load guard', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.getCatalogRepos.mockResolvedValue({
      repos: [],
      selectedRepo: null,
    });
  });

  it('discards a load that started before a successful session mutation', async () => {
    const pendingLoad = createDeferredPromise<{ sessions: ReturnType<typeof createOverlaySession>[] }>();
    const createdSession = {
      ...createOverlaySession('draft'),
      id: 'overlay-2',
      updatedAt: '2026-03-28T10:10:00.000Z',
      createdAt: '2026-03-28T10:10:00.000Z',
    };

    apiMocks.listUiRuntimeOverlaySessions.mockReturnValueOnce(pendingLoad.promise);
    apiMocks.createUiRuntimeOverlaySession.mockResolvedValueOnce({ session: createdSession });

    const { uiRuntimeOverlayStore } = await import('../ui/src/tabs/Executor/uiRuntimeOverlayStore');

    const loadPromise = uiRuntimeOverlayStore.load();
    const created = await uiRuntimeOverlayStore.createSession({
      repoPath: 'C:/Repos/instruction-engine',
      runtimeUrl: 'http://127.0.0.1:4173/',
    });

    pendingLoad.resolve({ sessions: [] });
    await loadPromise;

    expect(created?.id).toBe('overlay-2');

    const state = uiRuntimeOverlayStore.getState();
    expect(state.loading).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]?.id).toBe('overlay-2');
    expect(state.selectedSessionId).toBe('overlay-2');
  });
});