---
created: 2026-03-09
updated: 2026-03-16
category: system
status: current
doc_kind: node
id: catalog-control-plane
summary: Canonical description of the local catalog control plane, write paths, repo inventory, and verification workflow.
tags: [catalog, control-plane, copilot-ui, search, audit]
related: [search-execute-workflow, skill-discovery-telemetry, skills-governance, system-upgrade-direction-2026]
---

# Catalog Control Plane

## Purpose

Instruction Engine now uses `copilot-ui` as the canonical **local catalog control plane** for
asset discovery, repo selection, search, audit, and mutation workflows.

This control plane does **not** replace file-backed assets. It builds and serves a derived local
projection so the UI, backend APIs, CLI search, and editor integrations can work from one
deterministic view of the world.

## Control-plane responsibilities

`copilot-ui` owns:

- catalog projection build/rebuild and persisted snapshots
- repo inventory and selected-repo state
- backend mutation APIs for create/update/delete/install/enable/disable flows
- deterministic skill search plus bounded search telemetry
- asset audit events, analytics rollups, and runtime health reporting

The retired `RannIA` extension was an in-editor consumer of the same catalog semantics; active
management now lives in `copilot-ui`.

## Truth hierarchy and storage

### File-backed sources of truth

1. **Shared shipped assets**
   - `engine-assets/agents/*.agent.md`
   - `engine-assets/skills/<name>/SKILL.md`
   - `engine-assets/manifest.json`
2. **User-global assets**
   - `~/.copilot/agents`
   - `~/.copilot/skills`
   - `~/.copilot/skills-vault`
3. **Repo-local assets**
   - `<repo>/.github/agents`
   - `<repo>/.github/skills`
4. **Repo overlays only**
   - `~/.copilot/repo-state/<repoId>/registry.json`

Overlay state is limited to enable/disable and derived signals. It is not allowed to become the
source of actual asset content.

### Derived catalog state

The backend persists projection snapshots under:

- `~/.copilot/catalog/projections/global.json`
- `~/.copilot/catalog/projections/repo-<repoId>.json`

Each snapshot is rebuildable from filesystem truth plus bounded local audit/search/session data.

If a persisted snapshot is missing, catalog reads can fall back to an in-memory filesystem rebuild
(`readMode: "filesystem-fallback"`). A refresh persists the snapshot again.

## Vault-first skill model

The delivered model is still vault-first:

- a small always-loaded set stays in `~/.copilot/skills`
- domain skills are primarily on-demand and live in `~/.copilot/skills-vault`
- repo-local overrides live beside the repo under `.github/skills`

Catalog search ranks against the **effective** asset state, so vault-first skills still show up in
search and UI surfaces even when they are not always loaded.

Compatibility note:

- the projection recognizes pointer-style files in `~/.copilot/skills/**/SKILL.md` when they carry
  a `vault-ref`
- the authoritative on-demand content still lives in `skills-vault`

## Repo inventory and selection

Repo inventory is stored in `~/.copilot/catalog/repo-inventory.json`.

The current implementation merges repo candidates from:

- manual registrations saved in the repo inventory file
- repos inferred from `session-state/*`
- repos already present in `~/.copilot/repo-state`
- persisted catalog projection hints
- explicit repo paths supplied in a request
- the local `instruction-engine` workspace when it is the active backend root

Each repo entry can surface:

- `repoId`, `repoPath`, `repoLabel`
- `sources`
- `scanStatus`
- detected frameworks / targets
- repo-local asset presence and counts
- snapshot metadata for the repo projection

Repo management endpoints:

- `GET /api/catalog/repos`
- `POST /api/catalog/repos/register`
- `POST /api/catalog/repos/unregister`
- `POST /api/catalog/repos/select`
- `POST /api/catalog/repos/refresh`

Selecting and refreshing a repo is how central management includes repo-local `.github/skills` and
`.github/agents` even when the editor is not actively driving discovery.

## Backend mutation APIs and authoritative write paths

### Shared shipped assets

Mutation scope: `authoringScope: "shared"`

- writes into `engine-assets/*`
- for skills, also updates `engine-assets/manifest.json`
- allowed only when the selected authoring repo/workspace is the `instruction-engine` repo itself

### User-global assets

Mutation scope: `authoringScope: "user-global"`

- agents write to `~/.copilot/agents`
- skills write to:
  - `~/.copilot/skills/<name>` when `loadMode = "always"`
  - `~/.copilot/skills-vault/<name>` when `loadMode = "on-demand"`

