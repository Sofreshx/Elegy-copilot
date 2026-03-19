---
created: 2026-03-14
updated: 2026-03-17
category: system
status: current
doc_kind: node
id: domain-authorities-freeze
summary: Frozen canonical authorities for state roots, runtime/readiness state, asset mutation, enablement, sessions, provider catalog data, and tasks during cleanup.
tags: [architecture, authority, cleanup, adr]
related: [catalog-control-plane, session-state-artifacts, system-upgrade-direction-2026]
---

# Domain Authorities Freeze

## Purpose

This document freezes the canonical authority for the cleanup domains that were still split across
`copilot-ui`, the retired `RannIA` extension, `local-tracker`, docs, and shared contracts.

These decisions are intentionally conservative:

- they **stop new overlap now**
- they **do not perform the refactors yet**
- they define which current surfaces are canonical, which are legacy compatibility inputs, and what
  later cleanup streams are expected to converge on

Any future change to these authorities should be treated as an explicit architecture decision, not as
an incidental code change.

## Frozen decisions at a glance

| Domain | Canonical authority | Canonical location / surface | Legacy / secondary surfaces |
|---|---|---|---|
| State roots and storage paths | Unified `~/.copilot` runtime state model | `~/.copilot/*` with the shared layout defined below | `~/.instruction-engine/*` only as migration-era exceptions, not a competing root |
| Runtime and readiness state | Split by authority domain: control-plane runtime via `copilot-ui`, gateway readiness via status file | `copilot-ui` `GET /api/health` for backend runtime/control-plane state; `~/.copilot/messaging-gateway.status.json` for messaging-gateway readiness | `GET /api/gateway/state`, UI panels, and extension trees are projections/consumers; tracker live APIs are operational APIs, not readiness authority |
| Asset mutation authority | `copilot-ui` local backend control plane | catalog mutation and install/enable/disable APIs | direct `RannIA` mutations were retired with the legacy extension |
| Enablement persistence | Repo registry overlay | `~/.copilot/repo-state/<repoId>/registry.json` | VS Code settings are import/compatibility input only |
| Session authority | ACP/runtime session state | runtime-backed session reconciliation, with runtime winning when present | filesystem artifacts remain durable projections and archive/offline fallback |
| Provider catalog source | Shipped provider catalog data | `engine-assets/providers.json` | `contracts/src/providerCatalog.ts` remains schema/helpers plus a synced mirror until generation lands |
| Task authority | Repo-state task store | `~/.copilot/repo-state/<repoId>/tasks/` and `tasks.archive/` | repo-local `.instructions/tasks` remains migration-only input |

## Decision details

### 1) State roots and storage paths

**Decision**

The canonical runtime state root is `~/.copilot`.

All shared runtime state must converge on that root model, including:

- installed assets under `agents/`, `skills/`, `skills-vault/`, and `prompts/`
- session artifacts under `session-state/` and `sessions-archive/`
- repo-scoped overlays and durable repo state under `repo-state/<repoId>/`
- catalog projections, inventory, audit, and telemetry under `catalog/`
- sandbox state under `sandboxes/` when sandbox runtimes are used

**Canonical path contract**

Unless an explicit root override is supplied, the expected layout is:

```text
~/.copilot/
  agents/
  skills/
  skills-vault/
  prompts/
  copilot-instructions.md
  session-state/<SESSION_ID>/
  sessions-archive/
  repo-state/<repoId>/
    registry.json
    tasks/
    tasks.archive/
    artefacts/
    contexts/
    audit/
  catalog/
  sandboxes/
```

Root overrides are allowed only as **root remaps** that preserve this subdirectory contract.

That means:

- `copilot-ui` may continue to honor `--copilot-home`
- downstream packages must not invent a different directory schema when the root changes

**Migration posture**

`~/.instruction-engine/*` is frozen as a **legacy compatibility namespace**, not as a second
authoritative root.

Current runtime behavior treats that namespace as migration-only input. For example, older
`local-tracker` messaging-gateway config/status artifacts may be rehomed into `~/.copilot`, but the
legacy path is no longer a peer default that current surfaces should present as canonical.

### 2) Runtime and readiness state

**Decision**

Runtime/state authority is frozen into distinct, non-overlapping domains:

- `copilot-ui` `GET /api/health` is the canonical HTTP authority for backend runtime/control-plane
  state
