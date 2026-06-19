# Kimaki Remote Session Management Plan

## Scope

Implement `docs/specs/remote-session-management/spec.md`.

## Order

1. Add tracked Kimaki runtime source and focused tests.
2. Wire Node server dependencies and `/api/remote/*` routes.
3. Remove Node/Tauri gateway, workflow-sidecar, and sandbox-control surfaces.
4. Remove Rust gateway and sandbox-control routes and fallback shapes.
5. Align the Remote UI with existing primitives and supported Kimaki commands.
6. Remove stale contracts, docs, scripts, and packaging references.
7. Run focused checks, inspect the diff, then run broader validation.

## Risks

| Risk | Control |
|---|---|
| Kimaki CLI drift | Pin `0.17.1`; test argument construction and SSE events. |
| Private database coupling | Read-only SQLite access; no direct writes. |
| Sandbox over-deletion | Remove operator routes only; retain session-storage dependencies. |
| Packaged runtime drift | Validate the Tauri sidecar manifest and generated runtime host. |
| Rust fallback masks retired routes | Add explicit 404 tests for retired paths. |

## Validation

- Spec validator
- TypeScript runtime build and focused Node tests
- Remote UI test and Vite build
- Rust runtime focused tests
- Tauri sidecar layout validator
- `npm run test:all`
