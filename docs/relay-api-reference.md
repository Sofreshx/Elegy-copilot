# Relay API Reference

This document describes the API endpoints and WebSocket messages for the Cloud Relay service.

## Base URL

```
Production: https://relay.your-domain.com
Development: http://localhost:3000
```

## Authentication

All endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

## REST Endpoints

### Authentication

#### POST /auth/login
Initiate GitHub OAuth login flow.

**Request:**
```json
{
  "redirect_uri": "string"
}
```

**Response:**
```json
{
  "auth_url": "https://github.com/login/oauth/authorize?..."
}
```

#### POST /auth/callback
Exchange OAuth code for tokens.

**Request:**
```json
{
  "code": "string",
  "state": "string"
}
```

**Response:**
```json
{
  "access_token": "string",
  "refresh_token": "string",
  "expires_in": 3600,
  "user": {
    "id": "string",
    "login": "string",
    "avatar_url": "string"
  }
}
```

#### POST /auth/refresh
Refresh an expired access token.

**Request:**
```json
{
  "refresh_token": "string"
}
```

**Response:**
```json
{
  "access_token": "string",
  "expires_in": 3600
}
```

#### POST /auth/logout
Invalidate current session.

**Response:**
```json
{
  "success": true
}
```

---

### Sessions

#### GET /sessions
List active sessions for the authenticated user.

**Response:**
```json
{
  "sessions": [
    {
      "id": "string",
      "status": "active" | "idle" | "completed" | "failed",
      "agent": "string",
      "started_at": "ISO8601",
      "last_activity": "ISO8601",
      "client_id": "string"
    }
  ]
}
```

#### GET /sessions/:id
Get session details.

**Response:**
```json
{
  "id": "string",
  "status": "string",
  "agent": "string",
  "prompt": "string",
  "started_at": "ISO8601",
  "completed_at": "ISO8601",
  "events": [
    {
      "type": "string",
      "timestamp": "ISO8601",
      "data": {}
    }
  ]
}
```

#### POST /sessions/:id/cancel
Cancel a running session.

**Response:**
```json
{
  "success": true,
  "message": "Session cancelled"
}
```

---

### Ideas

#### GET /ideas
List user's ideas.

**Query Parameters:**
- `status` - Filter by status (draft, queued, executed)
- `limit` - Max results (default: 50)
- `offset` - Pagination offset

**Response:**
```json
{
  "ideas": [
    {
      "id": "string",
      "title": "string",
      "content": "string",
      "status": "draft" | "queued" | "executed",
      "tags": ["string"],
      "created_at": "ISO8601",
      "updated_at": "ISO8601"
    }
  ],
  "total": 100,
  "has_more": true
}
```

#### POST /ideas
Create a new idea.

**Request:**
```json
{
  "title": "string",
  "content": "string",
  "tags": ["string"]
}
```

**Response:**
```json
{
  "id": "string",
  "title": "string",
  "content": "string",
  "status": "draft",
  "tags": ["string"],
  "created_at": "ISO8601"
}
```

#### PUT /ideas/:id
Update an existing idea.

**Request:**
```json
{
  "title": "string",
  "content": "string",
  "tags": ["string"],
  "status": "string"
}
```

#### DELETE /ideas/:id
Delete an idea.

**Response:**
```json
{
  "success": true
}
```

---

### Sync

#### POST /sync/push
Push local changes to relay.

**Request:**
```json
{
  "changes": [
    {
      "entity_type": "idea" | "checkpoint" | "reminder",
      "entity_id": "string",
      "operation": "create" | "update" | "delete",
      "data": {},
      "local_version": 1,
      "timestamp": "ISO8601"
    }
  ]
}
```

**Response:**
```json
{
  "results": [
    {
      "entity_id": "string",
      "success": true,
      "conflict": false,
      "server_version": 1
    }
  ]
}
```

#### GET /sync/pull
Pull changes since last sync.

