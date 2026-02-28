import crypto from 'crypto';
import net from 'net';

import type { BridgeClient, BridgeClientStatus, CancelSessionParams, InvokeAgentParams, ResolvePermissionParams } from './bridgeClient';
import type { AcpRpcId } from './acpEventMapping';
import { mapAcpRequestPermissionToExtensionEventLike, mapAcpSessionUpdateToExtensionEventLike } from './acpEventMapping';
import type { SdkHooks } from './sdkHooks';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: AcpRpcId;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
	jsonrpc: '2.0';
	id: AcpRpcId;
	result: unknown;
}

interface JsonRpcErrorObject {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: '2.0';
	id: AcpRpcId;
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

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (!isRecord(value)) return false;
	return value.jsonrpc === '2.0' && typeof value.method === 'string' && (typeof value.id === 'string' || typeof value.id === 'number');
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	if (!isRecord(value)) return false;
	if (value.jsonrpc !== '2.0') return false;
	if (typeof value.id !== 'string' && typeof value.id !== 'number') return false;
	return value.result !== undefined || value.error !== undefined;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timeout: NodeJS.Timeout;
}

interface PendingPermissionRequest {
	rpcId: AcpRpcId;
	sessionId: string;
	options: Array<{ optionId: string; kind?: string }>;
}

export interface AcpBridgeClientOptions {
	host: string;
	port: number;
	resolveCwd: () => string;
	onEvent?: (event: unknown) => void;
	onStatusChanged?: (status: BridgeClientStatus) => void;
	maxReconnectAttempts?: number;
	baseReconnectDelayMs?: number;
	maxReconnectDelayMs?: number;
	requestTimeoutMs?: number;
	sdkHooks?: SdkHooks;
}

/**
 * Minimal ACP client for Copilot CLI `--acp --port <N>` (TCP + NDJSON JSON-RPC).
 * This intentionally only implements what the messaging gateway needs:
 * - initialize
 * - session/new + session/prompt (invoke_agent adapter)
 * - session/cancel (cancel_session adapter)
 * - session/update notifications mapped to Extension-like events for SessionThreadManager
 * - session/request_permission requests mapped to PermissionOrchestrator callbackIds
 */
export class AcpBridgeClient implements BridgeClient {
	private readonly host: string;
	private readonly port: number;
	private readonly resolveCwd: () => string;
	private readonly onEvent: ((event: unknown) => void) | undefined;
	private readonly onStatusChanged: ((status: BridgeClientStatus) => void) | undefined;
	private readonly maxReconnectAttempts: number;
	private readonly baseReconnectDelayMs: number;
	private readonly maxReconnectDelayMs: number;
	private readonly requestTimeoutMs: number;
	private readonly sdkHooks: SdkHooks | undefined;

	private socket: net.Socket | null = null;
	private status: BridgeClientStatus = 'idle';
	private stopped = false;
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private recvBuffer = '';

	private readonly pending = new Map<string, PendingRequest>();
	private readonly pendingPermissions = new Map<string, PendingPermissionRequest>();
	private readonly toolTitlesById = new Map<string, string>();

	private readonly sessions = new Map<string, { id: string; status: string; agentName?: string; lastUpdatedIso: string }>();

	constructor(options: AcpBridgeClientOptions) {
		this.host = options.host;
		this.port = options.port;
		this.resolveCwd = options.resolveCwd;
		this.onEvent = options.onEvent;
		this.onStatusChanged = options.onStatusChanged;
		this.maxReconnectAttempts = options.maxReconnectAttempts ?? 20;
		this.baseReconnectDelayMs = options.baseReconnectDelayMs ?? 250;
		this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
		this.sdkHooks = options.sdkHooks;
	}

	start(): void {
		if (this.stopped === false && (this.status === 'connecting' || this.status === 'connected' || this.status === 'reconnecting')) {
			return;
		}
		this.stopped = false;
		this.reconnectAttempts = 0;
		void this.connect();
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.setStatus('stopped');
		this.clearReconnectTimer();
		this.rejectAllPending(new Error('[Gateway] ACP disconnected'));
		this.pendingPermissions.clear();

		if (this.socket) {
			const s = this.socket;
			this.socket = null;
			await new Promise<void>((resolve) => {
				s.once('close', () => resolve());
				try {
					s.end();
					s.destroy();
				} catch {
					resolve();
				}
			});
		}
	}

	getStatus(): BridgeClientStatus {
		return this.status;
	}

