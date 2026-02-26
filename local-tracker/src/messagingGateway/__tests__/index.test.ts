import { createSandboxLifecycleRuntime, createSandboxStartupSnapshot } from '../index';

describe('messaging gateway startup sandbox lifecycle runtime composition', () => {
	it('wires configured maxSandboxes and portRange into constructor options', () => {
		let capturedContainerManagerOptions: unknown;
		let capturedPortAllocatorOptions: unknown;

		const fakeContainerManager = { kind: 'containerManager' } as any;
		const fakePortAllocator = { kind: 'portAllocator' } as any;

		const runtime = createSandboxLifecycleRuntime(
			{
				maxSandboxes: 42,
				portRange: { start: 15000, end: 15012 },
				cleanupOnStartup: true,
				staleTtlMs: 30_000,
			},
			{
				createContainerManager: (options) => {
					capturedContainerManagerOptions = options;
					return fakeContainerManager;
				},
				createPortAllocator: (options) => {
					capturedPortAllocatorOptions = options;
					return fakePortAllocator;
				},
			},
		);

		expect(capturedContainerManagerOptions).toEqual({ maxSandboxes: 42 });
		expect(capturedPortAllocatorOptions).toEqual({ rangeStart: 15000, rangeEnd: 15012 });
		expect(runtime.containerManager).toBe(fakeContainerManager);
		expect(runtime.portAllocator).toBe(fakePortAllocator);
		expect(runtime.lifecycleConfig.cleanupOnStartup).toBe(true);
		expect(runtime.lifecycleConfig.staleTtlMs).toBe(30_000);
	});

	it('uses default sandbox lifecycle settings when config is omitted', () => {
		let capturedContainerManagerOptions: unknown;
		let capturedPortAllocatorOptions: unknown;

		createSandboxLifecycleRuntime(undefined, {
			createContainerManager: (options) => {
				capturedContainerManagerOptions = options;
				return {} as any;
			},
			createPortAllocator: (options) => {
				capturedPortAllocatorOptions = options;
				return {} as any;
			},
		});

		expect(capturedContainerManagerOptions).toEqual({ maxSandboxes: 10 });
		expect(capturedPortAllocatorOptions).toEqual({ rangeStart: 13000, rangeEnd: 13099 });
	});

	it('builds deterministic startup snapshot with active sandbox filtering', () => {
		const snapshot = createSandboxStartupSnapshot([
			{ sandboxId: ' sb-a ', state: 'running' },
			{ sandboxId: 'sb-b', state: 'restarting' },
			{ sandboxId: 'sb-c', state: 'exited' },
			{ sandboxId: 'sb-a', state: 'running' },
			{ sandboxId: '', state: 'running' },
			{ sandboxId: '   ', state: 'running' },
		]);

		expect([...snapshot.knownSandboxIds]).toEqual(['sb-a', 'sb-b', 'sb-c']);
		expect([...snapshot.activeSandboxIds]).toEqual(['sb-a', 'sb-b']);
	});
});
