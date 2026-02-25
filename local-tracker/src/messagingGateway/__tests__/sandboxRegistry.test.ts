import type { BridgeClient, BridgeClientStatus, InvokeAgentParams, CancelSessionParams, ResolvePermissionParams } from '../bridgeClient';
import { SandboxRegistry, createSandboxEventRouter } from '../sandboxRegistry';
import type { SandboxEvent, SandboxStatusChange } from '../sandboxRegistry';

class FakeBridgeClient implements BridgeClient {
	private status: BridgeClientStatus = 'idle';
	started = false;
	stopped = false;
	stopShouldThrow = false;

	start(): void {
		this.started = true;
		this.status = 'connected';
	}

	async stop(): Promise<void> {
		if (this.stopShouldThrow) throw new Error('stop failed');
		this.stopped = true;
		this.status = 'stopped';
	}

	getStatus(): BridgeClientStatus {
		return this.status;
	}

	async get_sessions(): Promise<unknown> {
		return { sessions: [] };
	}

	async invoke_agent(_params: InvokeAgentParams): Promise<unknown> {
		return {};
	}

	async cancel_session(_params: CancelSessionParams): Promise<unknown> {
		return {};
	}

	async resolve_permission(_params: ResolvePermissionParams): Promise<unknown> {
		return {};
	}
}

describe('SandboxRegistry', () => {
	let registry: SandboxRegistry;

	beforeEach(() => {
		registry = new SandboxRegistry();
	});

	describe('register()', () => {
		it('adds a sandbox and returns entry with expected meta', () => {
			const client = new FakeBridgeClient();
			const entry = registry.register('sandbox-1', client, 9000);

			expect(entry.client).toBe(client);
			expect(entry.meta.sandboxId).toBe('sandbox-1');
			expect(entry.meta.hostPort).toBe(9000);
			expect(entry.meta.status).toBe('idle');
			expect(entry.meta.registeredAt).toBeTruthy();
			expect(registry.size).toBe(1);
		});

		it('throws if sandboxId already registered', () => {
			const client = new FakeBridgeClient();
			registry.register('sandbox-1', client, 9000);

			expect(() => registry.register('sandbox-1', new FakeBridgeClient(), 9001)).toThrow(
				"[SandboxRegistry] Sandbox 'sandbox-1' is already registered",
			);
		});

		it('throws for invalid sandboxId — empty string', () => {
			expect(() => registry.register('', new FakeBridgeClient(), 9000)).toThrow('Invalid sandboxId');
		});

		it('throws for invalid sandboxId — special characters', () => {
			expect(() => registry.register('sand box!', new FakeBridgeClient(), 9000)).toThrow('Invalid sandboxId');
		});

		it('throws for invalid sandboxId — starts with hyphen', () => {
			expect(() => registry.register('-sandbox', new FakeBridgeClient(), 9000)).toThrow('Invalid sandboxId');
		});

		it('getOrRegister() returns existing entry without creating a second client', () => {
			const firstClient = new FakeBridgeClient();
			const first = registry.getOrRegister('sandbox-1', () => firstClient, 9000);

			const createClient = jest.fn(() => new FakeBridgeClient());
			const second = registry.getOrRegister('sandbox-1', createClient, 9001);

			expect(first.created).toBe(true);
			expect(second.created).toBe(false);
			expect(second.entry).toBe(first.entry);
			expect(createClient).not.toHaveBeenCalled();
		});
	});

	describe('unregister()', () => {
		it('stops client and removes entry', async () => {
			const client = new FakeBridgeClient();
			registry.register('sandbox-1', client, 9000);

			const result = await registry.unregister('sandbox-1');

			expect(result).toBe(true);
			expect(client.stopped).toBe(true);
			expect(registry.size).toBe(0);
		});

		it('returns false for unknown sandboxId', async () => {
			const result = await registry.unregister('nonexistent');
			expect(result).toBe(false);
		});
	});

	describe('get()', () => {
		it('returns entry for registered sandbox', () => {
			const client = new FakeBridgeClient();
			registry.register('sandbox-1', client, 9000);

			const entry = registry.get('sandbox-1');
			expect(entry).toBeDefined();
			expect(entry!.client).toBe(client);
		});

		it('returns undefined for unknown sandbox', () => {
			expect(registry.get('nonexistent')).toBeUndefined();
		});
	});

	describe('getAll()', () => {
		it('returns all entries', () => {
			registry.register('sandbox-1', new FakeBridgeClient(), 9000);
			registry.register('sandbox-2', new FakeBridgeClient(), 9001);

			const all = registry.getAll();
			expect(all).toHaveLength(2);
			expect(all.map((e) => e.meta.sandboxId)).toEqual(expect.arrayContaining(['sandbox-1', 'sandbox-2']));
		});
	});

	describe('has()', () => {
		it('returns true for registered sandbox', () => {
			registry.register('sandbox-1', new FakeBridgeClient(), 9000);
			expect(registry.has('sandbox-1')).toBe(true);
		});

		it('returns false for unknown sandbox', () => {
			expect(registry.has('nonexistent')).toBe(false);
		});
	});

	describe('size', () => {
		it('returns count of registered sandboxes', () => {
			expect(registry.size).toBe(0);
			registry.register('sandbox-1', new FakeBridgeClient(), 9000);
			expect(registry.size).toBe(1);
			registry.register('sandbox-2', new FakeBridgeClient(), 9001);
			expect(registry.size).toBe(2);
		});
	});

	describe('dispatchEvent()', () => {
		it('calls onSandboxEvent with tagged event', () => {
			const events: SandboxEvent[] = [];
			registry = new SandboxRegistry({ onSandboxEvent: (e) => events.push(e) });
			registry.register('sandbox-1', new FakeBridgeClient(), 9000);

			registry.dispatchEvent('sandbox-1', { type: 'message', data: 'hello' });

			expect(events).toHaveLength(1);
			expect(events[0].sandboxId).toBe('sandbox-1');
			expect(events[0].event).toEqual({ type: 'message', data: 'hello' });
		});

		it('is silent for unknown sandboxId', () => {
			const events: SandboxEvent[] = [];
			registry = new SandboxRegistry({ onSandboxEvent: (e) => events.push(e) });

			registry.dispatchEvent('nonexistent', { type: 'message' });

			expect(events).toHaveLength(0);
		});
	});

	describe('updateStatus()', () => {
		it('updates meta and calls onSandboxStatusChanged', () => {
			const changes: SandboxStatusChange[] = [];
			registry = new SandboxRegistry({ onSandboxStatusChanged: (c) => changes.push(c) });

			const client = new FakeBridgeClient();
			registry.register('sandbox-1', client, 9000);

			registry.updateStatus('sandbox-1', 'connected');

			const entry = registry.get('sandbox-1');
			expect(entry!.meta.status).toBe('connected');
			expect(changes).toHaveLength(1);
			expect(changes[0]).toEqual({ sandboxId: 'sandbox-1', status: 'connected' });
		});

		it('does nothing for unknown sandboxId', () => {
			const changes: SandboxStatusChange[] = [];
			registry = new SandboxRegistry({ onSandboxStatusChanged: (c) => changes.push(c) });

			registry.updateStatus('nonexistent', 'connected');
			expect(changes).toHaveLength(0);
		});
	});

	describe('stopAll()', () => {
		it('stops all clients and clears registry', async () => {
			const client1 = new FakeBridgeClient();
			const client2 = new FakeBridgeClient();
			registry.register('sandbox-1', client1, 9000);
			registry.register('sandbox-2', client2, 9001);

			await registry.stopAll();

			expect(client1.stopped).toBe(true);
			expect(client2.stopped).toBe(true);
			expect(registry.size).toBe(0);
		});

		it('is best-effort — ignores stop failures', async () => {
			const client1 = new FakeBridgeClient();
			client1.stopShouldThrow = true;
			const client2 = new FakeBridgeClient();
			registry.register('sandbox-1', client1, 9000);
			registry.register('sandbox-2', client2, 9001);

			await expect(registry.stopAll()).resolves.toBeUndefined();

			expect(client2.stopped).toBe(true);
			expect(registry.size).toBe(0);
		});
	});
});

