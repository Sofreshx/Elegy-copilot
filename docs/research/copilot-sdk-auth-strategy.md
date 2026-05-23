---
created: 2026-03-01
updated: 2026-03-01
category: research
status: current
doc_kind: node
id: copilot-sdk-auth-strategy
summary: Auth strategy and option mapping for Copilot SDK usage in copilot-ui bridge flows.
tags: [copilot-sdk, auth, security, bridge]
related: [copilot-sdk-spike, copilot-sdk-integration-adr]
---

# Copilot SDK Auth Strategy

This document defines the authentication strategy for `copilot-ui` when using `@github/copilot-sdk`.

## Auth Strategy Matrix

| Runtime context | Primary auth mode | CopilotClientOptions mapping | Notes |
|---|---|---|---|
| Packaged desktop app | External CLI server auth via `cliUrl` | `cliUrl` set, `githubToken` unset, `useLoggedInUser` unset | In `cliUrl` mode the external server owns auth state. SDK rejects `githubToken`/`useLoggedInUser` with `cliUrl`. |
| Local dev server | Logged-in user by default | `useLoggedInUser: true`, optional `cliPath`/`cliArgs` | Prefer existing Copilot/gh login state for developer ergonomics. |
| CI or non-interactive automation | Explicit token auth | `githubToken` from `GITHUB_TOKEN`, `useLoggedInUser: false` | Do not rely on interactive login in CI. |

## CopilotClientOptions Fields (Exact)

The Node SDK currently defines `CopilotClientOptions` with these fields:

- `cliPath?: string`
- `cliArgs?: string[]`
- `cwd?: string`
- `port?: number`
- `useStdio?: boolean`
- `cliUrl?: string`
- `logLevel?: "none" | "error" | "warning" | "info" | "debug" | "all"`
- `autoStart?: boolean`
- `autoRestart?: boolean`
- `env?: Record<string, string | undefined>`
- `githubToken?: string`
- `useLoggedInUser?: boolean`

Source of truth: `copilot-sdk/nodejs/src/types.ts`.

## No Token Persistence Guidance

- Never write `GITHUB_TOKEN` to files in the repo, including docs, logs, test snapshots, or session artifacts.
- Never store tokens in `~/.copilot/session-state/<sessionId>/` artifacts.
- Never include token values in structured logs or error payloads.
- Provide tokens through process environment at runtime only.
- If token-based auth is used, pass token through `githubToken` and keep `useLoggedInUser: false`.
- In `cliUrl` mode, do not send token or user-auth flags from the bridge process; the external CLI server manages auth.

## Operational Guardrails

- Keep bridge auth selection explicit per runtime context.
- Fail closed on invalid auth combinations (`cliUrl` with `githubToken` or `useLoggedInUser`).
- Prefer short-lived runtime environment injection over persisted credentials.
