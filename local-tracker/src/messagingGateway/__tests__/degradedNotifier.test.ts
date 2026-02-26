import { HealthRegistry } from '../adapterHealth';
import { DegradedNotifier } from '../degradedNotifier';

function createTestNotifier(overrides: {
	sendNotification?: jest.Mock;
	auditLogger?: { log: jest.Mock };
	debouncePeriodMs?: number;
	registry?: HealthRegistry;
} = {}) {
	const registry = overrides.registry ?? new HealthRegistry();
	const sendNotification = overrides.sendNotification ?? jest.fn().mockResolvedValue(undefined);
	const auditLogger = overrides.auditLogger ?? { log: jest.fn() };
	const notifier = new DegradedNotifier({
		registry,
		auditLogger: auditLogger as any,
		sendNotification,
		debouncePeriodMs: overrides.debouncePeriodMs ?? 0, // no debounce by default in tests
	});
	return { registry, sendNotification, auditLogger, notifier };
}

describe('DegradedNotifier', () => {
	it('notifies surviving adapters when one disconnects', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier();
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');

		// Disconnect discord
		registry.update('discord', 'discord', 'disconnected', 'Connection lost');

		// Allow async handler to run
		await flushMicrotasks();

		expect(sendNotification).toHaveBeenCalledTimes(1);
		expect(sendNotification).toHaveBeenCalledWith(
			'telegram',
			expect.stringContaining('discord'),
		);

		notifier.stop();
	});

	it('does NOT notify for non-disconnect state changes (healthy → degraded)', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier();
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');

		// Degrade discord (not disconnect)
		registry.update('discord', 'discord', 'degraded', 'High latency');

		await flushMicrotasks();

		expect(sendNotification).not.toHaveBeenCalled();

		notifier.stop();
	});

	it('does NOT notify for reconnection (disconnected → healthy)', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier();
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');
		registry.update('discord', 'discord', 'disconnected', 'Connection lost');

		await flushMicrotasks();
		sendNotification.mockClear();

		// Reconnect
		registry.update('discord', 'discord', 'healthy');

		await flushMicrotasks();

		expect(sendNotification).not.toHaveBeenCalled();

		notifier.stop();
	});

	it('debounces repeated notifications for the same adapter', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier({
			debouncePeriodMs: 60_000,
		});
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');

		// First disconnect
		registry.update('discord', 'discord', 'disconnected', 'Lost');
		await flushMicrotasks();

		expect(sendNotification).toHaveBeenCalledTimes(1);

		// Reconnect then disconnect again (within debounce window)
		registry.update('discord', 'discord', 'healthy');
		registry.update('discord', 'discord', 'disconnected', 'Lost again');
		await flushMicrotasks();

		// Still only 1 call — debounced
		expect(sendNotification).toHaveBeenCalledTimes(1);

		notifier.stop();
	});

	it('allows notification after debounce period elapses', async () => {
		const now = { value: 1000 };
		jest.spyOn(Date, 'now').mockImplementation(() => now.value);

		const { registry, sendNotification, notifier } = createTestNotifier({
			debouncePeriodMs: 5_000,
		});
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');

		// First disconnect at t=1000
		registry.update('discord', 'discord', 'disconnected', 'Lost');
		await flushMicrotasks();
		expect(sendNotification).toHaveBeenCalledTimes(1);

		// Reconnect
		registry.update('discord', 'discord', 'healthy');

		// Advance past debounce
		now.value = 7000;

		// Disconnect again
		registry.update('discord', 'discord', 'disconnected', 'Lost again');
		await flushMicrotasks();

		expect(sendNotification).toHaveBeenCalledTimes(2);

		notifier.stop();
		jest.restoreAllMocks();
	});

	it('logs audit event on disconnect', async () => {
		const { registry, auditLogger, notifier } = createTestNotifier();
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('discord', 'discord', 'disconnected', 'Timeout');

		await flushMicrotasks();

		expect(auditLogger.log).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'adapter_disconnected',
				adapterId: 'discord',
				kind: 'discord',
				detail: 'Timeout',
			}),
		);

		notifier.stop();
	});

	it('handles sendNotification failure gracefully', async () => {
		const sendNotification = jest.fn().mockRejectedValue(new Error('network'));
		const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const { registry, notifier } = createTestNotifier({ sendNotification });
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');
		registry.update('discord', 'discord', 'disconnected', 'Lost');

		await flushMicrotasks();

		// Should not throw; should log error
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Failed to send degraded notification'),
			expect.any(Error),
		);

		notifier.stop();
		consoleSpy.mockRestore();
	});

	it('stop() removes listener — no notifications after stop', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier();
		notifier.start();

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');

		notifier.stop();

		registry.update('discord', 'discord', 'disconnected', 'Lost');
		await flushMicrotasks();

		expect(sendNotification).not.toHaveBeenCalled();
	});

	it('start() is idempotent', async () => {
		const { registry, sendNotification, notifier } = createTestNotifier();
		notifier.start();
		notifier.start(); // second call should be a no-op

		registry.update('discord', 'discord', 'healthy');
		registry.update('telegram', 'telegram', 'healthy');
		registry.update('discord', 'discord', 'disconnected', 'Lost');

		await flushMicrotasks();

		// Only one notification, not two (listener not registered twice)
		expect(sendNotification).toHaveBeenCalledTimes(1);

		notifier.stop();
	});
});

/** Flush pending microtasks (let `void this.onStateChange(...)` settle). */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
