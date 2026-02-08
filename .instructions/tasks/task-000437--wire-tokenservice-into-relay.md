---
schema: task/v1
id: task-000437
title: "Wire TokenService into relay and fix verifyToken"
type: feature
status: done
priority: critical
owner: ""
skills: []
group_id: "group-01-relay-auth"
group_title: "Group 1: Relay Auth Fix"
group_order: 3
depends_on: ["task-000435", "task-000436"]
next_tasks: ["task-000438"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

The relay's `WebSocketRelay` class has an inline `verifyToken()` method that duplicates JWT verification logic. This task replaces it with a call to `TokenService.verifyAccessToken()`, wires the `TokenService` into server startup in `index.ts`, and adds new environment variables.

**Key references:**
- `cloud-relay/src/relay.ts` — `WebSocketRelay` class and its `verifyToken` method
- `cloud-relay/src/index.ts` — server setup and env var reading
- `cloud-relay/src/tokenService.ts` — created in task-000435

## Acceptance Criteria

- [x] `relay.ts` uses `TokenService` for token verification (inline `verifyToken()` removed)
- [x] `index.ts` instantiates and wires `TokenService` to both auth router and relay
- [x] New env vars documented and defaulted:
  - `CORS_ORIGINS` (default: empty = allow all, for dev)
  - `ACCESS_TOKEN_TTL` (default: 3600)
  - `REFRESH_TOKEN_TTL` (default: 2592000)
- [x] Full auth chain works: callback → relay JWT → WS auth
- [x] No TypeScript errors
- [x] Existing tests still pass

## Plan / Approach

1. **Modify `cloud-relay/src/relay.ts`**:
   - Add `tokenService: TokenService` to `RelayConfig` or constructor params
   - Replace private `verifyToken()` method with call to `tokenService.verifyAccessToken()`
   - Ensure auth flow still works (URL query token + authenticate message)

2. **Modify `cloud-relay/src/index.ts`**:
   - Instantiate `TokenService` with config from env vars
   - Pass to `createAuthRouter(tokenService)`
   - Pass to `WebSocketRelay` constructor
   - Add new env vars with defaults:
     - `CORS_ORIGINS` (default: empty = allow all, for dev)
     - `ACCESS_TOKEN_TTL` (default: 3600)
     - `REFRESH_TOKEN_TTL` (default: 2592000)

3. **Verify the full auth chain works**:
   - `POST /auth/callback` → returns relay JWT
   - Client connects to WS with relay JWT → `verifyAccessToken()` validates → auth succeeds
   - Client connects with expired/invalid token → auth fails with proper error

## Attempts / Log

### 2026-02-08 — Attempt 1 (success)
- **relay.ts**: Removed `jwt` import, added `TokenService` import, slimmed `RelayConfig` (removed `jwtSecret`/`jwtIssuer`/`jwtAudience`), added `tokenService: TokenService` field + constructor param, replaced `verifyToken()` body with `this.tokenService.verifyAccessToken()`.
- **index.ts**: Added `TokenService` import, instantiated `TokenService` with env vars (`JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`), passed to `createAuthRouter(tokenService)` and `new WebSocketRelay(..., tokenService)`, slimmed `relayConfig` to only `maxMessageSize` + `requireAuth`.
- `get_errors`: 0 errors in both files.
- `npx jest --runInBand`: 3 suites, 14 tests, all passed.

## Failures

## Notes / Discoveries

## Next Steps

- Group 1 complete after this task. Proceed to Group 2 tasks per plan artefact.
