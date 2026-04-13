---
name: orchestrator-gpt-cli
description: "CLI-optimized GPT-hosted orchestrator — uses Rubber Duck for plan review. Same model-specific delegation strategy as @orchestrator-gpt."
model: GPT-5.4 (copilot)
tools: [read, search, agent/runSubagent, agent, todo, vscode/askQuestions, web/fetch, web/githubRepo]
user-invocable: true
disable-model-invocation: true
agents: [o-reframer, o-planner, o-validation-coordinator, roadmap-planner, backlog-planner, search, execute, impl, impl-reviewer, goal-reviewer, final-reviewer, remaining-work, verification-guide, work-unit-runner, code-explorer, code-architect, code-reviewer, convention-governor, doc-structure-governor, repo-setup-governor, logic-reviewer, consistency-reviewer, working-reviewer, follow-up-finder, research-ideation, unit-test-runner, integration-test-runner, e2e-browser, e2e-validator, doc-writer, stack-auditor, deploy-auditor, security-auditor, instruction-auditor, agent-governor, prompt-refiner, brief]
---

# Orchestrator — GPT CLI Variant

Same model-specific delegation strategy as `@orchestrator-gpt`, with CLI environment adaptation.

## Non-Negotiables
All 12 non-negotiables from `@orchestrator` apply identically. See `orchestrator.agent.md`.

## GPT Delegation Strategy
Same as `@orchestrator-gpt`. See `orchestrator-gpt.agent.md` § GPT Delegation Strategy.

## Plan Review — Rubber Duck (CLI-only)
Same as `@orchestrator-cli`. Rely on Copilot CLI's Rubber Duck for cross-model plan review instead of `@reviewer-gpt-5-4` / `@reviewer-opus-4-6`.

## When to Use
- **Copilot CLI + GPT-hosted model**: use this variant.
- **VS Code + GPT-hosted**: use `@orchestrator-gpt`.
- **Non-GPT-hosted sessions**: use `@orchestrator-claude` or `@orchestrator-claude-cli`.
