---
created: 2026-06-27
updated: 2026-06-27
category: system
status: current
doc_kind: node
id: check-taxonomy-governance
summary: Canonical taxonomy for validation and accountability checks, including determinism class, gate strength, and where each check belongs.
tags: [validation, governance, checks, testing, accountability]
related: [validation-governance, commit-validation-governance, spec-driven-development, quality-gate-evaluation]
---

# Check Taxonomy Governance

## Purpose

Define the canonical taxonomy for checks in Elegy Copilot.

Use this node when the question is:

- what kind of check is this,
- when should it exist,
- where should it run,
- how much authority should it have.

## Core Rule

Prefer the smallest deterministic proof that closes the active risk.

Do not add duplicate gates for the same risk across specs, commit validation, CI, and review.

## Check Classes

| Class | Primary question | Default owner | Typical form |
|---|---|---|---|
| Authoring | Is the intended contract precise enough to implement? | Spec lane / doc contract | Spec validator, required headings, required acceptance-check structure |
| Pre-implementation proof | Can we define the proof before or alongside implementation? | Spec lane + repo tests/scripts | New unit test, contract test, fixture, smoke script, generated verify manifest |
| Change validation | Did the implementation satisfy the changed behavior? | Validation lane | Unit, integration, browser, strict validator, focused smoke command |
| Commit / merge gate | Is this change safe to commit or merge? | Commit validation | Fast deterministic lanes such as test, lint, format, typecheck |
| Evidence / review | What residual risk or drift still exists? | Reviewer / operator | Manual walkthrough, review finding, explicit gap report |

## Determinism Classes

| Determinism | Meaning | Gate posture |
|---|---|---|
| `deterministic-runnable` | Stable command or script; same repo state should produce the same pass/fail result | Eligible for blocking or score-based gates |
| `deterministic-generated` | Generated from a canonical source, then run as a deterministic artifact | Eligible for gates after generation is stable |
| `manual` | Human-run proof with explicit steps | Evidence by default; use as a required gate only by explicit policy |
| `review-evidence` | Reviewer or LLM-assisted judgment layered on top of other evidence | Never the sole authoritative deterministic pass signal |

## Gate Strength

Every formal check should declare one of these strengths:

| Gate strength | Meaning |
|---|---|
| `blocking` | Failing the check blocks commit, merge, or completion |
| `score` | Contributes to a weighted gate such as `commit-check` |
| `advisory` | Produces findings or warnings without blocking |
| `required-evidence` | Must be reported explicitly, but is not by itself a pass/fail merge gate |

## Placement Rules

### Commit validation

- `commit-check` owns the narrow "safe to commit" gate.
- Keep it fast, deterministic, and low-friction.
- Do not move heavy integration, browser, or review-only checks into `commit-check` by default.

### Validation lane

- `validation-governance` owns unit, integration, E2E, browser, and manual coverage selection.
- Validation remains risk-based: narrowest sufficient layer first.

### Specs

- Specs own durable pre-implementation requirements when a contract should exist before implementation.
- When a spec defines an acceptance check that is feasible to automate, prefer a repo-tracked deterministic proof artifact over leaving it permanently manual.
- Manual spec checks are allowed only when automation is not yet practical or not worth the cost; the limitation must remain explicit.

### Review

- Review findings can challenge sufficiency, detect drift, and keep missing proof explicit.
- Review does not replace deterministic proof for risks that can be closed by tests or scripts.

## Rollout Rule

New checks should enter the system in this order:

1. Define the class, owner, and gate strength.
2. Land as advisory or required-evidence first.
3. Prove the check is stable, useful, and non-disruptive.
4. Promote to `score` or `blocking` only after the baseline is clean.

## Good Practice Defaults

- Write a pre-implementation deterministic proof when the intended behavior can be expressed as a test, fixture, contract check, or smoke script.
- Prefer repo-tracked proof over chat-only intent.
- Keep manual checks explicit. Do not let them silently masquerade as deterministic coverage.
- When a manual check is still necessary, pair it with the missing automation reason and the next practical automation path when known.
- Reuse existing evidence formats and run logs where possible; do not create a second incompatible history surface for the same check family.

## References

- `docs/system/validation-governance.md`
- `docs/system/commit-validation-governance.md`
- `docs/system/quality-gate-evaluation.md`
- `docs/system/spec-driven-development.md`
