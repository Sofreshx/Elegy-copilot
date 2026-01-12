# Skill: chrome-devtools-mcp (Browser E2E via MCP)
---
sources:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp
last_processed: 2026-01-11
---

## Purpose
Enable an agent to control and inspect a **real Chrome** instance through the **Model Context Protocol (MCP)** server `chrome-devtools-mcp`.

Use this when you need:
- E2E-style browser exploration
- UI/UX audits based on real behavior
- Capturing console/network/performance evidence

## Setup (VS Code / Copilot)
Add an MCP server with:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--viewport",
        "1280x720"
      ]
    }
  }
}
```

Notes:
- Requires Node.js >= 20.19 and Chrome stable (prefer current Node LTS when possible).
- Prefer `@latest` so tools stay current.

Practical reliability tip:
- For long-lived automation, consider pinning: `chrome-devtools-mcp@0.x.y` to avoid unexpected changes.

## Useful CLI flags (server-side)
These are supported by the `chrome-devtools-mcp` CLI (verify with `npx -y chrome-devtools-mcp@latest --help`):
- `--headless`: run without UI (faster, better for CI)
- `--isolated`: create a temp Chrome profile per run (reduces flakiness)
- `--userDataDir <path>`: control profile location (trade speed vs isolation)
- `--viewport 1280x720`: deterministic viewport
- `--channel stable|beta|dev|canary`: pick Chrome channel
- `--browserUrl http://127.0.0.1:9222` / `--wsEndpoint ...`: connect to an already-running Chrome
- `--executablePath <path>`: use a specific Chrome binary
- `--logFile <path>` + `DEBUG=*`: collect logs

## Core Tooling Patterns
(Exact tool names come from the MCP server; use the names shown in your client.)

### Navigation loop
1. `new_page` (or select an existing page)
2. `navigate_page` to the target URL
3. `wait_for` important text/landmarks
4. `take_snapshot`

### Interaction loop
- Use `take_snapshot` to obtain element `uid`s.
- Use `click`/`fill`/`press_key` with those `uid`s.
- Re-snapshot after each meaningful state change.

### Evidence collection
- Console: `list_console_messages`
- Network: `list_network_requests`
- Performance: `performance_start_trace` → perform flow → `performance_stop_trace`
- Visual: `take_screenshot` (only when snapshot is insufficient)

## Best Practices
- Always keep snapshots fresh; stale `uid`s cause flaky automation.
- When a flow fails, collect console + network evidence before retrying.
- If auth is required, ask for test credentials and avoid personal data.
- Test at least one smaller viewport (`resize_page`) to catch responsive issues.

## Common Failure Modes
- Node/Chrome not installed or too old.
- MCP server not registered in the client.
- App not reachable (dev server not started, wrong URL, auth required).

## Windows notes
- Keep the browser profile + npm cache on a fast local disk.
- If you control the machine, excluding the temp profile directory from realtime AV scanning can remove intermittent timeouts.

## Output Expectations
For audits, produce:
- a reproducible bug list (steps + expected vs observed)
- a UX friction list (where users struggle)
- a missing-feature list (what users obviously need)
- a prioritized backlog update (tasks.md or tasks/)
