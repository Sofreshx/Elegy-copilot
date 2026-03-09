---
created: 2026-03-07
updated: 2026-03-09
category: system
status: current
doc_kind: node
id: search-execute-workflow
summary: Canonical search/execute workflow for capability discovery and application across agents, docs, and vault-first skills.
tags: [agents, skills, search-execute, orchestration]
related: [catalog-control-plane, skills-governance, orchestration-and-agents, system-upgrade-direction-2026]
---

# Search/Execute Workflow

## Purpose

Instruction Engine uses a staged search/execute workflow to keep context small while still making
the full capability set available on demand. The delivered workflow is backed by the shared local
catalog/search control plane in `copilot-ui`, not by separate per-surface discovery logic.

## Workflow

1. Select or infer the relevant repo context when repo-local `.github/*` assets or stack targeting
   matter.
2. Use `@search` to resolve the smallest relevant capability for the task.
3. Use `@execute` to load that capability and extract only the constraints and steps needed
   downstream.
4. Delegate actual implementation, testing, review, or documentation work to the normal specialist
   agents.

## Capability Sources

- Canonical docs in `docs/system/**`
- First-class agent assets in `engine-assets/agents/*.agent.md`
- Always-loaded meta-skills in `~/.copilot/skills/`
- On-demand domain skills in `~/.copilot/skills-vault/`
- Repo-local assets in `<repo>/.github/agents` and `<repo>/.github/skills/`

## Vault-First Skill Model

The majority of skills should remain `on-demand` and live outside the always-loaded scan path.
Only transversal meta-skills stay always loaded:

- `core-guardrails`
- `skill-discovery`
- `implementation-friction`
- `stack-detector`

This keeps startup context small and makes skill loading an explicit act.

Catalog-backed discovery still exposes vault-first skills in search results and UI views even when
they are not already loaded into context. Repo-local overrides participate in the same effective
state calculation once a repo is selected or supplied to the control plane.

## Catalog-backed routing

The canonical routing implementation is shared:

- backend/API: `POST /api/search/query`
- selection telemetry: `POST /api/search/selection`
- CLI wrapper: `node scripts/skill-search.mjs`
- ranking/runtime library: `copilot-ui/lib/skillSearchService.js`

Deterministic ranking considers:

- exact skill key/title/alias matches
- trigger phrases and descriptions
- framework / stack / language / tag targeting
- repo/workspace context
- preferred load mode
- recommendation signals

Results include explanation codes so search, UI, and telemetry all describe *why* a skill matched.

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
- UI and API surfaces should show vault-only skills, not just scan-path skills.
- Orchestration prompts should route capability discovery through `@search` and capability application through `@execute`.
- `GET /api/runtime/catalog-health` and `GET /api/catalog/summary` should show fresh projection
  state after a rebuild.
