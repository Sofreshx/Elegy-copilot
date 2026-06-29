---
created: 2026-03-07
updated: 2026-06-12
category: system
status: current
doc_kind: node
id: search-execute-workflow
summary: Canonical search/execute workflow for capability discovery and application across agents, docs, and shared skills.
tags: [agents, skills, search-execute, orchestration]
related: [catalog-control-plane, skills-governance, orchestration-and-agents, system-upgrade-direction-2026, project-conventions-governance, documentation-structure-governance, progressive-constraint-narrowing, adr-governance, reviewer-lane-governance, follow-up-discovery-governance]
---

# Search/Execute Workflow

## Purpose

Elegy Copilot uses a staged search/execute workflow to keep context small while still making
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

## Thin Tool-Facing Entrypoints

Tool-facing instructions should route into canonical docs and execution lanes, not duplicate durable policy.

- use global or repo instruction entrypoints for concise setup notes, tool affordances, and
  deterministic routing cues
- point rule-heavy guidance back to `docs/system/**`, usually through `docs/system/index.md`, the
  relevant MOC, and then the smallest node
- when passing a downstream brief, include the canonical paths to load rather than copying long
  policy blocks into the brief itself
- keep lane-selection guidance in catalog/search metadata, frontmatter descriptions, and canonical
  routing docs; lane agent bodies should use `needs-reroute` only when discovered scope exceeds the
  selected lane
- if a compact instruction surface appears to disagree with canonical docs, treat the compact surface
  as drift and follow the canonical node

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

## Repo-Rule Bootstrap for Write-Capable Work

For elegy-copilot itself, repo-rule authority stays in `docs/system/**`.

- start from `docs/system/index.md`, a relevant MOC, or a deterministic core-lane governance node
- load the smallest relevant canonical node before write-capable feature or modification work
- require the write-capable leaf to repeat that bootstrap even when an orchestrator brief, plan pack,
  `@execute` brief, or repo-local instruction file already summarized the task
- treat repo-local `.github/*` assets, installed prompts, and agent assets as routing or
  discoverability aids unless a canonical doc explicitly promotes them into higher authority
- treat repeated implementation patterns as secondary evidence for convention discovery, not as a
  substitute for canonical bootstrap
- if a repo-local asset or prompt appears to conflict with `docs/system/**`, follow `docs/system/**`
  and surface the contradiction before editing

## Canonical Guidance Compliance Loop

Elegy Copilot uses one docs-first compliance loop across planning, exploration, execution, and
review. It does not create a second rule hierarchy beyond the canonical-doc precedence already
defined above.

### Required rule loading

- planning or exploration that will constrain write-capable work must load the smallest relevant
  canonical docs entrypoint before emitting a plan, recommendation, or execution brief
- when docs-backed work is delegated, the upstream brief should name the expected canonical sources
  so the next lane can verify it is loading the right rule family
- each write-capable leaf must still independently repeat canonical bootstrap before editing instead
  of treating the upstream brief, prompt text, or repo patterns as sufficient authority
- if a step is purely read-only and does not constrain write-capable work, it may explicitly report
  `bootstrap=not-required` instead of inventing citations

### Observable reliance

- when canonical bootstrap was required, the resulting plan, execution summary, or review must make
  the relied-on canonical paths observable through `canonical_sources`, `canonical_references`, or an
  equivalent clearly labeled field
- successful write-capable outputs should state whether canonical bootstrap was required and list the
  canonical docs actually checked
- prompt text, exploration summaries, and repeated implementation patterns may appear as supporting
  context, but they do not satisfy the observable-bootstrap requirement on their own

### Progressive constraint narrowing

- after canonical bootstrap, planning and execution lanes should narrow candidate constraints to the
  minimum authoritative set needed for the active step rather than forwarding the full upstream rule
  family
- keep hard constraints visible, keep shaping context only when it materially affects the current
  step, and keep unresolved branches out of `constraints`
- if repeated constraint text is standing in for a durable architectural or workflow decision, route
  that promotion through [[adr-governance]] [adr-governance.md](adr-governance.md) or the owning canonical node instead of repeating it in more prompts and skills

