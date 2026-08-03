import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./core', () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from './core';
import { runExecutionCommand, startExecutionSetup } from './execution';

describe('execution api client', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ runId: 'run-1', run: {} as never });
  });

  it('passes repoPath as a query parameter when running a command', async () => {
    await runExecutionCommand('/repo/path', 'npm:dev');

    expect(apiRequest).toHaveBeenCalledWith('/api/execution/run', {
      method: 'POST',
      query: { repoPath: '/repo/path' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: '/repo/path', commandId: 'npm:dev' }),
    });
  });

  it('passes repoPath as a query parameter when running setup', async () => {
    await startExecutionSetup('/repo/path');

    expect(apiRequest).toHaveBeenCalledWith('/api/execution/setup', {
      method: 'POST',
      query: { repoPath: '/repo/path' },
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoPath: '/repo/path' }),
    });
  });
});
