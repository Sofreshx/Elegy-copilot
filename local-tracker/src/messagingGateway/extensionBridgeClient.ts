import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import crypto from 'crypto';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
	jsonrpc: '2.0';
	id: string;
	result: unknown;
}

interface JsonRpcErrorObject {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: '2.0';
	id: string;
	error: JsonRpcErrorObject;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
	if (!isRecord(value)) return false;
	return value.jsonrpc === '2.0' && typeof value.method === 'string' && value.id === undefined;
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	if (!isRecord(value)) return false;
	if (value.jsonrpc !== '2.0') return false;
	if (typeof value.id !== 'string') return false;
	return value.result !== undefined || value.error !== undefined;
}

export type InvokeAgentParams = Record<string, unknown> & {
	agentName: string;
	prompt: string;
};

export type CancelSessionParams = Record<string, unknown> & {
	sessionId: string;
};

export type ResolvePermissionParams = Record<string, unknown> & {
	callbackId: string;
	approved: boolean;
	resolvedBy?: string;
};

export type SubscribeEventsParams = Record<string, unknown> & {
	events?: string[];
	eventTypes?: string[];
	sessionIds?: string[];
};

export type UnsubscribeEventsParams = SubscribeEventsParams;

export type ExtensionBridgeClientStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'auth_failed' | 'failed' | 'stopped';

export interface ExtensionBridgeClientOptions {
	resolvePort: () => number;
	getJwt: () => string;
	onEvent?: (event: unknown) => void;
	onStatusChanged?: (status: ExtensionBridgeClientStatus) => void;
	maxReconnectAttempts?: number;
	baseReconnectDelayMs?: number;
	maxReconnectDelayMs?: number;
	requestTimeoutMs?: number;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timeout: NodeJS.Timeout;
}

export class ExtensionBridgeClient {
	private readonly resolvePort: () => number;
	private readonly getJwt: () => string;
	private readonly onEvent: ((event: unknown) => void) | undefined;
	private readonly onStatusChanged: ((status: ExtensionBridgeClientStatus) => void) | undefined;
	private readonly maxReconnectAttempts: number;
	private readonly baseReconnectDelayMs: number;
	private readonly maxReconnectDelayMs: number;
	private readonly requestTimeoutMs: number;

	private ws: WebSocket | null = null;
	private status: ExtensionBridgeClientStatus = 'idle';
	private stopped = false;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;

	private readonly pending = new Map<string, PendingRequest>();

	constructor(options: ExtensionBridgeClientOptions) {
		this.resolvePort = options.resolvePort;
		this.getJwt = options.getJwt;
		this.onEvent = options.onEvent;
		this.onStatusChanged = options.onStatusChanged;

		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
		this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 250;
		this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
	}

	start(): void {
		if (this.stopped === false && (this.status === 'connecting' || this.status === 'connected' || this.status === 'reconnecting')) {
			return;
		}
		this.stopped = false;
		this.reconnectAttempts = 0;
		this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.setStatus('stopped');
		this.clearReconnectTimer();
		this.rejectAllPending(new Error('[Gateway] Extension WS disconnected'));

		if (this.ws) {
			const ws = this.ws;
			this.ws = null;
			await new Promise<void>((resolve) => {
				ws.once('close', () => resolve());
				try {
					ws.close(1000, 'Client stopped');
				} catch {
					resolve();
				}
			});
		}
	}

	getStatus(): ExtensionBridgeClientStatus {
		return this.status;
	}

	// -------------------------------------------------------------------------
	// JSON-RPC wrapper methods
	// -------------------------------------------------------------------------

	get_status(): Promise<unknown> {
		return this.request('get_status');
	}

	subscribe_events(params?: SubscribeEventsParams): Promise<unknown> {
		return this.request('subscribe_events', params);
	}

	unsubscribe_events(params?: UnsubscribeEventsParams): Promise<unknown> {
		return this.request('unsubscribe_events', params);
	}

	get_sessions(): Promise<unknown> {
		return this.request('get_sessions');
	}

	invoke_agent(params: InvokeAgentParams): Promise<unknown> {
		return this.request('invoke_agent', params);
	}

	cancel_session(params: CancelSessionParams): Promise<unknown> {
		return this.request('cancel_session', params);
	}

	get_pending_permissions(): Promise<unknown> {
		return this.request('get_pending_permissions');
	}

	resolve_permission(params: ResolvePermissionParams): Promise<unknown> {
		return this.request('resolve_permission', params);
	}

	list_agents(): Promise<unknown> {
		return this.request('list_agents');
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private setStatus(status: ExtensionBridgeClientStatus) {
		if (this.status === status) return;
		this.status = status;
		this.onStatusChanged?.(status);
	}

	private clearReconnectTimer() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private rejectAllPending(err: Error) {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(err);
			this.pending.delete(id);
		}
	}

