---
created: 2026-02-23
updated: 2026-03-18
category: research
status: current
doc_kind: node
id: mobile-local-testing
summary: Historical audit plus current guidance after retirement of the legacy VS Code extension path.
tags: [mobile, testing, audit]
---

# Mobile Local Testing and Integration Audit

This document captures the prior mobile-integration audit and the current posture after retirement of
the legacy `RannIA` VS Code extension. Direct mobile-to-extension testing is no longer a supported
path in this repo.

## Current posture

- `copilot-ui` is the canonical local control plane.
- `local-tracker` and the messaging-gateway path are the remaining runtime integration surfaces for
  remote/session orchestration.
- Any older guidance that depended on direct `RannIA` WebSocket or `vscode://sofreshx.skill-installer`
  callbacks is historical only and should not be used for new work.

## Historical observations retained for context

- Mobile Companion connects to a WebSocket relay using `VITE_RELAY_URL` and sends messages with a wrapper `{ type: "request", payload: { jsonrpc, method, params } }` as seen in [mobile-companion/src/services/relayApi.ts](mobile-companion/src/services/relayApi.ts).
- Mobile OAuth redirects to GitHub, then exchanges the `code` via a relay endpoint `POST /auth/github/callback` as seen in [mobile-companion/src/services/authService.ts](mobile-companion/src/services/authService.ts).
- The retired VS Code extension formerly exposed a local WebSocket server and JWT-gated direct editor
  integration path.
- The (removed) Cloud Relay service previously exposed `/v1/ws` and health endpoints; the OAuth endpoints described in older relay docs were not implemented in code at the time of writing.

## Supported local testing direction

1. Use browser/UI validation for the current control-plane surfaces.
2. Use messaging-gateway or relay-backed integration paths for remote/mobile experiments.
3. Do not build new flows that depend on direct extension sockets or extension-owned auth state.

## GitHub Login Feasibility
- The mobile app redirects to GitHub and expects a backend to exchange the OAuth code due to CORS constraints. See [mobile-companion/src/services/authService.ts](mobile-companion/src/services/authService.ts).
- The retired extension-specific `vscode://` callback path is no longer part of the supported repo
  architecture.

To make GitHub login work locally for Mobile Companion, you will need:
1. A token exchange service (relay or dedicated backend) that implements `/auth/github/callback`.
2. A GitHub OAuth App with callback URLs for:
   - `http://localhost:5173/auth/callback` (mobile dev)
   - `https://<relay-host>/auth/callback` (hosted relay)

## Audit Findings
- Direct extension protocol/auth mismatches are now moot because that integration path has been
  retired from this repo.
- Relay API mismatch: relay docs list OAuth endpoints but relay code does not currently implement them.
- Env var drift: build pipeline uses `VITE_WS_URL`, while Mobile uses `VITE_RELAY_URL`.
- Storage mismatch: security doc describes encrypted IndexedDB, but Mobile auth currently uses `localStorage`.

## Recommended Local Testing Strategy (Near-Term)
- Use desktop browser testing with the Mobile dev server for UI flows.
- For connectivity, favor a relay or messaging-gateway adapter owned outside the retired extension.
- Use E2E browser smoke checks (CLI-first; agent-browser default) — see [docs/system/e2e-setup-guide.md](docs/system/e2e-setup-guide.md).

## Questions to Resolve Before Full Local E2E
- Should Mobile speak only to relay/gateway surfaces, or is another local proxy needed?
- Where should OAuth token exchange live for Mobile in development: relay or a small local proxy?
