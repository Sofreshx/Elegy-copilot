---
created: 2026-06-29
updated: 2026-07-10
category: research
status: archived
doc_kind: node
id: codex-first-skill-fate-review
summary: Historical 2026-06-29 Codex-first skill fate review, retained as evidence and superseded for UI routing by elegy-ui-craft.
tags: [skills, codex, audit, fate, ui, planning, browser]
related: [ui-craft-source-review, skills-governance, search-execute-workflow, ui-development-governance, spec-driven-development, commit-validation-governance]
---

# Codex-First Skill Fate Review

> Historical snapshot (2026-06-29). Its recommendations about the standalone UI skills no longer
> describe the shipped catalog. Those assets were retired in favor of `elegy-ui-craft@elegy`.
> See [[ui-craft-source-review]] [ui-craft-source-review.md](ui-craft-source-review.md) [ui-craft-source-review](docs/research/ui-craft-source-review.md).

## Summary

This review answers a Codex-first product question: which skills should keep shipping or routing for Codex, which should be tightened or merged, and which missing capability should be added through existing repo assets rather than through new one-off surfaces.

Overall result:

- the UI trio is intentionally split and mostly justified
- `skill-discovery` is necessary if the repo wants many narrow on-demand skills, but its Codex fit is stronger as a routing contract than as a self-sufficient executable workflow
- `spec-planning-bridge` serves a real purpose, but it is thin and should justify itself by owning only the spec-to-planning boundary
- `skill-authoring` should remain shared but stay out of the Codex install surface
- `commit-check-setup` is useful as a deterministic mutating workflow, but its long-term value is closer to a scripted setup action than a high-traffic Codex skill
- Codex is missing browser/runtime routing coverage even though the repo already has the right underlying skill and docs

## Fate Matrix

| Target | Current Codex Status | Fate | Confidence | Short Reason |
|---|---|---|---|---|
| `spec-planning-bridge` | installed | tighten | medium | real boundary handoff, but thin and partly doc-shaped |
| `skill-discovery` | installed | keep | medium | required for vault-first granularity, backed by resolver/telemetry/validation surfaces |
| `ui-design-spec` | not installed | shared-only | high | valid shared spec lane, but removed from default Codex install to keep UI context lean |
| `ui-system` | installed | keep | high | strongest implementation lane for repo-grounded UI reuse |
| `ui-visual-review` | installed | keep | high | best-formed example of a narrow read-only UI judgment skill |
| `skill-authoring` | not installed | tighten | high | shared value exists, but Codex-native overlap is real and current non-install posture is correct |
| `commit-check-setup` | installed | tighten | medium | deterministic mutating workflow exists, but product fit is closer to setup action than reusable Codex lane |
| Codex browser/runtime coverage | installed | keep | high | Codex now ships `ui-runtime-exploration` alongside the retained UI execution lanes |

## Target Reviews

### `spec-planning-bridge`

#### Current Role

User-invoked bridge from approved spec state into durable planning state. It sits between `spec-review` and `elegy-planning`, and `docs/system/spec-driven-development.md` explicitly routes approved specs through it.

#### What It Does Well

- Preserves authority separation between specs and execution planning.
- Owns a real cross-lane action: file-scope linkage plus semantic `spec-link` recording.
- Stays user-invoked, which is correct for planning-state mutation.

#### What Weakens It

- Much of the file is routing/reference material rather than unique workflow logic.
- It depends heavily on canonical docs and planning tooling that already own most of the semantics.
- It has trigger coverage in the shared catalog test file, but no per-skill local trigger-eval surface.

#### Codex Fit

Codex can use it, but mainly when the repo is actually running the spec-driven + `elegy-planning` lane. Outside that workflow, the skill is too narrow to justify general-purpose installation value.

#### Recommended Fate

`tighten`

Keep it only as a narrow spec-to-planning bridge. Strip anything that duplicates normative file-scope grammar or harness command reference that is already owned elsewhere.

#### If Adopted, Update

- `catalog-assets/shared-skills/spec-planning-bridge/SKILL.md`
- `docs/system/spec-driven-development.md`
- `docs/specs/spec-driven-development-contract/spec.md`

