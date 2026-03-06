import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListSessions = vi.fn();
const mockRunSandboxLifecycleAction = vi.fn();
const mockGetGatewayState = vi.fn();
const mockGetGatewayConfig = vi.fn();
const mockGetPolicyPreflight = vi.fn();
const mockConnectGateway = vi.fn();
const mockSaveGatewayConfig = vi.fn();
const mockScanGatewayRepos = vi.fn();
const mockInitPlanningPersistence = vi.fn();

vi.mock('../ui/src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../ui/src/lib/api')>('../ui/src/lib/api');
  return {
    ...actual,
    listSessions: mockListSessions,
    runSandboxLifecycleAction: mockRunSandboxLifecycleAction,
    getGatewayState: mockGetGatewayState,
    getGatewayConfig: mockGetGatewayConfig,
    getPolicyPreflight: mockGetPolicyPreflight,
    connectGateway: mockConnectGateway,
    saveGatewayConfig: mockSaveGatewayConfig,
    scanGatewayRepos: mockScanGatewayRepos,
    initPlanningPersistence: mockInitPlanningPersistence,
  };
});

function legacyTokenCode(): string {
  return ['tracker', 'token', 'missing'].join('_');
}

describe('WS-03 sandbox token gating', () => {
  beforeEach(async () => {
    vi.resetModules();

    mockListSessions.mockReset();
    mockRunSandboxLifecycleAction.mockReset();
    mockGetGatewayState.mockReset();
    mockGetGatewayConfig.mockReset();
    mockGetPolicyPreflight.mockReset();
    mockConnectGateway.mockReset();
    mockSaveGatewayConfig.mockReset();
    mockScanGatewayRepos.mockReset();
    mockInitPlanningPersistence.mockReset();

    mockListSessions.mockResolvedValue({ sessions: [] });
    mockGetGatewayState.mockResolvedValue({ ready: true, errors: [], tracker: { ready: true, status: 'ready' } });
    mockGetGatewayConfig.mockResolvedValue({ exists: false, configPath: '', config: null });
    mockGetPolicyPreflight.mockResolvedValue({ ok: true, status: 'ok', reason: '', message: '' });
    mockConnectGateway.mockResolvedValue({ ready: true, errors: [] });
    mockSaveGatewayConfig.mockResolvedValue({ ok: true });
    mockScanGatewayRepos.mockResolvedValue({ roots: [] });
    mockInitPlanningPersistence.mockResolvedValue({ ready: true, initialized: true });
  });

  it('blocks sandbox lifecycle actions after canonical token-missing error and shows remediation', async () => {
    const { ApiError } = await import('../ui/src/lib/api');
    const { sandboxesStore } = await import('../ui/src/tabs/Sandboxes/sandboxesStore');

    sandboxesStore.setSandboxId('sb-1');

    mockRunSandboxLifecycleAction.mockRejectedValueOnce(new ApiError('tracker auth missing', 502, {
      status: 'token_missing',
      code: 'MISSING_SANDBOX_TOKEN',
    }));

    await expect(sandboxesStore.createSandbox()).rejects.toThrow();

    const state = sandboxesStore.getState();
    expect(state.tokenMissingBlocked).toBe(true);
    expect(state.tokenMissingMessage).toContain('--tracker-token');
    expect(state.tokenMissingMessage).toContain('INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN');

    mockRunSandboxLifecycleAction.mockClear();
    await expect(sandboxesStore.startSandbox()).rejects.toThrow();
    expect(mockRunSandboxLifecycleAction).toHaveBeenCalledTimes(0);
  });

  it('keeps unrelated sandbox lifecycle failures as normal errors', async () => {
    const { ApiError } = await import('../ui/src/lib/api');
    const { sandboxesStore } = await import('../ui/src/tabs/Sandboxes/sandboxesStore');

    sandboxesStore.setSandboxId('sb-1');

    mockRunSandboxLifecycleAction.mockRejectedValueOnce(new ApiError('tracker auth failed', 401, {
      code: 'tracker_auth_failed',
      message: 'unauthorized',
    }));

    await expect(sandboxesStore.startSandbox()).rejects.toThrow();

    const state = sandboxesStore.getState();
    expect(state.tokenMissingBlocked).toBe(false);
    expect(state.tokenMissingMessage).toBeNull();
    expect(state.error).toBe('tracker auth failed');
  });

  it('disables create/start/stop/open terminal/open pr buttons in the view when token gate is active', async () => {
    const { ApiError } = await import('../ui/src/lib/api');
    const { sandboxesStore } = await import('../ui/src/tabs/Sandboxes/sandboxesStore');
    const { default: SandboxesView } = await import('../ui/src/tabs/Sandboxes/SandboxesView');

    sandboxesStore.setSandboxId('sb-1');

    mockRunSandboxLifecycleAction.mockRejectedValueOnce(new ApiError('tracker auth missing', 502, {
      status: 'token_missing',
      code: 'MISSING_SANDBOX_TOKEN',
    }));

    await expect(sandboxesStore.createSandbox()).rejects.toThrow();

    await act(async () => {
      render(<SandboxesView />);
      await Promise.resolve();
    });

    expect(screen.getByTestId('sandbox-create-button')).toBeDisabled();
    expect(screen.getByTestId('sandbox-start-button')).toBeDisabled();
    expect(screen.getByTestId('sandbox-stop-button')).toBeDisabled();
    expect(screen.getByTestId('sandbox-open-terminal-button')).toBeDisabled();
    expect(screen.getByTestId('sandbox-open-pr-button')).toBeDisabled();

    const remediation = screen.getByTestId('sandbox-token-remediation');
    expect(remediation).toHaveTextContent('--tracker-token');
    expect(remediation).toHaveTextContent('INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN');
  });

  it('unblocks lifecycle actions after gateway remediation clears token gate', async () => {
    const { ApiError } = await import('../ui/src/lib/api');
    const { sandboxesStore } = await import('../ui/src/tabs/Sandboxes/sandboxesStore');
    const { gatewayStore } = await import('../ui/src/tabs/Gateway/gatewayStore');

    sandboxesStore.setSandboxId('sb-1');

    mockRunSandboxLifecycleAction.mockRejectedValueOnce(new ApiError('tracker auth missing', 502, {
      status: 'token_missing',
      code: 'MISSING_SANDBOX_TOKEN',
    }));

    await expect(sandboxesStore.createSandbox()).rejects.toThrow();
    expect(sandboxesStore.getState().tokenMissingBlocked).toBe(true);
    expect(gatewayStore.getState().sandboxTokenMissing).toBe(true);

    gatewayStore.setSandboxTokenGate(false);

    expect(sandboxesStore.getState().tokenMissingBlocked).toBe(false);
    expect(sandboxesStore.getState().tokenMissingMessage).toBeNull();

    mockRunSandboxLifecycleAction.mockReset();
    mockRunSandboxLifecycleAction.mockResolvedValueOnce({ result: { sandboxId: 'sb-1' } });

    await expect(sandboxesStore.startSandbox()).resolves.toBeUndefined();
    expect(mockRunSandboxLifecycleAction).toHaveBeenCalledTimes(1);
    expect(mockRunSandboxLifecycleAction).toHaveBeenCalledWith('start', { sandboxId: 'sb-1' });
  });
});