	private getWsUrl(): string {
		const port = this.resolvePort();
		return `ws://127.0.0.1:${port}`;
	}

	private connect(): void {
		if (this.stopped) return;

		if (this.reconnectAttempts > 0) {
			this.setStatus('reconnecting');
		} else {
			this.setStatus('connecting');
		}

		let wsUrl: string;
		try {
			wsUrl = this.getWsUrl();
		} catch (err) {
			this.scheduleReconnect(err instanceof Error ? err : new Error(String(err)));
			return;
		}

		const jwt = this.getJwt();
		const ws = new WebSocket(wsUrl, {
			headers: {
				Authorization: `Bearer ${jwt}`,
			},
		});

		this.ws = ws;

		ws.once('open', () => {
			this.reconnectAttempts = 0;
			this.setStatus('connected');

			// Subscribe to all events (no filters) so we receive `event` notifications.
			void this.subscribe_events().catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[Gateway] Extension WS subscribe_events failed: ${message}`);
				try {
					ws.close(1011, 'subscribe_events failed');
				} catch {
					// ignore
				}
			});
		});

		ws.on('message', (data: RawData) => {
			this.handleMessage(data);
		});

		ws.on('close', (code, reason) => {
			this.ws = null;
			this.rejectAllPending(new Error('[Gateway] Extension WS disconnected'));
			if (this.stopped) return;
			this.scheduleReconnect(new Error(`[Gateway] Extension WS closed (code=${code} reason=${reason.toString()})`));
		});

		ws.on('error', (err) => {
			// Do not log headers or token.
			console.error(`[Gateway] Extension WS error: ${err.message}`);
		});

		ws.on('unexpected-response', (_req, res) => {
			const statusCode = res.statusCode ?? 0;
			if (statusCode === 401 || statusCode === 403) {
				this.ws = null;
				this.stopped = true;
				this.setStatus('auth_failed');
				this.clearReconnectTimer();
				this.rejectAllPending(new Error('[Gateway] Extension WS unauthorized (check JWT token)'));
				console.error(`[Gateway] Extension WS unauthorized (HTTP ${statusCode}). Stopping reconnect to fail closed.`);
			}
		});
	}

	private scheduleReconnect(err: Error): void {
		if (this.stopped) return;
		this.clearReconnectTimer();

		this.reconnectAttempts++;
		if (this.reconnectAttempts > this.maxReconnectAttempts) {
			this.setStatus('failed');
			console.error(
				`[Gateway] Extension WS reconnect failed after ${this.maxReconnectAttempts} attempts. Last error: ${err.message}`,
			);
			return;
		}

		const exponential = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
		const delay = Math.min(this.maxReconnectDelayMs, exponential);
		const jitter = Math.floor(Math.random() * 250);
		const waitMs = delay + jitter;

		console.log(
			`[Gateway] Extension WS reconnecting in ${waitMs}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
		);

		this.reconnectTimer = setTimeout(() => this.connect(), waitMs);
	}

	private handleMessage(data: RawData): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(data.toString());
		} catch {
			return;
		}

		if (isJsonRpcNotification(parsed)) {
			if (parsed.method === 'ping') {
				void this.handlePing(parsed.params);
				return;
			}
			if (parsed.method === 'event') {
				this.onEvent?.(parsed.params);
				return;
			}
			return;
		}

		if (isJsonRpcResponse(parsed)) {
			const pending = this.pending.get(parsed.id);
			if (!pending) return;
			clearTimeout(pending.timeout);
			this.pending.delete(parsed.id);

			if ('error' in parsed) {
				const err = parsed.error;
				pending.reject(new Error(`[Gateway] Extension WS error ${err.code}: ${err.message}`));
				return;
			}

			pending.resolve(parsed.result);
			return;
		}
	}

	private async handlePing(_params: Record<string, unknown> | undefined): Promise<void> {
		try {
			await this.request('pong', { timestamp: Date.now() });
		} catch {
			// ignore
		}
	}

	private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const ws = this.ws;
		if (!ws || ws.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error('[Gateway] Extension WS not connected'));
		}

		const id = crypto.randomUUID();
		const request: JsonRpcRequest = {
			jsonrpc: '2.0',
			id,
			method,
		};
		if (params !== undefined) request.params = params;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`[Gateway] Extension WS request timeout: ${method}`));
			}, this.requestTimeoutMs);

			this.pending.set(id, {
				resolve,
				reject,
				timeout,
			});

			try {
				ws.send(JSON.stringify(request));
			} catch (err) {
				clearTimeout(timeout);
				this.pending.delete(id);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}
}
