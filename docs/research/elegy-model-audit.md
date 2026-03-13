---
created: 2026-02-23
updated: 2026-02-23
category: research
status: current
doc_kind: node
id: elegy-model-audit
summary: Audit notes and best practices for the Elegy planning/execution model.
tags: [elegy, audit]
---

# Elegy Model Audit & Best Practices

## Overview
The Elegy model is a hierarchical, plan-first agent architecture designed for complex software engineering tasks. It separates ideation, high-level direction, detailed sub-planning, and execution into distinct phases handled by specialized sub-agents.

## General Flow
1. **Ideation & Clarification (`@elegy-ideation`)**: Converts raw user requests into a concrete, scoped brief with risks and open questions.
2. **High-Level Direction (`@elegy-direction`)**: Takes the brief and produces a consistent high-level direction, identifying distinct workstreams and dependencies.
3. **Parallel Sub-Planning (`@elegy-subplanner`)**: Takes individual workstreams and breaks them down into explicit, actionable Work Units (files, logic, validation) in parallel.
4. **Assembly & Review (`@elegy-planner`)**: Assembles the high-level plan and sub-plans into a single Execution Plan. Runs cross-model reviews (`@reviewer-opus-4-6`, `@reviewer-gpt-5-4`) at both the high-level and sub-plan stages.
5. **Execution (`@elegy-orchestrator`)**: Executes the approved plan sequentially, delegating specific Work Units to implementation agents (`@impl-business`, `@impl-infra`).

## Potential Issues & Pitfalls
- **Session Bleed**: Agents (especially the planner) might accidentally read or reference plans from past sessions if the session state directory (`~/.copilot/session-state/`) is not properly isolated. *Mitigation: Enforce strict `SESSION_ID` scoping and explicit instructions to ignore other sessions.*
- **Reviewer Deadlocks**: Cross-model reviewers might disagree or get stuck in a loop of `NEEDS_REVISION`. *Mitigation: Implement a strict revision budget (e.g., max 3 rounds) and an escape hatch to ask the user for an override.*
- **Context Overflow in Sub-Planners**: Passing the entire codebase context to parallel sub-planners can lead to token limits or hallucinated dependencies. *Mitigation: Provide only the High-Level Plan and specific workstream context to each sub-planner.*
- **Loss of State During Handoff**: If the orchestrator loses track of the plan file, execution halts. *Mitigation: Always persist the plan to disk (`~/.copilot/session-state/{SESSION_ID}/plan.md`) and pass the exact file path during handoff.*

## Proposed Structure & Tips (Aligning with Official Copilot Docs)
1. **Leverage Agent Hooks**:
   - We currently do not use hooks extensively. We should implement `.github/hooks/pre-session.json` and `post-session.json` to automatically set up the environment, validate dependencies, or clean up temporary files.
   - Hooks can ensure deterministic automation (e.g., starting a local database before integration tests run).
2. **Standardize Session IDs**:
   - Ensure both Copilot CLI and VS Code (via `RannIA`) generate consistent, unique Session IDs and write them to the unified `~/.copilot/session-state/` directory.
3. **Use `vscode/askQuestions` Effectively**:
   - Batch questions to avoid interrupting the user multiple times.
   - Always provide a `recommended` default option to speed up decision-making.
4. **Parallel Execution**:
   - Use parallel sub-agents for independent workstreams during planning, but enforce sequential execution during implementation to avoid git conflicts or race conditions.
5. **Durable Memory**:
   - Use the unified `~/.copilot/session-state/` directory for durable session artifacts (plans, propositions, revisions) rather than cluttering the repo with temporary state files.
