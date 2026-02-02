/**
 * Central event emission system for mobile companion push notifications.
 * Provides typed events, subscription filtering, rate limiting, and history buffer.
 */
import * as crypto from 'crypto';
import * as vscode from 'vscode';

// -----------------------------------------------------------------------------
// Event Types
// -----------------------------------------------------------------------------

/** Supported event types for the extension */
export type EventType =
	| 'session_started'
	| 'session_progress'
	| 'session_completed'
	| 'session_error'
	| 'tool_called'
	| 'permission_requested'
	| 'permission_resolved';

/** Standard extension event structure */
export interface ExtensionEvent {
	type: EventType;
	sessionId?: string;
	correlationId: string;
	timestamp: string;
	payload: unknown;
}

/** Session started event payload */
export interface SessionStartedPayload {
	agent: string;
	prompt: string;
}

/** Session progress event payload */
export interface SessionProgressPayload {
	message: string;
	percentage?: number;
}

/** Session completed event payload */
export interface SessionCompletedPayload {
	durationMs: number;
	toolCallCount: number;
	response?: string;
}

/** Session error event payload */
export interface SessionErrorPayload {
	message: string;
	code?: string;
}

/** Tool called event payload */
export interface ToolCalledPayload {
	tool: string;
	durationMs?: number;
	error?: string;
}

/** Permission requested event payload */
export interface PermissionRequestedPayload {
	operation: string;
	description: string;
	callbackId: string;
	timeoutMs: number;
}

/** Permission resolved event payload */
export interface PermissionResolvedPayload {
	callbackId: string;
	approved: boolean;
	resolvedBy?: string;
	timedOut?: boolean;
}

// -----------------------------------------------------------------------------
// Subscription Management
// -----------------------------------------------------------------------------

/** Client subscription configuration */
export interface Subscription {
	clientId: string;
	eventTypes?: EventType[];  // undefined = all event types
	sessionIds?: string[];     // undefined = all sessions
}

/** Pending permission request */
export interface PendingPermission {
	callbackId: string;
	sessionId: string;
	operation: string;
	description: string;
	requestedAt: Date;
	timeoutMs: number;
	resolve: (approved: boolean, resolvedBy?: string) => void;
	reject: (reason: string) => void;
	timeoutHandle: ReturnType<typeof setTimeout>;
}

// -----------------------------------------------------------------------------
// Rate Limiting (Token Bucket)
// -----------------------------------------------------------------------------

/** Token bucket for rate limiting */
interface TokenBucket {
	tokens: number;
	lastRefill: number;
}

/** Rate limiter configuration */
interface RateLimitConfig {
	maxTokens: number;       // Max events per second
	refillRate: number;      // Tokens added per ms
	refillInterval: number;  // How often to refill (ms)
}

// -----------------------------------------------------------------------------
// Event History Buffer
// -----------------------------------------------------------------------------

/** Circular buffer for event history */
class CircularBuffer<T> {
	private buffer: (T | undefined)[];
	private head: number = 0;
	private tail: number = 0;
	private size: number = 0;

	constructor(private readonly capacity: number) {
		this.buffer = new Array(capacity);
	}

	push(item: T): void {
		this.buffer[this.head] = item;
		this.head = (this.head + 1) % this.capacity;

		if (this.size < this.capacity) {
			this.size++;
		} else {
			this.tail = (this.tail + 1) % this.capacity;
		}
	}

	getAll(): T[] {
		const result: T[] = [];
		let index = this.tail;
		for (let i = 0; i < this.size; i++) {
			const item = this.buffer[index];
			if (item !== undefined) {
				result.push(item);
			}
			index = (index + 1) % this.capacity;
		}
		return result;
	}

	getFiltered(predicate: (item: T) => boolean): T[] {
		return this.getAll().filter(predicate);
	}

	clear(): void {
		this.buffer = new Array(this.capacity);
		this.head = 0;
		this.tail = 0;
		this.size = 0;
	}

	get length(): number {
		return this.size;
	}
}

// -----------------------------------------------------------------------------
// Event Emitter
// -----------------------------------------------------------------------------

/** Callback for event broadcast */
export type EventBroadcastCallback = (clientId: string, event: ExtensionEvent) => void;

/**
 * Central event bus for the extension.
 * Handles event emission, subscription filtering, rate limiting, and history.
 */