describe('createSandboxEventRouter()', () => {
	it('tags events with sandboxId and dispatches through registry', () => {
		const events: SandboxEvent[] = [];
		const registry = new SandboxRegistry({ onSandboxEvent: (e) => events.push(e) });
		registry.register('sandbox-1', new FakeBridgeClient(), 9000);

		const router = createSandboxEventRouter(registry, 'sandbox-1');
		router.onEvent({ type: 'message', data: 'hello' });

		expect(events).toHaveLength(1);
		expect(events[0].sandboxId).toBe('sandbox-1');
		expect(events[0].event).toEqual({ type: 'message', data: 'hello', sandboxId: 'sandbox-1' });
	});

	it('calls updateStatus on status change', () => {
		const changes: SandboxStatusChange[] = [];
		const registry = new SandboxRegistry({ onSandboxStatusChanged: (c) => changes.push(c) });
		registry.register('sandbox-1', new FakeBridgeClient(), 9000);

		const router = createSandboxEventRouter(registry, 'sandbox-1');
		router.onStatusChanged('connected');

		expect(changes).toHaveLength(1);
		expect(changes[0]).toEqual({ sandboxId: 'sandbox-1', status: 'connected' });

		const entry = registry.get('sandbox-1');
		expect(entry!.meta.status).toBe('connected');
	});

	it('adds sandboxId property to the event object', () => {
		const registry = new SandboxRegistry();
		registry.register('sandbox-1', new FakeBridgeClient(), 9000);

		const router = createSandboxEventRouter(registry, 'sandbox-1');
		const event: Record<string, unknown> = { type: 'test' };
		router.onEvent(event);

		expect(event.sandboxId).toBe('sandbox-1');
	});
});
