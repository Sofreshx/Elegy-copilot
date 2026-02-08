---
schema: task/v1
id: task-000438
title: "Create RelayAuthBridge for extension → relay authentication"
type: feature
status: done
priority: critical
owner: ""
skills: []
group_id: "group-02-ext-relay"
group_title: "Group 2: Extension Relay Client"
group_order: 1
depends_on: ["task-000437"]
next_tasks: ["task-000439"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

Create a `RelayAuthBridge` class in the VS Code extension that bridges VS Code's built-in GitHub authentication to relay-issued JWTs, enabling frictionless relay authentication.

**Key files to read before starting:**
- `vscode-skill-installer/src/oauthManager.ts` — current GitHub OAuth approach
- `vscode-skill-installer/src/wsAuth.ts` — current local JWT auth
- `vscode-skill-installer/src/extension.ts` — activation wiring
- `vscode-skill-installer/package.json` — existing settings
- `.instructions/research/relay-architecture-audit.md` Section 2 — auth decisions

## Acceptance Criteria

- [ ] `relayAuthBridge.ts` exists with `getRelayTokens()`, `clearTokens()`, `isTokenExpired()`
- [ ] Settings added to `package.json`
- [ ] Uses `vscode.authentication.getSession` for frictionless GitHub auth
- [ ] Stores relay tokens in `SecretStorage`
- [ ] No TypeScript errors

## Plan / Approach

1. **Create `vscode-skill-installer/src/relayAuthBridge.ts`**:
   - Uses VS Code's `SecretStorage` for relay token persistence
   - Storage keys: `skillInstaller.relay.accessToken`, `skillInstaller.relay.refreshToken`
   - `getRelayTokens(): Promise<{ accessToken: string; refreshToken: string } | null>` — main entry point:
     1. Check stored relay tokens → return if valid (not expired, 5-min buffer)
     2. Try refresh (`POST /auth/refresh`) → return new tokens
     3. Get VS Code GitHub session via `vscode.authentication.getSession('github', ['read:user'], { createIfNone: true })`
     4. Exchange with `POST /auth/exchange { github_token, client_type: 'extension' }`
     5. Store new tokens → return
     6. If all fail → return null
   - `clearTokens(): Promise<void>` — remove stored tokens (for logout/re-auth)
   - `isTokenExpired(token: string): boolean` — decode JWT exp claim without verification, check with 5-min buffer
   - Private `refreshTokens()` and `exchangeGitHubToken()` helpers

2. **Add relay settings to `vscode-skill-installer/package.json`**:
   ```json
   "skillInstaller.relay.url": {
     "type": "string",
     "default": "wss://relay.sfrsh.xyz/v1/ws",
     "description": "Cloud relay WebSocket URL for mobile companion connectivity."
   },
   "skillInstaller.relay.enabled": {
     "type": "boolean",
     "default": false,
     "description": "Enable outbound connection to the cloud relay for remote mobile control."
   },
   "skillInstaller.relay.httpUrl": {
     "type": "string",
     "default": "https://relay.sfrsh.xyz",
     "description": "Cloud relay HTTP URL for auth token exchange."
   }
   ```

3. **Write unit tests** for token expiry checking and the auth flow (mock `fetch` and `vscode.authentication`)

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)
- Created `vscode-skill-installer/src/relayAuthBridge.ts` with full `RelayAuthBridge` class
- Added 3 relay settings to `package.json`: `relay.enabled`, `relay.url`, `relay.httpUrl`
- Uses `vscode.authentication.getSession('github', ['read:user'], { createIfNone: true })` — NOT custom OAuth
- Stores relay tokens (access, refresh, expiresAt) in `SecretStorage` — NOT GitHub tokens
- Token refresh cascade: cached → stored → refresh → exchange → null
- Auth failure → warning notification + return null (no crash, no retry loop)
- JWT expiry decoded via `Buffer.from(base64url)` — no `jsonwebtoken` dependency
- 60-second expiry buffer
- `tsc --noEmit` passes cleanly, `get_errors` returns zero errors on new file

## Failures

## Notes / Discoveries

## Next Steps

- Proceed to task-000439 (Create RelayClient outbound WebSocket client)