### `skill-discovery`

#### Current Role

Always-installed routing contract for the vault-first search/execute pattern. It defines the deterministic resolver chain, multi-skill cap, and stop conditions for loading narrow skills on demand.

#### What It Does Well

- The pattern is backed by more than prose: metadata index, search workflow, telemetry, and validator support all exist.
- The resolver chain is deterministic and explicit.
- It is short, disciplined, and avoids duplicating the whole catalog inside the skill.

#### What Weakens It

- The skill itself is only a contract surface. It is not enough on its own to prove the pattern is operationally good for Codex without the surrounding control-plane implementation.
- Its trigger surface is not documented in `catalog-assets/shared-skills/TRIGGER-TESTS.md`, and it relies more on system docs and validators than on skill-local executable examples.
- In Codex specifically, the existence of native tool discovery and broader model capability weakens the case for keeping too many router layers unless they produce visibly better routing outcomes.

#### Codex Fit

Codex should keep a discovery/routing contract if the repo continues betting on many narrow skills. Without it, the vault-first strategy weakens quickly. The stronger critique is not “delete it,” but “prove that it improves routing enough to justify the abstraction.”

#### Recommended Fate

`keep`

Keep it as the enabling pattern for narrow shared skills, but judge future skill growth against it more aggressively. If routing quality is poor, the portfolio should shrink before `skill-discovery` is blamed.

#### If Adopted, Update

- `engine-assets/skills/skill-discovery/SKILL.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/skill-discovery-telemetry.md`
- `scripts/validate-skill-discovery-map.js`

### `ui-design-spec`

#### Current Role

Spec-authoring lane for UI work. It converts prompts, screenshots, generated concepts, or Figma context into a structured repo-grounded UI spec before implementation.

#### What It Does Well

- It makes states, acceptance criteria, and evidence planning explicit.
- It forces a handoff through `ui-system` inventory instead of letting spec writing float above repo reality.
- It fits the intended UI workflow in `docs/system/ui-development-governance.md`.

#### What Weakens It

- It is the weakest of the three UI skills because it is more template-like than operational.
- Compared with current strong UI-spec practice, it is thin on examples, concrete decision heuristics, and failure patterns.
- It depends on the implementer to do the hard repo-grounding work after the fact via `ui-system`.

#### Codex Fit

Useful for genuine new surfaces and redesigns. Less useful for the common Codex case of “implement a bounded UI change in an already-known surface.”

#### Recommended Fate

`tighten`

Keep the lane split, but improve the skill so it behaves more like a high-quality UI spec tool and less like a formatting checklist.

#### If Adopted, Update

- `catalog-assets/shared-skills/ui-design-spec/SKILL.md`
- `docs/system/ui-development-governance.md`
- `docs/system/ui-check-adoption.md`

### `ui-system`

#### Current Role

Inventory-first implementation lane for UI work. It stops duplication, enforces reuse order, and ties UI changes to local components, icons, tokens, and validation lanes.

#### What It Does Well

- It owns the most important implementation behavior in the UI stack: local inventory before invention.
- It clearly defines reuse order, state handling, icon rules, token rules, and validation posture.
- It is the strongest Codex-fit UI skill because it helps directly with actual implementation work.

#### What Weakens It

- It includes “frontend visual review” in the trigger section even though `ui-visual-review` exists as the judgment lane.
- It is broad and can become a gravity well if the repo keeps adding UI concerns to it instead of preserving the split.

#### Codex Fit

High. If Codex ships only one UI skill, this is the one with the clearest practical value.

#### Recommended Fate

`keep`

Keep it as the primary Codex UI implementation skill, but keep trimming any trigger overlap that belongs to review or spec lanes.

#### If Adopted, Update

- `catalog-assets/shared-skills/ui-system/SKILL.md`
- `docs/system/ui-development-governance.md`

### `ui-visual-review`

#### Current Role

Read-only judgment lane for rendered UI evidence. It reviews hierarchy, layout, component usage, UX flow, accessibility observations, and aesthetics without editing code.

#### What It Does Well

