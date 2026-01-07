---
name: security
description: "Security review and vulnerability detection. Checks for secure coding practices, secret exposure, injection risks. Use this when asked to do a security review, check for vulnerabilities, audit security, or review secure coding practices."
---

# Security Skill

## When to Use (LLM Routing Guide)
- User says "is this secure?", "check for vulnerabilities", "security review"
- Setting up a new project or service (to ensure secrets infrastructure is correct)
- Configuring CI/CD pipelines
- Reviewing auth/authz code
- Handling sensitive data (passwords, tokens, PII)
- External input handling (user input, API calls)
- Dependency security concerns

## When NOT to Use
- General code quality → `code-review.agent.md`
- Auth feature implementation → `auth.agent.md`
- Performance issues → `performance-auditer.agent.md`

## Inputs
- Code to review for security.
- `../../contexts/auth.context.md` (if auth-related).
- `../../contexts/security.context.md` (Secrets management standards).
- `../../warnings.md` (known security issues).
- Dependency list (for known vulnerabilities).

## Steps
1. Read security-relevant contexts (`../../contexts/security.context.md`) and existing warnings.
2. **Audit Secrets Infrastructure**:
   - **Git**: Verify `.env` is in `.gitignore`.
   - **.NET**: Check `.csproj` for `<UserSecretsId>` (enforce User Secrets).
   - **Node/JS**: Check for `dotenv` usage and ensure `.env` is not committed.
   - **CI/CD**: Verify workflows use `${{ secrets.VAR }}` and not hardcoded values.
3. Analyze code for common vulnerabilities:
   - **Injection**: SQL, command, XSS, template
   - **Auth issues**: Broken auth, session management
   - **Data exposure**: Sensitive data in logs, responses, errors
   - **Access control**: Missing authz checks, IDOR
   - **Crypto**: Weak algorithms, hardcoded secrets
   - **Dependencies**: Known CVEs
4. Categorize findings by severity using CVSS or simple scale:
   - **Critical**: Exploitable, high impact (e.g., Hardcoded Secret)
   - **High**: Exploitable, moderate impact or hard to exploit high impact
   - **Medium**: Limited exploitability or impact
   - **Low**: Theoretical or minimal impact
5. Provide specific remediation for each finding.
6. For critical/high, add to `../../raw.tasks.md` with priority flag.

## Security Review Output Format
```markdown
## Security Review: [scope]

### Critical
- [vulnerability]: [location] - [impact] - [remediation]

### High
- [issue]: [location] - [impact] - [fix]

### Medium
- [issue]: [location] - [fix]

### Low
- [issue]: [location] - [suggestion]

### Secure Practices Observed
- [positive observations]

### Recommendations
- [general security improvements]
```

## Output
- Security review with categorized findings.
- `raw.tasks.md` entries for critical/high issues.
- `warnings.md` entry for systemic security concerns.

## Session Summary Format
- **Done**: [security review completed]
- **Changes**: [none—review only, or quick fixes applied]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [security fixes needed]
- **Warnings**: [systemic security issues]
- **Next**: [address critical issues immediately]


