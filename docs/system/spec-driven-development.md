---
created: 2026-05-21
updated: 2026-06-14
category: system
status: current
doc_kind: node
id: spec-driven-development
summary: Canonical contract for spec-driven development, durable repo specs under docs/specs/, and the shared spec authoring and review skills.
tags: [specs, planning, validation, skills, elegy-planning, handoff]
related: [workflow-planning-contract, validation-governance]
---

# Spec-Driven Development

## Purpose

Define the shared v1 contract for spec-driven development in `elegy-copilot`.

This layer complements existing Plan Pack, roadmap, review, and validation assets. It does not
replace them, and it does not introduce a new orchestrator fleet.

## Positioning

- Use spec-driven development when the work needs a tighter requirements contract before planning or implementation.
- Default durable repo specs live under `docs/specs/`.
- `elegy-planning` is the durable execution and roadmap authority. Specs define requirements; plans define execution.
- Keep implementation review and validation in the existing review and validation lanes.
- Physical spec archiving (moving specs to an archive folder) is not the default. Specs are the permanent requirements record.

## Artifact Roles

Specs describe intent. Docs describe state. ADRs record decisions.

| Artifact | Mode | Describes | Answers |
|----------|------|-----------|---------|
| Spec | Intent | What the system should do (requirements) | "What should it do?" |
| Canonical doc | State | How the system currently works | "How does it work?" |
| ADR | Decision state | What architectural decision was made | "Why this way?" |

Drift measures divergence between spec intent and implementation state.

## Repo Setup Integration

- Shared spec skills install globally per harness as always-available skills; load them into active context only when the current step needs spec-driven guidance.
- Repo-local spec bootstrap is opt-in per selected repo through the existing harness installers.
- Repo-local spec bootstrap now shells through `elegy configuration apply`, so Phase 1 examples should pass `--elegy-cli <path>` explicitly.
- `INSTRUCTION_ENGINE_ELEGY_CLI_PATH` is a convenience fallback for repeated local runs, but it is not the primary documented invocation.
- Use `--repo-root <path> --setup-profile spec-driven --elegy-cli <path>` with the Codex, OpenCode, or Antigravity installer when a repo should opt into durable spec scaffolding.
- The approved `spec-driven` bootstrap adds bounded repo-local instruction overlays, `docs/specs/index.md`, the repo-local spec validator, and the selected harness's repo-skill mirrors.
- This exists to make spec-driven work easy to opt into without introducing a separate runtime, planner fleet, or second spec contract.

## Repository Spec Contract

Default durable spec path:

- `docs/specs/<spec-slug>/spec.md`

Optional catalog:

- `docs/specs/index.md`

Required frontmatter keys:

- `spec_id`
- `title`
- `status`
- `type`
- `updated`

Allowed `status` values:

- `draft`
- `approved`
- `implemented`
- `superseded`
- `abandoned`

Allowed `type` values:

- `feature`
- `workflow`
- `contract`
- `skill`
- `agent`
- `migration`

Required headings:

- `Intent`
- `Context Evidence`
- `Requirements`
- `Non-Goals`
- `Acceptance Checks`
- `Implementation Links`
- `Validation Evidence`
- `Drift Notes`

Recommended template:

```markdown
---
spec_id: auth-session-refresh
title: Auth Session Refresh Contract
status: draft
type: feature
updated: 2026-05-21
---

# Auth Session Refresh Contract

## Intent

Define the durable product and implementation contract for session refresh behavior.

## Context Evidence

- `docs/system/auth-architecture-adr.md`: current auth boundaries
- `src/auth/session.ts`: current refresh behavior

## Requirements

- Refresh before expiry when a valid refresh token exists.
- Preserve current login behavior for valid sessions.

## Non-Goals

- No auth provider migration.
- No UI redesign.

## Acceptance Checks

- Expired access tokens refresh without forcing re-login when the refresh token is valid.
  → verify: `npm test -- --grep "session refresh"`
- Invalid refresh tokens force the existing signed-out path.
  → verify: `npm test -- --grep "invalid refresh token"`

## Implementation Links

- `src/auth/session.ts`
- `src/auth/session.test.ts`

## Validation Evidence

- Pending implementation.

## Drift Notes

- None.
```

## Spec Lifecycle

Durable specs follow a predictable lifecycle. The `status` field is the primary lifecycle indicator; optional date keys provide timestamps for transitions.

