---
name: code-review
description: "Code review for quality, patterns, and bugs. Reviews PRs, identifies issues, suggests improvements. Use this when asked to review code, check a PR, assess code quality, or identify issues in code."
---

# Code Review Skill

## When to Use (LLM Routing Guide)
- User says "review this code", "check this PR", "any issues here?"
- Requests for code quality assessment
- Pre-merge reviews
- "Is this implementation correct?" questions

## When NOT to Use
- Implementing fixes → use appropriate domain agent after review
- Performance optimization → `performance.agent.md`
- Security-specific review → `security.agent.md`
- Debugging runtime errors → `debug.agent.md`

## Inputs
- Code to review (file, diff, or PR).
- `warnings.md`, `contexts/project.patterns.md`.
- Relevant domain context (e.g., `auth.context.md` if reviewing auth code).

## Steps
1. Read project patterns to understand expected conventions.
2. Check `warnings.md` for known issues in the area being reviewed.
3. Analyze code for:
   - **Correctness**: Logic errors, edge cases, null handling
   - **Patterns**: Alignment with project conventions
   - **Readability**: Naming, structure, comments
   - **Testability**: Is it testable? Are tests included?
   - **Performance**: Obvious inefficiencies (defer deep analysis to performance.agent)
   - **Security**: Obvious vulnerabilities (defer deep analysis to security.agent)
4. Categorize findings by severity: **Critical** | **Warning** | **Suggestion** | **Nitpick**
5. If issues found, suggest specific fixes or add to `raw.tasks.md` for follow-up.

## Review Output Format
```markdown
## Code Review: [file/PR name]

### Critical
- [issue]: [location] - [explanation] - [suggested fix]

### Warnings
- [issue]: [location] - [explanation]

### Suggestions
- [improvement]: [location] - [why]

### Nitpicks
- [minor]: [location]

### What's Good
- [positive observations]
```

## Output
- Review summary with categorized findings.
- Optional: `raw.tasks.md` entries for issues that need tracked fixes.

## Session Summary Format
- **Done**: [review completed]
- **Changes**: [none—review only]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [issues needing fixes]
- **Warnings**: [if systemic issue found]
- **Next**: [address critical issues or approve]


