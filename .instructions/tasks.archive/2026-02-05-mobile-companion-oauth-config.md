---
schema: task/v1
id: task-000427
title: "Verify & correct: Mobile companion OAuth callback config and production relay URLs"
type: chore
status: archived
priority: high
owner: "lolzi"
skills: ["frontend", "auth", "docs", "deployment-compose"]
depends_on: []
next_tasks: []
created: "2026-02-05"
updated: "2026-02-05"
---

## Context

The mobile companion (PWA) handles GitHub OAuth and exchanges codes via the Cloud Relay service. Production must point OAuth callbacks and relay URLs at the production relay (https://relay.sfrsh.xyz).

Relevant files and docs:

- `mobile-companion/README.md`
- `mobile-companion/src/services/authService.ts`
- `mobile-companion/.env.example`
- `instruction-engine/docs/relay-api-reference.md`

Current observations:

- `authService.ts` resolves redirect URIs from `VITE_GITHUB_REDIRECT_URI` or falls back to `${window.location.origin}/auth/callback`.
- The project has a `FALLBACK_CLIENT_ID` used when `VITE_GITHUB_CLIENT_ID` is not set; production builds must not rely on the fallback.
- `.env.example` currently defaults to localhost values for development.

## Acceptance Criteria

1. Mobile companion configuration (production) references `https://relay.sfrsh.xyz/auth/callback` as the OAuth callback.
2. OAuth client ID usage is documented and wired correctly via build-time env or runtime config (e.g., `VITE_GITHUB_CLIENT_ID` / `OAUTH_CLIENT_ID`) and is not left as a fallback/hard-coded value in production builds.
3. Documentation clearly identifies the required secrets and their mappings:
   - `OAUTH_CLIENT_ID` → `VITE_GITHUB_CLIENT_ID` (build-time env for the mobile PWA)
   - `RELAY_HTTP_URL` → `VITE_RELAY_HTTP_URL`
   - `RELAY_WS_URL` → `VITE_RELAY_WS_URL`
   - `RELAY_JWT_SECRET` (server-side secret for the relay)

## Plan / Approach

1. Inspect the mobile companion source (`mobile-companion/src/services/authService.ts`) to verify how `redirect_uri`, `client_id`, and relay URLs are resolved.
2. Confirm whether production builds set `VITE_GITHUB_REDIRECT_URI` and `VITE_GITHUB_CLIENT_ID` in the deployment pipeline (CI/CD or hosting environment). If not, add instructions and/or CI checks to require them.
3. Update `mobile-companion/README.md` (or add `docs/mobile-companion-setup.md`) to:
   - Recommend setting `VITE_GITHUB_REDIRECT_URI=https://relay.sfrsh.xyz/auth/callback` for production OAuth configuration.
   - Document required env vars / secrets and where to configure them in the build/deploy pipeline.
4. Confirm `VITE_RELAY_HTTP_URL` and `VITE_RELAY_WS_URL` are set to production relay endpoints (e.g., `https://relay.sfrsh.xyz` and `wss://relay.sfrsh.xyz/ws` or `wss://relay.sfrsh.xyz/v1/ws` depending on routing).
5. Run a manual validation in a staging/prod-like environment: perform the login flow and ensure there are no OAuth callback fetch errors.
6. If fallback values (like `FALLBACK_CLIENT_ID`) are present in production builds, replace with an explicit configuration requirement (fail fast / surface a clear error) rather than silently using fallbacks.

## Validation Notes

Manual validation steps:
1. Deploy or run a production build of the mobile companion with production envs set (`VITE_GITHUB_CLIENT_ID`, `VITE_GITHUB_REDIRECT_URI=https://relay.sfrsh.xyz/auth/callback`, `VITE_RELAY_HTTP_URL`, `VITE_RELAY_WS_URL`).
2. In the mobile companion, start login and confirm GitHub redirects to `https://relay.sfrsh.xyz/auth/callback` and the relay exchanges the code successfully.
3. Confirm the mobile companion receives a token (no `OAuth callback fetch` errors) and the user is authenticated.

## Notes / Discoveries

- The repo currently contains local defaults and a fallback client id; this task may require minor docs and deployment-pipeline updates.
- Assumption: production uses the shared relay at https://relay.sfrsh.xyz and the OAuth callback is set to https://relay.sfrsh.xyz/auth/callback.

## Attempts / Log

- 2026-02-05: Updated mobile companion and relay docs to spell out production callback, env var mappings, and the `/v1/ws` WebSocket path.
- Validation: not run (docs-only change).

## Next Steps / Suggested Adjacent Work

- Add a CI check to fail builds if `VITE_GITHUB_CLIENT_ID` is missing or equals the fallback (prevent accidental production builds with embedded fallback).
- Add an e2e test that covers the mobile OAuth login flow (staging environment or mocked relay).
- Update deploy docs to include explicit instructions for injecting the required environment variables in the selected static host (Cloudflare Pages, GitHub Pages, etc.).
