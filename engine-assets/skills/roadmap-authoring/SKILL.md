---
name: roadmap-authoring
description: "Canonical authoring and maintenance rules for Planning Bullets, Repository Backlog, and Roadmaps. A Roadmap is the durable multi-session planning artifact above Plan Packs: a folder with an index, section files, progress/evidence, and a reevaluation log. Triggers on: planning bullets, repository backlog, roadmap, roadmap sync, roadmap item, backlog item, phased planning, planning portfolio."
---

# Roadmap Authoring

## Purpose

Author and maintain repo-backed planning artifacts that define **what matters next** before work is
decomposed into a Plan Pack.

A **Roadmap** is the durable multi-session planning artifact above execution. It captures goals,
non-goals, main targets, sequencing, section-level progress, evidence, and reevaluation notes. It is
not an active task list and not a Plan Pack; a Plan Pack selects one roadmap slice for execution.
New or substantially edited Roadmaps use a folder: `index.md` for overview/progress,
section files for detailed `RM-*` items, and `reevaluation-log.md` for out-of-scope or unforeseen
issues that may require roadmap reevaluation.

This skill governs:
- **Planning Bullets** at `~/.copilot/backlogs/{repo-name}/planning/bullets.md` as the canonical pre-backlog seed surface
- the **Repository Backlog** under `~/.copilot/backlogs/{repo-name}/backlogs/*.md` as the primary artifact family
- `~/.copilot/backlogs/{repo-name}/backlog.md` as a legacy compatibility Repository Backlog surface
- **Roadmap** folders at `~/.copilot/backlogs/{repo-name}/roadmaps/<slug>/`
- repo-persisted roadmap folders under `<repo>/docs/planning/<slug>/` when the work must be visible to all coding-agent surfaces
- the explicit ID/linking discipline required for future **Roadmap Sync** and direct plan handoff

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

- **Planning Bullets** are the browse-first pre-backlog seed surface.
- **Repository Backlog** is the repo-wide intake and queued-work surface.
- **Roadmap** is the phased outcome and sequencing surface above execution.
- **Plan Pack** remains the execution artifact for a selected slice of work.

Rules:
- Bullets capture seed ideas before backlog acceptance.
- Backlog captures candidate work and queued items.
- Roadmap organizes selected work into phases or outcomes.
- Plan Pack breaks one selected slice into executable work units.
- Plans may be seeded directly from bullets, backlog items, or roadmap items when linked IDs are preserved.
- Do not let Roadmap drift into work-unit detail.
- Do not let Plan Pack become the authoritative backlog or roadmap.

## Canonical Locations

For the selected repository root:
- Planning Bullets: `~/.copilot/backlogs/{repo-name}/planning/bullets.md`
- Repository Backlog (primary): `~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md`
- Repository Backlog (legacy compatibility): `~/.copilot/backlogs/{repo-name}/backlog.md`
- Roadmaps: `~/.copilot/backlogs/{repo-name}/roadmaps/<slug>/index.md`
- Roadmap section files: `~/.copilot/backlogs/{repo-name}/roadmaps/<slug>/<section-slug>.md`
- Roadmap reevaluation log: `~/.copilot/backlogs/{repo-name}/roadmaps/<slug>/reevaluation-log.md`
- Repo-persisted roadmaps: `<repo>/docs/planning/<slug>/index.md`

Backlog filenames should use lowercase kebab-case session slugs, for example:
- `~/.copilot/backlogs/{repo-name}/backlogs/2026-04-03-session-close.md`
- `~/.copilot/backlogs/{repo-name}/backlogs/platform-audit-follow-up.md`

If `~/.copilot/backlogs/{repo-name}/roadmaps/` does not exist, create it only when roadmap work is actually requested.

Roadmap folder and section filenames should use lowercase kebab-case slugs, for example:
- `~/.copilot/backlogs/{repo-name}/roadmaps/platform-foundation/index.md`
- `~/.copilot/backlogs/{repo-name}/roadmaps/q2-delivery/runtime-contracts.md`
- `<repo>/docs/planning/platform-foundation/index.md`

Legacy single-file roadmaps remain readable at `~/.copilot/backlogs/{repo-name}/roadmaps/<slug>.md`
and `<repo>/docs/planning/<slug>.md`. Convert only the targeted legacy roadmap when it is
substantially edited or explicitly migrated.

## Stable ID Rules

- Bullet item IDs use `PB-###`
- Backlog item IDs use `RB-###`
- Roadmap item IDs use `RM-<roadmap-slug>-###`

Examples:
- `PB-001`
- `RB-001`
- `RM-platform-foundation-001`

Rules:
- IDs must remain stable after creation.
- Continue the highest existing sequence across the Repository Backlog artifact family (`~/.copilot/backlogs/{repo-name}/backlogs/*.md` plus legacy `~/.copilot/backlogs/{repo-name}/backlog.md` when present) or the targeted roadmap family.
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
- shaping roadmap or direct-plan inputs from Planning Bullets
- adding or triaging work in the Repository Backlog
- creating a roadmap from selected backlog work
- creating a repo-persisted roadmap from raw or mixed user instructions
- selecting one roadmap slice for execution across coding sessions
- splitting roadmap outcomes across phases
- keeping roadmap/backlog links explicit and deterministic
- preparing planning artifacts before execution planning begins

## When NOT to Use

Do not use this skill when the request is primarily:
- execution work-unit decomposition -> use `planpack-authoring` / `@o-planner`
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

## Roadmap Folder Model

New or substantially edited roadmaps should be folders, not single large Markdown files.

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

## Repo-Persisted Roadmap Rules

Use `<repo>/docs/planning/<slug>/` for durable roadmaps that should survive across Codex, Copilot, and other coding-agent sessions.

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

Repo-persisted roadmap minimum index shape:

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

Repo-persisted roadmap minimum section shape:

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

1. Read the existing Repository Backlog artifact family (`~/.copilot/backlogs/{repo-name}/backlogs/*.md` first, `~/.copilot/backlogs/{repo-name}/backlog.md` when compatibility requires it) and relevant roadmap `index.md` plus section file(s).
2. Read `~/.copilot/backlogs/{repo-name}/planning/bullets.md` when the request starts from seed ideas or needs `PB-*` linkage.
3. If the target roadmap is a legacy single file and will be substantially edited, convert only that
   roadmap into `<slug>/index.md` plus section files before adding new structure.
4. Decide whether the request belongs in bullets, backlog, roadmap, reevaluation log, or future Plan Pack.
5. Allocate new IDs only where needed.
6. Add or repair explicit cross-links.
7. Keep `index.md` concise and move detailed item content into section files.
8. If the request is now execution-ready, stop and recommend a Plan Pack handoff rather than adding
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
- `engine-assets/skills/planpack-authoring/SKILL.md`
