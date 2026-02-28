import { BridgeClientSessionDriver, SandboxSessionDriver } from '../sessionDriver';

describe('SessionDriver permission parity', () => {
	const mockClient = {
		start: jest.fn(),
		stop: jest.fn().mockResolvedValue(undefined),
		getStatus: jest.fn().mockReturnValue('connected'),
		get_sessions: jest.fn().mockResolvedValue([]),
		invoke_agent: jest.fn().mockResolvedValue({ sessionId: 's1' }),
		cancel_session: jest.fn().mockResolvedValue(undefined),
		resolve_permission: jest.fn().mockResolvedValue(undefined),
	} as any;

	const mockRegistry = {
		get: jest.fn((id: string) =>
			id === 'sandbox-1'
				? { client: mockClient, meta: { sandboxId: 'sandbox-1', hostPort: 5000, registeredAt: '2026-01-01', status: 'connected' } }
				: undefined,
		),
	} as any;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('both drivers produce identical resolve_permission call shape', async () => {
		const bridgeDriver = new BridgeClientSessionDriver(mockClient);
		const sandboxDriver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');

		const params = { callbackId: 'cb-42', approved: true, resolvedBy: 'user-1' };

		await bridgeDriver.resolvePermission(params);
		const bridgeCall = mockClient.resolve_permission.mock.calls[0];

		jest.clearAllMocks();

		await sandboxDriver.resolvePermission(params);
		const sandboxCall = mockClient.resolve_permission.mock.calls[0];

		expect(bridgeCall).toEqual(sandboxCall);
	});

	it('both drivers pass through additional params identically', async () => {
		const bridgeDriver = new BridgeClientSessionDriver(mockClient);
		const sandboxDriver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');

		const params = { callbackId: 'cb-99', approved: false, resolvedBy: 'admin', metadata: { reason: 'policy' } };

		await bridgeDriver.resolvePermission(params);
		const bridgeCall = mockClient.resolve_permission.mock.calls[0];

		jest.clearAllMocks();

		await sandboxDriver.resolvePermission(params);
		const sandboxCall = mockClient.resolve_permission.mock.calls[0];

		expect(bridgeCall).toEqual(sandboxCall);
	});
});
