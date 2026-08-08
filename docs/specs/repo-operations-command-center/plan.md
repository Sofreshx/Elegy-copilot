# Repo Operations Command Center Plan

## Implementation Order

1. Extend Git inventory and the v4 evidence model.
2. Add fetch, analysis, typed cleanup, and repair-run service paths.
3. Wire routes, client contracts, and the command-center UI.
4. Update the canonical guide and validate service, route, UI, contract, and visual behavior.

## Risks

- Branch deletion is destructive: every action uses explicit confirmation and fresh exact-SHA checks.
- Existing v3 callers need worktree-cleanup compatibility.
- Existing unrelated UI/API snapshot edits must be preserved.

## Validation

- Run focused Node service and route tests, targeted Vitest UI tests, TypeScript/Vite build, CSS lint, API snapshots, and link checks.
- Use the desktop browser to verify the accepted command-center and cleanup concepts at desktop and narrow widths.
