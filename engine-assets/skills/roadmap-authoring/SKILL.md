---
name: roadmap-authoring
description: "Authoring and compatibility rules for Planning Bullets, Repository Backlog, and Roadmaps. The live durable authority is elegy-planning; file-backed forms are import, projection, or migration surfaces only. Triggers on: planning bullets, repository backlog, roadmap, roadmap sync, roadmap item, backlog item, phased planning, planning portfolio."
---

# Roadmap Authoring

## Purpose

Author and maintain planning inputs that define **what matters next** before work is decomposed
into a Plan Pack. In the live path, durable goals, roadmaps, plans, work points, and project runs
belong to the explicit `elegy-planning` scope. This skill preserves file-shaped compatibility
formats for import, export, migration, and human review; it must not silently create a second
roadmap authority.

A **Roadmap** is the durable multi-session planning artifact above execution. It captures goals,
main targets, sequencing, and explicit `RM-*` roadmap item state. It is not an active task list and
not a Plan Pack; a Plan Pack selects one roadmap slice for execution.

This skill governs:
- the stable ID/linking discipline required for `elegy-planning` goal → roadmap → plan → work-point
  records and direct plan handoff;
- file-shaped Planning Bullets, Repository Backlog, and Roadmap projections when a caller explicitly
  requests import, export, migration, or human review;
- compatibility checks that prevent a file projection from being mistaken for live authority.

`{repo-name}` is the basename of the repository directory.

## Canonical Terms

Use these names exactly:
- **Planning Bullets**
- **Repository Backlog**
- **Roadmap**
- **Roadmap Sync**
- **Plan Pack**

Do not rename these concepts in canonical planning artifacts.

## Authority Boundaries

- **elegy-planning** is the live durable authority for goals, roadmaps, plans, work points, todos,
  issues, review points, and project runs. Always pass an explicit `--scope <scope-key>`.
- **Planning Bullets**, **Repository Backlog**, and file-backed **Roadmap** forms are compatibility
  inputs/projections, not live authority. Preserve IDs when importing or rendering them.
- **Plan Pack** remains the active session execution artifact for a selected slice of work.

Rules:
- Bullets capture seed ideas before backlog acceptance when a compatibility file is requested.
- Backlog captures candidate work and queued items when importing or projecting compatibility data.
- Roadmap organizes selected work into phases or outcomes in `elegy-planning`.
- Plan Pack breaks one selected slice into executable work units.
- Plans may be seeded directly from bullets, backlog items, or roadmap items when linked IDs are preserved.
- Do not let Roadmap drift into work-unit detail.
- Do not let Plan Pack become the authoritative backlog or roadmap.

## Live Authority and Compatibility Locations

For live work, resolve the explicit `elegy-planning` scope and use its CLI/API for goal, roadmap,
plan, work-point, and project-run references. The default `default` scope must never be selected
implicitly. The following paths are historical compatibility forms only:

- `~/.elegy/backlogs/{repo-name}/planning/bullets.md`
- `~/.elegy/backlogs/{repo-name}/backlogs/<session-slug>.md`
- `~/.elegy/backlogs/{repo-name}/roadmaps/<slug>/index.md`
- `<repo>/docs/roadmaps/<slug>.md`

Do not create or update these paths as a substitute for the live planning authority. If a caller
requests a file projection, label it `compatibility` and include the durable entity IDs and scope.

Backlog filenames should use lowercase kebab-case session slugs, for example:
- `~/.elegy/backlogs/{repo-name}/backlogs/2026-04-03-session-close.md`
- `~/.elegy/backlogs/{repo-name}/backlogs/platform-audit-follow-up.md`

If a compatibility projection directory does not exist, create it only when the caller explicitly
requests a projection or migration, and never during ordinary roadmap planning.

Roadmap folder and section filenames should use lowercase kebab-case slugs, for example:
- `~/.elegy/backlogs/{repo-name}/roadmaps/platform-foundation/index.md`
- `~/.elegy/backlogs/{repo-name}/roadmaps/q2-delivery/runtime-contracts.md`
- `<repo>/docs/roadmaps/platform-foundation.md`

Legacy single-file roadmaps remain readable as compatibility input. Convert only the targeted
roadmap when the caller explicitly requests migration, and record the resulting `elegy-planning`
IDs rather than treating the converted file as authority.

## Stable ID Rules

- Bullet item IDs use `PB-###`
- Backlog item IDs use `RB-###`
- Roadmap item IDs use `RM-<roadmap-slug>-###`

