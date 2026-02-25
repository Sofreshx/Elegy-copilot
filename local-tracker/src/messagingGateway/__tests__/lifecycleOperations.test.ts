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

function createContainerInfo(sandboxId: string, hostPort: number): SandboxContainerInfo {
	return {
		containerId: `container-${sandboxId}`,
		name: `ie-sandbox-${sandboxId}`,
		sandboxId,
		hostPort,
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