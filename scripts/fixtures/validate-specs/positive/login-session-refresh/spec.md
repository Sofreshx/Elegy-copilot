---
spec_id: login-session-refresh
title: Login Session Refresh
status: implemented
type: feature
updated: 2026-05-21
---

# Login Session Refresh

## Intent

Define the durable contract for session refresh behavior after access token expiry.

## Context Evidence

- `docs/system/auth-architecture-adr.md`: current auth boundaries
- `src/auth/session.ts`: current refresh path

## Requirements

- Refresh access tokens when a valid refresh token is present.
- Preserve current signed-out behavior for invalid refresh tokens.

## Non-Goals

- No auth provider migration.
- No UI redesign.

## Acceptance Checks

- Expired access tokens refresh without forcing re-login when the refresh token is valid.
  → verify: node scripts/validate-session-refresh.js
- Invalid refresh tokens force the existing signed-out path.
  → verify: node scripts/validate-session-refresh.js

## Implementation Links

- `src/auth/session.ts`
- `src/auth/session.test.ts`

## Validation Evidence

- `npm test -- session`: passes for valid and invalid refresh token cases.

## Drift Notes

- None.
