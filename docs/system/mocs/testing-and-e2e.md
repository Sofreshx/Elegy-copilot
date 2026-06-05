---
created: 2026-02-23
updated: 2026-04-15
category: system
status: current
doc_kind: moc
id: testing-and-e2e
summary: Map of content for local testing, E2E guidance, and hang prevention.
tags: [testing, e2e]
related: [system-docs-index, testing-quality-governance, validation-governance]
---

# MOC — Testing & E2E

## When to read

- You are adding or updating test strategy for scripts, UI, or local tracker.
- You need E2E setup rules, browser workflow constraints, or hang prevention guidance.
- You are deciding whether the consolidated `@test-runner` lane should run unit, integration, or E2E checks for a change.

## Start here

- Testing quality governance: `docs/system/testing-quality-governance.md`
- Validation governance: `docs/system/validation-governance.md` (single `@test-runner` lane for unit/integration/browser routing)
- Commit validation governance: `docs/system/commit-validation-governance.md` (umbrella pre-commit check tooling)
- E2E setup: `docs/system/e2e-setup-guide.md`
- Workflow planning contract: `docs/system/workflow-planning-contract.md`

## See also

- Agent hooks: `docs/system/agent-hooks.md`
- MCP workflow: `docs/system/mcp-workflow.md`
- Security model and safety map: `docs/system/mocs/security-model-and-safety.md`

## Depends on

- Doc graph contract: `docs/system/doc-graph-spec.md`
- System docs entrypoint: `docs/system/index.md`
