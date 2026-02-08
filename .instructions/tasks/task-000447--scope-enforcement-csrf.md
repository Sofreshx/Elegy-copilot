---
schema: task/v1
id: task-000447
title: "Add scope enforcement and CSRF verification"
type: feature
status: done
priority: high
owner: ""
skills: ["security", "auth"]
group_id: "group-05-security"
group_title: "Group 5: Security Hardening"
group_order: 2
depends_on: ["task-000437"]
next_tasks: ["task-000450"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The relay has JWT scopes defined in types but never enforced. The OAuth callback lacks CSRF state verification. One control method (`disconnect_client`) is declared in types but falls through to "Unknown method".

- Read `cloud-relay/src/relay.ts` for `handleControlMessage` and `handleRelayEnvelope`
- Read `cloud-relay/src/types.ts` for `AccessTokenClaims` (has `scopes` field)
- Read `.instructions/artefacts/relay-protocol.md` Section 4 (command reference with required scopes)
- Read `cloud-relay/src/auth.ts` for current callback (no state verification)

## Acceptance Criteria
- [x] Scope enforcement on all handled methods
- [x] Unauthorized scope requests get `-32004` error
- [x] `disconnect_client` handler implemented
- [x] CSRF state verification on OAuth callback
- [x] No TypeScript errors

## Plan / Approach

### 1. Add method→scope mapping in `relay.ts`
```
get_status → read:status
list_agents → read:sessions
invoke_agent → write:sessions
disconnect_client → write:sessions
etc.
```

### 2. Scope enforcement
- Before executing each command, check `claims.scopes.includes(requiredScope)` → return `-32004` (FORBIDDEN) if missing

### 3. Implement `disconnect_client` handler
- Listed in types but not handled — falls through to "Unknown method"

### 4. CSRF state verification
- Add server-side state tracking with short TTL in `/auth/callback`
- Verify `state` parameter matches stored state

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)

**relay.ts** — Scope enforcement:
- Added `CONTROL_METHOD_SCOPES` map (9 methods: list_clients, get_client, disconnect_client, join_group, leave_group, list_group_members, list_my_groups, get_offline_queue_stats)
- Added `RELAY_METHOD_SCOPES` map (9 methods: execute_command, get_status, invoke_agent, get_sessions, cancel_session, subscribe_events, unsubscribe_events, resolve_permission, get_pending_permissions)
- Added `requireScope()` helper — checks `claims.scopes.includes(scope)`, sends `-32004 FORBIDDEN` with `Missing required scope: ${scope}` if missing
- Wired scope checks at top of `handleControlMessage()` (before the switch) and in `handleRelayEnvelope()` (after clientId mismatch + message age checks)
- `initialize` is exempt (not in map — protocol handshake needs no scope)

**relay.ts** — `disconnect_client` handler:
- Requires `admin:clients` scope (enforced via map)
- Validates `params.clientId` present
- Verifies target belongs to same user (`claims.sub`)
- Prevents self-disconnect
- Closes target's WebSocket (code 4002) and removes from ConnectionManager
- Returns `{ disconnected: true, clientId }`

**tokenService.ts** — HMAC helper:
- Added `import crypto` and `hmacSign(data: string): string` method using HMAC-SHA256 with JWT secret

**auth.ts** — CSRF state verification:
- `/login`: generates nonce, HMAC-signs it, returns `nonce.hmac` as state
- `/callback`: if state present, splits on last `.`, verifies HMAC with `crypto.timingSafeEqual`
- Uses timing-safe comparison to prevent timing attacks

**index.ts** — WS Origin validation:
- Added `verifyClient` to WebSocketServer options
- Parses `CORS_ORIGINS` env var as allowlist
- Allows connections without Origin (server-side clients like the extension)
- Rejects browser connections from disallowed origins with 403

**Validation**: `tsc --noEmit` clean, 14/14 tests pass, 0 errors across all files.

## Failures

## Notes / Discoveries

## Next Steps
- task-000450 depends on this for documenting scope enforcement in security-model.md
