---
name: spec-review
description: "Adversarial review for a durable repo spec before implementation planning. Use after spec authoring to find ambiguity, missing evidence, weak acceptance checks, or source-of-truth drift. Triggers on: review a spec, spec review, critique spec.md, spec readiness, requirements gaps."
license: Apache-2.0
spec_contract: docs/specs/spec-driven-development-contract/spec.md
metadata: {"tags":["specs","review","requirements","planning"]}
---

# Spec Review

Treat the review as adversarial. The goal is to expose ambiguity, missing evidence, weak
acceptance checks, source-of-truth confusion, and scope drift before the implementation plan starts.

The authoritative spec contract is defined at `docs/specs/spec-driven-development-contract/spec.md`. All review checks derive from that contract.

## Review Checks

The full 18-review-check catalog is in [`references/spec-review-checks.md`](references/spec-review-checks.md).

Key check categories:
- Contract conformance (checks 1, 6, 8, 17)
- Evidence and acceptance (checks 3, 6, 7, 12)
- Architecture and ADRs (checks 10, 15)
- Planning handoff (checks 9, 18)
- Scope and ambiguity (checks 2, 4, 5)
- Artifact liveness and relationships (checks 12, 13, 14)
- Historical (check 16 — pre-commit hook removed June 2026)

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
- adr_follow_up:
  - <required adr work or none>
```

Lead with defects. Keep the block strict and concise.
