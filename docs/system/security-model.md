---
created: 2026-02-23
updated: 2026-04-08
category: system
status: current
doc_kind: node
id: security-model
summary: Implemented security architecture and threat model for the Instruction Engine relay ecosystem.
tags: [security]
---

# Security Model — Instruction Engine Relay (v1)

> **Last updated**: 2026-04-08
>
> This document describes the **actual, implemented** security architecture of the Instruction Engine runtime ecosystem. Claims are verified against source code. Planned-but-unimplemented features are clearly marked as **v2 Planned**.

## Desktop Distribution Trust Chain — Current State + Approved Migration Target (G-02-WU-01)

These decisions are locked for the desktop-distributed `instruction-engine` runtime. The current
desktop path is a Windows-first Tauri shell with a bundled Node sidecar, as defined in
[[desktop-runtime-tauri-migration-contract]]
[docs/system/desktop-runtime-tauri-migration-contract.md](docs/system/desktop-runtime-tauri-migration-contract.md).

| Topic | Decision | Owner |
|---|---|---|
| Runtime packaging | Current primary state: Windows-first Tauri shell with bundled Node sidecar; the active Windows release path is manual-installer metadata rather than live in-app updater parity. | Release Engineering |
| Channel scope | Current packaged release scope is the Windows Tauri desktop path. | Product + Release Engineering |
| Signing custody | Signing material remains external (OIDC -> managed signing service/HSM/KMS); no private keys in repo or runner filesystem | Security Engineering |
| Key/cert rotation authority | Rotation cadence and emergency rotation owned by Security Engineering, executed with Release Engineering | Security Engineering |
| Rollback / kill-switch authority | Release Engineering can pause channels, roll back feed pointers, and force minimum-safe-version blocks | Release Engineering |

Operational constraints:
- Stable channel never consumes prerelease artifacts.
- Promotion requires matching provenance/attestation evidence.
- Missing or invalid signing evidence is release-blocking (fail closed).

### Rollback + Kill-Switch Activation Rules (G-06-WU-03)

Desktop release safety uses deterministic threshold gates:

