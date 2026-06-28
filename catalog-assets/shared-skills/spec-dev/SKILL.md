---
name: spec-dev
description: "Entrypoint/router for spec-driven development. Decide whether the task should use spec-first clarification, a durable repo spec under docs/specs/, or spec-as-source declarative authoring. Triggers on: spec-driven development, write a spec, refine a spec, spec-first, spec-anchored, spec-as-source, specs folder."
license: Apache-2.0
spec_contract: docs/specs/spec-driven-development-contract/spec.md
metadata: {"tags":["specs","planning","requirements","validation"]}
---

# Spec-Driven Development Router

The authoritative spec contract is defined at `docs/specs/spec-driven-development-contract/spec.md`. This skill routes the development mode based on task characteristics.

## Routing Rules

### Use `spec-first` when

- the main blocker is ambiguous requirements,
- the clarification is short-lived,
- the work probably does not need a durable repo artifact yet.

Default posture:

- keep the clarification compact,
- do not create `docs/specs/` files unless the work is non-trivial or the user explicitly wants a durable spec.

### Use `spec-anchored` when

- the work is non-trivial,
- the repo needs a durable requirements contract,
- the user explicitly asks for a spec,
- the work is a feature, workflow, contract, skill, agent, or migration that should remain inspectable later.

Default durable location per the normative spec (R1):

- `docs/specs/<spec-slug>/spec.md`
- optional catalog: `docs/specs/index.md`

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
2. Will the repo benefit from a durable spec under `docs/specs/` per the normative spec contract?
3. Is the spec meant to drive generated or declarative artifacts?
4. Would a normal plan or roadmap already cover the problem without a durable spec?
5. **Does this spec need a sibling `plan.md`?** Yes if the spec has 5+ requirements, 2+ implementation phases, or involves 2+ owners. Place `plan.md` in `docs/specs/<slug>/plan.md` alongside `spec.md`. See normative spec R8.

## Next-Step Routing

- If `spec-first`, produce the smallest clarification artifact needed, then continue with normal planning.
- If `spec-anchored`, use `spec-authoring`, then `spec-review`, then normal planning and implementation. Prefer defining deterministic proof alongside the spec when the behavior is amenable to a test, fixture, contract check, or smoke script.
- If `spec-as-source`, use `spec-authoring`, define projection boundaries, then plan generation and validation.
- If the work introduces a key architectural, workflow-authority, trust-boundary, or long-lived contract decision, pair the spec flow with ADR creation or ADR review instead of leaving that rationale only inside the spec. See normative spec R13.

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
