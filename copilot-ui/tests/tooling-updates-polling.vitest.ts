import { describe, expect, it, vi } from 'vitest';
import { createToolingUpdatesStore } from '../ui/src/stores/toolingUpdatesStore';
import type { ToolingUpdatesStatusResponse } from '../ui/src/lib/types';

describe('tooling updates polling', () => {
  it('deduplicates overlapping probes and does not publish unchanged silent results', async () => {
    const status = { checkedAtMs: 1, elegyPlanningCli: {}, elegySkillsAssets: {} } as unknown as ToolingUpdatesStatusResponse;
    let resolveProbe: ((value: ToolingUpdatesStatusResponse) => void) | null = null;
    const checkUpdates = vi.fn(() => new Promise<ToolingUpdatesStatusResponse>((resolve) => { resolveProbe = resolve; }));
    const store = createToolingUpdatesStore({ checkUpdates });
    let notifications = 0;
    store.subscribe(() => { notifications += 1; });

    const first = store.checkNow({ silent: true });
    const joined = store.checkNow({ silent: true });
    expect(checkUpdates).toHaveBeenCalledTimes(1);
    resolveProbe?.(status);
    await Promise.all([first, joined]);
    expect(notifications).toBe(1);

    checkUpdates.mockResolvedValueOnce({ ...status, checkedAtMs: 2 });
    await store.checkNow({ silent: true });
    expect(notifications).toBe(1);
  });
});