| Status | Meaning | Typical next status | Required metadata |
|---|---|---|---|
| `draft` | Spec is being authored, content is provisional | `approved` or superseded by another spec | Required frontmatter only |
| `approved` | Spec has passed review and is ready to anchor planning | `implemented` or `superseded` | `approved_at` recommended |
| `implemented` | Requirements have been met, acceptance checks pass. Spec remains as the permanent requirements record (intent realized, not state). | `superseded` (if replaced) or remains | `implemented_at` recommended; `Validation Evidence` must be non-empty |
| `superseded` | Spec is replaced by a newer spec | terminal | `superseded_by` required; `superseded_at` recommended |
| `abandoned` | Reviewed decision not to implement the spec | terminal | `abandoned_at` recommended; must not set `superseded_by` |

Optional date keys (`created`, `approved_at`, `implemented_at`, `superseded_at`, `abandoned_at`) are validated as ISO-8601 dates when present but are not required for structural compliance. The validator will warn if they are present with invalid format.

Optional hardening keys: `freshness: ignore` (skips staleness warnings), `liveness_skip_paths` (list of path patterns to skip in liveness checks).

## Pre-Commit Hook

Run `node scripts/install-spec-hooks.mjs` once to install a pre-commit gate that validates specs before commit. The hook runs `validate-specs.js --strict docs/specs` whenever spec files are staged. Set `SKIP_SPEC_CHECK=1` to bypass.

## Spec Relationships

Specs can declare relationships via frontmatter keys:

- `supersedes: <spec_id>` — this spec replaces another spec. Use when a new spec renders an existing spec obsolete.
- `superseded_by: <spec_id>` — this spec is replaced by another spec. **Required** when `status: superseded`.

Rules:
- Do not set both `supersedes` and `superseded_by` in the same spec (validator enforces).
- The referenced spec ID should match the `spec_id` of another spec in the repo.
- For non-authoritative relationships (related but not superseding), use `Drift Notes` or `Context Evidence` prose.

## Spec Retention Rules

Durable specs are the permanent requirements record. Do not physically archive or move them to a separate folder.

### Retention by Status

| Status | Retention rule |
|---|---|
| `draft` | Review after 90 days of inactivity. Promote to `approved`, move to `abandoned` (if not implementing), or update content. |
| `approved` | Must link to an active plan or work point. Review if unlinked for >180 days. |
| `implemented` | Retained permanently. Update `Drift Notes` if behavior changes. |
| `superseded` | Retained permanently with `superseded_by`. |
| `abandoned` | Retained permanently as a record of a reviewed decision not to implement. Must not have `superseded_by` (abandoned ≠ replaced). |

### Deletion Rules

Delete a spec only when ALL of these conditions are true:
1. The spec was an accidental duplicate (identical spec_id or intent as another spec).
2. The spec has status `draft`.
3. The spec has no `Implementation Links`, no `Validation Evidence`, and no planning links.

Never delete `approved`, `implemented`, `superseded`, or `abandoned` specs without explicit approval.

## Spec Freshness Policy

The validator produces advisory warnings for staleness:

- **Draft specs** older than 90 days: [WARN] stale draft.
- **Approved specs** older than 180 days: [WARN] stale approved spec (must link to active plan/work point or be reviewed).
- **Implemented specs** older than 180 days: [WARN] stale implemented spec (review for drift).
- **Abandoned specs**: no staleness warnings (terminal status).
- **Superseded specs**: no staleness warnings (terminal status).

Freshness is advisory, not structural. The validator does not enforce time limits. Use `freshness: ignore` in frontmatter to suppress warnings for intentional exceptions.

## Spec-to-Planning Handoff

Specs are the durable requirements contract. `elegy-planning` is the durable execution and roadmap authority. They complement each other without merging.

When a spec reaches `approved` status, the project lane picks it up for implementation via the `spec-planning-bridge` skill:

| Role | Owner | Artifact |
|---|---|---|
| Requirements | spec-authoring skill | `docs/specs/<slug>/spec.md` |
| Execution planning | project lane | `elegy-planning` roadmap → plan → work points |
| Implementation | project lane | Code changes + validation evidence |

### Handoff Contract

1. The `approved` spec must have a `spec_id`.
2. The project plan or work point must reference the spec via a **file-scope selector**: `exact:primary:docs/specs/<spec-slug>/spec.md`.
3. Alternatively, record an explicit `planning_insight_record` with `insightType: 'spec-link'` linking the plan to the spec path.
4. If the implementation uses a `plan.md` alongside the spec, the `plan.md` must reference the spec's file path.

### Validation

Run `node scripts/validate-specs.js --strict docs/specs` to verify structural integrity. The spec-review skill checks for the handoff link during review.

## When to Write a plan.md

Not every spec needs a sibling `plan.md`. Write one when:

- The spec has 5 or more requirements.
- The implementation requires 2 or more phases.
- The work involves 2 or more owners.

