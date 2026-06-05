---
spec_id: agentic-lanes-quality
title: OpenCode Agentic Lanes Quality Evaluation and Hardening
status: implemented
type: workflow
updated: 2026-06-03
---

# OpenCode Agentic Lanes Quality Evaluation and Hardening

## Intent

Make the OpenCode lane agent system auditable, internally consistent, and harder to misroute. The current setup is directionally sound but has drift between documentation, lane prompts, Elegy command references, model routing, and validation coverage. This spec defines the hardening requirements to close those gaps.

## Context Evidence

- `opencode-assets/agents/quick.md` — Quick lane: small UI tweaks, Flash model, no spec/roadmap. Already rejects API/contract/user-facing work (lines 23-25), but does not explicitly reject ambiguous user prompts (the user asks something that could go multiple ways without enough detail).
- `opencode-assets/agents/standard.md` — Standard lane: scoped features/bugs, Pro model, 3 subagents. Clarification-first wording present.
- `opencode-assets/agents/spec.md` — Spec lane: contract/API changes, spec-first, mandatory review. Asks user for contract boundary even when discoverable via exploration.
- `opencode-assets/agents/project.md` — Project lane: multi-session, Elegy Planning, worktrees. References Elegy commands that do not exist in `elegy-planning/SKILL.md` (e.g., `goal current`, `lease list`, `work-point list`, `evidence add`).
- `docs/system/opencode-guide.md` — Refers to "lane-quick, lane-standard, lane-spec, lane-project" as skills, but they are agents.
- `opencode-assets/profiles.json` — Defines model routing (`agentRoles`) and profiles (`opencode-go`, `deepseek-direct`). No validation that every `agentRoles` entry maps to an installed agent.
- `catalog-assets/shared-skills/elegy-planning/SKILL.md` — Documented commands: `goal create/show/list`, `roadmap create/show/list/add-work-point`, `plan create/show/list/revise`, `todo create/list`, `issue record/list`, `review-point record`, `scope create/show/list`, `search`, `validate all`, `health`, `project render`, `session init/use/show`. Commands like `goal current`, `lease list`, `work-point list`, `evidence add` are NOT documented.
- `scripts/validate-manifest.js` — Validates manifest structure but does not validate prompt quality, doc/lane consistency, profile role coverage, or Elegy command references.
- `scripts/opencode-install.test.js` — Tests install/idempotence/API shape but not behavioral quality, prompt invariants, or doc consistency.
- `opencode-assets/agents/impl.md` — Write-capable subagent. Also responsible for commands/tests, making parent unable to verify without relying on subagent summaries (architectural note, not changed in this spec).
- `opencode-assets/agents/code-explorer.md` — Compatibility duplicate of `explorer.md`; risk of drift.
- `opencode-assets/agents/spec.md` and `opencode-assets/agents/project.md` — Neither prompts reference `elegy-skills-discovery` for non-core skill routing, but both load skills outside the always-loaded set. This is a gap: skill routing decisions are made without the governed catalog.

## Requirements

### R1 — Normalize Documentation Posture
- `docs/system/opencode-guide.md` must refer to lane agents, not lane skills.
- `docs/system/` docs must consistently treat built-in OpenCode agents (`Build`, `Plan`, `Explore`, `Scout`, `General`) as the default and lane agents (`quick`, `standard`, `spec`, `project`) as optional native workflow agents. The validator (R7) is the enforcement mechanism.
- `opencode-assets/home/AGENTS.md` must match the corrected `opencode-guide.md` posture.
- If any `lane-*` skill classification exists in `docs/system/` or `opencode-assets/home/AGENTS.md`, fix them.

### R2 — Prompt Quality Rules for All Lane Agents
Every lane agent prompt must include:
- **Evidence-first clarification ladder**: before asking the user, attempt to discover the answer from repo evidence (code, docs, config).
- **Explicit refusal**: define the lane boundary and say "switch to <other-lane>" when exceeded.
- **No implementation before gates**: if the lane has required phases (e.g., spec-first review, plan review), explicitly block implementation until those gates pass.
- **Observable skill loads**: `spec` and `project` must declare required skill preloads in their prompt. Non-core skill routing must reference `elegy-skills-discovery` before loading.

