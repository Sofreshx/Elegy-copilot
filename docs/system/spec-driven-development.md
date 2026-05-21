---
created: 2026-05-21
updated: 2026-05-21
category: system
status: current
doc_kind: node
id: spec-driven-development
summary: Canonical contract for spec-driven development, durable repo specs under specs/, and the shared spec authoring and review skills.
tags: [specs, planning, validation, skills]
related: [workflow-planning-contract, validation-governance]
---

# Spec-Driven Development

## Purpose

Define the shared v1 contract for spec-driven development in `instruction-engine`.

This layer complements existing Plan Pack, roadmap, review, and validation assets. It does not
replace them, and it does not introduce a new orchestrator fleet.

## Positioning

- Use spec-driven development when the work needs a tighter requirements contract before planning or implementation.
- Default durable repo specs live under `specs/`.
- Keep execution planning in the existing plan-pack and roadmap lanes.
- Keep implementation review and validation in the existing review and validation lanes.

## Repo Setup Integration

- Shared spec skills install globally per harness and stay on-demand.
- Repo-local spec bootstrap is opt-in per selected repo through the existing harness installers.
- Use `--repo-root <path> --setup-profile spec-driven` with the Codex, OpenCode, or Antigravity installer when a repo should opt into durable spec scaffolding.
- The approved `spec-driven` bootstrap adds bounded repo-local instruction overlays, `specs/index.md`, the repo-local spec validator, and the selected harness's repo-skill mirrors.
- This exists to make spec-driven work easy to opt into without introducing a separate runtime, planner fleet, or second spec contract.

## Repository Spec Contract

Default durable spec path:

- `specs/<spec-slug>/spec.md`

Optional catalog:

- `specs/index.md`

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
- Invalid refresh tokens force the existing signed-out path.

## Implementation Links

- `src/auth/session.ts`
- `src/auth/session.test.ts`

## Validation Evidence

- Pending implementation.

## Drift Notes

- None.
```

## Operating Model

### Spec-First

Use `spec-first` for short-lived clarification before normal planning.

- Prefer this when the main problem is ambiguous requirements, boundaries, or acceptance language.
- Do not create a durable repo spec by default for trivial work.
- Promote to a durable spec only when the work is non-trivial or the user explicitly wants a spec artifact.

### Spec-Anchored

Use `spec-anchored` for durable repo features, workflows, contracts, skills, agents, or migrations.

- Write or update `specs/<spec-slug>/spec.md`.
- Optionally maintain `specs/index.md` when the repo has enough durable specs to justify a catalog.
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

## Workflow

1. Use the `spec-dev` skill to choose `spec-first`, `spec-anchored`, or `spec-as-source`.
2. Use `spec-authoring` to create or refine the durable spec when the work is spec-anchored or spec-as-source.
3. Use `spec-review` before implementation planning when the spec should drive later work.
4. Move into the existing plan-pack, roadmap, implementation, review, and validation lanes after the spec is ready.

## Validation

- Prefer the repo-local validator when present: `node scripts/validate-specs.js <spec-root>`.
- The v1 validator checks frontmatter keys and enums, required headings, non-empty `Intent`, at least two `Acceptance Checks`, and `Validation Evidence` when `status: implemented`.
- Validation is evidence that the spec matches the contract shape, not proof that the implementation is correct.

## Boundaries

- Not every task needs a durable spec.
- Specs are durable repo artifacts for non-trivial work or explicit spec requests.
- Plan packs and roadmap artifacts remain authoritative for execution planning and multi-session planning.
- `spec-as-source` is narrow and declarative by design.