**Query Parameters:**
- `since` - ISO8601 timestamp of last sync

**Response:**
```json
{
  "changes": [
    {
      "entity_type": "string",
      "entity_id": "string",
      "operation": "string",
      "data": {},
      "server_version": 1,
      "timestamp": "ISO8601"
    }
  ],
  "sync_token": "string"
}
```

---

## WebSocket Protocol

### Connection

```
wss://relay.your-domain.com/ws?token=<jwt_token>
```

### Message Format

All messages are JSON with the following structure:

```json
{
  "type": "string",
  "id": "string",
  "payload": {}
}
```

### Client → Server Messages

#### subscribe
Subscribe to session updates.

```json
{
  "type": "subscribe",
  "id": "msg-123",
  "payload": {
    "channels": ["sessions", "ideas", "workflows"]
  }
}
```

#### unsubscribe
Unsubscribe from channels.

```json
{
  "type": "unsubscribe",
  "id": "msg-124",
  "payload": {
    "channels": ["workflows"]
  }
}
```

#### invoke_agent
Request agent invocation.

```json
{
  "type": "invoke_agent",
  "id": "msg-125",
  "payload": {
    "agent": "code-reviewer",
    "prompt": "Review the recent changes",
    "target_client": "client-xyz"
  }
}
```

#### cancel_session
Cancel a running session.

```json
{
  "type": "cancel_session",
  "id": "msg-126",
  "payload": {
    "session_id": "session-abc"
  }
}
```

#### ping
Keep connection alive.

```json
{
  "type": "ping",
  "id": "msg-127",
  "payload": {
    "timestamp": 1234567890
  }
}
```

### Server → Client Messages

#### ack
Acknowledgment of received message.

```json
{
  "type": "ack",
  "id": "msg-123",
  "payload": {
    "success": true
  }
}
```

#### error
Error response.

```json
{
  "type": "error",
  "id": "msg-123",
  "payload": {
    "code": "UNAUTHORIZED",
    "message": "Invalid token"
  }
}
```

#### session_update
Session status change notification.

```json
{
  "type": "session_update",
  "id": null,
  "payload": {
    "session_id": "session-abc",
    "status": "completed",
    "agent": "code-reviewer",
    "result": {}
  }
}
```

#### idea_sync
Idea synchronization notification.

```json
{
  "type": "idea_sync",
  "id": null,
  "payload": {
    "operation": "create",
    "idea": {}
  }
}
```

#### workflow_status
GitHub Actions workflow status.

```json
{
  "type": "workflow_status",
  "id": null,
  "payload": {
    "run_id": 12345,
    "status": "completed",
    "conclusion": "success"
  }
}
```

#### pong
Response to ping.

```json
{
  "type": "pong",
  "id": "msg-127",
  "payload": {
    "timestamp": 1234567890
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or expired token |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Sync conflict detected |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/auth/*` | 10 req/min |
| `/sessions/*` | 60 req/min |
| `/ideas/*` | 120 req/min |
| `/sync/*` | 30 req/min |
| WebSocket messages | 100 msg/min |

---

## SDK Examples

### JavaScript/TypeScript

```typescript
import { RelayClient } from '@instruction-engine/relay-sdk';

const client = new RelayClient({
  baseUrl: 'https://relay.your-domain.com',
  token: 'your-jwt-token',
});

// List sessions
const sessions = await client.sessions.list();

// Subscribe to updates
client.subscribe(['sessions'], (event) => {
  console.log('Session update:', event);
});

// Create idea
const idea = await client.ideas.create({
  title: 'New feature idea',
  content: 'Implement caching for...',
  tags: ['performance'],
});
```

### cURL

```bash
# List sessions
curl -X GET "https://relay.your-domain.com/sessions" \
  -H "Authorization: Bearer $TOKEN"

# Create idea
curl -X POST "https://relay.your-domain.com/ideas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "My idea", "content": "Details..."}'
```
