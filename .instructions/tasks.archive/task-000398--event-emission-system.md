---
schema: task/v1
id: task-000398
title: "Add event emission system for push notifications"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["signalr"]
depends_on: ["task-000397"]
next_tasks: ["task-000410"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Create a real-time event emission system to push notifications to connected WebSocket clients. This allows mobile/web apps to receive live updates about agent sessions, tool calls, permission requests, and errors without polling.

**Key requirements**:
- Emit events to all connected WebSocket clients (or filtered subset)
- Support event types: session_started, tool_called, progress, permission_requested, session_completed, error
- Allow clients to subscribe to specific event types (filtering)
- Include correlation IDs for request/response tracking
- Integrate with session tracker (task-000397) to capture session events

**Integration points**:
- WebSocket server (task-000395) manages client connections
- Session tracker (task-000397) triggers events
- Permission request flow (task-000410) uses permission_requested events

## Acceptance Criteria

- [x] Event emitter integrated with session tracker
- [x] Clients can subscribe to specific event types via WebSocket command
- [x] Event types supported:
  - `session_started` - New agent session initiated
  - `tool_called` - Agent called a tool (read_file, grep_search, etc.)
  - `progress` - Agent progress update (thinking, executing, etc.)
  - `permission_requested` - Agent requires user approval (includes callback for approve/deny)
  - `session_completed` - Agent session finished
  - `error` - Error occurred during session
- [x] All events include: timestamp, session_id, correlation_id, event_type, payload
- [x] Rate limiting to prevent event flood (max 100 events/sec per client)
- [x] Event history buffer (last 50 events) for clients that reconnect

## Plan / Approach

1. **Event model**: Define TypeScript interface for Event (type, session_id, correlation_id, timestamp, payload)
2. **Event emitter**: EventEmitter or custom pub/sub system
3. **Integration hooks**: Session tracker calls emitter on state changes
4. **Subscription management**: Clients send "subscribe_events" command with filter (event types)
5. **Broadcast logic**: Send events to all subscribed clients via WebSocket
6. **Rate limiting**: Token bucket algorithm per client
7. **Event buffer**: Circular buffer of last N events for late joiners
8. **Testing**: Unit tests for subscription filtering, rate limiting, event broadcast

**Event payload examples**:

`session_started`:
```json
{
  "type": "session_started",
  "session_id": "uuid",
  "correlation_id": "client-request-id",
  "timestamp": "2026-02-01T10:00:00Z",
  "payload": {
    "agent": "@executive2-planner",
    "prompt": "Create dashboard feature"
  }
}
```

`permission_requested`:
```json
{
  "type": "permission_requested",
  "session_id": "uuid",
  "correlation_id": "uuid",
  "timestamp": "2026-02-01T10:01:30Z",
  "payload": {
    "request": "Run terminal command: npm install",
    "callback_id": "perm-uuid"
  }
}
```

## Attempts / Log

**2026-02-01: Implementation complete**

Created comprehensive event emission system:

1. **New file: `src/eventEmitter.ts`** (~400 lines)
   - `ExtensionEvent` interface with typed payloads
   - `EventType` discriminated union: session_started, session_progress, session_completed, session_error, tool_called, permission_requested, permission_resolved
   - `Subscription` interface with client filtering (by eventTypes and/or sessionIds)
   - `CircularBuffer` class for event history (50 events)
   - Token bucket rate limiting (100 events/sec per client)
   - `ExtensionEventEmitter` class with:
     - subscribe/unsubscribe with filtering
     - Rate limiting per client
     - Typed event emission helpers (emitSessionStarted, emitToolCalled, etc.)
     - Permission request flow with timeout handling
     - Event history retrieval with filtering

2. **Updated `wsTypes.ts`**
   - Added 3 new methods: `get_event_history`, `resolve_permission`, `get_pending_permissions`
   - Enhanced `SubscribeEventsParams` with eventTypes/sessionIds filters
   - Added `GetEventHistoryParams` and `ResolvePermissionParams`

3. **Updated `wsServer.ts`**
   - Integrated `ExtensionEventEmitter` as central event bus
   - Added `clientsById` map for broadcast lookup
   - Updated subscribe_events/unsubscribe_events to support typed filtering
   - Added handlers: handleGetEventHistory, handleResolvePermission, handleGetPendingPermissions
   - Added emitEvent() and requestPermission() public methods
   - Proper cleanup on client disconnect

4. **Updated `sessionManager.ts`**
   - Changed from `SessionEventEmitter` interface to `ExtensionEventEmitter`
   - Emit typed events: session_started, session_progress, tool_called, session_completed, session_error

**Validation**: `npm run compile` passes with no errors

## Failures

(Document any blockers or failed approaches)

## Notes / Discoveries

**Filtering strategies**:
- Option 1: Client subscribes to specific event types (e.g., ["session_started", "error"])
- Option 2: Client subscribes to all events for a specific session_id
- Option 3: Combination of both (type + session filter)

**Permission request flow**:
- Agent triggers permission_requested event
- Mobile client displays approval UI
- Client sends approve/deny response via WebSocket
- Extension resumes/cancels agent based on response

**Performance**:
- Avoid blocking agent execution when emitting events
- Async event emission (fire and forget)
- Consider event batching for high-frequency updates

## Next Steps

Once complete:
- Proceed to task-000410 (permission request handling)
- Test event streaming end-to-end with mobile client
- Measure event throughput and latency
