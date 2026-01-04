---
name: refactor
description: "Code restructuring and cleanup. Improves readability, reduces duplication, aligns with patterns without changing behavior. Use this when asked to refactor code, clean up, extract methods, or improve code structure."
---

# Refactor Skill

## When to Use (LLM Routing Guide)
- User says "refactor this", "clean up this code", "extract this into..."
- Reducing code duplication
- Improving naming or structure
- Aligning with project patterns
- Preparing code for new features (pre-refactor)

## When NOT to Use
- Adding new functionality → domain agents
- Fixing bugs → `debug.agent.md`
- Performance optimization → `performance-auditer.agent.md`
- Code review without changes → `code-review.agent.md`

## Inputs
- Code to refactor.
- `contexts/project.patterns.md` (target patterns).
- `warnings.md` (known issues to address or avoid).

## Steps
1. Read project patterns to understand target conventions.
2. Mode selection: auto → **deep** if touching shared code or prior refactor failures; **shallow** for isolated cleanup.
3. Analyze current code for:
   - Duplication
   - Long methods/classes
   - Poor naming
   - Pattern violations
   - Tight coupling
4. Plan refactoring steps (small, incremental changes).
5. Apply changes while **preserving behavior**—no functional changes.
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
- `warnings.md` entry if risk discovered.

## Session Summary Format
- **Done**: [refactoring completed]
- **Changes**: [files modified]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [if follow-up needed, e.g., add tests]
- **Warnings**: [if risk found]
- **Next**: [verify behavior, continue refactoring, or done]


