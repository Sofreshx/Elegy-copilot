import { HookMetrics } from '../hookMetrics';

describe('HookMetrics', () => {
	it('accurately counts after 500 evaluations', () => {
		const metrics = new HookMetrics();
		for (let i = 0; i < 200; i++) metrics.record('allow');
		for (let i = 0; i < 150; i++) metrics.record('warn');
		for (let i = 0; i < 150; i++) metrics.record('block');

		const snapshot = metrics.getSnapshot();
		expect(snapshot.evaluationCount).toBe(500);
		expect(snapshot.allowCount).toBe(200);
		expect(snapshot.warnCount).toBe(150);
		expect(snapshot.blockCount).toBe(150);
		expect(snapshot.snapshotAtMs).toBeGreaterThan(0);
	});

	it('checkpoint fires at interval', () => {
		const onCheckpoint = jest.fn();
		const metrics = new HookMetrics({
			checkpointIntervalMs: 100,
			onCheckpoint,
		});

		// Mock Date.now to simulate time passing
		const realDateNow = Date.now;
		let fakeNow = realDateNow();
		jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

		// Record within interval — no checkpoint
		metrics.record('allow');
		expect(onCheckpoint).not.toHaveBeenCalled();

		// Advance time past the checkpoint interval
		fakeNow += 150;
		metrics.record('warn');
		expect(onCheckpoint).toHaveBeenCalledTimes(1);
		expect(onCheckpoint).toHaveBeenCalledWith(
			expect.objectContaining({
				evaluationCount: 2,
				allowCount: 1,
				warnCount: 1,
				blockCount: 0,
			}),
		);

		jest.spyOn(Date, 'now').mockRestore();
	});

	it('getSnapshot returns zeroes initially', () => {
		const metrics = new HookMetrics();
		const snapshot = metrics.getSnapshot();
		expect(snapshot.evaluationCount).toBe(0);
		expect(snapshot.allowCount).toBe(0);
		expect(snapshot.warnCount).toBe(0);
		expect(snapshot.blockCount).toBe(0);
	});
});