### Missing bootstrap detection

Treat canonical bootstrap as missing when either of these is true:

- docs-backed work proceeds without any cited canonical sources
- the output cites only prompts, summaries, or repeated patterns even though canonical docs were
  required for the work

When bootstrap is missing:

- fail closed for the active write-capable step instead of accepting the work as complete
- return a stop signal such as `needs-clarification`, `REPLAN_REQUESTED`, or an equivalent blocked
  status rather than a success result
- route missing-authority-path problems to conventions or documentation governance instead of
  silently promoting prompt text into repo rules

### Material contradiction handling

- if canonical docs conflict with each other or with nearby maintained docs, surface the conflicting
  paths and the exact point of disagreement
- stop write-capable work and ask the user for direction before implementation continues
- do not silently resolve the conflict by coding first and updating docs later

### Skipped-guidance detection surfaces

Use existing lanes to catch skipped canonical guidance:

- `code-reviewer` is the primary review surface for request/spec-fit checks on docs-backed
  write-capable work, plus cited canonical references, docs/code alignment, skipped convention
  guidance, and high-confidence defects or regressions caused by ignored canonical guidance
- `docs/system/project-conventions-governance.md`, the always-loaded `project-guidelines` skill,
  and `guidelines-authoring` own missing-authority-path and missing-entrypoint follow-up when the real
  problem is the governance surface itself
- doc and contract validators remain the narrow validation layer for touched governance assets

### Mixed enforcement posture

- hard-stop conditions: missing canonical bootstrap when it was required, or material contradictions
  with canonical docs
- blocking review concern when applicable: a key architectural or workflow-authority change that
  needed ADR coverage but did not receive it
- review findings, not contradiction-style blockers: missing rationale or smart-comment coverage where
  the canonical rule itself is already clear
- optional polish and local cleanup remain non-blocking unless another canonical rule makes them
  mandatory

## Calibrated Questioning and Depth

The shared policy for calibrated questioning, depth calibration, and explicit deep/grill overlays lives in [calibrated-questioning-and-depth-governance.md](calibrated-questioning-and-depth-governance.md). This doc keeps staged routing, canonical bootstrap, and planning-surface mechanics.

- use the shared node for the evidence-bound questioning ladder and overlay-activation limits
- do not treat `balanced-default`, complexity labels, or generic ambiguity as permission to auto-select a deeper overlay
- keep route selection here: search/execute posture and normalized planning fields still decide when planning, review, or follow-up work is in scope

## Planning-Surface Routing Posture

Before broad capability search, the orchestrator should classify planning-oriented requests with the
normalized route-selection fields from [planning-backlog-roadmap-contract.md](planning-backlog-roadmap-contract.md):

- `planning_surface`
- `session_horizon`
- `execution_readiness`
- `overlap_risk`

Deterministic routing posture:

- `planning_surface: roadmap` -> keep `@orchestrator` as the owner of roadmap/backlog surface selection and persistence rules; when repo writes are needed, route through existing writing lanes and planning skills rather than dedicated backlog/roadmap planner agents
- `planning_surface: plan-pack` -> create a bounded implementation plan only when `execution_readiness` is `ready` or `stageable`; use `implementation-handoff` when another executor or future session needs a concrete brief
- `planning_surface: both` -> handle durable roadmap/backlog framing first, then create the selected implementation plan only when that slice is `ready` or `stageable`
- `planning_surface: none` -> do not create roadmap or plan-pack artifacts; route directly to the bounded delivery/reporting lane needed for the request, such as commit prep, review prep, or CI result checks

This posture keeps planning-surface choice explicit, preserves the bounded coordinator topology, and avoids
mixing durable roadmap authority with session execution state by default.

Plan-pack or handoff generation runs only when `planning_surface` includes `plan-pack` and
`execution_readiness` is `ready` or `stageable`. `roadmap`, `none`, and `not-ready` postures must
not start implementation planning.

## V1 Nested Coordinator Posture

The shipped V1 nested topology is intentionally narrow:

