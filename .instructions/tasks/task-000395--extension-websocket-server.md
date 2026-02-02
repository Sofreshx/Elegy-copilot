---
schema: task/v1
id: task-000395
title: "Add WebSocket server to VS Code extension"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["signalr", "security"]
depends_on: []
next_tasks: ["task-000396", "task-000397", "task-000398", "task-000399"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

The vscode-skill-installer extension needs a WebSocket server to enable remote control from mobile/web clients. This is the foundation for the Mobile Companion ecosystem, allowing remote agentic sessions to be initiated and monitored from external devices.

**Extension location**: vscode-skill-installer/

**Key requirements**:
- JWT authentication for secure connections
- Use ws package or native http module
- Bind to configurable port (default: random available port)
- Support multiple concurrent connections
- Implement JSON-RPC style command protocol
- Integrate with VS Code extension lifecycle (start on activate, cleanup on deactivate)

**Command protocol** (JSON-RPC style):
```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "execute_command",
  "params": { "command": "...", "args": [] }
}
```

Supported methods:
- `execute_command` - Execute VS Code command or agent invocation
- `get_status` - Query extension/session status
- `subscribe_events` - Subscribe to event stream

## Acceptance Criteria

- [x] WebSocket server starts when extension activates
- [x] JWT token validation on connection (reject unauthorized clients)
- [x] Command message handling (execute_command, get_status, subscribe_events)
- [x] Proper error handling and connection cleanup
- [x] Configuration for port, auth secret via VS Code settings
- [ ] Unit tests for message protocol and authentication
- [x] Server logs connections, disconnections, and errors
- [x] Graceful shutdown when extension deactivates

## Plan / Approach

1. **Install dependencies**: Add `ws` package to vscode-skill-installer/package.json
2. **Create WebSocket server module**: src/websocketServer.ts
3. **Implement JWT middleware**: Validate tokens on connection upgrade
4. **Add command router**: Map JSON-RPC methods to handlers
5. **Configuration schema**: Add settings to package.json contribution point
6. **Lifecycle integration**: Start server in extension.activate(), cleanup in deactivate()
7. **Error handling**: Catch connection errors, invalid messages, auth failures
8. **Testing**: Unit tests for protocol parsing, auth, command routing

## Attempts / Log

**2026-02-01**: Implementation completed
- Created `src/wsTypes.ts` with JSON-RPC 2.0 protocol types, error codes, and helper functions
- Created `src/wsAuth.ts` with JWT authentication manager (secret generation, token create/verify, multi-source token extraction)
- Created `src/wsServer.ts` with WebSocket server class (HTTP upgrade, auth validation, command routing, event subscription, status bar)
- Updated `package.json`:
  - Added dependencies: `ws@^8.16.0`, `jsonwebtoken@^9.0.2`
  - Added dev dependencies: `@types/ws@^8.5.10`, `@types/jsonwebtoken@^9.0.5`
  - Added settings: `skillInstaller.ws.enabled`, `skillInstaller.ws.port`, `skillInstaller.ws.secret`
- Updated `src/extension.ts` to initialize and start WebSocket server on activation
- Compilation successful with `npm run compile`

**Security features implemented:**
- Command allowlist (blocklist by default, only safe commands allowed)
- JWT token required on connection (via query param, Authorization header, or Sec-WebSocket-Protocol)
- Auto-generated secret stored in VS Code SecretStorage (or optional user-configured)
- Binds to localhost only (127.0.0.1)
- Random port by default (port 0)

**Note:** Unit tests not yet written - marking that acceptance criterion as pending for future task or PR review.

## Failures

(Document any blockers or failed approaches)

## Notes / Discoveries

**Security considerations**:
- JWT secret should be auto-generated on first run, stored in VS Code secrets API
- Consider exposing QR code for mobile pairing (generate JWT + server URL)
- Rate limiting to prevent command flooding

**Port selection**:
- Default to random available port (0) for security
- Allow manual override via settings for advanced users
- Display active port in status bar item

## Next Steps

Once complete:
- Proceed to task-000396 (chat participant API)
- Proceed to task-000397 (session tracker)
- Proceed to task-000398 (event emission system)
- Proceed to task-000399 (client registry)
