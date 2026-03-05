import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockGetManagedAssets = vi.fn();
const mockGetInstalledAssets = vi.fn();
const mockSyncAllAssets = vi.fn();
const mockPatchVscodeSettings = vi.fn();
const mockAuthorizeCopilotFolders = vi.fn();

vi.mock('../ui/src/lib/api', () => ({
  getManagedAssets: mockGetManagedAssets,
  getInstalledAssets: mockGetInstalledAssets,
  syncAllAssets: mockSyncAllAssets,
  patchVscodeSettings: mockPatchVscodeSettings,
  authorizeCopilotFolders: mockAuthorizeCopilotFolders,
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
    mockPatchVscodeSettings.mockReset();
    mockAuthorizeCopilotFolders.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('runs sync repair, VS Code patch, and Copilot authorization in order', async () => {
    mockSyncAllAssets.mockResolvedValue({ result: [{ id: 'a' }, { id: 'b' }] });
    mockPatchVscodeSettings.mockResolvedValue({ result: { ok: true } });
    mockAuthorizeCopilotFolders.mockResolvedValue({ result: { ok: true } });
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
    expect(mockPatchVscodeSettings).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeCopilotFolders).toHaveBeenCalledTimes(1);
    expect(mockGetManagedAssets).toHaveBeenCalledTimes(1);
    expect(mockGetInstalledAssets).toHaveBeenCalledTimes(1);

    expect(messages.some((entry) => (entry ?? '').includes('Step 1/3'))).toBe(true);
    expect(messages.some((entry) => (entry ?? '').includes('Step 2/3'))).toBe(true);
    expect(messages.some((entry) => (entry ?? '').includes('Step 3/3'))).toBe(true);

    const finalState = assetsStore.getState();
    expect(finalState.syncing).toBe(false);
    expect(finalState.repairing).toBe(false);
    expect(finalState.error).toBeNull();
    expect(finalState.actionMessage).toContain('One-click repair complete');
  });

  it('surfaces failures and still refreshes asset inventory', async () => {
    mockSyncAllAssets.mockResolvedValue({ result: [] });
    mockPatchVscodeSettings.mockRejectedValue(new Error('settings patch failed'));
    mockAuthorizeCopilotFolders.mockResolvedValue({ result: { ok: true } });
    mockGetManagedAssets.mockResolvedValue({ managed: [] });
    mockGetInstalledAssets.mockResolvedValue(EMPTY_INSTALLED);

    const { assetsStore } = await import('../ui/src/tabs/Assets/assetsStore');

    await expect(assetsStore.repairWithSetup()).rejects.toThrow('settings patch failed');

    expect(mockAuthorizeCopilotFolders).not.toHaveBeenCalled();
    expect(mockGetManagedAssets).toHaveBeenCalledTimes(1);
    expect(mockGetInstalledAssets).toHaveBeenCalledTimes(1);

    const finalState = assetsStore.getState();
    expect(finalState.syncing).toBe(false);
    expect(finalState.repairing).toBe(false);
    expect(finalState.error).toBe('settings patch failed');
    expect(finalState.actionMessage).toContain('One-click repair failed');
  });
});
