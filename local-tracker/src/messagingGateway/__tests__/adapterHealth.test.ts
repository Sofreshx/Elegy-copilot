import { HealthRegistry, AdapterHealthSnapshot, AdapterHealthState } from '../adapterHealth';

describe('HealthRegistry', () => {
	let registry: HealthRegistry;

	beforeEach(() => {
		registry = new HealthRegistry();
	});

	it('update() stores snapshot retrievable via get()', () => {
		registry.update('discord-1', 'discord', 'healthy', 'all good');
		const snap = registry.get('discord-1');
		expect(snap).toBeDefined();
		expect(snap!.adapterId).toBe('discord-1');
		expect(snap!.kind).toBe('discord');
		expect(snap!.state).toBe('healthy');
		expect(snap!.detail).toBe('all good');
	});

	it('getAll() returns all snapshots', () => {
		registry.update('discord-1', 'discord', 'healthy');
		registry.update('telegram-1', 'telegram', 'degraded');
		const all = registry.getAll();
		expect(all).toHaveLength(2);
		const ids = all.map(s => s.adapterId);
		expect(ids).toContain('discord-1');
		expect(ids).toContain('telegram-1');
	});

	it('getAll() returns empty array when no adapters registered', () => {
		expect(registry.getAll()).toEqual([]);
	});

	it('get() returns undefined for unknown adapterId', () => {
		expect(registry.get('nonexistent')).toBeUndefined();
	});

	it('update() emits stateChange event when state changes', () => {
		const listener = jest.fn();
		registry.on('stateChange', listener);

		registry.update('discord-1', 'discord', 'healthy');
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({ adapterId: 'discord-1', state: 'healthy' }),
			'unknown',
		);
	});

	it('update() does NOT emit stateChange when state is same', () => {
		registry.update('discord-1', 'discord', 'healthy');
		const listener = jest.fn();
		registry.on('stateChange', listener);

		registry.update('discord-1', 'discord', 'healthy');
		expect(listener).not.toHaveBeenCalled();
	});

	it('update() updates lastCheckedUtc even when state is same', () => {
		registry.update('discord-1', 'discord', 'healthy');
		const first = registry.get('discord-1')!.lastCheckedUtc;

		// Small delay to ensure timestamp differs
		jest.useFakeTimers();
		jest.setSystemTime(new Date(Date.now() + 1000));

		registry.update('discord-1', 'discord', 'healthy');
		const second = registry.get('discord-1')!.lastCheckedUtc;

		expect(second).not.toBe(first);
		jest.useRealTimers();
	});

	it('update() preserves lastStateChangeUtc when state is same', () => {
		registry.update('discord-1', 'discord', 'healthy');
		const first = registry.get('discord-1')!.lastStateChangeUtc;

		jest.useFakeTimers();
		jest.setSystemTime(new Date(Date.now() + 1000));

		registry.update('discord-1', 'discord', 'healthy');
		const second = registry.get('discord-1')!.lastStateChangeUtc;

		expect(second).toBe(first);
		jest.useRealTimers();
	});

	it('update() updates lastStateChangeUtc when state changes', () => {
		registry.update('discord-1', 'discord', 'healthy');
		const first = registry.get('discord-1')!.lastStateChangeUtc;

		jest.useFakeTimers();
		jest.setSystemTime(new Date(Date.now() + 1000));

		registry.update('discord-1', 'discord', 'degraded');
		const second = registry.get('discord-1')!.lastStateChangeUtc;

		expect(second).not.toBe(first);
		jest.useRealTimers();
	});

	it('getOverallState() returns unknown when no adapters', () => {
		expect(registry.getOverallState()).toBe('unknown');
	});

	it('getOverallState() returns healthy when all healthy', () => {
		registry.update('discord-1', 'discord', 'healthy');
		registry.update('telegram-1', 'telegram', 'healthy');
		expect(registry.getOverallState()).toBe('healthy');
	});

	it('getOverallState() returns disconnected if any disconnected', () => {
		registry.update('discord-1', 'discord', 'healthy');
		registry.update('telegram-1', 'telegram', 'disconnected');
		expect(registry.getOverallState()).toBe('disconnected');
	});

	it('getOverallState() returns degraded if any degraded (none disconnected)', () => {
		registry.update('discord-1', 'discord', 'healthy');
		registry.update('telegram-1', 'telegram', 'degraded');
		expect(registry.getOverallState()).toBe('degraded');
	});

	it('on/off — listener can be added and removed', () => {
		const listener = jest.fn();
		registry.on('stateChange', listener);

		registry.update('discord-1', 'discord', 'healthy');
		expect(listener).toHaveBeenCalledTimes(1);

		registry.off('stateChange', listener);

		registry.update('discord-1', 'discord', 'degraded');
		expect(listener).toHaveBeenCalledTimes(1); // still 1, not called again
	});
});
