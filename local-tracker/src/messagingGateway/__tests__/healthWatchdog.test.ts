import { HealthWatchdog } from '../healthWatchdog';
import { HealthRegistry } from '../adapterHealth';
import type { MessagePlatform, AdapterHealthProbeResult } from '../platform';

function createMockAdapter(kind: string, healthResult?: AdapterHealthProbeResult): MessagePlatform {
	return {
		kind: kind as any,
		start: jest.fn(),
		stop: jest.fn(),
		registerCommands: jest.fn(),
		setCommandHandler: jest.fn(),
		getHealthProbe: healthResult ? jest.fn().mockResolvedValue(healthResult) : undefined,
	};
}

describe('HealthWatchdog', () => {
	let registry: HealthRegistry;
	let mockAuditLogger: { log: jest.Mock };

	beforeEach(() => {
		registry = new HealthRegistry();
		mockAuditLogger = { log: jest.fn() };
	});

	it('check() calls getHealthProbe on adapters that have it', async () => {
		const adapter = createMockAdapter('discord', { state: 'healthy', detail: 'ok' });
		const watchdog = new HealthWatchdog({
			adapters: [adapter],
			registry,
			auditLogger: mockAuditLogger as any,
		});

		await watchdog.check();

		expect(adapter.getHealthProbe).toHaveBeenCalledTimes(1);
		const snap = registry.get('discord');
		expect(snap).toBeDefined();
		expect(snap!.state).toBe('healthy');
		expect(snap!.detail).toBe('ok');
	});

	it('check() sets healthy for adapters without getHealthProbe', async () => {
		const adapter = createMockAdapter('telegram');
		const watchdog = new HealthWatchdog({
			adapters: [adapter],
			registry,
			auditLogger: mockAuditLogger as any,
		});

		await watchdog.check();

		const snap = registry.get('telegram');
		expect(snap).toBeDefined();
		expect(snap!.state).toBe('healthy');
		expect(snap!.detail).toBe('No health probe available');
	});

	it('check() sets disconnected and logs when getHealthProbe throws', async () => {
		const adapter = createMockAdapter('discord', { state: 'healthy' });
		(adapter.getHealthProbe as jest.Mock).mockRejectedValue(new Error('connection lost'));

		const watchdog = new HealthWatchdog({
			adapters: [adapter],
			registry,
			auditLogger: mockAuditLogger as any,
		});

		await watchdog.check();

		const snap = registry.get('discord');
		expect(snap).toBeDefined();
		expect(snap!.state).toBe('disconnected');
		expect(snap!.detail).toBe('connection lost');
		expect(mockAuditLogger.log).toHaveBeenCalledWith({
			type: 'health_check_error',
			adapterId: 'discord',
			error: 'connection lost',
		});
	});

	it('check() handles mix of healthy and failing adapters', async () => {
		const healthy = createMockAdapter('discord', { state: 'healthy', detail: 'fine' });
		const failing = createMockAdapter('telegram', { state: 'degraded' });
		(failing.getHealthProbe as jest.Mock).mockRejectedValue(new Error('timeout'));

		const watchdog = new HealthWatchdog({
			adapters: [healthy, failing],
			registry,
			auditLogger: mockAuditLogger as any,
		});

		await watchdog.check();

		expect(registry.get('discord')!.state).toBe('healthy');
		expect(registry.get('telegram')!.state).toBe('disconnected');
		expect(mockAuditLogger.log).toHaveBeenCalledTimes(1);
	});

	describe('start/stop', () => {
		beforeEach(() => {
			jest.useFakeTimers();
		});

		afterEach(() => {
			jest.useRealTimers();
		});

		it('start() runs check immediately then on interval', () => {
			const adapter = createMockAdapter('discord', { state: 'healthy' });
			const watchdog = new HealthWatchdog({
				adapters: [adapter],
				registry,
				auditLogger: mockAuditLogger as any,
				intervalMs: 5000,
			});

			watchdog.start();

			// Immediate call
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(1);

			// Advance past one interval
			jest.advanceTimersByTime(5000);
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(2);

			// Advance past another interval
			jest.advanceTimersByTime(5000);
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(3);

			watchdog.stop();
		});

		it('start() is idempotent', () => {
			const adapter = createMockAdapter('discord', { state: 'healthy' });
			const watchdog = new HealthWatchdog({
				adapters: [adapter],
				registry,
				auditLogger: mockAuditLogger as any,
				intervalMs: 5000,
			});

			watchdog.start();
			watchdog.start(); // second call should be no-op

			// Only one immediate call, not two
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(1);

			watchdog.stop();
		});

		it('stop() clears interval', () => {
			const adapter = createMockAdapter('discord', { state: 'healthy' });
			const watchdog = new HealthWatchdog({
				adapters: [adapter],
				registry,
				auditLogger: mockAuditLogger as any,
				intervalMs: 5000,
			});

			watchdog.start();
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(1);

			watchdog.stop();

			jest.advanceTimersByTime(10000);
			// No additional calls after stop
			expect(adapter.getHealthProbe).toHaveBeenCalledTimes(1);
		});

		it('stop() is safe when not started', () => {
			const watchdog = new HealthWatchdog({
				adapters: [],
				registry,
				auditLogger: mockAuditLogger as any,
			});

			expect(() => watchdog.stop()).not.toThrow();
		});
	});
});
