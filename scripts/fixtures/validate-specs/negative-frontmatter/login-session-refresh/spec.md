---
spec_id: login-session-refresh
title: Login Session Refresh
status: active
updated: 2026/05/21
---

# Login Session Refresh

## Intent

Define the durable contract for session refresh behavior after access token expiry.

## Context Evidence

- `src/auth/session.ts`: current refresh path

## Requirements

- Refresh access tokens when a valid refresh token is present.

## Acceptance Checks

- Expired access tokens refresh without forcing re-login when the refresh token is valid.
- Invalid refresh tokens force the existing signed-out path.

## Implementation Links

- `src/auth/session.ts`

## Validation Evidence

- Pending implementation.

## Drift Notes

- None.
