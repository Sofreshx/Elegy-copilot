import { PermissionOrchestrator } from '../permissionOrchestrator';
import type { BridgeClient, BridgeClientStatus, ResolvePermissionParams } from '../bridgeClient';

class FakeBridgeClient implements BridgeClient {
	status: BridgeClientStatus = 'connected';
	resolvedPermissions: Array<{ callbackId: string; approved: boolean; resolvedBy?: string }> = [];

	start(): void {}
	async stop(): Promise<void> {}
	getStatus(): BridgeClientStatus { return this.status; }
	async get_sessions(): Promise<unknown> { return { sessions: [] }; }
	async invoke_agent(): Promise<unknown> { return {}; }
	async cancel_session(): Promise<unknown> { return {}; }
	async resolve_permission(params: ResolvePermissionParams): Promise<unknown> {
		this.resolvedPermissions.push({ callbackId: params.callbackId, approved: params.approved, resolvedBy: params.resolvedBy });
		return {};
	}
}

describe('PermissionOrchestrator', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2026-02-16T00:00:00.000Z'));
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('tracks pending permissions and auto-denies after timeout', async () => {
		const resolve_permission = jest.fn(async () => ({ ok: true }));
		const client = {
			getStatus: () => 'connected',
			resolve_permission,
		} as any;

		const pendingChanged = jest.fn();
		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 5_000,
			defaultResolvedBy: 'test-orch',
			onPendingChanged: pendingChanged,
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-1',
			toolName: 'read_file',
			description: 'read a file',
		});

		expect(orch.getPending()).toHaveLength(1);
		expect(orch.getPending()[0].callbackId).toBe('cb-1');

		await jest.advanceTimersByTimeAsync(5_000);

		expect(resolve_permission).toHaveBeenCalledWith({
			callbackId: 'cb-1',
			approved: false,
			resolvedBy: 'test-orch:timeout',
		});
		expect(orch.getPending()).toHaveLength(0);
		expect(pendingChanged).toHaveBeenCalled();
	});

	it.each([
		{ label: 'approve', approved: true },
		{ label: 'deny', approved: false },
	])('resolves pending permission via client on $label and clears pending', async ({ approved }) => {
		const resolve_permission = jest.fn(async () => ({ ok: true }));
		const client = {
			getStatus: () => 'connected',
			resolve_permission,
		} as any;

		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 5_000,
			defaultResolvedBy: 'test-orch',
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			sessionId: 'sess-1',
			payload: {
				callbackId: 'cb-1',
				toolName: 'read_file',
				description: 'read a file',
			},
		});

		expect(orch.getPending()).toHaveLength(1);
		expect(orch.getPending()[0].sessionId).toBe('sess-1');

		if (approved) await orch.approve('cb-1', 'discord:tester');
		else await orch.deny('cb-1', 'discord:tester');

		expect(resolve_permission).toHaveBeenCalledWith({
			callbackId: 'cb-1',
			approved,
			resolvedBy: 'discord:tester',
		});
		expect(orch.getPending()).toHaveLength(0);

		// Ensure the prior timeout doesn't fire after a manual decision.
		await jest.advanceTimersByTimeAsync(5_000);
		expect(resolve_permission).toHaveBeenCalledTimes(1);
	});

	it('getPendingBySandbox returns only permissions for the given sandbox', () => {
		const orch = new PermissionOrchestrator({ permissionTimeoutMs: 60_000 });

		orch.handleExtensionEvent({
			type: 'permission_requested',
			sandboxId: 'sb-a',
			callbackId: 'cb-1',
			toolName: 'read_file',
		});
		orch.handleExtensionEvent({
			type: 'permission_requested',
			sandboxId: 'sb-b',
			callbackId: 'cb-2',
			toolName: 'write_file',
		});
		orch.handleExtensionEvent({
			type: 'permission_requested',
			sandboxId: 'sb-a',
			callbackId: 'cb-3',
			toolName: 'exec',
		});

		expect(orch.getPendingBySandbox('sb-a')).toHaveLength(2);
		expect(orch.getPendingBySandbox('sb-a').map(p => p.callbackId)).toEqual(['cb-1', 'cb-3']);
		expect(orch.getPendingBySandbox('sb-b')).toHaveLength(1);
		expect(orch.getPendingBySandbox('sb-b')[0].callbackId).toBe('cb-2');
		expect(orch.getPendingBySandbox('sb-nonexistent')).toHaveLength(0);
	});

	it('resolve uses clientResolver when set, falling back to static client', async () => {
		const staticClient = new FakeBridgeClient();
		const resolverClient = new FakeBridgeClient();

		const orch = new PermissionOrchestrator({
			client: staticClient,
			clientResolver: () => resolverClient,
			permissionTimeoutMs: 60_000,
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-1',
			toolName: 'read_file',
		});

		await orch.approve('cb-1', 'test');

		expect(resolverClient.resolvedPermissions).toHaveLength(1);
		expect(resolverClient.resolvedPermissions[0].callbackId).toBe('cb-1');
		expect(staticClient.resolvedPermissions).toHaveLength(0);
	});

	it('first-writer-wins: second resolve for same callbackId is silent no-op', async () => {
		const client = new FakeBridgeClient();
		const auditLog: unknown[] = [];

		const orch = new PermissionOrchestrator({
			client,
			permissionTimeoutMs: 60_000,
			auditLogger: { log: (entry: unknown) => auditLog.push(entry) } as any,
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-1',
			toolName: 'read_file',
		});

		await orch.approve('cb-1', 'discord:user1');
		// Second resolution should not throw
		await orch.approve('cb-1', 'copilot-ui:user2');

		expect(client.resolvedPermissions).toHaveLength(1);
		expect(auditLog).toContainEqual(
			expect.objectContaining({ kind: 'permission_resolve_noop', callbackId: 'cb-1' }),
		);
	});

	it('setClientResolver overrides static client for resolve', async () => {
		const staticClient = new FakeBridgeClient();
		const resolverClient = new FakeBridgeClient();

		const orch = new PermissionOrchestrator({
			client: staticClient,
			permissionTimeoutMs: 60_000,
		});

		// Initially uses static client
		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-1',
			toolName: 'read_file',
		});
		await orch.approve('cb-1', 'test');
		expect(staticClient.resolvedPermissions).toHaveLength(1);

		// Now set resolver
		orch.setClientResolver(() => resolverClient);

		orch.handleExtensionEvent({
			type: 'permission_requested',
			callbackId: 'cb-2',
			toolName: 'write_file',
		});
		await orch.approve('cb-2', 'test');
		expect(resolverClient.resolvedPermissions).toHaveLength(1);
		expect(staticClient.resolvedPermissions).toHaveLength(1); // unchanged
	});

	it('resolve routes to correct client via sandbox-specific resolver', async () => {
		const clientA = new FakeBridgeClient();
		const clientB = new FakeBridgeClient();

		const resolver = (sandboxId?: string) => {
			if (sandboxId === 'sb-a') return clientA;
			if (sandboxId === 'sb-b') return clientB;
			return undefined;
		};

		const orch = new PermissionOrchestrator({
			clientResolver: resolver,
			permissionTimeoutMs: 60_000,
		});

		orch.handleExtensionEvent({
			type: 'permission_requested',
			sandboxId: 'sb-a',
			callbackId: 'cb-1',
			toolName: 'read_file',
		});
		orch.handleExtensionEvent({
			type: 'permission_requested',
			sandboxId: 'sb-b',
			callbackId: 'cb-2',
			toolName: 'write_file',
		});

		await orch.approve('cb-1', 'test');
		await orch.deny('cb-2', 'test');

		expect(clientA.resolvedPermissions).toEqual([
			{ callbackId: 'cb-1', approved: true, resolvedBy: 'test' },
		]);
		expect(clientB.resolvedPermissions).toEqual([
			{ callbackId: 'cb-2', approved: false, resolvedBy: 'test' },
		]);
	});
});
