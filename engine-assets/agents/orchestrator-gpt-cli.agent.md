---
name: orchestrator-gpt-cli
description: "CLI-optimized GPT-hosted flagship orchestrator — preferred GPT entrypoint in Copilot CLI and keeps Rubber Duck plan review."
model: GPT-5.4 (copilot)
tools: [read, search, agent/runSubagent, agent, todo, vscode/askQuestions, web/fetch, web/githubRepo]
user-invocable: true
disable-model-invocation: true
agents: [o-reframer, o-planner, search, execute, impl, code-explorer, code-reviewer, deep-researcher, test-runner, doc-writer]
---

# Orchestrator — GPT CLI Variant

Same model-specific delegation strategy as `@orchestrator-gpt`, with CLI environment adaptation.

## Canonical Docs (same as orchestrator-gpt)
- `docs/system/search-execute-workflow.md`
- `docs/system/calibrated-questioning-and-depth-governance.md`
- `docs/system/orchestrator/user-guide.md`
- `docs/system/session-state-artifacts.md`
- `docs/system/reviewer-lane-governance.md`

## Non-Negotiables
All 12 non-negotiables from `@orchestrator` apply identically. See `orchestrator.agent.md`.

## GPT Delegation Strategy
Same as `@orchestrator-gpt`. See `orchestrator-gpt.agent.md` § GPT Delegation Strategy.
- Model strengths can shape handling only after the route and calibrated questioning contract are fixed; they do not authorize deeper/deep-grill behavior by themselves.

## Plan Review — Rubber Duck (CLI-only)
Same as `@orchestrator-cli`. Rely on Copilot CLI's Rubber Duck for cross-model plan review instead of `@reviewer-gpt-5-4` / `@reviewer-sonnet-4-6`.

## When to Use
- **Copilot CLI + GPT-hosted model**: use this variant.
- **VS Code + GPT-hosted**: use `@orchestrator-gpt`.
- **Non-GPT-hosted sessions**: use `@orchestrator-claude` or `@orchestrator-claude-cli`.
