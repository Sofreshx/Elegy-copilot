---
created: 2026-02-23
updated: 2026-05-25
category: system
status: draft
doc_kind: node
id: planpack-spec
summary: Specification for the Plan Pack document format used by planning agents.
tags: [planpack, spec, planning]
related: [goal-contract-governance, progressive-constraint-narrowing, adr-governance]
---

# Plan Pack Specification

This document defines the canonical structure of an assembled Plan Pack — the first top-level
document persisted in a session's `plan.md` artifact, produced by `@o-planner` or another
planner that writes persisted session-state artifacts, and consumed by orchestrator-managed
execution workflows.

> **Scope**: This spec covers the **final assembled** plan pack only. Sub-planning stages may
> produce preliminary output that gets normalized by the planner during assembly; those
> intermediate forms are not specified here.

In canonical persisted session state, `plan.md` contains two top-level markdown documents in sequence:

1. `# Plan Pack — <Title>`
2. `# Plan-Pack Progress Tracker`

This document specifies the Plan Pack portion. The Progress Tracker portion is defined by [[session-state-artifacts]]
[session-state-artifacts.md](session-state-artifacts.md). Separate
`x-PLANPACK-PROGRESS-<SESSION_ID>.md` files are legacy compatibility artifacts only and are not the canonical
persisted layout for fresh plans.

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
These 12 H2 sections define the Plan Pack portion only; in persisted session state, the combined `plan.md`
continues after `## Validation` with a separate `# Plan-Pack Progress Tracker` document.

---

## Section Specifications

### `# Plan Pack — <Title>`

The H1 heading. `<Title>` is a short human-readable label for the plan (e.g., `Plan Pack — Auth Refactor`).

### `## Goal + Success Criteria`

- **Goal** — One-line statement of what the plan achieves.
- **High-Level Goals** — Explicit bullet list of intended outcomes used as the planning intent surface
  for end-of-execution goal assessment.
- **Success Criteria** — Bullet list of 2+ measurable outcomes that define "done."

High-level goal completion states are governed by [[goal-contract-governance]]
[goal-contract-governance.md](goal-contract-governance.md), using
`complete`, `partial`, and `not-complete`.

Canonical `High-Level Goals` bullet syntax:

- Each bullet must use `- <completion-state> — <goal text>`.
- `<completion-state>` must be exactly one of `complete`, `partial`, or `not-complete`.
- Use a literal em dash (`—`) between the state token and the goal text.
- Fresh plans default every high-level goal bullet to `not-complete`.
- `partial` is reserved for carried in-flight work from a resumed/replanned session; do not use it for untouched fresh-plan goals.

Example:

```markdown
- not-complete — Land the Session Intent Frame prompt updates in orchestrator and reviewer contracts.
- not-complete — Preserve chat-first closure behavior without introducing a new required artifact.
```

### `## Context Loaded`

Aliased in the template as `Context Loaded (exact files)`. A bullet list of exact file paths (repo-relative) that were read to produce the plan. This enables reproducibility audits.

### `## Assumptions + Constraints`

Bullet list of assumptions made during planning and any constraints that bound the solution space (e.g., "no breaking API changes", "must stay on .NET 9").

Rules:

- Narrow broad candidate constraints into the minimum authoritative set needed for the active plan.
- Keep unresolved branches out of the constraint list; those belong in assumptions, blockers, or user questions.
- If a constraint is really a durable architectural or workflow-authority decision, do not leave it only inside the plan pack. Promote or reference the owning canonical node or ADR.

### `## Decisions`

Aliased in the template as `Decisions (with rationale)`. Bullet list of architectural or scoping decisions, each followed by a brief rationale. Decisions are immutable once the plan is approved.

Key architectural, trust-boundary, workflow-authority, or long-lived contract decisions that future work will rely on should be checked against [[adr-governance]] [adr-governance.md](adr-governance.md) instead of staying only inside the plan pack.

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

Contract rules:
- `Depends On` and `Next Units` must remain parseable JSON arrays in the assembled plan pack.
- `Parallel Safe = yes` is reserved for WUs that do not rely on sibling ordering, do not mutate shared state that needs sequencing, and do not contend on the same expected files or ownership boundary.
- Any WU marked `Parallel Safe = yes` must declare an `Expected Files` subsection in its WU spec so executors can reason about file ownership before fan-out.

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
- The plan pack is **read-only** during execution. Progress is tracked in the appended `# Plan-Pack Progress Tracker`
  document within the same `plan.md` artifact (see [[session-state-artifacts]]
  [session-state-artifacts.md](session-state-artifacts.md)).
- Each work unit is executed via `@impl` or another orchestrator-selected implementation lane.

### `## Risks / Rollback`

Top-level risks and rollback strategy for the entire plan. Distinct from per-WU risks.

### `## Validation`

Default validation strategy applied after each group completes:
- Default: `@test-runner` after each group completes.
- Integration and E2E may be mandatory even without an explicit user request when repo policy or
  current risk/coverage requires them.
- The plan should state the validation requirement basis clearly enough that executors can tell what
  is mandatory versus nice-to-have.