- `R1` immediate rollback: any single safety failure (`PLANNING_MIGRATION_CHECKSUM_DRIFT`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`).
- `R2` rollback escalation: two consecutive fail-closed policy-load cycles (`rollback_policy_source_unavailable` or `rollback_policy_malformed`) after remediation.
- `K1` immediate kill switch: trust-chain compromise signals (signing/provenance evidence mismatch or unresolved checksum drift in release gating).
- `K2` global kill switch escalation: `R2` persists and no safe rollback target can be published.

Ownership and approval:

- Release Engineering executes rollback and kill-switch changes.
- On-call incident commander approves activation/deactivation.
- Security Engineering co-approves trust-chain compromise responses.

Reference runbook: [Desktop Update Rollback + Kill Switch Runbook](desktop-update-rollback-runbook.md).

### CI Enforcement — Signing Trust Chain (G-02-WU-04)

Desktop release CI is split between a public preview lane and the signed maintainer lane:

- Public preview lane:
  - `.github/workflows/desktop-preview-release.yml` can be auto-triggered from a matching semver tag or manually dispatched with a target `ref` plus a preview `tag_name`.
  - It publishes clearly labeled unsigned preview assets to GitHub Releases for open-source evaluation.
- Signed maintainer lane:
  - `.github/workflows/desktop-version-tag.yml` is manually dispatched by maintainers to create `desktop-v*` tags from an explicit target ref when the desktop release helper is intentionally invoked.
  - `.github/workflows/desktop-release.yml` auto-runs on pushed `desktop-v*` tags and also supports manual dispatch with `release_tag`.
  - It validates that the requested desktop tag matches `copilot-ui/package.json` and only publishes after signing checks pass.
- Windows GA artifact flow:
  - Build unsigned installer on `windows-latest`.
  - Exchange GitHub OIDC token (`id-token: write`) for signing identity.
  - Call managed signing endpoint (`DESKTOP_SIGNING_SERVICE_URL`) with no private keys in repo/runner.
  - Require signing evidence from service response:
    - `signature-manifest.json`
    - `provenance.attestation.json`
  - Fail closed if endpoint/evidence is missing.
- Linux preview flow:
  - Build preview artifact and metadata digest.
  - Sign metadata via the managed signing endpoint using OIDC.
  - Verify metadata signature in CI before publish.
- macOS preview flow:
  - Publish preview artifact only with explicit unsigned label (`MAC_PREVIEW_UNSIGNED.txt`).
- Publish gate:
  - Public preview releases can publish unsigned assets without the private signing service.
  - Signed GitHub releases for `desktop-v*` tags are created only after all verification checks pass.
  - Prerelease flag is inferred from desktop tag semver suffix (`desktop-vx.y.z-*` => prerelease).

Required repository configuration (placeholders, not committed secrets):

- Repository variable: `DESKTOP_SIGNING_SERVICE_URL` (required)
- Repository variable: `DESKTOP_SIGNING_SERVICE_AUDIENCE` (optional; default `elegy-copilot-desktop-release`)
- Repository secret: `DESKTOP_SIGNING_SERVICE_API_KEY` (optional, service-specific)

### Final Gate Trusted Evidence Binding + Retention (G-05-WU-06)

Planpack final-gate validation (`scripts/validate-planpack-execution.js`, backed by the shared `scripts/validate-planpack.js` implementation) requires release evidence to be bound to deployment context before `trustedEvidenceBindingRetention` can pass:

- Trusted binding must include commit SHA, release tag, channel, producer identity, attestation status, and evidence timestamp.
- Missing fields, attestation false, stale evidence, or expected binding mismatch fail closed.
- CI can enforce deterministic binding with `--expected-commit`, `--expected-release`, and `--expected-channel`.
- Retention policy is enforced in the same control:
  - ops logs retention must be at least 30 days,
  - per-release evidence must be retained and present.
- Validation failures force `required=false/fail` behavior for the control and block final gate success.

## Canonical Policy Source (G-03-WU-01)

Policy truth is now centralized under:
- `engine-assets/policy/policy.schema.json`
- `engine-assets/policy/pipeline-policy.json`

Policy and scanner work must treat these files as the only canonical source for versioned policy semantics (`schemaVersion`, `policyVersion`).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Token Design](#token-design)
4. [Token Storage](#token-storage)
5. [Database Security](#database-security)
6. [Authorization & Scopes](#authorization--scopes)
7. [Transport Security](#transport-security)
8. [CSRF Protection](#csrf-protection)
9. [Rate Limiting](#rate-limiting)
10. [Security Headers](#security-headers)
11. [Threat Model](#threat-model)
12. [Known v1 Limitations](#known-v1-limitations)
13. [v2 Planned Improvements](#v2-planned-improvements)
14. [Incident Response](#incident-response)
15. [Best Practices](#best-practices)

---

## Architecture Overview

```
┌──────────────────┐          ┌──────────────────┐          ┌──────────────┐
│  Mobile PWA      │◄──WSS──►│  Cloud Relay     │◄──WSS──►│  Desktop      │
│  (browser)       │          │  (Node.js)       │          │  Shell        │
└──────────────────┘          └───────┬┬─────────┘          └──────────────┘
                                      ││
                              ┌───────┘└─────────┐
                              │                  │
                     ┌────────┴─────────┐  ┌─────┴────────┐
                     │   GitHub OAuth   │  │  SQLite DB   │
                     │   (identity)     │  │  (relay.db)  │
                     └──────────────────┘  └──────────────┘
```

The relay is a **persistent** message router with a SQLite database (WAL mode, `better-sqlite3`). It:

- Authenticates clients via GitHub OAuth → relay-minted JWTs
- Does **not** store tokens or secrets server-side — auth remains JWT-based
- Stores user profiles (GitHub login, avatar) and offline messages in SQLite
- Persists offline messages to disk so they survive relay restarts
- Routes JSON-RPC messages between authenticated clients over WebSocket
- Enforces per-method authorization scopes
- Applies rate limiting on HTTP and WebSocket channels

---

## Authentication

### Mobile PWA Flow (OAuth Authorization Code)

```
Mobile                        Relay                         GitHub
  │                             │                              │
  │  1. POST /auth/login        │                              │
  │    { redirect_uri }         │                              │
  │───────────────────────────►│                              │
  │                             │                              │
  │  2. { auth_url, state }     │                              │
  │◄───────────────────────────│                              │
  │                             │                              │
  │  3. Redirect to GitHub      │                              │
  │─────────────────────────────────────────────────────────►│
  │                             │                              │
  │  4. User authorizes         │                              │
  │◄─────────────────────────────────────────────────────────│
  │                             │                              │
  │  5. POST /auth/callback     │                              │
  │    { code, state }          │                              │
  │───────────────────────────►│                              │
  │                             │  6. Exchange code for token  │
  │                             │────────────────────────────►│
  │                             │                              │
  │                             │  7. GET /user (verify)       │
  │                             │────────────────────────────►│
  │                             │                              │
  │  8. { access_token,         │                              │
  │       refresh_token,        │                              │
  │       scopes, user }        │                              │
  │◄───────────────────────────│                              │
```

1. Mobile requests a GitHub OAuth URL via `POST /auth/login`
2. Relay returns the GitHub authorization URL with an HMAC-signed `state` parameter (see [CSRF Protection](#csrf-protection))
3. User authorizes in the browser; GitHub redirects back with `code` + `state`
4. Mobile sends the code to `POST /auth/callback`
5. Relay verifies the CSRF state, exchanges the code for a GitHub access token, then calls GitHub's `/user` API to verify identity
6. Relay mints **relay-issued JWTs** (access + refresh) and returns them to the client

### Desktop Shell / Trusted Client Flow (Token Exchange)

```
Trusted Client                Relay                         GitHub
  │                             │                              │
  │  Host auth surface obtains  │                              │
  │  a GitHub token             │                              │
  │─────────────────────────────────────────────────────────►│
  │                             │                              │
  │  GitHub token               │                              │
  │◄─────────────────────────────────────────────────────────│
  │                             │                              │
  │  POST /auth/exchange        │                              │
  │  { github_token }           │                              │
  │───────────────────────────►│                              │
  │                             │  GET /user (verify)          │
  │                             │────────────────────────────►│
  │                             │                              │
  │  { access_token,            │                              │
  │    refresh_token,           │                              │
  │    scopes, user }           │                              │
  │◄───────────────────────────│                              │
```

1. A trusted non-browser client obtains a GitHub token via its host authentication surface
2. The client sends the GitHub token to `POST /auth/exchange`
3. Relay verifies the token by calling GitHub's `/user` API
4. Relay mints relay JWTs and returns them

> **Security note**: Any valid GitHub token that can call `/user` will be accepted by `/auth/exchange`. This is a known v1 trade-off — GitHub's API does not expose which OAuth app issued a token. Short access TTL (1h) and rate limiting mitigate abuse. See [v2 Planned Improvements](#v2-planned-improvements) for device attestation.

### Token Refresh

`POST /auth/refresh` accepts a valid refresh token and returns a **new** access + refresh token pair (rotation). The previous refresh token is not explicitly invalidated (token rotation is stateless — see [Known v1 Limitations](#known-v1-limitations)).

### Token Revocation

`POST /auth/revoke` is a **client-side cleanup endpoint only**. It always returns `{ revoked: true }`. Because tokens are stateless JWTs (not stored in the database), the relay cannot truly revoke them server-side. The access token's 1-hour TTL limits the blast radius of a compromised token.

### WebSocket Authentication

1. Client connects to `/v1/ws`
2. Client sends an `authenticate` JSON-RPC message with `{ token: "<relay access JWT>" }` — or passes the token as a `?token=` query parameter on the upgrade URL
3. Relay verifies the JWT (signature, issuer, audience, expiry)
4. On success: client is registered in the connection manager, receives an auth response with `clientId`, `userId`, and `scopes`
5. **Auth timeout**: unauthenticated connections are dropped after **30 seconds** (close code `4001`)

---

## Token Design

All relay-issued tokens are **HS256 JWTs** signed with a shared secret (`JWT_SECRET` env var).

### Access Token

| Claim | Description | Example |
|-------|-------------|---------|
| `sub` | User identifier | `github\|12345` |
| `jti` | Unique token ID (UUIDv4) | `a1b2c3d4-...` |
| `client_id` | Relay-assigned client ID (UUIDv4) | `e5f6a7b8-...` |
| `client_type` | Client kind | `mobile` or another trusted desktop/non-browser client |
| `scopes` | Authorization scopes (array) | `["read:status", ...]` |
| `github_login` | GitHub username | `octocat` |
| `iss` | Issuer | `instruction-engine-relay` |
| `aud` | Audience | `instruction-engine` |
| `iat` | Issued at (epoch) | `1738972800` |
| `exp` | Expires at (epoch) | `iat + 3600` |

**TTL**: 1 hour (configurable via `ACCESS_TOKEN_TTL` env var)

### Refresh Token

| Claim | Description |
|-------|-------------|
| `sub` | User identifier |
| `jti` | Unique token ID (UUIDv4) |
| `github_login` | GitHub username |
| `token_type` | Always `"refresh"` |
| `iss` / `aud` | Same as access token |
| `iat` / `exp` | Issued / expires |

**TTL**: 30 days (configurable via `REFRESH_TOKEN_TTL` env var)

---

## Token Storage

| Platform | Storage Method | Encryption | Notes |
|----------|---------------|------------|-------|
| **Desktop shell / trusted non-browser client** | Host-managed secure storage | OS/platform dependent | Preferred over browser-only token storage when a secure host lane exists |
| **Mobile PWA** | `localStorage` | **None (plaintext)** | ⚠️ Known v1 limitation — see below |
| **Cloud Relay** | SQLite — user info only (no tokens) | **None (no encryption at rest)** | Stores user profiles (`github_login`, `avatar_url`) and offline messages; does NOT store tokens or secrets |

### Mobile Storage Limitation

The mobile PWA stores relay JWTs in `localStorage`, which is accessible to any JavaScript running on the same origin. This is a **known v1 trade-off** (see Decision D4 in the plan). Mitigations:

- CORS restricts relay API access to configured origins
- Access tokens expire in 1 hour, limiting exposure window
- The PWA is served from a dedicated subdomain, reducing cross-origin XSS risk

---

## Database Security

The relay uses a SQLite database (`better-sqlite3`) for persistent storage. The database file is located at `/app/data/relay.db` inside the Docker container, backed by a named Docker volume (`relay-data`).

### Configuration

| Setting | Value |
|---------|-------|
| **Engine** | `better-sqlite3` (synchronous, single-writer) |
| **Journal mode** | WAL (concurrent reads, single writer) |
| **Synchronous** | NORMAL |
| **Foreign keys** | Enabled |
| **Busy timeout** | 5000ms |
| **Schema versioning** | Auto-migrated on startup via `schema_version` table |

### Database Schema (v1)

| Table | Purpose | Contains Secrets? |
|-------|---------|-------------------|
| `schema_version` | Tracks applied migrations | No |
| `users` | User profiles from GitHub OAuth (`id`, `github_login`, `avatar_url`, timestamps) | No — no tokens, passwords, or secrets |
| `sessions` | Agent session tracking (status, prompt, metadata) | No |
| `task_queue` | Persistent task queue per user | No |
| `push_subscriptions` | Web Push subscription endpoints and keys per user | Contains VAPID keys (`keys_p256dh`, `keys_auth`) — public-ish but should stay protected |
| `offline_messages` | Messages queued for offline clients (JSON payloads, expiry timestamps) | May contain message content — same trust model as in-transit messages |
| `processed_message_ids` | Deduplication tracking for delivered offline messages | No |

### What the Database Does NOT Store

- **No tokens** — relay JWTs are stateless; the database has no token table
- **No GitHub access tokens** — GitHub tokens are exchanged for relay JWTs and then discarded
- **No `JWT_SECRET`** — stored only in environment variables
- **No passwords or user credentials**

### Security Considerations

- **No encryption at rest**: The SQLite file is stored unencrypted on the Docker volume. Access control depends on Docker volume isolation and server-level permissions.
- **Docker volume isolation**: The `relay-data` named volume is only mounted by the relay container. The Dockerfile creates the `/app/data` directory with restricted ownership (`nodejs:nodejs`).
- **Offline message content**: Messages stored in `offline_messages` contain the same JSON-RPC payloads that would otherwise transit the WebSocket in plaintext. The security posture matches in-transit messages (TLS protects the channel; the relay can read content).
- **Push subscription keys**: The `keys_p256dh` and `keys_auth` values in `push_subscriptions` are not secrets per se (they are public keys for the Web Push protocol), but they should be protected to prevent unauthorized push notifications.
- **Backup**: SQLite WAL mode allows safe file-level backup of the `.db` file while the relay is running. No automated backup is configured in v1.

---

## Authorization & Scopes

Scopes are **assigned by client type**, not by user role. There is no role-based access control (RBAC) in v1.

### Scope Definitions

| Scope | Description | Assigned To |
|-------|-------------|-------------|
| `read:status` | Query relay/desktop status | Mobile, Desktop |
| `read:sessions` | List active agent sessions | Mobile, Desktop |
| `write:sessions` | Start/cancel sessions, invoke agents, execute commands | Mobile, Desktop |
| `read:events` | Subscribe to session events | Mobile, Desktop |
| `write:permissions` | Resolve permission requests | Mobile, Desktop |
| `read:clients` | List connected clients, manage groups | Mobile, Desktop |
| `admin:clients` | Disconnect other clients | Desktop only |

### Default Scope Assignments

| Client Type | Scopes |
|-------------|--------|
| **Mobile** | `read:status`, `read:sessions`, `write:sessions`, `read:events`, `write:permissions`, `read:clients` |
| **Desktop** | All mobile scopes + `admin:clients` |

### Scope Enforcement

Every incoming message is checked against scope requirements before dispatch:

**Control methods** (direct JSON-RPC to relay):

| Method | Required Scope |
|--------|---------------|
| `list_clients` | `read:clients` |
| `get_client` | `read:clients` |
| `disconnect_client` | `admin:clients` |
| `join_group` / `leave_group` | `read:clients` |
| `list_group_members` / `list_my_groups` | `read:clients` |
| `get_offline_queue_stats` | `read:status` |
| `initialize` | *(unrestricted)* |

**Relayed methods** (forwarded via `RelayEnvelope`):

| Method | Required Scope |
|--------|---------------|
| `execute_command` | `write:sessions` |
| `get_status` | `read:status` |
| `invoke_agent` | `write:sessions` |
| `get_sessions` | `read:sessions` |
| `cancel_session` | `write:sessions` |
| `subscribe_events` / `unsubscribe_events` | `read:events` |
| `resolve_permission` | `write:permissions` |
| `get_pending_permissions` | `read:events` |

**Unauthorized requests** receive error code `-32004 FORBIDDEN` with message `Missing required scope: <scope>`.

---

## Transport Security

### TLS

- **Production**: All connections are over TLS (HTTPS / WSS). TLS termination is handled by Traefik reverse proxy with Let's Encrypt certificates
- **Local development**: Plaintext `http://` / `ws://` is acceptable on localhost

### WebSocket

- Endpoint: `/v1/ws`
- Max payload size: 1 MB (configurable via `MAX_MESSAGE_SIZE`)
- Heartbeat pings detect stale connections
- Message age validation: messages older than 5 minutes are rejected

### What Is NOT Encrypted

- **Message payloads are plaintext JSON** over the TLS channel. There is no application-layer payload encryption (no session keys, no E2E encryption). TLS provides confidentiality in transit, but the relay can read all message content.

---

## CSRF Protection

### OAuth State Parameter

The `/auth/login` endpoint generates a CSRF-resistant state parameter:

1. A random nonce is generated (or accepted from the client)
2. An HMAC-SHA256 signature is computed over the nonce using the relay's `JWT_SECRET`
3. The state is formatted as `{nonce}.{hmac}` and included in the GitHub OAuth URL

On `/auth/callback`:

1. The state parameter is split into nonce and HMAC
2. The HMAC is recomputed and compared using `crypto.timingSafeEqual` (constant-time comparison)
3. Mismatched state → `400 Invalid state parameter (CSRF verification failed)`

### WebSocket Origin Validation

The relay validates the `Origin` header on WebSocket upgrade requests:

- Connections **with** an `Origin` header must match the `CORS_ORIGINS` allowlist
- Connections **without** an `Origin` header are allowed (trusted non-browser or server-side clients may not send Origin headers)
- Disallowed origins receive HTTP `403 Origin not allowed`

Default allowed origin: `https://companion.sfrsh.xyz`

### HTTP CORS

The auth router restricts `Access-Control-Allow-Origin` to origins in the `CORS_ORIGINS` env var. Only `POST` and `OPTIONS` methods are allowed.

---

## Rate Limiting

### HTTP Endpoints

Auth endpoints (`/auth/*`) are rate-limited via `express-rate-limit`:

| Parameter | Value |
|-----------|-------|
| Window | 60 seconds |
| Max requests per IP | 10 |
| Headers | Standard (`RateLimit-*`) |
| Error response | `{ error: { code: -32003, message: "Too many requests, please try again later" } }` |

### WebSocket Messages

Authenticated WebSocket messages are rate-limited per client via a token-bucket algorithm:

| Parameter | Value |
|-----------|-------|
| Bucket capacity (burst) | 100 messages |
| Refill rate | ~1.67 msg/sec (100/min) |
| Stale bucket cleanup | Every 60 seconds |
| Bucket TTL | 5 minutes idle |

When a client exceeds the rate limit:
- Error code: `-32003 RATE_LIMITED`
- Response includes `retryAfter` (seconds)
- Bucket automatically refills — client can resume after waiting

---

## Security Headers

The relay uses the `helmet` middleware, which sets the following headers by default:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `X-XSS-Protection: 0` (deprecated, CSP preferred)
- `Strict-Transport-Security` (HSTS)
- `X-DNS-Prefetch-Control: off`
- And others per helmet defaults

---

## Threat Model

### Attack Vectors & Mitigations

| Threat | Mitigation | Residual Risk |
|--------|-----------|---------------|
| **Token theft (mobile)** | 1h access TTL, refresh rotation | localStorage is vulnerable to XSS on the same origin |
| **Token theft (desktop host client)** | Host-managed secure storage when available | Low — requires host/OS-level compromise |
| **Man-in-the-middle** | TLS/WSS required in production (Traefik + Let's Encrypt) | None when TLS is properly configured |
| **CSRF on OAuth** | HMAC-signed state parameter with timing-safe comparison | Low |
| **WebSocket hijacking** | Origin validation on upgrade, JWT auth required within 30s | Server-side clients (no Origin) are allowed by design |
| **Brute-force auth** | 10 req/min per IP on `/auth/*` | Distributed attacks could bypass IP-based limiting |
| **Message flooding** | Token-bucket rate limiter, 100 msg/min per client | Burst of 100 messages is allowed before throttling |
| **Relay reads messages** | N/A — relay is trusted infrastructure | Relay operator can see all message content (no E2E encryption) |
| **Compromised JWT secret** | Rotate `JWT_SECRET` and redeploy; all tokens invalidated | Until rotated, attacker can mint arbitrary tokens |

### Trust Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                    User's Machine (Trusted)                     │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │  Desktop     │    │  Host secure storage                 │  │
│  │  Shell       │◄──►│  Stores relay JWTs when available    │  │
│  └──────────────┘    └──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                     WSS (TLS Boundary)
                              │
┌────────────────────────────────────────────────────────────────┐
│                  Cloud Relay (Semi-Trusted)                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Node.js service behind Traefik (SQLite for persistence) │  │
│  │  • Verifies JWTs (HS256)                                 │  │
│  │  • Routes messages between clients                       │  │
│  │  • Enforces scopes and rate limits                       │  │
│  │  • Stores user profiles & offline messages (SQLite)      │  │
│  │  • Can read all message content (no E2E encryption)      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                     WSS (TLS Boundary)
                              │
┌────────────────────────────────────────────────────────────────┐
│                  Mobile Device (Semi-Trusted)                   │
│  ┌──────────────┐    ┌──────────────────────────────────────┐  │
│  │  Mobile PWA  │    │  localStorage (⚠️ plaintext)         │  │
│  │  (browser)   │◄──►│  Stores relay JWTs                   │  │
│  └──────────────┘    └──────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                       HTTPS (GitHub API)
                              │
┌────────────────────────────────────────────────────────────────┐
│                  GitHub (External, Trusted)                     │
│  ┌──────────────┐                                              │
│  │  OAuth +     │  Identity provider; relay never stores       │
│  │  User API    │  GitHub tokens server-side                   │
│  └──────────────┘                                              │
└────────────────────────────────────────────────────────────────┘
```

---

## Known v1 Limitations

These are intentional trade-offs for v1. Each has been evaluated and accepted with documented mitigations.

| Limitation | Impact | Mitigation | Tracking |
|-----------|--------|------------|----------|
| **localStorage for mobile tokens** | Tokens accessible to same-origin JS (XSS risk) | Dedicated subdomain, 1h access TTL, CORS restriction | v2: migrate to HttpOnly cookies or Web Crypto |
| **No server-side token revocation** | `/auth/revoke` is client-side only; compromised tokens valid until expiry | 1h access TTL limits blast radius; rotate `JWT_SECRET` for emergency revocation | v2: JTI blocklist with short Redis TTL |
| **No RBAC** | Scopes assigned by client type, not user role | Sufficient for current two-client-type model | v2: role-based scope assignment |
| **No E2E encryption** | Relay can read all message content | Relay is trusted infrastructure; TLS protects in transit | v2: E2E encryption between client pairs |
| **No device binding** | Tokens not bound to a specific device/browser | Short TTL, rate limiting | v2: device attestation |
| **Refresh token reuse window** | Stateless rotation means old refresh token is valid until expiry | 30d TTL; in practice, rotation replaces tokens quickly | v2: JTI blocklist |
| **`/auth/exchange` accepts any GitHub token** | Any valid GitHub PAT/token grants relay access | Short access TTL (1h), rate limiting (10 req/min) | v2: device attestation, provenance checks |
| **No database encryption at rest** | SQLite file is unencrypted on the Docker volume | Docker volume isolation, server-level access control, no tokens/secrets stored in DB | v2: database encryption at rest |
| **No database backup automation** | Manual file-level backup only | SQLite WAL mode allows safe file-level copy while running | v2: automated backup/restore strategy |

---

## v2 Planned Improvements

> **Status**: Not implemented. Listed here for roadmap visibility.

- **HttpOnly cookie or Web Crypto token storage** for mobile, replacing `localStorage`
- **JTI blocklist** (Redis with short TTL) for true token revocation
- **E2E payload encryption** between client pairs (relay cannot read content)
- **Device attestation / binding** — tokens tied to a device fingerprint
- **Role-based access control (RBAC)** — user-assigned roles instead of client-type scopes
- **Push notifications** for mobile (ServiceWorker + Web Push API) — **In Progress** (e3t-011)
- **Token provenance verification** on `/auth/exchange` (if GitHub's API supports it)
- **CSP headers** on the mobile PWA serving layer
- **Database encryption at rest** (e.g., SQLCipher or OS-level volume encryption)
- **Database backup/restore strategy** — automated periodic backups of `relay.db`

---

## Incident Response

### If tokens are compromised

1. **Rotate `JWT_SECRET`** on the relay and redeploy — this immediately invalidates all access and refresh tokens
2. Revoke the GitHub OAuth app credentials if the OAuth flow itself is compromised
3. Notify affected users to re-authenticate
4. Review relay logs for unauthorized access patterns

### If the relay server is compromised

1. Take the relay offline immediately
2. Rotate `JWT_SECRET`, `GITHUB_CLIENT_SECRET`, and all env vars
3. Deploy a fresh instance with new credentials
4. Notify users — all existing tokens are invalid after secret rotation
5. Audit access logs for the compromise window

### If a client device is compromised

1. User should revoke their GitHub OAuth grant (GitHub Settings → Applications)
2. Rotate `JWT_SECRET` if the scope of compromise is unclear
3. Mobile: clear `localStorage` on the compromised device
4. Desktop shell / other secure host clients: clear host-managed secure storage on sign-out

---

## Best Practices

### For Users

1. Enable **GitHub 2FA** — the relay's security is only as strong as the GitHub account
2. Prefer the **packaged desktop shell** or another secure host client over browser-only token storage when possible
3. Do not use the mobile PWA on shared/public devices
4. Review GitHub OAuth grants periodically (Settings → Applications → Authorized OAuth Apps)

### For Operators

1. **Set a strong `JWT_SECRET`** — at least 32 bytes of cryptographic randomness
2. **Configure `CORS_ORIGINS`** to only allow your mobile PWA domain
3. **Serve the relay behind TLS** (Traefik, nginx, or cloud load balancer)
4. **Rotate `JWT_SECRET` periodically** — all clients will need to re-authenticate
5. **Monitor rate-limit rejections** for signs of abuse
6. **Keep `REQUIRE_AUTH=true`** in production (default)

### For Developers

1. Never commit `JWT_SECRET` or `GITHUB_CLIENT_SECRET` to source control
2. Use environment variables for all sensitive configuration
3. Never log token values — log `jti` (token ID) instead for traceability
4. Validate all user input; don't trust `client_type` from untrusted callers (relay assigns scopes server-side based on client type)
