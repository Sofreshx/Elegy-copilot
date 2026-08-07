# Stable OAuth MCP Tunnel Completion Plan

## Scope

Implement `docs/specs/stable-oauth-mcp-tunnel-completion/spec.md` after the user supplies a
Cloudflare zone/hostname and authorizes external provisioning or provides an existing named tunnel.

## Current Baseline

- Persistent and Quick profiles, schema migration, stable offline state, and rollback are shipped.
- Named-tunnel config, credentials, ingress, identity, and version validation are shipped.
- Built-in OAuth supports discovery, dynamic registration, exact redirects, PKCE, canonical
  resources, audience-bound JWTs, refresh rotation/replay revocation, and token revocation.
- Synthetic OAuth and authenticated MCP acceptance passes locally.
- Pending approval, diagnostics, registration guidance, and operator documentation are shipped.
- Real Cloudflare and ChatGPT evidence, managed provisioning, autostart, and crash recovery remain.

## Required Inputs

1. Cloudflare account and eligible DNS zone.
2. Chosen stable hostname.
3. Either:
   - authorization to preview and execute managed `cloudflared` provisioning, or
   - an existing tunnel name/UUID, credentials file, DNS route, and config path.
4. A ChatGPT account with custom MCP app creation available.
5. Permission to perform the documented manual registration and restart matrix.

Stop before external mutation if any input or confirmation is missing.

## Implementation Order

### 1. Managed Provisioning Boundary

- Add a read-only preview endpoint that resolves the exact `cloudflared tunnel create`,
  `tunnel route dns`, and config-write operations.
- Add a separate confirmation endpoint with an expiring preview identifier.
- Persist discovered tunnel UUID and credentials path only after commands succeed.
- On partial failure, preserve Cloudflare resources and return precise recovery instructions.
- Never place secrets or credential contents in API responses or logs.

Gate: preview/cancel/confirm/partial-failure tests pass; existing-tunnel validation remains green.

### 2. Autostart and Owned Recovery

- Persist setup-completion version and autostart preference.
- On desktop startup, validate configuration before starting Stable mode.
- Track strong process ownership metadata outside module memory.
- Adopt only matching owned processes; reject ambiguous listeners.
- Restart the owned MCP server or connector with bounded backoff after a crash.
- Stop retrying on credentials, configuration, security, or repeated-failure blockers.

Gate: cold-start, crash, duplicate-process, stale-PID, and Quick-fallback integration tests pass.

### 3. Diagnostics and Repair

- Add structured DNS, TLS, Cloudflare edge, local connector, OAuth metadata, and full-flow results.
- Add redacted diagnostic export.
- Add repair actions for missing DNS, config mismatch, missing credentials, stale approval secret,
  and failed public OAuth probe.
- Keep destructive removal as a separate preview-and-confirm workflow.

Gate: every known blocker has a stable code, actionable message, test fixture, and secret-redaction
assertion.

### 4. Real Cloudflare Acceptance

- Provision or validate the named tunnel and DNS route.
- Confirm public TLS and streaming MCP behavior.
- Run the built-in full OAuth connection test from the desktop.
- Stop and restart Elegy and `cloudflared` three times, confirming the endpoint is unchanged.
- Record versions, timestamps, hostname with non-secret identifiers, and results.

Gate: Cloudflare acceptance report passes with no critical or high-severity findings.

### 5. Real ChatGPT Acceptance

- Register the stable `/mcp` endpoint once with OAuth.
- Complete approval in Elegy and verify tool discovery and read-only calls.
- Exercise short access-token TTL and confirm refresh without app recreation.
- Revoke the refresh family and confirm reauthorization is required.
- Repeat the restart matrix without changing the ChatGPT app.

Gate: the real app works after restart and refresh; the same endpoint and app registration remain.

### 6. Supported Release Promotion

- Remove the experimental label only after gates 1–5 pass.
- Add compatibility date and tested ChatGPT behavior to canonical docs.
- Add upgrade, rollback, recovery, and known-limitations release notes.
- Run the full repository and desktop packaging gates.

Gate: `npm run ci:local`, `npm run ui:check`, native desktop smoke, installer preview, Local Repo MCP
tests, Quick regression, and manual acceptance evidence all pass.

## Risks

| Risk | Control |
|---|---|
| External resources created unintentionally | Preview identifier plus explicit confirmation; no implicit provisioning. |
| Partial Cloudflare provisioning | Preserve created resources and return idempotent repair commands. |
| Duplicate or foreign process termination | Strong ownership metadata and listener identity checks. |
| Secrets in diagnostics | Allowlisted fields and token-shaped-value redaction tests. |
| ChatGPT behavior changes | Date-stamped compatibility report and synthetic protocol tests. |
| Refresh replay locks out a valid client | Family revocation is explicit; UI explains reauthorization recovery. |
| Stable failure breaks temporary access | Quick mode stays independent and has a dedicated regression gate. |

## Validation

- Focused manager, Cloudflare, route, UI, and OAuth tests
- `npm --prefix local-repo-mcp test`
- `npm run quality:typecheck`
- `npm run docs:check:links`
- `npm run ci:local`
- `npm run ui:check`
- Native desktop smoke and Windows installer preview
- Real Cloudflare acceptance report
- Real ChatGPT authorization, refresh, revocation, and restart report

## Completion Condition

The feature is complete only when every automated gate passes, real Cloudflare and ChatGPT evidence
is committed, and the UI/docs promote Persistent OAuth Tunnel from experimental to supported.
