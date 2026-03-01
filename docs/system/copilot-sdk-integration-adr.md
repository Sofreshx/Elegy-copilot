---
created: 2026-03-01
updated: 2026-03-01
category: system
status: current
doc_kind: node
id: copilot-sdk-integration-adr
summary: ADR for initial copilot-ui integration of @github/copilot-sdk using an ESM bridge and additive session artifacts.
tags: [adr, copilot-sdk, copilot-ui, architecture]
related: [copilot-sdk-spike, copilot-sdk-auth-strategy, copilot-sdk-artifact-layout]
---

# Copilot SDK Integration ADR

## Context

`copilot-ui/server.js` is CommonJS, while `@github/copilot-sdk` is consumed as ESM in Node usage. The approved plan for G-01 requires a minimal compatibility gate before deeper bridge and route implementation.

The following constraints shape the design:

- Depend on `@github/copilot-sdk` version `0.1.9` for deterministic behavior.
- Enforce runtime compatibility with Node `>=18`.
- Keep SDK imports out of browser bundles and isolate them to backend bridge modules.
- Preserve existing session artifact contracts under `~/.copilot/session-state/<SESSION_ID>/`.
- Avoid token persistence and keep auth handling explicit by runtime mode.

## Decision

Adopt a backend-only bridge layer at `copilot-ui/lib/copilot-bridge/` with an ESM package boundary and CJS dynamic import interop.

Implementation decisions:

- Add `"@github/copilot-sdk": "0.1.9"` to `copilot-ui/package.json` dependencies.
- Add `"engines": { "node": ">=18" }` to `copilot-ui/package.json`.
- Create `copilot-ui/lib/copilot-bridge/package.json` with `"type": "module"` and `"private": true`.
- Create `copilot-ui/lib/copilot-bridge/index.mjs` with a stub `createBridgeClient` that imports `CopilotClient` from `@github/copilot-sdk`.
- Validate CommonJS interop with `copilot-ui/lib/copilot-bridge/bridge.interop.test.cjs` using `await import("./index.mjs")`.
- Document auth policy in `docs/research/copilot-sdk-auth-strategy.md` using exact `CopilotClientOptions` fields.
- Define additive SDK artifact layout and `sdk-bridge.json` schema in `docs/research/copilot-sdk-artifact-layout.md`.

SDK type names referenced by this ADR:

- `CopilotClient`
- `CopilotClientOptions`

## Consequences

Positive outcomes:

- Confirms CJS `server.js` can load ESM bridge modules without a full server module migration.
- Keeps SDK usage isolated to backend code paths, reducing browser/runtime coupling.
- Creates explicit guardrails for auth and token handling.
- Keeps existing session-state artifacts compatible while enabling research and diagram metadata.

Tradeoffs and risks:

- Mixed CJS/ESM module boundaries add operational complexity.
- Version pinning to `0.1.9` requires intentional upgrades later.
- Artifact layout is documented before full runtime implementation, so schema drift must be monitored as bridge code lands.

Follow-up scope (outside G-01):

- Implement `SdkBridgeService` session lifecycle and SSE relay.
- Wire SDK routes and planning UI features.
- Add unit/integration coverage for bridge and API behavior.