import type { PlatformMessageHandle, PlatformThreadHandle } from '../platform';
import { SessionThreadManager } from '../sessionThreadManager';

function fakeThread(id = 'thread-1'): PlatformThreadHandle {
	return {
		id,
		name: `Thread ${id}`,
		sendMessage: jest.fn().mockResolvedValue(fakeMessage()),
	};
}

function fakeMessage(): PlatformMessageHandle {
	return { edit: jest.fn().mockResolvedValue(undefined) };
}

function sessionEvent(sessionId: string, type: string, extras: Record<string, unknown> = {}) {
	return { type, sessionId, ...extras };
}

describe('SessionThreadManager sandbox-aware naming', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => {
		jest.useRealTimers();
	});

	it('buildLiveMessage includes sandbox prefix when sandboxId is set', async () => {
		const mgr = new SessionThreadManager({ minUpdateIntervalMs: 0 });
		const msg = fakeMessage();
		mgr.attachThread({
			sessionId: 'sess-1',
			sandboxId: 'sbx-42',
			thread: fakeThread(),
			liveMessage: msg,
		});

		// Send an event to trigger a flush
		mgr.handleExtensionEvent(sessionEvent('sess-1', 'session_started'));
		jest.advanceTimersByTime(0);
		// flush is async — let microtasks settle
		await Promise.resolve();

		const editFn = msg.edit as jest.Mock;
		expect(editFn).toHaveBeenCalled();
		const content: string = editFn.mock.calls[editFn.mock.calls.length - 1][0];
		expect(content).toContain('[sbx-42] Session sess-1');
		expect(content).toContain('Sandbox: sbx-42');

		mgr.stop();
	});

	it('handleExtensionEvent propagates sandboxId from event to session', async () => {
		const mgr = new SessionThreadManager({ minUpdateIntervalMs: 0 });
		const msg = fakeMessage();

		// Event arrives before thread is attached — sandboxId should still propagate
		mgr.handleExtensionEvent(sessionEvent('sess-2', 'session_started', { sandboxId: 'sbx-99' }));

		mgr.attachThread({
			sessionId: 'sess-2',
			thread: fakeThread(),
			liveMessage: msg,
		});

		jest.advanceTimersByTime(0);
		await Promise.resolve();

		const editFn = msg.edit as jest.Mock;
		expect(editFn).toHaveBeenCalled();
		const content: string = editFn.mock.calls[editFn.mock.calls.length - 1][0];
		expect(content).toContain('[sbx-99] Session sess-2');
		expect(content).toContain('Sandbox: sbx-99');

		mgr.stop();
	});

	it('sandboxId from attachThread takes precedence (first-write wins)', async () => {
		const mgr = new SessionThreadManager({ minUpdateIntervalMs: 0 });
		const msg = fakeMessage();

		mgr.attachThread({
			sessionId: 'sess-3',
			sandboxId: 'abc',
			thread: fakeThread(),
			liveMessage: msg,
		});

		// Event with different sandboxId arrives after attach — should NOT overwrite
		mgr.handleExtensionEvent(sessionEvent('sess-3', 'session_started', { sandboxId: 'xyz' }));
		jest.advanceTimersByTime(0);
		await Promise.resolve();

		const editFn = msg.edit as jest.Mock;
		expect(editFn).toHaveBeenCalled();
		const content: string = editFn.mock.calls[editFn.mock.calls.length - 1][0];
		expect(content).toContain('[abc] Session sess-3');
		expect(content).toContain('Sandbox: abc');
		expect(content).not.toContain('xyz');

		mgr.stop();
	});
});

describe('attachInline (threadless, WU-006)', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('attachInline sets liveMessage without thread', () => {
		const mgr = new SessionThreadManager({ minUpdateIntervalMs: 0 });
		const msg = fakeMessage();
		mgr.attachInline({ sessionId: 'inline-1', liveMessage: msg });

		// Session exists, thread count should be 0
		expect(mgr.getActiveSessionThreadCount()).toBe(0);
		expect(mgr.getActiveSessionCount()).toBe(1);

		mgr.stop();
	});

	it('events flush to liveMessage without a thread', async () => {
		const mgr = new SessionThreadManager({ minUpdateIntervalMs: 0 });
		const msg = fakeMessage();
		mgr.attachInline({ sessionId: 'inline-2', sandboxId: 'sbx-inline', liveMessage: msg });

		mgr.handleExtensionEvent(sessionEvent('inline-2', 'session_started'));
		jest.advanceTimersByTime(0);
		await Promise.resolve();

		const editFn = msg.edit as jest.Mock;
		expect(editFn).toHaveBeenCalled();
		const content: string = editFn.mock.calls[editFn.mock.calls.length - 1][0];
		expect(content).toContain('Session inline-2');
		expect(content).toContain('[sbx-inline]');
		expect(content).toContain('started');

		mgr.stop();
	});

	it('getActiveSessionCount returns total sessions', () => {
		const mgr = new SessionThreadManager();
		mgr.attachThread({ sessionId: 's1', thread: fakeThread('t1'), liveMessage: fakeMessage() });
		mgr.attachInline({ sessionId: 's2', liveMessage: fakeMessage() });
		mgr.attachInline({ sessionId: 's3', liveMessage: fakeMessage() });

		expect(mgr.getActiveSessionCount()).toBe(3);
		expect(mgr.getActiveSessionThreadCount()).toBe(1);

		mgr.stop();
	});
});
