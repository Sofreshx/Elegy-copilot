---
name: security
description: "Focused security review for vulnerabilities LLMs commonly miss: secrets in git history, auth middleware bypass, dependency confusion, path traversal, cookie security, and IDOR. Triggers on: security, vulnerability, hardening, secure coding."
---

# Security Skill

## Purpose

Catch high-impact security issues that LLM code review commonly overlooks. This is a targeted checklist, not a full OWASP audit. It focuses on patterns where LLMs produce plausible-sounding but insecure code.

## When to use

Use when reviewing code that handles: auth, tokens/keys, file uploads, user data, network requests, payment, PII, or admin interfaces. Can also run proactively on new repos or before first deployment.

## High-Impact Checks

### 1. Secrets in git history (most common miss)

- `.env`, `*.key`, `*.pem`, `credentials.*`, `secrets.*` — are any tracked or were they ever committed?
- `git log --diff-filter=A --follow -- '*.env'` to find past leaks even if later gitignored
- API keys, tokens, connection strings in config files that ship with the repo (e.g. `appsettings.json`, `config/default.json`)
- `docker-compose.yml` with hardcoded passwords or `environment:` blocks that use plaintext secrets
- CI/CD logs that echo or print environment variables containing secrets

### 2. Auth bypass — middleware not applied or order wrong

- Verify that auth middleware is actually wired to the route/protected resource, not just declared
- Check for "public" endpoint decorators that silently override auth (e.g. `[AllowAnonymous]` on a controller class after `[Authorize]` was expected)
- Route ordering: wildcard/public routes placed before auth-gated ones
- Direct object references in URLs without ownership checks (IDOR)
- Role/permission checks that only check existence of a claim, not its value

### 3. Dependency confusion / supply chain

- `package.json` dependencies that could be confused with public npm packages (private package names fetchable from public registry)
- `requirements.txt` without `--index-url` or hashes
- `go.mod` with replace directives pointing to unverified forks
- NuGet `nuget.config` without a valid `packageSourceMapping` for private feeds

### 4. Path traversal / file access

- User-supplied filenames passed to `fs.readFile`, `File.OpenRead`, `open()` without path sanitization
- Archive extraction without checking `../` in member names (zip/tar symlink attacks)
- `res.sendFile()` or similar with user-controlled path concatenation
- Static file middleware with overly broad patterns

### 5. Cookie / session security

- `httpOnly`, `secure`, `sameSite` flags missing on session cookies
- Session tokens in URL parameters instead of headers
- JWTs without `exp` or `nbf` claims; JWTs with `alg: "none"` accepted
- Long-lived refresh tokens without rotation

### 6. Injection in non-obvious contexts

- ORM query builders with raw `.whereRaw()`, `.executeRaw()`, `$queryRaw` still vulnerable if user data is interpolated
- NoSQL injection (MongoDB `$where`, `$gt` bypass on login)
- Template injection in server-rendered React/Vue/AST-based frameworks
- HTTP header injection via newlines in redirect URLs or `Location` headers

## Output Format

```
SECURITY_REVIEW
- scope:
- findings:
  - type: <secrets|auth|supply-chain|path-traversal|cookie|injection>
  - severity: critical|high|medium|low
  - location: <file:line>
  - impact: <what an attacker can do>
  - fix: <specific code change or config change>
- positives:
  - <what was done correctly>
- next:
  - <critical items to fix immediately>
```

## Limitations

This skill is not a replacement for dedicated security tooling (SAST, DAST, dependency scanners, secret scanners). It is a focused LLM guided review for patterns that automated tools and code review commonly miss. Enhance with OWASP Top 10 mappings, CWE references, and language-specific checklists when the surface area grows.

## Canonical References

- `docs/system/security-model.md`
- `docs/system/runtime-permissions-contracts.md`
