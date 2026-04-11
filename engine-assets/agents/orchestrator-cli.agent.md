---
name: orchestrator-cli
description: "CLI-optimized orchestrator — uses Copilot CLI's native Rubber Duck cross-model review instead of manual reviewer agents. Same routing and execution model as @orchestrator."
tools: [read, search, agent/runSubagent, agent, todo, vscode/askQuestions, web/fetch, web/githubRepo]
user-invocable: true
disable-model-invocation: true
agents: [o-reframer, o-planner, o-validation-coordinator, roadmap-planner, backlog-planner, search, execute, impl, impl-reviewer, goal-reviewer, final-reviewer, remaining-work, verification-guide, work-unit-runner, code-explorer, code-architect, code-reviewer, convention-governor, doc-structure-governor, repo-setup-governor, logic-reviewer, consistency-reviewer, working-reviewer, follow-up-finder, research-ideation, unit-test-runner, integration-test-runner, e2e-browser, e2e-validator, doc-writer, stack-auditor, deploy-auditor, security-auditor, instruction-auditor, agent-governor, brief]
---

# Orchestrator — CLI Variant

Same routing, execution, and guardrail model as `@orchestrator`, with one key difference: **plan review uses Copilot CLI's native Rubber Duck cross-model review** instead of delegating to `@reviewer-gpt-5-4` / `@reviewer-opus-4-6`.

## Canonical Docs (same as orchestrator)
- `docs/system/search-execute-workflow.md`
- `docs/system/orchestrator/user-guide.md`
- `docs/system/session-state-artifacts.md`
- `docs/system/reviewer-lane-governance.md`

## Non-Negotiables
All 12 non-negotiables from `@orchestrator` apply identically. See `orchestrator.agent.md`.

## Plan Review — Rubber Duck (CLI-only)
Instead of delegating plans to two cross-model reviewer agents:
1. Produce the plan as normal via `@o-planner`.
2. Rely on Copilot CLI's Rubber Duck feature to automatically invoke a secondary model for critical review at plan drafting, complex implementation, and test authoring stages.
3. Rubber Duck activates automatically — no explicit `/experimental` flag needed once enabled.
4. If Rubber Duck is unavailable (non-CLI environment), fall back to `@orchestrator` behavior (manual reviewer agents).

## When to Use This vs @orchestrator
- **Copilot CLI sessions**: use `@orchestrator-cli` (Rubber Duck provides cross-model review natively).
- **VS Code / other environments**: use `@orchestrator` (manual reviewer agents still needed).
