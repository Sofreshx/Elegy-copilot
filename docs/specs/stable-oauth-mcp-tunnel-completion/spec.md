---
spec_id: stable-oauth-mcp-tunnel-completion
title: Stable OAuth MCP Tunnel Completion
status: approved
type: feature
updated: 2026-07-25
approved_at: 2026-07-25
---

# Stable OAuth MCP Tunnel Completion

## Intent

Promote the implemented Persistent OAuth Tunnel from an experimental, locally validated feature
to a supported release backed by real Cloudflare and ChatGPT acceptance evidence.

## Context Evidence

- `docs/system/mcp-workflow.md`: current exposure-mode and security contract.
- `copilot-ui/lib/localRepoMcpCloudflare.js`: named-tunnel validation.
- `copilot-ui/lib/localRepoMcpManager.js`: process lifecycle and synthetic OAuth readiness.
- `local-repo-mcp/src/localOAuth.ts`: built-in OAuth grants, refresh rotation, and revocation.
- `local-repo-mcp/src/tests/serverHttp.test.ts`: synthetic end-to-end OAuth flow.

## Requirements

### Allowed Behavior

- A user may provision a new named tunnel only after reviewing and confirming the exact
  `cloudflared` commands and filesystem writes.
- Existing-tunnel setup remains available without recreating Cloudflare resources.
- Stable mode can autostart only after configuration and full OAuth readiness have passed.
- Owned MCP and tunnel processes recover from a crash without changing the public hostname.
- Diagnostics redact credentials, authorization codes, access tokens, and refresh tokens.
- A real ChatGPT custom app can be registered once, survive desktop and connector restarts, refresh
  its access token, and continue using the same MCP endpoint.
- Quick Tunnel remains independently startable after any Stable-mode failure.
- The feature is promoted from experimental only after every release gate has evidence.

### Forbidden Behavior

- Do not create or delete Cloudflare DNS, tunnels, credentials, or config files without explicit
  confirmation.
- Do not automate ChatGPT app publication through undocumented browser actions.
- Do not mark Stable mode supported from mocked or synthetic tests alone.
- Do not expose the loopback MCP listener directly to the LAN.
- Do not delete Stable configuration or OAuth state during ordinary stop or Quick-Tunnel fallback.
- Do not log or export secret-bearing OAuth or Cloudflare values.

## Non-Goals

- Hosting the reader as a multi-tenant service.
- Keeping the endpoint available while the workstation is powered off.
- Adding Cloudflare Access in front of OAuth.
- Adding repository write tools.

## Acceptance Checks

- Managed provisioning requires an explicit confirmation payload and previews every external command.
  → verify: focused manager and route tests for preview, confirm, cancel, and partial-failure recovery
- Autostart and owned-process recovery preserve the stable endpoint and avoid duplicate processes.
  → verify: cold-start, connector-crash, MCP-crash, and duplicate-process integration tests
- Diagnostic exports contain blocker codes and no configured secrets or token-shaped values.
  → verify: deterministic redaction fixture tests
- A fresh-workstation Cloudflare setup validates DNS, TLS, named-tunnel identity, credentials, ingress,
  and public streaming behavior.
  → verify: recorded Cloudflare acceptance report with command versions and timestamps
- A real ChatGPT custom app completes authorization and lists/calls reader tools.
  → verify: manual ChatGPT acceptance report
- Restarting Elegy Copilot and `cloudflared` three times preserves the registered app and endpoint.
  → verify: manual restart matrix
- Access-token expiry triggers refresh-token rotation without app recreation.
  → verify: short-TTL ChatGPT acceptance run
- Quick Tunnel passes its regression suite after Stable-mode failure and rollback.
  → verify: `node --test copilot-ui/lib/localRepoMcpManager.test.js`
- Repository gates pass.
  → verify: `npm run ci:local`, `npm run ui:check`, and `npm --prefix local-repo-mcp test`

## Implementation Links

- `docs/specs/stable-oauth-mcp-tunnel-completion/plan.md`
- `docs/system/mcp-workflow.md`
- `copilot-ui/lib/localRepoMcpManager.js`
- `copilot-ui/lib/localRepoMcpCloudflare.js`
- `local-repo-mcp/src/localOAuth.ts`

## Validation Evidence

- Pending follow-up execution.

## Drift Notes

- The local workstation currently has `cloudflared 2026.6.1`, but no default
  `~/.cloudflared/config.yml`; real Cloudflare and ChatGPT acceptance requires user-supplied zone,
  hostname, and tunnel authorization.