Examples:
- `PB-001`
- `RB-001`
- `RM-platform-foundation-001`

Rules:
- IDs must remain stable after creation in the `elegy-planning` records and any derived projection.
- For a compatibility import, continue the highest existing sequence in the targeted input family;
  never use a file projection to overwrite or fork live graph IDs.
- Never reuse or renumber existing IDs just to make the file look cleaner.
- The roadmap slug portion must match the roadmap folder slug.

## Linking Rules for Roadmap Sync

Automatic reconciliation depends on explicit linked IDs.

Required behavior:
1. Every roadmap item must explicitly list the backlog item IDs it covers and any directly referenced `PB-*` seeds when bullets remain the starting input.
2. When backlog items are promoted from bullets, preserve the originating `PB-*` IDs in notes or explicit linked references instead of deleting the bullets by default.
3. When roadmap work starts from bullets, preserve explicit bullet-to-roadmap linkage on both sides when the artifact model supports it; do not rely on prose-only origin notes.
4. When a Plan Pack is created from bullet, roadmap, or backlog work, preserve the linked `PB-*`, `RB-*`, and `RM-*` IDs verbatim in the execution handoff.
5. Do not rely on heading text, timestamps, or prose-only association for linkage.
6. If explicit IDs are missing, treat the artifact as **not Roadmap Sync-ready** and say so directly.

## When to Use

Use this skill when the request is primarily about:
- resolving or preparing a durable roadmap handoff to an explicit `elegy-planning` scope (use the
  `elegy-planning` workflow for graph writes and `goal-session-workflow` for long execution runs)
- shaping roadmap or direct-plan inputs from Planning Bullets
- adding or triaging work in the Repository Backlog
- creating a roadmap from selected backlog work
- importing or projecting a repo/file roadmap from raw or mixed user instructions
- selecting one roadmap slice for execution across coding sessions
- splitting roadmap outcomes across phases
- keeping roadmap/backlog links explicit and deterministic across the durable graph and any projection
- preparing planning artifacts before execution planning begins

## When NOT to Use

Do not use this skill when the request is primarily:
- execution work-unit decomposition -> use normal implementation planning or `implementation-handoff`
- generic docs IA or documentation graph hygiene
- code implementation or validation
- retrofitting plan-pack sections into repo docs

## Minimal Authoring Guidance

The future parser may evolve, but these elements are non-negotiable:
- stable `PB-*`, `RB-*`, and `RM-*` IDs when those artifacts exist
- explicit roadmap-to-backlog linkage
- clear separation between roadmap scope and plan-pack detail
- one selected execution slice at a time
- evidence before marking roadmap work done

Recommended minimum for each bullet:
- ID
- short title
- explicit state
- concise summary
- linked backlog, roadmap, or plan references when known

Recommended minimum for each backlog item:
- ID
- short title
- explicit status
- concise summary / desired outcome
- linked roadmap item IDs when known

Recommended minimum for each roadmap item:
- ID
- short outcome title
- explicit phase or section placement
- explicit covered backlog IDs
- concise outcome statement
- explicit status
- acceptance or evidence field when the roadmap lives in `docs/planning/`
- optional plan/session references once execution exists

## Roadmap Projection Model

New or substantially edited compatibility projections should be folders, not single large Markdown
files. Create the corresponding live goal/roadmap/work-point records first or label the projection
as an unimported draft.

`index.md` is the overview and progress surface. It should include:
- roadmap title and concise description
- goals, non-goals, and main targets
- current slice
- section index with links, status, progress counts, dependencies, and evidence summary
- link to `reevaluation-log.md` when that file exists

Section files hold the detailed roadmap work. Each section file should include:
- section goal and status
- `RM-<roadmap-slug>-###` items
- covered backlog IDs and originating bullet IDs when known
- acceptance checks and evidence
- notes and a short session log

`reevaluation-log.md` captures out-of-scope issues, unforeseen findings, blockers, scope changes, and
roadmap-invalidating discoveries. Entries that imply future action must link to an existing `RB-*` or
`RM-*` ID, create the needed durable item, or explicitly state that no durable action item was created.
Do not create a new ID family for reevaluation entries.

## Compatibility Projection Rules

Use `<repo>/docs/planning/<slug>/` only for an explicitly requested compatibility projection that
should be reviewable across Codex, Copilot, and other coding-agent sessions. The durable graph
record remains in `elegy-planning`.

Core rules:
- Work one slice at a time; avoid broad "continue the roadmap" execution.
- Do not execute multiple slices unless the user explicitly selects them.
- Do not mark a slice `done` without evidence.
- Keep updates factual and small.

