---
created: 2026-02-23
updated: 2026-02-25
category: system
status: draft
doc_kind: node
id: planpack-spec
summary: Specification for the Plan Pack document format used by planning agents.
tags: [planpack, spec, planning]
---

# Plan Pack Specification

This document defines the canonical structure of an assembled Plan Pack — the output of `@o-planner` (or `@elegy-planner`) and the input consumed by `work-unit-runner` and `elegy-orchestrator`.

> **Scope**: This spec covers the **final assembled** plan pack only. Sub-planners (`@elegy-subplanner`) produce preliminary output that gets normalized by the planner during assembly; those intermediate forms are not specified here.

## Top-Level Heading Order

A conforming Plan Pack must contain the following top-level sections in this order:

```
# Plan Pack — <Title>
## Goal + Success Criteria
## Context Loaded
## Assumptions + Constraints
## Decisions
## Dropped / Deferred
## Work Unit Groups
## Work Unit Graph
## Work Unit Index
## Work Unit Specs
## Execution Notes
## Risks / Rollback
## Validation
```

All sections are required. Sections without content should retain the heading with a single `-` placeholder.

---

## Section Specifications

### `# Plan Pack — <Title>`

The H1 heading. `<Title>` is a short human-readable label for the plan (e.g., `Plan Pack — Auth Refactor`).

### `## Goal + Success Criteria`

- **Goal** — One-line statement of what the plan achieves.
- **Success Criteria** — Bullet list of 2+ measurable outcomes that define "done."

### `## Context Loaded`

Aliased in the template as `Context Loaded (exact files)`. A bullet list of exact file paths (repo-relative) that were read to produce the plan. This enables reproducibility audits.

### `## Assumptions + Constraints`

Bullet list of assumptions made during planning and any constraints that bound the solution space (e.g., "no breaking API changes", "must stay on .NET 9").

### `## Decisions`

Aliased in the template as `Decisions (with rationale)`. Bullet list of architectural or scoping decisions, each followed by a brief rationale. Decisions are immutable once the plan is approved.

### `## Dropped / Deferred`

Items considered but excluded from this plan, with reasons. Useful for traceability and future planning.

### `## Work Unit Groups`

A markdown table defining execution groups. Groups are the coarse scheduling unit.

| Column | Description |
| --- | --- |
| `Group` | Group ID (see naming conventions) |
| `Title` | Human-readable group name |
| `Depends On` | Comma-separated group IDs that must complete first, or empty |
| `Parallel Notes` | Free-text note on parallelism within the group |

### `## Work Unit Graph`

A markdown table that defines the dependency graph across all work units.

| Column | Description |
| --- | --- |
| `Group` | Group ID this WU belongs to |
| `Work Unit ID` | WU ID (see naming conventions) |
| `Title` | Short title matching the WU spec heading |
| `Depends On` | JSON array of WU IDs, e.g. `["WU-001"]`, or `[]` |
| `Next Units` | JSON array of WU IDs that depend on this WU, or `[]` |
| `Parallel Safe` | `yes` or `no` — whether this WU can run in parallel with siblings |

### `## Work Unit Index`

A lookup table mapping each WU to its spec heading for navigation.

| Column | Description |
| --- | --- |
| `Group` | Group ID |
| `Work Unit ID` | WU ID |
| `Title` | Short title |
| `Spec Heading` | Markdown heading reference, e.g. `### WU-001 — Auth handler` |

### `## Work Unit Specs`

Contains all individual work unit specifications as H3 subsections. See **Work Unit Spec Shape** below.

### `## Execution Notes`

Operational notes for the runner:
- The plan pack is **read-only** during execution. Progress is tracked in a separate Progress Tracker section (see [[session-state-artifacts]](docs/system/session-state-artifacts.md)).
- Each work unit is executed via `work-unit-runner`.

### `## Risks / Rollback`

Top-level risks and rollback strategy for the entire plan. Distinct from per-WU risks.

### `## Validation`

Default validation strategy applied after each group completes:
- Default: `unit-test-runner` after each group completes.
- Optional: integration/E2E tests only with user confirmation.

---

## Work Unit Spec Shape

Each work unit is an H3 section under `## Work Unit Specs` with the following structure:

### Heading

```
### WU-NNN — <Title>
```

Where `NNN` is a zero-padded three-digit number.

### Required Subsections

| Section | Heading | Description |
| --- | --- | --- |
| Context | `#### Context` | What the WU is about and why it exists. Provides enough background for an implementing agent to act without reading the full plan. |
| Acceptance Criteria | `#### Acceptance Criteria` | 2+ specific, verifiable criteria as a bullet list. Each criterion must be independently testable. |
| Plan / Approach | `#### Plan / Approach` | Concrete implementation steps. Must include repo-relative file paths where changes will be made. |
| Validation | `#### Validation` | Specific commands or checks that verify the WU is complete (e.g., `dotnet test`, `node scripts/validate-doc-graph.js`). |

### Optional Subsections

| Section | Heading | Description |
| --- | --- | --- |
| Expected Files | `#### Expected Files (optional)` | Explicit list of files to create or modify. |
| Risks / Notes | `#### Risks / Notes` | Edge cases, caveats, or known limitations. |

### Example

