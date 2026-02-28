import type http from 'http';

import type { AuditLogger } from '../auditLogger';
import type { ContainerManager, SandboxContainerInfo } from '../containerManager';
import { createLifecycleOperationsHandler } from '../lifecycleOperations';
import type { PortAllocator } from '../portAllocator';
import type { SandboxRegistry } from '../sandboxRegistry';

function makeReq(actor = 'test-user'): http.IncomingMessage {
	return {
		headers: {
			'x-ie-actor': actor,
		},
		socket: {
			remoteAddress: '127.0.0.1',
		},
	} as unknown as http.IncomingMessage;
}

function createContainerInfo(sandboxId: string, hostPort: number, state = 'running'): SandboxContainerInfo {
	return {
		containerId: `container-${sandboxId}`,
		name: `ie-sandbox-${sandboxId}`,
		sandboxId,
		hostPort,
		state,
		labels: {
			'ie.sandbox': 'true',
			'ie.sandbox.id': sandboxId,
			'ie.sandbox.port': String(hostPort),
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolveFn, rejectFn) => {
		resolve = resolveFn;
		reject = rejectFn;
	});
	return { promise, resolve, reject };
}

function createHarness(options?: {
	getOrSpawnDelayPromise?: Promise<void>;
	stopDelayPromise?: Promise<void>;
}): {
	handler: ReturnType<typeof createLifecycleOperationsHandler>;
	auditLogger: { logSecurityEvent: jest.Mock };
	containerManager: {
		get: jest.Mock;
		getOrSpawn: jest.Mock;
		stop: jest.Mock;
		containers: Map<string, SandboxContainerInfo>;
	};
	portAllocator: { allocate: jest.Mock; release: jest.Mock };
	sandboxRegistry: { get: jest.Mock; unregister: jest.Mock };
} {
	const containers = new Map<string, SandboxContainerInfo>();

	const auditLogger = {
		logSecurityEvent: jest.fn(),
	};

	const sandboxRegistry = {
		get: jest.fn(() => undefined),
		unregister: jest.fn(async () => false),
	};

	const containerManager = {
		containers,
		get: jest.fn(async (sandboxId: string) => containers.get(sandboxId) ?? null),
		getOrSpawn: jest.fn(async (sandboxId: string, hostPort: number) => {
			if (options?.getOrSpawnDelayPromise) {
				await options.getOrSpawnDelayPromise;
			}

			const existing = containers.get(sandboxId);
			if (existing) {
				return { info: existing, created: false };
			}

			const created = createContainerInfo(sandboxId, hostPort);
			containers.set(sandboxId, created);
			return { info: created, created: true };
		}),
		stop: jest.fn(async (sandboxId: string) => {
			if (options?.stopDelayPromise) {
				await options.stopDelayPromise;
			}
			return containers.delete(sandboxId);
		}),
	};

	const portAllocator = {
		allocate: jest.fn(async () => 13001),
		release: jest.fn(),
	};

	const handler = createLifecycleOperationsHandler({
		auditLogger: auditLogger as unknown as AuditLogger,
		containerManager: containerManager as unknown as ContainerManager,
		sandboxRegistry: sandboxRegistry as unknown as SandboxRegistry,
		portAllocator: portAllocator as unknown as PortAllocator,
	});

	return {
		handler,
		auditLogger,
		containerManager,
		portAllocator,
		sandboxRegistry,
	};
}

