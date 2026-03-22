---
created: 2026-03-07
updated: 2026-03-17
category: system
status: current
doc_kind: node
id: search-execute-workflow
summary: Canonical search/execute workflow for capability discovery and application across agents, docs, and vault-first skills.
tags: [agents, skills, search-execute, orchestration]
related: [catalog-control-plane, skills-governance, orchestration-and-agents, system-upgrade-direction-2026, project-conventions-governance, documentation-structure-governance, reviewer-lane-governance, follow-up-discovery-governance]
---

# Search/Execute Workflow

## Purpose

Instruction Engine uses a staged search/execute workflow to keep context small while still making
the full capability set available on demand. The delivered workflow is backed by the shared local
catalog/search control plane in `copilot-ui`, not by separate per-surface discovery logic.

## Workflow

1. Select or infer the relevant repo context when repo-local `.github/*` assets or stack targeting
   matter.
2. Read the active routing-policy snapshot when available. The intended snapshot is a compact view of:
    - current profile (for example `balanced-default`)
    - user-global active bundles
    - repo-specific overrides
    - eligible capabilities or eligible capability families
3. If the next action is a deterministic core-lane step (for example reframe, plan, known review, or
   direct work-unit execution), route directly without broad capability search.
4. Otherwise use `@search` to resolve the smallest relevant **eligible** capability for the task.
5. Use `@execute` to load that capability and extract only the constraints and steps needed
   downstream.
6. Delegate actual implementation, testing, review, or documentation work to the normal specialist
   agents.

## Deterministic capability families

When user intent is explicit, the orchestrator should prefer deterministic routing over broad search
for these capability families:

- project conventions governance -> `docs/system/project-conventions-governance.md`
- documentation and project-structure governance -> `docs/system/documentation-structure-governance.md`
- specialist reviewer lanes -> `docs/system/reviewer-lane-governance.md`
- follow-up and research discovery -> `docs/system/follow-up-discovery-governance.md`

Use `@search` only when the user intent does not clearly identify the right family or when multiple
eligible capabilities remain plausible after the first-pass classification.

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

## Skill-discovery resolver contract

When work needs a vault-first skill and no deterministic core-lane route already applies, use this exact order:

1. direct load when the user or caller already named the exact skill
2. stack detection plus nearby manifest/index hints for project/framework clues
3. catalog-backed metadata search using the shared ranking service
4. semantic fallback only when the earlier steps do not produce a confident answer

Resolver rules:

- stop at the first confident match instead of continuing to broader search
- prefer the narrowest domain fit over broader/general skills
- on equally narrow skill ties, choose lexical order by skill name
- load one primary skill first, then at most two supporting skills only if the current step requires them

Load the resolved `SKILL.md` as soon as one of these is true:

- the exact skill was explicitly named
- stack detection yields a clear relevant skill
- catalog search returns a confident top candidate
- only one narrow candidate remains after deterministic tie-breaking

If no confident match exists, surface the best candidate plus the ambiguity; do not speculatively load multiple broad skills.

### Compatibility and default-handled exclusions

The approved routing posture in `balanced-default` mode is to avoid auto-selecting skills classified in [docs/system/skills-governance.md](docs/system/skills-governance.md) as either deprecated compatibility surfaces or default-handled surfaces.

- Deprecated skills load only when the user/caller explicitly names them or when compatibility with older prompts/docs requires that exact surface.
- Default-handled skills load only on explicit request or compatibility need; otherwise the work should proceed through direct/base-model handling without auto-selecting the skill.
- Until explicit runtime enforcement exists, treat this as prompt/orchestrator guidance and approved routing posture rather than catalog-backed enforcement.
- Manifest governance labels remain descriptive only; current catalog/runtime consumers must not treat them as enforced runtime policy.

## Default orchestration policy: `balanced-default`

The default planning/orchestration posture is **balanced-default**:

- `@orchestrator` remains the recommended general entry point
- auto-routing should prefer capabilities that are **installed + active + eligible**
- activation is derived from **user-global defaults** plus **repo-specific overrides**
- the eligible set must stay curated and visible rather than unconstrained

Interpretation rules:

- the source install provides the shipped first-party baseline only
- user-global active bundles are optional post-install layers, not an automatic copy step
- repo-specific overrides matter only when a repo is selected and contributes repo-local assets or overlay policy

### Eligibility precedence

The effective default routing set should be derived in this order:

1. explicit user request or explicit override
2. repo-specific profile/bundle override
3. user-global active profile/bundles
4. fallback-curated first-party baseline when runtime policy state is unavailable

### Fallback-curated behavior

Until all runtime surfaces can provide the routing-policy snapshot, prompts should fail safe:

- declare that routing is operating in `fallback-curated` mode
- keep automatic selection inside the shipped first-party orchestrator baseline
- do not auto-select deprecated compatibility surfaces or default-handled skills from fallback alone
- do not auto-select provider/imported capabilities, optional audit lanes, cross-model reviewers,
  or persisted session-state workflows from fallback alone

This is the strongest safe prompt/doc guardrail available before backend/runtime enforcement lands.

### Implemented runtime policy hook

The catalog/search backend now derives a compact routing-policy snapshot directly from the persisted
activation/profile state and the current catalog projection. Runtime/search surfaces can consume:

- `profile`
- `activeBundleIds`
- `repoOverride`
- `eligibleAssetIds`
- `eligibleCapabilityFamilies`

`POST /api/search/query` applies that snapshot in `eligible-only` mode by default and only bypasses it
when the caller explicitly sets the override flag. `GET /api/catalog/summary` and runtime health/search
responses surface the snapshot so orchestrator bootstrap can pass the same deterministic policy into
`@search`.

## Ownership Split

The first-party runtime/catalog layer is the canonical home for reusable typed search and
resolution contracts:

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
- In default orchestration, prefer `eligible-only` capability search unless the user explicitly asks to override.
- Prefer canonical docs over research notes.
- Load one primary capability first, then at most two supporting capabilities.
- Do not eagerly load whole skills when a narrow execution brief will do.

## When to use `@search` and `@execute`

Use `@search` when:

- the right capability is not already obvious
- the task may map to a vault skill, canonical doc, or provider/imported capability
- multiple eligible capabilities could plausibly fit and the orchestrator needs the narrowest one

Skip broad search when:

- the route is deterministic (`@o-reframer`, `@o-planner`, `@code-reviewer`, direct test/doc lane)
- the user already named the exact capability and no discovery is needed

Use `@execute` when:

- `@search` has resolved a capability and downstream work needs a compact brief
- the user/caller already selected a capability but downstream workers should receive distilled constraints instead of the full source material

Do not use `@execute` as a second discovery pass; it applies a selected capability, it does not choose one.

## Observable routing signals

Search/orchestration surfaces should make the applied policy visible in human-readable form whenever
capability selection is not trivial:

- `profile=<...>`
- `eligibility=<eligible-only|explicit-override|fallback-curated>`
- `repoOverride=<yes|no|unknown>`
- a short explanation of why the chosen capability was allowed

## Validation

- Manifest and load-mode validation must keep most skills out of the scan path.
- Skill discovery metadata must remain in sync with skill assets.
- UI and API surfaces should show vault-only skills, not just scan-path skills.
- Orchestration prompts should route capability discovery through `@search` and capability application through `@execute`.
- Orchestration prompts should make the applied profile/eligibility mode visible and keep fallback behavior safely curated when runtime policy state is absent.
- `GET /api/runtime/catalog-health` and `GET /api/catalog/summary` should show fresh projection
  state after a rebuild.
