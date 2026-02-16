import { ExtensionBridgeClient } from '../extensionBridgeClient';
import { FakeJsonRpcWsServer } from './fakeJsonRpcWsServer';

describe('ExtensionBridgeClient', () => {
	it('subscribes to events on connect (subscribe_events)', async () => {
		const server = await FakeJsonRpcWsServer.start();
		server.setHandler('subscribe_events', () => ({ kind: 'result', result: { subscribed: true } }));
		server.setHandler('pong', () => ({ kind: 'result', result: { ok: true } }));

		const client = new ExtensionBridgeClient({
			resolvePort: () => server.getPort(),
			getJwt: () => 'test-jwt',
			requestTimeoutMs: 1_000,
		});

		try {
			client.start();
			const req = await server.waitForRequest((r) => r.method === 'subscribe_events');
			expect(req.jsonrpc).toBe('2.0');
			expect(typeof req.id).toBe('string');
		} finally {
			await client.stop();
			await server.close();
		}
	});

	it('responds to ping notification by issuing a pong request (with id)', async () => {
		const server = await FakeJsonRpcWsServer.start();
		server.setHandler('subscribe_events', () => ({ kind: 'result', result: { subscribed: true } }));
		server.setHandler('pong', () => ({ kind: 'result', result: { ok: true } }));

		const client = new ExtensionBridgeClient({
			resolvePort: () => server.getPort(),
			getJwt: () => 'test-jwt',
			requestTimeoutMs: 1_000,
		});

		try {
			client.start();
			await server.waitForRequest((r) => r.method === 'subscribe_events');

			server.sendNotification('ping');
			const pongReq = await server.waitForRequest((r) => r.method === 'pong');
			expect(typeof pongReq.id).toBe('string');
			expect(pongReq.params).toBeDefined();
			expect(typeof pongReq.params?.timestamp).toBe('number');
		} finally {
			await client.stop();
			await server.close();
		}
	});

	it('correlates request/response by id even when responses arrive out-of-order', async () => {
		const server = await FakeJsonRpcWsServer.start();
		server.setHandler('subscribe_events', () => ({ kind: 'result', result: { subscribed: true } }));
		server.setHandler('pong', () => ({ kind: 'result', result: { ok: true } }));

		const client = new ExtensionBridgeClient({
			resolvePort: () => server.getPort(),
			getJwt: () => 'test-jwt',
			requestTimeoutMs: 1_000,
		});

		try {
			client.start();
			await server.waitForRequest((r) => r.method === 'subscribe_events');

			const pStatus = client.get_status();
			const pAgents = client.list_agents();

			const rStatus = await server.waitForRequest((r) => r.method === 'get_status');
			const rAgents = await server.waitForRequest((r) => r.method === 'list_agents');

			// Respond out-of-order
			server.sendResponse(rAgents.id, { agents: ['a1', 'a2'] });
			server.sendResponse(rStatus.id, { status: 'ok' });

			await expect(pStatus).resolves.toEqual({ status: 'ok' });
			await expect(pAgents).resolves.toEqual({ agents: ['a1', 'a2'] });
		} finally {
			await client.stop();
			await server.close();
		}
	});
});
