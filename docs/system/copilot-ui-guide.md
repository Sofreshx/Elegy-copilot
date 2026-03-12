---
created: 2026-03-11
updated: 2026-03-12
category: system
status: current
doc_kind: node
id: copilot-ui-guide
summary: Canonical guide to the current copilot-ui runtime surface, tabs, route groups, persistence model, and validation anchors.
tags: [copilot-ui, dashboard, desktop, api, planning]
related: [catalog-control-plane, session-state-artifacts, desktop-update-rollback-runbook, system-docs-index]
---

# copilot-ui Guide

## Purpose

`copilot-ui` is the current local UI and control plane for Instruction Engine. It provides the
React-based dashboard surface, the local HTTP API used by that UI, and the packaged Electron shell
used for desktop distribution.

It replaces the legacy vanilla dashboard. When the React bundle is unavailable, the fallback page
from `copilot-ui/public/index.html` explains that the active UI is served from `copilot-ui/ui-dist`.

## Runtime modes

`copilot-ui` currently runs in two supported modes:

1. **Local server mode**
   - Start with `node copilot-ui/server.js` or the helper scripts in `scripts/cli-ui.*`.
   - Serves the HTTP API plus the built React UI on `127.0.0.1:3210`.
2. **Desktop shell mode**
   - Packages the same UI and backend behavior inside the Electron runtime.
   - Desktop update and rollback behavior are governed by [[desktop-update-rollback-runbook]] [docs/system/desktop-update-rollback-runbook.md](docs/system/desktop-update-rollback-runbook.md).

## What it owns

`copilot-ui` is the canonical management surface for:

- catalog projection refresh, search, repo selection, audit, and mutation flows
- session browsing and session-artifact inspection
- planning record comparison and persisted planning APIs
- tracker and gateway status/proxy surfaces
- packaged desktop lifecycle, updater wiring, and local runtime health reporting

Catalog semantics and authoritative write paths are defined in [[catalog-control-plane]] [docs/system/catalog-control-plane.md](docs/system/catalog-control-plane.md).

## Backend route groups

The route registry in `copilot-ui/routes/index.js` mounts these current route modules:

- `lifecycle`
- `assets`
- `catalog`
- `planning`
- `planning-artifacts`
- `sessions`
- `gateway`
- `tracker`
- `sdk`

Treat those groups as the primary backend surface. The most important user-visible route families are:

- `/api/health` and lifecycle/runtime health endpoints
- catalog summary, repo, refresh, search, audit, and asset-management endpoints
- planning record, compare, merge, suggestion, and persistence-health endpoints
- session artifact endpoints for structured state, proposition, and verification guides
- gateway and tracker proxy/status endpoints
- SDK-facing routes used by smoke and sandbox validation

`copilot-ui/tests/smoke.test.js` and `copilot-ui/tests/api-contract.test.js` are the best broad regression anchors for confirming that the public route surface still exists and responds with the expected contract shape. Route-specific additive behavior is covered by `copilot-ui/routes/catalog.test.js`, `copilot-ui/routes/planning-artifacts.test.js`, and related UI tests.

## API surface

### Lifecycle and local setup

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/policy/preflight` | Returns local policy preflight status before higher-level actions run. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/health` | Base server health contract. | `copilot-ui/tests/smoke.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/version` | Returns runtime/version metadata for the current backend. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/vscode/patch-settings` | Applies the recommended VS Code settings patch for Instruction Engine paths and approvals. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/copilot/authorize` | Handles local authorization flow for Copilot-related permissions. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/lsp/config` | Returns local language-server configuration state. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/lsp/install` | Installs or refreshes the language-server tooling expected by the UI/runtime. | `copilot-ui/tests/api-contract.test.js` |

