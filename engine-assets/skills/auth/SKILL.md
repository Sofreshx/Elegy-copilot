---
name: auth
description: "Deprecated compatibility alias for firebase-auth. Not auto-selected in normal routing; load only for explicit auth-skill requests or legacy compatibility. Triggers on: auth, authentication, login, firebase auth alias."
---

# Auth Skill (Deprecated Compatibility Alias)

This skill is a deprecated compatibility surface. Normal routing should prefer `firebase-auth` for implementation work and `security` for review. Load `auth` only when an older prompt or explicit request still names this alias.

Use the canonical Firebase skill instead:

- `firebase-auth`


## When NOT to Use
- For Firebase-specific auth, use `firebase-auth` (custom claims, Admin SDK)
- For generic security review, use `security`

## Inputs
- Explicit task request or active host/session work unit
- Relevant repo docs and current auth/security guidance under `docs/` or area-specific documentation
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
6. **Record risks**: Capture systemic inconsistencies in chat, host/session artifacts, or a user-requested doc instead of assuming legacy warning files

## Output
- Auth changes plus tests.
- Follow-up notes only in chat, host/session artifacts, or a user-requested destination.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New follow-ups**: [any tracked follow-up work]
- **Risks/notes**: [security or auth concerns captured]
- **Next**: [suggested next actions]



