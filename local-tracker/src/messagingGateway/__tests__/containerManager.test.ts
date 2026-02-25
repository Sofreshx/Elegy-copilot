import type Docker from 'dockerode';

import { ContainerManager } from '../containerManager';

type ContainerCreateOptions = Docker.ContainerCreateOptions & { name?: string };

type ContainerInfo = Docker.ContainerInfo;

class FakeContainer {
	readonly id: string;
	readonly name: string;
	readonly image: string;
	readonly labels: Record<string, string>;
	readonly env: string[];
	started = false;
	stopped = false;
	removed = false;
	stopCalls = 0;
	removeCalls = 0;

	constructor(args: { id: string; name: string; image: string; labels: Record<string, string>; env: string[] }) {
		this.id = args.id;
		this.name = args.name;
		this.image = args.image;
		this.labels = args.labels;
		this.env = args.env;
	}

	async start(): Promise<void> {
		this.started = true;
	}

	async stop(): Promise<void> {
		this.stopCalls++;
		this.stopped = true;
	}

	async remove(): Promise<void> {
		this.removeCalls++;
		this.removed = true;
	}

	async inspect(): Promise<any> {
		return {
			Id: this.id,
			Name: `/${this.name}`,
			Created: new Date().toISOString(),
			Config: {
				Image: this.image,
				Labels: this.labels,
				Env: this.env,
			},
			State: {
				Status: this.started && !this.removed ? 'running' : 'created',
			},
		};
	}
}

class FakeDocker {
	created: ContainerCreateOptions[] = [];
	private nextId = 1;
	private readonly containersById = new Map<string, FakeContainer>();
	private readonly containersByName = new Map<string, FakeContainer>();

	async createContainer(options: ContainerCreateOptions): Promise<any> {
		this.created.push(options);
		const name = options.name || '';
		if (name && this.containersByName.has(name)) {
			const err: any = new Error(`Conflict. The container name "/${name}" is already in use.`);
			err.statusCode = 409;
			throw err;
		}

		const id = `fake-${this.nextId++}`;
		const container = new FakeContainer({
			id,
			name,
			image: options.Image || 'unknown',
			labels: (options.Labels as any) || {},
			env: (options.Env as any) || [],
		});

		this.containersById.set(id, container);
		if (name) this.containersByName.set(name, container);
		return container;
	}

	getContainer(id: string): any {
		const byId = this.containersById.get(id);
		if (byId) return byId;
		const byName = this.containersByName.get(id);
		if (byName) return byName;

		const err: any = new Error('No such container');
		err.statusCode = 404;
		throw err;
	}

	async listContainers(options: any): Promise<ContainerInfo[]> {
		const filterLabels: string[] = options?.filters?.label || [];

		const matches = (labels: Record<string, string>): boolean => {
			for (const raw of filterLabels) {
				if (raw.includes('=')) {
					const [k, v] = raw.split('=');
					if (labels[k] !== v) return false;
				} else {
					if (labels[raw] === undefined) return false;
				}
			}
			return true;
		};

		const out: ContainerInfo[] = [];
		for (const c of this.containersById.values()) {
			if (c.removed) continue;
			if (filterLabels.length > 0 && !matches(c.labels)) continue;

			out.push({
				Id: c.id,
				Names: [`/${c.name}`],
				Image: c.image,
				ImageID: 'fake-image-id',
				Command: 'fake-cmd',
				Created: Date.now(),
				State: c.started ? 'running' : 'created',
				Status: c.started ? 'Up' : 'Created',
				Ports: [],
				Labels: c.labels,
				SizeRw: 0,
				SizeRootFs: 0,
				HostConfig: { NetworkMode: 'default' },
				NetworkSettings: { Networks: {} },
				Mounts: [],
			} as any);
		}

		return out;
	}
}

