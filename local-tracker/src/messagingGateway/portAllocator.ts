import net from 'net';

export interface PortAllocatorOptions {
	/** Inclusive start of the port range. Default: 13000 */
	rangeStart?: number;
	/** Inclusive end of the port range. Default: 13099 */
	rangeEnd?: number;
	/**
	 * Optional availability probe override (primarily for deterministic unit tests).
	 * Default implementation performs a real TCP bind test.
	 */
	canBindTcpPort?: (port: number) => Promise<boolean>;
}

function assertValidPort(n: number, field: string): void {
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
		throw new Error(`[PortAllocator] Invalid ${field} (expected integer 1-65535)`);
	}
}

async function defaultCanBindTcpPort(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const server = net.createServer();
		server.unref();

		server.once('error', () => {
			resolve(false);
		});

		server.listen(port, () => {
			server.close(() => resolve(true));
		});
	});
}

/**
 * Host-side port allocator.
 *
 * - Scans within an inclusive port range.
 * - Verifies availability via a TCP bind test.
 * - Reserves allocated ports in-process to prevent duplicate allocations.
 */
export class PortAllocator {
	private readonly rangeStart: number;
	private readonly rangeEnd: number;
	private readonly canBindTcpPort: (port: number) => Promise<boolean>;
	private readonly reserved = new Set<number>();

	// Serialize allocations to avoid races between concurrent callers.
	private allocationLock: Promise<void> = Promise.resolve();

	constructor(options: PortAllocatorOptions = {}) {
		const start = options.rangeStart ?? 13_000;
		const end = options.rangeEnd ?? 13_099;
		assertValidPort(start, 'rangeStart');
		assertValidPort(end, 'rangeEnd');
		if (start > end) {
			throw new Error('[PortAllocator] Invalid port range (rangeStart must be <= rangeEnd)');
		}
		this.rangeStart = start;
		this.rangeEnd = end;
		this.canBindTcpPort = options.canBindTcpPort ?? defaultCanBindTcpPort;
	}

	async allocate(): Promise<number> {
		return await this.withAllocationLock(async () => {
			for (let port = this.rangeStart; port <= this.rangeEnd; port++) {
				if (this.reserved.has(port)) continue;
				if (!(await this.canBindTcpPort(port))) continue;

				this.reserved.add(port);
				return port;
			}

			throw new Error(
				`[PortAllocator] Exhausted port range ${this.rangeStart}-${this.rangeEnd} (no available ports)`,
			);
		});
	}

	release(port: number): void {
		assertValidPort(port, 'port');
		this.reserved.delete(port);
	}

	private async withAllocationLock<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.allocationLock;
		let releaseLock: (() => void) | undefined;
		this.allocationLock = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});

		await previous;
		try {
			return await fn();
		} finally {
			releaseLock?.();
		}
	}
}
