import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockGetManagedAssets = vi.fn();
const mockGetInstalledAssets = vi.fn();
const mockSyncAllAssets = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  getManagedAssets: mockGetManagedAssets,
  getInstalledAssets: mockGetInstalledAssets,
  syncAllAssets: mockSyncAllAssets,
}));

const EMPTY_INSTALLED = {
  agents: [],
  skills: [],
  prompts: [],
  instructions: {
    installed: false,
    absPath: '',
  },
};

describe('assetsStore one-click skill repair', () => {
  beforeEach(() => {
    mockGetManagedAssets.mockReset();
    mockGetInstalledAssets.mockReset();
    mockSyncAllAssets.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('runs managed asset repair and refreshes inventory', async () => {
    mockSyncAllAssets.mockResolvedValue({ result: [{ id: 'a' }, { id: 'b' }] });
    mockGetManagedAssets.mockResolvedValue({ managed: [] });
    mockGetInstalledAssets.mockResolvedValue(EMPTY_INSTALLED);

    const { assetsStore } = await import('../ui/src/tabs/Assets/assetsStore');

    const messages: Array<string | null> = [];
    const unsubscribe = assetsStore.subscribe(() => {
      messages.push(assetsStore.getState().actionMessage);
    });

    await assetsStore.repairWithSetup();
    unsubscribe();

    expect(mockSyncAllAssets).toHaveBeenCalledWith(false, undefined, true);
    expect(mockGetManagedAssets).toHaveBeenCalledTimes(1);
    expect(mockGetInstalledAssets).toHaveBeenCalledTimes(1);

    expect(messages.some((entry) => (entry ?? '').includes('Repairing managed assets'))).toBe(true);

    const finalState = assetsStore.getState();
    expect(finalState.syncing).toBe(false);
    expect(finalState.repairing).toBe(false);
    expect(finalState.error).toBeNull();
    expect(finalState.actionMessage).toContain('Repair complete');
  });

  it('surfaces failures and still refreshes asset inventory', async () => {
    mockSyncAllAssets.mockRejectedValue(new Error('sync failed'));
    mockGetManagedAssets.mockResolvedValue({ managed: [] });
    mockGetInstalledAssets.mockResolvedValue(EMPTY_INSTALLED);

    const { assetsStore } = await import('../ui/src/tabs/Assets/assetsStore');

    await expect(assetsStore.repairWithSetup()).rejects.toThrow('sync failed');

    expect(mockGetManagedAssets).toHaveBeenCalledTimes(1);
    expect(mockGetInstalledAssets).toHaveBeenCalledTimes(1);

    const finalState = assetsStore.getState();
    expect(finalState.syncing).toBe(false);
    expect(finalState.repairing).toBe(false);
    expect(finalState.error).toBe('sync failed');
    expect(finalState.actionMessage).toContain('Repair failed');
  });
});