The `plan.md` lives alongside `spec.md` at `docs/specs/<slug>/plan.md` and contains the execution plan (implementation order, risk assessment, validation steps). See existing examples in the `docs/specs/` directory.

## ADR Promotion

If a spec describes a key architectural decision, workflow-authority boundary, trust model, or long-lived contract change, promote that decision into an ADR under `docs/adr/` rather than leaving it only inside the spec. ADRs are the permanent record for architecture decisions; specs are the permanent record for requirements.

Link from the spec's `Context Evidence` to the ADR file. The spec-review skill checks for this when the spec's scope warrants it.

## Operating Model

### Spec-First

Use `spec-first` for short-lived clarification before normal planning.

- Prefer this when the main problem is ambiguous requirements, boundaries, or acceptance language.
- Do not create a durable repo spec by default for trivial work.
- Promote to a durable spec only when the work is non-trivial or the user explicitly wants a spec artifact.

### Spec-Anchored

Use `spec-anchored` for durable repo features, workflows, contracts, skills, agents, or migrations.

- Write or update `docs/specs/<spec-slug>/spec.md`.
- Optionally maintain `docs/specs/index.md` when the repo has enough durable specs to justify a catalog.
- Hand the approved spec to the normal planning and implementation lanes after review.

### Spec-As-Source

Use `spec-as-source` only when the spec is the canonical declarative source and other artifacts are
projections.

Allowed examples:

- schemas
- fixtures
- workflow definitions
- capability manifests
- generated projections

Do not use `spec-as-source` for general application code, open-ended implementation notes, or a new
planner abstraction.

> **Note:** In spec-as-source mode, the spec IS the canonical state — code is generated from it. This is the exception to the general rule that specs describe intent. Use only when the spec is the single source of truth and other artifacts are projections.

## Workflow

1. Use the `spec-dev` skill to choose `spec-first`, `spec-anchored`, or `spec-as-source`.
2. Use `spec-authoring` to create or refine the durable spec when the work is spec-anchored or spec-as-source. The authoring gate must pass (context evidence, allowed/forbidden behavior, verifiable acceptance checks).
3. Use `spec-review` before implementation planning when the spec should drive later work.
4. Use `spec-planning-bridge` to link the approved spec to an `elegy-planning` roadmap or plan via `exact:primary:docs/specs/<spec-slug>/spec.md` file-scope selector.
5. Move into the project lane after the handoff is complete.

## Specs Location

Specs live under `docs/specs/<spec-slug>/spec.md` as a governed spec family within the canonical `docs/` knowledge root. They are validated by the separate `scripts/validate-specs.js` validator (not by the doc-graph validator). The optional catalog is `docs/specs/index.md`.

Pre-commit spec validation is installed via `node scripts/install-spec-hooks.mjs` and gates on staged `docs/specs/<slug>/spec.md` files.

## Validation

### Reliability Layers

The spec validation system operates in four layers, from fastest (local) to most authoritative (human review):

1. **Validator** (`scripts/validate-specs.js`) — Structural, liveness, cross-spec, freshness, and plan.md checks. Runs locally and in CI.
2. **Pre-commit hook** (`scripts/validate-specs-precommit.mjs`) — Gate on staged spec files. Installed via `scripts/install-spec-hooks.mjs`.
3. **CI gate** (`.github/workflows/repo-ci.yml`) — Validates all specs on every push. Blocks broken specs from merging.
4. **Reviewer** (`catalog-assets/shared-skills/spec-review/SKILL.md`) — Human adversarial review before implementation planning. Catches semantic issues automation cannot.

Each layer is additive — a spec must pass all four to be considered implementable.

- Prefer the repo-local validator when present: `node scripts/validate-specs.js <spec-root>`.
- The v1 validator checks frontmatter keys and enums (including `abandoned`), required headings, non-empty `Intent`, at least two `Acceptance Checks`, and `Validation Evidence` when `status: implemented`.
- The spec validator now includes freshness warnings (90-day draft, 180-day approved, 180-day implemented, terminal abandoned/superseded), index integrity checks, cross-spec reference validation, and plan.md requirement checks — all under `--strict` mode.
- **CI Gate:** The `validate:specs` CI step runs `validate-specs.js --strict docs/specs` in GitHub Actions on every push. Broken specs are rejected before merge.
- Validation is evidence that the spec matches the contract shape, not proof that the implementation is correct.

## Boundaries

- Not every task needs a durable spec.
- Specs are durable repo artifacts for non-trivial work or explicit spec requests.
- Plan packs and roadmap artifacts remain authoritative for execution planning and multi-session planning.
- `spec-as-source` is narrow and declarative by design.