- Agent-driven browser validation routes through `@test-runner` when browser/E2E coverage is
  required, using the appropriate runtime/tooling for that repo.
- Durable scripted browser suites use Playwright CLI/test runner.

See [[validation-governance]] [validation-governance.md](validation-governance.md)
for the canonical decision matrix.

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
| Validation | `#### Validation` | Specific commands or checks that verify the WU is complete (e.g., `dotnet test`, `node scripts/validate-doc-graph.js`). When integration or E2E is mandatory for the slice, say so explicitly and include the requirement basis. |

### Optional Subsections

| Section | Heading | Description |
| --- | --- | --- |
| Expected Files | `#### Expected Files (optional)` | Explicit list of files to create or modify. Required when the WU is marked `Parallel Safe = yes` in the Work Unit Graph. |
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

### Parallel-Safe Ownership Rule

If a WU is marked `Parallel Safe = yes`, its `#### Expected Files` subsection must enumerate the concrete file paths or directory ownership boundaries it expects to touch. Sibling WUs in the same group may run concurrently only when those ownership declarations are disjoint or an explicit merge strategy is documented elsewhere in the plan.

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

The Plan Pack itself is **read-only** after approval. Execution progress is tracked in a separate
`# Plan-Pack Progress Tracker` document appended to the same session `plan.md` file. See
[[session-state-artifacts]] [session-state-artifacts.md](session-state-artifacts.md)
for the full Progress Tracker format, including:

- Work Unit Groups Overview table
- Work Unit Status table
- Next Unit pointer
- Checkpoint log

Dedicated `x-PLANPACK-PROGRESS-<SESSION_ID>.md` files are legacy/non-canonical compatibility inputs only.
Fresh planning output should persist the tracker in `plan.md` under a `# Plan-Pack Progress Tracker` heading.

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

### Stream Evidence Predicate Contract

For versioned planpacks (`<!-- IE_PLAN_PACK_VERSION: 1 -->`), required stream IDs are derived from `## Work Unit Groups Overview` in the Progress Tracker.

Normalization:
- Group values are normalized to `G-NN` stream tokens (for example `G-06-release-readiness` → `G-06`).

Pass requirement for each derived stream token:
1. `## Execution Log` contains completion evidence for that stream (`completed`, `done`, or `status: passed`), and
2. `## Stream Evidence` contains a row for that stream with passed status and non-empty `Evidence`.

Missing either signal for any required stream is a deterministic validation failure.

---

## Validation Gate

### Enforcement Behavior
Validation is phase-aware:

- `scripts/validate-planpack-planning.js` enforces the v1 planning schema for fresh plans. It validates the plan pack structure, WU shape, AC quality mode, and the base progress-tracker sections required before execution starts.
- `scripts/validate-planpack-execution.js` enforces execution-time progress, evidence, and final-gate contracts for versioned planpacks.
- `scripts/validate-planpack.js` remains a migration-only compatibility entrypoint for legacy callers that have not yet moved to the phase-specific validators.

Fail-closed defaults:
- Missing `IE_PLAN_PACK_VERSION` marker fails validation.
- Unsupported marker version fails validation.

Explicit compatibility override:
- `--allow-legacy-best-effort` allows a missing version marker for migration-only legacy plans; do not use it for normal v1 validation flows.

### What Validation Checks
Planning validation (`validate-planpack-planning.js`) checks:
1. All 12 required H2 sections are present (see v1 Field Contract)
2. Each WU spec has required subsections (Context, Acceptance Criteria, Plan/Approach, Validation)
3. WU-ID format matches `^WU-\d{3}$`
4. Group-ID format matches `^G-\d{2}-[a-z0-9-]+$`
5. No orphan WUs (every WU in Graph appears in Specs and vice versa)
6. No duplicate WU-IDs
7. Base progress-tracker sections required for planning-time resume/bootstrap are present

Execution validation (`validate-planpack-execution.js`) additionally checks:
1. All 12 required H2 sections are present (see v1 Field Contract)
2. Each WU spec has required subsections (Context, Acceptance Criteria, Plan/Approach, Validation)
3. WU-ID format matches `^WU-\d{3}$`
4. Group-ID format matches `^G-\d{2}-[a-z0-9-]+$`
5. No orphan WUs (every WU in Graph appears in Specs and vice versa)
6. No duplicate WU-IDs
7. Required stream evidence predicates for all streams derived from `Work Unit Groups Overview`
8. Final gate control rows (`evidencePredicates`, `finalGateWaiverPrecedence`, `trustedEvidenceBindingRetention`) with waiver scope/audit semantics
9. Trusted evidence binding + evidence retention checks when `trustedEvidenceBindingRetention` is passed

The legacy `validate-planpack.js` entrypoint still invokes the same full execution/final-gate rules, but only as a migration-only compatibility path.

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
| Missing (no marker) | fail-closed (unless explicit migration-only `--allow-legacy-best-effort`) |
| `<!-- IE_PLAN_PACK_VERSION: 1 -->` | v1 — validate against spec |
| Unknown version (> 1) | fail-closed (unsupported version) |

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