- `@orchestrator` (or `@orchestrator-cli`) remains the root session owner and the root loop owner.
- The effective repo depth cap is 3: `@orchestrator` -> approved coordinator -> leaf.
- Host/runtime nesting support up to depth 5 is runtime headroom only; the shipped repo topology stays bounded and explicit rather than generally recursive.
- Approved coordinator agents must be named and explicitly allowlisted in frontmatter; all other
   agents remain leaf-only.
- Planning uses direct coordinator-owned surface selection. Implementation handoff is a skill-backed
  artifact, while roadmap/backlog persistence uses existing writing lanes and planning skills instead
  of dedicated planner agents in the shipped surface.
- Validation uses the single leaf `@test-runner`; specialized unit, integration, and browser behavior
  stays inside that lane and its referenced skills rather than nested validation coordinators. The
  default validation posture is lean and risk-based: select the narrowest proof that closes the active
  risk, then escalate only when repo policy, coupling, missing evidence, or inconclusive results
  require broader coverage.
- Write-capable implementation lanes and reviewer lanes remain leaf-only in V1. `@impl` is the
  default shipped implementation lane; compatibility-only split implementation lanes are not part of
  the primary orchestrator workflow.
- Coordinator-to-coordinator chains are forbidden in V1.
- If nested planning is unavailable or disabled, use a direct plan-first workflow in the current host.

Within this topology, planning-surface selection remains coordinator-owned. Roadmap/backlog writes
remain coordinator-managed instead of handing control to dedicated planner agents.

## Deterministic capability families

When user intent is explicit, the orchestrator should prefer deterministic routing over broad search
for these capability families:

- project conventions governance -> `docs/system/project-conventions-governance.md`
- documentation and project-structure governance -> `docs/system/documentation-structure-governance.md`
- specialist reviewer lanes -> `docs/system/reviewer-lane-governance.md`
- project audit or multi-lane static analysis -> `docs/system/reviewer-lane-governance.md`, then
  `docs/system/follow-up-discovery-governance.md` when the findings need planning-ready carryover
- follow-up and research discovery -> `docs/system/follow-up-discovery-governance.md`

Use `@search` only when the user intent does not clearly identify the right family or when multiple
eligible capabilities remain plausible after the first-pass classification.

## Capability Sources

- Canonical docs in `docs/system/**`
- First-class agent assets in `engine-assets/agents/*.agent.md`
- Always-installed skills in `~/.copilot/skills/` (meta-skills plus `roadmap-authoring`)
- On-demand-only domain skills in `~/.copilot/skills-vault/`
- Repo-local assets in `<repo>/.github/agents` and `<repo>/.github/skills/`

## Vault-First Skill Model

The majority of skills should remain `on-demand` and live outside the primary installed scan path.
Shared planning, review, and spec skills are discoverable from the vault in Copilot and installed
directly only on target harnesses without a separate vault path.
These meta-skills remain always installed for workflow safety or repo bootstrap:

- `core-guardrails`
- `skill-discovery`
- `roadmap-authoring`
- `stack-detector`
- `project-guidelines`

This keeps startup context small and makes skill loading an explicit act even when a skill is already installed.

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

The approved routing posture in `balanced-default` mode is to avoid auto-selecting skills classified in [skills-governance.md](skills-governance.md) as either deprecated compatibility surfaces or default-handled surfaces.

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

Elegy Copilot owns:

- Prompt and agent assets
- Install layout and load-mode defaults
- UI/runtime surfacing
- Metadata generation and integration glue

## Operating Rules

- Load the smallest relevant canonical docs entrypoint before write-capable feature or modification work.
- Prefer deterministic routing before broad search.
- Keep nested routing inside the V1 approved-coordinator posture; approved coordinators may not
   re-root session ownership, routing policy ownership, or chain to other coordinators.
- Keep validation overlap bounded to completed or frozen slices that satisfy overlap-risk,
  dependency-safety, and repo-policy checks; never treat it as permission for unrestricted parallel writes.
- Do not stack unit, integration, and browser validation by default; broader validation layers need an
  explicit policy, risk, or confidence basis.
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

- the route is deterministic (`@code-reviewer`, direct test/doc lane, or an already selected planning skill)
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