	get_sessions(): Promise<unknown> {
		const sessions = [...this.sessions.values()].map((s) => ({
			id: s.id,
			status: s.status,
			agentName: s.agentName,
			lastUpdatedIso: s.lastUpdatedIso,
		}));
		return Promise.resolve({ sessions });
	}

	async invoke_agent(params: InvokeAgentParams): Promise<unknown> {
		const startedAt = Date.now();
		const cwd = this.resolveCwd();

		const newResUnknown = await this.request('session/new', { cwd, mcpServers: [] });
		const sessionId =
			typeof newResUnknown === 'object' && newResUnknown !== null && typeof (newResUnknown as any).sessionId === 'string'
				? String((newResUnknown as any).sessionId)
				: undefined;
		if (!sessionId) throw new Error('[Gateway] ACP session/new did not return sessionId');

		this.sessions.set(sessionId, {
			id: sessionId,
			status: 'active',
			agentName: params.agentName,
			lastUpdatedIso: new Date().toISOString(),
		});

		this.onEvent?.({ type: 'session_started', sessionId, payload: { agent: params.agentName } });

		try {
			const promptRes = await this.request('session/prompt', {
				sessionId,
				prompt: [{ type: 'text', text: params.prompt }],
			});

			const stopReason =
				typeof promptRes === 'object' && promptRes !== null && typeof (promptRes as any).stopReason === 'string'
					? String((promptRes as any).stopReason)
					: 'end_turn';

			const durationMs = Date.now() - startedAt;
			if (stopReason === 'end_turn') {
				this.sessions.set(sessionId, { ...this.sessions.get(sessionId)!, status: 'completed', lastUpdatedIso: new Date().toISOString() });
				this.onEvent?.({ type: 'session_completed', sessionId, payload: { durationMs } });
			} else if (stopReason === 'cancelled') {
				this.sessions.set(sessionId, { ...this.sessions.get(sessionId)!, status: 'cancelled', lastUpdatedIso: new Date().toISOString() });
				this.onEvent?.({ type: 'session_completed', sessionId, payload: { durationMs, stopReason } });
			} else {
				this.sessions.set(sessionId, { ...this.sessions.get(sessionId)!, status: stopReason, lastUpdatedIso: new Date().toISOString() });
				this.onEvent?.({ type: 'session_completed', sessionId, payload: { durationMs, stopReason } });
			}
		} catch (err) {
			this.sessions.set(sessionId, { ...this.sessions.get(sessionId)!, status: 'failed', lastUpdatedIso: new Date().toISOString() });
			const message = err instanceof Error ? err.message : String(err);
			this.onEvent?.({ type: 'session_error', sessionId, payload: { message } });
			throw err instanceof Error ? err : new Error(String(err));
		}

		return { sessionId };
	}

	cancel_session(params: CancelSessionParams): Promise<unknown> {
		this.sendNotification('session/cancel', { sessionId: params.sessionId });
		return Promise.resolve({ ok: true });
	}