### Assets and catalog-backed previews

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/assets/managed` | Lists managed assets known to the local installation. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/assets/installed` | Lists currently installed assets. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/assets/sync-all` | Runs bulk sync for installed/managed assets. | `copilot-ui/tests/assets-sync-missing-source.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/assets/sync` | Syncs a targeted asset selection. | `copilot-ui/tests/assets-one-click-repair.vitest.ts`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/skills/preview` | Serves skill-preview data for the Skills Preview UI surface. | `copilot-ui/tests/skills-preview-catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/assets/remove` | Removes installed assets from the local installation surface. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/assets/view` | Returns asset content or metadata for inspection in the UI. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/assets/delete` | Deletes managed assets from the selected authoring scope. | `copilot-ui/tests/api-contract.test.js` |

### External plugin asset compatibility

`copilot-ui` now supports read-only discovery of externally installed Copilot assets that do not
follow Instruction Engine's flat managed layout.

Supported compatibility patterns currently include:

- namespaced skills under `~/.copilot/skills/<namespace>/<skill>/SKILL.md`
- plain Markdown agents under `~/.copilot/agents/*.md` when they parse like real agent assets
  (frontmatter with a stable `name` plus a non-empty markdown body)
- plugin installs exposed through linked or symlinked marketplace-cache paths, including upstream
  `superpowers-copilot` layouts such as:
  - `~/.copilot/skills/superpowers/<skill>/SKILL.md`
  - `~/.copilot/agents/code-reviewer.md`

Behavior guarantees for those compatibility-discovered assets:

- they appear in Catalog, Installed Inventory, Skills Preview, and catalog-backed search
- nested assets keep explicit `viewPath` metadata so inspection opens the real nested file instead
  of reconstructing a flat path
- same-name assets stay distinct through provider-qualified identity instead of collapsing into
  shipped Instruction Engine assets
- provenance metadata may include provider, source package, and namespace information
- external/plugin-origin assets are inspectable but remain read-only in Instruction Engine edit and
  delete flows

### Catalog control plane

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/catalog/repos` | Lists repo inventory, selection state, and repo-local asset hints. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/repos/register` | Adds a repo to the local catalog inventory. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/repos/unregister` | Removes a repo from the local catalog inventory. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/repos/select` | Marks a repo as the active catalog context. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/repos/refresh` | Rebuilds the selected repo projection. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/catalog/summary` | Returns summary counts, snapshot metadata, and catalog stats. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/catalog/assets` | Lists effective catalog assets for the selected context. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/catalog/assets/:assetId` | Returns one effective asset by ID. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/catalog/bundles` | Returns bundle metadata, computed member state, and bundle summary stats. | `copilot-ui/routes/catalog.test.js` |
| `GET` | `/api/catalog/entries` | Returns raw catalog entries before effective selection is applied. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/refresh` | Rebuilds and persists the catalog projection snapshot. | `copilot-ui/routes/catalog.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/create` | Creates a catalog asset in the selected authoring scope. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/update` | Updates a catalog asset in the selected authoring scope. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/delete` | Deletes a catalog asset in the selected authoring scope. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/install` | Installs a shipped/shared asset into the user surface. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/enable` | Writes overlay enablement for a repo-scoped asset. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/catalog/assets/disable` | Writes overlay disablement for a repo-scoped asset. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/search/query` | Performs deterministic catalog-backed search. | `copilot-ui/tests/skill-search-service.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/search/selection` | Records bounded search-selection telemetry. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/audit/assets` | Returns asset audit analytics. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/audit/events` | Returns catalog audit event history. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/runtime/catalog-health` | Returns projection and audit-file runtime health. | `copilot-ui/tests/assets-sync-missing-source.test.js`, `copilot-ui/tests/api-contract.test.js` |

### Planning persistence and record operations

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `POST` | `/api/planning/persistence/init` | Initializes the planning persistence authority. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningPersistence.test.js` |
| `POST` | `/api/planning/persistence/corruption/scan` | Scans persisted planning state for corruption markers. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningPersistence.test.js` |
| `POST` | `/api/planning/persistence/retention` | Runs retention in dry-run or execute mode. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningPersistence.test.js` |
| `POST` | `/api/planning/persistence/export` | Exports a deterministic planning persistence snapshot. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningPersistence.test.js` |
| `POST` | `/api/planning/persistence/import` | Imports a deterministic planning persistence snapshot. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningPersistence.test.js` |
| `POST` | `/api/planning/records` | Creates a planning record. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `GET` | `/api/planning/records` | Lists planning records from the persisted store. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `GET` | `/api/planning/search` | Searches planning records. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `POST` | `/api/planning/compare` | Compares planning records and produces deterministic comparison results. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `POST` | `/api/planning/merge-intent` | Persists merge-intent state for later merge execution. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `POST` | `/api/planning/merge` | Executes an approved merge flow. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `POST` | `/api/planning/suggestions` | Creates planning suggestions. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `GET` | `/api/planning/suggestions` | Lists planning suggestions. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `POST` | `/api/planning/recaps` | Creates planning recaps. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |
| `GET` | `/api/planning/recaps` | Lists planning recaps. | `copilot-ui/tests/api-contract.test.js`, `copilot-ui/lib/planningApiContracts.test.js` |