### R3 — Tighten `quick` Lane
- Add explicit rejection rule: refuse ambiguous prompts, user-facing behavior changes, API contract changes, or multi-step orchestration work.
- Delegate to `standard`, `spec`, or `project` when work exceeds `quick` bounds.
- Keep genuinely tiny: single-step queries, typo fixes, 1-2 line changes with no behavioral impact.

### R4 — Tighten `spec` Lane
- Change clarification policy: explore codebase first when the contract boundary is discoverable (APIs, types, existing contracts).
- Only ask the user for product intent or acceptance criteria that cannot be inferred from code.
- Keep the existing spec-first workflow gates intact.

### R5 — Tighten `project` Lane
- Remove references to Elegy CLI commands that are not documented in `elegy-planning/SKILL.md`.
- Replace or remove: `goal current`, `lease list`, `work-point list`, `evidence add` with documented equivalents or remove them.
- Use only documented commands: `goal create/show/list`, `roadmap create/show/list/add-work-point`, `plan create/show/list/revise`, `todo create/list`, `issue record/list`, `review-point record`, `scope create/show/list`, `search`, `validate all`, `health`, `project render`, `session init/use/show`.
- If `lease`, `work-point`, or `evidence` surfaced need to be first-class CLI surfaces, update `elegy-planning/SKILL.md` first, then reference them.

### R6 — Model Routing Single-Source
- Model/profile mapping must derive from `opencode-assets/profiles.json` as the single source of truth.
- `scripts/opencode-profile-switch.mjs` remains the canonical writer of `model` fields into installed agent frontmatter. It must read exclusively from `profiles.json`.
- No other file (dashboard HTML, docs, hardcoded config) may independently declare model labels for agents whose role is defined in `agentRoles`. Documentation may describe the profile but must not duplicate the mapping.
- Validate that every `agentRoles` key maps to an installed agent file in `opencode-assets/agents/`.
- Validate that every installed agent with a role entry has `model` and `reasoningEffort` fields (either in frontmatter or derived from profile).
- Any UI or dashboard that displays model information must be clearly labeled as affecting lane agents, built-in agents, or both.

### R7 — Lightweight Validators
Add the following validation checks:
- **Lane doc reference validator**: `docs/system/opencode-guide.md` and other docs must not reference `lane-*` skills; must reference only shipped agents and shipped skills.
- **Lane prompt section validator**: every lane agent prompt file must contain required sections (clarification policy, refusal/boundary, required gates, skill preloads where applicable).
- **Profile role coverage validator**: every key in `profiles.json` → `agentRoles` must have a corresponding file in `opencode-assets/agents/`.
- **Elegy command reference validator**: `opencode-assets/agents/project.md` must only contain Elegy CLI commands documented in `elegy-planning/SKILL.md`.
- All new validators must be runnable via `node scripts/<validator-name>.js` and return exit code 0 on pass, 1 on failure.

### R8 — Targeted Tests
Add tests for:
- Install output contains all four lane agents (`quick`, `standard`, `spec`, `project`) and required support subagents (`impl`, `reviewer`, `explorer`).
- Profile switching updates all role-mapped agent files and preserves `reasoningEffort`.
- Docs do not reference missing `lane-*` skills.
- `project.md` prompt references only documented Elegy command families.
- `spec.md` prompt references installed skills only.
- Lane agent prompts contain required sections (clarification policy, refusal/boundary).

## Non-Goals

- Do not remove or deprecate any lane agent. Keep all four: quick, standard, spec, project.
- Do not change the model routing (DeepSeek Flash/Pro via opencode-go, deepseek-direct as fallback).
- Do not change the Elegy Planning authority model. Elegy remains the durable planning authority; Obsidian remains non-authoritative mirror.
- Do not change the `impl` subagent's dual responsibility (edits + commands/tests). This is an architectural concern tracked separately.
- Do not merge or remove `code-explorer.md` compatibility alias in this spec.
- Do not add a dashboard or modify `copilot-ui/` in this spec.

