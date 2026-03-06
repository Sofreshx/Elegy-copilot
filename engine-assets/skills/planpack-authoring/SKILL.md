---
name: planpack-authoring
description: "Plan-pack schema, progress tracker format, and quality gate rules for producing execution plans. Triggers on: plan pack, plan-pack, progress tracker, execution plan schema, plan quality gate."
---

# Plan-Pack Authoring

## Identifiers
- SESSION_ID: `YYYYMMDD_HHMMSS_RAND4` (e.g., `20260216_135012_4831`)
- WU-ID: `WU-NNN` (zero-padded, sequential)
- Group-ID: `G-NN-slug` (zero-padded, lowercase slug)
- Status values (strict lowercase): `not-started`, `in-progress`, `done`, `blocked`, `skipped`
- Session Status: `active` | `paused` | `done`

## Plan Pack Required Sections (in order)
1. Goal + Success Criteria
2. Context Loaded
3. Assumptions + Constraints
4. Decisions
5. Dropped / Deferred — each bullet: idea, why dropped, safe to revisit?
6. Work Unit Groups
7. Work Unit Graph — columns: Group | WU ID | Title | Depends On | Next Units | Parallel Safe
8. Work Unit Index — columns: Group | WU ID | Title | Spec Heading
9. Work Unit Specs (one H3 per WU)
10. Execution Notes
11. Risks / Rollback
12. Validation

## WU Spec Required Sub-Sections
Each WU spec (H3) must contain: Context, Acceptance Criteria (≥2 specific verifiable), Plan/Approach (concrete file paths), Expected Files, Validation (specific commands), Risks/Notes.

## Progress Tracker Required Sections
1. Session Metadata
2. Work Unit Groups Overview — columns: Group | Title | Status | WUs Done | WUs Total | Depends On
3. Work Unit Status Table — columns: Group | WU ID | Status | Next Unit | Notes
4. Next Unit — WU ID + 1-line rationale; `NONE — all complete` when finished
5. Checkpoints — columns: Group | Checkpoint | Trigger | Notes
6. Execution Log

## Phase-Aware Validation
- Planning phase validator: `node scripts/validate-planpack-planning.js <plan.md> --ac-enforcement fail`
- Execution/final-gate validator: `node scripts/validate-planpack-execution.js <plan.md>`
- Compatibility/full validator: `node scripts/validate-planpack.js <plan.md>`

Planning-time plans must include the base progress tracker sections above, but they do **not** need execution-only sections like Stream Evidence, Final Gate Controls, Trusted Evidence Binding, or Evidence Retention until execution/finalization.

## Checkpoint Defaults
- `unit-test-runner` after each group completes
- Final integration/E2E checkpoint (user-confirmed, never automatic)
- Optional `doc-update` checkpoint (routes to doc-writer; status: passed|failed|skipped)

## Progressive Refinement
- Phase 1 (skeleton): goal + criteria final, WU groups preliminary, specs as heading + context only
- Phase 2 (refined): full specs with file paths, finalized dependency graph, risks + validation

## WU Sizing
- Too small: single import or one-line change (merge into parent WU)
- Right size: implementable in one work-unit-runner pass (e.g., "Add UserService with CRUD endpoints")
- Too large: multi-concern scope (e.g., "Implement entire auth system" — split it)

## Quality Gate (7 checks)
1. Every WU has ≥2 specific, verifiable acceptance criteria
2. Every WU references concrete file paths (no placeholders)
3. Every WU has concrete validation steps
4. No generic boilerplate ("ensure quality", "follow best practices")
5. Work unit graph has no orphan WUs
6. Checkpoints reference valid group milestones
7. Group dependencies are acyclic

If any check fails, add a `## Plan Quality Warnings` section listing gaps.