export class ExtensionEventEmitter implements vscode.Disposable {
	private readonly subscriptions = new Map<string, Subscription>();
	private readonly rateLimitBuckets = new Map<string, TokenBucket>();
	private readonly eventHistory: CircularBuffer<ExtensionEvent>;
	private readonly pendingPermissions = new Map<string, PendingPermission>();
	private readonly output: vscode.OutputChannel;
	private broadcastCallback?: EventBroadcastCallback;

	// Rate limit configuration
	private readonly rateLimitConfig: RateLimitConfig = {
		maxTokens: 100,        // 100 events/second
		refillRate: 0.1,       // 100 tokens per 1000ms
		refillInterval: 10,    // Check every 10ms (but refill is time-based)
	};

	// History buffer size
	private static readonly HISTORY_SIZE = 50;

	// Default permission timeout
	private static readonly DEFAULT_PERMISSION_TIMEOUT_MS = 60000; // 60 seconds

	constructor(output: vscode.OutputChannel) {
		this.output = output;
		this.eventHistory = new CircularBuffer(ExtensionEventEmitter.HISTORY_SIZE);
	}

	/**
	 * Set the callback function for broadcasting events to clients.
	 */
	setBroadcastCallback(callback: EventBroadcastCallback): void {
		this.broadcastCallback = callback;
	}

	// -------------------------------------------------------------------------
	// Subscription Management
	// -------------------------------------------------------------------------

	/**
	 * Subscribe a client to events with optional filtering.
	 */
	subscribe(clientId: string, eventTypes?: EventType[], sessionIds?: string[]): void {
		const existing = this.subscriptions.get(clientId);
		
		if (existing) {
			// Merge filters
			if (eventTypes) {
				existing.eventTypes = existing.eventTypes 
					? [...new Set([...existing.eventTypes, ...eventTypes])]
					: eventTypes;
			}
			if (sessionIds) {
				existing.sessionIds = existing.sessionIds
					? [...new Set([...existing.sessionIds, ...sessionIds])]
					: sessionIds;
			}
		} else {
			this.subscriptions.set(clientId, {
				clientId,
				eventTypes: eventTypes?.length ? eventTypes : undefined,
				sessionIds: sessionIds?.length ? sessionIds : undefined,
			});
		}

		this.output.appendLine(`[EventEmitter] Client ${clientId} subscribed (types: ${eventTypes?.join(', ') || 'all'}, sessions: ${sessionIds?.join(', ') || 'all'})`);
	}

	/**
	 * Unsubscribe a client from specific event types or sessions.
	 * If no filters provided, removes entire subscription.
	 */
	unsubscribe(clientId: string, eventTypes?: EventType[], sessionIds?: string[]): void {
		const existing = this.subscriptions.get(clientId);
		if (!existing) {
			return;
		}

		if (!eventTypes && !sessionIds) {
			// Remove entire subscription
			this.subscriptions.delete(clientId);
			this.output.appendLine(`[EventEmitter] Client ${clientId} fully unsubscribed`);
			return;
		}

		// Remove specific filters
		if (eventTypes && existing.eventTypes) {
			existing.eventTypes = existing.eventTypes.filter(t => !eventTypes.includes(t));
			if (existing.eventTypes.length === 0) {
				existing.eventTypes = undefined;
			}
		}

		if (sessionIds && existing.sessionIds) {
			existing.sessionIds = existing.sessionIds.filter(s => !sessionIds.includes(s));
			if (existing.sessionIds.length === 0) {
				existing.sessionIds = undefined;
			}
		}

		this.output.appendLine(`[EventEmitter] Client ${clientId} updated subscription`);
	}

	/**
	 * Remove all subscriptions for a client (called on disconnect).
	 */
	removeClient(clientId: string): void {
		this.subscriptions.delete(clientId);
		this.rateLimitBuckets.delete(clientId);
		this.output.appendLine(`[EventEmitter] Client ${clientId} removed`);
	}

	/**
	 * Get current subscription for a client.
	 */
	getSubscription(clientId: string): Subscription | undefined {
		return this.subscriptions.get(clientId);
	}

	// -------------------------------------------------------------------------
	// Rate Limiting
	// -------------------------------------------------------------------------

