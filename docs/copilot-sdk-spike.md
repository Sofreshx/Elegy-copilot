# Copilot SDK Spike Notes (Technical Preview)

This doc captures a *minimal, practical* investigation path for using the GitHub Copilot SDK (Copilot CLI SDKs) to improve Instruction Engine tooling (VS Code extension + potential PWA/web UI).

## What the SDK is
The Copilot SDK provides programmatic control of Copilot CLI via JSON-RPC (Node/Python/Go/.NET). It supports:
- Multi-turn sessions
- Tool execution (custom tools)
- Lifecycle control (start/stop/forceStop)
- Session hooks (pre/post tool use, errors)

## Why it matters for Instruction Engine
### 1) Hard safety enforcement via hooks (stronger than “agent instructions”)
We already use repo hook scripts (Copilot agent hooks) to deny unsafe terminal commands.

The Copilot SDK offers a second enforcement layer: **Session Hooks** (`onPreToolUse`) can deny or modify tool calls centrally:
- auto-inject a default timeout if missing
- deny `timeout=0`
- deny `isBackground=true`
- deny watch/interactive test modes
- enforce allowlists/denylists for tools

This can prevent hangs even when repo hooks are not installed in a target repo.

### 2) Better “integrated” experience for extension/PWA
If the extension (or a web UI) runs the Copilot SDK client:
- it can display streaming events (`assistant.message_delta`) and tool events
- it can show structured progress for test/e2e runs
- it can implement an explicit “Abort” button by calling `session.abort()`

## Practical next steps (small-to-large)
### A) Documentation-only (done here)
- Keep this doc current.

### B) Minimal PoC (extension side)
- Add a developer-only command in the VS Code extension that:
  1) starts a Copilot SDK client
  2) creates a session
  3) installs a strict `onPreToolUse` hook enforcing timeouts + non-background
  4) sends a simple prompt and prints event stream to an OutputChannel

Acceptance: can start/stop cleanly and deny an intentionally unsafe tool call.

### C) Policy unification
- Define one “execution policy” contract (timeouts, non-background, non-watch) and apply it in:
  - repo hooks (when present)
  - SDK hooks (when using SDK)
  - agent instructions (always)

## References
- Copilot SDK announcement (technical preview): https://github.blog/changelog/2026-01-14-copilot-sdk-in-technical-preview/
- SDK repo: https://github.com/github/copilot-sdk
- Node.js SDK: https://github.com/github/copilot-sdk/tree/main/nodejs
- .NET SDK: https://github.com/github/copilot-sdk/tree/main/dotnet
