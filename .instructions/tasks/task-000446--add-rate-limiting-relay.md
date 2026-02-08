---
schema: task/v1
id: task-000446
title: "Add rate limiting to relay"
type: feature
status: done
priority: high
owner: ""
skills: ["security"]
group_id: "group-05-security"
group_title: "Group 5: Security Hardening"
group_order: 1
depends_on: []
next_tasks: ["task-000450"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The relay has no rate limiting on HTTP or WebSocket endpoints, nor any security headers.

- Read `cloud-relay/src/index.ts` for Express middleware setup
- Read `cloud-relay/src/relay.ts` for `handleMessage` entry point
- Read `.instructions/artefacts/relay-protocol.md` Section 7 for rate limit spec

## Acceptance Criteria
- [x] HTTP rate limiting on auth endpoints
- [x] WS rate limiting per-client
- [x] Security headers via helmet
- [x] Rate-limited requests get `-32003` error response
- [x] No TypeScript errors

## Plan / Approach

### 1. Create `cloud-relay/src/rateLimit.ts`
- Token-bucket rate limiter class for per-client WS rate limiting
- Default: 100 messages/minute per client
- Returns error code `-32003` (RATE_LIMITED) with `retryAfter` data

### 2. HTTP rate limiting
- Add `express-rate-limit` middleware on `/auth/*` (10 requests/minute per IP)

### 3. Security headers
- Add `helmet()` for security headers

### 4. Wiring
- Wire in `index.ts` and `relay.ts`

### 5. Dependencies
- Add to `cloud-relay/package.json`: `express-rate-limit`, `helmet`

## Attempts / Log

### 2026-02-08 — Implementation complete
- Installed `express-rate-limit` and `helmet` in cloud-relay
- Created `cloud-relay/src/rateLimit.ts` — token-bucket RateLimiter class (100 msg/min per client, configurable, periodic stale-bucket cleanup)
- Wired `helmet()` middleware in `index.ts` (security headers)
- Added `express-rate-limit` on `/auth/*` routes (10 req/min per IP)
- Wired `RateLimiter` into `WebSocketRelay` — `handleMessage()` calls `rateLimiter.consume(clientId)` after auth check, before message processing
- Rate-limited WS messages get JSON-RPC error with code `-32003` (RATE_LIMITED) and `retryAfter` data field
- Client bucket removed on WS disconnect
- Graceful shutdown calls `rateLimiter.shutdown()` + `wsRateLimiter.shutdown()`
- `npx tsc --noEmit` passes with zero errors

## Failures

## Notes / Discoveries

## Next Steps
- task-000450 depends on this for documenting rate limiting in security-model.md
