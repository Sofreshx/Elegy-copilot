import { PermissionOrchestrator } from '../permissionOrchestrator';

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
});
