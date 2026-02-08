---
schema: task/v1
id: task-000450
title: "Rewrite security-model.md for actual v1 architecture"
type: docs
status: done
priority: low
owner: ""
skills: ["docs", "security"]
group_id: "group-06-polish"
group_title: "Group 6: Polish"
group_order: 3
depends_on: ["task-000446", "task-000447"]
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context
The current `docs/security-model.md` describes aspirational features (Redis, Web Crypto IndexedDB encryption, session-key encrypted payloads) that don't exist. It needs to reflect the actual v1 implementation.

- Read `docs/security-model.md` for current (aspirational) content
- Read `.instructions/research/relay-architecture-audit.md` Section 3 for reality check

## Acceptance Criteria
- [x] Security doc reflects actual implementation
- [x] No references to unimplemented features without clear "planned" labels
- [x] Auth flow documented accurately
- [x] Token storage documented accurately

## Plan / Approach

1. Document the actual auth flow: GitHub OAuth → relay JWT minting → WebSocket auth
2. Document actual token storage: `localStorage` for mobile, `SecretStorage` for extension
3. Remove claims that don't exist: Redis, Web Crypto IndexedDB encryption, session-key encrypted payloads
4. Document rate limiting implementation (from task-000446)
5. Document scope enforcement (from task-000447)
6. Clearly mark v2 planned improvements (push notifications, E2E encryption, etc.)
7. Document known v1 security limitations honestly

## Attempts / Log

### Attempt 1 (2026-02-08) — Success
- Read all source files: tokenService.ts, auth.ts, types.ts, relay.ts, rateLimit.ts, index.ts
- Verified every claim against actual implementation before writing
- Completely rewrote docs/security-model.md (from ~200 lines of aspirational content to ~350 lines of accurate, verified content)
- Key sections: Architecture Overview, Authentication (mobile OAuth + extension exchange + WS auth), Token Design (HS256 claims tables), Token Storage (honest about localStorage), Scopes & Enforcement (full method→scope mapping), Transport Security, CSRF Protection (HMAC-signed state), Rate Limiting (HTTP + WS), Security Headers, Threat Model, Known v1 Limitations (7 items with mitigations), v2 Planned Improvements, Incident Response, Best Practices
- Per plan amendment: documented that `/auth/revoke` is client-side cleanup only
- Per plan amendment: documented that `/auth/exchange` accepts any valid GitHub token

## Failures

*(none)*

## Notes / Discoveries
- Refresh token TTL is 30 days (2592000s), not 7 days as the old doc claimed
- No session token concept exists — only access + refresh
- Scopes are completely different from old doc (was session:read/write, now read:status, read:sessions, etc.)
- WS Origin validation allows connections without Origin header (by design, for server-side clients)

## Next Steps

*(task complete — no follow-up required)*
