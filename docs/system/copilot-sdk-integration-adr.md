---
created: 2026-03-01
updated: 2026-06-01
category: system
status: archived
doc_kind: node
id: copilot-sdk-integration-adr
summary: Retired. ADR for initial copilot-ui integration of @github/copilot-sdk using an ESM bridge and additive session artifacts.
tags: [adr, copilot-sdk, copilot-ui, architecture, retired]
related: [copilot-sdk-spike, copilot-sdk-auth-strategy, copilot-sdk-artifact-layout, adr-governance]
---

# Copilot SDK Integration ADR (retired)

The SDK bridge and managed-CLI lane have been retired as of 2026-06-01 as part of the
elegy-copilot harness meta-cleanup. elegy-copilot is now a meta-harness that installs skills
and assets across many harnesses; it does not operate a Copilot SDK bridge or manage the
Copilot CLI lifecycle.

The `@github/copilot-sdk` dependency and the `copilot-bridge/` ESM bridge have been removed.

## Context

`copilot-ui/server.js` is CommonJS, while `@github/copilot-sdk` is consumed as ESM in Node usage. The approved plan for G-01 requires a minimal compatibility gate before deeper bridge and route implementation.

The following constraints shape the design:

- Depend on an explicitly pinned `@github/copilot-sdk` release per app version; stable app releases
  track a stable SDK release and prerelease app releases track a prerelease SDK release.
- Enforce runtime compatibility with Node `>=18`.
- Keep SDK imports out of browser bundles and isolate them to backend bridge modules.
- Preserve existing session artifact contracts under `~/.copilot/session-state/<SESSION_ID>/` while
  keeping runtime as the live session authority and artifacts as projections/fallbacks.
- Avoid token persistence and keep auth handling explicit by runtime mode.
- Keep orchestration local-only inside the packaged app/local backend; no hosted workflow control plane
  is introduced by this ADR.
- Treat app-managed Copilot CLI ensure/install/update behavior as part of the intended desktop delivery
  contract for the matching app channel.
- In the first channel-aware desktop slice, fail closed unless the packaged app can resolve an approved
  managed CLI payload for the matched lane; desktop runtime must not silently fall back to PATH or
  `cliUrl` overrides.
- If an explicit desktop channel override is invalid, or if CLI bootstrap/import fails, the runtime must
  block only the SDK/CLI lane with an operator-visible reason instead of silently inferring another lane
  or terminating the entire desktop shell.

## Decision

Adopt a backend-only bridge layer at `copilot-ui/lib/copilot-bridge/` with an ESM package boundary and CJS dynamic import interop.

Implementation decisions:

- Keep `@github/copilot-sdk` explicitly pinned in `copilot-ui/package.json` for each app release
  (the initial bridge implementation used `0.1.9`).
- Add `"engines": { "node": ">=18" }` to `copilot-ui/package.json`.
- Create `copilot-ui/lib/copilot-bridge/package.json` with `"type": "module"` and `"private": true`.
- Create `copilot-ui/lib/copilot-bridge/index.mjs` with a stub `createBridgeClient` that imports `CopilotClient` from `@github/copilot-sdk`.
- Validate CommonJS interop with `copilot-ui/lib/copilot-bridge/bridge.interop.test.cjs` using `await import("./index.mjs")`.
- Document auth policy in `docs/research/copilot-sdk-auth-strategy.md` using exact `CopilotClientOptions` fields.
- Define additive SDK artifact layout and `sdk-bridge.json` schema in `docs/research/copilot-sdk-artifact-layout.md`.
- Keep any auto-triggered workflow runner local to the desktop/backend environment; packaged n8n is the
  favored MVP direction, but remains validation-dependent and additive to the SDK bridge rather than a
  replacement for it.

SDK type names referenced by this ADR:

- `CopilotClient`
- `CopilotClientOptions`

## Consequences

Positive outcomes:

- Confirms CJS `server.js` can load ESM bridge modules without a full server module migration.
- Keeps SDK usage isolated to backend code paths, reducing browser/runtime coupling.
- Creates explicit guardrails for auth and token handling.
- Keeps existing session-state artifacts compatible while enabling research and diagram metadata.
- Locks the intended release-channel pairing so packaged stable apps do not silently mix with prerelease
  SDK/CLI lanes, and vice versa.
- Makes missing or unapproved desktop CLI state operator-visible through health/status surfaces instead of
  assuming a global `copilot` install is acceptable.
- Keeps local workflow automation compatible with the local-only orchestration boundary.

Tradeoffs and risks:

- Mixed CJS/ESM module boundaries add operational complexity.
- Exact SDK and CLI version pinning still requires intentional per-channel upgrades later.
- Artifact layout is documented before full runtime implementation, so schema drift must be monitored as bridge code lands.
- The favored packaged n8n direction still depends on validation of packaging, acquisition, and cleanup
  behavior before it can be treated as fully locked implementation shape.

Follow-up scope (outside G-01):

- Implement `SdkBridgeService` session lifecycle and SSE relay.
- Wire SDK routes and planning UI features.
- Add unit/integration coverage for bridge and API behavior.
