---
name: refactor
description: "Default-handled compatibility surface for generic code cleanup. Base models usually handle refactor requests directly; load this skill only for explicit refactor-skill requests or legacy compatibility. Triggers on: refactor, clean up, reorganize, simplify."
---

# Refactor Skill

This skill is a default-handled compatibility surface. In normal routing, generic refactor and cleanup work should be handled directly without auto-selecting this skill. Load it only when the caller explicitly asks for the `refactor` skill or an older workflow still depends on it.

## When to Use (LLM Routing Guide)
- User says "refactor this", "clean up this code", "extract this into..."
- Reducing code duplication
- Improving naming or structure
- Aligning with project patterns
- Preparing code for new features (pre-refactor)

## When NOT to Use
- Adding new functionality - use the relevant domain lane
- Fixing bugs - use the debugging lane
- Performance optimization - use the performance audit lane
- Code review without changes - use the review lane

## Inputs
- Code to refactor.
- Relevant repo docs and nearby code conventions that define the target patterns.
- Existing issue notes or session context for known issues to address or avoid.

## Steps
1. Read repo docs and nearby code to understand the target conventions.
2. Mode selection: auto -> **deep** if touching shared code or prior refactor failures; **shallow** for isolated cleanup.
3. Analyze current code for:
   - Duplication
   - Long methods/classes
   - Poor naming
   - Pattern violations
   - Tight coupling
4. Plan refactoring steps (small, incremental changes).
5. Apply changes while **preserving behavior** - no functional changes.
6. Ensure tests pass after each step (if tests exist).
7. If tests don't exist, flag as risk and consider adding them first.

## Refactoring Techniques
| Smell | Technique |
|-------|-----------|
| Duplicate code | Extract method/class |
| Long method | Extract method, decompose |
| Large class | Extract class, split responsibilities |
| Long parameter list | Introduce parameter object |
| Feature envy | Move method |
| Data clumps | Extract class |
| Primitive obsession | Replace with value object |
| Switch statements | Replace with polymorphism |
| Speculative generality | Remove unused abstraction |

## Output
- Refactored code.
- Updated tests if needed.
- Risk note in chat, host/session artifacts, or a user-requested destination if a follow-up concern is discovered.

## Session Summary Format
- **Done**: [refactoring completed]
- **Changes**: [files modified]
- **New tasks**: [none]
- **New follow-ups**: [if follow-up needed, e.g., add tests]
- **Risks/notes**: [if risk found]
- **Next**: [verify behavior, continue refactoring, or done]



