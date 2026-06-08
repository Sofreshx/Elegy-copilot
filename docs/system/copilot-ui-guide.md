---
created: 2026-03-11
updated: 2026-06-07
category: system
status: current
doc_kind: node
id: copilot-ui-guide
summary: Short guide to the current copilot-ui runtime, navigation, and persistence boundaries.
tags: [copilot-ui, desktop, api, catalog]
related: [catalog-control-plane, session-state-artifacts, planning-backlog-roadmap-contract]
---

# copilot-ui Guide

## Purpose

`copilot-ui` is the local UI, HTTP API, and desktop shell for Instruction Engine. The packaged desktop app (Tauri shell + Node sidecar) is the normal runtime. The backend is Node.js-based; a parallel Rust runtime under `native/runtime` handles select routes (health, version, policy preflight) when the `INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL` env var is set.

## Start

```bash
npm --prefix copilot-ui run desktop:dev
npm --prefix copilot-ui run desktop:check
npm --prefix copilot-ui run desktop:smoke:native
node copilot-ui/server.js
```

- The local backend binds to `127.0.0.1`.
- Raw server mode is for `/api` work and debugging. The normal app UI is launched through the desktop shell.
- The Rust rewrite currently owns the bootstrap native routes in `native/runtime` and is expanding across active read surfaces before Node cutover.
- Set `INSTRUCTION_ENGINE_NATIVE_RUNTIME_URL=http://127.0.0.1:3220` (or pass `nativeRuntimeUrl` to `startServer()`) to hand off `/api/projects*`, `/api/dashboard/summary`, `/api/health`, `/api/version`, and `/api/policy/preflight` routes to the Rust runtime. When unset, these routes return 404 — the JS handlers have been deleted.

## Main UI

### Sidebar (left navigation)

| Item | View |
|------|------|
| Repositories | Browse and open registered repositories |
| Lexicon | Searchable vocabulary reference |
| Workspace | Appears when a repository is opened; shows docs, git (stash management, force commit, worktree checks/merge), planning, and execution tabs |
| Settings (bottom) | App configuration (via settings gear icon) |

### Settings sub-sections

Settings is a rich view with these tabs:

| Section | Content |
|---------|---------|
| App Settings | Keyboard shortcuts, about/about info |
| Assets & Tools | Catalog control plane (CatalogShellView) — repo registration, asset install, surface management |
| OpenCode Setup | OpenCode configuration, CLI tooling, provider stats |
| Maintenance | Updates, sandboxes, diagnostics (gateway, LSP, stats) |
| Runtime | Dashboard health view (DashboardView) |
| Codex Providers | Provider configuration panel |
| Claude Code Setup | Claude Code configuration panel |

The sidebar and settings structure are defined in `copilot-ui/ui/src/stores/navigation.ts` (SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEMS) and rendered in `copilot-ui/ui/src/views/Settings/SettingsView.tsx`.

## Current Responsibilities

- **Catalog control plane**: repo registration, asset install/search, external-source management, skill preview.
- **Workspace**: per-repo docs, git operations, planning graph, and execution surface.
- **Sessions**: session browse, detail view with activity stream, artifacts, task board, skill usage.
- **Lexicon**: searchable terminology reference for UI, design, and architecture terms.
- **Settings**: app info, catalog, OpenCode/Codex/Claude Code configuration.
- **Maintenance**: desktop updates, sandbox management, gateway/LSP diagnostics.
- **Local API delivery**: all of the above served as HTTP routes for the desktop app.

## Planning Boundary

- Planning surfaces are accessible via the Workspace's "Planning" local tab, which renders a `PlanningGraphView` graph.
- The `StandaloneGraphWindow` is available as a pop-out planning graph via URL parameter (`?roadmapId=...`).
- Planning persistence flows through `planningPersistence.js` backed by the `elegy-planning` database under `~/.copilot`.
- Old repo-file planning routes are retired from active use.

## State

- `~/.copilot/catalog/`
- `~/.copilot/repo-state/<repoId>/`
- `~/.copilot/session-state/<SESSION_ID>/`
- `~/.copilot/planning-db` in packaged mode

The public route inventory is snapshotted by `copilot-ui/tests/api-contract.test.js`.

## Enhanced Git Tab (2026-06-08)

The Workspace Git tab now includes:

- **Canonical commit-check contract**: Prefers repo-local `.copilot/commit-checks.json` lane-based CI checks over legacy known-script discovery. Runs `scripts/commit-check-run.mjs --json` when available.
- **Reliable Verify & Commit**: Awaits check completion directly; commits on pass, blocks on failure, shows neutral "No checks configured" when no checks exist.
- **Force commit**: After failed checks, a "Force Commit" button prompts for an override reason and sends `unsafeOverride: { reason }` to the gated backend.
- **Stash management**: Compact area under the commit composer shows stash count, "Stash changes" button, and expandable list with per-entry Apply/Pop/Drop actions.
- **Worktree state chips**: Worktree rows show computed state (Dirty, Checked, Mergeable, Conflict, Merged, etc.) instead of raw "discovered" status.
- **Worktree check & merge**: Per-worktree "Run checks" + "Merge" buttons enable check→dry-run→merge→remove flow directly from the worktrees table.
