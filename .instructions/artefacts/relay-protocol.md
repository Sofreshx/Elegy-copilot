# Relay Protocol Specification v1.0

**Status**: Draft  
**Created**: 2026-02-01  
**Last Updated**: 2026-02-01  
**Related Tasks**: task-000400, task-000401, task-000402, task-000403

---

## Table of Contents

1. [Protocol Overview](#1-protocol-overview)
2. [Message Envelope](#2-message-envelope)
3. [Authentication Flow](#3-authentication-flow)
4. [Command Types (Mobile → Extension)](#4-command-types-mobile--extension)
5. [Event Types (Extension → Mobile)](#5-event-types-extension--mobile)
6. [Error Codes](#6-error-codes)
7. [Rate Limiting](#7-rate-limiting)
8. [Security Considerations](#8-security-considerations)
9. [Example Messages](#9-example-messages)
10. [Versioning Strategy](#10-versioning-strategy)

---

## 1. Protocol Overview

### 1.1 Base Protocol

The relay protocol is built on **JSON-RPC 2.0** for request/response semantics, extended with:
- Relay envelope for cross-client routing
- Event notifications (server-initiated, no response expected)
- Connection lifecycle management (heartbeat, reconnection)

### 1.2 Transport

| Property | Value |
|----------|-------|
| **Transport** | WebSocket over TLS (WSS) |
| **Encoding** | UTF-8 |
| **Format** | JSON |
| **Compression** | Optional per-message deflate (RFC 7692) |
| **Max Message Size** | 64 KB (soft limit), 1 MB (hard limit) |

### 1.3 Connection Endpoints

```
wss://relay.example.com/v1/mobile      # Mobile app connections
wss://relay.example.com/v1/extension   # VS Code extension connections
```

### 1.4 Message Flow

```
┌────────┐      ┌───────────┐      ┌────────────┐
│ Mobile │◄────►│   Relay   │◄────►│ Extension  │
│  App   │      │  Service  │      │  (VS Code) │
└────────┘      └───────────┘      └────────────┘
     │                │                   │
     │  1. Connect    │                   │
     │ ──────────────►│                   │
     │                │                   │
     │  2. Auth       │                   │
     │ ──────────────►│                   │
     │                │                   │
     │  3. Command    │  4. Route         │
     │ ──────────────►│──────────────────►│
     │                │                   │
     │                │  5. Execute       │
     │                │◄──────────────────│
     │  6. Response   │                   │
     │◄───────────────│                   │
     │                │                   │
     │                │  7. Event         │
     │◄───────────────│◄──────────────────│
```

---

## 2. Message Envelope

### 2.1 Relay Envelope Structure

All messages passing through the relay are wrapped in an envelope for routing:

```typescript
interface RelayEnvelope {
  /** Protocol version */
  version: "1.0";
  
  /** Message ID (UUID v4) for correlation */
  messageId: string;
  
  /** ISO 8601 timestamp of message creation */
  timestamp: string;
  
  /** Message origin */
  source: {
    /** Client type */
    type: "mobile" | "extension" | "relay";
    /** Unique client identifier */
    clientId: string;
    /** Optional user identifier */
    userId?: string;
  };
  
  /** Message destination */
  target: {
    /** Target type */
    type: "mobile" | "extension" | "relay" | "broadcast";
    /** Specific client ID (required unless broadcast) */
    clientId?: string;
    /** Target all clients of a user */
    userId?: string;
  };
  
  /** The actual JSON-RPC payload */
  payload: WsRequest | WsResponse | WsNotification;
  
  /** Optional metadata */
  meta?: {
    /** Request priority (default: normal) */
    priority?: "low" | "normal" | "high";
    /** Time-to-live in seconds (default: 300) */
    ttl?: number;
    /** Trace ID for distributed tracing */
    traceId?: string;
  };
}
```

### 2.2 Direct Messages (Extension ↔ Mobile)

For direct client-to-client communication:

```json
{
  "version": "1.0",
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-02-01T12:00:00.000Z",
  "source": {
    "type": "mobile",
    "clientId": "mob-abc123",
    "userId": "github|12345"
  },
  "target": {
    "type": "extension",
    "clientId": "ext-def456"
  },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "get_status",
    "params": {}
  }
}
```

### 2.3 Broadcast Messages (Extension → All Mobile)

For events that should reach all mobile clients of a user:

```json
{
  "version": "1.0",
  "messageId": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2026-02-01T12:00:00.000Z",
  "source": {
    "type": "extension",
    "clientId": "ext-def456"
  },
  "target": {
    "type": "broadcast",
    "userId": "github|12345"
  },
  "payload": {
    "jsonrpc": "2.0",
    "method": "session_event",
    "params": {
      "type": "session_progress",
      "sessionId": "sess-001",
      "payload": { "message": "Reading files...", "percentage": 25 }
    }
  }
}
```

---

## 3. Authentication Flow

### 3.1 Overview

Authentication uses GitHub OAuth for identity, with JWT tokens for stateless relay authentication.

```
┌────────┐     ┌───────────┐     ┌────────┐     ┌───────────┐
│ Mobile │     │  Relay    │     │ GitHub │     │ Extension │
│  App   │     │  Service  │     │  OAuth │     │           │
└───┬────┘     └─────┬─────┘     └────┬───┘     └─────┬─────┘
    │                │                │               │
    │ 1. Start OAuth │                │               │
    │───────────────►│                │               │
    │                │                │               │
    │ 2. Redirect URL│                │               │
    │◄───────────────│                │               │
    │                │                │               │
    │ 3. User Login  │                │               │
    │────────────────────────────────►│               │
    │                │                │               │
    │ 4. Auth Code   │                │               │
    │◄────────────────────────────────│               │
    │                │                │               │
    │ 5. Exchange Code                │               │
    │───────────────►│                │               │
    │                │ 6. Verify Code │               │
    │                │───────────────►│               │
    │                │ 7. User Info   │               │
    │                │◄───────────────│               │
    │                │                │               │
    │ 8. JWT Tokens  │                │               │
    │◄───────────────│                │               │
    │                │                │               │
    │ 9. Connect WSS │                │               │
    │───────────────►│                │               │
```

### 3.2 JWT Token Format

#### Access Token Claims

```typescript
interface AccessTokenClaims {
  /** Subject (GitHub user ID) */
  sub: string;
  
  /** Issued at (Unix timestamp) */
  iat: number;
  
  /** Expiration (Unix timestamp) - 1 hour */
  exp: number;
  
  /** Token ID (for revocation) */
  jti: string;
  
  /** Client identifier */
  client_id: string;
  
  /** Client type */
  client_type: "mobile" | "extension";
  
  /** Granted scopes */
  scopes: string[];
  
  /** GitHub username */
  github_login: string;
  
  /** Issuer */
  iss: "instruction-engine-relay";
  
  /** Audience */
  aud: "instruction-engine";
}
```

#### Token Scopes

| Scope | Description |
|-------|-------------|
| `read:status` | Read extension status |
| `read:sessions` | View session list and status |
| `write:sessions` | Start/stop sessions |
| `read:events` | Subscribe to events |
| `write:permissions` | Resolve permission requests |
| `read:clients` | View connected clients |
| `admin:clients` | Disconnect other clients |

#### Default Scope Grants

| Client Type | Default Scopes |
|-------------|----------------|
| Mobile | `read:status`, `read:sessions`, `write:sessions`, `read:events`, `write:permissions`, `read:clients` |
| Extension | All scopes |

### 3.3 Token Lifecycle

#### Initial Authentication

```typescript
// POST /auth/github/callback
interface AuthCallbackRequest {
  code: string;           // GitHub OAuth code
  state: string;          // CSRF state token
  client_type: "mobile" | "extension";
  device_id?: string;     // Optional device fingerprint
}

interface AuthCallbackResponse {
  access_token: string;   // JWT, expires in 1 hour
  refresh_token: string;  // Opaque, expires in 30 days
  token_type: "Bearer";
  expires_in: number;     // Seconds until access token expiry
  scopes: string[];
  user: {
    id: string;
    login: string;
    avatar_url: string;
  };
}
```

#### Token Refresh

```typescript
// POST /auth/refresh
interface RefreshRequest {
  refresh_token: string;
}

interface RefreshResponse {
  access_token: string;
  refresh_token: string;  // Rotated
  token_type: "Bearer";
  expires_in: number;
}
```

#### Token Revocation

```typescript
// POST /auth/revoke
interface RevokeRequest {
  token: string;          // Access or refresh token
  token_type_hint?: "access_token" | "refresh_token";
}
// Returns 200 OK (always succeeds)
```

### 3.4 WebSocket Authentication

Tokens are passed during WebSocket connection:

```
wss://relay.example.com/v1/mobile?token=<jwt>
```

Or via first message after connection:

```json
{
  "jsonrpc": "2.0",
  "id": "auth-001",
  "method": "authenticate",
  "params": {
    "token": "<jwt>"
  }
}
```

---

## 4. Command Types (Mobile → Extension)

### 4.1 Command Classification

Commands are classified by security impact:

| Classification | Description | Requires Scope |
|---------------|-------------|----------------|
| **Safe** | Read-only, no side effects | Varies |
| **Sensitive** | Modifies state, requires confirmation | Varies |
| **Admin** | System-level operations | `admin:*` |

### 4.2 Command Reference

#### 4.2.1 `get_status` (Safe)

Get extension status and health information.

**Required Scope**: `read:status`

**Parameters**: None

**Response**:
```typescript
interface GetStatusResult {
  version: string;
  activeWorkspaces: string[];
  connectedClients: number;
  uptime: number;  // seconds
}
```

**Example**:
```json
// Request
{ "jsonrpc": "2.0", "id": "1", "method": "get_status" }

// Response
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "version": "1.2.3",
    "activeWorkspaces": ["/home/user/project"],
    "connectedClients": 2,
    "uptime": 3600
  }
}
```

---

#### 4.2.2 `list_agents` (Safe)

List available agent configurations.

**Required Scope**: `read:sessions`

**Parameters**: None

**Response**:
```typescript
interface ListAgentsResult {
  agents: Array<{
    name: string;
    description?: string;
    modes?: string[];
  }>;
}
```

---

#### 4.2.3 `invoke_agent` (Sensitive)

Start a new agent session with the specified agent and prompt.

**Required Scope**: `write:sessions`

**Parameters**:
```typescript
interface InvokeAgentParams {
  agentName: string;   // e.g., "@executive2-planner"
  prompt: string;      // Task description
}
```

**Response**:
```typescript
interface InvokeAgentResult {
  sessionId: string;
  status: "started" | "queued";
}
```

**Example**:
```json
// Request
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "invoke_agent",
  "params": {
    "agentName": "@debugger",
    "prompt": "Investigate the failing test in utils.test.ts"
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "sessionId": "sess-abc123",
    "status": "started"
  }
}
```

---

#### 4.2.4 `get_sessions` (Safe)

Get list of active and recent sessions.

**Required Scope**: `read:sessions`

**Parameters**:
```typescript
interface GetSessionsParams {
  status?: "active" | "completed" | "error" | "all";
  limit?: number;  // default: 20
}
```

**Response**:
```typescript
interface GetSessionsResult {
  sessions: Array<{
    sessionId: string;
    agent: string;
    prompt: string;
    status: "active" | "completed" | "error" | "cancelled";
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
  }>;
}
```

---

#### 4.2.5 `cancel_session` (Sensitive)

Cancel an active agent session.

**Required Scope**: `write:sessions`

**Parameters**:
```typescript
interface CancelSessionParams {
  sessionId: string;
}
```

**Response**:
```typescript
interface CancelSessionResult {
  success: boolean;
  sessionId: string;
}
```

---

#### 4.2.6 `subscribe_events` (Safe)

Subscribe to event notifications with optional filtering.

**Required Scope**: `read:events`

**Parameters**:
```typescript
interface SubscribeEventsParams {
  eventTypes?: EventType[];   // Filter by event type
  sessionIds?: string[];      // Filter by session
}

type EventType =
  | "session_started"
  | "session_progress"
  | "session_completed"
  | "session_error"
  | "tool_called"
  | "permission_requested"
  | "permission_resolved";
```

**Response**:
```typescript
interface SubscribeEventsResult {
  subscribed: boolean;
  eventTypes: EventType[] | "all";
  sessionIds: string[] | "all";
}
```

---

#### 4.2.7 `unsubscribe_events` (Safe)

Unsubscribe from event notifications.

**Required Scope**: `read:events`

**Parameters**: Same as `subscribe_events`

**Response**: `{ "success": true }`

---

#### 4.2.8 `get_event_history` (Safe)

Retrieve recent events from the history buffer.

**Required Scope**: `read:events`

**Parameters**:
```typescript
interface GetEventHistoryParams {
  eventTypes?: EventType[];
  sessionIds?: string[];
  limit?: number;  // default: 50, max: 100
}
```

**Response**:
```typescript
interface GetEventHistoryResult {
  events: ExtensionEvent[];
}
```

---

#### 4.2.9 `resolve_permission` (Sensitive)

Approve or deny a permission request from an agent.

**Required Scope**: `write:permissions`

**Parameters**:
```typescript
interface ResolvePermissionParams {
  callbackId: string;
  approved: boolean;
  resolvedBy?: string;  // Optional: identifier of approver
}
```

**Response**:
```typescript
interface ResolvePermissionResult {
  success: boolean;
  callbackId: string;
  alreadyResolved?: boolean;
}
```

---

#### 4.2.10 `get_pending_permissions` (Safe)

Get list of pending permission requests awaiting resolution.

**Required Scope**: `write:permissions`

**Parameters**: None

**Response**:
```typescript
interface GetPendingPermissionsResult {
  permissions: Array<{
    callbackId: string;
    sessionId: string;
    operation: string;
    description: string;
    requestedAt: string;
    timeoutMs: number;
  }>;
}
```

---

#### 4.2.11 `execute_command` (Sensitive)

Execute a VS Code command by ID.

**Required Scope**: `write:sessions`

**Parameters**:
```typescript
interface ExecuteCommandParams {
  command: string;     // VS Code command ID
  args?: unknown[];    // Command arguments
}
```

**Response**: Command-specific result

**Security Note**: Commands must be on the allowlist (see Section 8.1).

---

#### 4.2.12 `list_clients` (Safe)

List connected clients.

**Required Scope**: `read:clients`

**Parameters**: None

**Response**:
```typescript
interface ListClientsResult {
  clients: Array<{
    clientId: string;
    clientType: "mobile" | "extension";
    connectedAt: string;
    lastSeen: string;
  }>;
}
```

---

#### 4.2.13 `get_client` (Safe)

Get details about a specific client.

**Required Scope**: `read:clients`

**Parameters**:
```typescript
interface GetClientParams {
  clientId: string;
}
```

---

#### 4.2.14 `disconnect_client` (Admin)

Forcibly disconnect a client.

**Required Scope**: `admin:clients`

**Parameters**:
```typescript
interface DisconnectClientParams {
  clientId: string;
  reason?: string;
}
```

---

#### 4.2.15 `pong` (Safe)

Client heartbeat response (to relay's `ping`).

**Required Scope**: None (always allowed)

**Parameters**:
```typescript
interface PongParams {
  timestamp?: number;  // Echo back server timestamp
}
```

---

## 5. Event Types (Extension → Mobile)

### 5.1 Event Structure

All events follow this structure:

```typescript
interface ExtensionEvent {
  type: EventType;
  sessionId?: string;
  correlationId: string;
  timestamp: string;  // ISO 8601
  payload: unknown;   // Type-specific payload
}
```

### 5.2 Event Reference

#### 5.2.1 `session_started`

Emitted when a new agent session begins.

**Payload**:
```typescript
interface SessionStartedPayload {
  agent: string;    // Agent name (e.g., "@debugger")
  prompt: string;   // User's prompt/task
}
```

---

#### 5.2.2 `session_progress`

Emitted periodically during session execution.

**Payload**:
```typescript
interface SessionProgressPayload {
  message: string;       // Human-readable progress message
  percentage?: number;   // 0-100 if determinable
}
```

---

#### 5.2.3 `session_completed`

Emitted when a session finishes successfully.

**Payload**:
```typescript
interface SessionCompletedPayload {
  durationMs: number;     // Total execution time
  toolCallCount: number;  // Number of tools invoked
  response?: string;      // Final response text (truncated)
}
```

---

#### 5.2.4 `session_error`

Emitted when a session fails.

**Payload**:
```typescript
interface SessionErrorPayload {
  message: string;   // Error description
  code?: string;     // Error code if available
}
```

---

#### 5.2.5 `tool_called`

Emitted when the agent invokes a tool.

**Payload**:
```typescript
interface ToolCalledPayload {
  tool: string;         // Tool name
  durationMs?: number;  // Execution time
  error?: string;       // Error message if failed
}
```

---

#### 5.2.6 `permission_requested`

Emitted when the agent requires user approval.

**Payload**:
```typescript
interface PermissionRequestedPayload {
  operation: string;    // Operation type (e.g., "file_edit")
  description: string;  // Human-readable description
  callbackId: string;   // ID for resolution
  timeoutMs: number;    // Time until auto-deny
}
```

---

#### 5.2.7 `permission_resolved`

Emitted when a permission request is resolved.

**Payload**:
```typescript
interface PermissionResolvedPayload {
  callbackId: string;
  approved: boolean;
  resolvedBy?: string;   // Who resolved it
  timedOut?: boolean;    // True if auto-denied
}
```

---

## 6. Error Codes

### 6.1 Standard JSON-RPC Errors

| Code | Message | Description |
|------|---------|-------------|
| `-32700` | Parse error | Invalid JSON |
| `-32600` | Invalid Request | Missing required fields |
| `-32601` | Method not found | Unknown method |
| `-32602` | Invalid params | Parameter validation failed |
| `-32603` | Internal error | Server-side error |

### 6.2 Custom Error Codes

| Code | Name | Description |
|------|------|-------------|
| `-32001` | `UNAUTHORIZED` | Invalid or expired token |
| `-32002` | `COMMAND_FAILED` | Command execution failed |
| `-32003` | `RATE_LIMITED` | Too many requests |
| `-32004` | `FORBIDDEN` | Insufficient scope |
| `-32005` | `NOT_FOUND` | Resource not found (session, client) |
| `-32006` | `CONFLICT` | State conflict (duplicate, already resolved) |
| `-32007` | `TIMEOUT` | Operation timed out |
| `-32008` | `COMMAND_NOT_ALLOWED` | Command not on allowlist |
| `-32009` | `CLIENT_OFFLINE` | Target client not connected |
| `-32010` | `QUOTA_EXCEEDED` | User quota exceeded |

### 6.3 Error Response Structure

```typescript
interface WsError {
  code: number;
  message: string;
  data?: {
    details?: string;
    retryAfter?: number;   // For rate limits
    field?: string;        // For validation errors
  };
}
```

**Example**:
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "error": {
    "code": -32003,
    "message": "Rate limited",
    "data": {
      "details": "Too many requests",
      "retryAfter": 60
    }
  }
}
```

---

## 7. Rate Limiting

### 7.1 Global Limits

| Limit | Value | Scope |
|-------|-------|-------|
| **Connections per user** | 5 mobile + 10 extension | Per GitHub user |
| **Messages per second** | 100 | Per client |
| **Auth attempts** | 10/minute | Per IP |
| **Token refresh** | 60/hour | Per user |

### 7.2 Per-Command Limits

| Command | Limit | Window |
|---------|-------|--------|
| `invoke_agent` | 10 | per minute |
| `execute_command` | 30 | per minute |
| `cancel_session` | 20 | per minute |
| `resolve_permission` | 50 | per minute |
| `subscribe_events` | 5 | per minute |
| `get_*` (read ops) | 100 | per minute |

### 7.3 Rate Limit Headers (REST Endpoints)

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1706806800
```

### 7.4 Rate Limit Response

When rate limited, the relay returns:

```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "error": {
    "code": -32003,
    "message": "Rate limited",
    "data": {
      "retryAfter": 60,
      "limit": 10,
      "window": 60
    }
  }
}
```

### 7.5 Token Bucket Implementation

Rate limiting uses a token bucket algorithm:

- **Capacity**: Command-specific (see table above)
- **Refill Rate**: 1 token per second
- **Burst**: Up to bucket capacity

---

## 8. Security Considerations

### 8.1 Command Allowlist

Only explicitly allowlisted VS Code commands can be executed remotely:

```typescript
const ALLOWED_COMMANDS = [
  // Instruction Engine commands
  "instruction-engine.invokeAgent",
  "instruction-engine.showAgents",
  "instruction-engine.showTasks",
  "instruction-engine.refreshTrees",
  
  // Read-only VS Code commands
  "workbench.action.files.openFile",
  "workbench.view.explorer",
  
  // Safe navigation
  "revealLine",
  "workbench.action.gotoLine",
];

// Never allowed (examples)
const BLOCKED_PATTERNS = [
  /^workbench\.action\.terminal/,    // Terminal access
  /^vscode\.executeCode/,            // Code execution
  /^extension\.install/,             // Extension management
  /delete/i,                          // Delete operations
];
```

### 8.2 Replay Attack Prevention

1. **Message timestamps**: Messages older than 5 minutes are rejected
2. **Nonce tracking**: Each `messageId` is cached for 10 minutes; duplicates rejected
3. **Sequence numbers**: Clients maintain incrementing sequence; out-of-order rejected

```typescript
interface ReplayPrevention {
  maxAge: 300000;           // 5 minutes
  nonceCache: LRUCache;     // 10-minute TTL
  sequenceWindow: 1000;     // Accept within window
}
```

### 8.3 Message Signing (Optional)

For high-security deployments, messages can be signed:

```typescript
interface SignedEnvelope extends RelayEnvelope {
  signature: {
    algorithm: "HMAC-SHA256" | "Ed25519";
    value: string;  // Base64-encoded signature
    keyId: string;  // Key identifier
  };
}
```

### 8.4 DoS Mitigation

1. **Connection limits**: Max 5 mobile + 10 extension per user
2. **Message size limits**: Reject messages > 1 MB
3. **Slow client handling**: Disconnect clients with > 100 pending messages
4. **Invalid message throttling**: Disconnect after 10 consecutive invalid messages
5. **Backpressure**: Extension can signal "busy" to pause mobile commands

### 8.5 Data Sensitivity

| Data Type | Handling |
|-----------|----------|
| Session prompts | Stored encrypted, purged after 24h |
| File paths | Logged only, not stored |
| File contents | Never transmitted through relay |
| Credentials | Never included in messages |
| Error stack traces | Sanitized before transmission |

### 8.6 Audit Logging

All commands are logged with:

```typescript
interface AuditEntry {
  timestamp: string;
  userId: string;
  clientId: string;
  method: string;
  params: Record<string, unknown>;  // Sanitized
  result: "success" | "error";
  errorCode?: number;
  latencyMs: number;
  sourceIp: string;  // Hashed for privacy
}
```

---

## 9. Example Messages

### 9.1 Complete Authentication Flow

**Step 1: Mobile initiates OAuth**
```
GET https://relay.example.com/auth/github?
    client_type=mobile&
    state=abc123&
    redirect_uri=instruction-engine://callback
```

**Step 2: After GitHub redirect, exchange code**
```json
POST /auth/github/callback
{
  "code": "github_oauth_code",
  "state": "abc123",
  "client_type": "mobile"
}

Response:
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2ggdG9rZW4...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scopes": ["read:status", "read:sessions", "write:sessions", "read:events", "write:permissions"],
  "user": {
    "id": "github|12345",
    "login": "developer",
    "avatar_url": "https://avatars.githubusercontent.com/u/12345"
  }
}
```

**Step 3: Connect WebSocket**
```
wss://relay.example.com/v1/mobile?token=eyJhbGciOiJIUzI1NiIs...
```

### 9.2 Starting an Agent Session

**Request (Mobile → Relay → Extension)**:
```json
{
  "version": "1.0",
  "messageId": "msg-001",
  "timestamp": "2026-02-01T12:00:00.000Z",
  "source": { "type": "mobile", "clientId": "mob-abc", "userId": "github|12345" },
  "target": { "type": "extension", "clientId": "ext-def" },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "invoke_agent",
    "params": {
      "agentName": "@debugger",
      "prompt": "Investigate failing test in auth.test.ts"
    }
  }
}
```

**Response (Extension → Relay → Mobile)**:
```json
{
  "version": "1.0",
  "messageId": "msg-002",
  "timestamp": "2026-02-01T12:00:01.000Z",
  "source": { "type": "extension", "clientId": "ext-def" },
  "target": { "type": "mobile", "clientId": "mob-abc" },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-001",
    "result": {
      "sessionId": "sess-xyz789",
      "status": "started"
    }
  }
}
```

### 9.3 Permission Request Flow

**Event: Permission Requested (Extension → Mobile)**:
```json
{
  "version": "1.0",
  "messageId": "msg-003",
  "timestamp": "2026-02-01T12:00:30.000Z",
  "source": { "type": "extension", "clientId": "ext-def" },
  "target": { "type": "broadcast", "userId": "github|12345" },
  "payload": {
    "jsonrpc": "2.0",
    "method": "session_event",
    "params": {
      "type": "permission_requested",
      "sessionId": "sess-xyz789",
      "correlationId": "corr-001",
      "timestamp": "2026-02-01T12:00:30.000Z",
      "payload": {
        "operation": "file_edit",
        "description": "Edit src/auth/handler.ts (lines 45-60)",
        "callbackId": "perm-001",
        "timeoutMs": 60000
      }
    }
  }
}
```

**Command: Resolve Permission (Mobile → Extension)**:
```json
{
  "version": "1.0",
  "messageId": "msg-004",
  "timestamp": "2026-02-01T12:00:45.000Z",
  "source": { "type": "mobile", "clientId": "mob-abc", "userId": "github|12345" },
  "target": { "type": "extension", "clientId": "ext-def" },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-002",
    "method": "resolve_permission",
    "params": {
      "callbackId": "perm-001",
      "approved": true,
      "resolvedBy": "mobile-user"
    }
  }
}
```

### 9.4 Heartbeat (Ping/Pong)

**Server Ping**:
```json
{
  "jsonrpc": "2.0",
  "method": "ping",
  "params": { "timestamp": 1706788800000 }
}
```

**Client Pong**:
```json
{
  "jsonrpc": "2.0",
  "id": "pong-001",
  "method": "pong",
  "params": { "timestamp": 1706788800000 }
}
```

---

## 10. Versioning Strategy

### 10.1 Protocol Versioning

The protocol uses semantic versioning in the envelope:

```json
{ "version": "1.0", ... }
```

- **Major version** (1.x): Breaking changes require client updates
- **Minor version** (x.0): Backward-compatible additions

### 10.2 Backward Compatibility

1. **Unknown fields are ignored**: Clients must tolerate extra fields
2. **Optional fields remain optional**: New fields default to backward-compatible values
3. **Method versioning**: New methods use new names (e.g., `invoke_agent_v2`)
4. **Deprecation**: 6-month deprecation window with relay warnings

### 10.3 Version Negotiation

On connection, clients send supported versions:

```json
{
  "jsonrpc": "2.0",
  "id": "init",
  "method": "initialize",
  "params": {
    "protocolVersions": ["1.0", "1.1"],
    "clientVersion": "2.0.0",
    "capabilities": ["compression", "signing"]
  }
}
```

Server responds with selected version:

```json
{
  "jsonrpc": "2.0",
  "id": "init",
  "result": {
    "protocolVersion": "1.0",
    "serverVersion": "1.5.0",
    "capabilities": ["compression"]
  }
}
```

---

## Appendix A: TypeScript Type Definitions

```typescript
// Full type definitions for relay protocol
// Copy to: shared/relay-protocol.d.ts

export type ClientType = "mobile" | "extension" | "relay";
export type TargetType = ClientType | "broadcast";

export interface RelayEnvelope {
  version: "1.0";
  messageId: string;
  timestamp: string;
  source: { type: ClientType; clientId: string; userId?: string };
  target: { type: TargetType; clientId?: string; userId?: string };
  payload: WsRequest | WsResponse | WsNotification;
  meta?: { priority?: "low" | "normal" | "high"; ttl?: number; traceId?: string };
}

export type WsMethod =
  | "execute_command" | "get_status" | "subscribe_events" | "unsubscribe_events"
  | "invoke_agent" | "get_sessions" | "cancel_session" | "list_agents"
  | "get_event_history" | "resolve_permission" | "get_pending_permissions"
  | "list_clients" | "get_client" | "disconnect_client" | "pong" | "initialize";

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
  error: { code: number; message: string; data?: unknown };
}

export type WsResponse = WsSuccessResponse | WsErrorResponse;

export interface WsNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export type EventType =
  | "session_started" | "session_progress" | "session_completed"
  | "session_error" | "tool_called" | "permission_requested" | "permission_resolved";

export interface ExtensionEvent {
  type: EventType;
  sessionId?: string;
  correlationId: string;
  timestamp: string;
  payload: unknown;
}
```

---

## Appendix B: Quick Reference Card

### Commands (Mobile → Extension)

| Method | Scope | Classification |
|--------|-------|----------------|
| `get_status` | `read:status` | Safe |
| `list_agents` | `read:sessions` | Safe |
| `get_sessions` | `read:sessions` | Safe |
| `invoke_agent` | `write:sessions` | Sensitive |
| `cancel_session` | `write:sessions` | Sensitive |
| `subscribe_events` | `read:events` | Safe |
| `unsubscribe_events` | `read:events` | Safe |
| `get_event_history` | `read:events` | Safe |
| `resolve_permission` | `write:permissions` | Sensitive |
| `get_pending_permissions` | `write:permissions` | Safe |
| `execute_command` | `write:sessions` | Sensitive |
| `list_clients` | `read:clients` | Safe |
| `get_client` | `read:clients` | Safe |
| `disconnect_client` | `admin:clients` | Admin |
| `pong` | (none) | Safe |

### Events (Extension → Mobile)

| Event | Description |
|-------|-------------|
| `session_started` | Agent session began |
| `session_progress` | Progress update |
| `session_completed` | Session finished successfully |
| `session_error` | Session failed |
| `tool_called` | Agent invoked a tool |
| `permission_requested` | Approval needed |
| `permission_resolved` | Permission decision made |

### Error Codes

| Code | Name |
|------|------|
| `-32001` | UNAUTHORIZED |
| `-32003` | RATE_LIMITED |
| `-32004` | FORBIDDEN |
| `-32008` | COMMAND_NOT_ALLOWED |

---

**End of Specification**
