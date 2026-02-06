# Relay API Reference

This document describes the API endpoints and WebSocket protocol for the Cloud Relay service.

## Base URL

```
Production: https://relay.sfrsh.xyz
Development: http://localhost:3000
```

## Authentication

- OAuth HTTP endpoints do not require a JWT.
- WebSocket connections require authentication when `REQUIRE_AUTH` is true (default).
- Provide a JWT in the `token` query parameter or send a JSON-RPC `authenticate` message.

## REST Endpoints

### Authentication

#### POST /auth/login
Initiate GitHub OAuth login flow.

**Request:**
```json
{
  "redirect_uri": "string",
  "state": "string (optional)",
  "scope": "string or array (optional)"
}
```

**Response:**
```json
{
  "auth_url": "https://github.com/login/oauth/authorize?...",
  "state": "string"
}
```

#### POST /auth/callback
Exchange OAuth code for tokens.

**Request:**
```json
{
  "code": "string",
  "redirect_uri": "string",
  "state": "string (optional)"
}
```

**Response (pass-through from GitHub token exchange):**
```json
{
  "access_token": "string",
  "token_type": "bearer",
  "scope": "read:user repo"
}
```

**Error Response:**
```json
{
  "error": "string",
  "error_description": "string"
}
```

### Health

#### GET /health
Returns service status and metrics.

#### GET /health/ready
Readiness probe.

#### GET /health/live
Liveness probe.

#### GET /health/metrics
Prometheus-style metrics (text/plain).

#### GET /health/dlq
Dead letter queue entries (debugging).

Query params:
- `limit` (number, optional)
- `clientId` (string, optional)

## WebSocket Protocol

### Connection

```
wss://relay.sfrsh.xyz/v1/ws?token=<jwt_token>
```

The WebSocket server listens on `/v1/ws`. Clients may provide the JWT in the
`token` query parameter or authenticate after connecting via JSON-RPC.

### JSON-RPC Message Format

```json
{
  "jsonrpc": "2.0",
  "id": "msg-123",
  "method": "initialize",
  "params": {}
}
```

### Authentication

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "auth-1",
  "method": "authenticate",
  "params": {
    "token": "<jwt_token>"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "auth-1",
  "result": {
    "authenticated": true,
    "clientId": "client-123",
    "userId": "github-user-id",
    "scopes": ["read:user", "repo"]
  }
}
```

### Supported JSON-RPC Methods

- `authenticate` - Authenticate a connection with a JWT.
- `pong` - Heartbeat response.
- `ack` - Acknowledge a message (params: `messageId`).
- `initialize` - Get protocol version and capabilities.
- `list_clients` - List connected clients for the authenticated user.
- `get_client` - Get details for a specific client (params: `clientId`).
- `join_group` - Join a group (params: `groupType`, `groupId`).
- `leave_group` - Leave a group (params: `groupType`, `groupId`).
- `list_group_members` - List members of a group (params: `groupType`, `groupId`).
- `list_my_groups` - List groups for the current client.
- `get_offline_queue_stats` - Get offline queue stats for the user.

### Relay Envelope (version 1.0)

Relay messages between clients use the envelope below. The `payload` can be a
JSON-RPC request/response/notification. The server validates `source.clientId`
against the authenticated client and rejects messages older than 5 minutes.

```json
{
  "version": "1.0",
  "messageId": "msg-123",
  "timestamp": "2026-02-05T12:34:56Z",
  "source": {
    "type": "mobile",
    "clientId": "client-123",
    "userId": "github-user-id"
  },
  "target": {
    "type": "extension",
    "clientId": "client-456",
    "userId": "github-user-id"
  },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-1",
    "method": "invoke_agent",
    "params": {
      "agent": "code-reviewer",
      "target_client": "client-456"
    }
  },
  "meta": {
    "priority": "normal",
    "ttl": 300000,
    "traceId": "trace-abc",
    "requireAck": true,
    "groupType": "workspace",
    "groupId": "workspace-123"
  }
}
```

### Error Codes (JSON-RPC)

| Code | Description |
|------|-------------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32001 | Unauthorized |
| -32002 | Command failed |
| -32003 | Rate limited |
| -32004 | Forbidden |
| -32005 | Not found |
| -32006 | Conflict |
| -32007 | Timeout |
| -32008 | Command not allowed |
| -32009 | Client offline |
| -32010 | Quota exceeded |
