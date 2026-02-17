# Relay Architecture Audit

**Date**: 2026-02-08  
**Status**: Research complete  
**Scope**: Mobile ↔ Relay ↔ Extension connectivity, auth, security, PWA practices, naming

---

## Context

The system has three components:

| Component | Tech | Hosting | Status |
|-----------|------|---------|--------|
| Cloud Relay | Node.js, Express, `ws` library | `relay.sfrsh.xyz` (Docker/Traefik) | Deployed, accepts connections |
| Mobile Companion | React PWA (Vite, VitePWA) | Cloudflare Pages | Deployed, connects to relay |
| VS Code Extension | `RannIA` | Local (user's machine) | Runs a **local** WS server, **does NOT connect to relay** |

### The Critical Gap

The relay's architecture diagram shows `Mobile ↔ Relay ↔ Extension`, but the extension ([wsServer.ts](RannIA/src/wsServer.ts)) only starts a **local** `WebSocketServer` on `127.0.0.1`. It has no outbound client connection to `wss://relay.sfrsh.xyz`. The mobile app authenticates and connects to the relay, but messages addressed to `target.type = "extension"` have nowhere to go — the relay's `ConnectionManager` has zero extension clients registered.

The relay already has:
- Full routing logic (`routeMessage` in [connectionManager.ts](cloud-relay/src/connectionManager.ts))
- Offline queue + dead letter queue
- Group management (user/workspace/session groups)
- Heartbeat + connection timeout
- JWT-based auth with `AccessTokenClaims` that includes `client_type: "mobile" | "extension"` and `client_id`

The extension already has:
- A rich JSON-RPC handler ([wsServer.ts](RannIA/src/wsServer.ts)) with methods: `execute_command`, `invoke_agent`, `get_sessions`, `list_agents`, etc.
- Local JWT auth (`WsAuthManager` in [wsAuth.ts](RannIA/src/wsAuth.ts))
- `GitHubOAuthManager` ([oauthManager.ts](RannIA/src/oauthManager.ts)) for GitHub login
- Session management, permission gating, event emitter

The missing piece is a **relay client** inside the extension that connects outbound to the relay, authenticates, and bridges relay messages to the local handler.

---

## 1. Extension ↔ Relay Connection Pattern

### Options Evaluated

| Option | Description | NAT Traversal | Firewall Friendly | Complexity |
|--------|-------------|---------------|-------------------|------------|
| **A: Extension as WS client** | Extension connects outbound to `wss://relay.sfrsh.xyz` | Yes (outbound only) | Yes | Low |
| B: Extension as WS server | Relay connects inbound to extension | No (requires port forwarding) | No | High |
| C: VS Code Dev Tunnels | Use `vscode.env.asExternalUri` or Dev Tunnels API | Yes | Yes | Medium-High |
| D: Hybrid (client + local) | Outbound client to relay + keep local server | Yes | Yes | Medium |

### Analysis

**Option B (extension as server)** is a non-starter for production. Users behind NAT, corporate firewalls, or VPNs cannot expose a port. This is the current approach and it's the root cause of the broken architecture.

**Option C (VS Code Dev Tunnels)** uses `vscode.env.asExternalUri` to create a tunneled URL. It works when Dev Tunnels are enabled, but:
- Requires the user to be signed into a Microsoft account with Dev Tunnels enabled
- Not available in all VS Code environments (Codespaces handles this differently)
- Adds a dependency on Microsoft's tunnel infrastructure
- Latency overhead from the tunnel
- The relay would need to know the tunnel URL dynamically

**Option A (extension as WS client)** is the standard pattern used by virtually all VS Code extensions that communicate with cloud services (GitHub Copilot, Live Share, GitLens Cloud, etc.). The extension initiates an outbound `wss://` connection. All message routing happens through the relay. This works through any NAT/firewall because it's an outbound connection.

**Option D (hybrid)** keeps the local WS server for direct LAN connections (e.g., same-network mobile for low latency) while also connecting outbound to the relay for cross-network. This is the most flexible but adds complexity. Worth considering only if local low-latency is a requirement.

### Recommendation: **Option A** (Extension as WS Client) for v1, with Option D as a future enhancement

**Implementation sketch:**
1. Create a new `RelayClient` class in the extension that:
   - Connects to `wss://relay.sfrsh.xyz/v1/ws?token=<jwt>`
   - Authenticates with a relay-issued JWT (see Auth section below)
   - Registers as `client_type: "extension"`
   - Receives incoming relay envelopes and dispatches them to the existing handler methods
   - Sends responses back through the relay
   - Handles reconnection with exponential backoff
   - Sends heartbeat `pong` responses
2. The existing local `WsServer` can remain for direct LAN connections (or be deprecated)
3. Configuration: `skillInstaller.relay.url` setting (default: `wss://relay.sfrsh.xyz/v1/ws`)
4. The relay already handles all routing — no relay-side changes needed for basic connectivity

**Key design decisions:**
- The `RelayClient` should bridge incoming relay envelopes to the same `routeRequest` method already in `WsServer`
- The relay envelope's `payload` contains the JSON-RPC request; extract it and reuse existing handlers
- Responses are wrapped back into relay envelopes and sent to the relay for routing to the mobile source

---

## 2. Auth Architecture

### Current State (Broken)

The relay's `/auth/callback` ([auth.ts](cloud-relay/src/auth.ts)) exchanges the GitHub OAuth code and **returns the raw GitHub access token** directly to the mobile client:

```
POST /auth/callback → GitHub token exchange → returns { access_token, token_type, scope }
```

The mobile stores this raw GitHub token in `localStorage` and uses it to connect to the relay WebSocket via `?token=<github_token>`.

But the relay's `verifyToken` ([relay.ts](cloud-relay/src/relay.ts)) calls `jwt.verify()` expecting a JWT signed with `JWT_SECRET`, including claims like `client_id`, `client_type`, `sub`, `scopes`, etc. (`AccessTokenClaims`). A raw GitHub OAuth token is **not** a JWT signed by the relay — it's an opaque token. This means **WebSocket auth is currently broken**: the mobile can get a GitHub token but cannot authenticate the WebSocket connection.

### The Extension's Auth Problem

The extension has its own `WsAuthManager` ([wsAuth.ts](RannIA/src/wsAuth.ts)) that generates JWTs signed with a **locally-generated secret** stored in VS Code's `SecretStorage`. This is fine for local connections but these tokens are meaningless to the relay (different secret, different claims format).

The extension also has `GitHubOAuthManager` ([oauthManager.ts](RannIA/src/oauthManager.ts)) which can do a GitHub OAuth flow and store the user's GitHub identity. But it also stores the raw GitHub token, not a relay JWT.

### Recommended Auth Flow

The relay should mint its own JWTs after verifying GitHub identity. This is the standard pattern (Auth0, Supabase, Firebase all work this way):

```
┌──── Mobile or Extension ────┐   ┌──── Relay ────┐   ┌── GitHub ──┐
│                              │   │               │   │            │
│ 1. GitHub OAuth flow ────────┼──>│               │──>│ Authorize  │
│                              │   │               │   │            │
│ 2. Receive code ─────────────┼──>│ 3. Exchange   │──>│ Token      │
│                              │   │    code for   │<──│ (verify)   │
│                              │   │    GH token   │   │            │
│                              │   │               │   │            │
│                              │   │ 4. Fetch      │──>│ /user      │
│                              │   │    GH user    │<──│ (identity) │
│                              │   │               │   │            │
│ 5. Receive relay JWT ────────┼<──│ 6. Mint JWT   │   │            │
│    (access + refresh)        │   │    with claims│   │            │
│                              │   │               │   │            │
│ 7. Connect WS with ─────────┼──>│ 8. Verify JWT │   │            │
│    relay JWT                 │   │    (own key)  │   │            │
└──────────────────────────────┘   └───────────────┘   └────────────┘
```

**Relay-issued JWT claims (`AccessTokenClaims`):**
```json
{
  "sub": "github|12345",
  "client_id": "mob-<uuid>",
  "client_type": "mobile",
  "github_login": "username",
  "scopes": ["session:read", "session:write", "idea:read", "idea:write"],
  "iss": "instruction-engine-relay",
  "aud": "instruction-engine",
  "iat": 1738972800,
  "exp": 1738976400,
  "jti": "<uuid>"
}
```

**Changes needed in the relay:**
1. `/auth/callback` should: exchange code → fetch `/user` from GitHub → mint a relay JWT with `client_id` + `client_type` → return `{ access_token: <relay_jwt>, refresh_token: <relay_refresh>, user: { id, login, avatar_url } }`
2. Add `POST /auth/refresh` endpoint to exchange refresh tokens for new access tokens
3. The `client_id` should be generated server-side (e.g., `mob-<uuid>` or `ext-<uuid>`) and embedded in the JWT
4. The `client_type` can be provided by the client in the `/auth/callback` request body (add a `client_type` field)

**Token lifecycle:**
- **Access token**: 1 hour expiry (short-lived, used for WS auth and API calls)
- **Refresh token**: 30 days, stored securely, one-time use with rotation
- **GitHub token**: Not exposed to client at all; relay can optionally cache it server-side for GitHub API calls if needed, or discard it after fetching user info

**Extension-specific auth:**
- The extension should use the same `/auth/callback` flow but with `client_type: "extension"` and a VS Code URI handler redirect (`vscode://sofreshx.skill-installer/auth/callback`)
- The `GitHubOAuthManager` already handles the browser-based OAuth redirect; it just needs to exchange the code through the relay instead of directly with GitHub
- The relay-issued JWT is stored in VS Code `SecretStorage` (already supported)
- For users already signed into GitHub via VS Code's built-in auth, consider using `vscode.authentication.getSession('github', ['read:user'])` to get a GitHub token silently, then exchange it with the relay via a new `POST /auth/exchange` endpoint (token-for-token exchange)

**`POST /auth/exchange` (new endpoint):**
```json
// Request
{ "github_token": "<github_access_token>", "client_type": "extension" }

// Response (relay verifies GitHub token, mints relay JWT)
{ "access_token": "<relay_jwt>", "refresh_token": "<relay_refresh>", "user": {...} }
```

This is especially useful for the extension because VS Code's built-in GitHub auth can provide a token without any browser redirect flow.

---

## 3. Security Model Alignment

### What the Security Doc Claims vs Reality

| Claim | Reality | Verdict |
|-------|---------|---------|
| IndexedDB encrypted with Web Crypto API | Mobile uses plain `localStorage` for tokens | **False** |
| Redis encrypted at rest for relay tokens | No Redis; relay is stateless in-memory | **False** |
| Session-key encrypted payloads | No payload encryption exists | **False** |
| Refresh tokens (7 days) | No refresh tokens exist | **False** |
| Permission scopes (session:read, agent:invoke, etc.) | Scopes exist in types but not enforced | **Partially true** |
| CSRF with SameSite cookies | No cookies used; all token-based | **Not applicable** |
| Rate limiting | No rate limiting implemented | **False** |

### Minimum Viable Security for v1

**Must-have:**
1. **Relay-minted JWTs** (see Auth section) — the single most impactful fix
2. **Token storage**: `localStorage` is acceptable for a PWA v1. `httpOnly` cookies require the relay to serve the PWA (which it doesn't — the PWA is on Cloudflare Pages, relay is on a different domain). `localStorage` is fine when:
   - The app has no XSS vectors (React auto-escapes, CSP headers are set)
   - Tokens are short-lived (1h access tokens)
   - The threat model is personal-use, not high-value targets
3. **HTTPS/WSS everywhere** (already enforced by Traefik + Cloudflare)
4. **Origin validation** on the relay: check `Origin` header on WS upgrade to allow only known origins (mobile PWA domain, VS Code extension)
5. **Message size limits** (already implemented: `MAX_MESSAGE_SIZE`)
6. **Heartbeat + connection timeout** (already implemented)

**Should-have for v1.1:**
1. **Rate limiting on WS messages**: Simple sliding-window counter per client (e.g., 100 messages/minute). Implement in `handleMessage` before routing.
2. **Rate limiting on HTTP endpoints**: Use `express-rate-limit` for `/auth/*` endpoints (e.g., 10 requests/minute per IP)
3. **Scope enforcement**: The relay JWT contains scopes; the extension should check them before executing high-risk operations (`agent:invoke`, `execute_command`)

**Not needed for v1:**
- Payload encryption (TLS is sufficient for transport; E2E encryption adds complexity without proportional benefit for a personal-use tool)
- IndexedDB encryption (the data at rest is on the user's own device)
- Redis (the relay is single-instance; in-memory state is fine)

**Action: Rewrite `security-model.md`** to reflect actual v1 security posture. Remove aspirational features that don't exist. Document what IS implemented.

---

## 4. PWA Best Practices

### Push Notifications Without Firebase

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **Web Push API + VAPID** | Standard browser push via service worker | No vendor lock-in, free, works offline | Requires service worker, not supported on iOS <16.4 |
| Firebase Cloud Messaging | Google's push notification service | Easy setup, good iOS support | Vendor lock-in, requires Firebase project |
| WebSocket-based "push" | Show notifications when WS is connected | Simple, already have WS | Only works when app is open/foregrounded |
| Polling | Periodic fetch of pending notifications | Very simple | Battery drain, delayed, not real-time |

**Recommendation: Web Push API + VAPID for v1.1, WebSocket-based for v1**

For v1, just show in-app notifications when the WebSocket is connected. The PWA is a companion app — the user opens it intentionally. True push notifications can come later.

For v1.1, Web Push API with VAPID keys works without any third-party service:
1. Generate VAPID key pair (relay holds the private key)
2. Client subscribes via `PushManager.subscribe()` in service worker
3. Client sends subscription to relay (`POST /push/subscribe`)
4. Relay sends push via web-push npm package when events occur for offline users
5. Service worker handles `push` event and shows notification

iOS PWA push support landed in Safari 16.4 (March 2023) — this is now broadly available.

### Offline-first vs Online-required

**Recommendation: Online-required for v1**

The app's entire value proposition is real-time remote control of VS Code. Offline mode adds complexity (sync, conflict resolution, queue management) for minimal benefit. The mobile companion is a command center, not a content creation tool.

What to cache offline (already handled by VitePWA/Workbox):
- App shell (HTML, CSS, JS, icons)
- Static assets

What should NOT be cached:
- Session state (stale data is worse than no data)
- Client list (changes constantly)
- Agent invocations (require live connection)

The app already uses `VitePWA` with Workbox ([vite.config.ts](mobile-companion/vite.config.ts)) for asset caching. The `NetworkFirst` strategy for API calls is appropriate.

### Background Sync

Not recommended for v1. Background sync (`SyncManager`) is useful for retry-on-reconnect patterns (e.g., "send this idea when back online"). The current app doesn't have a strong use case for this. If ideas/notes are added as an offline-capable feature, revisit.

---

## 5. Extension Naming

### Current Name

- **Package name**: `skill-installer`
- **Display name**: `Instruction Engine Skill Installer`
- **Publisher**: `sofreshx`
- **Marketplace ID**: `sofreshx.skill-installer`

### Scope Creep

The extension now handles: skills, agents, tasks, remote control, mobile companion, MCP providers, chat participants, OAuth, WebSocket server, session management, and event streaming. "Skill Installer" is a significant understatement.

### VS Code Extension Naming Conventions

- Extensions cannot be renamed once published (the `name` in package.json is immutable on the marketplace)
- The `displayName` CAN be changed at any time
- The marketplace ID (`publisher.name`) is permanent
- Major VS Code extensions handle scope growth by updating `displayName` (e.g., "GitLens" started as "Git Blame" but the package name `gitlens` was always fine)
- Microsoft's convention: short, brandable name (e.g., `ms-vscode.remote-containers` → displayName "Dev Containers")

### Options

| Option | Package Name | Display Name | Breaking? |
|--------|-------------|-------------|-----------|
| A: Keep current | `skill-installer` | `Instruction Engine Skill Installer` | No |
| B: Update display only | `skill-installer` | `Instruction Engine` | No |
| C: Republish | `instruction-engine` | `Instruction Engine` | Yes (new extension) |

### Recommendation: **Option B** for now

Change `displayName` to `"Instruction Engine"` (drop "Skill Installer"). The package name `skill-installer` is fine — users rarely see it. The marketplace listing shows the display name. This is a zero-risk change.

If/when the extension reaches 1.0 and the brand matters, consider republishing as `instruction-engine` (Option C), but this requires users to uninstall/reinstall and loses any ratings/install counts.

---

## Proposed Tasks

### Task 1: Relay JWT Minting
- **Title**: Relay: mint own JWTs after GitHub OAuth verification
- **Rationale**: The relay currently returns raw GitHub tokens. The WebSocket auth expects relay-signed JWTs. This makes the entire auth chain non-functional.
- **Acceptance Criteria**: 
  - `POST /auth/callback` returns `{ access_token: <relay_jwt>, refresh_token, user }` 
  - `POST /auth/refresh` endpoint exists
  - `POST /auth/exchange` endpoint exists (for token-for-token exchange)
  - Existing `verifyToken` in relay.ts works with the new tokens
  - Mobile `authService.ts` updated to store/use relay JWTs
- **Dependencies**: None

### Task 2: Extension Relay Client
- **Title**: Extension: add outbound WebSocket client to cloud relay
- **Rationale**: Core connectivity gap — extension has no connection to relay
- **Acceptance Criteria**: 
  - New `RelayClient` class connects to `wss://relay.sfrsh.xyz/v1/ws`
  - Authenticates with relay-issued JWT
  - Bridges incoming relay envelopes to existing request handlers
  - Sends responses back through relay
  - Reconnects with exponential backoff
  - Configurable via `skillInstaller.relay.url` setting
- **Dependencies**: Task 1 (needs relay JWTs)

### Task 3: Extension Auth via Relay
- **Title**: Extension: authenticate with relay using VS Code GitHub session
- **Rationale**: Extension needs a relay JWT; can leverage VS Code's built-in GitHub auth for frictionless login
- **Acceptance Criteria**:
  - Uses `vscode.authentication.getSession('github', ['read:user'])` to get GitHub token
  - Exchanges with relay via `POST /auth/exchange`
  - Stores relay JWT in `SecretStorage`
  - Auto-refreshes before expiry
- **Dependencies**: Task 1

### Task 4: Security Doc Rewrite
- **Title**: Rewrite security-model.md to reflect actual implementation
- **Rationale**: Current doc describes features that don't exist (Redis, Web Crypto encryption, session keys). Misleading for contributors.
- **Acceptance Criteria**: 
  - Documents actual v1 security posture
  - Removes aspirational features not yet built
  - Clearly marks planned-but-not-implemented features
- **Dependencies**: None

### Task 5: Extension Display Name
- **Title**: Update extension displayName to "Instruction Engine"
- **Rationale**: Current name "Skill Installer" doesn't reflect actual scope
- **Acceptance Criteria**: `displayName` updated in package.json
- **Dependencies**: None

### Task 6: WS Rate Limiting
- **Title**: Add rate limiting to relay WebSocket and HTTP endpoints
- **Rationale**: No rate limiting exists; any authenticated client can flood the relay
- **Acceptance Criteria**:
  - HTTP: `express-rate-limit` on `/auth/*` (10 req/min/IP)  
  - WS: sliding window per client (100 msg/min), responds with error code `-32003`
- **Dependencies**: None

---

## Open Questions

1. **Should the local WS server be removed or kept alongside the relay client?** Keeping it allows direct LAN connections for lower latency, but adds maintenance burden. Recommend: keep for v1 but document that the relay is the primary path.

2. **Should the relay store GitHub tokens for server-side API calls?** Some features (like `workflow:dispatch` to trigger GitHub Actions) need a GitHub token. Options: (a) relay caches the GitHub token mapped to user, (b) the extension calls GitHub APIs directly on behalf of the mobile request. Recommend: (b) for v1 — the extension already has GitHub credentials.

3. **Multi-instance: what if a user has multiple VS Code windows?** The relay already supports multiple clients per user. The mobile app needs a client picker UI ("which VS Code instance?"). This is partially built in the relay (`list_clients` method) and mobile (`useClients` hook).

4. **Refresh token storage on relay**: If the relay mints refresh tokens, where are they stored? Currently the relay is stateless (in-memory only). Options: (a) stateless refresh tokens (JWT-based, longer expiry, signed with a different key), (b) add Redis/SQLite for token persistence. Recommend: (a) stateless JWT refresh tokens for v1 to avoid adding infrastructure.
