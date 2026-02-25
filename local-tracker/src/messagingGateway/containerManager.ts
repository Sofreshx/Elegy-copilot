import Docker from 'dockerode';

export interface ContainerManagerOptions {
	/** Docker image tag to run. Default: ie-copilot-cli-acp:latest */
	image?: string;
	/** Dependency injection for tests. Defaults to new Docker(). */
	docker?: Docker;
	/** Maximum concurrent sandboxes. Default: 10. Range: 1-100. */
	maxSandboxes?: number;
	/** Docker CPU quota (NanoCPUs). Default: 1e9 (1 CPU). 0 = no limit. */
	defaultCpuQuota?: number;
	/** Docker memory limit in bytes. Default: 512 * 1024 * 1024 (512 MB). 0 = no limit. */
	defaultMemoryBytes?: number;
}

export interface SandboxContainerInfo {
	containerId: string;
	name: string;
	sandboxId: string;
	hostPort: number;
	image?: string;
	state?: string;
	status?: string;
	created?: number;
	labels: Record<string, string>;
}

const DEFAULT_IMAGE = 'ie-copilot-cli-acp:latest';
const CONTAINER_PORT = 3000;
const CONTAINER_PORT_KEY = `${CONTAINER_PORT}/tcp`;

const LABEL_SANDBOX = 'ie.sandbox';
const LABEL_SANDBOX_ID = 'ie.sandbox.id';
const LABEL_SANDBOX_PORT = 'ie.sandbox.port';

function assertNonEmptyString(value: string, field: string): void {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`[ContainerManager] Invalid ${field} (expected non-empty string)`);
	}
}

function assertValidPort(n: number, field: string): void {
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
		throw new Error(`[ContainerManager] Invalid ${field} (expected integer 1-65535)`);
	}
}

function isDockerNotFoundError(err: unknown): boolean {
	const anyErr = err as { statusCode?: number; reason?: string; message?: string };
	return anyErr?.statusCode === 404 || /no such container/i.test(anyErr?.message || '') || /not found/i.test(anyErr?.reason || '');
}

function isDockerNotRunningError(err: unknown): boolean {
	const anyErr = err as { statusCode?: number; message?: string };
	// Docker returns 304 when the container is already stopped.
	return anyErr?.statusCode === 304 || /is not running/i.test(anyErr?.message || '');
}

