---
schema: task/v1
id: task-000399
title: "Build client registry with heartbeat management"
type: feature
status: done
priority: medium
owner: "lolzi"
skills: ["csharp-expert"]
depends_on: ["task-000395"]
next_tasks: ["task-000406"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Track all connected mobile/web clients to maintain connection health, detect stale connections, and provide visibility into active clients. This enables features like multi-device sync, targeted event delivery, and connection diagnostics.

**Key requirements**:
- Track all WebSocket clients with unique client IDs
- Maintain connection state (connected, disconnected, last_seen timestamp)
- Heartbeat mechanism to detect stale/dead connections
- Store client metadata (device type, OS, app version, user agent)
- Auto-cleanup stale connections after timeout

**Integration points**:
- WebSocket server (task-000395) registers clients on connection
- Event system (task-000398) queries active clients for event delivery
- Admin dashboard (future) queries client list

## Acceptance Criteria

- [x] Client registry stores connection info (Map<client_id, ClientInfo>)
- [x] Heartbeat ping/pong every 30s (configurable via settings)
- [x] Automatic cleanup of stale connections (timeout: 2 min, configurable)
- [x] Client metadata stored and queryable:
  - client_id (UUID)
  - device_type (mobile, web, desktop)
  - os (iOS, Android, Windows, macOS, Linux)
  - app_version
  - connection_time
  - last_seen
  - state (connected, disconnected)
- [x] API exposed:
  - `list_clients()` - Get all registered clients
  - `get_client(id)` - Get specific client details
  - `disconnect_client(id)` - Forcefully disconnect a client
- [x] Extension status bar shows active client count

## Plan / Approach

1. **Client model**: Define TypeScript interface for ClientInfo
2. **Registry implementation**: In-memory Map<client_id, ClientInfo>
3. **WebSocket integration**: On client connect, register in registry with metadata
4. **Heartbeat protocol**:
   - Server sends "ping" every 30s
   - Client responds with "pong"
   - Update last_seen on each pong
5. **Cleanup timer**: setInterval to check for stale connections (last_seen > 2 min ago)
6. **Metadata extraction**: Parse WebSocket upgrade request headers for device info
7. **API implementation**: Export query/mutation functions
8. **Status bar item**: Show "📱 Clients: N" in VS Code status bar
9. **Testing**: Unit tests for heartbeat, cleanup, metadata parsing

**ClientInfo interface**:
```typescript
interface ClientInfo {
  client_id: string;
  device_type: 'mobile' | 'web' | 'desktop';
  os: string;
  app_version: string;
  connection_time: Date;
  last_seen: Date;
  state: 'connected' | 'disconnected';
  websocket: WebSocket;
}
```

**Heartbeat flow**:
1. Server timer ticks (every 30s)
2. Send ping to all connected clients: `{ "type": "ping", "timestamp": "..." }`
3. Client responds: `{ "type": "pong", "timestamp": "..." }`
4. Update last_seen in registry
5. Cleanup timer checks for stale clients (last_seen > 2 min)
6. Disconnect and remove stale clients

## Attempts / Log

**2026-02-01 - Implementation complete**

### Files created:
- `src/clientRegistry.ts` - Full client registry implementation with:
  - `RegisteredClientInfo` interface with all metadata fields
  - `ClientInfoDto` for API responses (without WebSocket reference)
  - `ClientRegistry` class with:
    - `registerClient(ws, request, userId)` - extracts metadata from headers
    - `updateLastSeen(clientId)` - updates heartbeat timestamp
    - `handlePong(ws)` - handles heartbeat response
    - `getClient(clientId)` / `getClientByWs(ws)` - lookup methods
    - `listClients()` / `listClientsDto()` - list all clients
    - `disconnectClient(clientId)` - force disconnect
    - `getActiveCount()` / `getTotalCount()` - counts
  - Metadata extraction from HTTP headers (X-Device-Type, X-OS, X-App-Version)
  - User-Agent fallback parsing for device/OS detection
  - Heartbeat timer (sends ping every 30s, configurable)
  - Stale connection cleanup timer (disconnects clients not seen for 2 min)
  - Status bar item showing "📱 N clients"

### Files updated:
- `wsTypes.ts` - Added methods: `list_clients`, `get_client`, `disconnect_client`, `pong`
- `wsServer.ts` - Integrated ClientRegistry:
  - Uses registry for client tracking instead of simple Map
  - Starts/stops heartbeat timers with server
  - Routes new API methods to handlers
  - Welcome message includes clientId, deviceType, os
- `package.json` - Added settings:
  - `skillInstaller.ws.heartbeatInterval` (default: 30000ms)
  - `skillInstaller.ws.staleTimeout` (default: 120000ms)
  - `skillInstaller.showClientList` command
- `extension.ts` - Added `showClientList` command with QuickPick UI

### Validation:
- `npm run compile` - ✅ Passes with no errors

## Failures

(Document any blockers or failed approaches)

## Notes / Discoveries

**Metadata extraction**:
- Parse User-Agent header from WebSocket upgrade request
- Custom headers: X-Device-Type, X-OS, X-App-Version (set by mobile/web clients)
- Fallback to "unknown" if headers missing

**Stale connection detection**:
- Heartbeat ensures we detect network interruptions
- Mobile clients may go to background, need graceful reconnection
- Consider exponential backoff for reconnection attempts (client-side)

**Security**:
- Ensure disconnect_client(id) is authenticated (admin only)
- Prevent client enumeration by unauthorized parties
- Rate limit heartbeat responses to prevent abuse

**Multi-device scenarios**:
- User may connect from multiple devices simultaneously
- Each connection gets unique client_id
- Event delivery can target specific client or broadcast to all user's clients

## Next Steps

Once complete:
- Proceed to task-000406 (client authentication and pairing)
- Test heartbeat mechanism with mobile client
- Monitor connection stability and cleanup behavior