- `~/.copilot/messaging-gateway.status.json` is the canonical authority for messaging-gateway
  readiness
- `copilot-ui` `GET /api/gateway/state`, HTTP responses derived from gateway probes, and UI surfaces
  that render gateway state are projections or operational envelopes over those authorities, not peer
  readiness authorities
- tracker live APIs remain operational APIs for live interaction and probing, distinct from the
  canonical readiness authority

This freeze is specifically intended to stop new overlap between `copilot-ui`, `local-tracker`, and
legacy editor surfaces while current implementations are still converging.

**Authority boundary**

`GET /api/health` remains the control-plane runtime surface because it owns backend runtime health
composition for capabilities, provider selection, policy, planning persistence, and related backend
status.

Messaging-gateway readiness is different. The canonical shared readiness contract is the status file
written by `local-tracker` at:

```text
~/.copilot/messaging-gateway.status.json
```

The locked architectural choice is:

1. the status file is canonical
2. HTTP/UI surfaces project from it
3. no new surface should present itself as an independent readiness source of truth

That means:

- `GET /api/gateway/state` may aggregate config state, tracker probe results, and planning
  persistence context for the UI, but it must not become a competing readiness authority
- UI badges, dashboards, and extension trees may summarize readiness for operators, but they are
  consumers of the shared authority contract
- tracker probe success/failure is useful live operational information, but it is not the canonical
  answer to whether shared gateway readiness state is currently authoritative

**Legacy extension boundary**

The retired `RannIA` surfaces were frozen into two different roles:

- **Connections** may render shared runtime/readiness information from the canonical gateway status
  authority and related connection state
- **Requests** and **Permissions** remain extension-local operational state, not shared runtime
  authority

This prevents the extension's request/session/approval trees from being reinterpreted as shared
cross-surface readiness state. Shared readiness belongs to the gateway status contract; extension
workflow state remains local to the extension unless later promoted through an explicit architecture
decision.

### 3) Asset mutation authority

**Decision**

`copilot-ui` is the canonical mutation authority for asset lifecycle changes.

That includes:

- shared shipped asset authoring writes into `engine-assets/*`
- user-global install/update/delete flows under `~/.copilot/*`
- repo-local asset writes under `<repo>/.github/agents` and `<repo>/.github/skills`
- enable/disable mutation routes that write repo overlays

**Authority boundary**

File-backed assets remain the content truth, but `copilot-ui` is the only product surface that owns
mutation orchestration, validation, refresh, and conflict handling.

The retired `RannIA` extension is not a peer control plane. Any future editor integration must
consume backend APIs rather than reintroducing direct-copy or direct-write mutation flows.

### 4) Enablement persistence

**Decision**

The canonical persisted enablement store is:

```text
~/.copilot/repo-state/<repoId>/registry.json
```

This registry is the only durable source of truth for repo-scoped enable/disable state for skills,
agents, and MCP providers.

**Migration posture**

VS Code settings keys such as:

- `skillInstaller.skills.disabledByRepo`
- `skillInstaller.agents.disabledByRepo`
- `skillInstaller.mcp.providers.disabledByRepo`

are frozen as compatibility/import inputs only.

Later cleanup streams should:

1. import from settings when needed
2. read settings only for migration compatibility
3. stop treating settings as a durable peer authority
4. remove dual-write behavior

### 5) Session authority

**Decision**

The canonical live session authority is ACP/runtime session state.

Filesystem session artifacts under `~/.copilot/session-state/<SESSION_ID>/` remain important, but
their role is narrower:

- they are the canonical file contract for persisted artifacts such as `plan.md`,
  `proposition.md`, and `verification-guide.md`
- they are the archive/offline fallback when runtime state is absent
- they are **not** the primary authority for live session reconciliation when runtime state is present

**Reconciliation rule**

When both runtime state and artifact state exist for the same session, runtime wins.

When only runtime exists, the session is still valid and authoritative.

When only artifacts exist, the session may still be exposed as a historical/offline session view.

This freezes the current runtime-first precedence into an explicit contract and prevents later cleanup
work from reintroducing artifact-first reconciliation logic.

### 6) Provider catalog source

**Decision**

The canonical provider catalog data source is:

```text
engine-assets/providers.json
```

This is the editable shipped catalog document that later cleanup streams must treat as the single
provider definition source.

