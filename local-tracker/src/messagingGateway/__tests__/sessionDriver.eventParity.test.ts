import { BridgeClientSessionDriver, SandboxSessionDriver } from '../sessionDriver';
import type { SessionDriver } from '../sessionDriver';

const mockClient = {
	start: jest.fn(),
	stop: jest.fn().mockResolvedValue(undefined),
	getStatus: jest.fn().mockReturnValue('connected'),
	get_sessions: jest.fn().mockResolvedValue([{ id: 's1' }]),
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
	getAll: jest.fn(() => [
		{ client: mockClient, meta: { sandboxId: 'sandbox-1', hostPort: 5000, registeredAt: '2026-01-01', status: 'connected' } },
	]),
} as any;

describe('SessionDriver event parity', () => {
	let bridgeDriver: SessionDriver;
	let sandboxDriver: SessionDriver;

	beforeEach(() => {
		jest.clearAllMocks();
		bridgeDriver = new BridgeClientSessionDriver(mockClient);
		sandboxDriver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
	});

	it('both drivers implement all SessionDriver methods', () => {
		const methods: (keyof SessionDriver)[] = [
			'getSessions',
			'invokeAgent',
			'cancelSession',
			'resolvePermission',
			'getStatus',
			'getSource',
		];
		for (const method of methods) {
			expect(typeof bridgeDriver[method]).toBe('function');
			expect(typeof sandboxDriver[method]).toBe('function');
		}
	});

	it('getSessions calls get_sessions on underlying client for both', async () => {
		await bridgeDriver.getSessions();
		expect(mockClient.get_sessions).toHaveBeenCalledTimes(1);

		jest.clearAllMocks();

		await sandboxDriver.getSessions();
		expect(mockClient.get_sessions).toHaveBeenCalledTimes(1);
	});

	it('invokeAgent delegates correctly for both', async () => {
		const params = { agentName: 'test-agent', prompt: 'hello' };

		await bridgeDriver.invokeAgent(params);
		expect(mockClient.invoke_agent).toHaveBeenCalledWith(params);

		jest.clearAllMocks();

		await sandboxDriver.invokeAgent(params);
		expect(mockClient.invoke_agent).toHaveBeenCalledWith(params);
	});

	it('cancelSession delegates correctly for both', async () => {
		const params = { sessionId: 's1' };

		await bridgeDriver.cancelSession(params);
		expect(mockClient.cancel_session).toHaveBeenCalledWith(params);

		jest.clearAllMocks();

		await sandboxDriver.cancelSession(params);
		expect(mockClient.cancel_session).toHaveBeenCalledWith(params);
	});

	it('resolvePermission delegates correctly for both', async () => {
		const params = { callbackId: 'cb-1', approved: true };

		await bridgeDriver.resolvePermission(params);
		expect(mockClient.resolve_permission).toHaveBeenCalledWith(params);

		jest.clearAllMocks();

		await sandboxDriver.resolvePermission(params);
		expect(mockClient.resolve_permission).toHaveBeenCalledWith(params);
	});

	it('getSource returns local and sandbox respectively', () => {
		expect(bridgeDriver.getSource()).toBe('local');
		expect(sandboxDriver.getSource()).toBe('sandbox');
	});
});
