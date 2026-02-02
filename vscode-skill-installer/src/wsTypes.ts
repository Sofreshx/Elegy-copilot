/**
 * WebSocket protocol types for mobile companion communication.
 * Implements JSON-RPC 2.0 style messaging.
 */

import type { EventType } from './eventEmitter';

/** Supported JSON-RPC methods */
export type WsMethod =
	| 'execute_command'
	| 'get_status'
	| 'subscribe_events'
	| 'unsubscribe_events'
	| 'invoke_agent'
	| 'get_sessions'
	| 'cancel_session'
	| 'list_agents'
	| 'get_event_history'
	| 'resolve_permission'
	| 'get_pending_permissions'
	| 'list_clients'
	| 'get_client'
	| 'disconnect_client'
	| 'pong';

/** JSON-RPC 2.0 Request */
export interface WsRequest {
	jsonrpc: '2.0';
	id: string;
	method: WsMethod;
	params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 Success Response */
export interface WsSuccessResponse {
	jsonrpc: '2.0';
	id: string;
	result: unknown;
}

/** JSON-RPC 2.0 Error Response */
export interface WsErrorResponse {
	jsonrpc: '2.0';
	id: string;
	error: WsError;
}

/** JSON-RPC Error object */
export interface WsError {
	code: number;
	message: string;
	data?: unknown;
}

/** Combined response type */
export type WsResponse = WsSuccessResponse | WsErrorResponse;

/** Notification (server-initiated, no id) */
export interface WsNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record<string, unknown>;
}

/** Standard JSON-RPC error codes */
export const WsErrorCodes = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	// Custom error codes (reserved -32000 to -32099)
	UNAUTHORIZED: -32001,
	COMMAND_FAILED: -32002,
	RATE_LIMITED: -32003,
} as const;

/** Parameters for execute_command method */
export interface ExecuteCommandParams {
	command: string;
	args?: unknown[];
}

/** Parameters for subscribe_events method */
export interface SubscribeEventsParams {
	events?: string[];        // Legacy: event names like 'session_event', '*'
	eventTypes?: EventType[]; // New: typed event filtering
	sessionIds?: string[];    // Optional: filter by session IDs
}

/** Parameters for unsubscribe_events method */
export interface UnsubscribeEventsParams {
	events?: string[];        // Legacy: event names
	eventTypes?: EventType[]; // New: typed event filtering
	sessionIds?: string[];    // Optional: filter by session IDs
}

/** Parameters for get_event_history method */
export interface GetEventHistoryParams {
	eventTypes?: EventType[]; // Filter by event types
	sessionIds?: string[];    // Filter by session IDs
	limit?: number;           // Max events to return (default: 50)
}

/** Parameters for resolve_permission method */
export interface ResolvePermissionParams {
	callbackId: string;       // The callback ID from permission_requested event
	approved: boolean;        // true = approved, false = denied
	resolvedBy?: string;      // Optional: who resolved (e.g., user ID)
}

/** Extension status response */
export interface ExtensionStatus {
	version: string;
	activeWorkspaces: string[];
	connectedClients: number;
	uptime: number;
}

/** Client connection info (internal tracking) */
export interface ClientInfo {
	id: string;
	connectedAt: Date;
	subscribedEvents: Set<string>;
	userId?: string;
}

/** Parameters for invoke_agent method */
export interface InvokeAgentParams {
	agentName: string;
	prompt: string;
}

/** Parameters for cancel_session method */
export interface CancelSessionParams {
	sessionId: string;
}

/** Parameters for get_client method */
export interface GetClientParams {
	clientId: string;
}

/** Parameters for disconnect_client method */
export interface DisconnectClientParams {
	clientId: string;
}

/** Parameters for pong method (client heartbeat response) */
export interface PongParams {
	timestamp?: number;
}

/** Supported methods for validation */
const SUPPORTED_METHODS = [
	'execute_command',
	'get_status',
	'subscribe_events',
	'unsubscribe_events',
	'invoke_agent',
	'get_sessions',
	'cancel_session',
	'list_agents',
	'get_event_history',
	'resolve_permission',
	'get_pending_permissions',
	'list_clients',
	'get_client',
	'disconnect_client',
	'pong',
];

/** Validates if a message is a valid WsRequest */
export function isValidRequest(msg: unknown): msg is WsRequest {
	if (!msg || typeof msg !== 'object') {
		return false;
	}
	const obj = msg as Record<string, unknown>;
	return (
		obj.jsonrpc === '2.0' &&
		typeof obj.id === 'string' &&
		typeof obj.method === 'string' &&
		SUPPORTED_METHODS.includes(obj.method as string)
	);
}

/** Creates a success response */
export function createSuccessResponse(id: string, result: unknown): WsSuccessResponse {
	return { jsonrpc: '2.0', id, result };
}

/** Creates an error response */
export function createErrorResponse(id: string, code: number, message: string, data?: unknown): WsErrorResponse {
	const error: WsError = { code, message };
	if (data !== undefined) {
		error.data = data;
	}
	return { jsonrpc: '2.0', id, error };
}

/** Creates a notification (no id, server-initiated) */
export function createNotification(method: string, params?: Record<string, unknown>): WsNotification {
	const notification: WsNotification = { jsonrpc: '2.0', method };
	if (params !== undefined) {
		notification.params = params;
	}
	return notification;
}