	/**
	 * Check if client can receive an event (token bucket rate limiting).
	 * Returns true if event can be sent, false if rate limited.
	 */
	private checkRateLimit(clientId: string): boolean {
		const now = Date.now();
		let bucket = this.rateLimitBuckets.get(clientId);

		if (!bucket) {
			// Initialize bucket with max tokens
			bucket = {
				tokens: this.rateLimitConfig.maxTokens,
				lastRefill: now,
			};
			this.rateLimitBuckets.set(clientId, bucket);
		}

		// Refill tokens based on elapsed time
		const elapsed = now - bucket.lastRefill;
		const tokensToAdd = elapsed * this.rateLimitConfig.refillRate;
		bucket.tokens = Math.min(this.rateLimitConfig.maxTokens, bucket.tokens + tokensToAdd);
		bucket.lastRefill = now;

		// Try to consume a token
		if (bucket.tokens >= 1) {
			bucket.tokens -= 1;
			return true;
		}

		return false;
	}

	// -------------------------------------------------------------------------
	// Event Emission
	// -------------------------------------------------------------------------

	/**
	 * Emit an event to all subscribed clients (with filtering and rate limiting).
	 */
	emit(type: EventType, payload: unknown, sessionId?: string, correlationId?: string): ExtensionEvent {
		const event: ExtensionEvent = {
			type,
			sessionId,
			correlationId: correlationId ?? crypto.randomUUID(),
			timestamp: new Date().toISOString(),
			payload,
		};

		// Add to history buffer
		this.eventHistory.push(event);

		// Broadcast to subscribed clients
		if (this.broadcastCallback) {
			for (const [clientId, subscription] of this.subscriptions) {
				// Check event type filter
				if (subscription.eventTypes && !subscription.eventTypes.includes(type)) {
					continue;
				}

				// Check session ID filter
				if (subscription.sessionIds && sessionId && !subscription.sessionIds.includes(sessionId)) {
					continue;
				}

				// Check rate limit
				if (!this.checkRateLimit(clientId)) {
					this.output.appendLine(`[EventEmitter] Rate limited event for client ${clientId}: ${type}`);
					continue;
				}

				// Send event
				this.broadcastCallback(clientId, event);
			}
		}

		return event;
	}

	// -------------------------------------------------------------------------
	// Typed Event Emission Helpers
	// -------------------------------------------------------------------------

	/**
	 * Emit session_started event.
	 */
	emitSessionStarted(sessionId: string, agent: string, prompt: string, correlationId?: string): ExtensionEvent {
		const payload: SessionStartedPayload = { agent, prompt };
		return this.emit('session_started', payload, sessionId, correlationId);
	}

	/**
	 * Emit session_progress event.
	 */
	emitSessionProgress(sessionId: string, message: string, percentage?: number, correlationId?: string): ExtensionEvent {
		const payload: SessionProgressPayload = { message, percentage };
		return this.emit('session_progress', payload, sessionId, correlationId);
	}

	/**
	 * Emit session_completed event.
	 */
	emitSessionCompleted(sessionId: string, durationMs: number, toolCallCount: number, response?: string, correlationId?: string): ExtensionEvent {
		const payload: SessionCompletedPayload = { durationMs, toolCallCount, response };
		return this.emit('session_completed', payload, sessionId, correlationId);
	}

	/**
	 * Emit session_error event.
	 */
	emitSessionError(sessionId: string, message: string, code?: string, correlationId?: string): ExtensionEvent {
		const payload: SessionErrorPayload = { message, code };
		return this.emit('session_error', payload, sessionId, correlationId);
	}

	/**
	 * Emit tool_called event.
	 */
	emitToolCalled(sessionId: string, tool: string, durationMs?: number, error?: string, correlationId?: string): ExtensionEvent {
		const payload: ToolCalledPayload = { tool, durationMs, error };
		return this.emit('tool_called', payload, sessionId, correlationId);
	}

	// -------------------------------------------------------------------------
	// Permission Request Flow
	// -------------------------------------------------------------------------

