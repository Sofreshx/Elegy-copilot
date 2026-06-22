---
spec_id: remote-session-management
title: Kimaki Remote Session Management
status: implemented
type: migration
updated: 2026-06-19
approved_at: 2026-06-18
implemented_at: 2026-06-19
---

# Kimaki Remote Session Management

## Intent

Replace the retired messaging gateway and sandbox control surfaces with a Kimaki-backed Remote tab for Discord-driven OpenCode sessions.

## Context Evidence

- `docs/system/architecture-overview.md`: current desktop, API, and external integration boundaries.
- `docs/system/desktop-runtime-tauri-migration-contract.md`: packaged Node runtime ownership and sidecar layout.
- `copilot-ui/src/desktopRuntime/runtimeService.ts`: desktop child-process lifecycle owner.
- `kimaki@0.17.1`: non-TTY startup emits SSE-framed `install_url`, `authorized`, `ready`, and `error` events.

## Requirements

### Allowed Behavior

- The desktop runtime starts one pinned Kimaki `0.17.1` child with data under `~/.elegy/kimaki`.
- The runtime exposes Kimaki state without exposing gateway credentials.
- The Node API exposes status, project listing/addition, session listing, prompt sending, and log-tail routes under `/api/remote/*`.
- Project and session reads use Kimaki's SQLite database in read-only mode.
- The Remote tab gates operational polling behind a guided Discord onboarding state, then shows projects, sessions, prompt submission, and collapsible logs.
- Kimaki subcommands receive the managed database through `KIMAKI_DB_URL`; `--data-dir` is reserved for the long-running bot command.
- Session listing includes ordinary OpenCode sessions in registered projects and marks them pending until Kimaki creates a Discord thread.
- The Node/Tauri runtime does not expose legacy `/api/gateway/*` or `/api/sandboxes*` control routes.
- Internal sandbox storage may remain where existing session aggregation depends on it.
- Packaged Tauri resources contain no messaging-gateway or workflow-sidecar entrypoints.

### Forbidden Behavior

- Do not write directly to Kimaki's private SQLite schema.
- Do not claim project removal support when the pinned Kimaki CLI does not expose it.
- Do not retain gateway, workflow-sidecar, or sandbox-control fallback responses.
- Do not store Kimaki runtime source only under ignored generated output.

## Non-Goals

- Replacing Kimaki's Discord onboarding flow.
- Removing internal sandbox-backed historical session reads.
- Supporting Kimaki versions other than `0.17.1` in this migration.

## Acceptance Checks

- The TypeScript runtime build emits the Kimaki runtime modules from tracked source.
  → verify: `npm --prefix copilot-ui run build:tauri-runtime-host`
- Kimaki SSE startup events produce deterministic runtime state transitions.
  → verify: `node --test copilot-ui/lib/desktop-shell/desktopRuntime/kimakiSseParser.test.js copilot-ui/lib/desktop-shell/desktopRuntime/kimakiRuntimeService.test.js`
- The Node route registry contains `/api/remote/*` and no gateway or sandbox-control routes.
  → verify: `node --test copilot-ui/routes/kimaki.test.js`
- The Node runtime exposes matching `/api/remote/*` routes.
  → verify: `node --test copilot-ui/routes/kimaki.test.js`
- The Remote UI builds and its empty/ready states render through existing UI primitives.
  → verify: `npm --prefix copilot-ui run test:vitest -- tests/remote-view.vitest.tsx`
- Node subcommand tests reject the unsupported `--data-dir` argument and verify the managed database environment.
  → verify: `npm --prefix copilot-ui run test:tauri-runtime-host`
- Session polling reads OpenCode and Kimaki SQLite state directly and never invokes `kimaki session list`.
  → verify: `node --test copilot-ui/lib/remote/sqliteReader.test.js copilot-ui/routes/kimaki.test.js`
- The Node runtime returns 404 for retired gateway and sandbox-control paths.
  → verify: `rg -n "messagingGateway|workflowSidecar|/api/gateway|/api/sandboxes" copilot-ui contracts local-tracker docs/system`
- Tauri packaging metadata contains no gateway or workflow-sidecar entrypoints.
  → verify: `npm --prefix copilot-ui run validate:tauri-node-sidecar-layout`
- Legacy messaging-gateway source, contracts, routes, and operator docs are absent.
  → verify: `rg -n "messagingGateway|workflowSidecar|/api/gateway|/api/sandboxes" copilot-ui contracts local-tracker docs/system`
- The focused migration checks pass before broader CI.
  → verify: `npm run test:all`

## Implementation Links

- `docs/specs/remote-session-management/plan.md`
- `copilot-ui/src/desktopRuntime/kimakiRuntimeService.ts`
- `copilot-ui/routes/kimaki.js`
- `copilot-ui/ui/src/tabs/Remote/RemoteView.tsx`
- `copilot-ui/routes/kimaki.js`

## Validation Evidence

- `npm --prefix copilot-ui run test:tauri-runtime-host`: 7 passed.
- Focused Node routes/storage/workflow tests: 7 passed.
- `npm --prefix copilot-ui run test:vitest -- tests/remote-view.vitest.tsx`: passed.
- `npm --prefix copilot-ui run ui:build`: passed.
- `node scripts/validate-specs.js docs/specs/remote-session-management`: passed.
- `npm run build:contracts`: passed.
- Native retired-route test: 1 passed.
- `npm run test:all`: executed; migration tests passed. The repository-wide command remains red on
  unrelated baseline failures, including stale UI/API contract assertions, absent local-tracker
  tests, missing `.cli` generated assets, and local `better-sqlite3` bindings.
- `npm --prefix copilot-ui run validate:tauri-node-sidecar-layout`: blocked because this worktree
  lacks the ignored `.cli/policy` packaging input.

## Drift Notes

- Kimaki `0.17.1` has project add/list commands but no project remove command. The UI intentionally omits removal instead of mutating Kimaki's database directly.
