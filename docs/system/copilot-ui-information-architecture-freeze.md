---
created: 2026-03-14
updated: 2026-06-28
category: system
status: archived
doc_kind: node
id: copilot-ui-information-architecture-freeze
summary: Historical information architecture freeze retained for research context; the desktop sidebar shell is now canonical.
tags: [copilot-ui, information-architecture, navigation, planning, catalog, sessions]
related: [copilot-ui-guide, catalog-control-plane, session-state-artifacts, workflow-planning-contract]
---

# copilot-ui Information Architecture Freeze

## Decision status

This document freezes the approved target information architecture for the next `copilot-ui`
overhaul phase. It is a **design decision**, not an implementation log.

## Current patterns and evidence

The current shell and tab layout establish the baseline that the overhaul absorbed rather than
replacing from scratch.

- The current canonical shell is the desktop sidebar with `Execution`, `Projects`, `Catalog`,
  `Todo`, `Maintenance`, and `Settings`
  (`copilot-ui/ui/src/stores/navigation.ts`, `copilot-ui/ui/src/App.tsx`).
- Runtime execution is surfaced through `DashboardView`, session detail views, and maintenance
  diagnostics instead of the retired runtime tab shell.
- Diagnostics now exposes `Elegy Copilot Runtime`, `Planning Database`, `Gateway`,
  `Tracker`, and `LSP` operator surfaces from the active runtime hub.
- `SessionsWorkspaceView` remains a narrower legacy/runtime workspace component rather than the
  active shell destination (formerly at `copilot-ui/ui/src/tabs/Sessions/SessionsWorkspaceView.tsx`, since removed).
- `CatalogView` already groups discovery surfaces under one top-level area and delegates to
  `AssetsView` and `SkillsPreviewView`
  (`copilot-ui/ui/src/tabs/Catalog/CatalogView.tsx`).
- Historical planning tab prototypes owned idea capture, planning records, compare/merge, and SDK
  handoff behavior before the Planning Authority surface replaced them.
- `engine-assets/providers.json` previously registered `external-provider` as a provider-backed
  capability source, which means the overhaul should surface it rather than invent a new provider
  model (`engine-assets/providers.json`).

## Frozen top-level IA

`copilot-ui` will move to exactly **4 top-level hubs**:

1. **Home / Runtime**
2. **Catalog**
3. **Planning**
4. **Stats**

This is the final navigation model for the overhaul. The former standalone `Sessions` and `State`
top-level tabs are retired as top-level destinations and folded into **Home / Runtime**.

## Hub definitions

### 1. Home / Runtime

**Purpose**

Home / Runtime is the default operational landing hub. It combines the former `State` and
`Sessions` surfaces into one runtime-centric control center.

**Why this is the chosen shape**

- It preserves the status hub capability formerly provided by `StateView`.
- It preserves the runtime engagement capability from `SessionsWorkspaceView`.
- It gives operators one first stop for “is the system healthy?” and “what do I do next?”
- It avoids scattering readiness checks, session work, and sandbox actions across separate top-level
  tabs.

**Frozen sub-sections**

Home / Runtime will contain these sub-sections:

1. **Overview** — default landing
2. **Sessions**
3. **Executor**
4. **Diagnostics**

**Overview responsibilities**

Overview is the first-class dashboard/state surface. It must include:

- runtime readiness summary
- planning DB / persistence summary
- catalog health summary
- Copilot SDK bridge summary
- policy gate summary
- session activity summary
- sandbox lifecycle summary
- recent activity or most recent session pointer
- explicit quick actions

**Mandatory quick actions on Overview**

The Overview section must expose direct operator actions without requiring a section switch first:

- refresh runtime/status data
- jump to active sessions
- create or resume SDK session
- launch or continue sandbox-backed runtime work
- jump to Catalog for asset, skill, or agent discovery
- jump to Planning for idea capture / record work

Quick actions are part of the frozen IA, not an optional enhancement.

**Sessions responsibilities**

The Sessions section becomes the main runtime engagement workspace and absorbs the existing
`SessionsView` behavior:

- local sessions
- SDK sessions
- session detail inspection
- SDK message streaming
- session deletion / lifecycle controls already supported by policy

**Executor responsibilities**

The Executor section owns queued/runtime work plus embedded sandbox lifecycle behavior:

- executor job and run management
- external CLI session observation
- manual sandbox lifecycle controls
- sandbox inventory
- follow sandbox session into runtime engagement

**Diagnostics responsibilities**

Diagnostics is where the operator tools formerly hosted by `StateView` now live:

- Elegy Copilot Runtime
- Planning Database
- Gateway
- Tracker
- LSP

These remain first-class capabilities, but they no longer occupy a top-level tab.

### 2. Catalog

**Purpose**

Catalog remains the discovery and management hub for assets, skills, agents, bundles, installs, and
provider-backed capability packs.

**Frozen sub-sections**

Catalog will contain these sub-sections:

1. **Overview**
2. **Assets**
3. **Skills**
4. **Agents**