	/**
	 * Emit a permission request and wait for resolution.
	 * Returns a promise that resolves to true (approved) or false (denied/timeout).
	 */
	emitPermissionRequest(
		sessionId: string,
		operation: string,
		description: string,
		correlationId?: string,
		timeoutMs?: number
	): Promise<boolean> {
		const callbackId = crypto.randomUUID();
		const timeout = timeoutMs ?? ExtensionEventEmitter.DEFAULT_PERMISSION_TIMEOUT_MS;

		return new Promise((resolve, reject) => {
			// Create timeout handler
			const timeoutHandle = setTimeout(() => {
				const pending = this.pendingPermissions.get(callbackId);
				if (pending) {
					this.pendingPermissions.delete(callbackId);
					
					// Emit timeout resolution event
					const resolvedPayload: PermissionResolvedPayload = {
						callbackId,
						approved: false,
						timedOut: true,
					};
					this.emit('permission_resolved', resolvedPayload, sessionId, correlationId);

					this.output.appendLine(`[EventEmitter] Permission request timed out: ${callbackId}`);
					resolve(false); // Deny on timeout
				}
			}, timeout);

			// Store pending permission
			const pending: PendingPermission = {
				callbackId,
				sessionId,
				operation,
				description,
				requestedAt: new Date(),
				timeoutMs: timeout,
				resolve: (approved: boolean, resolvedBy?: string) => {
					clearTimeout(timeoutHandle);
					this.pendingPermissions.delete(callbackId);

					// Emit resolution event
					const resolvedPayload: PermissionResolvedPayload = {
						callbackId,
						approved,
						resolvedBy,
					};
					this.emit('permission_resolved', resolvedPayload, sessionId, correlationId);

					resolve(approved);
				},
				reject: (reason: string) => {
					clearTimeout(timeoutHandle);
					this.pendingPermissions.delete(callbackId);
					reject(new Error(reason));
				},
				timeoutHandle,
			};

			this.pendingPermissions.set(callbackId, pending);

			// Emit permission_requested event
			const payload: PermissionRequestedPayload = {
				operation,
				description,
				callbackId,
				timeoutMs: timeout,
			};
			this.emit('permission_requested', payload, sessionId, correlationId);

			this.output.appendLine(`[EventEmitter] Permission requested: ${operation} (${callbackId})`);
		});
	}

	/**
	 * Resolve a pending permission request.
	 * Called when client sends resolve_permission response.
	 */
	resolvePermission(callbackId: string, approved: boolean, resolvedBy?: string): boolean {
		const pending = this.pendingPermissions.get(callbackId);
		if (!pending) {
			this.output.appendLine(`[EventEmitter] Permission not found or already resolved: ${callbackId}`);
			return false;
		}

		pending.resolve(approved, resolvedBy);
		this.output.appendLine(`[EventEmitter] Permission resolved: ${callbackId} = ${approved ? 'approved' : 'denied'}`);
		return true;
	}

	/**
	 * Get list of pending permission requests.
	 */
	getPendingPermissions(): Array<{ callbackId: string; sessionId: string; operation: string; description: string; requestedAt: string; timeoutMs: number }> {
		return Array.from(this.pendingPermissions.values()).map(p => ({
			callbackId: p.callbackId,
			sessionId: p.sessionId,
			operation: p.operation,
			description: p.description,
			requestedAt: p.requestedAt.toISOString(),
			timeoutMs: p.timeoutMs,
		}));
	}

	// -------------------------------------------------------------------------
	// Event History
	// -------------------------------------------------------------------------

	/**
	 * Get event history with optional filtering.
	 */
	getEventHistory(eventTypes?: EventType[], sessionIds?: string[], limit?: number): ExtensionEvent[] {
		let events = this.eventHistory.getAll();

		// Apply filters
		if (eventTypes?.length) {
			events = events.filter(e => eventTypes.includes(e.type));
		}

		if (sessionIds?.length) {
			events = events.filter(e => e.sessionId && sessionIds.includes(e.sessionId));
		}

		// Apply limit (from most recent)
		if (limit && limit < events.length) {
			events = events.slice(-limit);
		}

		return events;
	}

	/**
	 * Clear event history (for testing).
	 */
	clearHistory(): void {
		this.eventHistory.clear();
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	/**
	 * Dispose of resources.
	 */
	dispose(): void {
		// Cancel all pending permissions
		for (const [callbackId, pending] of this.pendingPermissions) {
			clearTimeout(pending.timeoutHandle);
			pending.reject('Event emitter disposed');
			this.output.appendLine(`[EventEmitter] Cancelled pending permission on dispose: ${callbackId}`);
		}

		this.subscriptions.clear();
		this.rateLimitBuckets.clear();
		this.pendingPermissions.clear();
		this.eventHistory.clear();
	}
}
