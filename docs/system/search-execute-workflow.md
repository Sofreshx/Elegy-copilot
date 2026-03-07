---
created: 2026-03-07
updated: 2026-03-07
category: system
status: current
doc_kind: node
id: search-execute-workflow
summary: Canonical search/execute workflow for capability discovery and application across agents, docs, and vault-first skills.
tags: [agents, skills, search-execute, orchestration]
related: [skills-governance, orchestration-and-agents, system-upgrade-direction-2026]
---

# Search/Execute Workflow

## Purpose

Instruction Engine uses a staged search/execute workflow to keep context small while still making the full capability set available on demand.

## Workflow

1. Use `@search` to resolve the smallest relevant capability for the task.
2. Use `@execute` to load that capability and extract only the constraints and steps needed downstream.
3. Delegate actual implementation, testing, review, or documentation work to the normal specialist agents.

## Capability Sources

- Canonical docs in `docs/system/**`
- First-class agent assets in `engine-assets/agents/*.agent.md`
- Always-loaded meta-skills in `~/.copilot/skills/`
- On-demand domain skills in `~/.copilot/skills-vault/`

## Vault-First Skill Model

The majority of skills should remain `on-demand` and live outside the auto-discovery scan path. Only transversal meta-skills stay always loaded:

- `core-guardrails`
- `skill-discovery`
- `implementation-friction`
- `stack-detector`

This keeps startup context small and makes skill loading an explicit act.

## Ownership Split

Elegy is the canonical home for reusable typed search and resolution contracts:

- Discovery index models and schema
- Search scoring behavior
- Secure vault resolution behavior
- Agent validation contracts

Instruction Engine owns:

- Prompt and agent assets
- Install layout and vault-first defaults
- UI/runtime surfacing
- Metadata generation and integration glue

## Operating Rules

- Prefer deterministic routing before broad search.
- Prefer canonical docs over research notes.
- Load one primary capability first, then at most two supporting capabilities.
- Do not eagerly load whole skills when a narrow execution brief will do.

## Validation

- Manifest and load-mode validation must keep most skills out of the scan path.
- Skill discovery metadata must remain in sync with skill assets.
- UI surfaces should show vault-only skills, not just scan-path skills.
- Orchestration prompts should route capability discovery through `@search` and capability application through `@execute`.