```markdown
### WU-003 — Add input validation to CreateUser handler

#### Context
The CreateUser handler currently accepts any payload. We need server-side validation
to enforce email format and password strength before persisting.

#### Acceptance Criteria
- Requests with invalid email return 400 with a structured error body.
- Requests with passwords shorter than 12 characters return 400.
- Valid requests continue to return 201 as before.

#### Plan / Approach
1. Add a `CreateUserValidator` in `src/Features/Users/CreateUserValidator.cs`.
2. Register the validator in DI (`src/Program.cs`).
3. Wire Wolverine's validation middleware to run before the handler.

#### Expected Files (optional)
- `src/Features/Users/CreateUserValidator.cs` (new)
- `src/Program.cs` (modify)

#### Validation
- `dotnet test --filter "CreateUser"` passes with new test cases.

#### Risks / Notes
- Password strength rules may need alignment with the frontend — confirm before merging.
```

---

## Naming Conventions

### Work Unit IDs

- Regex: `^WU-\d{3}$`
- Examples: `WU-001`, `WU-042`, `WU-100`
- IDs are globally unique within a plan pack. Numbering is sequential starting from `WU-001`.

### Group IDs

- Regex: `^G-\d{2}-[a-z0-9-]+$`
- Examples: `G-01-foundation`, `G-02-api-endpoints`, `G-03-ui`
- The numeric prefix determines execution order. The slug is descriptive.

---

## Progress Tracking

The Plan Pack itself is **read-only** after approval. Execution progress is tracked in a **Plan-Pack Progress Tracker** section appended to the session's `plan.md` file. See [[session-state-artifacts]](docs/system/session-state-artifacts.md) for the full Progress Tracker format, including:

- Work Unit Groups Overview table
- Work Unit Status table
- Next Unit pointer
- Checkpoint log

The progress tracker file is typically named `x-PLANPACK-PROGRESS-<SESSION_ID>.md` or appended directly to `plan.md` under a `# Plan-Pack Progress Tracker` heading.

### Final Gate Controls Contract (G-05-WU-05)

For versioned plan packs (`<!-- IE_PLAN_PACK_VERSION: 1 -->`), the progress tracker must include a parseable `## Final Gate Controls` markdown table.

Required columns:
- `Control`
- `Status`
- `Waiver Scope`
- `Waiver Release`
- `Waiver Audit`

Required control rows (exact control IDs):
- `evidencePredicates`
- `finalGateWaiverPrecedence`
- `trustedEvidenceBindingRetention`

Deterministic gate algorithm:
1. Each required control is evaluated independently.
2. A control passes only when `Status=passed` (or equivalent true marker).
3. If `Status=waived`, that control passes only when:
	- `Waiver Scope` explicitly includes that same control ID, and
	- both `Waiver Release` and `Waiver Audit` are non-empty.
4. Any required control that is missing, failed, or invalidly waived fails the final gate.

Waiver precedence and scope rules:
- Waivers apply only to controls explicitly listed in `Waiver Scope`.
- A waiver for one control must not imply waiver for any other required control.
- Scope mismatch is a hard validation error.

Audit linkage requirement:
- Every waiver use must include release-linked audit trail fields (`Waiver Release` + `Waiver Audit`) to maintain traceability.

---

## Validation Gate

### Default Behavior (OFF)
By default, no schema validation is performed on plan pack output. The dual-reviewer contract is the sole quality gate. Plan output is identical to today.

### Opt-In Behavior (ON)
When the following marker is present in the plan pack, the plan is validated against the v1 schema before submission to reviewers:

```
<!-- IE_PLANPACK_VALIDATE: true -->
```

### What Validation Checks
When opt-in is ON:
1. All 12 required H2 sections are present (see v1 Field Contract)
2. Each WU spec has required subsections (Context, Acceptance Criteria, Plan/Approach, Validation)
3. WU-ID format matches `^WU-\d{3}$`
4. Group-ID format matches `^G-\d{2}-[a-z0-9-]+$`
5. No orphan WUs (every WU in Graph appears in Specs and vice versa)
6. No duplicate WU-IDs

### What Validation Does NOT Check
- Content quality (that's the reviewers' job)
- Dependency cycle detection (best-effort; complex cycles require manual review)
- WU sizing or count limits

---

## Versioning

### Version Marker Format
The version marker is an HTML comment placed as the **second line** of the Plan Pack (immediately after the `# Plan Pack — <Title>` heading):

```
<!-- IE_PLAN_PACK_VERSION: 1 -->
```

### Parser Behavior
| Marker | Behavior |
|--------|----------|
| Missing (no marker) | v0 — best-effort parsing, no validation enforced |
| `<!-- IE_PLAN_PACK_VERSION: 1 -->` | v1 — validate against spec |
| Unknown version (> 1) | Warn and skip validation |

### v1 Field Contract
A v1 Plan Pack MUST contain all of the following H2 sections (in order):
1. `## Goal + Success Criteria`
2. `## Context Loaded`
3. `## Assumptions + Constraints`
4. `## Decisions`
5. `## Dropped / Deferred`
6. `## Work Unit Groups`
7. `## Work Unit Graph`
8. `## Work Unit Index`
9. `## Work Unit Specs`
10. `## Execution Notes`
11. `## Risks / Rollback`
12. `## Validation`

Each WU Spec (`### WU-NNN — <Title>`) MUST contain:
- `#### Context`
- `#### Acceptance Criteria` (≥ 2 items)
- `#### Plan / Approach`
- `#### Validation`

Optional WU Spec sections (may be omitted):
- `#### Expected Files`
- `#### Risks / Notes`

### Status Vocabulary
Use these exact lowercase values for all status fields:
- `not-started` — work not yet begun
- `in-progress` — currently being executed
- `done` — completed successfully
- `blocked` — cannot proceed
- `skipped` — intentionally skipped (with reason)
