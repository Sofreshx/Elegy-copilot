---
name: code-review
description: "Code review for quality, patterns, and bugs. Reviews PRs, identifies issues, and suggests improvements. Triggers on: review, PR review, code review, code quality, peer review."
---

# Code Review Skill

## When to Use (LLM Routing Guide)
- User says "review this code", "check this PR", "any issues here?"
- Requests for code quality assessment
- Pre-merge reviews
- "Is this implementation correct?" questions

## When NOT to Use
- Implementing fixes ? use appropriate domain agent after review
- Performance optimization ? `performance-auditer.agent.md`
- Security-specific review ? `security.agent.md`
- Debugging runtime errors ? `debug.agent.md`

## Inputs
- Code to review (file, diff, or PR).
- Relevant repo docs and conventions from `README.md`, `docs/`, or area-specific documentation.
- Existing issue notes, session context, or explicitly provided background for the reviewed area.

## Steps
1. Read repo docs, nearby code, and established conventions to understand expected behavior.
2. Check existing issue notes or session context for known issues in the area being reviewed.
3. Analyze code for:
   - **Correctness**: Logic errors, edge cases, null handling
   - **Patterns**: Alignment with project conventions
   - **Readability**: Naming, structure, comments
   - **Testability**: Is it testable? Are tests included?
   - **Performance**: Obvious inefficiencies (defer deep analysis to performance.agent)
   - **Security**: Obvious vulnerabilities (defer deep analysis to security.agent)
4. Categorize findings by severity: **Critical** | **Warning** | **Suggestion** | **Nitpick**
5. If issues found, suggest specific fixes or capture follow-up work in chat, host/session artifacts, or a user-requested tracking surface.

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
- Optional: follow-up notes in chat, host/session artifacts, or a user-requested tracking surface.

## Session Summary Format
- **Done**: [review completed]
- **Changes**: [none-review only]
- **New follow-ups**: [issues needing fixes]
- **Risks/notes**: [if systemic issue found]
- **Next**: [address critical issues or approve]