	async resolve_permission(params: ResolvePermissionParams): Promise<unknown> {
		const pending = this.pendingPermissions.get(params.callbackId);
		if (!pending) throw new Error('[Gateway] ACP permission callbackId not pending');

		// Pick a best-effort ACP optionId that matches the desired outcome.
		const allowKinds = new Set(['allow_once', 'allow_always']);
		const rejectKinds = new Set(['reject_once', 'reject_always']);
		const preferred = params.approved ? allowKinds : rejectKinds;
		const fallback = params.approved ? rejectKinds : allowKinds;

		const chosen =
			pending.options.find((o) => typeof o.kind === 'string' && preferred.has(o.kind)) ??
			pending.options.find((o) => typeof o.kind === 'string' && fallback.has(o.kind)) ??
			pending.options[0];

		if (!chosen?.optionId) throw new Error('[Gateway] ACP permission request has no options');

		this.pendingPermissions.delete(params.callbackId);

		this.sendResponse(pending.rpcId, {
			outcome: {
				outcome: 'selected',
				optionId: chosen.optionId,
			},
		});

		this.onEvent?.({
			type: 'permission_resolved',
			sessionId: pending.sessionId,
			payload: {
				callbackId: params.callbackId,
				approved: params.approved,
				resolvedBy: params.resolvedBy,
			},
		});

		return { ok: true };
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private setStatus(status: BridgeClientStatus) {
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

	private async connect(): Promise<void> {
		if (this.stopped) return;

		if (this.reconnectAttempts > 0) this.setStatus('reconnecting');
		else this.setStatus('connecting');

		const socket = net.createConnection({ host: this.host, port: this.port });
		this.socket = socket;
		socket.setNoDelay(true);

		socket.once('connect', () => {
			this.reconnectAttempts = 0;
			void this.request('initialize', {
				protocolVersion: 1,
				clientCapabilities: {},
				clientInfo: {
					name: 'instruction-engine-messaging-gateway',
					title: 'Instruction Engine Messaging Gateway',
					version: '0.1.0',
				},
			})
				.then(() => {
					this.setStatus('connected');
				})
				.catch((err) => {
					const message = err instanceof Error ? err.message : String(err);
					console.error(`[Gateway] ACP initialize failed: ${message}`);
					try {
						socket.end();
						socket.destroy();
					} catch {
						// ignore
					}
				});
		});

		socket.on('data', (chunk: Buffer) => {
			this.handleData(chunk.toString('utf8'));
		});

		socket.on('close', () => {
			this.socket = null;
			this.rejectAllPending(new Error('[Gateway] ACP disconnected'));
			if (this.stopped) return;
			this.scheduleReconnect(new Error('[Gateway] ACP connection closed'));
		});

		socket.on('error', (err) => {
			console.error(`[Gateway] ACP socket error: ${err.message}`);
		});
	}

	private scheduleReconnect(err: Error): void {
		if (this.stopped) return;
		this.clearReconnectTimer();

		this.reconnectAttempts++;
		if (this.reconnectAttempts > this.maxReconnectAttempts) {
			this.setStatus('failed');
			console.error(`[Gateway] ACP reconnect failed after ${this.maxReconnectAttempts} attempts. Last error: ${err.message}`);
			return;
		}

		const exponential = this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempts - 1);
		const delay = Math.min(this.maxReconnectDelayMs, exponential);
		const jitter = Math.floor(Math.random() * 250);
		const waitMs = delay + jitter;

		console.log(`[Gateway] ACP reconnecting in ${waitMs}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
		this.reconnectTimer = setTimeout(() => void this.connect(), waitMs);
	}

	private handleData(text: string): void {
		this.recvBuffer += text;
		while (true) {
			const idx = this.recvBuffer.indexOf('\n');
			if (idx < 0) break;
			const line = this.recvBuffer.slice(0, idx).trim();
			this.recvBuffer = this.recvBuffer.slice(idx + 1);
			if (!line) continue;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			this.handleMessage(parsed);
		}
	}

	private handleMessage(parsed: unknown): void {
		if (isJsonRpcNotification(parsed)) {
			if (parsed.method === 'session/update') {
				const params = parsed.params;
				const sessionId =
					typeof params?.sessionId === 'string' && params.sessionId.trim().length > 0 ? params.sessionId : undefined;
				const update = params?.update;
				if (!sessionId) return;
				const ev = mapAcpSessionUpdateToExtensionEventLike(sessionId, update, this.toolTitlesById);
				const nowIso = new Date().toISOString();
				const existing = this.sessions.get(sessionId);
				const statusFromEv =
					ev?.type === 'session_error'
						? 'failed'
						: ev?.type === 'session_completed'
							? 'completed'
							: ev?.type === 'session_started'
								? 'active'
								: undefined;
				if (existing) {
					this.sessions.set(sessionId, {
						...existing,
						status: statusFromEv ?? existing.status,
						lastUpdatedIso: nowIso,
					});
				} else {
					this.sessions.set(sessionId, {
						id: sessionId,
						status: statusFromEv ?? 'active',
						lastUpdatedIso: nowIso,
					});
				}
				// WU-H05b: Fire onPostToolUse for completed tool calls
				if (this.sdkHooks && ev?.type === 'tool_called' && isRecord(ev.payload)) {
					const status = typeof ev.payload.status === 'string' ? ev.payload.status : '';
					if (status === 'completed' || status === 'done') {
						const toolName = typeof ev.payload.tool === 'string' ? ev.payload.tool : 'unknown';
						const toolArgs = this.extractToolArgs(ev.payload as Record<string, unknown>);
						this.sdkHooks.onPostToolUse(toolName, toolArgs, ev.payload);
					}
				}

				if (ev) this.onEvent?.(ev);
			}
			return;
		}

		if (isJsonRpcResponse(parsed)) {
			const pending = this.pending.get(String(parsed.id));
			if (!pending) return;
			clearTimeout(pending.timeout);
			this.pending.delete(String(parsed.id));

			if ('error' in parsed) {
				const err = parsed.error;
				pending.reject(new Error(`[Gateway] ACP error ${err.code}: ${err.message}`));
				return;
			}

			pending.resolve(parsed.result);
			return;
		}

		if (isJsonRpcRequest(parsed)) {
			if (parsed.method === 'session/request_permission') {
				const ev = mapAcpRequestPermissionToExtensionEventLike(parsed.id, parsed.params, this.toolTitlesById);
				if (!ev?.sessionId) {
					this.sendError(parsed.id, -32602, 'Invalid params');
					return;
				}

				const optionsRaw = Array.isArray(parsed.params?.options) ? parsed.params?.options : [];
				const options = optionsRaw
					.filter((o) => isRecord(o))
					.map((o) => ({ optionId: typeof o.optionId === 'string' ? o.optionId : '', kind: typeof o.kind === 'string' ? o.kind : undefined }))
					.filter((o) => o.optionId.length > 0);

				// WU-H05b: Hook-based auto-rejection for blocked tools
				if (this.sdkHooks) {
					const toolName = this.extractToolName(parsed.params);
					const toolArgs = this.extractToolArgs(parsed.params);
					const hookResult = this.sdkHooks.evaluatePermission(toolName, toolArgs);
					if (hookResult.autoReject) {
						// Auto-reject: pick a reject option and respond immediately
						const rejectOption = options.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always');
						if (rejectOption?.optionId) {
							this.sendResponse(parsed.id, { outcome: { outcome: 'selected', optionId: rejectOption.optionId } });
						} else {
							this.sendError(parsed.id, -32602, hookResult.message ?? 'Hook policy blocked this tool call; no reject option available');
						}
						this.onEvent?.({
							type: 'permission_resolved',
							sessionId: ev.sessionId!,
							payload: {
								callbackId: String(parsed.id),
								approved: false,
								resolvedBy: 'sdk_hook',
								ruleId: hookResult.ruleId,
							},
						});
						return;
					}
				}

				this.pendingPermissions.set(String(parsed.id), {
					rpcId: parsed.id,
					sessionId: ev.sessionId!,
					options,
				});

				this.onEvent?.(ev);
				return;
			}

			// Not implemented by this client.
			this.sendError(parsed.id, -32601, `Method not found: ${parsed.method}`);
			return;
		}
	}

	private extractToolName(params: Record<string, unknown> | undefined): string {
		if (!params) return 'unknown';
		if (typeof params.toolName === 'string') return params.toolName;
		if (typeof params.tool_name === 'string') return params.tool_name;
		if (typeof params.tool === 'string') return params.tool;
		if (isRecord(params.toolCall)) {
			const tc = params.toolCall;
			if (typeof tc.title === 'string') return tc.title;
			if (typeof tc.toolName === 'string') return tc.toolName;
			if (typeof tc.tool_name === 'string') return tc.tool_name;
			if (typeof tc.name === 'string') return tc.name;
		}
		return 'unknown';
	}

	private extractToolArgs(params: Record<string, unknown> | undefined): Record<string, unknown> {
		if (!params) return {};
		if (isRecord(params.toolCall) && isRecord((params.toolCall as Record<string, unknown>).args)) {
			return (params.toolCall as Record<string, unknown>).args as Record<string, unknown>;
		}
		if (isRecord(params.toolCall) && isRecord((params.toolCall as Record<string, unknown>).arguments)) {
			return (params.toolCall as Record<string, unknown>).arguments as Record<string, unknown>;
		}
		if (isRecord(params.args)) return params.args as Record<string, unknown>;
		if (isRecord(params.arguments)) return params.arguments as Record<string, unknown>;
		return {};
	}

	private sendJson(obj: unknown): void {
		const socket = this.socket;
		if (!socket || socket.destroyed) throw new Error('[Gateway] ACP not connected');
		socket.write(`${JSON.stringify(obj)}\n`);
	}

	private sendNotification(method: string, params?: Record<string, unknown>): void {
		this.sendJson({ jsonrpc: '2.0', method, params });
	}

	private sendResponse(id: AcpRpcId, result: unknown): void {
		this.sendJson({ jsonrpc: '2.0', id, result });
	}

	private sendError(id: AcpRpcId, code: number, message: string): void {
		this.sendJson({ jsonrpc: '2.0', id, error: { code, message } });
	}

	private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		const socket = this.socket;
		if (!socket || socket.destroyed) {
			return Promise.reject(new Error('[Gateway] ACP not connected'));
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
				this.pending.delete(String(id));
				reject(new Error(`[Gateway] ACP request timeout: ${method}`));
			}, this.requestTimeoutMs);

			this.pending.set(String(id), { resolve, reject, timeout });
			try {
				this.sendJson(request);
			} catch (err) {
				clearTimeout(timeout);
				this.pending.delete(String(id));
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}
}

