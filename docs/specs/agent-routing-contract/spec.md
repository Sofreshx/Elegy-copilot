---
spec_id: agent-routing-contract
title: Agent Routing Contract
status: draft
type: contract
updated: 2026-06-20
---

# Agent Routing Contract

## Intent

Define the authoritative contract for agent routing: lane agent types, delegation rules, subagent boundaries, and file-scope selectors. Every agent instruction file and routing decision MUST conform to this contract.

## Context Evidence

- `docs/system/mocs/orchestration-and-agents.md` — currently the canonical MOC for orchestrator and agent governance. This spec will become the normative authority.
- `docs/system/orchestrator-contracts.md` — defines orchestrator contract shapes.
- `docs/system/agent-architecture-simplicity.md` — simplicity constraints on agent architecture.
- `docs/system/agents-vs-skills.md` — decision guidance between agent routing and skill usage.
- `docs/system/agent-hooks.md` — agent hook patterns.
- `docs/system/project-lane-autonomy-design.md` — project lane autonomy design.
- `docs/system/runner-lane-design.md` — runner lane design.
- `opencode-assets/agents/` — 6 agent instruction files: project.md, quick.md, impl.md, impl-pro.md, reviewer.md, explorer.md.
- `opencode-assets/home/AGENTS-appendix.md` — lists available agents and the delegation model.
- `catalog-assets/shippedAssets.mjs` — defines which agents ship to which harnesses.
- `catalog-assets/targetRouting.mjs` — routes agents across 4 harnesses.
- No existing `docs/specs/` artifact defines the agent routing contract normatively.

## Requirements

### Allowed Behavior

#### R1 — Lane Agent Types

- R1.1: The system defines these lane primary agents: `project` (multi-session roadmap work), `quick` (small fixes, <5 min, 1-2 files).
- R1.2: Primary lane agents own workflow phases and delegate to subagents for implementation and review.
- R1.3: Subagents: `impl` (write-capable bounded implementation), `impl-pro` (stronger model variant), `reviewer` (read-only review), `explorer` (read-only discovery), `scout` (external docs/dependency research).
- R1.4: Subagents are hidden from user autocomplete; only lane primary agents invoke them via the Task tool.

#### R2 — Delegation Rules

- R2.1: Primary agents MUST delegate implementation work to `impl` or `impl-pro` subagents, not implement directly.
- R2.2: Primary agents MUST delegate review work to `reviewer` subagent before completing a lane phase.
- R2.3: Subagents MUST NOT invoke other subagents — they execute their task and return results.
- R2.4: Delegated tasks MUST include clear scope boundaries, expected output format, and validation criteria.

#### R3 — Model/Provider Routing

- R3.1: Each agent type maps to a model role: `planning` (pro model), `implementation` (fast model), `exploration` (fast model), `review` (pro model), `research` (pro model).
- R3.2: Provider profiles define model+provider routing across the 5 roles.
- R3.3: Profile switching updates agent file model fields without modifying agent logic.

#### R4 — File-Scope Selectors

- R4.1: The file-scope selector grammar is `<type>:<intent>:<selector>` defined in the spec-driven-development contract (R10).
- R4.2: Work points, plans, and roadmaps use file-scope selectors to declare primary, review, and affected files.
- R4.3: File-scope selectors MUST be used when linking planning entities to spec artifacts.

#### R5 — Agent Instruction Files

- R5.1: Each agent MUST have an instruction file (.md) defining its role, capabilities, permissions, and delegation rules.
- R5.2: Instruction files MUST NOT duplicate operational policies that belong in governance docs or normative specs.
- R5.3: Instruction files MUST reference relevant normative specs via file paths.
- R5.4: OpenCode-specific agent files live at `opencode-assets/agents/`; they follow the OpenCode agent format.

### Forbidden Behavior

- A subagent MUST NOT invoke another subagent.
- A primary agent MUST NOT implement non-trivial work directly — delegate to impl subagent.
- A primary agent MUST NOT skip the review gate before completing a work phase.
- A subagent MUST NOT exceed its stated scope or role boundaries.
- An agent instruction file MUST NOT redefine contracts from normative specs.

## Non-Goals

- Defining specific task execution rules for each agent — those are in agent instruction files.
- Defining the full orchestrator architecture — that belongs to `docs/system/orchestrator-architecture-adr.md`.
- Defining how agents interact with tools or MCP servers — that is implementation detail.
- Defining profile management or installation — that belongs to harness install governance.

## Acceptance Checks

- The spec itself passes `node scripts/validate-specs.js --strict`
  → verify: node scripts/validate-specs.js --strict docs/specs/agent-routing-contract/spec.md
- All 5 requirements with sub-requirements are present
  → verify: `rg "^#### R[1-5]" docs/specs/agent-routing-contract/spec.md | measure` returns at least 5
- Forbidden Behavior covers at least 4 prohibitions
  → verify: `rg "^-\s+A (subagent|primary|agent instruction) MUST NOT" docs/specs/agent-routing-contract/spec.md | measure` returns at least 4
- Orchestration MOC references this spec
  → verify: rg "agent-routing-contract" docs/system/mocs/orchestration-and-agents.md returns at least 1 match

## Implementation Links

- `docs/specs/agent-routing-contract/spec.md` — this file
- `docs/system/mocs/orchestration-and-agents.md` — thinned to reference this spec
- `docs/system/orchestrator-contracts.md` — referenced orchestrator contracts
- `docs/system/agent-architecture-simplicity.md` — simplicity constraints
- `opencode-assets/agents/` — agent instruction files

## Validation Evidence

- Pending implementation.

## Drift Notes

- None yet.