describe('LifecycleOperationsHandler', () => {
	it('create accepts omitted sandboxId and returns generated canonical sandboxId with auto source', async () => {
		const harness = createHarness();

		const result = await harness.handler.handle('create', {}, makeReq());

		expect(result).toMatchObject({
			status: 'created',
			idempotent: false,
			sandboxIdSource: 'auto',
		});
		expect(result.sandboxId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/);
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledWith(result.sandboxId, 13001);
	});

	it('create returns trimmed user sandboxId and user source metadata when sandboxId is provided', async () => {
		const harness = createHarness();

		const result = await harness.handler.handle('create', { sandboxId: '  sb-user-1  ' }, makeReq());

		expect(result).toMatchObject({
			sandboxId: 'sb-user-1',
			sandboxIdSource: 'user',
			status: 'created',
			idempotent: false,
		});
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledWith('sb-user-1', 13001);
	});

	it('create treats blank sandboxId as omitted and returns generated canonical sandboxId with auto source', async () => {
		const harness = createHarness();

		const result = await harness.handler.handle('create', { sandboxId: '   ' }, makeReq());

		expect(result).toMatchObject({
			status: 'created',
			idempotent: false,
			sandboxIdSource: 'auto',
		});
		expect(result.sandboxId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/);
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledWith(result.sandboxId, 13001);
	});

	it('create rejects unexpected payload fields with deterministic validation errors', async () => {
		const harness = createHarness();

		await expect(harness.handler.handle('create', { sandboxId: 'sb-1', extra: true }, makeReq())).rejects.toMatchObject({
			code: 'invalid_lifecycle_payload',
			reason: 'unexpected_field:extra',
		});
	});

	it('start still requires sandboxId and returns deterministic validation error when missing', async () => {
		const harness = createHarness();

		await expect(harness.handler.handle('start', {}, makeReq())).rejects.toMatchObject({
			code: 'invalid_lifecycle_payload',
			reason: 'missing_or_invalid_sandbox_id',
		});
	});

	it('concurrent duplicate create calls coalesce', async () => {
		const createBarrier = deferred<void>();
		const harness = createHarness({ getOrSpawnDelayPromise: createBarrier.promise });

		const req = makeReq();
		const p1 = harness.handler.handle('create', { sandboxId: 'sb-1' }, req);
		const p2 = harness.handler.handle('create', { sandboxId: 'sb-1' }, req);

		createBarrier.resolve();
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledTimes(1);

		expect(r1).toEqual(r2);
		expect(r1).toMatchObject({
			sandboxId: 'sb-1',
			status: 'created',
			deduped: true,
			coalescedCallCount: 2,
		});
		expect(harness.auditLogger.logSecurityEvent).toHaveBeenCalledWith(
			'gateway.lifecycle.create.deduped',
			expect.objectContaining({ dedupeKey: 'create:sb-1' }),
		);
	});

	it('repeated start on active sandbox returns idempotent already-active result', async () => {
		const harness = createHarness();

		const first = await harness.handler.handle('start', { sandboxId: 'sb-2' }, makeReq());
		expect(first).toMatchObject({
			sandboxId: 'sb-2',
			status: 'started',
			idempotent: false,
		});

		const second = await harness.handler.handle('start', { sandboxId: 'sb-2' }, makeReq());
		expect(second).toMatchObject({
			sandboxId: 'sb-2',
			status: 'already-active',
			idempotent: true,
		});
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledTimes(1);
	});

	it('start recovers a non-running sandbox container after restart and remains idempotent on retry', async () => {
		const harness = createHarness();
		harness.containerManager.containers.set('sb-recover', createContainerInfo('sb-recover', 13008, 'exited'));

		const recovered = await harness.handler.handle('start', { sandboxId: 'sb-recover' }, makeReq());
		expect(recovered).toMatchObject({
			sandboxId: 'sb-recover',
			status: 'started',
			idempotent: false,
		});
		expect(harness.containerManager.stop).toHaveBeenCalledWith('sb-recover');
		expect(harness.portAllocator.release).toHaveBeenCalledWith(13008);

		const retried = await harness.handler.handle('start', { sandboxId: 'sb-recover' }, makeReq());
		expect(retried).toMatchObject({
			sandboxId: 'sb-recover',
			status: 'already-active',
			idempotent: true,
		});
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledTimes(1);
	});

	it('start clears stale registry entry and recreates sandbox deterministically when no container exists', async () => {
		const harness = createHarness();
		harness.sandboxRegistry.get
			.mockReturnValueOnce({ meta: { hostPort: 13009 } })
			.mockReturnValue(undefined);

		const result = await harness.handler.handle('start', { sandboxId: 'sb-stale-registry' }, makeReq());

		expect(result).toMatchObject({
			sandboxId: 'sb-stale-registry',
			status: 'started',
			idempotent: false,
		});
		expect(harness.sandboxRegistry.unregister).toHaveBeenCalledWith('sb-stale-registry');
		expect(harness.containerManager.getOrSpawn).toHaveBeenCalledTimes(1);
	});

	it('repeated stop on missing/stopped sandbox returns idempotent already-stopped result', async () => {
		const harness = createHarness();
		harness.containerManager.containers.set('sb-3', createContainerInfo('sb-3', 13003));

		const first = await harness.handler.handle('stop', { sandboxId: 'sb-3' }, makeReq());
		expect(first).toMatchObject({
			sandboxId: 'sb-3',
			status: 'stopped',
			idempotent: false,
		});

		const second = await harness.handler.handle('stop', { sandboxId: 'sb-3' }, makeReq());
		expect(second).toMatchObject({
			sandboxId: 'sb-3',
			status: 'already-stopped',
			idempotent: true,
		});
		expect(harness.portAllocator.release).toHaveBeenCalledWith(13003);
	});

	it('finish defaults to skip-pr and still closes the sandbox deterministically', async () => {
		const harness = createHarness();
		harness.containerManager.containers.set('sb-finish-1', createContainerInfo('sb-finish-1', 13011));

		const result = await harness.handler.handle('finish', { sandboxId: 'sb-finish-1' }, makeReq());

		expect(result).toMatchObject({
			sandboxId: 'sb-finish-1',
			status: 'finished',
			closeAllowed: true,
			finishDeterministic: true,
			pr: {
				action: 'skip-pr',
				outcome: 'skip-pr',
				blocking: false,
			},
			close: {
				allowed: true,
				attempted: true,
				status: 'closed',
				result: {
					sandboxId: 'sb-finish-1',
					status: 'stopped',
				},
			},
		});
		expect(harness.containerManager.stop).toHaveBeenCalledWith('sb-finish-1');
	});

	it('finish keeps close allowed when optional PR branch fails', async () => {
		const harness = createHarness();
		harness.containerManager.containers.set('sb-finish-2', createContainerInfo('sb-finish-2', 13012));

		const prOpenSpy = jest.spyOn(harness.handler as any, 'handlePrOpen')
			.mockImplementation(() => {
				throw new Error('pr-open failed');
			});

		const result = await harness.handler.handle('finish', {
			sandboxId: 'sb-finish-2',
			prAction: 'open-pr',
			baseBranch: 'main',
			headBranch: 'feature/finish',
		}, makeReq());

		expect(result).toMatchObject({
			sandboxId: 'sb-finish-2',
			status: 'finished',
			closeAllowed: true,
			pr: {
				action: 'open-pr',
				outcome: 'open-pr:failure',
				blocking: false,
				error: 'pr-open failed',
			},
			close: {
				allowed: true,
				attempted: true,
				status: 'closed',
				result: {
					sandboxId: 'sb-finish-2',
					status: 'stopped',
				},
			},
		});
		expect(harness.containerManager.stop).toHaveBeenCalledWith('sb-finish-2');

		prOpenSpy.mockRestore();
	});

	it('concurrent duplicate finish requests coalesce and preserve canonical sandboxId across finish retry envelopes', async () => {
		const stopBarrier = deferred<void>();
		const harness = createHarness({ stopDelayPromise: stopBarrier.promise });
		harness.containerManager.containers.set('sb-edited-canonical', createContainerInfo('sb-edited-canonical', 13013));

		const payload = {
			sandboxId: 'sb-edited-canonical',
			prAction: 'skip-pr',
		};
		const req = makeReq();

		const first = harness.handler.handle('finish', payload, req);
		const second = harness.handler.handle('finish', payload, req);

		stopBarrier.resolve();
		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toEqual(secondResult);
		expect(firstResult).toMatchObject({
			sandboxId: 'sb-edited-canonical',
			status: 'finished',
			finishDeterministic: true,
			deduped: true,
			coalescedCallCount: 2,
			dedupeKey: 'finish:sb-edited-canonical:skip-pr',
			close: {
				status: 'closed',
				result: {
					sandboxId: 'sb-edited-canonical',
				},
			},
		});
		expect(harness.containerManager.stop).toHaveBeenCalledTimes(1);
		expect(harness.auditLogger.logSecurityEvent).toHaveBeenCalledWith(
			'gateway.lifecycle.finish.deduped',
			expect.objectContaining({ dedupeKey: 'finish:sb-edited-canonical:skip-pr' }),
		);
	});

	it('returns conflict-fast error when coalesced finish retries collide on same dedupe key with mismatched payload', async () => {
		const stopBarrier = deferred<void>();
		const harness = createHarness({ stopDelayPromise: stopBarrier.promise });
		harness.containerManager.containers.set('sb-finish-conflict', createContainerInfo('sb-finish-conflict', 13014));

		const handlerAny = harness.handler as unknown as {
			getDedupeKey: (action: string, payload: { sandboxId: string }) => string;
		};
		const originalGetDedupeKey = handlerAny.getDedupeKey.bind(handlerAny);
		const dedupeKeySpy = jest.spyOn(handlerAny, 'getDedupeKey').mockImplementation((action, payload) => {
			if (action === 'finish') {
				return `finish:${payload.sandboxId}:forced-collision`;
			}
			return originalGetDedupeKey(action, payload);
		});

		const req = makeReq();
		const first = harness.handler.handle('finish', { sandboxId: 'sb-finish-conflict', prAction: 'skip-pr' }, req);
		const second = harness.handler.handle('finish', { sandboxId: 'sb-finish-conflict', prAction: 'open-pr:canceled' }, req);

		await expect(second).rejects.toMatchObject({
			code: 'idempotency_conflict',
			reason: 'idempotency_key_payload_mismatch',
			action: 'finish',
		});

		stopBarrier.resolve();
		await expect(first).resolves.toMatchObject({
			sandboxId: 'sb-finish-conflict',
			status: 'finished',
			finishDeterministic: true,
		});

		expect(harness.auditLogger.logSecurityEvent).toHaveBeenCalledWith(
			'gateway.lifecycle.finish.conflict',
			expect.objectContaining({
				dedupeKey: 'finish:sb-finish-conflict:forced-collision',
				reason: 'idempotency_key_payload_mismatch',
			}),
		);

		dedupeKeySpy.mockRestore();
	});

	it('concurrent duplicate pr-open requests dedupe by sandbox/base/head tuple', async () => {
		const harness = createHarness();
		const req = makeReq();

		const payload = { sandboxId: 'sb-4', baseBranch: 'main', headBranch: 'feature/a' };
		const p1 = harness.handler.handle('pr-open', payload, req);
		const p2 = harness.handler.handle('pr-open', payload, req);

		const [r1, r2] = await Promise.all([p1, p2]);

		expect(r1).toEqual(r2);
		expect(r1).toMatchObject({
			sandboxId: 'sb-4',
			status: 'accepted',
			deduped: true,
			coalescedCallCount: 2,
			dedupeKey: 'pr-open:sb-4:main:feature/a',
		});
	});

	it('distinct pr-open tuples are not deduped', async () => {
		const harness = createHarness();
		const req = makeReq();

		const [r1, r2] = await Promise.all([
			harness.handler.handle('pr-open', { sandboxId: 'sb-5', baseBranch: 'main', headBranch: 'feature/a' }, req),
			harness.handler.handle('pr-open', { sandboxId: 'sb-5', baseBranch: 'main', headBranch: 'feature/b' }, req),
		]);

		expect(r1).toMatchObject({
			deduped: false,
			dedupeKey: 'pr-open:sb-5:main:feature/a',
		});
		expect(r2).toMatchObject({
			deduped: false,
			dedupeKey: 'pr-open:sb-5:main:feature/b',
		});
		expect(harness.auditLogger.logSecurityEvent).not.toHaveBeenCalledWith(
			'gateway.lifecycle.pr-open.deduped',
			expect.anything(),
		);
	});
});