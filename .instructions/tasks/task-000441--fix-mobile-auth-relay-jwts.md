---
schema: task/v1
id: task-000441
title: "Fix mobile auth to use relay-minted JWTs"
type: bugfix
status: done
priority: critical
owner: ""
skills: ["frontend", "auth"]
group_id: "group-03-mobile-auth"
group_title: "Group 3: Mobile Auth & Connection Fix"
group_order: 1
depends_on: ["task-000437"]
next_tasks: ["task-000442"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The mobile companion currently stores raw GitHub tokens and makes separate GitHub API calls for user info. It needs to switch to relay-minted JWTs (access + refresh) and use the user info returned directly from the relay auth response.

- Read `mobile-companion/src/services/authService.ts` for current implementation
- Read `mobile-companion/src/context/AuthContext.tsx` for auth state management
- Read `.instructions/research/relay-architecture-audit.md` Section 2

## Acceptance Criteria
- [x] Auth flow stores relay JWTs (access + refresh)
- [x] Token refresh works transparently
- [x] No hardcoded GitHub client ID (`FALLBACK_CLIENT_ID` removed)
- [x] User sees error message on auth failure
- [x] No TypeScript errors

## Plan / Approach

### 1. Update `authService.ts`
- Change storage keys to `ie_relay_access_token`, `ie_relay_refresh_token`
- `handleCallback()`: pass `client_type: 'mobile'` in request body, store response `access_token` (relay JWT), `refresh_token`, `user` from relay response (no separate GitHub API call needed)
- Add `refreshAccessToken()`: `POST /auth/refresh` with stored refresh token, rotate tokens
- Add `getValidToken()`: returns access token if not expired, calls `refreshAccessToken()` if expired, returns null + triggers logout if refresh fails
- Add `isTokenExpired()`: decode JWT exp claim, check with 1-min buffer
- Remove `FALLBACK_CLIENT_ID` hardcoded GitHub client ID
- Show user-visible error on callback failure (not just `console.error`)

### 2. Update `AuthContext.tsx`
- Use `getValidToken()` instead of raw `state.accessToken`
- Subscribe to relay disconnect events and attempt token refresh
- Remove separate `fetchUser()` call (user comes from relay response)

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)

**authService.ts changes:**
- Storage keys: `ie_mobile_auth_token` → `ie_relay_access_token`, added `ie_relay_refresh_token`
- Added `mapRelayUser()` helper to convert relay user format to `GitHubUser`
- Added `refreshToken` private field + persistence in load/save/logout
- `handleCallback()`: sends `client_type: 'mobile'`, stores `refresh_token`, extracts user from relay response via `mapRelayUser()` — no more GitHub API call
- Added `isTokenExpired(token?)`: decodes JWT payload via `atob`, checks `exp` with 60s buffer
- Added `refreshAccessToken()`: POSTs to `/auth/refresh` with stored refresh token, rotates tokens
- Added `getValidToken()`: returns valid token or refreshes, logs out on failure
- `fetchUser()`: now returns stored user (no-op, relay provides user at callback)
- `logout()`: clears `REFRESH_TOKEN_KEY` in addition to existing keys

**AuthContext.tsx changes:**
- Init flow uses `getValidToken()` instead of raw `state.accessToken` for relay connection
- Token-but-no-user fallback now calls `logout()` (re-login required) instead of `fetchUser()`
- Post-callback relay connection uses `getValidToken()` instead of `getToken()`

**Validation:** 0 TypeScript errors on both files. No stale references to old storage key.

## Failures

## Notes / Discoveries

## Next Steps
- Proceed to task-000442 (WebSocket connection and envelope wrapping)
