---
name: lane-standard
description: "Scoped feature or normal bug fix. Flash for exploration and implementation; Pro only for ambiguity, architectural choice, or final review."
triggers:
  - feature
  - bug fix
  - enhancement
  - standard
  - lane standard
---

# Lane: Standard

Scoped feature or normal bug fix. Default lane for most development work.

## When To Use

- Adding a small-to-medium feature in a well-understood area
- Fixing a confirmed bug with clear reproduction steps
- Refactoring a scoped module without contract changes
- Adding tests for existing behavior
- Performance optimization in a hot path

## When NOT To Use

- If the change touches a contract/API/user-facing behavior boundary → use `lane-spec`
- If the change spans multiple sessions or roadmaps → use `lane-project`
- If the change is a trivial one-liner → `lane-quick` is cheaper

## Model Role

- **Default:** `small` (DeepSeek V4 Flash) for exploration and implementation
- **Escalation to `big` (DeepSeek V4 Pro):**
  - Design ambiguity — trade-offs that affect maintainability or performance
  - Architectural decisions — module boundaries, abstraction choices, inheritance vs composition
  - Final review — user-facing diff summary before confirming

## Workflow

1. **Explore:** Understand the codebase with `Explore` or `Scout`; search for patterns, existing tests, and related code
2. **Plan:** Outline the change in 1-3 steps (use `Plan` for non-trivial design before editing)
3. **Implement:** Make changes in `Build`
4. **Escalate if needed:** If ambiguity or architecture questions arise, escalate to `big` model role
5. **Validate:** Run focused tests, lint, typecheck
6. **Review:** Present the diff; if user wants formal review, load `code-review` skill

## Validation Standard

- Run lint on changed files
- Run existing tests in changed modules
- Run typecheck if the language supports it
- Add tests for new behavior when feasible

## Prerequisites

None. The standard lane is the default development workflow.

## Output Contract

At completion:
- **Done:** [summary of what was done]
- **Changes:** [file:line references for each logical change]
- **Tests:** [what was tested and results]
- **Risks:** [any edge cases or concerns]
- **Next:** [PR, follow-up, or nothing]

## Safety

- Do not change public APIs without explicit user confirmation
- Do not change error contracts or logging levels without discussion
- If you discover a spec-affecting design issue, recommend escalating to `lane-spec`
