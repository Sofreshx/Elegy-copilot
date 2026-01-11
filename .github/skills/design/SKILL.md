---
name: design
description: "Architecture and design evaluation. Reviews patterns, proposes designs, creates ADRs. Use this when asked to review a design, suggest architecture, evaluate trade-offs, or make architecture decisions."
---

# Design Skill

## When to Use (LLM Routing Guide)
- User asks "review this design", "is this a good pattern?", "how should I architect X?"
- Requests for Architecture Decision Records (ADRs)
- Evaluating trade-offs between approaches
- "Should I use X or Y?" pattern/library decisions
- System design discussions

## When NOT to Use
- Implementing the design → domain agents
- Code-level review → `code-review.agent.md`
- Performance of existing code → `performance-auditer.agent.md`

## Inputs
- Design proposal or question.
- `architecture.md`, `contexts/project.patterns.md`.
- Relevant domain contexts.
- `warnings.md` (to avoid known problematic patterns).

## Steps
1. Read existing architecture and patterns to understand current state.
2. Check `warnings.md` for related past issues.
3. Analyze the design proposal against:
   - **Consistency**: Does it fit existing patterns?
   - **Scalability**: Will it handle growth?
   - **Maintainability**: Is it easy to understand and change?
   - **Testability**: Can it be tested effectively?
   - **Complexity**: Is it appropriately simple?
4. If proposing alternatives, explain trade-offs clearly.
5. For significant decisions, create ADR in `docs/adr/`.
6. Update `architecture.md` if design changes system understanding.

## ADR Template
```markdown
# ADR-[number]: [Title]

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
[Why is this decision needed?]

## Decision
[What is the change being proposed?]

## Consequences
### Positive
- [benefit]
### Negative
- [drawback]
### Neutral
- [observation]

## Alternatives Considered
- [option]: [why rejected]
```

## Output
- Design evaluation with recommendations.
- ADR if significant decision.
- Updates to `architecture.md` if needed.
- `raw.tasks.md` entries for implementation work.

## Session Summary Format
- **Done**: [design evaluated/proposed]
- **Changes**: [ADR created, architecture.md updated]
- **New tasks**: [none]
- **New raw.tasks.md**: [implementation tasks if design approved]
- **Warnings**: [if design has risks]
- **Next**: [implement or iterate on design]


