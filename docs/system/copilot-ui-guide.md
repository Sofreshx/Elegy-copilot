---
created: 2026-03-11
updated: 2026-08-03
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
| Repo Operations | Global safe sync and repository-scoped OpenCode preparation: local sync blockers, branch hygiene, and open GitHub pull requests |
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
| Codex | Native Codex CLI health, subagents, usage, and plugin receipt |
| Claude Code Setup | Claude Code configuration panel |

The sidebar and settings structure are defined in `copilot-ui/ui/src/stores/navigation.ts` (SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEMS) and rendered in `copilot-ui/ui/src/views/Settings/SettingsView.tsx`.

### Asset views

`Assets & Tools` is the cross-harness inventory and repair overview. Its
merged rows retain per-harness management metadata: owner (`Elegy-managed`,
`Harness-owned`, `Repository-owned`, or `External`), source of truth, normalized
scope (`global`, `repo`, `user`, or `external`), read-only state, and an
optional explanation. Paths are provenance only. Owner and scope are shown as
text and badges in addition to color.

Codex, OpenCode, and Claude Code settings each have a dedicated `Assets` tab;
Antigravity remains central-only for now. Harness-owned native assets and
repository-owned assets are status-only and never expose install, sync, or
remove controls. Elegy-managed compatibility assets retain permitted install,
sync, and removal actions. External sources retain source activation actions.
`Needs attention` includes only actionable issues. A read-only harness view
refreshes status; a managed view offers `Sync Elegy assets` when supported.

## Current Responsibilities

- **Catalog control plane**: repo registration, asset install/search, external-source management, skill preview.
- **Repo Operations**: global repository maintenance at `GET /api/repo-operations/overview`, with confirmed safe sync at `POST /api/repo-operations/sync` and repository-scoped OpenCode preparation/approval routes. It scans catalog-inventory repositories with bounded Git/GitHub checks, preserves per-repository failures, and is separate from the external Tracker integration and legacy note-only agent route.
- **Workspace**: per-repo docs, git operations, planning graph, and execution surface.
- **Sessions**: session browse, detail view with activity stream, artifacts, task board, skill usage.
- **Settings**: app info, catalog, OpenCode/Codex/Claude Code configuration.
- **Remote**: Kimaki-backed Discord session management.
- **Maintenance**: desktop updates, Elegy plugin marketplace status, shared-skill fallback status, and LSP diagnostics.
- **Local API delivery**: all of the above served as HTTP routes for the desktop app.

## Workspace Execute Tab

The Workspace "Execute" local tab (`WorkspaceExecutionTab.tsx`) is the command runner surface for the opened repository:

- **Discovered commands**: deterministic discovery from `package.json` scripts, README shell instructions (`README.md`, `README`, `CONTRIBUTING.md`, `GETTING_STARTED.md`), and `Makefile` targets, grouped into fixed categories (Setup, Start/Dev, Test, Lint/Check, Build, Docs, Other). Within each group, server-starting (long-running) commands rank first, then commands whose name or args hint at a UI surface, then stable name — so the command that starts the app UI sits near the top. Long-running rows carry a **Server** badge. Shell-metacharacter commands are rejected, not executed. Press **Refresh** to re-scan.
- **Setup card**: one-click run of the highest-priority install/build command with a persisted status (`not-started` / `running` / `done` / `failed`) and exit code.
- **Run / Stop**: one active run per repository; output tail is captured (50k chars cap) and expandable per command row; `http(s)` addresses in the output (e.g. `http://localhost:5173`) render as clickable links; last exit status per command persists across sessions.
- **Persistence**: discovery cache and run outcomes live under `~/.elegy/repo-state/<repoId>/execution/` (`discovery.json`, `runs.json`), keyed by the repository state id.
- **Workers section**: a collapsible panel below the commands list hosts the orchestrator session controls (pilot-gated by `ELEGY_ORCHESTRATOR_EXPERIMENTAL`). Backend: `copilot-ui/routes/execution.js` + `copilot-ui/lib/commandDiscovery.js` / `executionRunner.js`.

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