- It is the cleanest skill in the UI set: narrow purpose, clear inputs, clear output contract.
- It explicitly distinguishes visual review from implementation review and from spec authoring.
- It handles accessibility carefully by acknowledging evidence limits rather than overclaiming compliance.

#### What Weakens It

- It depends on a strong upstream evidence lane. Without screenshots/browser/runtime artifacts, it cannot carry much value.
- Like the other reviewed skills, it lacks per-skill local trigger-eval files.

#### Codex Fit

High, especially in a Codex workflow that already supports screenshot/browser evidence and review passes. This is the best example in the current UI portfolio of a skill that is both narrow and useful.

#### Recommended Fate

`keep`

Use it as the portfolio benchmark for “good narrow skill design.”

#### If Adopted, Update

- `catalog-assets/shared-skills/ui-visual-review/SKILL.md`
- `docs/system/ui-development-governance.md`

### `skill-authoring`

#### Current Role

Cross-harness shared skill for creating and refining portable `SKILL.md` assets using the agentskills.io standard and bundled authoring workflow.

#### What It Does Well

- It is substantially richer than a pure format reference.
- It packages cross-harness skill creation concerns that are not specific to one runtime.
- It is explicitly backed by a repo spec for adding these shared authoring skills.

#### What Weakens It

- At 437 lines, it is long for a shared authoring skill and carries some “process about process” weight.
- In Codex specifically, it overlaps with native model capability and repo-local instructions more than many domain skills do.
- The repo already concluded this enough to omit it from the Codex installed surface.

#### Codex Fit

Low as an installed Codex skill. Medium as a shared asset for other harnesses or explicit cross-harness authoring work.

#### Recommended Fate

`tighten`

Keep it shared, keep it out of Codex install, and trim it until the unique cross-harness value is more obvious than the generic “how to write a skill” material.

#### If Adopted, Update

- `catalog-assets/shared-skills/skill-authoring/SKILL.md`
- `docs/system/skills-governance.md`
- `docs/specs/skill-authoring-and-guidelines-deprecation/spec.md`

### `commit-check-setup`

#### Current Role

Mutating setup skill that copies bundled scripts into a target repo, generates `.copilot/commit-checks.json`, and runs smoke tests. It complements the read-only `commit-validation-governance` skill.

#### What It Does Well

- It has a real executable job and bundles concrete scripts, not just prose.
- It is deterministic, explicit about mutation, and grounded in canonical commit-validation docs.
- It cleanly separates audit/propose from setup/update.

#### What Weakens It

- The reusable value lives heavily in the scripts and setup contract, not in the skill wrapper itself.
- From a Codex product perspective, it feels closer to a setup action or repo bootstrap routine than to a high-value interactive skill.
- There is no trigger coverage in the shared trigger test surface for it, and its Codex install value depends on whether users are expected to perform this sort of bootstrap from Codex rather than from UI or scripts.

#### Codex Fit

Medium-low. It is legitimate as a mutating skill, but not obviously something Codex must ship by default if the same behavior can be better surfaced as an explicit UI/setup action.

#### Recommended Fate

`tighten`

Do not remove it yet, but treat it as a candidate to migrate toward “UI/setup action backed by scripts” if usage is low and the Codex lane does not need it.

#### If Adopted, Update

- `engine-assets/skills/commit-check-setup/SKILL.md`
- `docs/system/commit-check-setup.md`
- `docs/system/commit-validation-governance.md`
- Codex install surfaces if you later decide it should no longer ship there

### Codex Browser/Runtime Coverage

#### Current Role

Codex now ships `ui-system`, `ui-runtime-exploration`, and `ui-visual-review`. Browser/runtime guidance is part of the default Codex install surface, while `ui-design-spec` remains shared-only to avoid adding spec-authoring overhead to routine UI implementation work.

#### What It Does Well

- The repo already has the right abstraction: `ui-runtime-exploration` plus browser/E2E docs.
- The browser/runtime lane is intentionally separated from UI spec/implementation/review.

#### What Weakens It

