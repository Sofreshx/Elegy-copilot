---
created: 2026-02-22
updated: 2026-07-10
category: system
status: current
doc_kind: node
id: e2e-setup-guide
summary: Canonical E2E routing and setup guidance for agent-browser validation versus durable Playwright suites.
tags: [e2e, browser, agent-browser, playwright]
related: [copilot-cli-playbook, agent-hooks, mcp-workflow]
---

# E2E Setup Guide (Browser Automation)

This repo supports **two** distinct browser-testing flows. Keeping them separate is intentional.

## Decision Matrix (Default Routing)

### 1) Agent-driven UI smoke / validation (default)
Use when you want browser confirmation during an active coding session, especially when policy or
risk requires real browser coverage for a changed surface.

- Orchestrator route: `@test-runner` when the orchestrator selects browser/E2E coverage
- Browser tool: `agent-browser` CLI (snapshot-ref workflow)
- Evidence: snapshot-first (screenshots on failure, or when explicitly requested)
- Execution rule: keep this lane serial; do not overlap it with active write work

This is the default because it is CLI-driven and token-efficient for coding agents.

### 2) Scripted regression browser suite (Playwright tests)
Use when you have, or need, a durable repeatable browser test suite in the project.

- Tool: Playwright CLI/test runner
- Command baseline: `npx playwright test --headed=false`
- Typical fit: committed regression coverage, CI gates, and durable scripted suites

This is the right fit for CI and repeatable regression gates.

## UI Craft Runtime Routing

For browser-mode UI and Tauri desktop E2E work beyond the two flows above,
`elegy-ui-craft@elegy` routes evidence collection across:

- **Browser-mode UI** (agent-browser / Playwright) — web-only exploratory coverage
- **Tauri desktop E2E** (tauri-driver + WebDriver) — real desktop app automation
- **Rust command testing** — backend command-level validation

The skill preserves the critical distinctions from the default flows above:

- **Agent-browser remains exploratory**, not a CI gate. It is for interactive session evidence, not
  durable regression.
- **Browser-mode Playwright** targets web UI only. For real Tauri desktop testing, use
  **tauri-driver + WebDriver**, not Playwright.

## When E2E Becomes Mandatory

E2E is not limited to explicit user requests. `@orchestrator` may require it when repo policy or
current risk/coverage makes unit or integration coverage insufficient.

Typical triggers include:

- auth, login, logout, or protected-navigation changes
- stateful user journeys and redirect-sensitive flows
- risky UI/API behavior changes that only a browser can confirm end to end
- new or still-untested user-facing surfaces

See [[validation-governance]] [validation-governance.md](validation-governance.md) [validation-governance](docs/system/validation-governance.md)
for the canonical mandatory-validation decision matrix.

### Not supported by default: Playwright MCP
Browser automation via Playwright MCP is **not** part of the default engine setup. Prefer the CLI
routes above.

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

See: the agent hooks documentation (previously at docs/agent-hooks.md, now incorporated into system docs).

## Optional: Legacy Playwright helper scripts in this repo

This repo includes a few Node scripts under `scripts/e2e-*.js` that use `@playwright/test`’s Chromium launcher.

- They are **not** the default agent-driven browser-validation mechanism for the engine.
- They require `@playwright/test` to be installed in the environment where you run them.
- They enforce a hard deadline via `E2E_DEADLINE_MS` (default 60000).

If you use them, keep them headless and bounded.
