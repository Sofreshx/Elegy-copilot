---
name: roadmap-authoring
description: "Canonical authoring and maintenance rules for Planning Bullets, Repository Backlog, and Roadmap artifacts, including Roadmap Sync-ready linked IDs and plan-pack handoff boundaries. Triggers on: planning bullets, repository backlog, roadmap, roadmap sync, roadmap item, backlog item, phased planning, planning portfolio."
---

# Roadmap Authoring

## Purpose

Author and maintain repo-backed planning artifacts that define **what matters next** before work is
decomposed into a Plan Pack.

This skill governs:
- **Planning Bullets** at `docs/planning/bullets.md` as the canonical pre-backlog seed surface
- the **Repository Backlog** under `docs/backlogs/*.md` as the primary artifact family
- `docs/backlog.md` as a legacy compatibility Repository Backlog surface
- **Roadmap** files at `docs/roadmaps/<slug>.md`
- the explicit ID/linking discipline required for future **Roadmap Sync** and direct plan handoff

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
- Planning Bullets: `docs/planning/bullets.md`
- Repository Backlog (primary): `docs/backlogs/<session-slug>.md`
- Repository Backlog (legacy compatibility): `docs/backlog.md`
- Roadmaps: `docs/roadmaps/<slug>.md`

Backlog filenames should use lowercase kebab-case session slugs, for example:
- `docs/backlogs/2026-04-03-session-close.md`
- `docs/backlogs/platform-audit-follow-up.md`

If `docs/roadmaps/` does not exist, create it only when roadmap work is actually requested.

Roadmap filenames should use lowercase kebab-case slugs, for example:
- `docs/roadmaps/platform-foundation.md`
- `docs/roadmaps/q2-delivery.md`

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
- Continue the highest existing sequence across the Repository Backlog artifact family (`docs/backlogs/*.md` plus legacy `docs/backlog.md` when present) or the targeted roadmap family.
- Never reuse or renumber existing IDs just to make the file look cleaner.
- The roadmap slug portion must match the roadmap filename slug.

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

1. Read the existing Repository Backlog artifact family (`docs/backlogs/*.md` first, `docs/backlog.md` when compatibility requires it) and relevant roadmap file(s).
2. Read `docs/planning/bullets.md` when the request starts from seed ideas or needs `PB-*` linkage.
3. Decide whether the request belongs in bullets, backlog, roadmap, or future Plan Pack.
4. Allocate new IDs only where needed.
5. Add or repair explicit cross-links.
6. Keep wording concise and portfolio-level.
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
- `engine-assets/skills/planpack-authoring/SKILL.md`