**Authority split that is allowed to remain temporarily**

`contracts/src/providerCatalog.ts` remains authoritative for:

- provider catalog types
- normalization and provenance helpers
- contract-level interpretation logic

But its embedded default catalog data is frozen as a **synced mirror**, not as a competing editable
source.

The current compatibility bridge resolves `engine-assets/providers.json` first and only falls back to
the synced contract mirror when the repo-root asset file is unavailable.

**Migration posture**

Until generation/sync tooling lands:

- edits should originate from `engine-assets/providers.json`
- contract mirrors must remain semantically identical
- parity drift is a bug

### 7) Task authority

**Decision**

The canonical durable task store is repo-state task storage under:

```text
~/.copilot/repo-state/<repoId>/tasks/
~/.copilot/repo-state/<repoId>/tasks.archive/
```

Tasks are repo-scoped durable state, not a repo-local `.instructions/tasks` source of truth.

**Migration posture**

Repo-local task folders such as:

```text
<repo>/.instructions/tasks/
```

are frozen as legacy import/watch compatibility only.

This means:

- no new long-term task features should depend on `.instructions/tasks`
- no replacement editor integration should reintroduce repo-local task authority
- `local-tracker` legacy `.instructions/tasks` watching, if temporarily enabled, is a bounded
  compatibility shim rather than the contract to preserve

## Rules for downstream cleanup streams

The following constraints are now frozen:

1. **Do not add new writers to legacy surfaces.**
   - no new durable writes to VS Code enablement settings
   - no new durable task writes to `.instructions/tasks`
   - no new package-local state roots that compete with `~/.copilot`

2. **Prefer adaptation over shared authority.**
   - if a legacy surface must remain temporarily, treat it as import, projection, mirror, or fallback
   - do not treat it as a second source of truth

3. **Preserve file-backed content truth where already defined.**
   - asset content still lives in shipped/user-global/repo-local files
   - repo-state stores overlays and durable repo-scoped metadata, not primary asset bodies

4. **Keep runtime/session precedence explicit.**
   - live runtime state first
   - filesystem artifacts second
   - no silent precedence inversions

## Evidence snapshot for this freeze

- `README.md` freezes the repo's primary runtime state model around `~/.copilot` and documents
  `copilot-ui` as the catalog control plane.
- `docs/system/catalog-control-plane.md` already assigns `copilot-ui` the local catalog mutation
  control-plane role and limits repo-state to overlays.
- `docs/system/session-state-artifacts.md` defines the canonical artifact file contract under
  `~/.copilot/session-state/<SESSION_ID>/`.
- The retired `RannIA` extension previously encoded the same `~/.copilot` path schema and direct
  editor mutation flows, which is why this document freezes those domains under current runtime
  authorities instead of preserving extension-specific behavior.
- `local-tracker/src/watchers.ts` now targets canonical repo-state task paths and keeps repo-local
  `.instructions/tasks` watching behind an explicit legacy compatibility switch.
- `local-tracker/src/messagingGateway/config.ts` now defaults messaging-gateway config under
  `~/.copilot` and treats `~/.instruction-engine` as a legacy compatibility rehome input rather than
  a competing default.
- `local-tracker/src/messagingGateway/statusFile.ts` defines `~/.copilot/messaging-gateway.status.json`
  as the canonical status path and keeps `~/.instruction-engine` only as a legacy compatibility
  source for rehome.
- `copilot-ui/routes/lifecycle.js` and `copilot-ui/lib/server/runtimeHealth.js` already centralize
  backend runtime/control-plane health behind `GET /api/health`.
- `copilot-ui/routes/gateway.js` assembles gateway state from config, tracker probes, and planning
  persistence, confirming that `GET /api/gateway/state` is an operational envelope rather than the
  canonical readiness authority itself.
- The retired extension's connection/request/permission trees were extension-local operational
  surfaces, reinforcing that shared readiness authority belongs to the messaging-gateway status
  contract rather than any editor-specific tree.
- `copilot-ui/lib/runtimeContracts.js` and `copilot-ui/routes/sessions.js` already encode a
  runtime-first session reconciliation model.
- `engine-assets/providers.json` and `contracts/src/providerCatalog.ts` duplicate provider catalog
  data today, confirming the need to freeze one editable source and one mirror/schema surface.