describe('ContainerManager', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.GH_TOKEN;
		delete process.env.GITHUB_TOKEN;
		delete process.env.COPILOT_GITHUB_TOKEN;
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it('spawn() creates a labeled container with correct name, port binding, and host-safe env', async () => {
		process.env.GH_TOKEN = 'ghp_test_should_not_leak';
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker, image: 'my-image:tag' });

		const info = await mgr.spawn('abc-123', 13001);

		expect(info.sandboxId).toBe('abc-123');
		expect(info.hostPort).toBe(13001);
		expect(info.name).toBe('ie-sandbox-abc-123');

		expect(docker.created).toHaveLength(1);
		const opts = docker.created[0];
		expect(opts.name).toBe('ie-sandbox-abc-123');
		expect(opts.Image).toBe('my-image:tag');
		expect(opts.Labels).toMatchObject({
			'ie.sandbox': 'true',
			'ie.sandbox.id': 'abc-123',
			'ie.sandbox.port': '13001',
		});

		expect(opts.ExposedPorts).toMatchObject({ '3000/tcp': {} });
		expect(opts.HostConfig?.PortBindings).toMatchObject({
			'3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '13001' }],
		});

		expect(opts.Env).toEqual(['HOME=/home/copilot', 'ACP_PORT=3000']);
		expect(opts.Env).toEqual(expect.not.arrayContaining([expect.stringMatching(/^GH_TOKEN=/)]));
		expect(opts.Env).toEqual(expect.not.arrayContaining([expect.stringMatching(/^GITHUB_TOKEN=/)]));
		expect(opts.Env).toEqual(expect.not.arrayContaining([expect.stringMatching(/^COPILOT_GITHUB_TOKEN=/)]));
	});

	it('get() returns null when no container exists for sandboxId', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await expect(mgr.get('missing')).resolves.toBeNull();
	});

	it('getOrSpawn() is idempotent for existing sandbox container', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		const first = await mgr.getOrSpawn('g1', 13001);
		const second = await mgr.getOrSpawn('g1', 13001);

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		expect(second.info.containerId).toBe(first.info.containerId);
		expect(docker.created).toHaveLength(1);
	});

	it('list() returns only ie.sandbox=true containers', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await mgr.spawn('s1', 13001);
		// Add an unlabeled container directly.
		await docker.createContainer({
			name: 'not-a-sandbox',
			Image: 'x',
			Labels: { other: '1' },
			Env: [],
		} as any);

		const all = await mgr.list();
		expect(all.map((c) => c.sandboxId)).toEqual(['s1']);
	});

	it('stop() stops+removes a sandbox container and returns true', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await mgr.spawn('s1', 13001);
		const didStop = await mgr.stop('s1');

		expect(didStop).toBe(true);
		expect(await mgr.get('s1')).toBeNull();
	});

	it('stop() returns false when no sandbox container exists', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await expect(mgr.stop('missing')).resolves.toBe(false);
	});

	it('stopAll() best-effort stops all sandbox containers', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await mgr.spawn('s1', 13001);
		await mgr.spawn('s2', 13002);

		// Force one container to throw on remove.
		const s2 = await mgr.get('s2');
		expect(s2).not.toBeNull();
		const c2 = docker.getContainer(s2!.containerId) as FakeContainer;
		c2.remove = async () => {
			throw new Error('remove failed');
		};

		await expect(mgr.stopAll()).resolves.toBeUndefined();

		// s1 should still be gone even though s2 failed.
		expect(await mgr.get('s1')).toBeNull();
	});

	it('spawn() applies CPU and memory limits to HostConfig', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({
			docker: docker as unknown as Docker,
			defaultCpuQuota: 2e9,
			defaultMemoryBytes: 1024 * 1024 * 1024,
		});

		await mgr.spawn('res-1', 13001);

		const opts = docker.created[0];
		expect(opts.HostConfig?.NanoCpus).toBe(2e9);
		expect(opts.HostConfig?.Memory).toBe(1024 * 1024 * 1024);
	});

	it('spawn() uses defaults when no limits specified', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		await mgr.spawn('def-1', 13001);

		const opts = docker.created[0];
		expect(opts.HostConfig?.NanoCpus).toBe(1e9);
		expect(opts.HostConfig?.Memory).toBe(512 * 1024 * 1024);
	});

	it('spawn() omits resource limits when set to 0', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({
			docker: docker as unknown as Docker,
			defaultCpuQuota: 0,
			defaultMemoryBytes: 0,
		});

		await mgr.spawn('nolim-1', 13001);

		const opts = docker.created[0];
		expect(opts.HostConfig?.NanoCpus).toBeUndefined();
		expect(opts.HostConfig?.Memory).toBeUndefined();
	});

	it('spawn() throws when max sandboxes reached', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({
			docker: docker as unknown as Docker,
			maxSandboxes: 2,
		});

		await mgr.spawn('s1', 13001);
		await mgr.spawn('s2', 13002);

		await expect(mgr.spawn('s3', 13003)).rejects.toThrow('Max sandboxes reached');
	});

	it('spawn() enforces maxSandboxes clamped to 1-100', async () => {
		// maxSandboxes: 0 should clamp to 1
		const docker1 = new FakeDocker();
		const mgr1 = new ContainerManager({
			docker: docker1 as unknown as Docker,
			maxSandboxes: 0,
		});

		await mgr1.spawn('only-1', 13001);
		await expect(mgr1.spawn('too-many', 13002)).rejects.toThrow('Max sandboxes reached');

		// maxSandboxes: 200 should clamp to 100
		const docker2 = new FakeDocker();
		const mgr2 = new ContainerManager({
			docker: docker2 as unknown as Docker,
			maxSandboxes: 200,
		});

		// Verify we can spawn more than the original 10 default
		for (let i = 0; i < 100; i++) {
			await mgr2.spawn(`s-${i}`, 14000 + i);
		}
		await expect(mgr2.spawn('s-overflow', 14100)).rejects.toThrow('Max sandboxes reached');
	});

	it('reconcile() targets only ie.sandbox=true containers', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		const sandbox = (await docker.createContainer({
			name: 'sandbox-orphan',
			Image: 'x',
			Labels: { 'ie.sandbox': 'true' },
			Env: [],
		} as any)) as FakeContainer;

		const other = (await docker.createContainer({
			name: 'not-a-sandbox',
			Image: 'x',
			Labels: { other: '1' },
			Env: [],
		} as any)) as FakeContainer;

		await mgr.reconcile();

		expect(sandbox.stopCalls).toBe(1);
		expect(sandbox.removeCalls).toBe(1);

		expect(other.stopCalls).toBe(0);
		expect(other.removeCalls).toBe(0);
	});

	it('reconcile() attempts stop+remove for labeled containers', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		const c = (await docker.createContainer({
			name: 'sandbox-orphan',
			Image: 'x',
			Labels: { 'ie.sandbox': 'true' },
			Env: [],
		} as any)) as FakeContainer;

		await mgr.reconcile();

		expect(c.stopCalls).toBe(1);
		expect(c.removeCalls).toBe(1);
	});

	it('reconcile() does not throw if a stop/remove fails (best-effort)', async () => {
		const docker = new FakeDocker();
		const mgr = new ContainerManager({ docker: docker as unknown as Docker });

		const stopFails = (await docker.createContainer({
			name: 'sandbox-stop-fails',
			Image: 'x',
			Labels: { 'ie.sandbox': 'true' },
			Env: [],
		} as any)) as FakeContainer;

		const removeFails = (await docker.createContainer({
			name: 'sandbox-remove-fails',
			Image: 'x',
			Labels: { 'ie.sandbox': 'true' },
			Env: [],
		} as any)) as FakeContainer;

		stopFails.stop = async () => {
			stopFails.stopCalls++;
			throw new Error('stop failed');
		};

		removeFails.remove = async () => {
			removeFails.removeCalls++;
			throw new Error('remove failed');
		};

		await expect(mgr.reconcile()).resolves.toBeUndefined();

		// even if stop fails, we should still attempt a remove
		expect(stopFails.stopCalls).toBe(1);
		expect(stopFails.removeCalls).toBe(1);

		// remove failure should not prevent stop from being attempted
		expect(removeFails.stopCalls).toBe(1);
		expect(removeFails.removeCalls).toBe(1);
	});
});
