---
name: spec-authoring
description: "Create or refine a durable repo spec under specs/<spec-slug>/spec.md using the shared contract. Use when work should be spec-anchored or spec-as-source and needs a concrete spec artifact before implementation planning. Triggers on: author a spec, create a spec, refine spec.md, specs template, specs folder, durable repo spec."
metadata: {"tags":["specs","authoring","requirements","contracts"]}
---

# Spec Authoring

## Purpose

Create or refine `specs/<spec-slug>/spec.md` using the shared v1 contract.

## Contract

Default durable path:

- `specs/<spec-slug>/spec.md`

Optional catalog:

- `specs/index.md`

Required frontmatter:

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

## Authoring Rules

- Keep the spec durable and repo-grounded.
- Use exact file paths, commands, docs, tests, or runtime evidence in `Context Evidence` when available.
- Keep `Intent` specific and non-empty.
- Write at least two observable `Acceptance Checks`.
- Keep `Non-Goals` explicit near likely scope-creep edges.
- Use `Implementation Links` for code, docs, plans, PRs, or tickets that materially connect to the spec.
- When `status: implemented`, `Validation Evidence` must contain real evidence, not a placeholder.
- Use `Drift Notes` to record deviations, follow-up reconciliation, or `none`.
- Do not treat a spec as the permanent home for a key architectural or workflow-authority tradeoff when that decision should be promoted into an ADR.

## Minimal Workflow

1. Derive a stable spec slug and `spec_id` from the durable subject.
2. Read the smallest relevant repo evidence before writing requirements.
3. Create or refine `specs/<spec-slug>/spec.md`.
4. Update `updated` with the current date.
5. Run the repo-local spec validator when available.
6. If implementation will depend on the spec, hand it to `spec-review` before planning.

## Template

```markdown
---
spec_id: <stable-id>
title: <Spec Title>
status: draft
type: feature
updated: YYYY-MM-DD
---

# <Spec Title>

## Intent

<one compact paragraph or bullet list>

## Context Evidence

- `<path or command>`: <why it matters>

## Requirements

- <durable requirement>

## Non-Goals

- <out-of-scope item>

## Acceptance Checks

- <observable check>
- <observable check>

## Implementation Links

- <path, PR, plan, or none yet>

## Validation Evidence

- <evidence, pending, or none yet>

## Drift Notes

- <drift note or none>
```

## Validation

- Prefer `node scripts/validate-specs.js <spec-root>` when the repo carries the shared validator.
- Fix contract issues before moving to implementation planning.

## Output Contract

Use this format:

```text
SPEC_AUTHORING_RESULT
- spec_path: <path>
- status: created | updated | needs-input
- open_questions:
  - <question or none>
- validation:
  - <command or gap>
```
