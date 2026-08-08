---
created: 2026-03-11
updated: 2026-08-06
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

### Intelligence surfaces

The desktop shell exposes two source-owned local intelligence surfaces as dedicated
sidebar tabs:

| Tab | Source service | Console origin |
|-----|----------------|----------------|
| Overseer | Native Elegy shell backed by fixed loopback proxy routes | `../../overseer` at `http://127.0.0.1:4173` |
| World Model | Isolated embedded console | `../opportunity-world-model` at `http://127.0.0.1:7400` |

Both surfaces read a redacted readiness projection from `/api/intelligence-surfaces`
and require an explicit user action before invoking a fixed operator script. Elegy
resolves only the known sibling checkout, package marker, and fixed status/start/stop
script; it does not accept arbitrary commands or remote URLs. World Model embeds its
console in an isolated frame with `embed=elegy`. Overseer renders native views and uses
fixed `/api/overseer/**` loopback proxy routes; its session credential remains on the
backend and proxy responses are redacted before reaching the UI. Switching tabs does
not stop a service, and Stop is always explicit. See [Elegy local operations](elegy-local-operations.md)
for the lifecycle and failure boundary.

## Main UI

### Sidebar (left navigation)

| Item | View |
|------|------|
| Repositories | Browse and open registered repositories |
| Repo Operations | Global safe sync, structured branch issues, merged-worktree cleanup preview, and repository-scoped OpenCode preparation |
| Notes | Global notes, vault Git snapshots, import/export, and Google Drive sync |
| Remote | Kimaki onboarding, projects, Discord sessions, prompts, and logs |
| Workspace | Appears when a repository is opened; shows docs, git (stash management, force commit, worktree checks/merge), checks, health, planning, execution, and assets tabs |
| Settings (bottom) | App configuration (via settings gear icon) |

### Settings sub-sections

Settings is a rich view with these tabs:

| Section | Content |
|---------|---------|
| App Settings | Keyboard shortcuts, about/about info |
| OpenCode Setup | OpenCode configuration, CLI tooling, provider stats |
| Maintenance | Updates and diagnostics (LSP, stats) |
| Runtime | Dashboard health view (DashboardView) |
| Codex | Native Codex CLI health, subagents, usage, and plugin receipt |
| Claude Code Setup | Claude Code configuration panel |

The sidebar and settings structure are defined in `copilot-ui/ui/src/stores/navigation.ts` (SIDEBAR_NAV_ITEMS, SETTINGS_NAV_ITEMS) and rendered in `copilot-ui/ui/src/views/Settings/SettingsView.tsx`.

### Asset views

The former global `Assets & Tools` settings page is retired. Catalog APIs,
installation services, maintenance integrations, and the shared inventory
remain active, while users inspect managed and unmanaged assets from the
applicable harness `Assets` tab. Every harness row retains management metadata:
owner, source of truth, normalized scope, read-only state, and an explanation.
Paths are provenance only.

Codex, OpenCode, and Claude Code settings each have a dedicated `Assets` tab;
Antigravity remains central-only for now. Harness-owned native assets and
repository-owned assets are status-only and never expose install, sync, or
remove controls. Elegy-managed compatibility assets retain permitted install,
sync, and removal actions. External sources retain source activation actions.
`Needs attention` includes only actionable issues. A read-only harness view
refreshes status; a managed view offers `Sync Elegy assets` when supported.

## Current Responsibilities

- **Catalog control plane**: repo registration, asset install/search, external-source management, skill preview, and per-harness inventory projections. The global settings page is not a user-facing route.
- **Repo Operations**: global repository maintenance at `GET /api/repo-operations/overview` (`repo-operations.overview.v4`), confirmed fetch/sync/typed cleanup actions, deterministic entity analysis, and isolated merge-repair runs. The v4 boundary is detailed below; legacy v3 worktree-cleanup requests remain accepted during migration.
- **Workspace**: per-repo docs, git operations, planning graph, and execution surface.
- **Sessions**: session browse, detail view with activity stream, artifacts, task board, skill usage.
- **Settings**: app info, OpenCode/Codex/Claude Code configuration, and per-harness Assets tabs.
- **Remote**: Kimaki-backed Discord session management.
- **Maintenance**: desktop updates, Elegy plugin marketplace status, shared-skill fallback status, and LSP diagnostics.
- **Local API delivery**: all of the above served as HTTP routes for the desktop app.

Codex portability is receipt-driven: the installer copies the approved managed
bundle, agents, configuration, and license material, then records pinned
external Context7/Playwright sources in `.elegy-codex-portability.json`.
Unprovenanced local folders are reported as excluded; the Codex marketplace
receipt remains owned by the Maintenance marketplace service.

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

Repo Operations is a manually refreshed command center (`repo-operations.overview.v4`), not a polling or scheduled mutation surface. Repositories are ordered by derived recent activity: inventory activity, ref commit timestamps, PR updates, or managed-session activity. Clicking a repository opens its specialized workspace. The overview exposes local refs, remote refs, linked worktrees, observed SHAs, protection/active state, action capabilities, and bounded issue evidence; missing paths, unavailable remotes, unsupported providers, GitHub CLI/authentication failures, and command timeouts remain visible per repository/entity.

**Fetch all remotes** is an explicit, separately confirmed `fetch --prune` operation. It runs each configured remote independently with bounded concurrency and returns per-remote/per-repository results; it never changes a checkout. **Fast-forward eligible** is also explicitly confirmed and may be scoped to selected repositories. It re-checks fresh state and only advances a clean, inactive, non-diverged current branch with an available upstream. Dirty or diverged repositories may fetch refs, but are skipped for fast-forward; no lane pushes, rebases, normal-merges, checks out another branch, stashes, or hides partial failure.

Cleanup has separate safety lanes. **Clean safe** removes only freshly revalidated, inactive, unprotected, provably merged local refs or linked worktrees. **Analyze** is read-only deterministic evidence: ancestry, unique commits, tree/patch delta, PRs, active work, protection, provider capability, observed SHAs, and a durable analysis identifier. **Delete analyzed** requires explicit entity selection and a stronger confirmation; it accepts only high-confidence content-equivalent candidates after exact-SHA rechecks and no open PR/session/worktree. Local analyzed deletion uses compare-and-delete ref semantics; remote deletion first confirms the SHA with `ls-remote` and is GitHub-only in v1. Unsupported providers are analysis/manual-only. The primary worktree/default/current branches are never cleanup targets, and every partial result remains visible.

Agent runs support `pr-analysis`, `branch-analysis`, and `merge-repair`. A repair creates a managed worktree at the observed source SHA, merges the exact observed current-target SHA into that isolated worktree, resolves conflicts and runs checks there, then reports diff, commits, checks, and blockers. It never mutates the primary checkout or automatically pushes/merges. A fresh-SHA approval is required to push the repair; a later, separate approval is required for the final GitHub merge. Stale SHAs, unwriteable/fork PR heads, protection, failed checks, conflicts, cancellation, and unavailable providers stop safely. Terminal completion, cancellation, or failure removes the managed repair worktree and compare-deletes its temporary local ref while retaining durable run evidence.

The command center keeps entity tables horizontally scrollable, selection/batch actions sticky, detail/issue rails independently bounded and scrollable, and result/audit surfaces visible after batch completion. On narrow screens the detail rail becomes a bounded overlay/bottom sheet instead of expanding the viewport.

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
