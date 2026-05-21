---
name: spec-dev
description: "Entrypoint/router for spec-driven development. Decide whether the task should use spec-first clarification, a durable repo spec under specs/, or spec-as-source declarative authoring. Triggers on: spec-driven development, write a spec, refine a spec, spec-first, spec-anchored, spec-as-source, specs folder."
metadata: {"tags":["specs","planning","requirements","validation"]}
---

# Spec-Driven Development Router

## Purpose

Choose the right spec posture before planning or implementation:

- `spec-first`
- `spec-anchored`
- `spec-as-source`

This skill complements normal planning, roadmap, review, and validation flows. It does not replace
them.

## Routing Rules

### Use `spec-first` when

- the main blocker is ambiguous requirements,
- the clarification is short-lived,
- the work probably does not need a durable repo artifact yet.

Default posture:

- keep the clarification compact,
- do not create `specs/` files unless the work is non-trivial or the user explicitly wants a durable spec.

### Use `spec-anchored` when

- the work is non-trivial,
- the repo needs a durable requirements contract,
- the user explicitly asks for a spec,
- the work is a feature, workflow, contract, skill, agent, or migration that should remain inspectable later.

Default durable location:

- `specs/<spec-slug>/spec.md`
- optional catalog: `specs/index.md`

### Use `spec-as-source` when

- the spec is the canonical declarative source, and
- code, fixtures, manifests, or other artifacts are generated or projected from it.

Allowed examples:

- schemas
- fixtures
- workflow definitions
- capability manifests
- generated projections

Do not use `spec-as-source` for general product code or broad implementation notes.

## Decision Checks

1. Is the work still mostly clarification?
2. Will the repo benefit from a durable spec under `specs/`?
3. Is the spec meant to drive generated or declarative artifacts?
4. Would a normal plan or roadmap already cover the problem without a durable spec?

## Next-Step Routing

- If `spec-first`, produce the smallest clarification artifact needed, then continue with normal planning.
- If `spec-anchored`, use `spec-authoring`, then `spec-review`, then normal planning and implementation.
- If `spec-as-source`, use `spec-authoring`, define projection boundaries, then plan generation and validation.

## Output Contract

Use this format:

```text
SPEC_DEV_ROUTE
- mode: spec-first | spec-anchored | spec-as-source
- spec_path: <path or none>
- rationale:
  - <why this mode fits>
- next_steps:
  - <author | review | plan | implement>
```

Keep the route compact. The goal is to reduce ambiguity, not to create a second planning artifact.
