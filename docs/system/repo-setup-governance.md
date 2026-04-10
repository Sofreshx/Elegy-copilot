---
created: 2026-04-10
updated: 2026-04-10
category: system
status: current
doc_kind: node
id: repo-setup-governance
summary: Canonical authority and Slice A plus Slice B bootstrap contract for shared repo-setup governance of target-repo Copilot readiness.
tags: [governance, repo-setup, copilot, workspace]
related: [catalog-control-plane, copilot-ui-guide, domain-authorities-freeze, search-execute-workflow, skills-governance]
---

# Repo Setup Governance

## Purpose

This node defines the canonical authority for the shared repo-setup governance lane that evaluates
whether a target repository is prepared to work well with Elegy Copilot and proposes the smallest
missing setup resources.

Slice A is intentionally narrow:

- shared shipped lane only
- audit/propose-first only
- no repo mutation or update execution
- no machine-local activation or routing-policy ownership

Slice B is the next approved authority slice:

- canonical profile-definition ownership for profile-backed setup classification and update planning
- no profile-backed update execution until a host/runtime mutation handoff exists
- no support-resource writes outside repo-local agent/skill assets

## Scope and source precedence

Use this precedence order when the lane evaluates repo setup provenance:

1. explicit user instruction for the current task
2. this canonical node plus other relevant `docs/system/**` governance docs
3. `engine-assets/skills/repo-setup-governance/baseline.definition.json` as the authoritative
   machine-readable Slice A baseline source owned by this doc
4. `engine-assets/skills/repo-setup-governance/baseline.json` as a deterministic runtime
   projection of that canonical baseline source
5. target-repo files and open workspace-root evidence
6. external framework or runtime documentation when behavior depends on upstream product rules

Shipped runtime assets are projections of canonical authority. They are not independent sources of
truth and must not silently override this doc or other canonical governance nodes.

## V1 target-repo contract

Slice A supports only currently open workspace roots.

- only an open workspace root may be selected as the target repo in v1
- if exactly one workspace root is open, the lane may operate on that root
- if multiple workspace roots are open, explicit selection is required through `askQuestions`
- do not infer the target repo from terminal cwd, editor cwd, or recent command history
- if no open workspace root can be determined, fail closed and ask for explicit repo selection

This lane governs repo setup provenance only. It does not own machine-local repo-state activation,
routing policy, enablement overlays, or session/task authority.

## Default mode

The default mode is `audit/propose-first`.

In Slice A the lane may:

- inspect the selected open workspace root
- compare observed repo resources against canonical baseline requirements
- classify missing, stale, unknown, and conflicting setup evidence
- propose the smallest next resources or updates needed

In Slice A the lane may not:

- mutate the target repo
- write repo-local governance assets on the user's behalf
- execute registry-backed or profile-backed setup updates
- invent current runtime facts that are not present in the selected workspace root or canonical
  shipped baseline

## Normative minimum asset set

For Slice A, a correctly configured target repo has this normative minimum setup surface:

### Required

- `README.md`
- `.github/copilot-instructions.md`
- `.github/agents/`
- `.github/skills/`
- one canonical documentation entrypoint path from this approved set:
  - `docs/system/index.md`
  - `docs/index.md`
  - `documentation/index.md`

### Recommended

- `.vscode/settings.json` when repo-local editor recommendations are part of the documented setup
- `.vscode/mcp.json` when the repo's documented workflow relies on a workspace MCP bridge

The machine-readable baseline may encode this set in more operational detail, but it must not widen
or narrow the normative contract without first updating this canonical node.

## Baseline source ownership

Slice A uses two shipped baseline files with different authority roles:

- `engine-assets/skills/repo-setup-governance/baseline.definition.json`
  - canonical machine-readable baseline definition
  - editable authority source for the shipped Slice A baseline
- `engine-assets/skills/repo-setup-governance/baseline.json`
  - deterministic runtime projection derived from `baseline.definition.json`
  - read at runtime for audit/propose-only evaluation

The projection file exists to keep runtime lookup simple and fail-closed. It must be fully
regenerable and must not carry policy that is absent from the definition source or this canonical
doc.

## Profile-backed authority bootstrap

Slice B adds two shipped profile files with different authority roles:

- `engine-assets/skills/repo-setup-governance/profile-definitions.json`
  - canonical machine-readable profile-definition source for profile-backed setup classification and
    update planning
- `engine-assets/skills/repo-setup-governance/setup-profiles.json`
  - deterministic runtime projection derived from `profile-definitions.json`
  - read at runtime for fail-closed profile lookup during classification and update planning

Runtime projections are not independent authority. `setup-profiles.json` must remain fully
regenerable and must not silently override this doc or `profile-definitions.json`.

Slice B is authority/bootstrap only:

- profile-backed update execution remains gated and unavailable from this lane until a host/runtime
  mutation handoff exists
- if repo-local agent/skill mutation is later enabled, it must route through the `copilot-ui`
  catalog/control-plane mutation authority rather than direct editor writes
- support-resource writes outside repo-local agent/skill assets remain deferred and out of scope for
  this slice

## Compatibility gate

Compatibility for the shipped repo-setup lane remains fail-closed.

- `baseline.compatibility.minIndexSchemaVersion` is compared against
  `engine-assets/skills/skill-metadata-index.json` `schemaVersion`
- Slice B profile definitions use the same installed-skill, manifest, and load-mode compatibility
  floor for classification/update-planning runtime validation

## Stale, unknown, and contradiction handling

### Stale or unknown state

- if required repo evidence is missing, report `missing` and propose the minimal resource to add
- if repo evidence exists but appears incomplete, outdated, or unverifiable, report `stale`
- if the lane cannot determine target-repo facts from the selected open workspace root, report
  `unknown` and fail closed instead of guessing
- external URLs may be cited as advisory references only; they do not replace canonical docs or the
  shipped baseline in Slice A

### Partially prepared or conflicting repo-local assets

- when repo-local assets contradict each other, classify the case as `conflict`
- when a repo appears partially prepared, preserve the observed state in the audit and propose the
  smallest authoritative reconciliation path
- do not pick a winner between conflicting repo-local assets unless a higher-precedence canonical
  source already resolves the contradiction
- do not convert contradiction handling into mutation or update execution in Slice A

## Shared shipped / user-global exception

The default governance posture remains repo-local for repo-specific governance lanes.

This lane has one narrow exception:

- the shared shipped `repo-setup-governance-global` bundle may install the user-invocable
  `repo-setup-governor` agent and the `repo-setup-governance` skill into the user-global surface
- shipped profile-definition and runtime-projection files under
  `engine-assets/skills/repo-setup-governance/` may ship with that shared lane as authority/
  bootstrap artifacts for classification and update planning
- this exception exists only so a shared audit/propose lane can evaluate currently open workspace
  roots without requiring per-repo bootstrap first
- this exception does not authorize general repo-specific governance lanes to become user-global
- this exception does not authorize repo-local mutation/update execution or new machine-local
  authority surfaces

## External behavior and official-doc guidance

When framework, runtime, or tool behavior matters and the answer is not fully fixed by canonical
repo docs, cite the relevant official upstream documentation in addition to canonical repo sources.

Use external references to:

- confirm version-sensitive runtime behavior
- justify setup recommendations tied to official product requirements
- explain why a proposed resource is needed when the local repo does not already document it

Do not treat unofficial blog posts, generated summaries, or stale cached guidance as authoritative
when official documentation is available.