### Repo Operations boundary

Repo Operations refreshes when its global sidebar tab opens and when the user
selects **Refresh all**; it does not poll in the background. The overview scan
reads local Git refs/worktrees and open GitHub PR metadata. Missing paths,
unavailable remotes, unsupported providers, GitHub CLI/authentication failures,
and command timeouts remain visible as repository-level issues.

**Sync eligible repositories** requires explicit confirmation and immediately
re-checks every repository. It fetches the configured remote with pruning
disabled and applies fast-forward-only updates to the current branch. It
requires a clean tree, an available upstream, no ahead/diverged commits, and no
active managed session/worktree conflict. It never pushes, performs a normal
merge, rebases, checks out another branch, stashes, prunes, deletes, or hides a
partial result; a stale remote/state check fails that repository without retry.

OpenCode preparation is per repository and per existing GitHub PR. The
dedicated `repo-operations` agent uses `opencode-go/deepseek-v4-flash` for
read/check/dry-run analysis only. It reports evidence and a proposed squash
merge through `repo-operations.action.v2`, then waits for explicit approval and
a fresh head/base SHA check. Only non-draft, cleanly mergeable PRs targeting the
default branch with approved review and no failed or pending checks can reach
the approval control. The approval service owns the final GitHub CLI squash
merge and never deletes branches or enables auto-merge. Dirty trees, conflicts,
active sessions/worktrees, stale SHAs, protected policy, failed checks, missing
authentication, and local-only branches require a manually launched and
followed session. Branch cleanup remains disabled.

## Tooling Updates API

Maintenance tooling update routes expose Elegy Codex plugin state as
`elegyPlugins` on `GET /api/tooling-updates/status` and
`POST /api/tooling-updates/check`.

`POST /api/tooling-updates/update/elegy-plugins` installs through the generated
Elegy Codex marketplace under `<CODEX_HOME>/marketplaces/elegy`. The route
delegates to the generic Elegy plugin marketplace service, which runs Codex
marketplace registration before plugin installation.

Codex's eight shared skills remain compatibility fallback assets. They are not
the primary install lane for the four current Elegy Codex plugins:
`elegy-documentation`, `elegy-mcp`, `elegy-checks`, and `elegy-planning`.
`elegy-planning` is the direct Codex subagent/workflow plugin. Plugin
installation and updates remain in Maintenance; the Codex Assets tab shows
their read-only receipt only.

When tooling update routes or top-level response fields change, update
`copilot-ui/tests/api-contract.snapshot.json` through
`UPDATE_API_SNAPSHOT=1 node copilot-ui/tests/api-contract.test.js` and keep the
diff scoped to the intended route contracts.

## Enhanced Git Tab (2026-06-08)

The Workspace Git tab now includes:

- **Repository quality readiness**: The Checks tab reads one repo-scoped status that combines the active hook manager, `.elegy/checks.json` proof, configuration drift, and GitHub Actions state. It leads with one readiness state and one next action; manual profiles, lanes, logs, and history remain secondary diagnostics.
- **Setup task handoff**: Setup and migration actions launch a Codex task rooted at the selected repository with the `repo-quality-setup` skill. When the task launcher is unavailable, the UI exposes the exact scoped prompt instead of mutating the app process directory.
- **Reliable Verify & Commit**: Awaits check completion directly; commits on pass, blocks on failure, shows neutral "No checks configured" when no checks exist.
- **Force commit**: After failed checks, a "Force Commit" button prompts for an override reason and sends `unsafeOverride: { reason }` to the gated backend.
- **Stash management**: Compact area under the commit composer shows stash count, "Stash changes" button, and expandable list with per-entry Apply/Pop/Drop actions.
- **Worktree state chips**: Worktree rows show computed state (Dirty, Checked, Mergeable, Conflict, Merged, etc.) instead of raw "discovered" status.
- **Worktree check & merge**: Per-worktree "Run checks" + "Merge" buttons enable check→dry-run→merge→remove flow directly from the worktrees table.
