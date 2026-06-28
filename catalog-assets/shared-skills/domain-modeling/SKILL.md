---
name: domain-modeling
description: "Build and sharpen a project's domain model. Use when pinning down domain terminology or a ubiquitous language, recording an architectural decision, or when another skill needs to maintain the domain model. Triggers on: domain model, glossary, ubiquitous language, canonical term, ADR, architectural decision."
license: Apache-2.0
metadata: {"source":"https://github.com/mattpocock/skills","adapted":true,"originalName":"domain-modeling","notes":"CONTEXT.md→docs/system/, ADR path→docs/system/adr/, sub-docs inlined"}
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline — challenging terms, inventing edge-case scenarios, and writing definitions and decisions down the moment they crystallise. Merely *reading* `docs/system/` for vocabulary is not this skill — that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.

## File structure

This repo uses `docs/system/` as the canonical doc surface. The domain model lives across several surfaces:

```
/
├── docs/
│   └── system/
│       ├── index.md                  ← canonical entrypoint
│       ├── mocs/                     ← maps of content (topic-level navigation)
│       │   └── conventions-and-governance.md
│       ├── adr/                      ← architecture decision records
│       │   ├── 0001-event-sourced-orders.md
│       │   └── 0002-postgres-for-write-model.md
│       └── <topic>.md               ← canonical nodes for specific topics
├── docs/
│   └── specs/                        ← durable specs (requirements intent)
│       └── <spec-slug>/
│           └── spec.md
└── src/
```

The domain glossary lives in the relevant canonical node — usually the MOC or topic node closest to the concept being defined. When a concept spans multiple areas, define it at the highest common ancestor.

Create files lazily — only when you have something to write. If no relevant node exists, create one when the first term is resolved. If no `docs/system/adr/` directory exists, create it when the first ADR is needed.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `docs/system/`, call it out immediately. "`docs/system/` defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update docs inline

When a term is resolved, update the owning canonical node in `docs/system/` right there. Don't batch these up — capture them as they happen.

**Domain glossary format** (add to the relevant node):

```markdown
## Language

**Order**:
A request from a customer for one or more products, tracked from placement through delivery.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Rules for glossary entries:
- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others under `_Avoid_`.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong.
- **Group terms under subheadings** when natural clusters emerge.

Canonical nodes should be totally devoid of implementation details. They describe domain concepts and their relationships, not code structure.

### Offer ADRs sparingly

Only offer to create an ADR in `docs/system/adr/` when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR.

ADR format (in `docs/system/adr/NNNN-slug.md`):

```markdown
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections. Number sequentially by scanning the directory for the highest existing number.

## References

- Canonical docs: follow the harness instructions' repo discovery chain
- ADR directory: `docs/system/adr/`
- MOC index: `docs/system/mocs/`
- Companion skills: `grilling` (interview loop), `improve-codebase-architecture` (architecture review uses domain terms)

## Boundaries

This skill changes the domain model by updating canonical docs — it is write-capable on `docs/system/`. It does not author specs (use `spec-authoring`) or create implementation plans (use `elegy-planning`). It is model-invoked so other skills can reach it when decisions need to be recorded inline.
