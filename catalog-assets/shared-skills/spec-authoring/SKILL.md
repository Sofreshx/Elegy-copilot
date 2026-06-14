---
name: spec-authoring
description: "Create or refine a durable repo spec under docs/specs/<spec-slug>/spec.md using the shared contract. Use when work should be spec-anchored or spec-as-source and needs a concrete spec artifact before implementation planning. Triggers on: author a spec, create a spec, refine spec.md, specs template, specs folder, durable repo spec."
metadata: {"tags":["specs","authoring","requirements","contracts"]}
---

# Spec Authoring

## Contract

Default durable path:

- `docs/specs/<spec-slug>/spec.md`

Optional catalog:

- `docs/specs/index.md`

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

## Authoring Rules

- Keep the spec durable and repo-grounded.
- Use exact file paths, commands, docs, tests, or runtime evidence in `Context Evidence` when available.
- Keep `Intent` specific and non-empty.
- Write at least two `Acceptance Checks`, each with a concrete verification method using the `→ verify:` marker (indented 2 spaces, immediately following the bullet, non-empty content).
- Keep `Non-Goals` explicit near likely scope-creep edges.
- Use `Implementation Links` for code, docs, plans, PRs, or tickets that materially connect to the spec.
- When `status: implemented`, `Validation Evidence` must contain real evidence, not a placeholder.
- Use `Drift Notes` to record deviations, follow-up reconciliation, or `none`.
- Do not treat a spec as the permanent home for a key architectural or workflow-authority tradeoff when that decision should be promoted into an ADR.
- Use the per-type templates under `docs/specs/_templates/` when the default template does not match your `type`.

### Authoring Gate

Before creating `docs/specs/<spec-slug>/spec.md`, the authoring session must establish:

1. **Context evidence**: concrete file paths, commands, docs, or runtime data that justify the spec.
2. **Allowed Behavior**: what the system should do under the spec's requirements.
3. **Forbidden Behavior**: what the system must not do — boundary conditions, error states, and excluded paths.
4. **Verifiable acceptance checks**: at least two checks with concrete `→ verify:` lines.

Do not create a durable spec without all four gates passed. If evidence is insufficient, pause and gather more before authoring.

### Spec Link Conventions

Durable specs can declare relationships via frontmatter keys:

- `supersedes: <spec_id>` — this spec replaces another spec.
- `superseded_by: <spec_id>` — this spec is replaced by another spec. Required when `status: superseded`.
- If your spec is related to another but does not supersede or get superseded by it, mention the relationship in `Drift Notes` or `Context Evidence`.

Do not set both `supersedes` and `superseded_by` in the same spec.

### Spec Readiness Checklist

Before handing a spec to `spec-review`, confirm:

- [ ] Frontmatter: all 5 required keys present, valid status and type, valid ISO date.
- [ ] All 8 required headings present and non-empty.
- [ ] Intent is a specific, non-empty description of the problem or opportunity.
- [ ] Context Evidence lists concrete file paths, commands, tests, or runtime data with reasons.
- [ ] Requirements are unambiguous and testable.
- [ ] Allowed Behavior and Forbidden Behavior subsections are present and concrete.
- [ ] Non-Goals cover likely scope-creep edges.
- [ ] Each Acceptance Check has a `→ verify:` line with a concrete command or manual step.
- [ ] Implementation Links list every file, test, or plan that the spec will touch.
- [ ] Validation Evidence is populated (required for `implemented` status).
- [ ] Drift Notes captures any deviation or follow-up, or says "None."
- [ ] Ensure the spec pre-commit hook is installed: `node scripts/install-spec-hooks.mjs`.
- [ ] Run `node scripts/validate-specs.js docs/specs/<slug>/spec.md` and fix all errors.
- [ ] Run `node scripts/validate-specs.js --strict <spec-path>` and verify: no index drift warnings, no cross-spec errors, no stale-draft warnings (unless intentional with `freshness: ignore`), and a `plan.md` exists if the spec has 5+ requirements.
- [ ] If the spec has 5+ requirements or 2+ phases, create a sibling `plan.md`.

## Minimal Workflow

1. Derive a stable spec slug and `spec_id` from the durable subject.
2. Read the smallest relevant repo evidence before writing requirements.
3. Create or refine `docs/specs/<spec-slug>/spec.md`.
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

### Allowed Behavior

- <what the system should do>

### Forbidden Behavior

- <what the system must not do>

## Non-Goals

- <out-of-scope item>

## Acceptance Checks

- <observable behavior>
  → verify: <test command, script path, or manual steps>
- <observable behavior>
  → verify: <test command, script path, or manual steps>

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