### Planning artifacts on records

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/planning/records/:recordId/research` | Lists deterministic research notes attached to a planning record. | `copilot-ui/routes/planning-artifacts.test.js`, `copilot-ui/tests/research-panel.vitest.tsx` |
| `POST` | `/api/planning/records/:recordId/research` | Creates or updates a research note on a planning record. | `copilot-ui/routes/planning-artifacts.test.js` |
| `DELETE` | `/api/planning/records/:recordId/research/:noteId` | Deletes a research note from a planning record. | `copilot-ui/routes/planning-artifacts.test.js` |
| `GET` | `/api/planning/records/:recordId/diagrams` | Lists diagrams attached to a planning record. | `copilot-ui/routes/planning-artifacts.test.js` |

### Sessions and persisted session artifacts

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/sessions` | Lists CLI, VS Code, or sandbox sessions. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/events` | Returns recent event-log entries for a session. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/agent-usage` | Returns agent-usage summaries for a session. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/plan` | Returns the current `plan.md` text for a session. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/plans` | Lists persisted plan revisions for a session. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/plans/:planId` | Returns one persisted plan artifact revision. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/final` | Returns the final execution summary artifact when present. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/structured-state` | Parses the progress tracker into structured JSON. | `copilot-ui/VALIDATION.md`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/proposition` | Returns `proposition.md` when present. | `copilot-ui/VALIDATION.md`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/sessions/:id/verification-guide` | Returns `verification-guide.md` when present. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/sessions/:id/archive` | Moves a session into `sessions-archive`. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/sessions/:id/delete` | Deletes a session after force confirmation. | `copilot-ui/tests/api-contract.test.js` |

### Gateway and tracker integration

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/gateway/state` | Returns current gateway state. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/gateway/connect` | Initiates or negotiates a gateway connection. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/gateway/config` | Returns gateway configuration. | `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/gateway/config` | Updates gateway configuration. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/gateway/scan-repos` | Scans local repos for gateway-relevant configuration. | `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/tracker/status` | Proxies tracker status. | `copilot-ui/routes/tracker.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/tracker/sessions` | Proxies tracker session state. | `copilot-ui/routes/tracker.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/tracker/permissions` | Proxies pending tracker permission actions. | `copilot-ui/routes/tracker.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `GET` | `/api/tracker/events` | Proxies tracker event history. | `copilot-ui/routes/tracker.test.js`, `copilot-ui/tests/api-contract.test.js` |
| `POST` | `/api/tracker/permissions/:id/(approve|deny)` | Applies a tracker permission decision. | `copilot-ui/routes/tracker.test.js` |
| `POST` | `/api/tracker/lifecycle/:action` | Sends a lifecycle action to the tracker runtime. | `copilot-ui/routes/tracker.test.js`, `copilot-ui/server.lifecycle-proxy.test.js` |

### SDK bridge surface

