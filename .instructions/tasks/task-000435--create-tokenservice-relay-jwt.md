---
schema: task/v1
id: task-000435
title: "Create TokenService for relay JWT minting/verification"
type: feature
status: done
priority: critical
owner: ""
skills: ["csharp-expert"]
group_id: "group-01-relay-auth"
group_title: "Group 1: Relay Auth Fix"
group_order: 1
depends_on: []
next_tasks: ["task-000436", "task-000437"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

The relay currently has an inline `verifyToken()` in `relay.ts` (~lines 91-102) and reads JWT config from env vars in `index.ts`. There is no centralized token service — minting and verification logic needs to be consolidated into a single `TokenService` class.

**Key references:**
- `cloud-relay/src/types.ts` — `AccessTokenClaims` interface
- `cloud-relay/src/relay.ts` lines ~91-102 — current `verifyToken()` implementation
- `cloud-relay/src/index.ts` — env var reading (JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE)
- `.instructions/artefacts/relay-protocol.md` Section 3.2 — token claims spec
- `.instructions/research/relay-architecture-audit.md` — architecture decisions

## Acceptance Criteria

- [x] `cloud-relay/src/tokenService.ts` exists with all methods listed below
- [x] Scope constants added to `cloud-relay/src/types.ts`
- [x] All unit tests pass in `cloud-relay/src/__tests__/tokenService.test.ts`
- [x] No TypeScript errors

## Plan / Approach

1. Create `cloud-relay/src/tokenService.ts` with:
   - `TokenServiceConfig` interface: `jwtSecret`, `jwtIssuer`, `jwtAudience`, `accessTokenTtlSeconds` (default 3600), `refreshTokenTtlSeconds` (default 2592000)
   - `MintAccessTokenInput` interface: `userId`, `githubLogin`, `clientType`, `clientId`, `scopes`
   - `RefreshTokenClaims` interface: `sub`, `jti`, `github_login`, `token_type: "refresh"`, `iat`, `exp`, `iss`, `aud`
   - `mintAccessToken(input: MintAccessTokenInput): string` — signs JWT with HS256, includes all `AccessTokenClaims` fields
   - `mintRefreshToken(userId: string, githubLogin: string): string` — longer-lived JWT with `token_type: "refresh"`
   - `verifyAccessToken(token: string): AccessTokenClaims | null` — verifies signature, issuer, audience; returns null on failure
   - `verifyRefreshToken(token: string): RefreshTokenClaims | null` — same + checks `token_type === "refresh"`

2. Add scope constants to `cloud-relay/src/types.ts`:
   ```typescript
   export const DEFAULT_MOBILE_SCOPES = ["read:status", "read:sessions", "write:sessions", "read:events", "write:permissions", "read:clients"];
   export const DEFAULT_EXTENSION_SCOPES = ["read:status", "read:sessions", "write:sessions", "read:events", "write:permissions", "read:clients", "admin:clients"];
   ```

3. Write unit tests in `cloud-relay/src/__tests__/tokenService.test.ts`:
   - Mint and verify access token (happy path)
   - Mint and verify refresh token (happy path)
   - Reject expired access token
   - Reject expired refresh token
   - Reject token with wrong issuer
   - Reject token with wrong audience
   - Reject access token when expecting refresh (wrong token_type)
   - Reject malformed/invalid tokens
   - Verify all AccessTokenClaims fields are present in minted token

## Attempts / Log

### 2026-02-08 — Attempt 1 (success)
- Created `cloud-relay/src/tokenService.ts` with `TokenServiceConfig`, `MintAccessTokenInput`, `RefreshTokenClaims` interfaces and `TokenService` class (4 methods: `mintAccessToken`, `mintRefreshToken`, `verifyAccessToken`, `verifyRefreshToken`).
- Added `DEFAULT_MOBILE_SCOPES` and `DEFAULT_EXTENSION_SCOPES` constants to `cloud-relay/src/types.ts`.
- Created `cloud-relay/src/__tests__/tokenService.test.ts` with 9 test cases — all passing.
- Extended `jest-globals.d.ts` with missing matchers (`not`, `toBeNull`, `toBeGreaterThan`, `beforeEach`, `afterEach`).
- Zero TypeScript errors across all touched files.

## Failures

## Notes / Discoveries

## Next Steps

- task-000436: Rewrite relay auth endpoints to mint relay JWTs
- task-000437: Wire TokenService into relay and fix verifyToken