**Overview responsibilities**

Catalog Overview is the discovery dashboard for:

- installed vs effective asset counts
- repo selection / projection context
- bundle and provider summary
- featured providers and external capability packs
- jump points into asset, skill, and agent detail work

**Assets responsibilities**

Assets remains the management workspace currently anchored by `AssetsView`:

### 4. Stats

**Purpose**

Stats is the top-level observability hub for runtime, session, asset, search, and recent sampled
usage telemetry.

**Frozen responsibilities**

Stats owns cross-cutting read-only observability that is already available through existing
contracts but was previously split across Runtime, Catalog, and Session detail views:

- elegy-copilot runtime health summary
- catalog projection/runtime health summary
- SDK bridge and executor health summary
- deduped merged session inventory summary across CLI and sandbox sources
- aggregate catalog audit analytics for assets, repos, sessions, search, and invocation counts
- bounded recent agent and skill rollups sampled from recent merged sessions

Stats must not imply exhaustive token usage or full historical accounting unless an authoritative
backend source is introduced later.

- effective asset table
- installed inventory
- authoring and repair actions
- repo-aware enable/disable and install state

**Skills responsibilities**

Skills remains the search-and-preview workspace currently anchored by `SkillsPreviewView`:

- skill filtering
- detail preview
- provider-qualified identity visibility
- vault-first and provider-backed discovery

**Agents responsibilities**

Agents becomes a dedicated first-class Catalog surface rather than staying implicit inside generic
asset tables. It is responsible for:

- agent inventory and detail inspection
- provider-qualified agent discovery
- spotlighting provider-backed agent packs
- explicit engagement entry points that hand the user into Home / Runtime

**Provider spotlight freeze**

`external-provider` must be surfaced in Catalog Overview and Catalog Agents as an explicit
provider-backed capability pack. The IA assumes:

- provider presence is visible by name, not hidden in generic metadata
- relevant skills and agents can be discovered from the provider context
- at least one “engage” action routes the operator into Home / Runtime with clear runtime intent

### 3. Planning

**Purpose**

Planning remains the dedicated planning and idea-management hub. It does **not** move under Home /
Runtime or Catalog.

**Responsibilities**

- idea capture
- repo-state task board projection/control surface for durable tasks under `~/.elegy/repo-state/<repoId>/tasks/`
- planning records
- search / compare / merge
- research notes and diagrams
- compile-to-session handoff into runtime work
- auto-triggered local workflow controls/status for the selected repo, without creating a fifth hub

Planning keeps its current first-class status because it represents a distinct workflow stage and
already has stable affordances.

The visible task board belongs inside this frozen shell rather than as a new runtime destination. It
may keep bounded ephemeral UI-only state outside canonical task storage, but durable task identity,
status, and queue/control data must reconcile back to repo-state tasks.

## Migration map

| Current location | Target location | Migration note |
| --- | --- | --- |
| Top-level `Planning` | Top-level `Planning` | Keep as-is conceptually; only shell alignment changes. |
| Top-level `Catalog` | Top-level `Catalog` | Expand to include dedicated Overview and Agents sections. |
| Top-level `Sessions` | `Home / Runtime` | Retire as top-level tab. |
| `Sessions > Runtime` | `Home / Runtime > Sessions` | Runtime engagement stays intact under the new home hub. |
| `Sessions > Sandboxes` | `Home / Runtime > Executor` | Sandbox lifecycle stays intact, but as an embedded executor mode instead of a standalone runtime destination. |
| Top-level `State` | `Home / Runtime` | Retire as top-level tab. |
| `State > Overview` | `Home / Runtime > Overview` | Becomes the default dashboard landing section. |
| `State > Gateway` | `Home / Runtime > Diagnostics > Gateway` | Diagnostics-only move; no separate top-level ownership. |
| `State > Tracker` | `Home / Runtime > Diagnostics > Tracker` | Diagnostics-only move; no separate top-level ownership. |
| `State > LSP` | `Home / Runtime > Diagnostics > LSP` | Diagnostics-only move; no separate top-level ownership. |
| Planning compile handoff to `Sessions` | Planning compile handoff to `Home / Runtime > Sessions` | Any session-ready callback must target the new runtime hub. |
| Agent discovery implicit in asset inventory | `Catalog > Agents` plus explicit handoff to `Home / Runtime` | Agents become visible as their own decision surface. |

## Navigation behavior freeze

- **Default launch hub:** `Home / Runtime`
- **Default Home / Runtime section:** `Overview`
- **Default Catalog section:** `Overview`
- **Default Planning section:** existing default Planning surface
- Cross-hub entry points are required where workflow continuity matters:
  - Planning compile completion → Home / Runtime
  - Sandbox follow action → Home / Runtime > Sessions
  - Catalog agent engagement → Home / Runtime
- No new top-level destination is approved for task boards, workflows, sessions, worktrees, or sandboxes.

## Recommended parallel implementation streams

These streams are designed to minimize file conflicts after the freeze.

### Stream A — Shell and navigation

