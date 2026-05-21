---
name: repo-setup-governance
description: "Audit/propose-only governance for making a repo easy to work with for Elegy Copilot using explicit open workspace roots and a shipped baseline projection. Triggers on: repo setup governance, repo setup audit, copilot repo setup, workspace root setup, propose missing repo setup assets."
tags: [governance, repo-setup, audit, workspace]
---

# Repo Setup Governance

## Purpose

Apply the canonical repo-setup governance contract so repo-setup work stays audit/propose-first,
uses explicit open workspace roots only, and relies on shipped baseline and profile data instead of
stale guesswork.

## Required Inputs

- target open workspace root, or enough context to select one deterministically
- request mode: `audit` or `propose`
- any repo-specific constraints already supplied by the user

If multiple workspace roots are open or the target scope is ambiguous, use `askQuestions` to obtain
an explicit root selection. Do not infer from cwd.

## Runtime Sources

- canonical doc authority: `docs/system/repo-setup-governance.md`
- authoritative machine-readable Slice A source: `engine-assets/skills/repo-setup-governance/baseline.definition.json`
- authoritative runtime source in Slice A: `engine-assets/skills/repo-setup-governance/baseline.json`
- authoritative machine-readable Slice B source: `engine-assets/skills/repo-setup-governance/profile-definitions.json`
- runtime profile source in Slice B: `engine-assets/skills/repo-setup-governance/setup-profiles.json`

External URLs are advisory only in Slice A. Use them only when official framework or runtime docs are
needed to justify version-sensitive setup requirements.

## Modes

### Audit

- inspect the explicit open workspace root
- compare observed repo assets against `baseline.json`
- classify findings as `missing`, `stale`, `unknown`, or `conflict`
- stop at findings

### Propose

- do everything from audit mode
- propose the smallest missing resources or refresh steps needed
- stay read-only

### Update

- classification and update planning may consult `setup-profiles.json`
- repo mutation and profile-backed update execution are intentionally unavailable in the current lane
- approved installer-mediated bootstrap, such as the opt-in `spec-driven` overlay profile, is out-of-band from this shared lane and still requires an explicit selected repo root

## Operating Rules

- default to `audit/propose-first`
- support only explicit open workspace roots in v1
- fail closed when repo facts are unknown or contradictory
- do not treat `baseline.json` as an independent authority; it is a shipped runtime projection of canonical docs and `baseline.definition.json`
- do not treat `setup-profiles.json` as an independent authority; it is a shipped runtime projection of canonical docs and `profile-definitions.json`
- do not widen this lane into machine-local repo-state activation or routing policy
- when repo-local assets conflict, report the conflict and the higher-precedence canonical source instead of guessing

## Deterministic Workflow

1. Confirm the target open workspace root.
2. Load the canonical repo-setup governance doc and the shipped `baseline.json`.
3. Load `setup-profiles.json` when classification or update planning context is needed.
4. Evaluate the repo against the minimum asset set and audit outcome policy.
5. Record missing, stale, unknown, and conflicting evidence separately.
6. Propose only the smallest next resources or authoritative refresh actions.
7. Report that update execution remains gated and unavailable.

If the user asks how to apply an approved overlay profile, explain that the lane itself stays
read-only and point them to the relevant harness installer flow instead of pretending the lane can
write the repo directly.

## Output Contract

Return this exact structure:

```text
REPO_SETUP_GOVERNANCE
- mode: audit|propose
- target_repo:
- workspace_root_selection:
- canonical_sources:
  - <path>
- runtime_baseline:
  - engine-assets/skills/repo-setup-governance/baseline.json
- findings:
  - <missing|stale|unknown|conflict + evidence>
- proposed_resources:
  - <path or action + reason>
- update_execution:
  - gated-unavailable
```

If a section has no items, write `- none`.

## Contradiction Handling

- if multiple workspace roots are open and no explicit selection was supplied, stop and ask
- if repo-local assets contradict each other, classify the case as `conflict`
- if canonical docs and local evidence disagree, follow the canonical docs and report the drift
- if external framework/runtime behavior matters, cite the official docs and note any version-sensitive behavior
- if profile-backed planning data is loaded, use it only for classification/proposal shaping and
  continue to report update execution as unavailable

## Canonical References

- `docs/system/repo-setup-governance.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/skills-governance.md`
- `docs/system/catalog-control-plane.md`
- `docs/system/copilot-ui-guide.md`
- `docs/system/domain-authorities-freeze.md`

Version-note posture:

- cite official upstream docs when setup behavior is version-sensitive or runtime-dependent
- treat those citations as supporting evidence, not as replacements for canonical repo authority
