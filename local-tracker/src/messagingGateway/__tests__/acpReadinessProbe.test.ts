import net from 'net';

import { SandboxReadinessFailed, waitForAcpReadiness } from '../acpReadinessProbe';

function startNdjsonJsonRpcServer(options: {
	handler: (req: any, ctx: { connection: number; request: number }) => any | undefined;
}): Promise<{ host: string; port: number; close: () => Promise<void>; getCounts: () => { connections: number; requests: number } }> {
	return new Promise((resolve, reject) => {
		let connections = 0;
		let requests = 0;
		const sockets = new Set<net.Socket>();

		const server = net.createServer((socket) => {
			connections++;
			sockets.add(socket);
			socket.setNoDelay(true);
			let buffer = '';
			socket.on('close', () => sockets.delete(socket));
			socket.on('data', (chunk) => {
				buffer += chunk.toString('utf8');
				while (true) {
					const idx = buffer.indexOf('\n');
					if (idx < 0) break;
					const line = buffer.slice(0, idx).trim();
					buffer = buffer.slice(idx + 1);
					if (!line) continue;
					let parsed: any;
					try {
						parsed = JSON.parse(line);
					} catch {
						continue;
					}

					requests++;
					const resp = options.handler(parsed, { connection: connections, request: requests });
					if (resp !== undefined) {
						socket.write(`${JSON.stringify(resp)}\n`, 'utf8');
					}
				}
			});
		});

		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address();
			if (!addr || typeof addr === 'string') {
				reject(new Error('Failed to get server address'));
				return;
			}

			resolve({
				host: '127.0.0.1',
				port: addr.port,
				getCounts: () => ({ connections, requests }),
				close: async () => {
					for (const s of sockets) {
						try {
							s.destroy();
						} catch {
							// ignore
						}
					}
					await new Promise<void>((r) => server.close(() => r()));
				},
			});
		});
	});
}

describe('waitForAcpReadiness', () => {
	it('succeeds when the server responds to initialize with a JSON-RPC success response', async () => {
		const server = await startNdjsonJsonRpcServer({
			handler: (req) => {
				if (req?.method !== 'initialize') return undefined;
				return { jsonrpc: '2.0', id: 1, result: { ok: true } };
			},
		});

		await expect(
			waitForAcpReadiness({ host: server.host, port: server.port, timeoutMs: 1000 }),
		).resolves.toBeUndefined();

		await server.close();
	});

	it('retries with backoff when initialize returns an error, then succeeds', async () => {
		let call = 0;
		const server = await startNdjsonJsonRpcServer({
			handler: (req) => {
				if (req?.method !== 'initialize') return undefined;
				call++;
				if (call === 1) {
					return { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'not ready' } };
				}
				return { jsonrpc: '2.0', id: 1, result: {} };
			},
		});

		await expect(
			waitForAcpReadiness({ host: server.host, port: server.port, timeoutMs: 2000 }),
		).resolves.toBeUndefined();

		expect(call).toBeGreaterThanOrEqual(2);
		await server.close();
	});

	it('throws SandboxReadinessFailed when the server accepts connections but never responds', async () => {
		const server = await startNdjsonJsonRpcServer({
			handler: () => undefined,
		});

		await expect(
			waitForAcpReadiness({ host: server.host, port: server.port, timeoutMs: 300 }),
		).rejects.toBeInstanceOf(SandboxReadinessFailed);

		await server.close();
	});
});
