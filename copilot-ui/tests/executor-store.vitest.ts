import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ui/src/lib/api', () => ({
  cancelExecutorJob: vi.fn(),
  createExecutorJob: vi.fn(),
  getExecutorHealth: vi.fn(),
  listExecutorJobs: vi.fn(),
  listExecutorRuns: vi.fn(),
  listSessions: vi.fn(),
  triggerExecutorJob: vi.fn(),
}));

import {
  getExecutorHealth,
  listExecutorJobs,
  listExecutorRuns,
  listSessions,
} from '../ui/src/lib/api';
import { createExecutorStore } from '../ui/src/tabs/Executor/executorStore';

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

const BASE_HEALTH = {
  enabled: false,
  state: 'unknown',
  jobCount: 0,
  runCount: 0,
  activeRunCount: 0,
  scheduledJobCount: 0,
  openedSessionCount: 0,
  lastError: null,
} as const;

describe('executorStore', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not start overlapping poll loads while a prior load is still running', async () => {
    vi.useFakeTimers();

    const firstHealthRequest = createDeferred<typeof BASE_HEALTH>();
    vi.mocked(getExecutorHealth)
      .mockImplementationOnce(() => firstHealthRequest.promise)
      .mockResolvedValue(BASE_HEALTH);
    vi.mocked(listExecutorJobs).mockResolvedValue({ jobs: [] });
    vi.mocked(listExecutorRuns).mockResolvedValue({ runs: [] });
    vi.mocked(listSessions).mockResolvedValue({ sessions: [] });

    const store = createExecutorStore();

    try {
      store.startPolling(3000);

      await vi.advanceTimersByTimeAsync(3000);
      expect(getExecutorHealth).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(9000);
      expect(getExecutorHealth).toHaveBeenCalledTimes(1);

      firstHealthRequest.resolve(BASE_HEALTH);
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(3000);
      expect(getExecutorHealth).toHaveBeenCalledTimes(2);
    } finally {
      store.dispose();
    }
  });
});