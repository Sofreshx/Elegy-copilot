---
created: 2026-03-07
updated: 2026-03-26
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

For write-capable feature or modification work, this workflow is docs-first: load the smallest
relevant canonical docs entrypoint before implementation, then expand only as the current step
requires. When intended design, behavior, or workflow policy changes, it is also docs-update-first:
the first execution slice should update the relevant canonical docs before or alongside
implementation.

## Workflow

1. Load the smallest relevant canonical docs entrypoint for the task. Start from
   `docs/system/index.md`, a relevant MOC, or a deterministic core-lane node, then expand only if
   the current step needs more detail.
   For write-capable leaf execution on work that affects behavior, workflow policy, or a
   documentation-backed feature, this bootstrap must happen inside the leaf as well; the leaf must
   independently load the smallest relevant canonical entrypoint instead of relying only on an
   orchestrator brief, spec, or exploration summary.
2. Select or infer the relevant repo context when repo-local `.github/*` assets or stack targeting
   matter.
3. Read the active routing-policy snapshot when available. The intended snapshot is a compact view of:
    - current profile (for example `balanced-default`)
    - user-global active bundles
    - repo-specific overrides
    - eligible capabilities or eligible capability families
4. If the next action is a deterministic core-lane step (for example reframe, plan, known review, or
   direct work-unit execution), route directly without broad capability search.
5. Otherwise use `@search` to resolve the smallest relevant **eligible** capability for the task.
6. Use `@execute` to load that capability and extract only the constraints and steps needed
   downstream.
7. Delegate actual implementation, testing, review, or documentation work to the normal specialist
   agents.

## Docs-First Progressive Disclosure

The same progressive-disclosure rule applies to both humans and AI:

- start from compact canonical entrypoints and expand only as needed
- treat progressive disclosure as a standing requirement for docs and entrypoints, not a one-time
   bootstrap hint
- prefer `docs/system/**` for canonical intent and deterministic routing
- use other maintained docs in `docs/**` plus approved repo operating docs as important design and
  operating context, without treating them as equal authority with `docs/system/**`

When intended work materially contradicts current documentation, surface the contradiction and ask
the user for direction before proceeding with implementation or other write-capable work.
Implementation lanes must stop for clarification or replan instead of silently overriding the
current docs truth.
Write-capable leaves must perform this contradiction check against the canonical entrypoint they
independently loaded for the active work unit rather than assuming an upstream summary stayed
complete.

## Planning-Surface Routing Posture

Before broad capability search, the orchestrator should classify planning-oriented requests with the
normalized route-selection fields from [docs/system/planning-backlog-roadmap-contract.md](docs/system/planning-backlog-roadmap-contract.md):

- `planning_surface`
- `session_horizon`
- `execution_readiness`
- `overlap_risk`

Deterministic routing posture:

- `planning_surface: roadmap` -> route directly to `@roadmap-planner` as a **leaf-only** roadmap/backlog lane for durable multi-session planning
- `planning_surface: plan-pack` -> route to the plan-pack lane only when `execution_readiness` is `ready` or `stageable`; `@o-planner` remains the **leaf-only** execution-planning lane
- `planning_surface: both` -> keep `@orchestrator` as the coordinator, route roadmap work first, then route the selected slice to `@o-planner` only when that slice is `ready` or `stageable`; do not allow coordinator handoff from `@roadmap-planner` to `@o-planner`
- `planning_surface: none` -> do not create roadmap or plan-pack artifacts; route directly to the bounded delivery/reporting lane needed for the request, such as commit prep, review prep, or CI result checks

This posture keeps planning-surface choice explicit, preserves the bounded coordinator topology, and avoids
mixing durable roadmap authority with session execution state by default.

Plan-pack generation runs only when `planning_surface` includes `plan-pack` and `execution_readiness`
is `ready` or `stageable`. `roadmap`, `none`, and `not-ready` postures must not invoke
`@o-plan-coordinator` or `@o-planner`.

## V1 Nested Coordinator Posture

The shipped V1 nested topology is intentionally narrow:

- `@orchestrator` remains the root session owner and the root loop owner.
- The effective repo depth cap is 3: `@orchestrator` -> approved coordinator -> leaf.
- Host/runtime nesting support up to depth 5 is runtime headroom only; the shipped repo topology stays bounded and explicit rather than generally recursive.
- Approved coordinator agents must be named and explicitly allowlisted in frontmatter; all other
   agents remain leaf-only.
- Planning-time `@search` / `@execute` may be invoked only by the approved read-only planning
   coordinator path, `@o-plan-coordinator`, under orchestrator-owned routing policy. `@o-planner`
   remains leaf-only.
- `@o-validation-coordinator` is the bounded validation-overlap exception and may delegate only to
   `@unit-test-runner` and `@integration-test-runner`; integration remains user-confirmed.
- `@e2e-validator` -> `@e2e-browser` remains the narrow validation coordinator exception.
- Write-capable implementation lanes and reviewer lanes remain leaf-only in V1.
- Coordinator-to-coordinator chains are forbidden in V1.
- If nested planning is unavailable or disabled, use the legacy-depth-1 fallback: direct
   orchestrator -> `@o-planner` planning.

Within this topology, planning-surface selection remains orchestrator-owned. `@roadmap-planner` and
`@o-planner` stay leaf-only even when the request moves through `roadmap`, `plan-pack`, or `both`
postures.

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

- Load the smallest relevant canonical docs entrypoint before write-capable feature or modification work.
- Prefer deterministic routing before broad search.
- Keep nested routing inside the V1 approved-coordinator posture; approved coordinators may not
   re-root session ownership, routing policy ownership, or chain to other coordinators.
- Keep validation overlap bounded to completed or frozen slices that satisfy overlap-risk,
   dependency-safety, and repo-policy checks; never treat it as permission for unrestricted parallel writes.
- In default orchestration, prefer `eligible-only` capability search unless the user explicitly asks to override.
- Prefer canonical docs over research notes.
- Surface material contradictions between intended work and current documentation before proceeding.
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
