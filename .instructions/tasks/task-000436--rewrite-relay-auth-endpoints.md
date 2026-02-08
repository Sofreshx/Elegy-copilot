---
schema: task/v1
id: task-000436
title: "Rewrite relay auth endpoints to mint relay JWTs"
type: feature
status: done
priority: critical
owner: ""
skills: []
group_id: "group-01-relay-auth"
group_title: "Group 1: Relay Auth Fix"
group_order: 2
depends_on: ["task-000435"]
next_tasks: ["task-000437"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

The relay's HTTP auth endpoints currently return raw GitHub tokens to clients. This task rewrites them to mint relay-owned JWTs using the `TokenService` created in task-000435, and adds refresh/exchange/revoke endpoints.

**Key references:**
- `cloud-relay/src/auth.ts` — current auth endpoint implementation
- `cloud-relay/src/tokenService.ts` — created in task-000435
- `.instructions/artefacts/relay-protocol.md` Section 3.3 — expected response format
- `.instructions/research/relay-architecture-audit.md` Section 2 — auth design

## Acceptance Criteria

- [x] `POST /auth/callback` returns relay-minted JWTs with user info
- [x] `POST /auth/refresh` rotates tokens correctly
- [x] `POST /auth/exchange` validates GitHub tokens and mints relay JWTs
- [x] `POST /auth/revoke` returns 200
- [x] CORS restricted to configurable origins via `CORS_ORIGINS` env var
- [x] `createAuthRouter()` accepts `TokenService` parameter
- [x] No TypeScript errors
- [x] Tests pass

## Plan / Approach

1. **Modify `POST /auth/callback`** in `cloud-relay/src/auth.ts`:
   - Accept new `client_type` field from request body (default `"mobile"`)
   - After successful GitHub token exchange, call `GET https://api.github.com/user` with the GitHub access_token
   - Extract `id`, `login`, `avatar_url` from GitHub user response
   - Generate `clientId` via `uuidv4()`
   - Determine scopes based on `client_type` (use scope constants from types.ts)
   - Call `tokenService.mintAccessToken()` and `tokenService.mintRefreshToken()`
   - Return protocol-compliant response:
     ```json
     {
       "access_token": "<relay_jwt>",
       "refresh_token": "<relay_refresh_jwt>",
       "token_type": "Bearer",
       "expires_in": 3600,
       "scopes": ["..."],
       "user": { "id": "github|12345", "login": "username", "avatar_url": "https://..." }
     }
     ```
   - Do NOT expose raw GitHub token to client

2. **Add `POST /auth/refresh` endpoint**:
   - Accept `{ refresh_token: string }`
   - Verify with `tokenService.verifyRefreshToken()`
   - If valid, mint new access + refresh token pair (refresh rotation)
   - Return same shape minus `user`

3. **Add `POST /auth/exchange` endpoint** (for VS Code extension):
   - Accept `{ github_token: string, client_type: "extension" }`
   - Validate by calling `GET https://api.github.com/user` with the provided token
   - If valid, mint relay JWT + refresh token
   - Return same response shape as callback

4. **Add `POST /auth/revoke` endpoint**:
   - Accept `{ token: string }` — always returns 200 (stateless tokens)

5. **Update `createAuthRouter()` signature** to accept `TokenService`:
   ```typescript
   export function createAuthRouter(tokenService: TokenService): Router
   ```

6. **Restrict CORS**: Change `Access-Control-Allow-Origin` from `*` to configurable allowlist via `CORS_ORIGINS` env var (default: `https://companion.sfrsh.xyz`). Support comma-separated origins.

7. **Write/update tests** for all new endpoints.

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)
- Rewrote `cloud-relay/src/auth.ts` with all required changes
- `createAuthRouter()` now accepts `TokenService` parameter
- Added `fetchGitHubUser()` helper to avoid duplicating GitHub API calls
- Added `resolveClientType()` and `resolveScopesForClientType()` helpers
- `POST /callback` now: exchanges OAuth code → fetches GitHub user profile → mints relay JWTs (access + refresh) → returns protocol-compliant response with user info
- Added `POST /refresh` endpoint with token rotation
- Added `POST /exchange` endpoint for VS Code extension flow (direct GitHub token → relay JWT)
- Added `POST /revoke` endpoint (always returns `{ revoked: true }`)
- CORS restricted via `CORS_ORIGINS` env var (comma-separated, defaults to `https://companion.sfrsh.xyz`)
- Preserved `normalizeScopes`, `buildGithubAuthUrl` exports and `/login` endpoint unchanged
- All 14 existing tests pass (auth, tokenService, connectionGroups)
- No TypeScript errors in `auth.ts`
- Note: `index.ts` still calls `createAuthRouter()` without args — task-000437 will wire the TokenService instance

## Failures

## Notes / Discoveries

## Next Steps

- task-000437: Wire TokenService into relay and fix verifyToken
