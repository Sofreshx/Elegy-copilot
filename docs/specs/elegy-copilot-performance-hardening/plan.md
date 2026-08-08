# Elegy Copilot Performance Hardening Plan

## Implementation Order

1. Record deterministic performance budgets and replace blocking read probes with bounded asynchronous execution and local diagnostics.
2. Remove startup bundle leaks and add visible lazy-route fallbacks.
3. Introduce paginated Runtime inventory, progressive Git/checks loading, and stale-while-refresh Repo Operations.
4. Make heavy polling visibility-aware, reduce broad store subscriptions, update contracts and canonical documentation, and run integrated validation.

## Risks

- Cached repository data is presentation-only; every mutation must continue through the existing fresh-state guard.
- Process timeout and cancellation must terminate the full spawned process tree on supported desktop platforms.
- Existing dirty Overseer, CSS, spec-index, and UI-guide changes must be preserved and merged rather than overwritten.
- Progressive endpoints remain additive so existing desktop or automation callers retain compatibility.

## Validation

- Run focused service, route, contract, and Vitest tests before the production UI build.
- Inspect the emitted entry graph for Mermaid and verify loading, Runtime, Repo Operations, Workspace Git, and Checks through repository-owned UI checks.
- Run desktop checks, spec-index generation, documentation link validation, and `npm run ci:local` as the final integrated gate.