## Acceptance Checks

- `docs/system/opencode-guide.md` does not classify `lane-quick`, `lane-standard`, `lane-spec`, or `lane-project` as skills (they are agents). The validator in R7 enforces this.
  → verify: `node scripts/validate-lane-doc-refs.js`
- `node scripts/validate-lane-doc-refs.js` exits 0 and confirms docs reference only shipped agents and skills.
  → verify: `node scripts/validate-lane-doc-refs.js`
- `node scripts/validate-lane-prompt-sections.js` exits 0 and confirms all lane agent `.md` files have required sections.
  → verify: `node scripts/validate-lane-prompt-sections.js`
- `node scripts/validate-profile-role-coverage.js` exits 0 and confirms every `agentRoles` key maps to an installed agent.
  → verify: `node scripts/validate-profile-role-coverage.js`
- `node scripts/validate-elegy-command-refs.js` exits 0 and confirms `project.md` uses only documented Elegy commands.
  → verify: `node scripts/validate-elegy-command-refs.js`
- `node scripts/opencode-install.test.js` passes all existing scenarios.
  → verify: `node scripts/opencode-install.test.js`
- `node scripts/validate-manifest.js` passes.
  → verify: `node scripts/validate-manifest.js`
- New install test confirms all lane agents and subagents are present after install.
  → verify: `node scripts/opencode-install.test.js`
- Profile switching test confirms model fields update for all role-mapped agents and `reasoningEffort` is preserved.
  → verify: `node scripts/opencode-profile-switch.test.js`
- `quick.md` contains explicit rejection rule for ambiguous/user-facing/API work.
  → verify: `Select-String -Path opencode-assets/agents/quick.md -Pattern "ambiguous|user-facing|API contract|switch to"`
- `spec.md` contains "explore first" clarification policy when contract boundary is discoverable.
  → verify: `Select-String -Path opencode-assets/agents/spec.md -Pattern "explore.*first|discoverable from code|evidence-first"`
- `project.md` contains zero references to `goal current`, `lease list`, `work-point list`, `evidence add`.
  → verify: `Select-String -Path opencode-assets/agents/project.md -Pattern "goal current|lease list|work-point list|evidence add" -NotMatch`

## Implementation Links

- `opencode-assets/agents/quick.md` — R2, R3
- `opencode-assets/agents/standard.md` — R2
- `opencode-assets/agents/spec.md` — R2, R4
- `opencode-assets/agents/project.md` — R2, R5
- `docs/system/opencode-guide.md` — R1
- `opencode-assets/home/AGENTS.md` — R1 (must match corrected opencode-guide.md posture)
- `opencode-assets/profiles.json` — R6
- `scripts/validate-lane-doc-refs.js` — R7 (new)
- `scripts/validate-lane-prompt-sections.js` — R7 (new)
- `scripts/validate-profile-role-coverage.js` — R7 (new)
- `scripts/validate-elegy-command-refs.js` — R7 (new)
- `scripts/opencode-install.test.js` — R8 (modified)
- `scripts/opencode-profile-switch.test.js` — R8 (new, or modify existing)
- `scripts/validate-manifest.js` — existing, must still pass

## Validation Evidence

- `node scripts/validate-specs.js`: specs ok (1 specs) — spec contract valid
- `node scripts/validate-manifest.js`: manifest ok — no regressions
- `node scripts/validate-lane-doc-refs.js`: lane-doc-refs ok — no lane agents classified as skills
- `node scripts/validate-lane-prompt-sections.js`: lane-prompt-sections ok — all 4 lane agents have required sections
- `node scripts/validate-profile-role-coverage.js`: profile-role-coverage ok — all agentRoles map to installed agents
- `node scripts/validate-elegy-command-refs.js`: elegy-command-refs ok — project.md uses only documented Elegy commands
- `node scripts/opencode-install.test.js`: 9 tests passed (5 original + 4 new validator tests)
- `node scripts/opencode-profile-switch.test.js`: 3 tests passed (profile switching + reasoningEffort preservation + role filtering)

## Drift Notes

- None.
