---
name: e2e-playwright-mcp
description: "DEPRECATED — Use e2e-browser agent instead. Replaced by agent-browser CLI."
tools: []
user-invokable: false
disable-model-invocation: true
---

# E2E Playwright MCP Agent (DEPRECATED)

> **This agent is deprecated.** Use `e2e-browser` instead, which uses `agent-browser` CLI (vercel-labs/agent-browser).
>
> The Playwright MCP approach was abandoned because MCP tools were blocked/unavailable in 4+ consecutive sessions.
> - For scripted regression tests, use Playwright CLI directly (`npx playwright test`).
> - For exploratory/agent-driven browser testing, use the `e2e-browser` agent.
> - For live observation, use `e2e-live-observer`.