The backend refuses ambiguous user-global skill mutations when both `skills/` and `skills-vault/`
copies already exist for the same asset key.

### Repo-local assets

Mutation scope: `authoringScope: "repo-local"`

- agents write to `<repo>/.github/agents`
- skills write to `<repo>/.github/skills/<name>/SKILL.md`

### Overlay-only enablement

`POST /api/catalog/assets/enable` and `POST /api/catalog/assets/disable` write only to:

- `~/.copilot/repo-state/<repoId>/registry.json`

These routes do not modify shared, user-global, or repo-local content files.

### Install behavior

`POST /api/catalog/assets/install` copies shared shipped assets from `engine-assets/*` into the
user install surface under `~/.copilot/*`.

For skills:

- all shipped skills install to `~/.copilot/skills-vault/<name>`
- `loadMode: "always"` also installs a copy to `~/.copilot/skills/<name>`

Mutation safety includes temp-path writes, atomic replace where possible, conflict detection via
content hashes, rollback on failed refresh, and projection rebuild after successful mutation.

Bundle and repo-scope note:

- workflow packs are an **explicit optional install layer** that group multiple shared assets into one action
- profile or routing-policy state may mark a bundle active/eligible, but that state does **not** by itself copy bundle members into `~/.copilot`
- repo-specific governance lanes are not installed into the user-global surface; they are discovered from the selected repo's `.github/agents` and `.github/skills` plus repo overlay state

## Search, audit, and runtime health surfaces

### Search

- `POST /api/search/query`
- `POST /api/search/selection`
- CLI wrapper: `node scripts/skill-search.mjs`

Search uses the shared `skillSearchService` and deterministic ranking with explanations drawn from:

- asset key/title/aliases
- trigger phrases and description text
- frameworks, stacks, languages, and tags
- repo/workspace context
- load mode
- recommendation signals
- deterministic lexical tie-breaking

Bounded telemetry is stored in `~/.copilot/catalog/search-telemetry.json`.

### Audit and analytics

- `GET /api/audit/events`
- `GET /api/audit/assets`

Audit analytics merge three local sources:

- lifecycle audit events in `~/.copilot/catalog/audit/events.jsonl`
- bounded search telemetry from `search-telemetry.json`
- session-derived usage signals from `~/.copilot/session-state/*/events.jsonl`

Persisted payloads stay privacy-safe by preferring repo/workspace IDs over raw paths.

### Runtime health

- `GET /api/runtime/catalog-health`

The current health surface reports:

- projection availability and read mode
- snapshot freshness and input timestamps
- projection rebuild status
- audit file presence/size/update time
- backend change-tracker metadata

It does **not** currently expose a separate CLI bridge heartbeat; CLI search uses the same shared
service directly.

## Bootstrap, migration, and verification

### Bootstrap model

There is no separate catalog database migration step for asset content. Bootstrap is:

1. start the local backend
2. rebuild the global projection
3. optionally register/select a repo
4. rebuild that repo projection

Because the file layout stays unchanged, rollback remains simple: the legacy file-backed asset
layout still exists even if a projection snapshot is stale or missing.

### Minimal verification flow

1. `POST /api/catalog/refresh`
2. `GET /api/catalog/summary`
3. `GET /api/catalog/repos`
4. `POST /api/catalog/repos/refresh` for any repo that should contribute `.github/*` assets
5. `POST /api/search/query` with a known skill query
6. `GET /api/audit/assets`
7. `GET /api/runtime/catalog-health`

Recommended local validation commands for this repo:

```bash
node scripts/validate-doc-graph.js
node copilot-ui/routes/catalog.test.js
node copilot-ui/lib/repoInventoryService.test.js
node copilot-ui/tests/skill-search-service.test.js
node copilot-ui/tests/api-contract.test.js
node scripts/skill-search.test.js
```

Desktop-packaging note:

- Treat packaged Electron distribution as an optional maintainer release lane layered on top of this
  local control plane, not as the default release expectation for routine repo changes.

## Current limitations / honest drift

- Repo inventory currently merges manual registrations, session-state hints, repo-state hints,
  projection hints, explicit paths, and the local workspace. A distinct gateway-root merge path is
  not surfaced as its own inventory source yet.
- Runtime health is focused on projection/audit/change state; it does not yet publish every
  roadmap-era health dimension as a separate contract field.
- Legacy `/api/assets/*` routes still exist for compatibility while catalog flows finish replacing
  older asset-management paths.
