---
name: roadmap-authoring
description: "Canonical authoring and maintenance rules for Repository Backlog and Roadmap artifacts, including Roadmap Sync-ready linked IDs and plan-pack handoff boundaries. Triggers on: repository backlog, roadmap, roadmap sync, roadmap item, backlog item, phased planning, planning portfolio."
---

# Roadmap Authoring

## Purpose

Author and maintain repo-backed planning artifacts that define **what matters next** before work is
decomposed into a Plan Pack.

This skill governs:
- the **Repository Backlog** at `docs/backlog.md`
- **Roadmap** files at `docs/roadmaps/<slug>.md`
- the explicit ID/linking discipline required for future **Roadmap Sync**

## Canonical Terms

Use these names exactly:
- **Repository Backlog**
- **Roadmap**
- **Roadmap Sync**
- **Plan Pack**

Do not rename these concepts in canonical planning artifacts.

## Authority Boundaries

- **Repository Backlog** is the repo-wide intake and queued-work surface.
- **Roadmap** is the phased outcome and sequencing surface above execution.
- **Plan Pack** remains the execution artifact for a selected slice of work.

Rules:
- Backlog captures candidate work and queued items.
- Roadmap organizes selected work into phases or outcomes.
- Plan Pack breaks one selected slice into executable work units.
- Do not let Roadmap drift into work-unit detail.
- Do not let Plan Pack become the authoritative backlog or roadmap.

## Canonical Locations

For the selected repository root:
- Repository Backlog: `docs/backlog.md`
- Roadmaps: `docs/roadmaps/<slug>.md`

If `docs/roadmaps/` does not exist, create it only when roadmap work is actually requested.

Roadmap filenames should use lowercase kebab-case slugs, for example:
- `docs/roadmaps/platform-foundation.md`
- `docs/roadmaps/q2-delivery.md`

## Stable ID Rules

- Backlog item IDs use `RB-###`
- Roadmap item IDs use `RM-<roadmap-slug>-###`

Examples:
- `RB-001`
- `RM-platform-foundation-001`

Rules:
- IDs must remain stable after creation.
- Continue the highest existing sequence for the same artifact family.
- Never reuse or renumber existing IDs just to make the file look cleaner.
- The roadmap slug portion must match the roadmap filename slug.

## Linking Rules for Roadmap Sync

Automatic reconciliation depends on explicit linked IDs.

Required behavior:
1. Every roadmap item must explicitly list the backlog item IDs it covers.
2. When a Plan Pack is created from roadmap/backlog work, preserve the linked `RB-*` and `RM-*` IDs
   verbatim in the execution handoff.
3. Do not rely on heading text, timestamps, or prose-only association for linkage.
4. If explicit IDs are missing, treat the artifact as **not Roadmap Sync-ready** and say so directly.

## When to Use

Use this skill when the request is primarily about:
- adding or triaging work in the Repository Backlog
- creating a roadmap from selected backlog work
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
- stable `RB-*` and `RM-*` IDs
- explicit roadmap-to-backlog linkage
- clear separation between roadmap scope and plan-pack detail

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
- optional plan/session references once execution exists

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

## Phase 1

### RM-platform-foundation-001 - Example outcome
- Status: planned
- Covers Backlog IDs: RB-001
- Outcome: Short phased outcome statement.
- Plan Pack: none yet
```

These templates are guidance, not a frozen schema. The stable IDs and explicit links are the frozen
contract.

## Maintenance Workflow

1. Read the existing Repository Backlog and relevant roadmap file(s).
2. Decide whether the request belongs in backlog, roadmap, or future Plan Pack.
3. Allocate new IDs only where needed.
4. Add or repair explicit cross-links.
5. Keep wording concise and portfolio-level.
6. If the request is now execution-ready, stop and recommend a Plan Pack handoff rather than adding
   implementation detail here.

## Roadmap Sync Readiness Checklist

Before concluding backlog/roadmap work, confirm:
- every new roadmap item has an `RM-*` ID
- every linked backlog item has an `RB-*` ID
- roadmap items explicitly list covered backlog IDs
- any known plan/session references preserve the linked IDs verbatim
- missing IDs or broken links are called out explicitly instead of guessed

## Canonical References

- `docs/system/planning-backlog-roadmap-contract.md`
- `docs/system/session-state-artifacts.md`
- `engine-assets/skills/planpack-authoring/SKILL.md`
