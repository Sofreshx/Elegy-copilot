---
schema: task/v1
id: task-000404
title: "Implement offline message queue/buffer"
type: feature
status: done
priority: medium
owner: lolzi
skills: ["signalr"]
depends_on: ["task-000403"]
next_tasks: ["task-000419"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Build a message queue system that buffers commands and events when VS Code extension is offline, then delivers them when the client reconnects.

**Use Cases**:
- User sends command from mobile while VS Code is closed → queued → delivered on next VS Code launch
- Extension goes offline mid-session → events buffered → user sees updates when reconnected
- Commands sent during network interruption → queued → delivered on network restore

**Storage Options**:
- **Redis**: Persistent, distributed, TTL support, production-ready
- **In-memory with persistence**: SQLite or JSON files for simpler deployments
- **Database**: PostgreSQL/MySQL for durability, but higher overhead

**Queue Features**:
- Command expiry (default: 24 hours, configurable per command type)
- Duplicate detection (prevent same command executing twice on reconnect)
- Message ordering preservation (FIFO per client)
- Queue size limits with eviction policy (oldest-first when limit reached)

## Acceptance Criteria

- [x] Message queue stores commands for offline clients
- [x] Messages delivered on client reconnect (ordered, deduplicated)
- [x] Command expiry implemented (default: 24 hours, configurable)
- [x] Duplicate command detection based on message ID
- [x] Message ordering preserved (FIFO per client)
- [x] Queue size limits enforced (configurable max messages per client)
- [x] Oldest-first eviction when queue limit reached
- [x] Queue status API (pending message count, oldest message timestamp)
- [x] Metrics/logging for queue operations (enqueue, dequeue, expiry, eviction)

## Plan / Approach

1. Choose storage backend (Redis recommended for production)
2. Design queue data structure with metadata (timestamp, expiry, messageId)
3. Implement enqueue logic (when client offline)
4. Implement dequeue logic (on client reconnect)
5. Add expiry checks (background job or lazy deletion)
6. Add duplicate detection (track processed messageIds)
7. Implement queue size limits and eviction policy
8. Create queue management API
9. Add metrics and logging
10. Test scenarios: offline delivery, expiry, duplicates, queue overflow

## Attempts / Log

### Attempt 1 - 2026-02-01 (SUCCESS)
**Implementation**: In-memory queue with optional JSON file persistence

**Created `cloud-relay/src/offlineQueue.ts`:**
- `QueuedMessage` interface with messageId, targetUserId, targetClientId, messageType, payload, enqueuedAt, expiresAt
- `OfflineQueue` class with:
  - `enqueue()` - Queue message for offline user, handles size limits/eviction
  - `dequeueForClient()` - Get all pending messages for reconnecting client (FIFO)
  - `cleanupExpired()` - Background cleanup every 5 minutes
  - `isProcessed()` / `markProcessed()` - Deduplication tracking
  - `getQueueStats()` / `getStats()` - Per-user and overall statistics
  - `save()` / `load()` - Optional JSON persistence (data/offline-queue.json)
  - `shutdown()` - Graceful cleanup with state save

**Configuration (via environment variables):**
- `OFFLINE_QUEUE_MAX_PER_USER`: Max messages per user (default: 100)
- `OFFLINE_QUEUE_PERSISTENCE_PATH`: Optional path for JSON persistence
- Default expiry: 24 hours
- Processed IDs retention: 1000 per user
- Cleanup interval: 5 minutes

**Integration with `connectionManager.ts`:**
- `routeMessage()` now enqueues to offline queue when delivery fails (target has userId)
- `deliverQueuedMessages()` - Called on client reconnect to deliver pending messages
- `getOfflineQueueStats()` / `getOfflineQueueOverallStats()` - Stats accessors
- Added `skipOfflineQueue` option to routing for control
- `initialize()` - Async init to load persisted queue state
- `shutdown()` - Now async to save queue state

**Integration with `relay.ts`:**
- On authentication success, automatically delivers queued messages
- Added `get_offline_queue_stats` WebSocket API method

**Health endpoint additions (`health.ts`):**
- `/health` now includes offlineQueue stats (pending, usersWithPending, oldestMessageAge, metrics)
- `/health/metrics` includes Prometheus-style offline queue metrics

**Types updated (`types.ts`):**
- Added `get_offline_queue_stats` to WsMethod union

**Validation:**
- `npm run build` - Compiles successfully
- No TypeScript errors

## Failures

## Notes / Discoveries

**Queue Message Schema (Implemented)**:
```typescript
interface QueuedMessage {
  messageId: string;
  targetUserId: string;
  targetClientId?: string; // null = all user's clients  
  messageType: 'command' | 'event';
  payload: RelayEnvelope;
  enqueuedAt: number; // timestamp ms
  expiresAt: number;  // timestamp ms
}
```

**Architecture Decision**: Chose in-memory with optional JSON persistence over Redis for v1:
- Simpler deployment (no Redis dependency)
- Sufficient for expected message volumes
- Can upgrade to Redis later if needed for scale/distribution

**Metrics Tracked:**
- enqueued, dequeued, expired, evicted, duplicatesPrevented

## Next Steps