| Method | Endpoint | Purpose | Primary test anchors |
| --- | --- | --- | --- |
| `GET` | `/api/sdk/health` | Returns SDK bridge health. | `copilot-ui/routes/sdk.test.js`, `copilot-ui/tests/e2e/sdk-smoke.test.js` |
| `POST` | `/api/sdk/session` | Creates an SDK-backed session. | `copilot-ui/routes/sdk.test.js` |
| `GET` | `/api/sdk/sessions` | Lists SDK-backed sessions. | `copilot-ui/routes/sdk.test.js` |
| `DELETE` | `/api/sdk/session/:sessionId` | Deletes an SDK-backed session. | `copilot-ui/routes/sdk.test.js` |
| `POST` | `/api/sdk/send` | Sends a message through the SDK bridge. | `copilot-ui/routes/sdk.test.js`, `copilot-ui/tests/e2e/sdk-smoke.test.js` |
| `GET` | `/api/sdk/stream/:sessionId` | Streams or reads SDK session output. | `copilot-ui/routes/sdk.test.js` |

## UI tabs

The React UI currently exposes these tab families under `copilot-ui/ui/src/tabs/`:

- `Assets` — managed assets, installed inventory, workspace catalog state, and repair flows
- `Gateway` — messaging gateway state and integration status
- `LSP` — language-server-related runtime inspection
- `Planning` — planning records, diagrams, research notes, and artifact viewers
- `Sandboxes` — sandbox inventory and related lifecycle state
- `Sessions` — session lists, detail panes, SDK message views, and artifact inspection
- `SkillsPreview` — preview/search surfaces for catalog-backed skill discovery
- `Tracker` — tracker state, permission flows, and runtime status

If documentation claims a different dashboard surface, treat the tab directory plus the built UI as the current source of truth.

## Persistence and state model

### Session artifacts

Persisted session artifacts live under `~/.copilot/session-state/<SESSION_ID>/`.

`copilot-ui` reads these artifacts in its Sessions and Planning surfaces, including:

- `plan.md`
- `proposition.md`
- `verification-guide.md`

The canonical artifact contract is defined in [[session-state-artifacts]] [docs/system/session-state-artifacts.md](docs/system/session-state-artifacts.md).

### Planning records

Persisted planning records are not sourced from session markdown artifacts. Their canonical
persisted store is the local planning persistence layer implemented in
`copilot-ui/lib/planningPersistence.js`.

Use that layer as the source of truth for planning record, retention, export/import, corruption,
and migration behavior. Session artifacts remain orchestration artifacts rather than the canonical
planning database.

### Catalog and repo state

Catalog projections, repo inventory, audit, and search telemetry remain file-backed under the
Instruction Engine local state roots described in [[catalog-control-plane]] [docs/system/catalog-control-plane.md](docs/system/catalog-control-plane.md).

## Validation anchors

Use the narrowest relevant checks after changes:

1. `copilot-ui/tests/smoke.test.js` for route availability and basic server behavior.
2. `copilot-ui/tests/api-contract.test.js` for broad public route response-shape regressions.
3. `copilot-ui/routes/catalog.test.js` and `copilot-ui/routes/planning-artifacts.test.js` for additive catalog-bundle and planning-artifact coverage that sits outside the original broad inventory.
4. `copilot-ui/tests/ui-react-smoke.test.js` and related `*.vitest.tsx` files when tab behavior or UI rendering changes.
5. `copilot-ui/tests/catalog-projection-service.test.js`, `copilot-ui/tests/skill-search-service.test.js`, and `copilot-ui/lib/planningPersistence.test.js` when catalog or planning persistence behavior changes.
6. `copilot-ui/VALIDATION.md` for manual curl verification of selected session-artifact endpoints.

## Documentation boundaries

Use this guide as the canonical overview for current `copilot-ui` functionality.

- Keep route semantics, tab inventory, runtime modes, and persistence boundaries here.
- Keep catalog write-path and truth-hierarchy details in [[catalog-control-plane]] [docs/system/catalog-control-plane.md](docs/system/catalog-control-plane.md).
- Keep updater rollback and kill-switch operations in [[desktop-update-rollback-runbook]] [docs/system/desktop-update-rollback-runbook.md](docs/system/desktop-update-rollback-runbook.md).
- Keep detailed session-artifact and progress-tracker contracts in [[session-state-artifacts]] [docs/system/session-state-artifacts.md](docs/system/session-state-artifacts.md).
