import { EventEmitter } from 'events';
import WebSocket, { WebSocketServer } from 'ws';

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

export type JsonRpcResponse =
	| {
			jsonrpc: '2.0';
			id: string;
			result: unknown;
	  }
	| {
			jsonrpc: '2.0';
			id: string;
			error: { code: number; message: string; data?: unknown };
	  };

export type RequestHandlerResult =
	| { kind: 'result'; result: unknown }
	| { kind: 'error'; code: number; message: string; data?: unknown }
	| { kind: 'no_response' };

export type RequestHandler = (req: JsonRpcRequest) => RequestHandlerResult | Promise<RequestHandlerResult>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (!isRecord(value)) return false;
	if (value.jsonrpc !== '2.0') return false;
	if (typeof value.id !== 'string') return false;
	if (typeof value.method !== 'string') return false;
	return true;
}

export class FakeJsonRpcWsServer {
	private readonly emitter = new EventEmitter();
	private readonly wss: WebSocketServer;
	private readonly sockets = new Set<WebSocket>();
	private readonly requestSocketById = new Map<string, WebSocket>();
	private readonly handlers = new Map<string, RequestHandler>();

	readonly requests: JsonRpcRequest[] = [];
	readonly notifications: JsonRpcNotification[] = [];

	private constructor(wss: WebSocketServer) {
		this.wss = wss;

		this.wss.on('connection', (socket) => {
			this.sockets.add(socket);
			socket.on('close', () => this.sockets.delete(socket));
			socket.on('message', (data) => {
				this.handleMessage(socket, data.toString());
			});
		});
	}

	static async start(): Promise<FakeJsonRpcWsServer> {
		const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
		await new Promise<void>((resolve, reject) => {
			wss.once('listening', () => resolve());
			wss.once('error', (err) => reject(err));
		});
		return new FakeJsonRpcWsServer(wss);
	}

	getPort(): number {
		const addr = this.wss.address();
		if (typeof addr === 'string' || addr === null) return 0;
		return addr.port;
	}

	setHandler(method: string, handler: RequestHandler): void {
		this.handlers.set(method, handler);
	}

	sendNotification(method: string, params?: Record<string, unknown>): void {
		const msg: JsonRpcNotification = { jsonrpc: '2.0', method };
		if (params !== undefined) msg.params = params;
		const payload = JSON.stringify(msg);
		for (const socket of this.sockets) {
			if (socket.readyState === WebSocket.OPEN) socket.send(payload);
		}
	}

	sendResponse(id: string, result: unknown): void {
		const socket = this.requestSocketById.get(id);
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result };
		socket.send(JSON.stringify(msg));
	}

	sendError(id: string, code: number, message: string, data?: unknown): void {
		const socket = this.requestSocketById.get(id);
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		const msg: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message, data } };
		socket.send(JSON.stringify(msg));
	}

	async waitForRequest(
		predicate: (req: JsonRpcRequest) => boolean,
		options: { timeoutMs?: number } = {},
	): Promise<JsonRpcRequest> {
		const existing = this.requests.find(predicate);
		if (existing) return existing;

		const timeoutMs = options.timeoutMs ?? 1_000;
		return await new Promise<JsonRpcRequest>((resolve, reject) => {
			const onReq = (req: JsonRpcRequest) => {
				if (!predicate(req)) return;
				cleanup();
				resolve(req);
			};

			const t = setTimeout(() => {
				cleanup();
				reject(new Error(`[TestHarness] Timed out waiting for request (${timeoutMs}ms)`));
			}, timeoutMs);

			const cleanup = () => {
				clearTimeout(t);
				this.emitter.removeListener('request', onReq);
			};

			this.emitter.on('request', onReq);
		});
	}

	async close(): Promise<void> {
		for (const socket of this.sockets) {
			try {
				socket.close();
			} catch {
				// ignore
			}
			try {
				// Ensure we don't leave open handles if the graceful close doesn't complete quickly.
				socket.terminate();
			} catch {
				// ignore
			}
		}
		this.sockets.clear();
		this.requestSocketById.clear();
		this.handlers.clear();

		await new Promise<void>((resolve) => {
			this.wss.close(() => resolve());
		});
	}

	private handleMessage(socket: WebSocket, raw: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return;
		}

		if (!isRecord(parsed)) return;

		// Requests
		if (isJsonRpcRequest(parsed)) {
			this.requests.push(parsed);
			this.requestSocketById.set(parsed.id, socket);
			this.emitter.emit('request', parsed);

			const handler = this.handlers.get(parsed.method);
			if (!handler) return;

			void Promise.resolve(handler(parsed))
				.then((result) => {
				if (result.kind === 'no_response') return;
				if (result.kind === 'error') {
					this.sendError(parsed.id, result.code, result.message, result.data);
					return;
				}
				this.sendResponse(parsed.id, result.result);
			})
				.catch((err: unknown) => {
					const message = err instanceof Error ? err.message : String(err);
					this.sendError(parsed.id, -32000, message);
				});
			return;
		}

		// Notifications (best-effort capture; not needed for current tests)
		if (parsed.jsonrpc === '2.0' && typeof parsed.method === 'string' && parsed.id === undefined) {
			const notif: JsonRpcNotification = {
				jsonrpc: '2.0',
				method: parsed.method,
				params: isRecord(parsed.params) ? parsed.params : undefined,
			};
			this.notifications.push(notif);
			this.emitter.emit('notification', notif);
		}
	}
}