**Primary ownership**

- `copilot-ui/ui/src/App.tsx`
- `copilot-ui/ui/src/stores/navigation.ts`
- shared tab-shell tests and styles

**Scope**

- preserve the frozen 4-hub shell
- rename navigation contracts
- retarget default tab selection
- preserve accessibility and keyboard behavior

### Stream B — Home / Runtime overview and quick actions

**Primary ownership**

- new `copilot-ui/ui/src/tabs/HomeRuntime/*`
- extracted overview/status card helpers if needed
- extracted quick-action components if needed

**Scope**

- build the combined overview dashboard
- compose state and session summaries into one landing page
- expose the frozen quick actions

**Conflict notes**

Keep this stream out of `Catalog` and `Planning` files except for agreed navigation callback wiring.

### Stream C — Runtime engagement migration

**Primary ownership**

- `copilot-ui/ui/src/tabs/Sessions/*`
- new Home / Runtime section wrappers that host runtime content

**Scope**

- move current sessions runtime UI under Home / Runtime
- move sandboxes under Executor inside Home / Runtime
- preserve follow-session behavior and SDK flow behavior

**Conflict notes**

This stream should avoid direct ownership of `App.tsx` after Stream A lands.

### Stream D — Diagnostics consolidation

**Primary ownership**

- `copilot-ui/ui/src/tabs/State/*`
- `copilot-ui/ui/src/tabs/Gateway/*`
- `copilot-ui/ui/src/tabs/Tracker/*`
- `copilot-ui/ui/src/tabs/LSP/*`
- new Home / Runtime diagnostics wrapper

**Scope**

- fold State overview logic into Home / Runtime Overview
- host Gateway / Tracker / LSP under Diagnostics
- preserve existing diagnostics components wherever possible

**Conflict notes**

This stream should coordinate with Stream B on overview-card extraction, but otherwise can stay
isolated from Catalog and Planning.

### Stream E — Catalog expansion for provider and agent engagement

**Primary ownership**

- `copilot-ui/ui/src/tabs/Catalog/CatalogView.tsx`
- `copilot-ui/ui/src/tabs/Assets/*`
- `copilot-ui/ui/src/tabs/SkillsPreview/*`
- new Catalog agent/provider views as needed

**Scope**

- add Catalog Overview
- create dedicated Agents surface
- surface `external-provider`
- add explicit engagement entry points into Home / Runtime

**Conflict notes**

This stream should not need to touch diagnostics or planning internals.

### Stream F — Planning retargeting and docs/tests

**Primary ownership**

- `copilot-ui/ui/src/tabs/Planning/*`
- UI tests and docs that reference old tab names
- `docs/system/copilot-ui-guide.md`

**Scope**

- retarget planning handoff callbacks
- update docs and tests for the new shell
- preserve planning behavior while only changing destination labels / navigation

## Hidden scope risks and blockers

### 1. Quick actions are not yet reusable

Current session-creation and sandbox-launch actions live inside `SessionsView` component-local state
and handlers. Home / Runtime Overview will need reusable action boundaries rather than duplicated
UI logic.

### 2. State overview composition must stay centralized

The former `StateView` composition is now absorbed into maintenance diagnostics and status-store
polling. Future changes should extend those shared primitives rather than reintroducing a separate
state/status hub.

### 3. Explicit cross-hub navigation is still lightweight

The current app shell uses local component state in `App.tsx` rather than a richer navigation store
or route layer. Explicit “engage”, “follow”, and “compile complete” handoffs may need a small
navigation contract uplift.

### 4. Agents are not yet a dedicated UI primitive

Agent capability exists in Catalog data and installed inventory, but there is no dedicated `Agents`
view today. That means the IA is frozen, but the implementation stream still has to define the
agent-specific browsing component boundary.

### 5. Provider spotlighting may expose backend contract gaps

`external-provider` was registered at the provider layer in the historical design, but the UI surface may not yet receive
enough provider-shaped data to render a true provider landing card without additional backend or
store work.

### 6. Test and documentation fallout is broader than the shell change

Tab labels, section labels, callback destinations, and `data-testid` references are likely spread
through UI tests and system docs. This is manageable, but it is real scope and should not be
treated as incidental cleanup.

## Out of scope for this freeze

This decision does **not** approve:

- backend route redesign
- new persistence semantics
- implementation of provider install flows
- visual polish choices beyond required IA shape
- broad planning feature redesign

## Done definition for the freeze

This freeze is complete when later implementation work treats the following as fixed:

- the 4 top-level hubs are `Home / Runtime`, `Catalog`, `Planning`, and `Stats`
- `Sessions` and `State` are no longer top-level tabs
- Home / Runtime owns dashboard/state plus runtime engagement
- Catalog owns assets, skills, agents, and provider discovery
- Planning owns repo-contextual planning plus the visible repo-state task board/workflow controls
- no fifth top-level runtime destination is introduced for task boards or workflow execution
- `external-provider` is surfaced through Catalog plus explicit runtime engagement entry points
