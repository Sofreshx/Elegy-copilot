---
name: spec-review
description: "Adversarial review for a durable repo spec before implementation planning. Use after spec authoring to find ambiguity, missing evidence, weak acceptance checks, or source-of-truth drift. Triggers on: review a spec, spec review, critique spec.md, spec readiness, requirements gaps."
metadata: {"tags":["specs","review","requirements","planning"]}
---

# Spec Review

## Purpose

Review a durable spec before implementation planning.

Treat the review as adversarial. The goal is to expose ambiguity, missing evidence, weak
acceptance checks, source-of-truth confusion, and scope drift before the implementation plan starts.

## Review Checks

1. Verify the spec uses the shared contract and required headings.
2. Check whether `Intent` matches the actual problem.
3. Check whether `Context Evidence` is strong enough to justify the requirements.
4. Look for ambiguous, untestable, or conflicting requirements.
5. Look for missing `Non-Goals` where scope creep is likely.
6. Check whether `Acceptance Checks` are observable and specific enough to plan against.
7. Check whether `Implementation Links`, `Validation Evidence`, and `Drift Notes` match the current status.
8. Confirm the spec complements normal planning rather than replacing plan-pack, roadmap, or implementation review flows.

## Verdict Rules

- `pass`: the spec is ready to anchor implementation planning.
- `revise`: the spec is useful but needs changes before planning.
- `blocked`: the spec is missing critical evidence or has unresolved contradictions that make planning unsafe.

## Output Contract

Use this exact block:

```text
SPEC_REVIEW
- verdict: pass | revise | blocked
- gaps:
  - <gap or none>
- required_revisions:
  - <required revision or none>
```

Lead with defects. Keep the block strict and concise.
