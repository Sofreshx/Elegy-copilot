import { BridgeClientSessionDriver, SandboxSessionDriver, SessionDriverError } from '../sessionDriver';

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
	getAll: jest.fn(() => [
		{ client: mockClient, meta: { sandboxId: 'sandbox-1', hostPort: 5000, registeredAt: '2026-01-01', status: 'connected' } },
	]),
} as any;

describe('BridgeClientSessionDriver', () => {
	let driver: BridgeClientSessionDriver;

	beforeEach(() => {
		jest.clearAllMocks();
		driver = new BridgeClientSessionDriver(mockClient);
	});

	it('getSessions delegates to client.get_sessions', async () => {
		await driver.getSessions();
		expect(mockClient.get_sessions).toHaveBeenCalledTimes(1);
	});

	it('invokeAgent delegates to client.invoke_agent', async () => {
		const params = { agentName: 'a1', prompt: 'hi' };
		const result = await driver.invokeAgent(params);
		expect(mockClient.invoke_agent).toHaveBeenCalledWith(params);
		expect(result).toEqual({ sessionId: 's1' });
	});

	it('cancelSession delegates to client.cancel_session', async () => {
		const params = { sessionId: 's1' };
		await driver.cancelSession(params);
		expect(mockClient.cancel_session).toHaveBeenCalledWith(params);
	});

	it('resolvePermission delegates to client.resolve_permission', async () => {
		const params = { callbackId: 'cb-1', approved: true };
		await driver.resolvePermission(params);
		expect(mockClient.resolve_permission).toHaveBeenCalledWith(params);
	});

	it('getStatus delegates to client.getStatus', () => {
		expect(driver.getStatus()).toBe('connected');
		expect(mockClient.getStatus).toHaveBeenCalled();
	});

	it('getSource returns local', () => {
		expect(driver.getSource()).toBe('local');
	});
});

describe('SandboxSessionDriver', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('routes operations through registry to correct sandbox client', async () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		await driver.getSessions();
		expect(mockRegistry.get).toHaveBeenCalledWith('sandbox-1');
		expect(mockClient.get_sessions).toHaveBeenCalledTimes(1);
	});

	it('invokeAgent delegates through registry', async () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		const params = { agentName: 'a1', prompt: 'test' };
		await driver.invokeAgent(params);
		expect(mockClient.invoke_agent).toHaveBeenCalledWith(params);
	});

	it('cancelSession delegates through registry', async () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		const params = { sessionId: 's1' };
		await driver.cancelSession(params);
		expect(mockClient.cancel_session).toHaveBeenCalledWith(params);
	});

	it('resolvePermission delegates through registry', async () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		const params = { callbackId: 'cb-1', approved: false };
		await driver.resolvePermission(params);
		expect(mockClient.resolve_permission).toHaveBeenCalledWith(params);
	});

	it('missing sandbox throws SessionDriverError', async () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'nonexistent');
		await expect(driver.getSessions()).rejects.toThrow(SessionDriverError);
		await expect(driver.getSessions()).rejects.toThrow('Sandbox "nonexistent" not found');
	});

	it('getStatus returns stopped for missing sandbox', () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'nonexistent');
		expect(driver.getStatus()).toBe('stopped');
	});

	it('getStatus returns connected for existing sandbox', () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		expect(driver.getStatus()).toBe('connected');
	});

	it('getSandboxId returns correct id', () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		expect(driver.getSandboxId()).toBe('sandbox-1');
	});

	it('getSource returns sandbox', () => {
		const driver = new SandboxSessionDriver(mockRegistry, 'sandbox-1');
		expect(driver.getSource()).toBe('sandbox');
	});
});
