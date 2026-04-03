---
created: 2026-04-03
updated: 2026-04-03
category: meta
status: current
doc_kind: redirect
redirect_to: docs/system/e2e-setup-guide.md
---

# E2E Setup Guide Compatibility Note

This top-level document is a compatibility pointer only. The canonical browser-validation guidance now
lives under [docs/system/e2e-setup-guide.md](docs/system/e2e-setup-guide.md) and
[docs/system/validation-governance.md](docs/system/validation-governance.md).

Current canonical policy:

- Agent-driven browser validation uses `@e2e-validator` -> `@e2e-browser` with `agent-browser` CLI.
- Durable scripted browser suites use Playwright CLI/test runner.
- Playwright MCP is not the default Instruction Engine browser-validation path.
- Integration or E2E validation may be mandatory based on policy or risk, even without an explicit
  user request.

Use this file only as a redirect surface for older links. Do not treat it as the source of truth.