When raw mixed instructions are dumped into chat:
1. Group by product area, dependency, and risk.
2. Separate current truth, future goals, bugs, cleanup, research, and open questions.
3. Order by dependency: unblockers, contracts/data, runtime, UI/UX, validation/docs, polish.
4. Split unrelated goals into separate sections or roadmap folders.
5. Assign each executable slice a stable `RM-<roadmap-slug>-###` ID.
6. Convert vague items into concrete outcomes and acceptance checks.
7. Put unclear items under questions.

Compatibility roadmap projection minimum index shape:

```markdown
# <Roadmap Title>

## Description
<durable goal and current scope>

## Goals
- <goal>

## Non-Goals
- <non-goal or none>

## Main Targets
- <target>

## Current Slice
- Active: none
- Started: none
- Stop condition: none

## Section Index
| Section | Status | Progress | Depends on | Evidence |
|---|---|---:|---|---|
| [Runtime Contracts](runtime-contracts.md) | pending | 0/3 | none | none |

## Reevaluation
- Log: [reevaluation-log.md](reevaluation-log.md)
```

Compatibility roadmap projection minimum section shape:

```markdown
# <Section Title>

## Section Goal
- <goal>

## Status
- pending

## Items

### RM-<roadmap-slug>-001 <Slice Name>
Status: pending
Depends on: none
Covers Backlog IDs: RB-001
Goal:
- <specific outcome>
Acceptance:
- <observable check>
Evidence:
- none

## Session Log
- none
```

Statuses: `pending`, `ready`, `in-progress`, `blocked`, `done`, `dropped`.

For execution, select one `RM-*` slice, plan only that slice, implement and validate it, then update only that slice's status, evidence, and session log unless the implementation invalidates later work.

## Suggested Lightweight Templates

Backlog example:

```markdown
# Repository Backlog

## Items

### RB-001 - Example item
- Status: proposed
- Summary: Short repo-scoped work description.
- Roadmap Links: none yet
```

Roadmap example:

```markdown
# Roadmap: Platform Foundation

## Description
Foundational platform work that spans multiple sessions.

## Current Slice
- Active: none

## Section Index
| Section | Status | Progress | Depends on | Evidence |
|---|---|---:|---|---|
| [Phase 1](phase-1.md) | planned | 0/1 | none | none |
```

Roadmap section example:

```markdown
# Phase 1

### RM-platform-foundation-001 - Example outcome
- Status: planned
- Covers Backlog IDs: RB-001
- Outcome: Short phased outcome statement.
- Plan Pack: none yet
```

These templates are guidance, not a frozen schema. The stable IDs and explicit links are the frozen
contract.

## Maintenance Workflow

1. Resolve the explicit `elegy-planning` scope and inspect the live goal/roadmap/plan/work-point
   context before authoring or recommending a slice. Never let an omitted scope select `default`.
2. If the caller explicitly requests a compatibility import or projection, read only the named
   file family (`~/.elegy/backlogs/...` or `<repo>/docs/...`) and label every result `compatibility`.
   Ordinary live roadmap work must not read or edit those files as authority.
3. For an import, preserve or map stable IDs into the live graph first; for a projection, render the
   live IDs and scope. Convert a legacy single file only when the caller explicitly requests
   migration, and never edit the converted files as a substitute for graph writes.
4. Decide whether the live request belongs in a goal, roadmap, plan, work point, issue, or future
   Plan Pack. Keep the root goal/session workflow responsible for execution waves and checkpoints.
5. Allocate new IDs only where needed in the live graph, then add or repair explicit cross-links.
6. Keep any requested `index.md` concise and move detailed projection content into section files.
7. If the request is now execution-ready, stop and recommend a Plan Pack handoff rather than adding
   implementation detail here.

## Roadmap Sync Readiness Checklist

Before concluding backlog/roadmap work, confirm:
- any referenced bullet seeds keep their `PB-*` IDs visible in backlog, roadmap, or handoff output
- every new roadmap item has an `RM-*` ID
- every linked backlog item has an `RB-*` ID
- any bullet-driven roadmap flow preserves explicit bullet-to-roadmap linkage when the artifact model supports it
- roadmap items explicitly list covered backlog IDs
- any known plan/session references preserve the linked IDs verbatim
- missing IDs or broken links are called out explicitly instead of guessed

## Canonical References

- `docs/system/planning-backlog-roadmap-contract.md`
- `docs/system/session-state-artifacts.md`
- `skill-implementation-handoff` — for execution handoff from planning artifacts