describe('WS-03 gateway token detection', () => {
  beforeEach(async () => {
    vi.resetModules();

    mockListSessions.mockReset();
    mockRunSandboxLifecycleAction.mockReset();
    mockGetGatewayState.mockReset();

    mockListSessions.mockResolvedValue({ sessions: [] });
  });

  it('marks gateway token gate active from legacy tracker code in state envelope', async () => {
    const { gatewayStore } = await import('../ui/src/tabs/Gateway/gatewayStore');

    mockGetGatewayState.mockResolvedValueOnce({
      ready: false,
      errors: [
        {
          code: legacyTokenCode(),
          message: 'tracker auth missing',
        },
      ],
      tracker: {
        ready: false,
        status: 'degraded',
      },
    });

    await gatewayStore.refreshState();

    const state = gatewayStore.getState();
    expect(state.sandboxTokenMissing).toBe(true);
    expect(state.sandboxTokenGuidance).toContain('--tracker-token');
    expect(state.sandboxTokenGuidance).toContain('INSTRUCTION_ENGINE_GATEWAY_HTTP_TOKEN');
  });

  it('does not mark gateway token gate for unrelated gateway errors', async () => {
    const { gatewayStore } = await import('../ui/src/tabs/Gateway/gatewayStore');

    mockGetGatewayState.mockResolvedValueOnce({
      ready: false,
      errors: [
        {
          code: 'gateway_unreachable',
          message: 'unable to connect',
        },
      ],
      tracker: {
        ready: false,
        status: 'degraded',
      },
    });

    await gatewayStore.refreshState();

    const state = gatewayStore.getState();
    expect(state.sandboxTokenMissing).toBe(false);
    expect(state.sandboxTokenGuidance).toBe('');
  });
});
