---
created: 2026-03-11
updated: 2026-07-09
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

`copilot-ui` is the local UI, HTTP API, and desktop shell for Elegy Copilot. The packaged desktop app (Tauri shell + Node sidecar) is the normal runtime. The backend is Node.js-based.

## Start

```bash
npm --prefix copilot-ui run desktop:dev
npm --prefix copilot-ui run desktop:check
npm --prefix copilot-ui run desktop:smoke:native
node copilot-ui/server.js
```

- The local backend binds to `127.0.0.1`.
- Raw server mode is for `/api` work and debugging. The normal app UI is launched through the desktop shell.

## Main UI

### Sidebar (left navigation)

| Item | View |
|------|------|
| Repositories | Browse and open registered repositories |
| Notes | Global notes, vault Git snapshots, import/export, and Google Drive sync |
| Remote | Kimaki onboarding, projects, Discord sessions, prompts, and logs |
| Workspace | Appears when a repository is opened; shows docs, git (stash management, force commit, worktree checks/merge), checks, health, planning, execution, and assets tabs |
| Settings (bottom) | App configuration (via settings gear icon) |

### Settings sub-sections

Settings is a rich view with these tabs:

| Section | Content |
|---------|---------|
| App Settings | Keyboard shortcuts, about/about info |
| Assets & Tools | Catalog control plane (CatalogShellView) — repo registration, asset install, surface management |
| OpenCode Setup | OpenCode configuration, CLI tooling, provider stats |
| Maintenance | Updates and diagnostics (LSP, stats) |
| Runtime | Dashboard health view (DashboardView) |
| Codex Providers | Provider configuration panel |
| Claude Code Setup | Claude Code configuration panel |

The sidebar and settings structure are defined in `copilot-ui/ui/src/stores/navigation.ts` (SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEMS) and rendered in `copilot-ui/ui/src/views/Settings/SettingsView.tsx`.

## Current Responsibilities

- **Catalog control plane**: repo registration, asset install/search, external-source management, skill preview.
- **Workspace**: per-repo docs, git operations, planning graph, and execution surface.
- **Sessions**: session browse, detail view with activity stream, artifacts, task board, skill usage.
- **Settings**: app info, catalog, OpenCode/Codex/Claude Code configuration.
- **Remote**: Kimaki-backed Discord session management.
- **Maintenance**: desktop updates, Elegy plugin marketplace status, shared-skill fallback status, and LSP diagnostics.
- **Local API delivery**: all of the above served as HTTP routes for the desktop app.

## Planning Boundary

- Planning surfaces are accessible via the Workspace's "Planning" local tab, which renders a `PlanningGraphView` graph.
- The `StandaloneGraphWindow` is available as a pop-out planning graph via URL parameter (`?roadmapId=...`).
- Planning persistence flows through `planningPersistence.js` backed by the `elegy-planning` database under `~/.elegy`.
- Old repo-file planning routes are retired from active use.

## State

- `~/.elegy/catalog/`
- `~/.elegy/repo-state/<repoId>/`
- `~/.elegy/session-state/<SESSION_ID>/`
- `~/.elegy/planning-db` in packaged mode

The public route inventory is snapshotted by `copilot-ui/tests/api-contract.test.js`.

## Tooling Updates API

Maintenance tooling update routes expose Elegy Codex plugin state as
`elegyPlugins` on `GET /api/tooling-updates/status` and
`POST /api/tooling-updates/check`.

`POST /api/tooling-updates/update/elegy-plugins` installs through the generated
Elegy Codex marketplace under `<CODEX_HOME>/marketplaces/elegy`. The route
delegates to the generic Elegy plugin marketplace service, which runs Codex
marketplace registration before plugin installation.

Codex shared skills remain compatibility fallback assets. They are not the
primary Codex install lane for `elegy-planning` or other Elegy plugins.

When tooling update routes or top-level response fields change, update
`copilot-ui/tests/api-contract.snapshot.json` through
`UPDATE_API_SNAPSHOT=1 node copilot-ui/tests/api-contract.test.js` and keep the
diff scoped to the intended route contracts.

## Enhanced Git Tab (2026-06-08)

The Workspace Git tab now includes:

- **Canonical commit-check contract**: Prefers repo-local `.copilot/commit-checks.json` lane-based CI checks over legacy known-script discovery. Runs `scripts/commit-check-run.mjs --json` when available.
- **Reliable Verify & Commit**: Awaits check completion directly; commits on pass, blocks on failure, shows neutral "No checks configured" when no checks exist.
- **Force commit**: After failed checks, a "Force Commit" button prompts for an override reason and sends `unsafeOverride: { reason }` to the gated backend.
- **Stash management**: Compact area under the commit composer shows stash count, "Stash changes" button, and expandable list with per-entry Apply/Pop/Drop actions.
- **Worktree state chips**: Worktree rows show computed state (Dirty, Checked, Mergeable, Conflict, Merged, etc.) instead of raw "discovered" status.
- **Worktree check & merge**: Per-worktree "Run checks" + "Merge" buttons enable check→dry-run→merge→remove flow directly from the worktrees table.
