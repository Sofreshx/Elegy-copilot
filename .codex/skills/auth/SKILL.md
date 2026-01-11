---
name: auth
description: "Authentication and authorization implementation. Handles login flows, JWT, OIDC, and identity management. Use this when asked to add login, implement authentication, secure endpoints, or work on identity management."
---

# Auth Skill

## When NOT to Use
- For Firebase-specific auth → use `firebase-auth` (custom claims, Admin SDK)
- For generic security review → use `security`
- For secret scanning → use `secrets-auditor`

## Inputs
- Task from a task file under `.instructions/tasks/`
- `warnings.md`, `contexts/project.patterns.md`
- Check for existing auth: look for JWT, OIDC, cookie auth patterns in codebase

## Auth Patterns to Detect
1. **JWT Bearer**: Look for `AddJwtBearer`, `[Authorize]`, token validation
2. **Cookie Auth**: Look for `AddCookie`, session management
3. **OIDC/OAuth**: Look for `AddOpenIdConnect`, `AddOAuth`, external providers
4. **API Keys**: Look for custom middleware, header validation

## Steps
1. **Discover**: Search codebase for existing auth patterns before implementing
2. **Align**: Match existing approach (don't mix Firebase + Auth0 without reason)
3. **Mode**: Use deep mode if touching shared auth infra; shallow for config changes
4. **Implement**: Config, middleware/filters, token handling, user model impacts
5. **Test**: Add auth-specific tests (token validation, role checks, expiry)
6. **Warn**: Note inconsistencies in `warnings.md` (e.g., mixed providers, missing HTTPS)

## Output
- Auth changes plus tests.
- Updated tasks/raw tasks/warnings as applicable.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks**: [any new task files created]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