function mapContainerInfo(info: Docker.ContainerInfo): SandboxContainerInfo {
	const labels = info.Labels || {};
	const sandboxId = labels[LABEL_SANDBOX_ID] || '';
	const hostPortRaw = labels[LABEL_SANDBOX_PORT] || '';
	const hostPort = Number(hostPortRaw);

	return {
		containerId: info.Id,
		name: (info.Names?.[0] || '').replace(/^\//, '') || info.Id,
		sandboxId,
		hostPort: Number.isFinite(hostPort) ? hostPort : 0,
		image: info.Image,
		state: info.State,
		status: info.Status,
		created: info.Created,
		labels,
	};
}

export class ContainerManager {
	private readonly docker: Docker;
	private readonly image: string;
	private readonly maxSandboxes: number;
	private readonly defaultCpuQuota: number;
	private readonly defaultMemoryBytes: number;

	constructor(options: ContainerManagerOptions = {}) {
		this.docker = options.docker ?? new Docker();
		this.image = (options.image || DEFAULT_IMAGE).trim() || DEFAULT_IMAGE;
		this.maxSandboxes = Math.max(1, Math.min(100, options.maxSandboxes ?? 10));
		this.defaultCpuQuota = options.defaultCpuQuota ?? 1e9;
		this.defaultMemoryBytes = options.defaultMemoryBytes ?? 512 * 1024 * 1024;
	}

	getContainerName(sandboxId: string): string {
		assertNonEmptyString(sandboxId, 'sandboxId');
		return `ie-sandbox-${sandboxId}`;
	}

	async spawn(sandboxId: string, hostPort: number): Promise<SandboxContainerInfo> {
		assertNonEmptyString(sandboxId, 'sandboxId');
		assertValidPort(hostPort, 'hostPort');

		const current = await this.list();
		if (current.length >= this.maxSandboxes) {
			throw new Error(`[ContainerManager] Max sandboxes reached (${this.maxSandboxes}). Stop an existing sandbox before spawning a new one.`);
		}

		const name = this.getContainerName(sandboxId);
		const labels: Record<string, string> = {
			[LABEL_SANDBOX]: 'true',
			[LABEL_SANDBOX_ID]: sandboxId,
			[LABEL_SANDBOX_PORT]: String(hostPort),
		};

		const env = this.buildContainerEnv();

		const createOptions: Docker.ContainerCreateOptions = {
			name,
			Image: this.image,
			Labels: labels,
			Env: env,
			ExposedPorts: {
				[CONTAINER_PORT_KEY]: {},
			},
			HostConfig: {
				PortBindings: {
					// Security: bind ACP to loopback on the host. Never publish to 0.0.0.0 by default.
					[CONTAINER_PORT_KEY]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }],
				},
				...(this.defaultCpuQuota > 0 ? { NanoCpus: this.defaultCpuQuota } : {}),
				...(this.defaultMemoryBytes > 0 ? { Memory: this.defaultMemoryBytes } : {}),
			},
		};

		let container: Docker.Container;
		try {
			container = await this.docker.createContainer(createOptions);
		} catch (err) {
			// If a previous run left a container with the same name, clean it up and retry once.
			const anyErr = err as { statusCode?: number; message?: string };
			if (anyErr?.statusCode === 409 && /already in use/i.test(anyErr?.message || '')) {
				// First try the label-based cleanup.
				await this.stop(sandboxId);
				// If the conflicting container is missing labels, stop() can't find it.
				// Best-effort: remove by exact name before retry.
				try {
					await this.docker.getContainer(name).remove({ force: true });
				} catch {
					// ignore
				}
				container = await this.docker.createContainer(createOptions);
			} else {
				throw err;
			}
		}

		try {
			await container.start();
		} catch (err) {
			// Best-effort cleanup if start fails.
			try {
				await container.remove({ force: true });
			} catch {
				// ignore
			}
			throw err;
		}

		const info = await this.get(sandboxId);
		if (!info) {
			// Fallback: inspect the container we just started.
			const inspected = await container.inspect();
			return {
				containerId: inspected.Id,
				name: (inspected.Name || '').replace(/^\//, '') || name,
				sandboxId,
				hostPort,
				image: inspected.Config?.Image,
				state: inspected.State?.Status,
				status: inspected.State?.Status,
				created: inspected.Created ? Math.floor(Date.parse(inspected.Created) / 1000) : undefined,
				labels,
			};
		}

		return info;
	}

	/**
	 * Idempotent helper for lifecycle operations.
	 * Returns existing sandbox container when present, otherwise spawns a new one.
	 */
	async getOrSpawn(sandboxId: string, hostPort: number): Promise<{ info: SandboxContainerInfo; created: boolean }> {
		const existing = await this.get(sandboxId);
		if (existing) {
			return { info: existing, created: false };
		}

		const created = await this.spawn(sandboxId, hostPort);
		return { info: created, created: true };
	}

	async stop(sandboxId: string): Promise<boolean> {
		assertNonEmptyString(sandboxId, 'sandboxId');
		const info = await this.get(sandboxId);
		if (!info) return false;

		const container = this.docker.getContainer(info.containerId);
		try {
			await container.stop({ t: 10 });
		} catch (err) {
			if (!isDockerNotRunningError(err) && !isDockerNotFoundError(err)) throw err;
		}

		try {
			await container.remove({ force: true });
		} catch (err) {
			if (!isDockerNotFoundError(err)) throw err;
		}

		return true;
	}

	async stopAll(): Promise<void> {
		const containers = await this.list();
		await Promise.all(
			containers.map(async (c) => {
				try {
					await this.stop(c.sandboxId);
				} catch {
					// Best-effort cleanup: ignore per-container failures.
				}
			}),
		);
	}

	/**
	 * Best-effort cleanup for orphaned sandbox containers.
	 *
	 * Safety: only targets containers with label `ie.sandbox=true`.
	 * Errors are logged and never thrown.
	 */
	async reconcile(): Promise<void> {
		let infos: Docker.ContainerInfo[];
		try {
			infos = await this.docker.listContainers({
				all: true,
				filters: {
					label: [`${LABEL_SANDBOX}=true`],
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[ContainerManager] reconcile() listContainers failed: ${message}`);
			return;
		}

		await Promise.all(
			infos.map(async (info) => {
				const name = (info.Names?.[0] || '').replace(/^\//, '') || info.Id;

				let container: Docker.Container;
				try {
					container = this.docker.getContainer(info.Id);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`[ContainerManager] reconcile() getContainer failed: id=${info.Id} name=${name} err=${message}`);
					return;
				}

				try {
					await container.stop({ t: 10 });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`[ContainerManager] reconcile() stop failed: id=${info.Id} name=${name} err=${message}`);
				}

				try {
					await container.remove({ force: true });
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`[ContainerManager] reconcile() remove failed: id=${info.Id} name=${name} err=${message}`);
				}
			}),
		);
	}

	async list(): Promise<SandboxContainerInfo[]> {
		const infos = await this.docker.listContainers({
			all: true,
			filters: {
				label: [`${LABEL_SANDBOX}=true`],
			},
		});
		return infos.map(mapContainerInfo);
	}

	async get(sandboxId: string): Promise<SandboxContainerInfo | null> {
		assertNonEmptyString(sandboxId, 'sandboxId');

		const infos = await this.docker.listContainers({
			all: true,
			filters: {
				label: [`${LABEL_SANDBOX}=true`, `${LABEL_SANDBOX_ID}=${sandboxId}`],
			},
		});

		if (infos.length === 0) return null;
		if (infos.length > 1) {
			throw new Error(`[ContainerManager] Multiple sandbox containers found for sandboxId=${sandboxId}`);
		}

		return mapContainerInfo(infos[0]);
	}

	private buildContainerEnv(): string[] {
		return [
			'HOME=/home/copilot',
			`ACP_PORT=${CONTAINER_PORT}`,
		];
	}
}
