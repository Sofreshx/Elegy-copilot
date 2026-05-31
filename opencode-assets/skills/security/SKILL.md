---
name: security
description: "Security review and vulnerability detection. Checks secure coding practices and exposure risks. Triggers on: security, vulnerability, hardening, secure coding."
---

# Security Skill

## Related docs

- Security model: `docs/system/security-model.md`
- Runtime permissions contracts: `docs/system/runtime-permissions-contracts.md`
- Security model and safety MOC: `docs/system/mocs/security-model-and-safety.md`
- Copilot CLI playbook: `docs/system/copilot-cli-playbook.md`

## Steps
1. Read security-relevant docs in `docs/` or `documentation/` and any existing issue notes or session context for the affected area.
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
- Critical/high follow-ups captured in chat, host/session artifacts, or a user-requested security tracking surface.
- Systemic security concerns captured only in `~/.copilot/backlogs/{repo-name}/issues/` or other explicitly requested destinations.

## Session Summary Format
- **Done**: [security review completed]
- **Changes**: [none-review only, or quick fixes applied]
- **New follow-ups**: [security fixes needed]
- **Risks/notes**: [systemic security issues]
- **Next**: [address critical issues immediately]



