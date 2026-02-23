---
created: 2026-02-22
updated: 2026-02-23
category: system
status: current
doc_kind: node
id: e2e-setup-guide
summary: Canonical E2E decision matrix and setup guidance (agent-browser vs Playwright suites).
tags: [e2e, browser, agent-browser, playwright]
related: [copilot-cli-playbook, agent-hooks, mcp-workflow]
---

# E2E Setup Guide (Browser Automation)

This repo supports **two** distinct E2E flows. Keeping them separate is intentional.

## Decision Matrix (Default Routing)

### 1) Agent-driven UI smoke / validation (default)
Use when you want: “does it basically work?” after a change, plus evidence (snapshots/console/errors).

- Orchestrator route: `@e2e-validator` → `@e2e-browser`
- Browser tool: `agent-browser` CLI (snapshot-ref workflow)
- Evidence: snapshot-first (screenshots on failure, or when explicitly requested)

This is the default because it is CLI-driven and token-efficient for coding agents.

### 2) Scripted regression E2E suite (Playwright tests)
Use when you have (or want) a durable, repeatable E2E test suite in a project.

- Runner route: `@integration-test-runner`
- Command baseline: `npx playwright test --headed=false`

This is the right fit for CI and repeatable regression gates.

### Not supported by default: Playwright MCP
Browser automation via Playwright MCP is **not** part of the default engine setup. Prefer the CLI routes above.

## agent-browser Prerequisites

Install (recommended global install):

```bash
npm install -g agent-browser
agent-browser install
```

Quick sanity check:

```bash
agent-browser open https://demo.playwright.dev/todomvc
agent-browser snapshot -i --json
agent-browser close
```

## Reliability Rules (Anti-Hang)

These rules match the repo’s hook-enforced policies and are required for reliable automation:

- Never use interactive/watch modes (e.g., Playwright `--ui`, `--debug`, `PWDEBUG=1`).
- Never run terminal commands in the background.
- Always use explicit timeouts when running commands through agent tooling.
- Prefer `domcontentloaded` + explicit waits for apps with long-lived connections (SignalR/SSE); avoid “network idle” semantics.

See: `docs/agent-hooks.md` and `.github/TROUBLESHOOTING-TEST-HANGS.md`.

## Optional: Legacy Playwright helper scripts in this repo

This repo includes a few Node scripts under `scripts/e2e-*.js` that use `@playwright/test`’s Chromium launcher.

- They are **not** the default E2E mechanism for the engine.
- They require `@playwright/test` to be installed in the environment where you run them.
- They enforce a hard deadline via `E2E_DEADLINE_MS` (default 60000).

If you use them, keep them headless and bounded.
