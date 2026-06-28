---
name: spec-authoring
description: "Create or refine a durable repo spec under docs/specs/<spec-slug>/spec.md using the shared contract. Use when work should be spec-anchored or spec-as-source and needs a concrete spec artifact before implementation planning. Triggers on: author a spec, create a spec, refine spec.md, specs template, specs folder, durable repo spec."
license: Apache-2.0
spec_contract: docs/specs/spec-driven-development-contract/spec.md
metadata: {"tags":["specs","authoring","requirements","contracts"]}
---

# Spec Authoring

## Contract

The authoritative spec contract is defined at `docs/specs/spec-driven-development-contract/spec.md`. That spec is the single source of truth for required frontmatter, headings, acceptance check format, lifecycle rules, cross-spec relationships, and all other contract requirements. This skill covers how to author against that contract.

### Quick Contract Reference

- Location: `docs/specs/<spec-slug>/spec.md`
- Required frontmatter: `spec_id`, `title`, `status`, `type`, `updated`
- Required headings: `Intent`, `Context Evidence`, `Requirements`, `Non-Goals`, `Acceptance Checks`, `Implementation Links`, `Validation Evidence`, `Drift Notes`
- Per-type templates: `docs/specs/_templates/<type>.md`

## Authoring Rules

- Keep the spec durable and repo-grounded.
- Use exact file paths, commands, docs, tests, or runtime evidence in `Context Evidence` when available.
- Keep `Intent` specific and non-empty.
- Write at least two `Acceptance Checks`, each with a concrete verification method using the `→ verify:` marker (indented 2 spaces, immediately following the bullet, non-empty content). See normative spec R4.
- When automation is feasible, prefer a deterministic repo-tracked proof artifact (test, fixture, contract check, smoke script, or generated proof artifact) over leaving the check permanently manual.
- If you want machine-readable classification, add the optional `→ check:` line using `determinism=<value> phase=<value> gate=<value>`. See normative spec R4.5-R4.9.
- Keep `Non-Goals` explicit near likely scope-creep edges.
- Use `Implementation Links` for code, docs, plans, PRs, or tickets that materially connect to the spec.
- When `status: implemented`, `Validation Evidence` must contain real evidence, not a placeholder.
- Use `Drift Notes` to record deviations, follow-up reconciliation, or `none`.
- Do not treat a spec as the permanent home for a key architectural or workflow-authority tradeoff when that decision should be promoted into an ADR. See normative spec R13.
- Use the per-type templates under `docs/specs/_templates/` when the default template does not match your `type`.

### Authoring Gate

Before creating `docs/specs/<spec-slug>/spec.md`, the authoring session must establish:

1. **Context evidence**: concrete file paths, commands, docs, or runtime data that justify the spec.
2. **Allowed Behavior**: what the system should do under the spec's requirements. See normative spec R5.
3. **Forbidden Behavior**: what the system must not do — boundary conditions, error states, and excluded paths. See normative spec R5.
4. **Verifiable acceptance checks**: at least two checks with concrete `→ verify:` lines. See normative spec R4.
5. **Deterministic-first posture**: when a check could exist as a stable repo artifact before or alongside implementation, prefer that path over a permanent manual-only check.

Do not create a durable spec without these gates passed. If evidence is insufficient, pause and gather more before authoring.

### Spec Link Conventions

See the normative spec (R7) for the full cross-spec relationship contract. Quick rules:

- `supersedes: <spec_id>` — this spec replaces another.
- `superseded_by: <spec_id>` — this spec is replaced by another. Required when `status: superseded`.
- Do not set both `supersedes` and `superseded_by` in the same spec.
- If your spec is related to another but does not supersede or get superseded by it, mention the relationship in `Drift Notes` or `Context Evidence`.

### Spec Readiness Checklist

Before handing a spec to `spec-review`, confirm:

- [ ] Frontmatter: all 5 required keys present, valid status and type, valid ISO date.
- [ ] All 8 required headings present and non-empty.
- [ ] Intent is a specific, non-empty description of the problem or opportunity.
- [ ] Context Evidence lists concrete file paths, commands, tests, or runtime data with reasons.
- [ ] Requirements are unambiguous and testable.
- [ ] Allowed Behavior and Forbidden Behavior subsections are present and concrete (normative spec R5).
- [ ] Non-Goals cover likely scope-creep edges.
- [ ] Each Acceptance Check has a `→ verify:` line with a concrete command or manual step (normative spec R4).
- [ ] When automation is feasible, the Acceptance Checks prefer deterministic proof over permanent manual-only steps.
- [ ] If optional `→ check:` metadata is present, it uses valid `determinism`, `phase`, and `gate` values.
- [ ] Implementation Links list every file, test, or plan that the spec will touch.
- [ ] Validation Evidence is populated (required for `implemented` status per normative spec R9).
- [ ] Drift Notes captures any deviation or follow-up, or says "None."

- [ ] Run `node scripts/validate-specs.js docs/specs/<slug>/spec.md` and fix all errors.
- [ ] Run `node scripts/validate-specs.js --strict <spec-path>` and verify: no index drift warnings, no cross-spec errors, no stale-draft warnings (unless intentional with `freshness: ignore`), and a `plan.md` exists if the spec has 5+ requirements (normative spec R8).
- [ ] If the spec has 5+ requirements or 2+ phases, create a sibling `plan.md`.

## Minimal Workflow

1. Derive a stable spec slug and `spec_id` from the durable subject.
2. Read the smallest relevant repo evidence before writing requirements.
3. Load the normative spec contract at `docs/specs/spec-driven-development-contract/spec.md`.
4. Create or refine `docs/specs/<spec-slug>/spec.md`.
5. Update `updated` with the current date.
6. Run the repo-local spec validator when available.
7. If implementation will depend on the spec, hand it to `spec-review` before planning.

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

<one compact paragraph or bullet list describing what the system should do — intent, not current state>

## Context Evidence

- `<path or command>`: <why it matters — current-state justification for the intent above>

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
