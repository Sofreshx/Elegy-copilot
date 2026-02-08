---
schema: task/v1
id: task-000442
title: "Fix mobile WebSocket connection and envelope wrapping"
type: bugfix
status: done
priority: critical
owner: "task-runner"
skills: ["frontend"]
group_id: "group-03-mobile-auth"
group_title: "Group 3: Mobile Auth & Connection Fix"
group_order: 2
depends_on: ["task-000441"]
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The mobile companion's WebSocket connection has several bugs: wrong URL path, double-resolve in constructor, no relay envelope wrapping/unwrapping, and missing auth response handling.

- Read `mobile-companion/src/services/relayConnection.ts` for current WS connection code
- Read `mobile-companion/src/services/relayApi.ts` for JSON-RPC request/response handling
- Read `cloud-relay/src/types.ts` for `RelayEnvelope` type
- Read `.instructions/artefacts/relay-protocol.md` Section 2 for envelope format

## Acceptance Criteria
- [x] WebSocket connects to correct relay path `/v1/ws`
- [x] Outgoing messages wrapped in relay envelopes
- [x] Incoming relay envelopes unwrapped for handlers
- [x] Auth response handled (clientId/userId stored)
- [x] Double-resolve bug fixed
- [x] No TypeScript errors

## Plan / Approach

### 1. Fix `relayConnection.ts`
- Ensure URL includes `/v1/ws` path
- Fix double-resolve bug in constructor
- Wrap outgoing messages in `RelayEnvelope` with proper source/target
- Handle relay auth response: extract `clientId`, `userId`
- Unwrap incoming relay envelopes: extract `payload` for message handlers
- Handle both relay envelopes and direct JSON-RPC (ping/pong, control messages)
- Store and expose `clientId` and `userId` after auth

### 2. Fix `relayApi.ts`
- `sendRequest` should build JSON-RPC payload (relayConnection handles envelope wrapping)
- Response handling should work with unwrapped payloads from relay envelopes
- Target extension by type (`target.type: "extension"`) or specific `clientId`

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)

**relayConnection.ts** — Major rewrite:
1. Fixed constructor double-resolve: `this.relayUrl = relayUrl` (already resolved by default parameter)
2. Added `clientId`, `userId`, `authenticated`, `pendingMessages` fields + public getters
3. Fixed `resolveRelayWsUrl()` to enforce `/v1/ws` path suffix
4. Rewrote `send()` → queues messages pre-auth, wraps in `RelayEnvelope` post-auth
5. Added `sendEnvelope()` private method building envelope with `version: "1.0"`, `source: { type: "mobile", clientId }`, `target: { type: "extension", userId }`
6. Rewrote `onmessage` handler:
   - Auth response (`jsonrpc 2.0`, `id: "auth"`) → `handleAuthResponse()` stores clientId/userId, sets `connected`, flushes queue, auto-joins user group
   - Relay envelopes (`version: "1.0"`) → unwraps JSON-RPC payload into `RelayMessage` (success/error/notification)
   - Direct JSON-RPC → converts to `RelayMessage`
   - Fallback → pass-through
7. `onopen` no longer sets `connected` — deferred to `handleAuthResponse`
8. `disconnect()` resets auth state (clientId, userId, authenticated, pendingMessages)

**relayApi.ts** — Response matching + event mapping:
1. `sendRequest()` now matches responses by `message.id === requestId` (from envelope unwrapper) instead of `message.payload.id`
2. Error detection: `message.type === 'error'` instead of nested `payload.error`
3. `subscribeToSessionEvents()` — added primary `message.type === 'event'` handler mapping relay event types (`session_started`, `session_progress`, `tool_called`, `session_completed`, `session_error`) to callbacks, with legacy `session:*` format as fallback
4. `subscribeToClientEvents()` — added primary event handler for `client_connected`/`client_disconnected`/`client_updated` relay events, with legacy fallback

**Validation**: `tsc --noEmit` clean (only pre-existing error in `authService.ts:242`). All consumer files (AuthContext, Settings, Dashboard, usePermissions, useClients, useSessions) error-free.

## Failures

(none)

## Notes / Discoveries

- The relay sends auth success as bare JSON-RPC `{ jsonrpc: "2.0", id: "auth", result: { authenticated, clientId, userId, scopes } }` — not wrapped in an envelope. The onmessage handler checks for this before envelope unwrapping.
- `send()` returns `true` for queued messages (pre-auth) — callers like `sendRequest` won't get a false-negative "not connected" error when the WS is open but auth hasn't completed yet.
- `joinUserGroup()` sends a direct JSON-RPC control message (not enveloped) since it's a relay-level operation.
- Pre-existing TS error in `authService.ts:242` — `string | undefined` not assignable to `string`. Not related to this task.

## Next Steps
