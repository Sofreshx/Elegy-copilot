/**
 * Relay Protocol Types v1.0
 * Based on .instructions/artefacts/relay-protocol.md
 */

export type ClientType = "mobile" | "extension" | "relay";
export type TargetType = ClientType | "broadcast";

export interface RelayEnvelope {
  version: "1.0";
  messageId: string;
  timestamp: string;
  source: {
    type: ClientType;
    clientId: string;
    userId?: string;
  };
  target: {
    type: TargetType;
    clientId?: string;
    userId?: string;
  };
  payload: WsRequest | WsResponse | WsNotification;
  meta?: {
    priority?: "low" | "normal" | "high";
    ttl?: number;
    traceId?: string;
  };
}

export type WsMethod =
  | "authenticate"
  | "execute_command"
  | "get_status"
  | "subscribe_events"
  | "unsubscribe_events"
  | "invoke_agent"
  | "get_sessions"
  | "cancel_session"
  | "list_agents"
  | "get_event_history"
  | "resolve_permission"
  | "get_pending_permissions"
  | "list_clients"
  | "get_client"
  | "disconnect_client"
  | "pong"
  | "ack"
  | "initialize"
  | "join_group"
  | "leave_group"
  | "list_group_members"
  | "list_my_groups"
  | "get_offline_queue_stats";

export interface WsRequest {
  jsonrpc: "2.0";
  id: string;
  method: WsMethod;
  params?: Record<string, unknown>;
}

export interface WsSuccessResponse {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

export interface WsErrorResponse {
  jsonrpc: "2.0";
  id: string;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type WsResponse = WsSuccessResponse | WsErrorResponse;

export interface WsNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type EventType =
  | "session_started"
  | "session_progress"
  | "session_completed"
  | "session_error"
  | "tool_called"
  | "permission_requested"
  | "permission_resolved";

export interface ExtensionEvent {
  type: EventType;
  sessionId?: string;
  correlationId: string;
  timestamp: string;
  payload: unknown;
}

// JWT Token Claims
export interface AccessTokenClaims {
  sub: string; // GitHub user ID
  iat: number;
  exp: number;
  jti: string;
  client_id: string;
  client_type: "mobile" | "extension";
  scopes: string[];
  github_login: string;
  iss: string;
  aud: string;
}

// Connected client info
export interface ConnectedClient {
  clientId: string;
  clientType: "mobile" | "extension";
  userId: string;
  githubLogin: string;
  connectedAt: Date;
  lastSeen: Date;
  subscriptions: Set<EventType | "all">;
}

// Error codes
export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  COMMAND_FAILED: -32002,
  RATE_LIMITED: -32003,
  FORBIDDEN: -32004,
  NOT_FOUND: -32005,
  CONFLICT: -32006,
  TIMEOUT: -32007,
  COMMAND_NOT_ALLOWED: -32008,
  CLIENT_OFFLINE: -32009,
  QUOTA_EXCEEDED: -32010,
} as const;

// Default scopes per client type
export const DEFAULT_MOBILE_SCOPES = [
  "read:status",
  "read:sessions",
  "write:sessions",
  "read:events",
  "write:permissions",
  "read:clients",
];

export const DEFAULT_EXTENSION_SCOPES = [
  "read:status",
  "read:sessions",
  "write:sessions",
  "read:events",
  "write:permissions",
  "read:clients",
  "admin:clients",
];
