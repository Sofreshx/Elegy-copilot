---
name: debug
description: "Debugging skill for diagnosing runtime errors, failing tests, and unexpected behavior. Triggers on: debug, debugging, stack trace, investigate, why failing, error."
---

# Debug Skill

## When to Use (LLM Routing Guide)
- User says "why is this failing?", "help me debug", "what's wrong with this?"
- Stack traces or error messages shared
- Tests failing unexpectedly
- "It works locally but not in CI/prod"
- Unexpected behavior investigation

## When NOT to Use
- Code quality review (no specific error) ? `code-review.agent.md`
- Performance issues ? `performance-auditer.agent.md`
- Design questions ? `design.agent.md`

## Inputs
- Error message, stack trace, or behavior description.
- Relevant code files.
- `../../warnings.md` (for known issues in the area).
- Task files under `.instructions/tasks/` and `.instructions/tasks.archive/` (check `## Failures` / `## Attempts / Log` for similar past failures).

## Steps
1. **Gather context**: Read error details, relevant code, and any logs provided.
2. **Check history**: Look in recent task files (especially `## Failures`) for similar issues�may have known fix.
3. **Hypothesize**: Form theories about root cause based on:
   - Error type and message
   - Stack trace location
   - Recent changes (if known)
   - Environment differences
4. **Narrow down**: Suggest diagnostic steps (logging, breakpoints, test isolation).
5. **Identify fix**: Once cause is clear, propose specific fix.
6. **Prevent recurrence**: Suggest test or check to catch this in future.

## Core Strategies
- **Error Tracing**: Search for exact error message string in codebase; identify throw location.
- **Log Analysis**: Correlate timestamps with code execution paths.
- **Isolation**: Identify smallest unit of code responsible for the issue.
- **Diffing**: If regression, check `git diff` for recent changes in affected area.

## Debug Output Format
```markdown
## Debug Analysis: [error/issue summary]

### Error Details
- Type: [exception/behavior]
- Location: [file:line or area]
- Message: [key error text]

### Hypotheses
1. [Most likely cause] - [why]
2. [Alternative cause] - [why]

### Diagnostic Steps
1. [what to check/try]
2. [next step if #1 doesn't reveal cause]

### Proposed Fix
[specific code change or configuration fix]

### Prevention
[test or check to add]
```

## Output
- Debug analysis with hypotheses and fix.
- Optional: `raw.tasks.md` entry if fix needs tracked implementation.
- Optional: `../../warnings.md` entry if systemic issue discovered.

## Session Summary Format
- **Done**: [issue diagnosed]
- **Changes**: [fix applied if simple]
- **New tasks**: [none]
- **New raw.tasks.md**: [if fix needs tracked work]
- **Warnings**: [if systemic issue]
- **Next**: [apply fix or continue diagnosis]


