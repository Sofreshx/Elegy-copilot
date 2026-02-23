import { sanitizeOutboundText } from './sanitizer';
import type { PlatformMessageHandle, PlatformThreadHandle } from './platform';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
	const v = obj[key];
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
	const v = obj[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export interface ExtensionEventLike {
	type: string;
	sessionId?: string;
	sandboxId?: string;
	timestamp?: string;
	payload?: unknown;
}

function parseExtensionEventLike(input: unknown): ExtensionEventLike | null {
	if (!isRecord(input)) return null;
	const type = readString(input, 'type') ?? readString(input, 'eventType') ?? readString(input, 'name');
	if (!type) return null;
	const sessionId = readString(input, 'sessionId') ?? readString(input, 'session_id');
	const sandboxId = readString(input, 'sandboxId') ?? readString(input, 'sandbox_id');
	const timestamp = readString(input, 'timestamp');
	const payload = input.payload;
	return { type, sessionId, sandboxId, timestamp, payload };
}

function capTail<T>(items: T[], max: number): T[] {
	if (items.length <= max) return items;
	return items.slice(items.length - max);
}

export interface PermissionRequestedLike {
	sessionId: string;
	threadId: string;
	callbackId: string;
	summary: string;
}

export interface PermissionResolvedLike {
	callbackId: string;
	approved: boolean;
	resolvedBy?: string;
	timedOut?: boolean;
}

export interface SessionThreadManagerOptions {
	minUpdateIntervalMs?: number;
	maxEventLines?: number;
	maxToolLines?: number;
	maxLiveMessageChars?: number;
	nowMs?: () => number;

	postPermissionPrompt?: (req: PermissionRequestedLike) => Promise<void>;
	markPermissionResolved?: (res: PermissionResolvedLike) => Promise<void>;
}

interface SessionState {
	sessionId: string;
	sandboxId?: string;
	thread?: PlatformThreadHandle;
	liveMessage?: PlatformMessageHandle;
	createdAtIso: string;
	lastStatus?: string;
	eventLines: string[];
	toolLines: string[];
	lastEditAtMs: number;
	flushTimer?: NodeJS.Timeout;
	pendingPermissionPrompts: Array<{ callbackId: string; summary: string }>;
}

export class SessionThreadManager {
	private readonly minUpdateIntervalMs: number;
	private readonly maxEventLines: number;
	private readonly maxToolLines: number;
	private readonly maxLiveMessageChars: number;
	private readonly nowMs: () => number;
	private readonly postPermissionPrompt?: (req: PermissionRequestedLike) => Promise<void>;
	private readonly markPermissionResolved?: (res: PermissionResolvedLike) => Promise<void>;

	private readonly sessions = new Map<string, SessionState>();

	constructor(options: SessionThreadManagerOptions = {}) {
		this.minUpdateIntervalMs = options.minUpdateIntervalMs ?? 3000;
		this.maxEventLines = options.maxEventLines ?? 12;
		this.maxToolLines = options.maxToolLines ?? 3;
		this.maxLiveMessageChars = options.maxLiveMessageChars ?? 1750;
		this.nowMs = options.nowMs ?? (() => Date.now());
		this.postPermissionPrompt = options.postPermissionPrompt;
		this.markPermissionResolved = options.markPermissionResolved;
	}

	attachThread(params: { sessionId: string; sandboxId?: string; thread: PlatformThreadHandle; liveMessage: PlatformMessageHandle }): void {
		const state = this.ensureSession(params.sessionId);
		if (params.sandboxId) state.sandboxId = params.sandboxId;
		state.thread = params.thread;
		state.liveMessage = params.liveMessage;

		// Flush any permission prompts that arrived before we had a thread.
		const pending = [...state.pendingPermissionPrompts];
		state.pendingPermissionPrompts = [];
		for (const req of pending) {
			void this.postPermissionPrompt?.({
				sessionId: state.sessionId,
				threadId: params.thread.id,
				callbackId: req.callbackId,
				summary: req.summary,
			});
		}

		this.scheduleFlush(state);
	}

	handleExtensionEvent(eventUnknown: unknown): void {
		const ev = parseExtensionEventLike(eventUnknown);
		if (!ev?.sessionId) return;

		const state = this.ensureSession(ev.sessionId);
		if (ev.sandboxId && !state.sandboxId) state.sandboxId = ev.sandboxId;
		const line = this.formatEventLine(ev);
		if (line) {
			state.eventLines.push(line);
			state.eventLines = capTail(state.eventLines, this.maxEventLines);
		}

		if (ev.type === 'tool_called') {
			const toolLine = this.formatToolLine(ev.payload);
			if (toolLine) {
				state.toolLines.push(toolLine);
				state.toolLines = capTail(state.toolLines, this.maxToolLines);
			}
		}

		if (ev.type === 'session_started') state.lastStatus = 'active';
		if (ev.type === 'session_completed') state.lastStatus = 'completed';
		if (ev.type === 'session_error') state.lastStatus = 'failed';
		if (ev.type === 'permission_requested') {
			const req = this.tryParsePermissionRequested(ev);
			if (req) {
				if (state.thread) {
					void this.postPermissionPrompt?.({ ...req, threadId: state.thread.id });
				} else {
					state.pendingPermissionPrompts.push({ callbackId: req.callbackId, summary: req.summary });
				}
			}
		}
		if (ev.type === 'permission_resolved') {
			const res = this.tryParsePermissionResolved(ev.payload);
			if (res) void this.markPermissionResolved?.(res);
		}

		this.scheduleFlush(state);
	}

	stop(): void {
		for (const state of this.sessions.values()) {
			if (state.flushTimer) clearTimeout(state.flushTimer);
		}
		this.sessions.clear();
	}

	getActiveSessionThreadCount(): number {
		let count = 0;
		for (const state of this.sessions.values()) {
			if (state.thread) count++;
		}
		return count;
	}

	private ensureSession(sessionId: string): SessionState {
		const existing = this.sessions.get(sessionId);
		if (existing) return existing;
		const createdAtIso = new Date(this.nowMs()).toISOString();
		const state: SessionState = {
			sessionId,
			createdAtIso,
			eventLines: [],
			toolLines: [],
			lastEditAtMs: 0,
			pendingPermissionPrompts: [],
		};
		this.sessions.set(sessionId, state);
		return state;
	}

	private scheduleFlush(state: SessionState): void {
		if (!state.thread || !state.liveMessage) return;
		if (state.flushTimer) return;

		const now = this.nowMs();
		const elapsed = now - state.lastEditAtMs;
		const waitMs = Math.max(0, this.minUpdateIntervalMs - elapsed);
		state.flushTimer = setTimeout(() => {
			state.flushTimer = undefined;
			void this.flush(state.sessionId);
		}, waitMs);
	}

	private async flush(sessionId: string): Promise<void> {
		const state = this.sessions.get(sessionId);
		if (!state?.thread || !state.liveMessage) return;

		const content = this.buildLiveMessage(state);
		try {
			await state.liveMessage.edit(content);
			state.lastEditAtMs = this.nowMs();
		} catch {
			// Ignore Discord edit failures (archived thread, perms, rate limit). Next event may retry.
		}
	}

	private buildLiveMessage(state: SessionState): string {
		const lines: string[] = [];
		const prefix = state.sandboxId ? `[${state.sandboxId}] ` : '';
		lines.push(`${prefix}Session ${state.sessionId}`);
		if (state.sandboxId) lines.push(`Sandbox: ${state.sandboxId}`);
		lines.push(`Status: ${state.lastStatus ?? 'unknown'}`);
		lines.push(`Updated: ${new Date(this.nowMs()).toISOString()}`);
		lines.push('');

		if (state.eventLines.length > 0) {
			lines.push('Recent');
			for (const l of state.eventLines) lines.push(`- ${l}`);
			lines.push('');
		}

		if (state.toolLines.length > 0) {
			lines.push('Tools');
			for (const t of state.toolLines) lines.push(`- ${t}`);
		}

		const raw = lines.join('\n').trimEnd();
		return sanitizeOutboundText(raw, { maxLength: this.maxLiveMessageChars });
	}

	private formatEventLine(ev: ExtensionEventLike): string | null {
		const payload = ev.payload;
		if (ev.type === 'session_started') {
			if (isRecord(payload)) {
				const agent = readString(payload, 'agent') ?? 'agent';
				return `started @${agent}`;
			}
			return 'started';
		}
		if (ev.type === 'session_progress') {
			if (isRecord(payload)) {
				const msg = readString(payload, 'message') ?? 'progress';
				const pct = readNumber(payload, 'percentage');
				return pct !== undefined ? `${msg} (${pct}%)` : msg;
			}
			return 'progress';
		}
		if (ev.type === 'session_completed') {
			if (isRecord(payload)) {
				const durationMs = readNumber(payload, 'durationMs');
				const toolCallCount = readNumber(payload, 'toolCallCount');
				const parts = [
					durationMs !== undefined ? `${durationMs}ms` : undefined,
					toolCallCount !== undefined ? `tools:${toolCallCount}` : undefined,
				].filter((p): p is string => typeof p === 'string');
				return parts.length > 0 ? `completed (${parts.join(', ')})` : 'completed';
			}
			return 'completed';
		}
		if (ev.type === 'session_error') {
			if (isRecord(payload)) {
				const msg = readString(payload, 'message') ?? 'error';
				return `error: ${msg}`;
			}
			return 'error';
		}
		if (ev.type === 'permission_requested') {
			if (isRecord(payload)) {
				const operation = readString(payload, 'operation');
				const description = readString(payload, 'description');
				const callbackId = readString(payload, 'callbackId');
				const main = [operation, description].filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' — ');
				return `permission requested${main ? `: ${main}` : ''}${callbackId ? ` (callbackId=${callbackId})` : ''}`;
			}
			return 'permission requested';
		}
		if (ev.type === 'permission_resolved') {
			if (isRecord(payload)) {
				const callbackId = readString(payload, 'callbackId');
				const approved = payload.approved === true;
				const timedOut = payload.timedOut === true;
				return `permission ${approved ? 'approved' : 'denied'}${timedOut ? ' (timeout)' : ''}${callbackId ? ` (callbackId=${callbackId})` : ''}`;
			}
			return 'permission resolved';
		}

		// Default: ignore other events for the live feed.
		return null;
	}

	private formatToolLine(payload: unknown): string | null {
		if (!isRecord(payload)) return null;
		const tool = readString(payload, 'tool') ?? readString(payload, 'toolName') ?? readString(payload, 'tool_name');
		if (!tool) return null;
		const durationMs = readNumber(payload, 'durationMs');
		const error = readString(payload, 'error');
		const parts = [tool, durationMs !== undefined ? `${durationMs}ms` : undefined, error ? `error:${error}` : undefined].filter(
			(p): p is string => typeof p === 'string' && p.trim().length > 0,
		);
		return parts.join(' ');
	}

	private tryParsePermissionRequested(ev: ExtensionEventLike): Omit<PermissionRequestedLike, 'threadId'> | null {
		if (!ev.sessionId) return null;
		const payload = ev.payload;
		if (!isRecord(payload)) return null;
		const callbackId = readString(payload, 'callbackId');
		if (!callbackId) return null;
		const operation = readString(payload, 'operation');
		const description = readString(payload, 'description');
		const summary = [operation, description].filter((p): p is string => typeof p === 'string' && p.trim().length > 0).join(' — ');
		return {
			sessionId: ev.sessionId,
			callbackId,
			summary: summary.length > 0 ? summary : 'Permission requested',
		};
	}

	private tryParsePermissionResolved(payload: unknown): PermissionResolvedLike | null {
		if (!isRecord(payload)) return null;
		const callbackId = readString(payload, 'callbackId');
		if (!callbackId) return null;
		const approved = payload.approved === true;
		const resolvedBy = readString(payload, 'resolvedBy');
		const timedOut = payload.timedOut === true;
		return { callbackId, approved, resolvedBy, timedOut };
	}
}