- Codex install and Codex appendix discoverability do not expose that lane.
- This makes the UI stack incomplete in Codex: you can spec, build, and visually review UI, but the explicit runtime-routing skill is absent.
- The likely user symptom is “Codex seems to lack a Playwright/agent-browser skill,” even though the repo already solved that problem elsewhere.

#### Codex Fit

High. This is the clearest “missing capability” in the Codex shipped skill surface reviewed here.

#### Recommended Fate

`add-missing`

Add the existing ui-runtime-exploration skill to the Codex shipped/install surface, or add equally explicit Codex-native routing cues if you intentionally do not want it as a skill. Do not create a new browser or Playwright skill unless the existing one proves inadequate.

#### If Adopted, Update

- `codex-assets/manifest.json`
- `catalog-assets/shippedAssets.mjs`
- `codex-assets/home/AGENTS-appendix.md`
- optionally `docs/system/skills-governance.md` if the Codex install set description changes

## Cross-Cutting Findings

### 1. The best skills own a narrow lane with a real boundary

`ui-visual-review` is the strongest example in this set because it has a clear input boundary, stays read-only, and produces a precise output contract. Skills that mainly restate adjacent docs or tooling without owning a boundary drift toward being documentation in skill clothing.

### 2. Codex install posture is not the same question as shared-catalog usefulness

`skill-authoring` is the clearest case. It can remain a valid shared asset while still being the wrong thing to install for Codex by default.

### 3. Router/bridge skills must justify themselves harder than implementation or review skills

`spec-planning-bridge` and `skill-discovery` are both abstractions over other assets. They should survive only if they provide real deterministic routing or state-boundary value, not because the workflow diagram looks cleaner with another named surface.

### 4. The current UI portfolio is more coherent than it first appears

The repo’s canonical UI governance does justify the split among `ui-design-spec`, `ui-system`, and `ui-visual-review`. The problem is not duplication of mission so much as uneven quality, with `ui-design-spec` lagging the other two.

### 5. Trigger coverage is still inconsistent

Within the named targets, shared trigger coverage exists for `spec-planning-bridge`, `skill-authoring`, and the UI skills. It does not appear in the same shared surface for `skill-discovery` or `commit-check-setup`, and none of these reviewed skill directories currently demonstrate the per-skill local trigger-eval pattern described in catalog governance.

## Recommended Next Actions

1. Keep `ui-runtime-exploration` in the Codex shipped/install surface instead of inventing a new browser skill.
2. Keep `ui-design-spec` shared-only unless Codex later proves a default-installed UI spec lane is worth the added context overhead.
3. Trim `spec-planning-bridge` until only the true spec-to-planning boundary logic remains.
4. Keep `skill-discovery`, but require future narrow-skill additions to prove they benefit from the vault-first pattern.
5. Keep `skill-authoring` shared and explicitly non-Codex-installed.
6. Re-evaluate whether `commit-check-setup` should stay a Codex skill or move toward a scripted setup/UI action.

## Evidence

Primary skill surfaces:

- `catalog-assets/shared-skills/spec-planning-bridge/SKILL.md`
- `engine-assets/skills/skill-discovery/SKILL.md`
- `catalog-assets/shared-skills/ui-design-spec/SKILL.md`
- `catalog-assets/shared-skills/ui-system/SKILL.md`
- `catalog-assets/shared-skills/ui-visual-review/SKILL.md`
- `catalog-assets/shared-skills/skill-authoring/SKILL.md`
- `engine-assets/skills/commit-check-setup/SKILL.md`

Canonical docs:

- `docs/system/skills-governance.md`
- `docs/system/search-execute-workflow.md`
- `docs/system/ui-development-governance.md`
- `docs/system/spec-driven-development.md`
- `docs/system/commit-validation-governance.md`
- `docs/system/commit-check-setup.md`
- `docs/system/e2e-setup-guide.md`

Install and validation surfaces:

- `codex-assets/manifest.json`
- `engine-assets/manifest.json`
- `catalog-assets/shippedAssets.mjs`
- `catalog-assets/shared-skills/TRIGGER-TESTS.md`
- `scripts/validate-skills.mjs`
- `scripts/validate-skill-discovery-map.js`
