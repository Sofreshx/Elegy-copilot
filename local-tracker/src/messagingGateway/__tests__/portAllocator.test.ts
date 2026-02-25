import { PortAllocator } from '../portAllocator';

function createDeterministicAllocator(rangeStart: number, rangeEnd: number, unavailable = new Set<number>()) {
	return new PortAllocator({
		rangeStart,
		rangeEnd,
		canBindTcpPort: async (port: number) => !unavailable.has(port),
	});
}

describe('PortAllocator', () => {
	it('validates constructor port range boundaries', () => {
		expect(() => new PortAllocator({ rangeStart: 0, rangeEnd: 13001 })).toThrow(
			'[PortAllocator] Invalid rangeStart (expected integer 1-65535)',
		);
		expect(() => new PortAllocator({ rangeStart: 13000, rangeEnd: 70000 })).toThrow(
			'[PortAllocator] Invalid rangeEnd (expected integer 1-65535)',
		);
		expect(() => new PortAllocator({ rangeStart: 14000, rangeEnd: 13000 })).toThrow(
			'[PortAllocator] Invalid port range (rangeStart must be <= rangeEnd)',
		);
	});

	it('allocates an available port and reserves it in-process', async () => {
		const start = 13_000;
		const end = 13_002;
		const allocator = createDeterministicAllocator(start, end);

		const p1 = await allocator.allocate();
		const p2 = await allocator.allocate();
		expect(p1).toBe(start);
		expect(p2).toBe(start + 1);

		allocator.release(p1);
		const p3 = await allocator.allocate();
		expect(p3).toBe(start);
	});

	it('serializes concurrent allocations to avoid returning the same port twice', async () => {
		const start = 13_100;
		const end = 13_103;
		const allocator = createDeterministicAllocator(start, end);

		const [p1, p2, p3] = await Promise.all([
			allocator.allocate(),
			allocator.allocate(),
			allocator.allocate(),
		]);

		expect(new Set([p1, p2, p3]).size).toBe(3);
		expect(p1).toBeGreaterThanOrEqual(start);
		expect(p1).toBeLessThanOrEqual(end);
		expect(p2).toBeGreaterThanOrEqual(start);
		expect(p2).toBeLessThanOrEqual(end);
		expect(p3).toBeGreaterThanOrEqual(start);
		expect(p3).toBeLessThanOrEqual(end);
	});

	it('skips ports that are not available (in use by another listener)', async () => {
		const start = 13_200;
		const end = 13_202;
		const unavailable = new Set([start]);
		const allocator = createDeterministicAllocator(start, end, unavailable);
		const allocated = await allocator.allocate();
		expect(allocated).toBe(start + 1);
	});

	it('throws a clear error when the range is exhausted', async () => {
		const start = 13_300;
		const end = 13_301;
		const unavailable = new Set([start, end]);
		const allocator = createDeterministicAllocator(start, end, unavailable);
		await expect(allocator.allocate()).rejects.toThrow(
			`[PortAllocator] Exhausted port range ${start}-${end} (no available ports)`,
		);
	});
});
